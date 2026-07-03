const CATEGORY_LABELS = {
  commercial_banks: 'Commercial Bank',
  development_banks: 'Development Bank',
  finance_companies: 'Finance Company'
};

const CAT_COLORS = {
  commercial_banks: '#3B6FDB',
  development_banks: '#B8962E',
  finance_companies: '#C05A3A'
};

const DEV_CAT_MAP = {
  cb: 'commercial_banks',
  db: 'development_banks',
  fc: 'finance_companies'
};

let DATA = null;
let SPREAD_DATA = null;
let GLOBAL_LATEST_DATE = null;

/* Interest Rate Corridor data — loaded from data/reference.json */
let IRC_DATA = [];

let currentPage = 'dashboard';
let currentIndicator = 'base_rate';
let currentDevCat = 'cb';
let currentScatCat = 'cb';
let activeSubTab = 'commercial_banks';
let sortState = { col: null, dir: null };

const BS_MONTHS = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_MONTHS_SHORT = ['Bai','Jes','Asa','Shr','Bha','Asw','Kar','Man','Pou','Mag','Fal','Cha'];

function fmtDate(d) {
  const [year, month] = d.split('-');
  return `${BS_MONTHS[parseInt(month,10)-1]} ${year}`;
}

function fmtDateShort(d) {
  const [year, month] = d.split('-');
  return `${BS_MONTHS_SHORT[parseInt(month,10)-1]} ${year.slice(2)}`;
}

function fmtRate(r) { return r.toFixed(2) + '%'; }

/* ---- Shared chart helpers ---- */

// Usable chart width inside a .dash-card (28px padding each side)
function chartWidth(svg) {
  const parentW = svg.parentElement.clientWidth || svg.parentElement.offsetWidth || 500;
  return Math.max(parentW - 56, 300);
}

// Horizontal gridlines + y-axis tick labels
function yGrid(y, min, max, x0, x1, ticks = 4) {
  let out = '';
  for (let t = 0; t <= ticks; t++) {
    const v = min + (max - min) * t / ticks;
    const yy = y(v).toFixed(1);
    out += `<line x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}" stroke="#E2DCCB" stroke-width="1"/>`;
    out += `<text x="${x0 - 6}" y="${+yy + 3.5}" text-anchor="end" font-family="Space Mono, monospace" font-size="10" fill="#5A6478">${v.toFixed(1)}</text>`;
  }
  return out;
}

// X-axis date labels, thinned so at most ~6 appear
function xDateLabels(dates, x, labelY) {
  let out = '';
  const step = Math.max(1, Math.ceil(dates.length / 5));
  dates.forEach((d, i) => {
    if (i % step === 0 || i === dates.length - 1) {
      out += `<text x="${x(i).toFixed(1)}" y="${labelY}" text-anchor="middle" font-family="Space Mono, monospace" font-size="10" fill="#5A6478">${fmtDateShort(d)}</text>`;
    }
  });
  return out;
}

// Wire hover tooltip onto svg elements; htmlFor(el) builds the tooltip content
function attachTip(svg, selector, tipId, htmlFor) {
  const tip = document.getElementById(tipId);
  svg.querySelectorAll(selector).forEach(el => {
    el.addEventListener('mouseenter', () => {
      tip.style.display = 'block';
      tip.innerHTML = htmlFor(el);
    });
    el.addEventListener('mousemove', e => {
      tip.style.left = (e.clientX + 12) + 'px';
      tip.style.top = (e.clientY - 10) + 'px';
    });
    el.addEventListener('mouseleave', () => tip.style.display = 'none');
  });
}

// Nudge right-edge value labels apart so they never overlap
function spreadEndLabels(ends, minGap = 13) {
  ends.sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].ly - ends[i - 1].ly < minGap) ends[i].ly = ends[i - 1].ly + minGap;
  }
  return ends;
}

function avg3Month(history) {
  const s = history.slice(0,3);
  return s.reduce((a,h) => a+h.rate, 0) / s.length;
}

function avg3MonthTooltip(history) {
  return history.slice(0,3).map(h => `${fmtDate(h.date)}: ${fmtRate(h.rate)}`).join(' · ');
}

function avg3Change(history) {
  if (history.length < 4) return undefined;
  const curr = (history[0].rate+history[1].rate+history[2].rate)/3;
  const prev = (history[1].rate+history[2].rate+history[3].rate)/3;
  return +(curr-prev).toFixed(2);
}

function applicableRate(history, i) {
  const s = history.slice(i,i+3);
  if (s.length < 3) return null;
  return s.reduce((a,h) => a+h.rate, 0)/s.length;
}

function trendChip(curr, prev) {
  if (prev === undefined) return '';
  const diff = +(curr-prev).toFixed(2);
  if (diff > 0) return `<span class="trend-chip up">▲ ${diff.toFixed(2)}</span>`;
  if (diff < 0) return `<span class="trend-chip down">▼ ${Math.abs(diff).toFixed(2)}</span>`;
  return `<span class="trend-chip flat">— 0.00</span>`;
}

/* ---- Sort ---- */
function cycleSortDir(col) {
  if (sortState.col !== col) { sortState = { col, dir: 'desc' }; }
  else if (sortState.dir === 'desc') { sortState = { col, dir: 'asc' }; }
  else { sortState = { col: null, dir: null }; }
}

function sortItems(items) {
  if (!sortState.col) return [...items].sort((a,b) => a.name.localeCompare(b.name));
  if (sortState.col === 'name') {
    return [...items].sort((a,b) => sortState.dir === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
  }
  return [...items].sort((a,b) => {
    const va = sortState.col === 'avg3' ? avg3Month(a.history) : a.history[0].rate;
    const vb = sortState.col === 'avg3' ? avg3Month(b.history) : b.history[0].rate;
    return sortState.dir === 'desc' ? vb - va : va - vb;
  });
}

function sortArrow(col) {
  if (sortState.col !== col) return '<span class="sort-arrow">↕</span>';
  return `<span class="sort-arrow">${sortState.dir === 'desc' ? '↓' : '↑'}</span>`;
}

function baseRateTheadHTML() {
  return `
    <th class="sortable-th${sortState.col==='name'?' sort-active':''}" data-sort="name">Institution ${sortArrow('name')}</th>
    <th class="num sortable-th${sortState.col==='rate'?' sort-active':''}" data-sort="rate">Base Rate ${sortArrow('rate')}</th>
    <th class="num sortable-th${sortState.col==='avg3'?' sort-active':''}" data-sort="avg3">3M Avg Rate ${sortArrow('avg3')}</th>
    <th></th>`;
}

function spreadTheadHTML() {
  return `
    <th class="sortable-th${sortState.col==='name'?' sort-active':''}" data-sort="name">Institution ${sortArrow('name')}</th>
    <th class="num sortable-th${sortState.col==='rate'?' sort-active':''}" data-sort="rate">Interest Spread ${sortArrow('rate')}</th>
    <th class="num">12M Range</th>
    <th></th>`;
}

function attachSortHandlers(category) {
  const thead = document.getElementById('thead-' + category);
  if (!thead) return;
  thead.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      cycleSortDir(th.dataset.sort);
      if (currentIndicator === 'interest_spread') renderSpreadList(category);
      else renderList(category);
    });
  });
}

/* ---- Render base rate list ---- */
function renderList(category) {
  const items = sortItems(DATA[category]);
  const tbody = document.getElementById('tbody-' + category);
  const cards = document.getElementById('cards-' + category);
  tbody.innerHTML = '';
  cards.innerHTML = '';
  const theadRow = document.getElementById('thead-' + category);
  if (theadRow) theadRow.innerHTML = baseRateTheadHTML();
  attachSortHandlers(category);

  items.forEach(inst => {
    const curr = inst.history[0];
    const prev = inst.history[1];
    const chip = trendChip(curr.rate, prev ? prev.rate : undefined);
    const avg3 = avg3Month(inst.history);
    const avg3Tip = avg3MonthTooltip(inst.history);
    const avgChg = avg3Change(inst.history);
    const avgChip = trendChip(avg3, avgChg !== undefined ? avg3 - avgChg : undefined);
    const isPending = GLOBAL_LATEST_DATE && curr.date < GLOBAL_LATEST_DATE;
    const pendingBadge = isPending ? `<span class="pending-badge" title="No rate reported yet for ${fmtDate(GLOBAL_LATEST_DATE)}">Pending update</span>` : '';

    const tr = document.createElement('tr');
    tr.dataset.name = inst.name.toLowerCase();
    tr.innerHTML = `
      <td><div class="inst-name">${inst.name}${pendingBadge}</div></td>
      <td class="num">
        <div><span class="rate-value">${fmtRate(curr.rate)}</span>${chip}</div>
        <div class="rate-date" style="margin-top:4px">${fmtDate(curr.date)}</div>
      </td>
      <td class="num">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:12px">
          <div><span class="rate-value" style="font-size:16px" title="${avg3Tip}">${fmtRate(avg3)}</span>${avgChip}</div>
          <div style="font-family:'Space Mono',monospace;font-size:11px;color:var(--slate);line-height:1.9">${inst.history.slice(0,3).map(h=>`<div style="display:flex;justify-content:space-between;gap:10px"><span>${fmtDateShort(h.date)}</span><span>${h.rate.toFixed(2)}</span></div>`).join('')}</div>
        </div>
      </td>
      <td style="text-align:right"><button class="history-btn" data-cat="${category}" data-id="${inst.id}">View History</button></td>
    `;
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'rate-card';
    card.dataset.name = inst.name.toLowerCase();
    card.innerHTML = `
      <div class="rate-card-top">
        <div class="inst-name">${inst.name}${pendingBadge}</div>
        <button class="history-btn" data-cat="${category}" data-id="${inst.id}">History</button>
      </div>
      <div style="display:flex;gap:20px;margin-top:10px;flex-wrap:wrap">
        <div>
          <div class="rate-date" style="margin-bottom:4px">Base Rate</div>
          <div><span class="rate-value">${fmtRate(curr.rate)}</span>${chip}</div>
          <div class="rate-date" style="margin-top:3px">${fmtDate(curr.date)}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:20px">
          <div class="rate-date" style="margin-bottom:4px">3M Avg</div>
          <div><span class="rate-value" style="font-size:16px" title="${avg3Tip}">${fmtRate(avg3)}</span>${avgChip}</div>
          <div class="rate-date" style="margin-top:3px">${fmtDateShort(inst.history[2]?.date||inst.history[0].date)}–${fmtDateShort(inst.history[0].date)}</div>
        </div>
      </div>
    `;
    cards.appendChild(card);
  });

  document.getElementById('count-' + category).textContent = items.length;
}

/* ---- Render spread list ---- */
function renderSpreadList(category) {
  const source = SPREAD_DATA ? SPREAD_DATA[category] : null;
  const tbody = document.getElementById('tbody-' + category);
  const cards = document.getElementById('cards-' + category);
  const theadRow = document.getElementById('thead-' + category);
  tbody.innerHTML = '';
  cards.innerHTML = '';

  if (theadRow) theadRow.innerHTML = spreadTheadHTML();
  attachSortHandlers(category);

  if (!source || source.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:40px;text-align:center;color:var(--slate);font-size:14px">No interest spread data available for this category</td></tr>`;
    document.getElementById('count-' + category).textContent = 0;
    return;
  }

  const items = sortItems(source);
  items.forEach(inst => {
    const curr = inst.history[0];
    const prev = inst.history[1];
    const chip = trendChip(curr.rate, prev ? prev.rate : undefined);
    const last12 = inst.history.slice(0, Math.min(12, inst.history.length));
    const rates12 = last12.map(h => h.rate);
    const minR = Math.min(...rates12).toFixed(2);
    const maxR = Math.max(...rates12).toFixed(2);

    const tr = document.createElement('tr');
    tr.dataset.name = inst.name.toLowerCase();
    tr.innerHTML = `
      <td><div class="inst-name">${inst.name}</div></td>
      <td class="num">
        <div><span class="rate-value">${fmtRate(curr.rate)}</span>${chip}</div>
        <div class="rate-date" style="margin-top:4px">${fmtDate(curr.date)}</div>
      </td>
      <td class="num">
        <div style="font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:var(--ink)">${minR}–${maxR}%</div>
        <div class="rate-date" style="margin-top:2px">last ${last12.length} months</div>
      </td>
      <td style="text-align:right"><button class="history-btn" data-cat="${category}" data-id="${inst.id}">View History</button></td>
    `;
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'rate-card';
    card.dataset.name = inst.name.toLowerCase();
    card.innerHTML = `
      <div class="rate-card-top">
        <div class="inst-name">${inst.name}</div>
        <button class="history-btn" data-cat="${category}" data-id="${inst.id}">History</button>
      </div>
      <div style="display:flex;gap:20px;margin-top:10px">
        <div>
          <div class="rate-date" style="margin-bottom:4px">Interest Spread</div>
          <div><span class="rate-value">${fmtRate(curr.rate)}</span>${chip}</div>
          <div class="rate-date" style="margin-top:3px">${fmtDate(curr.date)}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:20px">
          <div class="rate-date" style="margin-bottom:4px">12M Range</div>
          <div style="font-family:'Space Mono',monospace;font-size:14px;font-weight:700">${minR}–${maxR}%</div>
        </div>
      </div>
    `;
    cards.appendChild(card);
  });

  document.getElementById('count-' + category).textContent = items.length;
}

/* ---- Dashboard ---- */
function renderDashboard() {
  if (!DATA) return;
  renderDashboardStats();
  renderBeeswarm();
  renderDeviationChart(currentDevCat);
  renderIRC();
  renderScatter(currentScatCat);
  renderTrend();
}

/* ---- Base rate trend: category averages over time ---- */
function renderTrend() {
  const svg = document.getElementById('trendChart');
  const cats = ['commercial_banks', 'development_banks', 'finance_companies'];
  const DASHES = { commercial_banks: '', development_banks: '7,4', finance_companies: '2,3' };

  const byCat = {}, dateSet = new Set();
  cats.forEach(cat => {
    const m = {};
    DATA[cat].forEach(inst => inst.history.forEach(h => { (m[h.date] = m[h.date] || []).push(h.rate); }));
    byCat[cat] = m;
    Object.keys(m).forEach(d => dateSet.add(d));
  });
  const dates = [...dateSet].sort().slice(-12);
  if (!dates.length) return;

  const series = cats.map(cat => ({
    cat,
    total: DATA[cat].length,
    cnt: dates.map(d => (byCat[cat][d] || []).length),
    vals: dates.map(d => {
      const arr = byCat[cat][d];
      return arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    })
  }));

  const lastIdx = dates.length - 1;
  const anyPartial = series.some(s => s.vals[lastIdx] != null && s.cnt[lastIdx] < s.total);
  document.getElementById('trendSub').textContent =
    `Category averages · ${fmtDateShort(dates[0])} – ${fmtDateShort(dates[lastIdx])}` +
    (anyPartial ? ' · latest month provisional' : '');

  const W = chartWidth(svg);
  const H = 300, padL = 40, padR = 44, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const allVals = series.flatMap(s => s.vals.filter(v => v != null));
  let min = Math.min(...allVals), max = Math.max(...allVals);
  const span = (max - min) || 1;
  min -= span * 0.1; max += span * 0.1;

  const x = i => padL + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = v => padT + (1 - (v - min) / (max - min)) * plotH;

  const grid = yGrid(y, min, max, padL, W - padR);
  const xLabels = xDateLabels(dates, x, H - 8);

  let lines = '';
  series.forEach(s => {
    const provisional = s.vals[lastIdx] != null && s.cnt[lastIdx] < s.total;
    const stopAt = provisional ? lastIdx - 1 : lastIdx;
    let d = '', pen = false;
    for (let i = 0; i <= stopAt; i++) {
      const v = s.vals[i];
      if (v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    lines += `<path d="${d}" fill="none" stroke="${CAT_COLORS[s.cat]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${DASHES[s.cat] ? ` stroke-dasharray="${DASHES[s.cat]}"` : ''}/>`;

    if (provisional) {
      let pi = lastIdx - 1;
      while (pi >= 0 && s.vals[pi] == null) pi--;
      if (pi >= 0) {
        lines += `<path d="M${x(pi).toFixed(1)},${y(s.vals[pi]).toFixed(1)} L${x(lastIdx).toFixed(1)},${y(s.vals[lastIdx]).toFixed(1)}" fill="none" stroke="${CAT_COLORS[s.cat]}" stroke-width="2" stroke-opacity="0.45" stroke-dasharray="3,4" stroke-linecap="round"/>`;
      }
      lines += `<circle cx="${x(lastIdx).toFixed(1)}" cy="${y(s.vals[lastIdx]).toFixed(1)}" r="3.5" fill="#fff" stroke="${CAT_COLORS[s.cat]}" stroke-width="2"/>`;
    }
  });

  // Latest value label at the right end of each line
  const ends = series.map(s => {
    for (let i = s.vals.length - 1; i >= 0; i--) if (s.vals[i] != null) return { v: s.vals[i], i, color: CAT_COLORS[s.cat] };
    return null;
  }).filter(Boolean);
  ends.forEach(e => e.ly = y(e.v));
  spreadEndLabels(ends);
  const endLabels = ends.map(e =>
    `<text x="${(x(e.i) + 6).toFixed(1)}" y="${(e.ly + 3.5).toFixed(1)}" font-family="Space Mono, monospace" font-size="10.5" font-weight="700" fill="${e.color}">${e.v.toFixed(2)}</text>`
  ).join('');

  // Hover strips: one per date, tooltip shows all category averages
  let hovers = '';
  const halfW = dates.length === 1 ? plotW / 2 : plotW / (dates.length - 1) / 2;
  dates.forEach((d, i) => {
    const x0 = Math.max(padL, x(i) - halfW);
    const x1 = Math.min(padL + plotW, x(i) + halfW);
    hovers += `<rect class="tr-hover" data-idx="${i}" x="${x0.toFixed(1)}" y="${padT}" width="${(x1 - x0).toFixed(1)}" height="${plotH}" fill="transparent"/>`;
  });

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.innerHTML = grid + lines + xLabels + endLabels + hovers;

  const SHORT = { commercial_banks: 'CB', development_banks: 'DB', finance_companies: 'FC' };
  attachTip(svg, '.tr-hover', 'trendTip', el => {
    const i = parseInt(el.dataset.idx);
    const rows = series.map(s => s.vals[i] == null ? '' :
      `<span style="color:${CAT_COLORS[s.cat]}">●</span> ${SHORT[s.cat]} ${s.vals[i].toFixed(2)}%` +
      (s.cnt[i] < s.total ? ` <span style="opacity:0.65">(${s.cnt[i]}/${s.total} reported)</span>` : '')).filter(Boolean).join('<br>');
    return `<b>${fmtDate(dates[i])}</b><br>${rows}`;
  });
}

/* ---- Base Rate vs Spread scatter ---- */
function renderScatter(scatCat) {
  currentScatCat = scatCat;
  const catKey = DEV_CAT_MAP[scatCat];

  document.querySelectorAll('[data-scatcat]').forEach(b => {
    const k = DEV_CAT_MAP[b.dataset.scatcat];
    b.disabled = !(SPREAD_DATA && SPREAD_DATA[k] && SPREAD_DATA[k].length);
    b.className = 'dash-cat-pill' + (b.dataset.scatcat === scatCat ? ' active-' + scatCat : '');
  });

  const svg = document.getElementById('scatterChart');
  const subEl = document.getElementById('scatterSub');
  const base = DATA[catKey] || [];
  const spread = (SPREAD_DATA && SPREAD_DATA[catKey]) || [];

  const pts = [];
  const unmatched = [];
  base.forEach(b => {
    const s = spread.find(v => v.id === b.id) || spread.find(v => v.name === b.name);
    if (s) pts.push({ name: b.name, bx: b.history[0].rate, sy: s.history[0].rate });
    else unmatched.push(b.name);
  });
  if (spread.length && unmatched.length) console.warn('Scatter: no spread data matched for:', unmatched.join(', '));

  if (!pts.length) {
    subEl.textContent = 'No spread data for this category yet';
    svg.setAttribute('viewBox', '0 0 400 120');
    svg.setAttribute('height', 120);
    svg.innerHTML = '<text x="200" y="60" text-anchor="middle" font-size="12" fill="#5A6478">No spread data available</text>';
    return;
  }

  const avgX = pts.reduce((s, p) => s + p.bx, 0) / pts.length;
  const avgY = pts.reduce((s, p) => s + p.sy, 0) / pts.length;
  subEl.textContent = `${CATEGORY_LABELS[catKey]}s · ${pts.length} BFIs · ${fmtDate(GLOBAL_LATEST_DATE)}`;

  const W = chartWidth(svg);
  const H = 300, padL = 42, padR = 16, padT = 16, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const xsArr = pts.map(p => p.bx), ysArr = pts.map(p => p.sy);
  let xMin = Math.min(...xsArr), xMax = Math.max(...xsArr), yMin = Math.min(...ysArr), yMax = Math.max(...ysArr);
  const xPad = ((xMax - xMin) || 1) * 0.12, yPad = ((yMax - yMin) || 1) * 0.15;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

  const x = v => padL + (v - xMin) / (xMax - xMin) * plotW;
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  let grid = yGrid(y, yMin, yMax, padL, W - padR);
  for (let t = 0; t <= 4; t++) {
    const vx = xMin + (xMax - xMin) * t / 4;
    grid += `<text x="${x(vx).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-family="Space Mono, monospace" font-size="10" fill="#5A6478">${vx.toFixed(1)}</text>`;
  }
  grid += `<text x="${(padL + plotW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#5A6478">Base rate %</text>`;
  grid += `<text x="12" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5A6478" transform="rotate(-90 12 ${(padT + plotH / 2).toFixed(1)})">Spread %</text>`;

  // Category-average crosshairs → four quadrants relative to peers
  const cross =
    `<line x1="${x(avgX).toFixed(1)}" x2="${x(avgX).toFixed(1)}" y1="${padT}" y2="${padT + plotH}" stroke="#1B2A4A" stroke-width="1" stroke-dasharray="4,3" opacity="0.3"/>` +
    `<line x1="${padL}" x2="${padL + plotW}" y1="${y(avgY).toFixed(1)}" y2="${y(avgY).toFixed(1)}" stroke="#1B2A4A" stroke-width="1" stroke-dasharray="4,3" opacity="0.3"/>` +
    `<text x="${(x(avgX) + 4).toFixed(1)}" y="${padT + 10}" font-family="Space Mono, monospace" font-size="9" fill="#5A6478">avg ${avgX.toFixed(2)}</text>` +
    `<text x="${(padL + plotW - 2).toFixed(1)}" y="${(y(avgY) - 4).toFixed(1)}" text-anchor="end" font-family="Space Mono, monospace" font-size="9" fill="#5A6478">avg ${avgY.toFixed(2)}</text>`;

  const color = CAT_COLORS[catKey];
  let dotsHtml = '', hovers = '';
  pts.forEach((p, i) => {
    dotsHtml += `<circle cx="${x(p.bx).toFixed(1)}" cy="${y(p.sy).toFixed(1)}" r="5.5" fill="${color}" fill-opacity="0.8" stroke="#fff" stroke-width="1.5"/>`;
    hovers += `<circle class="sc-hover" data-idx="${i}" cx="${x(p.bx).toFixed(1)}" cy="${y(p.sy).toFixed(1)}" r="11" fill="transparent" style="cursor:pointer"/>`;
  });

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.innerHTML = grid + cross + dotsHtml + hovers;

  attachTip(svg, '.sc-hover', 'scatTip', el => {
    const p = pts[parseInt(el.dataset.idx)];
    return `<b>${p.name}</b><br>Base rate ${p.bx.toFixed(2)}% · Spread ${p.sy.toFixed(2)}%`;
  });
}

/* ---- Interest Rate Corridor chart ---- */
function renderIRC() {
  const svg = document.getElementById('ircChart');
  const emptyEl = document.getElementById('ircEmpty');
  const legend = document.getElementById('ircLegend');

  if (!IRC_DATA.length) {
    svg.style.display = 'none';
    legend.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  svg.style.display = 'block';
  legend.style.display = 'flex';
  emptyEl.style.display = 'none';

  const data = [...IRC_DATA].sort((a, b) => a.date.localeCompare(b.date));

  // Find when the current corridor took effect (last entry whose values differ from the previous one)
  let effIdx = 0;
  for (let i = data.length - 1; i > 0; i--) {
    const a = data[i], b = data[i - 1];
    if (a.upper !== b.upper || a.policy !== b.policy || a.lower !== b.lower) { effIdx = i; break; }
  }
  document.getElementById('ircSub').textContent =
    `NRB policy rates · in effect since ${fmtDate(data[effIdx].date)}`;

  const hasIB = data.some(d => d.interbank != null);
  document.querySelector('#ircLegend .dash-leg:last-child').style.display = hasIB ? 'flex' : 'none';

  const W = chartWidth(svg);
  const H = 300, padL = 38, padR = 44, padT = 14, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const vals = data.flatMap(d => [d.upper, d.policy, d.lower, ...(d.interbank != null ? [d.interbank] : [])]);
  let min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  min -= span * 0.15; max += span * 0.15;

  const x = i => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = v => padT + (1 - (v - min) / (max - min)) * plotH;

  // Step interpolation: a rate holds until revised, then jumps
  const stepPts = key => {
    const pts = [];
    data.forEach((d, i) => {
      if (i) pts.push([x(i), y(data[i - 1][key])]);
      pts.push([x(i), y(d[key])]);
    });
    return pts;
  };
  const toPath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const path = key => toPath(stepPts(key));

  // Shaded corridor band between ceiling and floor (stepped)
  const band = toPath(stepPts('upper')) +
    ' L' + stepPts('lower').reverse().map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L') + ' Z';

  // Revision markers: vertical line + new values wherever the corridor changed
  let changeMarks = '';
  const KEY_COLORS = { upper: '#B8533E', policy: '#C9A961', lower: '#4A7C59' };
  for (let i = 1; i < data.length; i++) {
    const changed = ['upper', 'policy', 'lower'].filter(k => data[i][k] !== data[i - 1][k]);
    if (!changed.length) continue;
    const cx = x(i).toFixed(1);
    changeMarks += `<line x1="${cx}" x2="${cx}" y1="${padT}" y2="${H - padB}" stroke="#5A6478" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>`;
    changeMarks += `<text x="${+cx + 4}" y="${padT + 9}" font-family="Space Mono, monospace" font-size="9" fill="#5A6478">${fmtDateShort(data[i].date)}</text>`;
    changed.forEach(k => {
      // Label mid-jump: old value → new value
      const midY = (y(data[i - 1][k]) + y(data[i][k])) / 2;
      changeMarks += `<text x="${+cx + 4}" y="${(midY + 3.5).toFixed(1)}" font-family="Space Mono, monospace" font-size="9.5" font-weight="700" fill="${KEY_COLORS[k]}">${data[i - 1][k].toFixed(2)} → ${data[i][k].toFixed(2)}</text>`;
    });
  }

  const grid = yGrid(y, min, max, padL, W - padR);
  const xLabels = xDateLabels(data.map(d => d.date), x, H - 8);

  const lines =
    `<path d="${band}" fill="#C9A961" fill-opacity="0.10"/>` +
    `<path d="${path('upper')}" fill="none" stroke="#B8533E" stroke-width="2"/>` +
    `<path d="${path('lower')}" fill="none" stroke="#4A7C59" stroke-width="2"/>` +
    `<path d="${path('policy')}" fill="none" stroke="#C9A961" stroke-width="2.2" stroke-dasharray="5,4"/>` +
    (hasIB ? `<path d="${path('interbank')}" fill="none" stroke="#3B6FDB" stroke-width="2"/>` : '');

  // Rate labels at the right end of each line (nudged apart if they'd overlap)
  const last = data[data.length - 1];
  const ends = [
    { v: last.upper, color: '#B8533E' },
    { v: last.policy, color: '#C9A961' },
    { v: last.lower, color: '#4A7C59' },
    ...(hasIB && last.interbank != null ? [{ v: last.interbank, color: '#3B6FDB' }] : [])
  ];
  ends.forEach(e => e.ly = y(e.v));
  spreadEndLabels(ends);
  const endX = x(data.length - 1) + 6;
  const endLabels = ends.map(e =>
    `<text x="${endX.toFixed(1)}" y="${(e.ly + 3.5).toFixed(1)}" text-anchor="start" font-family="Space Mono, monospace" font-size="10.5" font-weight="700" fill="${e.color}">${e.v.toFixed(2)}</text>`
  ).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.innerHTML = grid + lines + changeMarks + xLabels + endLabels;
}

function renderDashboardStats() {
  const avg = arr => arr.reduce((s,v) => s+v, 0) / arr.length;
  const cats = ['commercial_banks','development_banks','finance_companies'];
  const SHORT = { commercial_banks: 'CB', development_banks: 'DB', finance_companies: 'FC' };

  const deltaHTML = d => {
    if (d == null) return '';
    if (Math.abs(d) < 0.005) return `<span class="stat-delta" style="color:var(--slate)">±0.00</span>`;
    const up = d > 0;
    return `<span class="stat-delta" style="color:${up ? 'var(--up)' : 'var(--down)'}">${up ? '▲' : '▼'}${Math.abs(d).toFixed(2)}</span>`;
  };

  // Category averages with month-over-month delta
  cats.forEach(cat => {
    const curr = avg(DATA[cat].map(i => i.history[0].rate));
    const prevArr = DATA[cat].filter(i => i.history[1]).map(i => i.history[1].rate);
    const prev = prevArr.length ? avg(prevArr) : null;
    document.getElementById('stat' + SHORT[cat] + 'Avg').innerHTML =
      curr.toFixed(2) + '%' + (prev != null ? deltaHTML(curr - prev) : '');
  });

  // Breadth: how many BFIs cut / raised / held vs their previous month
  let cut = 0, raised = 0, flat = 0;
  cats.forEach(cat => {
    DATA[cat].forEach(i => {
      if (!i.history[1]) return;
      const d = i.history[0].rate - i.history[1].rate;
      if (d < -0.001) cut++;
      else if (d > 0.001) raised++;
      else flat++;
    });
  });
  document.getElementById('statMoves').innerHTML =
    `<span style="color:var(--down)">▼${cut}</span> <span style="color:var(--up)">▲${raised}</span>`;
  document.getElementById('statMovesSub').textContent = `cut / raised · ${flat} unchanged`;

  // Average interest spread with month-over-month delta (categories with data)
  const spreadCats = cats.filter(c => SPREAD_DATA && SPREAD_DATA[c] && SPREAD_DATA[c].length);
  if (spreadCats.length) {
    const currAll = [], prevAll = [];
    spreadCats.forEach(c => SPREAD_DATA[c].forEach(i => {
      currAll.push(i.history[0].rate);
      if (i.history[1]) prevAll.push(i.history[1].rate);
    }));
    const sc = avg(currAll), sp = prevAll.length ? avg(prevAll) : null;
    document.getElementById('statSpread').innerHTML = sc.toFixed(2) + '%' + (sp != null ? deltaHTML(sc - sp) : '');
    document.getElementById('statSpreadSub').textContent = `avg spread · ${spreadCats.map(c => SHORT[c]).join(' & ')}`;
  }
}

function renderBeeswarm() {
  const svg = document.getElementById('beeswarmChart');
  const W = chartWidth(svg);
  const padL = 24, padR = 24, padT = 28, padB = 38;
  const plotW = W - padL - padR;
  const plotH = 140;
  const centerY = padT + plotH / 2;
  const r = 6;

  const allInsts = [];
  ['commercial_banks', 'development_banks', 'finance_companies'].forEach(cat => {
    DATA[cat].forEach(inst => {
      allInsts.push({ name: inst.name, rate: inst.history[0].rate, cat, color: CAT_COLORS[cat] });
    });
  });

  allInsts.sort((a, b) => a.rate - b.rate);

  const rates = allInsts.map(i => i.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const rateSpan = (maxRate - minRate) || 1;

  const xPos = rate => padL + ((rate - minRate) / rateSpan) * plotW;

  // Beeswarm collision avoidance
  const placed = [];
  const dots = allInsts.map(inst => {
    const x = xPos(inst.rate);
    let y = centerY;
    let found = false;
    for (let offset = 0; offset <= plotH / 2 - r - 2; offset += r * 2.3) {
      const candidates = offset === 0 ? [0] : [-offset, offset];
      for (const dy of candidates) {
        const tryY = centerY + dy;
        const ok = !placed.some(p => {
          const dx = p.x - x, ddy = p.y - tryY;
          return Math.sqrt(dx * dx + ddy * ddy) < r * 2.3;
        });
        if (ok) { y = tryY; found = true; break; }
      }
      if (found) break;
    }
    placed.push({ x, y });
    return { ...inst, x, y };
  });

  // X axis
  const axisY = padT + plotH + 6;
  let svgContent = `<line x1="${padL}" y1="${axisY}" x2="${padL + plotW}" y2="${axisY}" stroke="#E2DCCB" stroke-width="1"/>`;

  // X axis labels
  const labelCount = Math.min(7, Math.floor(plotW / 70));
  for (let i = 0; i < labelCount; i++) {
    const rate = minRate + (i / (labelCount - 1)) * rateSpan;
    const x = xPos(rate);
    const anchor = i === 0 ? 'start' : (i === labelCount - 1 ? 'end' : 'middle');
    svgContent += `<text x="${x.toFixed(1)}" y="${axisY + 18}" text-anchor="${anchor}" font-family="Space Mono, monospace" font-size="10.5" fill="#5A6478">${rate.toFixed(2)}%</text>`;
  }

  // Dots
  dots.forEach((d, idx) => {
    svgContent += `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${r}" fill="${d.color}" fill-opacity="0.82" stroke="#FAF7F0" stroke-width="1.5"/>`;
  });

  // Invisible hover targets
  dots.forEach((d, idx) => {
    svgContent += `<circle class="bs-hover" data-idx="${idx}" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="11" fill="transparent" style="cursor:pointer"/>`;
  });

  const totalH = padT + plotH + padB;
  svg.setAttribute('viewBox', `0 0 ${W} ${totalH}`);
  svg.setAttribute('height', totalH);
  svg.innerHTML = svgContent;

  document.getElementById('beeswarmSub').textContent = `${allInsts.length} BFIs · ${fmtDate(GLOBAL_LATEST_DATE)}`;

  attachTip(svg, '.bs-hover', 'bsTip', el => {
    const d = dots[parseInt(el.dataset.idx)];
    return `<b>${d.name}</b><br>${d.rate.toFixed(2)}%`;
  });
}

function renderDeviationChart(devCat) {
  currentDevCat = devCat;
  const catKey = DEV_CAT_MAP[devCat];
  const group = DATA[catKey];
  const avg = group.reduce((s, i) => s + i.history[0].rate, 0) / group.length;

  document.getElementById('dashAvgLabel').textContent =
    `${CATEGORY_LABELS[catKey]}s · avg ${avg.toFixed(2)}% · ${fmtDate(GLOBAL_LATEST_DATE)}`;

  const svg = document.getElementById('deviationChart');
  const W = chartWidth(svg);

  const sorted = [...group].sort((a, b) => a.history[0].rate - b.history[0].rate);
  const maxDev = Math.max(...sorted.map(i => Math.abs(i.history[0].rate - avg)));

  // Measure actual text widths to avoid overlap
  const _canvas = document.createElement('canvas');
  const _ctx = _canvas.getContext('2d');
  _ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const displayNames = sorted.map(i => i.name.length > 24 ? i.name.slice(0, 23) + '…' : i.name);
  const maxTextW = Math.max(...displayNames.map(n => _ctx.measureText(n).width));

  // Measure max label width so GAP always fits the widest outside label
  _ctx.font = '9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const maxLabelW = Math.ceil(Math.max(...sorted.map(i => {
    const d = i.history[0].rate - avg;
    return _ctx.measureText((d >= 0 ? '+' : '') + d.toFixed(2)).width;
  })));

  // Layout: [names | GAP | bar-left | center | bar-right | GAP]
  // GAP = label width + buffer so outside labels never crowd the name column
  const GAP = maxLabelW + 10;
  const nameW = Math.ceil(maxTextW) + 4;
  const halfBarMax = Math.max(40, Math.floor((W - nameW - GAP * 2) / 2));
  const centerX = nameW + GAP + halfBarMax;
  const svgW = nameW + GAP + halfBarMax * 2 + GAP;

  const BAR_H = 13, ROW_H = 21;
  const topPad = 34;

  let rowsHtml = '';
  let curY = topPad;

  sorted.forEach((inst, idx) => {
    const rate = inst.history[0].rate;
    const dev = rate - avg;
    const barW = maxDev > 0 ? (Math.abs(dev) / maxDev) * halfBarMax : 0;
    const color = dev >= 0 ? '#B8533E' : '#4A7C59';
    const barX = dev >= 0 ? centerX : centerX - barW;
    const sign = dev >= 0 ? '+' : '';
    const labelX = dev >= 0 ? centerX + barW + 4 : centerX - barW - 4;
    const anchor = dev >= 0 ? 'start' : 'end';

    rowsHtml += `<text x="${nameW}" y="${curY + BAR_H / 2 + 4}" text-anchor="end" font-size="10" fill="#1B2A4A">${displayNames[idx]}</text>`;
    rowsHtml += `<rect class="dev-bar" x="${barX.toFixed(1)}" y="${curY}" width="${Math.max(barW, 1.5).toFixed(1)}" height="${BAR_H}" rx="2" fill="${color}" fill-opacity="0.8" style="cursor:pointer" data-name="${inst.name}" data-rate="${rate.toFixed(2)}" data-dev="${sign}${dev.toFixed(2)}" data-avg="${avg.toFixed(2)}"/>`;
    rowsHtml += `<text x="${labelX.toFixed(1)}" y="${curY + BAR_H / 2 + 4}" text-anchor="${anchor}" font-size="9.5" fill="${color}" font-weight="600">${sign}${dev.toFixed(2)}</text>`;

    curY += ROW_H;
  });

  // Centre dashed line (behind rows, drawn first)
  const centreLine = `<line x1="${centerX}" y1="0" x2="${centerX}" y2="${curY}" stroke="#1B2A4A" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.18"/>`;

  // Avg badge at top of centre line (drawn last so it sits on top)
  const badgeLabel = avg.toFixed(2) + '%';
  const badgeW = badgeLabel.length * 7.2 + 18;
  const avgBadge = `
    <rect x="${(centerX - badgeW / 2).toFixed(1)}" y="3" width="${badgeW.toFixed(1)}" height="24" rx="6" fill="var(--ink)"/>
    <text x="${centerX}" y="19" text-anchor="middle" font-family="Space Mono, monospace" font-size="11" fill="#C9A961" font-weight="700">${badgeLabel}</text>`;

  svg.setAttribute('viewBox', `0 0 ${svgW} ${curY + 4}`);
  svg.setAttribute('height', curY + 4);
  svg.innerHTML = centreLine + rowsHtml + avgBadge;

  attachTip(svg, '.dev-bar', 'devTip', bar =>
    `<b>${bar.dataset.name}</b><br>${bar.dataset.rate}% &nbsp;·&nbsp; ${bar.dataset.dev} pp vs avg (${bar.dataset.avg}%)`);
}

/* ---- Spread chart ---- */
function drawSpreadChart(history, range) {
  const data = getRangeData(history, range);
  const container = document.getElementById('robinhoodChart');
  const W = 640, H = 280, padL = 8, padR = 8, padT = 16, padB = 30;

  const rates = data.map(d => d.rate);
  const minRate = Math.min(...rates), maxRate = Math.max(...rates);
  const meanRate = rates.reduce((a,b) => a+b, 0) / rates.length;
  const span = (maxRate - minRate) || 0.5;
  const yMin = minRate - span * 0.5;
  const yMax = maxRate + span * 0.5;

  const xPos = i => padL + (data.length === 1 ? (W-padL-padR)/2 : (i/(data.length-1))*(W-padL-padR));
  const yPos = v => padT + (1-(v-yMin)/(yMax-yMin))*(H-padT-padB);

  const bandTop = yPos(maxRate);
  const bandBot = yPos(minRate);
  const bandH = Math.max(bandBot - bandTop, 2);
  const meanY = yPos(meanRate);

  let path = '';
  data.forEach((d,i) => { path += (i===0?'M':'L') + xPos(i).toFixed(2) + ' ' + yPos(d.rate).toFixed(2) + ' '; });

  let dots = '';
  data.forEach((d,i) => { dots += `<circle class="spread-dot" cx="${xPos(i).toFixed(2)}" cy="${yPos(d.rate).toFixed(2)}" r="4" fill="var(--ink)" stroke="#FAF7F0" stroke-width="1.5"/>`; });

  let hoverDots = '';
  data.forEach((d,i) => { hoverDots += `<circle class="hover-dot" data-idx="${i}" cx="${xPos(i).toFixed(2)}" cy="${yPos(d.rate).toFixed(2)}" r="10" fill="transparent"/>`; });

  let xLabels = '';
  const labelCount = Math.min(6, data.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i/(labelCount-1||1))*(data.length-1));
    const d = data[idx];
    const anchor = i===0?'start':(i===labelCount-1?'end':'middle');
    xLabels += `<text x="${xPos(idx).toFixed(2)}" y="${H-8}" text-anchor="${anchor}" font-family="Space Mono, monospace" font-size="11" fill="#5A6478">${fmtDateShort(d.date)}</text>`;
  }

  const meanLabel = `<text x="${(W-padR).toFixed(2)}" y="${(meanY-5).toFixed(2)}" text-anchor="end" font-family="Space Mono, monospace" font-size="10" fill="#5A6478">avg ${meanRate.toFixed(2)}%</text>`;

  container.innerHTML = `
  <svg id="rhSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;cursor:crosshair" preserveAspectRatio="xMidYMid meet">
    <rect x="${padL}" y="${bandTop.toFixed(2)}" width="${W-padL-padR}" height="${bandH.toFixed(2)}" fill="rgba(79,110,247,0.07)" rx="2"/>
    <line x1="${padL}" y1="${meanY.toFixed(2)}" x2="${W-padR}" y2="${meanY.toFixed(2)}" stroke="#5A6478" stroke-width="1" stroke-dasharray="4,3"/>
    ${meanLabel}
    <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.2"/>
    ${dots}
    ${xLabels}
    <g id="crosshair" style="display:none">
      <line id="chLine" x1="0" y1="${padT}" x2="0" y2="${H-padB}" stroke="#5A6478" stroke-width="1" stroke-dasharray="3,3"/>
      <circle id="chDot" r="5" fill="var(--ink)" stroke="#FAF7F0" stroke-width="2"/>
    </g>
    ${hoverDots}
  </svg>`;

  const svg = document.getElementById('rhSvg');
  const crosshair = document.getElementById('crosshair');
  const chLine = document.getElementById('chLine');
  const chDot = document.getElementById('chDot');
  const priceEl = document.getElementById('chartPrice');
  const changeEl = document.getElementById('chartPriceChange');
  const hoverDateEl = document.getElementById('chartHoverDate');
  const latest = data[data.length-1];

  function setSpreadHeaderTo(point, isLive) {
    priceEl.textContent = fmtRate(point.rate);
    if (isLive) {
      changeEl.className = 'chart-price-change flat';
      changeEl.textContent = `Mean: ${meanRate.toFixed(2)}% · Range: ${minRate.toFixed(2)}–${maxRate.toFixed(2)}%`;
      hoverDateEl.textContent = '';
    } else {
      const diff = +(point.rate - latest.rate).toFixed(2);
      changeEl.className = 'chart-price-change ' + (diff>0?'pos':diff<0?'neg':'flat');
      changeEl.textContent = `${diff>=0?'+':''}${diff.toFixed(2)} pp vs latest`;
      hoverDateEl.textContent = fmtDate(point.date);
    }
  }
  setSpreadHeaderTo(latest, true);

  svg.querySelectorAll('.hover-dot').forEach(dot => {
    dot.addEventListener('mouseenter', () => {
      const idx = parseInt(dot.dataset.idx, 10);
      const point = data[idx];
      const px = xPos(idx), py = yPos(point.rate);
      chLine.setAttribute('x1',px); chLine.setAttribute('x2',px);
      chDot.setAttribute('cx',px); chDot.setAttribute('cy',py);
      crosshair.style.display = 'block';
      setSpreadHeaderTo(point, false);
    });
  });
  svg.addEventListener('mouseleave', () => { crosshair.style.display='none'; setSpreadHeaderTo(latest,true); });
}

/* ---- Robinhood-style line chart ---- */
let currentHistory = null;
let currentRange = 'all';

function getRangeData(history, range) {
  const chronological = [...history].reverse();
  if (range === 'all') return chronological;
  return chronological.slice(-parseInt(range, 10));
}

function drawRobinhoodChart(history, range) {
  const data = getRangeData(history, range);
  const container = document.getElementById('robinhoodChart');
  const W = 640, H = 280, padL = 8, padR = 8, padT = 16, padB = 30;

  const rates = data.map(d => d.rate);
  const min = Math.min(...rates), max = Math.max(...rates);
  const span = (max - min) || 0.5;
  const yMin = min - span * 0.18;
  const yMax = max + span * 0.18;

  const x = i => padL + (data.length===1?(W-padL-padR)/2:(i/(data.length-1))*(W-padL-padR));
  const y = v => padT + (1-(v-yMin)/(yMax-yMin))*(H-padT-padB);

  let path = '', area = '';
  data.forEach((d,i) => {
    const px = x(i), py = y(d.rate);
    path += (i===0?'M':'L') + px.toFixed(2) + ' ' + py.toFixed(2) + ' ';
    area += (i===0?'M'+px.toFixed(2)+' '+(H-padB)+' L':'L') + px.toFixed(2) + ' ' + py.toFixed(2) + ' ';
  });
  area += `L${x(data.length-1).toFixed(2)} ${H-padB} Z`;

  const gradColor = data[data.length-1].rate >= data[0].rate ? '#4A7C59' : '#B8533E';

  let xLabels = '';
  const labelCount = Math.min(6, data.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i/(labelCount-1||1))*(data.length-1));
    const anchor = i===0?'start':(i===labelCount-1?'end':'middle');
    xLabels += `<text x="${x(idx).toFixed(2)}" y="${H-8}" text-anchor="${anchor}" font-family="Space Mono, monospace" font-size="11" fill="#5A6478">${fmtDateShort(data[idx].date)}</text>`;
  }

  let hoverDots = '';
  data.forEach((d,i) => { hoverDots += `<circle class="hover-dot" data-idx="${i}" cx="${x(i).toFixed(2)}" cy="${y(d.rate).toFixed(2)}" r="10" fill="transparent"/>`; });

  container.innerHTML = `
  <svg id="rhSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;cursor:crosshair" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="rhGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${gradColor}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${gradColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#rhGrad)"/>
    <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${xLabels}
    <g id="crosshair" style="display:none">
      <line id="chLine" x1="0" y1="${padT}" x2="0" y2="${H-padB}" stroke="#5A6478" stroke-width="1" stroke-dasharray="3,3"/>
      <circle id="chDot" r="5" fill="var(--ink)" stroke="#FAF7F0" stroke-width="2"/>
    </g>
    ${hoverDots}
  </svg>`;

  const svg = document.getElementById('rhSvg');
  const crosshair = document.getElementById('crosshair');
  const chLine = document.getElementById('chLine');
  const chDot = document.getElementById('chDot');
  const priceEl = document.getElementById('chartPrice');
  const changeEl = document.getElementById('chartPriceChange');
  const hoverDateEl = document.getElementById('chartHoverDate');

  const latest = data[data.length-1];
  const earliest = data[0];

  function setHeaderTo(point, isLive) {
    priceEl.textContent = fmtRate(point.rate);
    const diff = +(point.rate - earliest.rate).toFixed(2);
    changeEl.className = 'chart-price-change ' + (diff>0?'pos':diff<0?'neg':'flat');
    changeEl.textContent = `${diff>0?'+':''}${diff.toFixed(2)} pp since ${fmtDate(earliest.date)}`;
    hoverDateEl.textContent = isLive ? '' : fmtDate(point.date);
  }
  setHeaderTo(latest, true);

  svg.querySelectorAll('.hover-dot').forEach(dot => {
    dot.addEventListener('mouseenter', () => {
      const idx = parseInt(dot.dataset.idx, 10);
      const point = data[idx];
      const px = x(idx), py = y(point.rate);
      chLine.setAttribute('x1',px); chLine.setAttribute('x2',px);
      chDot.setAttribute('cx',px); chDot.setAttribute('cy',py);
      crosshair.style.display = 'block';
      setHeaderTo(point, false);
    });
  });
  svg.addEventListener('mouseleave', () => { crosshair.style.display='none'; setHeaderTo(latest,true); });
}

function renderRangePills(history) {
  document.querySelectorAll('.range-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.range === currentRange);
    pill.onclick = () => {
      currentRange = pill.dataset.range;
      renderRangePills(history);
      if (currentIndicator === 'interest_spread') drawSpreadChart(history, currentRange);
      else drawRobinhoodChart(history, currentRange);
    };
  });
}

/* ---- Detail panel (base rate) ---- */
function renderDetailPanel(category, inst) {
  document.getElementById('histCategory').textContent = CATEGORY_LABELS[category];
  const curr = inst.history[0];
  const isPending = GLOBAL_LATEST_DATE && curr.date < GLOBAL_LATEST_DATE;
  document.getElementById('histName').innerHTML = inst.name + (isPending ? `<span class="pending-badge" title="No rate reported for ${fmtDate(GLOBAL_LATEST_DATE)}">Pending update</span>` : '');

  const last12 = inst.history.slice(0,12);
  const rates12 = last12.map(h => h.rate);
  const avg3 = avg3Month(inst.history);
  const avg3Tip = avg3MonthTooltip(inst.history);
  document.getElementById('chartExtraStats').innerHTML =
    `Applicable Rate: <b title="${avg3Tip}" style="cursor:help">${fmtRate(avg3)}</b> &nbsp;·&nbsp; 12-Mo Range: <b>${Math.min(...rates12).toFixed(2)}–${Math.max(...rates12).toFixed(2)}%</b>`;

  const entriesEl = document.getElementById('histEntries');
  entriesEl.innerHTML = '';

  const headerRow = document.createElement('div');
  headerRow.className = 'hist-entry hist-entry-header';
  headerRow.innerHTML = `
    <div class="he-date"></div>
    <div class="he-right">
      <div class="he-rate" style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--slate);font-weight:700">Base Rate</div>
      <div class="he-applicable" style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--slate);font-weight:700;background:none;border:none;padding:0;cursor:default">3M Avg</div>
    </div>`;
  entriesEl.appendChild(headerRow);

  inst.history.forEach((h,i) => {
    const appRate = applicableRate(inst.history, i);
    const row = document.createElement('div');
    row.className = 'hist-entry';
    row.innerHTML = `
      <div class="he-date">${fmtDate(h.date)}</div>
      <div class="he-right">
        <div class="he-rate">${fmtRate(h.rate)}</div>
        <div class="he-applicable" style="background:none;border:none;padding:0;color:var(--slate);cursor:default">${appRate !== null ? fmtRate(appRate) : '—'}</div>
      </div>`;
    entriesEl.appendChild(row);
  });

  currentHistory = inst.history;
  currentRange = 'all';
  renderRangePills(currentHistory);
  drawRobinhoodChart(currentHistory, currentRange);
}

/* ---- Detail panel (spread) ---- */
function renderSpreadDetailPanel(category, inst) {
  document.getElementById('histCategory').textContent = CATEGORY_LABELS[category] + ' — Interest Spread';
  document.getElementById('histName').innerHTML = inst.name;

  const last12 = inst.history.slice(0, Math.min(12, inst.history.length));
  const rates12 = last12.map(h => h.rate);
  const mean12 = (rates12.reduce((a,b) => a+b, 0) / rates12.length).toFixed(2);
  document.getElementById('chartExtraStats').innerHTML =
    `12M Mean: <b>${mean12}%</b> &nbsp;·&nbsp; Range: <b>${Math.min(...rates12).toFixed(2)}–${Math.max(...rates12).toFixed(2)}%</b>`;

  const entriesEl = document.getElementById('histEntries');
  entriesEl.innerHTML = '';

  const headerRow = document.createElement('div');
  headerRow.className = 'hist-entry hist-entry-header';
  headerRow.innerHTML = `
    <div class="he-date"></div>
    <div class="he-right">
      <div class="he-rate" style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--slate);font-weight:700">Spread</div>
    </div>`;
  entriesEl.appendChild(headerRow);

  inst.history.forEach(h => {
    const row = document.createElement('div');
    row.className = 'hist-entry';
    row.innerHTML = `
      <div class="he-date">${fmtDate(h.date)}</div>
      <div class="he-right"><div class="he-rate">${fmtRate(h.rate)}</div></div>`;
    entriesEl.appendChild(row);
  });

  currentHistory = inst.history;
  currentRange = 'all';
  renderRangePills(currentHistory);
  drawSpreadChart(currentHistory, currentRange);
}

/* ---- Institution selection ---- */
let activeCategory = 'commercial_banks';
let activeInstId = null;

function populateInstSelect(category, preserveSelection) {
  const select = document.getElementById('instSelect');
  const items = [...DATA[category]].sort((a,b) => a.name.localeCompare(b.name));
  select.innerHTML = items.map(inst => `<option value="${inst.id}">${inst.name}</option>`).join('');
  if (preserveSelection && items.some(i => i.id === activeInstId)) {
    select.value = activeInstId;
  } else {
    select.value = items[0].id;
  }
}

function selectInstitution(category, id) {
  const inst = DATA[category].find(x => x.id === id);
  if (!inst) return;
  activeCategory = category;
  activeInstId = id;

  document.getElementById('categorySelect').value = category;
  populateInstSelect(category, true);
  document.getElementById('instSelect').value = id;

  renderDetailPanel(category, inst);

  document.getElementById('listViews').style.display = 'none';
  document.getElementById('subNav').style.display = 'none';
  document.getElementById('historyView').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectSpreadInstitution(category, id) {
  const inst = SPREAD_DATA[category]?.find(x => x.id === id);
  if (!inst) return;
  activeCategory = category;
  activeInstId = id;

  document.getElementById('categorySelect').value = category;
  const select = document.getElementById('instSelect');
  const items = [...(SPREAD_DATA[category] || [])].sort((a,b) => a.name.localeCompare(b.name));
  select.innerHTML = items.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  select.value = id;

  renderSpreadDetailPanel(category, inst);

  document.getElementById('listViews').style.display = 'none';
  document.getElementById('subNav').style.display = 'none';
  document.getElementById('historyView').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showListViews() {
  document.getElementById('historyView').classList.remove('active');
  document.getElementById('listViews').style.display = 'block';
  document.getElementById('subNav').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---- Sub-nav category pills ---- */
function setActiveSubTab(tab) {
  sortState = { col: null, dir: null };
  activeSubTab = tab;
  document.querySelectorAll('.cat-pill-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === tab));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.toggle('active', v.dataset.tabView === tab));
}

/* ---- Page navigation ---- */
function navigateTo(page) {
  currentPage = page;

  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));

  const isDataPage = page === 'base_rate' || page === 'interest_spread';
  const isComingSoon = page === 'npl' || page === 'capital_adequacy';
  const histActive = document.getElementById('historyView').classList.contains('active');

  document.getElementById('pageDashboard').classList.toggle('active', page === 'dashboard');
  document.getElementById('pageData').classList.toggle('active', isDataPage);
  document.getElementById('pageComingSoon').classList.toggle('active', isComingSoon);

  // Sub-nav only visible on data pages when not in history view
  document.getElementById('subNav').style.display = (isDataPage && !histActive) ? '' : 'none';

  if (page === 'dashboard') {
    renderDashboard();
  } else if (isDataPage) {
    if (page !== currentIndicator) {
      currentIndicator = page;
      sortState = { col: null, dir: null };

      // Exit history view if open
      if (histActive) {
        document.getElementById('historyView').classList.remove('active');
        document.getElementById('listViews').style.display = 'block';
      }

      document.getElementById('subNav').style.display = '';

      const fcBtn = document.querySelector('[data-cat="finance_companies"]');

      if (page === 'interest_spread') {
        const hasFCSpread = !!(SPREAD_DATA && SPREAD_DATA.finance_companies && SPREAD_DATA.finance_companies.length);
        fcBtn.disabled = !hasFCSpread;
        if (!hasFCSpread && activeSubTab === 'finance_companies') setActiveSubTab('commercial_banks');
        document.getElementById('categorySelect').innerHTML = `
          <option value="commercial_banks">Commercial Banks</option>
          <option value="development_banks">Development Banks</option>` + (hasFCSpread ? `
          <option value="finance_companies">Finance Companies</option>` : '');
        document.getElementById('sub-commercial_banks').textContent = "'A' Class institutions — interest rate spread as published monthly";
        document.getElementById('sub-development_banks').textContent = "'B' Class institutions — interest rate spread as published monthly";
        document.getElementById('sub-finance_companies').textContent = "'C' Class institutions — interest rate spread as published monthly";
        ['commercial_banks','development_banks','finance_companies'].forEach(renderSpreadList);
      } else {
        fcBtn.disabled = false;
        document.getElementById('categorySelect').innerHTML = `
          <option value="commercial_banks">Commercial Banks</option>
          <option value="development_banks">Development Banks</option>
          <option value="finance_companies">Finance Companies</option>`;
        document.getElementById('sub-commercial_banks').textContent = "'A' Class institutions — base lending rate as published monthly";
        document.getElementById('sub-development_banks').textContent = "'B' Class institutions — base lending rate as published monthly";
        document.getElementById('sub-finance_companies').textContent = "'C' Class institutions — base lending rate as published monthly";
        ['commercial_banks','development_banks','finance_companies'].forEach(renderList);
      }
    } else {
      document.getElementById('subNav').style.display = histActive ? 'none' : '';
    }
  } else if (isComingSoon) {
    const labels = { npl: 'NPL (Non-Performing Loan) data', capital_adequacy: 'Capital Adequacy data' };
    document.getElementById('comingSoonTitle').textContent = page === 'npl' ? 'NPL' : 'Capital Adequacy';
    document.getElementById('comingSoonLabel').textContent = labels[page];
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---- Search ---- */
function applySearch(category, query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll(`#tbody-${category} tr`).forEach(row => {
    row.style.display = row.dataset.name.includes(q) ? '' : 'none';
  });
  document.querySelectorAll(`#cards-${category} .rate-card`).forEach(card => {
    card.style.display = card.dataset.name.includes(q) ? '' : 'none';
  });
}

function getMostRecentDate() {
  let latest = null;
  ['commercial_banks','development_banks','finance_companies'].forEach(cat => {
    DATA[cat].forEach(inst => {
      const d = inst.history[0].date;
      if (!latest || d > latest) latest = d;
    });
  });
  return latest;
}

/* ---- Init ---- */
function init() {
  GLOBAL_LATEST_DATE = getMostRecentDate();

  // Data freshness line on dashboard
  let pending = 0;
  ['commercial_banks','development_banks','finance_companies'].forEach(cat => {
    DATA[cat].forEach(inst => { if (inst.history[0].date < GLOBAL_LATEST_DATE) pending++; });
  });
  const asofHTML =
    `<span class="asof-dot${pending ? ' pending' : ''}"></span>` +
    `Data through ${fmtDate(GLOBAL_LATEST_DATE)}` +
    (pending ? ` · ${pending} BFI${pending > 1 ? 's' : ''} pending update` : '');
  document.getElementById('dataAsOf').innerHTML = asofHTML;
  document.getElementById('dataAsOfData').innerHTML = asofHTML;

  ['commercial_banks','development_banks','finance_companies'].forEach(renderList);

  // Nav links
  document.querySelectorAll('.nav-link:not(.coming-soon)').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Sub-nav category pills
  document.querySelectorAll('.cat-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) setActiveSubTab(btn.dataset.cat);
    });
  });

  // Search inputs
  document.querySelectorAll('[data-search]').forEach(input => {
    input.addEventListener('input', e => applySearch(input.dataset.search, e.target.value));
  });

  // View history buttons
  document.getElementById('listViews').addEventListener('click', e => {
    const btn = e.target.closest('.history-btn');
    if (btn) {
      if (currentIndicator === 'interest_spread') selectSpreadInstitution(btn.dataset.cat, btn.dataset.id);
      else selectInstitution(btn.dataset.cat, btn.dataset.id);
    }
  });

  document.getElementById('backBtn').addEventListener('click', showListViews);

  // History view dropdowns
  document.getElementById('categorySelect').addEventListener('change', e => {
    const category = e.target.value;
    if (currentIndicator === 'interest_spread') {
      const items = [...(SPREAD_DATA[category] || [])].sort((a,b) => a.name.localeCompare(b.name));
      const select = document.getElementById('instSelect');
      select.innerHTML = items.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
      if (items.length > 0) selectSpreadInstitution(category, select.value);
    } else {
      populateInstSelect(category, false);
      selectInstitution(category, document.getElementById('instSelect').value);
    }
  });

  document.getElementById('instSelect').addEventListener('change', e => {
    if (currentIndicator === 'interest_spread') selectSpreadInstitution(activeCategory, e.target.value);
    else selectInstitution(activeCategory, e.target.value);
  });

  // Dashboard deviation chart category pills
  document.querySelectorAll('[data-devcat]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDevCat = btn.dataset.devcat;
      document.querySelectorAll('[data-devcat]').forEach(b => b.className = 'dash-cat-pill');
      btn.classList.add('active-' + currentDevCat);
      renderDeviationChart(currentDevCat);
    });
  });

  // Dashboard scatter chart category pills
  document.querySelectorAll('[data-scatcat]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) renderScatter(btn.dataset.scatcat);
    });
  });

  // Render dashboard on load
  renderDashboard();
}

/* ---- Debounced re-render on resize (width changes only, so mobile
       address-bar show/hide doesn't trigger pointless redraws) ---- */
let _resizeTimer = null;
let _lastRenderW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (window.innerWidth === _lastRenderW || !DATA) return;
    _lastRenderW = window.innerWidth;

    if (currentPage === 'dashboard') {
      renderDashboard();
    } else if (document.getElementById('historyView').classList.contains('active') && activeInstId) {
      const source = currentIndicator === 'interest_spread' ? SPREAD_DATA : DATA;
      const inst = source[activeCategory]?.find(i => i.id === activeInstId);
      if (inst) {
        if (currentIndicator === 'interest_spread') renderSpreadDetailPanel(activeCategory, inst);
        else renderDetailPanel(activeCategory, inst);
      }
    }
  }, 150);
});

/* ---- Data fetch ---- */
Promise.all([
  fetch('data/base-rates.json').then(r => r.json()),
  fetch('data/interest-spread.json').then(r => r.json()),
  fetch('data/reference.json').then(r => r.json()).catch(() => ({}))
]).then(([baseData, spreadData, refData]) => {
  DATA = baseData;
  SPREAD_DATA = spreadData;
  IRC_DATA = refData.interest_rate_corridor || [];
  init();
}).catch(err => {
  document.querySelector('main').innerHTML = `<div class="empty-state">Could not load data. Make sure data files are present and the page is served over HTTP (not opened directly as a file).</div>`;
  console.error(err);
});

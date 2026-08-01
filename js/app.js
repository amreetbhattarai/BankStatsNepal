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

/* ---- URL routing: /base-rate-spread/{category}/ (and legacy routes) ---- */
const CATEGORY_SLUG = {
  commercial_banks: 'commercial-banks',
  development_banks: 'development-banks',
  finance_companies: 'finance-companies'
};
const SLUG_CATEGORY = Object.fromEntries(Object.entries(CATEGORY_SLUG).map(([k, v]) => [v, k]));

const INDICATOR_SLUG = { 
  base_rate: 'base-rate', 
  interest_spread: 'interest-spread', 
  base_rate_spread: 'base-rate-spread',
  quarterly_indicators: 'quarterly-indicators'
};
const SLUG_INDICATOR = Object.fromEntries(Object.entries(INDICATOR_SLUG).map(([k, v]) => [v, k]));

function getBasePath() {
  const parts = location.pathname.split('/').filter(Boolean);
  const indIndex = parts.findIndex(p => SLUG_INDICATOR[p]);
  if (indIndex > 0) {
    return '/' + parts.slice(0, indIndex).join('/') + '/';
  }
  return '/';
}

function urlForPage(page, category) {
  const base = getBasePath();
  if (page === 'base_rate' || page === 'interest_spread' || page === 'base_rate_spread' || page === 'quarterly_indicators') {
    const slug = INDICATOR_SLUG[page] || 'base-rate-spread';
    return `${base}${slug}/${CATEGORY_SLUG[category]}/`;
  }
  return base;
}

function parseLocationPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  const indIndex = parts.findIndex(p => SLUG_INDICATOR[p]);
  if (indIndex !== -1) {
    const p = SLUG_INDICATOR[parts[indIndex]];
    const norm = (p === 'base_rate' || p === 'interest_spread' || p === 'base_rate_spread') ? 'base_rate_spread' : p;
    const catSlug = parts[indIndex + 1];
    const category = (catSlug && SLUG_CATEGORY[catSlug]) ? SLUG_CATEGORY[catSlug] : 'commercial_banks';
    return { page: norm, category };
  }
  return { page: 'dashboard', category: 'commercial_banks' };
}

let DATA = null;
let SPREAD_DATA = null;
let QUARTERLY_DATA = null;
let GLOBAL_LATEST_DATE = null;

/* Interest Rate Corridor data — loaded from data/reference.json */
let IRC_DATA = [];

const _initialLoc = parseLocationPath();
let currentPage = _initialLoc.page;
let currentIndicator = 'base_rate_spread';
let activeHistoryIndicator = 'base_rate';
let currentDevCat = 'cb';
let currentScatCat = 'cb';
let activeSubTab = _initialLoc.category;
let activeQCat = _initialLoc.category || 'commercial_banks';
let activeQMetric = 'npl';
let activeQView = 'data';
let sortState = { col: null, dir: null };
let qSortState = { col: null, dir: null };
let qChartSortDir = 'desc'; // 'desc', 'asc', 'name'

const BS_MONTHS = ['Baisakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_MONTHS_SHORT = ['Bai','Jes','Asa','Shr','Bha','Asw','Kar','Man','Pou','Mag','Fal','Cha'];

function fmtDate(d) {
  if (!d) return '—';
  const parts = String(d).split('-');
  if (parts.length < 2) return d;
  const mIndex = parseInt(parts[1], 10) - 1;
  return `${BS_MONTHS[mIndex] || parts[1]} ${parts[0]}`;
}

function fmtDateShort(d) {
  if (!d) return '—';
  const parts = String(d).split('-');
  if (parts.length < 2) return d;
  const mIndex = parseInt(parts[1], 10) - 1;
  return `${BS_MONTHS_SHORT[mIndex] || parts[1]} ${parts[0].slice(2)}`;
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

function sortItems(category) {
  const baseItems = DATA[category] || [];
  const spreadItems = (SPREAD_DATA && SPREAD_DATA[category]) || [];

  const combined = baseItems.map(b => {
    const s = spreadItems.find(x => x.id === b.id) || spreadItems.find(x => x.name === b.name);
    return { base: b, spread: s, name: b.name, id: b.id };
  });

  if (!sortState.col) return combined.sort((a,b) => a.name.localeCompare(b.name));

  if (sortState.col === 'name') {
    return combined.sort((a,b) => sortState.dir === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
  }

  return combined.sort((a,b) => {
    let va, vb;
    if (sortState.col === 'rate') {
      va = (a.base.history && a.base.history[0]) ? a.base.history[0].rate : -999;
      vb = (b.base.history && b.base.history[0]) ? b.base.history[0].rate : -999;
    } else if (sortState.col === 'avg3') {
      va = avg3Month(a.base.history);
      vb = avg3Month(b.base.history);
    } else if (sortState.col === 'spread') {
      const aCurr = (a.base.history && a.base.history[0]) || {};
      const bCurr = (b.base.history && b.base.history[0]) || {};
      const aSMatch = a.spread && a.spread.history ? a.spread.history.find(h => h.date === aCurr.date) : null;
      const bSMatch = b.spread && b.spread.history ? b.spread.history.find(h => h.date === bCurr.date) : null;
      va = aSMatch ? aSMatch.rate : -999;
      vb = bSMatch ? bSMatch.rate : -999;
    }
    return sortState.dir === 'desc' ? vb - va : va - vb;
  });
}

function sortArrow(col) {
  if (sortState.col !== col) return '<span class="sort-arrow">↕</span>';
  return `<span class="sort-arrow">${sortState.dir === 'desc' ? '↓' : '↑'}</span>`;
}

function unifiedTheadHTML() {
  return `
    <th class="sortable-th${sortState.col==='name'?' sort-active':''}" data-sort="name">Institution ${sortArrow('name')}</th>
    <th class="num sortable-th${sortState.col==='rate'?' sort-active':''}" data-sort="rate">Base Rate ${sortArrow('rate')}</th>
    <th class="num sortable-th${sortState.col==='avg3'?' sort-active':''}" data-sort="avg3">3M Avg Rate ${sortArrow('avg3')}</th>
    <th class="num sortable-th${sortState.col==='spread'?' sort-active':''}" data-sort="spread">Spread Rate ${sortArrow('spread')}</th>
    <th></th>`;
}

function attachSortHandlers(category) {
  const thead = document.getElementById('thead-' + category);
  if (!thead) return;
  thead.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      cycleSortDir(th.dataset.sort);
      renderUnifiedList(category);
    });
  });
}

/* ---- Render unified rate list (Base Rate & Spread Rate) ---- */
function renderUnifiedList(category) {
  const items = sortItems(category);
  const tbody = document.getElementById('tbody-' + category);
  const cards = document.getElementById('cards-' + category);
  if (!tbody || !cards) return;
  tbody.innerHTML = '';
  cards.innerHTML = '';
  const theadRow = document.getElementById('thead-' + category);
  if (theadRow) theadRow.innerHTML = unifiedTheadHTML();
  attachSortHandlers(category);

  const catLatestDate = getLatestDateForCategory(category);
  items.forEach(item => {
    const inst = item.base;
    if (!inst || !inst.history || !inst.history.length) return;
    const spreadInst = item.spread;
    const curr = inst.history[0];
    const prev = inst.history[1];
    const chip = trendChip(curr.rate, prev ? prev.rate : undefined);
    const avg3 = avg3Month(inst.history);
    const avgChg = avg3Change(inst.history);
    const avgChip = avgChg !== undefined ? trendChip(avg3, avg3 - avgChg) : '';
    const isPending = Boolean(catLatestDate && curr.date < catLatestDate);
    const statusDot = isPending 
      ? `<span class="status-dot-indicator yellow" title="${fmtDate(catLatestDate)} pending — displaying ${fmtDate(curr.date)} disclosure"></span><span class="stale-month-badge">${fmtDate(curr.date)}</span>` 
      : `<span class="status-dot-indicator green" title="${fmtDate(catLatestDate)} disclosure up to date"></span>`;

    let spreadHTML = `<span style="color:var(--slate)">—</span>`;
    let cardSpreadHTML = `<span style="color:var(--slate)">—</span>`;
    if (spreadInst && spreadInst.history && spreadInst.history.length) {
      const sIndex = spreadInst.history.findIndex(h => h.date === curr.date);
      if (sIndex !== -1) {
        const sCurr = spreadInst.history[sIndex];
        const sPrev = spreadInst.history[sIndex + 1];
        const sChip = trendChip(sCurr.rate, sPrev ? sPrev.rate : undefined);
        spreadHTML = `<div><span class="rate-value" style="font-size:16px">${fmtRate(sCurr.rate)}</span>${sChip}</div>`;
        cardSpreadHTML = `<div><span class="rate-value" style="font-size:16px">${fmtRate(sCurr.rate)}</span>${sChip}</div>`;
      }
    }

    const tr = document.createElement('tr');
    tr.dataset.name = inst.name.toLowerCase();
    if (isPending) tr.className = 'stale-row';
    tr.innerHTML = `
      <td><div class="inst-name">${inst.name}${statusDot}</div></td>
      <td class="num">
        <div><span class="rate-value">${fmtRate(curr.rate)}</span>${chip}</div>
      </td>
      <td class="num">
        <div><span class="rate-value" style="font-size:16px">${fmtRate(avg3)}</span>${avgChip}</div>
      </td>
      <td class="num">${spreadHTML}</td>
      <td style="text-align:right"><button class="history-btn" data-cat="${category}" data-id="${inst.id}">View History</button></td>
    `;
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'rate-card' + (isPending ? ' stale-card' : '');
    card.dataset.name = inst.name.toLowerCase();
    card.innerHTML = `
      <div class="rate-card-top">
        <div class="inst-name">${inst.name}${statusDot}</div>
        <button class="history-btn" data-cat="${category}" data-id="${inst.id}">History</button>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
        <div>
          <div class="rate-date" style="margin-bottom:4px">Base Rate</div>
          <div><span class="rate-value" style="font-size:16px">${fmtRate(curr.rate)}</span>${chip}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:16px">
          <div class="rate-date" style="margin-bottom:4px">3M Avg</div>
          <div><span class="rate-value" style="font-size:16px">${fmtRate(avg3)}</span>${avgChip}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:16px">
          <div class="rate-date" style="margin-bottom:4px">Spread</div>
          ${cardSpreadHTML}
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
    if (s && s.history && s.history.length > 0 && b.history && b.history.length > 0) {
      pts.push({ name: b.name, bx: b.history[0].rate, sy: s.history[0].rate });
    } else {
      unmatched.push(b.name);
    }
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

  // Regime segments: a new segment starts wherever any corridor rate changes
  const KEYS = ['upper', 'policy', 'lower'];
  const KEY_COLORS = { upper: '#B8533E', policy: '#C9A961', lower: '#4A7C59' };
  const bounds = [0];
  for (let i = 1; i < data.length; i++) {
    if (KEYS.some(k => data[i][k] !== data[i - 1][k])) bounds.push(i);
  }
  bounds.push(data.length);

  let changeMarks = '';

  // Plateau value labels for past regimes (the current regime is labeled at the right edge)
  for (let s = 0; s < bounds.length - 2; s++) {
    const a = bounds[s], b = bounds[s + 1] - 1;
    if (x(b) - x(a) < 60) continue;
    const mx = ((x(a) + x(b)) / 2).toFixed(1);
    KEYS.forEach(k => {
      const v = data[a][k];
      const dy = k === 'lower' ? 13 : -5;
      changeMarks += `<text x="${mx}" y="${(y(v) + dy).toFixed(1)}" text-anchor="middle" font-family="Space Mono, monospace" font-size="9.5" font-weight="700" fill="${KEY_COLORS[k]}">${v.toFixed(2)}</text>`;
    });
  }

  // Revision line: month at top + direction chip (▲/▼ change) beside each jump
  for (let s = 1; s < bounds.length - 1; s++) {
    const i = bounds[s];
    const cx = x(i).toFixed(1);
    changeMarks += `<line x1="${cx}" x2="${cx}" y1="${padT}" y2="${H - padB}" stroke="#5A6478" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>`;
    changeMarks += `<text x="${+cx + 4}" y="${padT + 9}" font-family="Space Mono, monospace" font-size="9" fill="#5A6478">${fmtDateShort(data[i].date)}</text>`;
    KEYS.filter(k => data[i][k] !== data[i - 1][k]).forEach(k => {
      const oldV = data[i - 1][k], newV = data[i][k];
      const d = newV - oldV;
      const midY = (y(oldV) + y(newV)) / 2;
      const col = d > 0 ? '#B8533E' : '#4A7C59';
      // Pre-change rate, just left of the revision line at its old level
      const oldDy = d < 0 ? -4 : 11;
      changeMarks += `<text x="${+cx - 4}" y="${(y(oldV) + oldDy).toFixed(1)}" text-anchor="end" font-family="Space Mono, monospace" font-size="9" font-weight="700" fill="${KEY_COLORS[k]}" opacity="0.75">${oldV.toFixed(2)}</text>`;
      changeMarks += `<text x="${+cx + 4}" y="${(midY + 3.5).toFixed(1)}" font-family="Space Mono, monospace" font-size="9.5" font-weight="700" fill="${col}">${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(2)}</text>`;
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
    const validInsts = (DATA[cat] || []).filter(i => i.history && i.history.length > 0);
    if (!validInsts.length) return;
    const curr = avg(validInsts.map(i => i.history[0].rate));
    const prevArr = validInsts.filter(i => i.history[1]).map(i => i.history[1].rate);
    const prev = prevArr.length ? avg(prevArr) : null;
    const el = document.getElementById('stat' + SHORT[cat] + 'Avg');
    if (el) el.innerHTML = curr.toFixed(2) + '%' + (prev != null ? deltaHTML(curr - prev) : '');
  });

  // Breadth: how many BFIs cut / raised / held vs their previous month
  let cut = 0, raised = 0, flat = 0;
  cats.forEach(cat => {
    (DATA[cat] || []).forEach(i => {
      if (!i.history || i.history.length < 2) return;
      const d = i.history[0].rate - i.history[1].rate;
      if (d < -0.001) cut++;
      else if (d > 0.001) raised++;
      else flat++;
    });
  });
  const movesEl = document.getElementById('statMoves');
  if (movesEl) movesEl.innerHTML = `<span style="color:var(--down)">▼${cut}</span> <span style="color:var(--up)">▲${raised}</span>`;
  const movesSubEl = document.getElementById('statMovesSub');
  if (movesSubEl) movesSubEl.textContent = `cut / raised · ${flat} unchanged`;

  // Average interest spread with month-over-month delta (categories with data)
  const spreadCats = cats.filter(c => SPREAD_DATA && SPREAD_DATA[c] && SPREAD_DATA[c].length);
  if (spreadCats.length) {
    const currAll = [], prevAll = [];
    spreadCats.forEach(c => SPREAD_DATA[c].forEach(i => {
      if (i.history && i.history.length > 0) {
        currAll.push(i.history[0].rate);
        if (i.history[1]) prevAll.push(i.history[1].rate);
      }
    }));
    if (currAll.length) {
      const sc = avg(currAll), sp = prevAll.length ? avg(prevAll) : null;
      const spreadEl = document.getElementById('statSpread');
      if (spreadEl) spreadEl.innerHTML = sc.toFixed(2) + '%' + (sp != null ? deltaHTML(sc - sp) : '');
      const spreadSubEl = document.getElementById('statSpreadSub');
      if (spreadSubEl) spreadSubEl.textContent = `avg spread · ${spreadCats.map(c => SHORT[c]).join(' & ')}`;
    }
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
    (DATA[cat] || []).forEach(inst => {
      if (inst.history && inst.history.length > 0) {
        allInsts.push({ name: inst.name, rate: inst.history[0].rate, cat, color: CAT_COLORS[cat] });
      }
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
  const group = (DATA[catKey] || []).filter(i => i.history && i.history.length > 0);
  if (!group.length) return;
  const avg = group.reduce((s, i) => s + i.history[0].rate, 0) / group.length;

  const lblEl = document.getElementById('dashAvgLabel');
  if (lblEl) lblEl.textContent = `${CATEGORY_LABELS[catKey]}s · avg ${avg.toFixed(2)}% · ${fmtDate(GLOBAL_LATEST_DATE)}`;

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

/* ---- Institution selection & History View ---- */
let activeCategory = 'commercial_banks';
let activeInstId = null;

function populateInstSelect(category, preserveSelection) {
  const select = document.getElementById('instSelect');
  const items = [...(DATA[category] || [])].sort((a,b) => a.name.localeCompare(b.name));
  select.innerHTML = items.map(inst => `<option value="${inst.id}">${inst.name}</option>`).join('');
  if (preserveSelection && items.some(i => i.id === activeInstId)) {
    select.value = activeInstId;
  } else {
    select.value = items[0]?.id || '';
  }
}

function selectInstitutionHistory(category, id, indicator = activeHistoryIndicator || 'base_rate') {
  const baseInst = DATA[category]?.find(x => x.id === id);
  if (!baseInst) return;

  activeCategory = category;
  activeInstId = id;

  const spreadInst = SPREAD_DATA[category]?.find(x => x.id === id || x.name === baseInst.name);
  const hasSpread = !!(spreadInst && spreadInst.history && spreadInst.history.length);

  document.getElementById('categorySelect').value = category;
  populateInstSelect(category, true);
  document.getElementById('instSelect').value = id;

  const basePill = document.querySelector('.hist-indicator-pill[data-hist-ind="base_rate"]');
  const spreadPill = document.querySelector('.hist-indicator-pill[data-hist-ind="interest_spread"]');

  if (spreadPill) {
    spreadPill.classList.toggle('disabled', !hasSpread);
    spreadPill.title = hasSpread ? '' : 'No interest spread data available for this institution';
  }

  if (indicator === 'interest_spread' && !hasSpread) {
    indicator = 'base_rate';
  }
  activeHistoryIndicator = indicator;

  if (basePill) basePill.classList.toggle('active', activeHistoryIndicator === 'base_rate');
  if (spreadPill) spreadPill.classList.toggle('active', activeHistoryIndicator === 'interest_spread');

  const titleEl = document.getElementById('histSectionTitle');
  if (titleEl) titleEl.textContent = activeHistoryIndicator === 'interest_spread' ? 'Spread Rate History' : 'Base Rate History';

  if (activeHistoryIndicator === 'interest_spread' && spreadInst) {
    renderSpreadDetailPanel(category, spreadInst);
  } else {
    renderDetailPanel(category, baseInst);
  }

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

const CAT_LABELS = {
  commercial_banks: 'Commercial Banks',
  development_banks: 'Development Banks',
  finance_companies: 'Finance Companies'
};

function updateAsofStatus(cat) {
  if (!GLOBAL_LATEST_DATE) return;
  // Dashboard overall summary
  let totalBFIs = 0, updatedBFIs = 0;
  ['commercial_banks','development_banks','finance_companies'].forEach(c => {
    (DATA[c] || []).forEach(inst => {
      totalBFIs++;
      if (inst.history[0].date >= GLOBAL_LATEST_DATE) updatedBFIs++;
    });
  });
  const overallPending = totalBFIs - updatedBFIs;
  const overallDot = overallPending > 0 ? '<span class="asof-dot blinking"></span>' : '<span class="asof-dot"></span>';
  const overallText = `${fmtDate(GLOBAL_LATEST_DATE)} Rates · ${updatedBFIs} Updated, ${overallPending} Pending`;

  const dashEl = document.getElementById('dataAsOf');
  if (dashEl) dashEl.innerHTML = `${overallDot}${overallText}`;

  // Category specific tab status
  const targetCat = cat || activeSubTab || 'commercial_banks';
  const items = DATA[targetCat] || [];
  const totalInCat = items.length;
  const catLatestDate = getLatestDateForCategory(targetCat);
  const updatedInCat = catLatestDate ? items.filter(i => i.history[0] && i.history[0].date >= catLatestDate).length : totalInCat;
  const pendingInCat = totalInCat - updatedInCat;

  const catDot = pendingInCat > 0 ? '<span class="asof-dot blinking"></span>' : '<span class="asof-dot"></span>';
  const catText = `${fmtDate(catLatestDate)} Rates · ${updatedInCat} Updated, ${pendingInCat} Pending`;

  const dataEl = document.getElementById('dataAsOfData');
  if (dataEl) dataEl.innerHTML = `${catDot}${catText}`;
}

/* ---- Sub-nav category pills ---- */
function setActiveSubTab(tab, opts = {}) {
  sortState = { col: null, dir: null };
  activeSubTab = tab;
  document.querySelectorAll('.cat-pill-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === tab));
  document.querySelectorAll('.tab-view').forEach(v => {
    const isMatch = v.dataset.tabView === tab;
    v.classList.toggle('active', isMatch);
    v.style.display = isMatch ? '' : 'none';
  });
  updateAsofStatus(tab);

  if (opts.pushState !== false && (currentPage === 'base_rate_spread' || currentPage === 'base_rate' || currentPage === 'interest_spread')) {
    const url = urlForPage(currentPage, tab);
    if (location.pathname !== url) history.pushState(null, '', url);
  }
}

/* ---- Indicator-specific chrome: category descriptions, list render ---- */
function applyIndicatorUI(page) {
  document.getElementById('categorySelect').innerHTML = `
    <option value="commercial_banks">Commercial Banks</option>
    <option value="development_banks">Development Banks</option>
    <option value="finance_companies">Finance Companies</option>`;
  document.getElementById('sub-commercial_banks').textContent = "Base rates & interest spreads of commercial banks in Nepal, updated monthly";
  document.getElementById('sub-development_banks').textContent = "Base rates & interest spreads of development banks in Nepal, updated monthly";
  document.getElementById('sub-finance_companies').textContent = "Base rates & interest spreads of finance companies in Nepal, updated monthly";
  ['commercial_banks','development_banks','finance_companies'].forEach(renderUnifiedList);
}

/* ---- Quarterly Indicators Rendering ---- */
const Q_METRIC_CONFIG = {
  npl: {
    label: 'NPL %',
    fullName: 'Non-Performing Loans (NPL %)',
    threshold: 5.00,
    thresholdLabel: '5.00%',
    isHigherBad: true,
    description: 'NPL ratios & asset quality statistics of Nepali BFIs, updated quarterly'
  },
  car: {
    label: 'Capital Adequacy',
    fullName: 'Capital Adequacy Ratios (CAR, Tier 1, CET 1)',
    threshold: null,
    thresholdLabel: null,
    isHigherBad: false,
    multiColumn: true,
    description: 'Capital Fund to RWA (CAR), Tier 1 Capital, and CET 1 Capital ratios of Nepali BFIs'
  },
  cd_ratio: {
    label: 'CD Ratio %',
    fullName: 'Credit-to-Deposit Ratio (CD %)',
    threshold: 90.00,
    thresholdLabel: '90.00%',
    isHigherBad: true,
    description: 'Credit-to-deposit ratios & liquidity statistics of Nepali BFIs, updated quarterly'
  },
  cost_of_fund: {
    label: 'Cost of Funds %',
    fullName: 'Cost of Funds (%)',
    threshold: null,
    thresholdLabel: null,
    isHigherBad: true,
    description: 'Cost of funds statistics of Nepali BFIs, updated quarterly'
  },
  llp_npl: {
    label: 'LLP to NPL %',
    fullName: 'Total LLP to Total NPL Ratio (%)',
    threshold: null,
    thresholdLabel: null,
    isHigherBad: false,
    description: 'Total loan loss provision (LLP) to NPL coverage ratios of Nepali BFIs'
  },
  roe: {
    label: 'ROE %',
    fullName: 'Return on Equity (ROE Annualized %)',
    threshold: null,
    thresholdLabel: null,
    isHigherBad: false,
    description: 'Annualized Return on Equity (ROE) statistics of Nepali BFIs'
  },
  roa: {
    label: 'ROA %',
    fullName: 'Return on Assets (ROA Annualized %)',
    threshold: null,
    thresholdLabel: null,
    isHigherBad: false,
    description: 'Annualized Return on Assets (ROA) statistics of Nepali BFIs'
  }
};

function parseQuarterKey(qStr) {
  if (!qStr) return 0;
  const match = qStr.match(/(Q[1-4])\s*(\d{4})/i) || qStr.match(/(\d{4})\s*(Q[1-4])/i);
  if (match) {
    let qNum = parseInt(match[1].replace(/Q/i, ''));
    let year = parseInt(match[2]);
    if (/^\d{4}$/.test(match[1])) {
      year = parseInt(match[1]);
      qNum = parseInt(match[2].replace(/Q/i, ''));
    }
    return year * 10 + qNum;
  }
  return 0;
}

function fmtQuarterLabel(q) {
  if (!q) return '—';
  const match = q.match(/(Q[1-4])\s*(\d{4})/i) || q.match(/(\d{4})\s*(Q[1-4])/i);
  if (match) {
    let qNum = match[1].toUpperCase();
    let year = match[2];
    if (/^\d{4}$/.test(match[1])) {
      year = match[1];
      qNum = match[2].toUpperCase();
    }
    const qMonths = {
      'Q1': 'Ashwin',
      'Q2': 'Poush',
      'Q3': 'Chaitra',
      'Q4': 'Ashadh'
    };
    return `${year} ${qMonths[qNum] || ''} (${qNum})`;
  }
  return q;
}

function calcQuarterDeltaBadge(diff, metric) {
  if (Math.abs(diff) < 0.005) {
    return `<span class="trend-chip flat">0.00%</span>`;
  }
  const isUp = diff > 0;
  const formatted = (isUp ? '+' : '') + diff.toFixed(2) + '%';
  const goodWhenUp = ['car', 'capital_adequacy', 'cd_ratio', 'llp_npl', 'roe', 'roa'].includes(metric);
  const isGood = goodWhenUp ? isUp : !isUp;
  const cls = isGood ? 'down' : 'up';
  return `<span class="trend-chip ${cls}">${formatted}</span>`;
}

function renderQuarterlyView(category = activeQCat) {
  activeQCat = category;
  hideQuarterlyHistory();

  const qData = (QUARTERLY_DATA && QUARTERLY_DATA[category]) || [];
  const cfg = Q_METRIC_CONFIG[activeQMetric] || Q_METRIC_CONFIG.npl;

  // Update counts
  ['commercial_banks','development_banks','finance_companies'].forEach(c => {
    const el = document.getElementById('qcount-' + c);
    if (el && QUARTERLY_DATA && QUARTERLY_DATA[c]) el.textContent = QUARTERLY_DATA[c].length;
  });

  // Update category buttons & view buttons
  document.querySelectorAll('#subNavQuarterly .cat-pill-btn').forEach(b => b.classList.toggle('active', b.dataset.qcat === category));
  document.querySelectorAll('.q-metric-pill').forEach(b => b.classList.toggle('active', b.dataset.qmetric === activeQMetric));
  document.querySelectorAll('.q-view-btn').forEach(b => b.classList.toggle('active', b.dataset.qview === activeQView));

  // Compute status pill (chronologically resolve absolute latest quarter)
  const allLatestQuarters = qData.map(i => i.history[0]?.quarter).filter(Boolean);
  allLatestQuarters.sort((a, b) => parseQuarterKey(b) - parseQuarterKey(a));
  const latestQ = allLatestQuarters[0] || 'Q3 2082';
  const updatedCount = qData.filter(i => i.history[0]?.quarter === latestQ).length;
  const pendingCount = qData.length - updatedCount;

  const dot = pendingCount > 0 ? '<span class="asof-dot blinking"></span>' : '<span class="asof-dot"></span>';
  const statusEl = document.getElementById('dataAsOfQuarterly');
  if (statusEl) statusEl.innerHTML = `${dot}${fmtQuarterLabel(latestQ)} Disclosures · ${updatedCount} Updated, ${pendingCount} Pending`;

  // Toggle Data View vs Chart View
  const tableContainer = document.getElementById('qTableView');
  const chartContainer = document.getElementById('qChartView');

  if (activeQView === 'data') {
    if (tableContainer) tableContainer.style.display = 'block';
    if (chartContainer) chartContainer.style.display = 'none';
    renderQuarterlyTable(category, qData, cfg, latestQ);
  } else {
    if (tableContainer) tableContainer.style.display = 'none';
    if (chartContainer) chartContainer.style.display = 'block';
    renderQuarterlyChart(category, qData, cfg, latestQ);
  }
}

function cycleQSortDir(col) {
  if (qSortState.col !== col) {
    qSortState.col = col;
    qSortState.dir = 'desc';
  } else if (qSortState.dir === 'desc') {
    qSortState.dir = 'asc';
  } else {
    qSortState.col = null;
    qSortState.dir = null;
  }
}

function qSortArrow(col) {
  if (qSortState.col !== col) return '<span class="sort-arrow">↕</span>';
  return `<span class="sort-arrow">${qSortState.dir === 'desc' ? '↓' : '↑'}</span>`;
}

function renderQuarterlyTable(category, qData, cfg, latestQ) {
  const container = document.getElementById('qTableView');
  if (!container) return;

  let items = [...qData];

  if (qSortState.col) {
    items.sort((a, b) => {
      const aCurr = a.history[0] || {};
      const bCurr = b.history[0] || {};
      let va = 0, vb = 0;

      if (qSortState.col === 'name') {
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
        if (va < vb) return qSortState.dir === 'asc' ? -1 : 1;
        if (va > vb) return qSortState.dir === 'asc' ? 1 : -1;
        return 0;
      } else if (qSortState.col === 'quarter') {
        va = parseQuarterKey(aCurr.quarter);
        vb = parseQuarterKey(bCurr.quarter);
        return qSortState.dir === 'desc' ? vb - va : va - vb;
      } else {
        va = aCurr[qSortState.col] !== undefined ? aCurr[qSortState.col] : -9999;
        vb = bCurr[qSortState.col] !== undefined ? bCurr[qSortState.col] : -9999;
        return qSortState.dir === 'desc' ? vb - va : va - vb;
      }
    });
  } else {
    items.sort((a,b) => a.name.localeCompare(b.name));
  }

  const isMultiCap = (activeQMetric === 'car');

  let rowsHTML = '';
  items.forEach(inst => {
    const curr = inst.history[0] || {};
    const prev = inst.history[1] || {};

    const isStale = curr.quarter && curr.quarter !== latestQ;
    const statusDot = isStale 
      ? `<span class="status-dot-indicator yellow" title="${fmtQuarterLabel(latestQ)} pending — displaying ${fmtQuarterLabel(curr.quarter)}"></span>` 
      : `<span class="status-dot-indicator green" title="${fmtQuarterLabel(latestQ)} disclosure up to date"></span>`;
    const rowClass = isStale ? ' class="stale-row"' : '';
    const dateClass = isStale ? 'rate-date stale-date' : 'rate-date latest-date';

    let auditBadge = '';
    if (curr.audited === true) {
      auditBadge = ` <span class="stale-month-badge" style="background:#E8F5E9;color:#2E7D32;border-color:rgba(46,125,50,0.3)">Audited</span>`;
    }

    if (isMultiCap) {
      const carVal = curr.car !== undefined ? fmtRate(curr.car) : '—';
      const tier1Val = curr.tier1 !== undefined ? fmtRate(curr.tier1) : '—';
      const cet1Val = curr.cet1 !== undefined ? fmtRate(curr.cet1) : '—';

      rowsHTML += `
        <tr${rowClass}>
          <td><div class="inst-name">${inst.name}${statusDot}</div></td>
          <td class="num"><span class="rate-value">${carVal}</span></td>
          <td class="num"><span class="rate-value">${tier1Val}</span></td>
          <td class="num"><span class="rate-value">${cet1Val}</span></td>
          <td class="num"><span class="${dateClass}">${fmtQuarterLabel(curr.quarter)}${auditBadge}</span></td>
          <td style="text-align:right"><button class="history-btn" data-qhist-cat="${category}" data-qhist-id="${inst.id}">History</button></td>
        </tr>`;
    } else {
      const val = curr[activeQMetric] !== undefined ? curr[activeQMetric] : null;

      // QoQ calculation
      let qoqHTML = '<span style="color:var(--slate)">—</span>';
      if (val !== null && prev && prev[activeQMetric] !== undefined && prev[activeQMetric] !== null) {
        const diff = val - prev[activeQMetric];
        qoqHTML = calcQuarterDeltaBadge(diff, activeQMetric);
      }

      // YoY calculation
      let yoyHTML = '<span style="color:var(--slate)">—</span>';
      const qMatch = (curr.quarter || '').match(/(Q[1-4])\s*(\d{4})/i) || (curr.quarter || '').match(/(\d{4})\s*(Q[1-4])/i);
      if (val !== null && qMatch) {
        let qNum = qMatch[1].toUpperCase();
        let year = parseInt(qMatch[2]);
        if (/^\d{4}$/.test(qMatch[1])) {
          year = parseInt(qMatch[1]);
          qNum = qMatch[2].toUpperCase();
        }
        const yoyRecord = inst.history.find(h => {
          if (!h.quarter) return false;
          const hm = h.quarter.match(/(Q[1-4])\s*(\d{4})/i) || h.quarter.match(/(\d{4})\s*(Q[1-4])/i);
          if (!hm) return false;
          let hQNum = hm[1].toUpperCase();
          let hYear = parseInt(hm[2]);
          if (/^\d{4}$/.test(hm[1])) {
            hYear = parseInt(hm[1]);
            hQNum = hm[2].toUpperCase();
          }
          return hQNum === qNum && hYear === year - 1;
        });

        if (yoyRecord && yoyRecord[activeQMetric] !== undefined && yoyRecord[activeQMetric] !== null) {
          const diff = val - yoyRecord[activeQMetric];
          yoyHTML = calcQuarterDeltaBadge(diff, activeQMetric);
        }
      }

      rowsHTML += `
        <tr${rowClass}>
          <td><div class="inst-name">${inst.name}${statusDot}</div></td>
          <td class="num"><span class="rate-value">${val !== null ? fmtRate(val) : '—'}</span></td>
          <td class="num">${qoqHTML}</td>
          <td class="num">${yoyHTML}</td>
          <td class="num"><span class="${dateClass}">${fmtQuarterLabel(curr.quarter)}${auditBadge}</span></td>
          <td style="text-align:right"><button class="history-btn" data-qhist-cat="${category}" data-qhist-id="${inst.id}">History</button></td>
        </tr>`;
    }
  });

  const theadHTML = isMultiCap ? `
    <tr>
      <th class="sortable-th${qSortState.col==='name'?' sort-active':''}" data-qsort="name">Institution ${qSortArrow('name')}</th>
      <th class="num sortable-th${qSortState.col==='car'?' sort-active':''}" data-qsort="car">Capital Fund (CAR) ${qSortArrow('car')}</th>
      <th class="num sortable-th${qSortState.col==='tier1'?' sort-active':''}" data-qsort="tier1">Tier 1 Capital ${qSortArrow('tier1')}</th>
      <th class="num sortable-th${qSortState.col==='cet1'?' sort-active':''}" data-qsort="cet1">CET 1 Capital ${qSortArrow('cet1')}</th>
      <th class="num sortable-th${qSortState.col==='quarter'?' sort-active':''}" data-qsort="quarter">Reporting Quarter ${qSortArrow('quarter')}</th>
      <th></th>
    </tr>` : `
    <tr>
      <th class="sortable-th${qSortState.col==='name'?' sort-active':''}" data-qsort="name">Institution ${qSortArrow('name')}</th>
      <th class="num sortable-th${qSortState.col===activeQMetric?' sort-active':''}" data-qsort="${activeQMetric}">${cfg.label} ${qSortArrow(activeQMetric)}</th>
      <th class="num">QoQ Change</th>
      <th class="num">YoY Change</th>
      <th class="num sortable-th${qSortState.col==='quarter'?' sort-active':''}" data-qsort="quarter">Reporting Quarter ${qSortArrow('quarter')}</th>
      <th></th>
    </tr>`;

  container.innerHTML = `
    <div class="section-head">
      <div>
        <h1>${CATEGORY_LABELS[category]}s — ${cfg.fullName}</h1>
        <div class="section-sub">${cfg.description}</div>
      </div>
      <div class="search-box"><input type="text" placeholder="Search bank…" data-search-q="${category}"></div>
    </div>
    <div class="rate-table-wrap">
      <table class="rate-table">
        <thead>${theadHTML}</thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>`;

  const searchInput = container.querySelector('[data-search-q]');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      container.querySelectorAll('tbody tr').forEach(r => {
        const name = r.querySelector('.inst-name').textContent.toLowerCase();
        r.style.display = name.includes(q) ? '' : 'none';
      });
    });
  }

  // Attach column sort handlers
  container.querySelectorAll('[data-qsort]').forEach(th => {
    th.addEventListener('click', () => {
      cycleQSortDir(th.dataset.qsort);
      renderQuarterlyTable(category, qData, cfg, latestQ);
    });
  });

  // Attach History button click handlers
  container.querySelectorAll('[data-qhist-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      showQuarterlyHistory(btn.dataset.qhistCat, btn.dataset.qhistId);
    });
  });
}

function showQuarterlyHistory(category, instId) {
  const qData = (QUARTERLY_DATA && QUARTERLY_DATA[category]) || [];
  const inst = qData.find(i => i.id === instId);
  if (!inst) return;

  const dataContainer = document.getElementById('qDataContainer');
  const controlsHeader = document.getElementById('qControlsHeader');
  const historyView = document.getElementById('qHistoryView');

  if (dataContainer) dataContainer.style.display = 'none';
  if (controlsHeader) controlsHeader.style.display = 'none';
  if (historyView) historyView.style.display = 'block';

  document.getElementById('qHistBankName').textContent = inst.name;
  document.getElementById('qHistBankCat').textContent = `${CATEGORY_LABELS[category]} — Quarterly Financial History across Key Indicators`;

  const latestQ = inst.history[0]?.quarter || 'Q3 2082';
  document.getElementById('qHistLatestQuarter').textContent = `${fmtQuarterLabel(latestQ)} Disclosures`;

  const tbody = document.getElementById('qHistTbody');
  if (!tbody) return;

  let rowsHTML = '';
  inst.history.forEach(curr => {
    let auditBadge = '';
    if (curr.audited === true) {
      auditBadge = ` <span class="stale-month-badge" style="background:#E8F5E9;color:#2E7D32;border-color:rgba(46,125,50,0.3)">Audited</span>`;
    }

    rowsHTML += `
      <tr>
        <td><strong style="font-family:'Space Mono',monospace;font-size:13.5px">${fmtQuarterLabel(curr.quarter)}</strong>${auditBadge}</td>
        <td class="num"><span class="rate-value">${curr.npl !== undefined ? fmtRate(curr.npl) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.car !== undefined ? fmtRate(curr.car) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.tier1 !== undefined ? fmtRate(curr.tier1) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.cet1 !== undefined ? fmtRate(curr.cet1) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.cd_ratio !== undefined ? fmtRate(curr.cd_ratio) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.cost_of_fund !== undefined ? fmtRate(curr.cost_of_fund) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.llp_npl !== undefined ? fmtRate(curr.llp_npl) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.roe !== undefined ? fmtRate(curr.roe) : '—'}</span></td>
        <td class="num"><span class="rate-value">${curr.roa !== undefined ? fmtRate(curr.roa) : '—'}</span></td>
      </tr>`;
  });

  tbody.innerHTML = rowsHTML;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideQuarterlyHistory() {
  const dataContainer = document.getElementById('qDataContainer');
  const controlsHeader = document.getElementById('qControlsHeader');
  const historyView = document.getElementById('qHistoryView');

  if (historyView) historyView.style.display = 'none';
  if (dataContainer) dataContainer.style.display = 'block';
  if (controlsHeader) controlsHeader.style.display = 'flex';
}

function renderQuarterlyChart(category, qData, cfg, latestQ) {
  const titleEl = document.getElementById('qChartTitle');
  const subEl = document.getElementById('qChartSub');
  if (titleEl) titleEl.textContent = `${CATEGORY_LABELS[category]}s — ${cfg.fullName}`;
  if (subEl) subEl.textContent = `Institutional ${cfg.label} comparison`;

  // Sync active chart sort button
  document.querySelectorAll('[data-qchart-sort]').forEach(b => b.classList.toggle('active', b.dataset.qchartSort === qChartSortDir));

  const svg = document.getElementById('qChartSvg');
  if (!svg) return;

  const validItems = qData.filter(i => i.history[0] && i.history[0][activeQMetric] !== undefined);

  if (qChartSortDir === 'asc') {
    validItems.sort((a,b) => (a.history[0][activeQMetric] || 0) - (b.history[0][activeQMetric] || 0));
  } else if (qChartSortDir === 'name') {
    validItems.sort((a,b) => a.name.localeCompare(b.name));
  } else {
    validItems.sort((a,b) => (b.history[0][activeQMetric] || 0) - (a.history[0][activeQMetric] || 0));
  }

  const rowHeight = 36;
  const padding = { top: 35, right: 90, bottom: 30, left: 220 };
  const chartW = chartWidth(svg);
  const innerW = chartW - padding.left - padding.right;
  const chartH = Math.max(validItems.length * rowHeight + padding.top + padding.bottom, 200);

  svg.setAttribute('width', chartW);
  svg.setAttribute('height', chartH);
  svg.style.height = chartH + 'px';

  const maxVal = Math.max(...validItems.map(i => i.history[0][activeQMetric]), (cfg.threshold || 0) * 1.2, 10);
  const xScale = val => padding.left + (val / maxVal) * innerW;

  let elements = '';

  if (cfg.threshold != null) {
    const threshX = xScale(cfg.threshold);
    elements += `<line x1="${threshX}" y1="${padding.top - 10}" x2="${threshX}" y2="${chartH - padding.bottom}" stroke="var(--slate)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6"/>`;
    elements += `<text x="${threshX}" y="${padding.top - 16}" fill="var(--slate)" font-size="11" font-weight="600" text-anchor="middle" font-family="Space Mono, monospace">${cfg.thresholdLabel}</text>`;
  }

  validItems.forEach((inst, idx) => {
    const y = padding.top + idx * rowHeight + 16;
    const val = inst.history[0][activeQMetric];
    const barW = (val / maxVal) * innerW;

    elements += `<text x="${padding.left - 12}" y="${y + 5}" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="end" font-family="Fraunces, serif">${inst.name}</text>`;
    elements += `<rect x="${padding.left}" y="${y - 8}" width="${barW}" height="14" rx="4" fill="var(--cb)" opacity="0.85"/>`;
    elements += `<text x="${padding.left + barW + 8}" y="${y + 4}" fill="var(--ink)" font-size="12" font-weight="700" font-family="Space Mono, monospace">${fmtRate(val)}</text>`;
  });

  svg.innerHTML = elements;
}

/* ---- Page navigation ---- */
function navigateTo(page, opts = {}) {
  currentPage = page;

  document.querySelectorAll('.nav-link').forEach(l => {
    const isMatch = l.dataset.page === page ||
      (l.dataset.page === 'base_rate_spread' && (page === 'base_rate' || page === 'interest_spread' || page === 'base_rate_spread'));
    l.classList.toggle('active', isMatch);
  });

  const isDataPage = page === 'base_rate' || page === 'interest_spread' || page === 'base_rate_spread';
  const isQuarterlyPage = page === 'quarterly_indicators';
  const isComingSoon = page === 'npl' || page === 'capital_adequacy' || page === 'loans_deposits';
  const histActive = document.getElementById('historyView') ? document.getElementById('historyView').classList.contains('active') : false;

  document.getElementById('pageDashboard').classList.toggle('active', page === 'dashboard');
  document.getElementById('pageData').classList.toggle('active', isDataPage);
  if (document.getElementById('pageQuarterly')) {
    document.getElementById('pageQuarterly').classList.toggle('active', isQuarterlyPage);
  }
  document.getElementById('pageComingSoon').classList.toggle('active', isComingSoon);

  document.getElementById('subNav').style.display = (isDataPage && !histActive) ? '' : 'none';

  if (page === 'dashboard') {
    renderDashboard();
  } else if (isDataPage) {
    document.getElementById('historyView').classList.remove('active');
    document.getElementById('listViews').style.display = 'block';
    document.getElementById('subNav').style.display = '';
    applyIndicatorUI(page);
    setActiveSubTab(activeSubTab || 'commercial_banks', { pushState: false });
  } else if (isQuarterlyPage) {
    renderQuarterlyView(activeQCat || 'commercial_banks');
  } else if (isComingSoon) {
    const labels = { npl: 'NPL data', capital_adequacy: 'Capital Adequacy data', loans_deposits: 'Loans & Deposits data' };
    document.getElementById('comingSoonTitle').textContent = page === 'loans_deposits' ? 'Loans & Deposits' : 'Coming Soon';
    document.getElementById('comingSoonLabel').textContent = labels[page] || 'this data';
  }

  if (opts.pushState !== false && (page === 'dashboard' || isDataPage || isQuarterlyPage)) {
    const url = urlForPage(page, page === 'quarterly_indicators' ? activeQCat : activeSubTab);
    if (location.pathname !== url) history.pushState(null, '', url);
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

function getLatestDateForCategory(cat) {
  let latest = null;
  if (DATA && DATA[cat]) {
    DATA[cat].forEach(inst => {
      if (inst.history && inst.history[0]) {
        const d = inst.history[0].date;
        if (!latest || d > latest) latest = d;
      }
    });
  }
  return latest || GLOBAL_LATEST_DATE;
}

function getMostRecentDate() {
  let latest = null;
  ['commercial_banks','development_banks','finance_companies'].forEach(cat => {
    (DATA[cat] || []).forEach(inst => {
      if (inst.history && inst.history[0]) {
        const d = inst.history[0].date;
        if (!latest || d > latest) latest = d;
      }
    });
  });
  return latest;
}

/* ---- Init ---- */
function init() {
  GLOBAL_LATEST_DATE = getMostRecentDate();

  updateAsofStatus(activeSubTab);

  ['commercial_banks','development_banks','finance_companies'].forEach(renderUnifiedList);

  // Nav links
  document.querySelectorAll('.nav-link:not(.coming-soon)').forEach(btn => {
    btn.addEventListener('click', e => { e.preventDefault(); navigateTo(btn.dataset.page); });
  });

  // Sub-nav category pills
  document.querySelectorAll('.cat-pill-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      if (!btn.classList.contains('is-disabled')) setActiveSubTab(btn.dataset.cat);
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
      selectInstitutionHistory(btn.dataset.cat, btn.dataset.id);
    }
  });

  // History view indicator toggle pills
  document.querySelectorAll('.hist-indicator-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      activeHistoryIndicator = btn.dataset.histInd;
      selectInstitutionHistory(activeCategory, activeInstId, activeHistoryIndicator);
    });
  });

  document.getElementById('backBtn').addEventListener('click', showListViews);

  // History view dropdowns
  document.getElementById('categorySelect').addEventListener('change', e => {
    const category = e.target.value;
    populateInstSelect(category, false);
    selectInstitutionHistory(category, document.getElementById('instSelect').value, activeHistoryIndicator);
  });

  document.getElementById('instSelect').addEventListener('change', e => {
    selectInstitutionHistory(activeCategory, e.target.value, activeHistoryIndicator);
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

  // Quarterly sub-nav category pills
  document.querySelectorAll('[data-qcat]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      activeQCat = btn.dataset.qcat;
      renderQuarterlyView(activeQCat);
      const url = urlForPage('quarterly_indicators', activeQCat);
      if (location.pathname !== url) history.pushState(null, '', url);
    });
  });

  // Quarterly metric pills (NPL, CAR, CD Ratio)
  document.querySelectorAll('[data-qmetric]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeQMetric = btn.dataset.qmetric;
      renderQuarterlyView(activeQCat);
    });
  });

  // Quarterly view switcher (Data View vs Chart View)
  document.querySelectorAll('[data-qview]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeQView = btn.dataset.qview;
      renderQuarterlyView(activeQCat);
    });
  });

  const qBackBtn = document.getElementById('qBackBtn');
  if (qBackBtn) {
    qBackBtn.addEventListener('click', hideQuarterlyHistory);
  }

  // Quarterly chart sorting pills (High to Low, Low to High, A-Z)
  document.querySelectorAll('[data-qchart-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      qChartSortDir = btn.dataset.qchartSort;
      const qData = (QUARTERLY_DATA && QUARTERLY_DATA[activeQCat]) || [];
      const cfg = Q_METRIC_CONFIG[activeQMetric] || Q_METRIC_CONFIG.npl;
      renderQuarterlyChart(activeQCat, qData, cfg, 'Q3 2082');
    });
  });

  applyIndicatorUI(currentIndicator);
  navigateTo(currentPage, { pushState: false });
  if (currentPage === 'quarterly_indicators') renderQuarterlyView(activeQCat);
  else if (currentPage !== 'dashboard') setActiveSubTab(activeSubTab, { pushState: false });
}

/* ---- Browser back/forward across indicator + category URLs ---- */
window.addEventListener('popstate', () => {
  if (!DATA) return;
  const loc = parseLocationPath();
  navigateTo(loc.page, { pushState: false });
  if (loc.page === 'quarterly_indicators') renderQuarterlyView(loc.category);
  else if (loc.page !== 'dashboard') setActiveSubTab(loc.category, { pushState: false });
});

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
    } else if (currentPage === 'quarterly_indicators') {
      renderQuarterlyView(activeQCat);
    } else if (document.getElementById('historyView') && document.getElementById('historyView').classList.contains('active') && activeInstId) {
      const source = currentIndicator === 'interest_spread' ? SPREAD_DATA : DATA;
      const inst = source[activeCategory]?.find(i => i.id === activeInstId);
      if (inst) {
        if (currentIndicator === 'interest_spread') renderSpreadDetailPanel(activeCategory, inst);
        else renderDetailPanel(activeCategory, inst);
      }
    }
  }, 150);
});

function getRelativeDataPath() {
  const parts = location.pathname.split('/').filter(p => p && !p.endsWith('.html'));
  const slugs = new Set(['base-rate-spread', 'quarterly-indicators', 'base-rate', 'interest-spread']);
  const idx = parts.findIndex(p => slugs.has(p));
  if (idx >= 0) {
    const stepsBack = parts.length - idx;
    return '../'.repeat(stepsBack) + 'data/';
  }
  return 'data/';
}

/* ---- Data fetch with resilient failovers for localhost & GitHub Pages ---- */
async function fetchJSON(file) {
  const relPath = getRelativeDataPath();
  const base = typeof getBasePath === 'function' ? getBasePath() : '/';
  const candidateUrls = [
    `${relPath}${file}`,
    `${base}data/${file}`,
    `data/${file}`,
    `/data/${file}`,
    `./data/${file}`,
    `../../data/${file}`
  ];
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      // continue to next URL candidate
    }
  }
  throw new Error(`Failed to load data/${file}`);
}

async function fetchMonthlyData() {
  try {
    return await fetchJSON('monthly-indicators.json');
  } catch (e) {
    return await fetchJSON('base-rates.json');
  }
}

Promise.all([
  fetchMonthlyData().catch(() => ({})),
  fetchJSON('reference.json').catch(() => ({})),
  fetchJSON('quarterly-indicators.json').catch(() => ({}))
]).then(([monthlyData, refData, qData]) => {
  const baseData = { commercial_banks: [], development_banks: [], finance_companies: [] };
  const spreadData = { commercial_banks: [], development_banks: [], finance_companies: [] };

  ['commercial_banks', 'development_banks', 'finance_companies'].forEach(cat => {
    ((monthlyData && monthlyData[cat]) || []).forEach(inst => {
      const bHistory = [];
      const sHistory = [];
      (inst.history || []).forEach(h => {
        if (h.base_rate !== undefined && h.base_rate !== null) {
          bHistory.push({ date: h.date, rate: h.base_rate });
        }
        if (h.interest_spread !== undefined && h.interest_spread !== null) {
          sHistory.push({ date: h.date, rate: h.interest_spread });
        }
      });
      baseData[cat].push({ id: inst.id, name: inst.name, history: bHistory });
      spreadData[cat].push({ id: inst.id, name: inst.name, history: sHistory });
    });
  });

  DATA = baseData;
  SPREAD_DATA = spreadData;
  IRC_DATA = (refData && refData.interest_rate_corridor) || [];
  QUARTERLY_DATA = qData || {};

  GLOBAL_LATEST_DATE = getMostRecentDate();

  try {
    init();
  } catch (initErr) {
    console.error('App initialization error:', initErr);
  }
}).catch(err => {
  const isFileProtocol = window.location.protocol === 'file:';
  const mainEl = document.querySelector('main');
  if (mainEl) {
    if (isFileProtocol) {
      mainEl.innerHTML = `
        <div class="empty-state" style="padding: 40px 24px; text-align: center;">
          <h2 style="font-family:'Fraunces',serif; font-size: 22px; color: var(--ink); margin-bottom: 12px;">Local HTTP Web Server Required</h2>
          <p style="font-size: 15px; color: var(--slate); max-width: 540px; margin: 0 auto 20px;">
            You opened this file directly via <code>file://</code> protocol. Web browsers block local JSON data fetching over <code>file://</code> due to CORS security policies.
          </p>
          <div style="background: var(--paper-dim); border: 1px solid var(--line); border-radius: 8px; padding: 14px 20px; font-family:'Space Mono',monospace; font-size: 13px; color: var(--ink); max-width: 480px; margin: 0 auto 16px; text-align: left;">
            $ python3 -m http.server 8000
          </div>
          <p style="font-size: 14px; color: var(--slate);">Then open <strong style="color:var(--ink)">http://localhost:8000</strong> in your web browser.</p>
        </div>`;
    } else {
      mainEl.innerHTML = `<div class="empty-state">Could not load data files. Please ensure <code>data/monthly-indicators.json</code> and <code>data/quarterly-indicators.json</code> are present in your website directory.</div>`;
    }
  }
  console.error('Data loading error:', err);
});

#!/usr/bin/env python3
"""
Generates static, pre-rendered pages for each Base Rate / Interest Spread
category so they have real, crawlable URLs instead of only existing as
client-side JS state inside index.html.

Re-run this (and commit its output) every time data/base-rates.json or
data/interest-spread.json is updated -- same cadence as the monthly
admin.html data update. It also regenerates sitemap.xml.

Usage: python3 build_pages.py
"""
import html as html_lib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
SITE = 'https://bankstatsnepal.com'

BS_MONTHS = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
             'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra']

CATEGORIES = ['commercial_banks', 'development_banks', 'finance_companies']
CATEGORY_SLUG = {'commercial_banks': 'commercial-banks', 'development_banks': 'development-banks', 'finance_companies': 'finance-companies'}
CATEGORY_LABEL = {'commercial_banks': 'Commercial Bank', 'development_banks': 'Development Bank', 'finance_companies': 'Finance Company'}
CATEGORY_LABEL_PLURAL = {'commercial_banks': 'Commercial Banks', 'development_banks': 'Development Banks', 'finance_companies': 'Finance Companies'}

INDICATOR_SLUG = {
    'base_rate': 'base-rate',
    'interest_spread': 'interest-spread',
    'base_rate_spread': 'base-rate-spread',
    'quarterly_indicators': 'quarterly-indicators'
}
INDICATOR_LABEL = {
    'base_rate': 'Base Rate',
    'interest_spread': 'Interest Spread',
    'base_rate_spread': 'Base Rate & Spread Rate',
    'quarterly_indicators': 'Quarterly Indicators'
}

BASE_SPREAD_DESC = {
    'commercial_banks': "Base rates & interest spreads of commercial banks in Nepal, updated monthly",
    'development_banks': "Base rates & interest spreads of development banks in Nepal, updated monthly",
    'finance_companies': "Base rates & interest spreads of finance companies in Nepal, updated monthly",
}

QUARTERLY_DESC = {
    'commercial_banks': "Quarterly financial indicators (NPL %, CAR, CD Ratio, Cost of Funds, LLP to NPL %, ROE %, ROA %) of commercial banks in Nepal — 'A' class financial institutions",
    'development_banks': "Quarterly financial indicators (NPL %, CAR, CD Ratio, Cost of Funds, LLP to NPL %, ROE %, ROA %) of development banks in Nepal — 'B' class financial institutions",
    'finance_companies': "Quarterly financial indicators (NPL %, CAR, CD Ratio, Cost of Funds, LLP to NPL %, ROE %, ROA %) of finance companies in Nepal — 'C' class financial institutions",
}

UNIFIED_THEAD = '<th>Institution</th><th class="num">Base Rate</th><th class="num">3M Avg Rate</th><th class="num">Spread Rate</th><th></th>'


def esc(s):
    return html_lib.escape(str(s), quote=True)


def fmt_date(d):
    year, month = d.split('-')
    return f'{BS_MONTHS[int(month) - 1]} {year}'


def fmt_quarter_label(q):
    if not q:
        return '—'
    m = re.search(r'(Q[1-4])\s*(\d{4})', q, re.IGNORECASE) or re.search(r'(\d{4})\s*(Q[1-4])', q, re.IGNORECASE)
    if m:
        p1, p2 = m.group(1).upper(), m.group(2)
        if re.match(r'^\d{4}$', p1):
            year, q_num = p1, p2.upper()
        else:
            q_num, year = p1, p2
        months = {'Q1': 'Ashwin', 'Q2': 'Poush', 'Q3': 'Chaitra', 'Q4': 'Ashadh'}
        return f'{year} {months.get(q_num, "")} ({q_num})'
    return q


def parse_quarter_key(q_str):
    if not q_str:
        return 0
    m = re.search(r'(Q[1-4])\s*(\d{4})', q_str, re.IGNORECASE) or re.search(r'(\d{4})\s*(Q[1-4])', q_str, re.IGNORECASE)
    if m:
        p1, p2 = m.group(1).upper(), m.group(2)
        if re.match(r'^\d{4}$', p1):
            year, q_num = int(p1), int(p2.upper().replace('Q', ''))
        else:
            q_num, year = int(p1.replace('Q', '')), int(p2)
        return year * 10 + q_num
    return 0


def fmt_rate(r):
    return f'{r:.2f}%'


def avg3(history):
    s = history[:3]
    return sum(h['rate'] for h in s) / len(s)


def trend_chip(curr, prev):
    if prev is None:
        return ''
    diff = round(curr - prev, 2)
    if diff > 0:
        return f'<span class="trend-chip up">▲ {diff:.2f}</span>'
    if diff < 0:
        return f'<span class="trend-chip down">▼ {abs(diff):.2f}</span>'
    return '<span class="trend-chip flat">— 0.00</span>'


def unified_row(inst, spread_inst, category, latest_date=None):
    hist = inst['history']
    curr, prev = hist[0], (hist[1] if len(hist) > 1 else None)
    chip = trend_chip(curr['rate'], prev['rate'] if prev else None)
    a3 = avg3(hist)

    is_pending = bool(latest_date and curr['date'] < latest_date)
    status_dot = f'<span class="status-dot-indicator yellow" title="{fmt_date(latest_date)} pending — displaying {fmt_date(curr["date"])} disclosure"></span><span class="stale-month-badge">{fmt_date(curr["date"])}</span>' if is_pending else f'<span class="status-dot-indicator green" title="{fmt_date(latest_date)} disclosure up to date"></span>'
    tr_class = ' class="stale-row"' if is_pending else ''

    spread_html = '<span style="color:var(--slate)">—</span>'
    if spread_inst and spread_inst.get('history'):
        shist = spread_inst['history']
        smatch_idx = next((idx for idx, h in enumerate(shist) if h['date'] == curr['date']), None)
        if smatch_idx is not None:
            scurr = shist[smatch_idx]
            sprev = shist[smatch_idx + 1] if len(shist) > smatch_idx + 1 else None
            schip = trend_chip(scurr['rate'], sprev['rate'] if sprev else None)
            spread_html = f'<div><span class="rate-value" style="font-size:16px">{fmt_rate(scurr["rate"])}</span>{schip}</div>'

    note_html = f'<div class="inst-note">{esc(inst["note"])}</div>' if inst.get('note') else ''

    return (
        f'<tr data-name="{esc(inst["name"].lower())}"{tr_class}>'
        f'<td><div class="inst-name">{esc(inst["name"])}{status_dot}</div>{note_html}</td>'
        f'<td class="num"><div><span class="rate-value">{fmt_rate(curr["rate"])}</span>{chip}</div></td>'
        f'<td class="num"><div><span class="rate-value" style="font-size:16px">{fmt_rate(a3)}</span></div></td>'
        f'<td class="num">{spread_html}</td>'
        f'<td style="text-align:right">'
        f'<button class="history-btn" data-cat="{category}" data-id="{esc(inst["id"])}" title="View History">'
        f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        f'<circle cx="12" cy="12" r="10"></circle>'
        f'<polyline points="12 6 12 12 16 14"></polyline>'
        f'<path d="M3.51 9a9 9 0 0 1 14.85-3.36L21 8M21 3v5h-5"></path>'
        f'</svg>'
        f'</button>'
        f'</td>'
        f'</tr>'
    )


def compute_latest_date_for_category(category, base_data):
    items = base_data.get(category, [])
    latest = None
    for inst in items:
        if inst.get('history'):
            d = inst['history'][0]['date']
            if not latest or d > latest:
                latest = d
    return latest


def compute_asof_html_for_category(category, base_data):
    items = base_data.get(category, [])
    if not items:
        return ''
    latest_date = compute_latest_date_for_category(category, base_data)
    if not latest_date:
        return ''

    updated_count = sum(1 for i in items if i.get('history') and i['history'][0]['date'] == latest_date)
    pending_count = len(items) - updated_count

    dot = '<span class="asof-dot blinking"></span>' if pending_count > 0 else '<span class="asof-dot"></span>'
    return f'{dot}As of {fmt_date(latest_date)} Rates · {updated_count} Updated, {pending_count} Pending'


def compute_asof_html(base_data):
    latest_date = None
    all_items = []
    for cat in CATEGORIES:
        items = base_data.get(cat, [])
        all_items.extend(items)
        for inst in items:
            if inst.get('history'):
                d = inst['history'][0]['date']
                if not latest_date or d > latest_date:
                    latest_date = d

    if not latest_date or not all_items:
        return ''

    updated_count = sum(1 for i in all_items if i.get('history') and i['history'][0]['date'] == latest_date)
    pending_count = len(all_items) - updated_count

    dot = '<span class="asof-dot blinking"></span>' if pending_count > 0 else '<span class="asof-dot"></span>'
    return f'{dot}As of {fmt_date(latest_date)} Rates · {updated_count} Updated, {pending_count} Pending'


def build_listviews_html(indicator, category, base_data, spread_data):
    cat_items = base_data.get(category, [])
    spread_by_id = {inst['id']: inst for inst in spread_data.get(category, [])}
    items_sorted = sorted(cat_items, key=lambda x: x['name'])
    latest_date = compute_latest_date_for_category(category, base_data)

    rows = []
    for inst in items_sorted:
        s_inst = spread_by_id.get(inst['id'])
        rows.append(unified_row(inst, s_inst, category, latest_date=latest_date))

    rows_str = '\n'.join(rows)

    html_out = []
    for cat in CATEGORIES:
        style_display = '' if cat == category else ' style="display:none"'
        cat_label = CATEGORY_LABEL_PLURAL[cat]
        cat_sub = BASE_SPREAD_DESC[cat]
        if cat == category:
            cat_rows = rows_str
        else:
            c_items = sorted(base_data.get(cat, []), key=lambda x: x['name'])
            c_spread = {i['id']: i for i in spread_data.get(cat, [])}
            c_latest = compute_latest_date_for_category(cat, base_data)
            cat_rows = '\n'.join(unified_row(i, c_spread.get(i['id']), cat, latest_date=c_latest) for i in c_items)

        is_active_cls = ' active' if cat == category else ''
        block = f'''      <div class="tab-view{is_active_cls}" data-tab-view="{cat}"{style_display}>
        <div class="section-head">
          <div>
            <h1>{cat_label}</h1>
            <div class="section-sub" id="sub-{cat}">{cat_sub}</div>
          </div>
          <div class="search-box"><input type="text" placeholder="Search bank…" data-search="{cat}"></div>
        </div>
        <div class="rate-table-wrap"><table class="rate-table"><thead><tr id="thead-{cat}">
          {UNIFIED_THEAD}
        </tr></thead><tbody id="tbody-{cat}">
{cat_rows}
        </tbody></table></div>
        <div class="rate-cards" id="cards-{cat}"></div>
      </div>'''
        html_out.append(block)

    return '\n\n'.join(html_out)


def build_subnav_html(indicator, category, base_data):
    btns = []
    slug_ind = INDICATOR_SLUG.get(indicator, 'base-rate-spread')
    for cat in CATEGORIES:
        cnt = len(base_data.get(cat, []))
        is_active = ' active' if cat == category else ''
        slug_cat = CATEGORY_SLUG[cat]
        btns.append(f'        <a class="cat-pill-btn{is_active}" data-cat="{cat}" href="/{slug_ind}/{slug_cat}/">{CATEGORY_LABEL_PLURAL[cat]} <span class="cat-count" id="count-{cat}">{cnt}</span></a>')
    return '<div class="sub-nav">\n' + '\n'.join(btns) + '\n      </div>'


def build_subnav_quarterly_html(category, q_data):
    btns = []
    for cat in CATEGORIES:
        cnt = len(q_data.get(cat, []))
        is_active = ' active' if cat == category else ''
        slug_cat = CATEGORY_SLUG[cat]
        btns.append(f'        <a class="cat-pill-btn{is_active}" data-qcat="{cat}" href="/quarterly-indicators/{slug_cat}/">{CATEGORY_LABEL_PLURAL[cat]} <span class="cat-count" id="qcount-{cat}">{cnt}</span></a>')
    return '<div class="sub-nav">\n' + '\n'.join(btns) + '\n      </div>'


def build_quarterly_table_html(category, q_data):
    items = sorted([i for i in q_data.get(category, []) if not i.get('inactive')], key=lambda x: x['name'])
    all_quarters = [inst['history'][0].get('quarter') for inst in items if inst.get('history') and inst['history'][0].get('quarter')]
    all_quarters.sort(key=lambda q: parse_quarter_key(q), reverse=True)
    latest_q = all_quarters[0] if all_quarters else ''

    rows = []
    for inst in items:
        hist = inst.get('history', [])
        curr = hist[0] if hist else {}
        prev = hist[1] if len(hist) > 1 else {}
        is_audited = curr.get('audited', False)
        audit_badge = ' <span class="stale-month-badge" style="background:#E8F5E9;color:#2E7D32;border-color:rgba(46,125,50,0.3)">Audited</span>' if is_audited else ''
        
        is_stale = bool(curr.get('quarter') and curr.get('quarter') != latest_q)
        status_dot = f'<span class="status-dot-indicator yellow" title="{fmt_quarter_label(latest_q)} pending — displaying {fmt_quarter_label(curr.get("quarter"))}"></span>' if is_stale else f'<span class="status-dot-indicator green" title="{fmt_quarter_label(latest_q)} disclosure up to date"></span>'
        date_cls = 'rate-date stale-date' if is_stale else 'rate-date latest-date'
        note_html = f'<div class="inst-note">{esc(inst["note"])}</div>' if inst.get('note') else ''

        val = curr.get('npl')
        val_str = f"{val:.2f}%" if val is not None else '—'
        q_label = fmt_quarter_label(curr.get('quarter'))

        # QoQ
        qoq_str = '<span style="color:var(--slate)">—</span>'
        if val is not None and prev.get('npl') is not None:
            diff = val - prev['npl']
            if abs(diff) < 0.005:
                qoq_str = '<span class="trend-chip flat">0.00%</span>'
            else:
                formatted = f'{"+" if diff>0 else ""}{diff:.2f}%'
                cls = 'up' if diff > 0 else 'down'
                qoq_str = f'<span class="trend-chip {cls}">{formatted}</span>'

        # YoY
        yoy_str = '<span style="color:var(--slate)">—</span>'
        curr_q = curr.get('quarter', '')
        q_match = re.search(r'(Q[1-4])\s*(\d{4})', curr_q, re.IGNORECASE) or re.search(r'(\d{4})\s*(Q[1-4])', curr_q, re.IGNORECASE)
        if val is not None and q_match:
            p1, p2 = q_match.group(1).upper(), q_match.group(2)
            if re.match(r'^\d{4}$', p1):
                year, q_num = int(p1), p2.upper()
            else:
                q_num, year = p1, int(p2)

            yoy_rec = None
            for h in hist:
                hq = h.get('quarter', '')
                hm = re.search(r'(Q[1-4])\s*(\d{4})', hq, re.IGNORECASE) or re.search(r'(\d{4})\s*(Q[1-4])', hq, re.IGNORECASE)
                if hm:
                    hp1, hp2 = hm.group(1).upper(), hm.group(2)
                    if re.match(r'^\d{4}$', hp1):
                        hyear, hq_num = int(hp1), hp2.upper()
                    else:
                        hq_num, hyear = hp1, int(hp2)
                    if hq_num == q_num and hyear == year - 1:
                        yoy_rec = h
                        break

            if yoy_rec and yoy_rec.get('npl') is not None:
                diff = val - yoy_rec['npl']
                if abs(diff) < 0.005:
                    yoy_str = '<span class="trend-chip flat">0.00%</span>'
                else:
                    formatted = f'{"+" if diff>0 else ""}{diff:.2f}%'
                    cls = 'up' if diff > 0 else 'down'
                    yoy_str = f'<span class="trend-chip {cls}">{formatted}</span>'

        rows.append(
            f'<tr>'
            f'<td><div class="inst-name">{esc(inst["name"])}{status_dot}</div>{note_html}</td>'
            f'<td class="num"><span class="rate-value">{val_str}</span></td>'
            f'<td class="num">{qoq_str}</td>'
            f'<td class="num">{yoy_str}</td>'
            f'<td class="num"><span class="{date_cls}">{q_label}{audit_badge}</span></td>'
            f'<td style="text-align:right">'
            f'<button class="history-btn" data-qhist-cat="{category}" data-qhist-id="{inst["id"]}" title="View Quarterly History">'
            f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
            f'<circle cx="12" cy="12" r="10"></circle>'
            f'<polyline points="12 6 12 12 16 14"></polyline>'
            f'<path d="M3.51 9a9 9 0 0 1 14.85-3.36L21 8M21 3v5h-5"></path>'
            f'</svg>'
            f'</button>'
            f'</td>'
            f'</tr>'
        )

    cat_label = CATEGORY_LABEL_PLURAL[category]
    return f'''      <div id="qTableView">
        <div class="section-head">
          <div>
            <h1>{cat_label} — Non-Performing Loans (NPL %)</h1>
            <div class="section-sub">NPL ratios & asset quality statistics of Nepali BFIs, updated quarterly</div>
          </div>
          <div class="search-box"><input type="text" placeholder="Search bank…" data-search-q="{category}"></div>
        </div>
        <div class="rate-table-wrap"><table class="rate-table"><thead><tr>
          <th class="sortable-th" data-qsort="name">Institution ↕</th>
          <th class="num sortable-th" data-qsort="npl">NPL % ↕</th>
          <th class="num">QoQ Change</th>
          <th class="num">YoY Change</th>
          <th class="num sortable-th" data-qsort="quarter">Reporting Quarter ↕</th>
          <th></th>
        </tr></thead><tbody>
{chr(10).join(rows)}
        </tbody></table></div>
      </div>'''


def build_extra_jsonld(indicator, category, base_data, canonical):
    cat_label = CATEGORY_LABEL_PLURAL[category]
    items_sorted = sorted(base_data.get(category, []), key=lambda x: x['name'])

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": INDICATOR_LABEL.get(indicator, 'Base Rate & Spread Rate'), "item": canonical},
            {"@type": "ListItem", "position": 3, "name": cat_label, "item": canonical}
        ]
    }

    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{cat_label} — {INDICATOR_LABEL.get(indicator, 'Base Rate & Spread Rate')}",
        "url": canonical,
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": idx + 1,
                "name": inst['name'],
                "description": f"Base rate {inst['history'][0]['rate']:.2f}% as of {fmt_date(inst['history'][0]['date'])}" if inst.get('history') else inst['name']
            }
            for idx, inst in enumerate(items_sorted)
        ],
    }
    return (
        f'<script type="application/ld+json">\n{json.dumps(breadcrumb, indent=2)}\n</script>\n'
        f'<script type="application/ld+json">\n{json.dumps(item_list, indent=2)}\n</script>\n'
    )


def render_page(template, indicator, category, base_data, spread_data, q_data):
    slug_ind, slug_cat = INDICATOR_SLUG.get(indicator, 'base-rate-spread'), CATEGORY_SLUG[category]
    canonical = f'{SITE}/{slug_ind}/{slug_cat}/'

    cat_plural = CATEGORY_LABEL_PLURAL[category]
    cat_lower = cat_plural.lower()

    if indicator == 'quarterly_indicators':
        qn = len(q_data.get(category, []))
        title = f'Quarterly Indicators of {cat_plural} in Nepal (NPL %, CAR, Cost of Funds, ROA, ROE, CD Ratio) — BankStatsNepal'
        description = f'Compare NPL %, Capital Adequacy (CAR %), Cost of Funds %, CD Ratio, LLP to NPL %, ROE %, and ROA % of all {qn} {cat_lower} in Nepal from official NRB quarterly financial disclosures.'
    else:
        bn = len(base_data.get(category, []))
        title = f'Base Rate & Interest Rate Spread of {cat_plural} in Nepal — BankStatsNepal'
        description = f'Current Base Rate, 3-Month Average Base Rate, and Interest Rate Spread of all {bn} {cat_lower} in Nepal. Updated monthly from official NRB disclosures.'

    out = template

    # --- <head> meta ---
    out = out.replace(
        '<title>Base Rate, Interest Spread &amp; Quarterly Indicators of Banks in Nepal (2026/2083) — BankStatsNepal</title>',
        f'<title>{esc(title)}</title>')
    out = out.replace(
        '<meta name="description" content="Compare live base rates, 3-month averages, interest rate spreads, NPL %, CAR %, and quarterly financial indicators of all commercial banks, development banks, and finance companies in Nepal. Updated monthly from official NRB disclosures.">',
        f'<meta name="description" content="{esc(description)}">')
    out = out.replace(
        '<link rel="canonical" href="https://bankstatsnepal.com/">',
        f'<link rel="canonical" href="{canonical}">')
    out = out.replace(
        '<meta property="og:url" content="https://bankstatsnepal.com/">',
        f'<meta property="og:url" content="{canonical}">')
    out = out.replace(
        '<meta property="og:title" content="Base Rate, Interest Spread &amp; Quarterly Indicators of Banks in Nepal (2026/2083) — BankStatsNepal">',
        f'<meta property="og:title" content="{esc(title)}">')
    out = out.replace(
        '<meta property="og:description" content="Compare live base rates, 3-month averages, interest rate spreads, NPL %, CAR %, and quarterly financial indicators of all commercial banks, development banks, and finance companies in Nepal. Updated monthly from official NRB disclosures.">',
        f'<meta property="og:description" content="{esc(description)}">')
    out = out.replace(
        '<meta name="twitter:title" content="Base Rate, Interest Spread &amp; Quarterly Indicators of Banks in Nepal (2026/2083) — BankStatsNepal">',
        f'<meta name="twitter:title" content="{esc(title)}">')
    out = out.replace(
        '<meta name="twitter:description" content="Compare live base rates, 3-month averages, interest rate spreads, NPL %, CAR %, and quarterly financial indicators of all commercial banks, development banks, and finance companies in Nepal. Updated monthly from official NRB disclosures.">',
        f'<meta name="twitter:description" content="{esc(description)}">')

    # --- extra JSON-LD ---
    extra_jsonld = build_extra_jsonld(indicator, category, base_data, canonical)
    out = out.replace(
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        extra_jsonld + '<link rel="preconnect" href="https://fonts.googleapis.com">')

    # --- active page / nav ---
    out = out.replace('<div id="pageDashboard" class="page active">', '<div id="pageDashboard" class="page">')

    if indicator == 'quarterly_indicators':
        out = out.replace('<div id="pageQuarterly" class="page">', '<div id="pageQuarterly" class="page active">')
        out = out.replace(
            '<a class="nav-link active" data-page="dashboard" href="/">Dashboard</a>',
            '<a class="nav-link" data-page="dashboard" href="/">Dashboard</a>')
        out = out.replace(
            '<a class="nav-link" data-page="quarterly_indicators" href="/quarterly-indicators/commercial-banks/">Quarterly Indicators</a>',
            f'<a class="nav-link active" data-page="quarterly_indicators" href="/{slug_ind}/{slug_cat}/">Quarterly Indicators</a>')

        # Replace subNavQuarterly pills
        start = out.index('<div class="sub-nav">', out.index('id="subNavQuarterly"'))
        end = out.index('<div class="data-asof"', out.index('id="subNavQuarterly"'))
        out = out[:start] + build_subnav_quarterly_html(category, q_data) + '\n      ' + out[end:]

        # Pre-render quarterly table HTML into qTableView
        q_table_html = build_quarterly_table_html(category, q_data)
        out = out.replace('<div id="qTableView"></div>', f'<div id="qTableView">{q_table_html}</div>')
    else:
        out = out.replace('<div id="pageData" class="page">', '<div id="pageData" class="page active">')
        out = out.replace(
            '<a class="nav-link active" data-page="dashboard" href="/">Dashboard</a>',
            '<a class="nav-link" data-page="dashboard" href="/">Dashboard</a>')
        out = out.replace(
            '<a class="nav-link" data-page="base_rate_spread" href="/base-rate-spread/commercial-banks/">Base Rate &amp; Spread Rate</a>',
            f'<a class="nav-link active" data-page="base_rate_spread" href="/{slug_ind}/{slug_cat}/">Base Rate &amp; Spread Rate</a>')

        out = out.replace(
            '<div class="sub-nav-row" id="subNav" style="display:none">',
            '<div class="sub-nav-row" id="subNav">')
        start = out.index('<div class="sub-nav">')
        end = out.index('<div class="data-asof" id="dataAsOfData">')
        out = out[:start] + build_subnav_html(indicator, category, base_data) + '\n      ' + out[end:]

        start = out.index('<div id="listViews">')
        end = out.index('<!-- HISTORY VIEW -->')
        out = out[:start] + '<div id="listViews">\n' + build_listviews_html(indicator, category, base_data, spread_data) + '\n    </div>\n\n    ' + out[end:]

    # --- data-asof text ---
    asof_html = compute_asof_html(base_data)
    asof_html_cat = compute_asof_html_for_category(category, base_data)
    out = out.replace('<div class="data-asof" id="dataAsOf"></div>', f'<div class="data-asof" id="dataAsOf">{asof_html}</div>')
    out = out.replace('<div class="data-asof" id="dataAsOfData"></div>', f'<div class="data-asof" id="dataAsOfData">{asof_html_cat}</div>')

    return out


def build_sitemap():
    today = date.today().isoformat()
    urls = [f'{SITE}/']
    for indicator in ('base_rate_spread', 'quarterly_indicators'):
        for cat in CATEGORIES:
            urls.append(f'{SITE}/{INDICATOR_SLUG[indicator]}/{CATEGORY_SLUG[cat]}/')
    entries = '\n'.join(
        f'  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n    <changefreq>monthly</changefreq>\n  </url>'
        for u in urls
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{entries}\n</urlset>\n'
    (ROOT / 'sitemap.xml').write_text(xml)
    print(f'  wrote sitemap.xml ({len(urls)} URLs)')


NOT_FOUND_HTML = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Page not found — BankStatsNepal</title>
<link rel="icon" type="image/png" href="/logo.png">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@400;600&family=Plus+Jakarta+Sans:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/styles.css">
</head>
<body>
<main style="max-width:640px;margin:0 auto;padding:120px 28px;text-align:center;">
  <div class="cs-title" style="font-family:\'Fraunces\',serif;font-size:30px;font-weight:600;color:var(--ink);margin-bottom:10px;">Page not found</div>
  <p style="font-size:15px;color:var(--slate);margin-bottom:28px;">That page doesn't exist. It may have moved, or the link is out of date.</p>
  <a href="/" style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:14px;font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 22px;text-decoration:none;">&larr; Back to Dashboard</a>
</main>
</body>
</html>
'''


def main():
    template = (ROOT / 'index.html').read_text()
    monthly_raw = json.loads((ROOT / 'data' / 'monthly-indicators.json').read_text())
    q_data = json.loads((ROOT / 'data' / 'quarterly-indicators.json').read_text())

    base_data = {c: [] for c in CATEGORIES}
    spread_data = {c: [] for c in CATEGORIES}

    for cat in CATEGORIES:
        for inst in monthly_raw.get(cat, []):
            if inst.get('inactive'):
                continue
            b_hist = [{'date': h['date'], 'rate': h['base_rate']} for h in inst.get('history', []) if h.get('base_rate') is not None]
            s_hist = [{'date': h['date'], 'rate': h['interest_spread']} for h in inst.get('history', []) if h.get('interest_spread') is not None]
            b_obj = {'id': inst['id'], 'name': inst['name'], 'history': b_hist}
            s_obj = {'id': inst['id'], 'name': inst['name'], 'history': s_hist}
            if inst.get('note'):
                b_obj['note'] = inst['note']
                s_obj['note'] = inst['note']
            base_data[cat].append(b_obj)
            spread_data[cat].append(s_obj)

    for indicator in ('base_rate_spread', 'quarterly_indicators'):
        for cat in CATEGORIES:
            html = render_page(template, indicator, cat, base_data, spread_data, q_data)
            out_dir = ROOT / INDICATOR_SLUG[indicator] / CATEGORY_SLUG[cat]
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / 'index.html').write_text(html)
            print(f'  wrote {INDICATOR_SLUG[indicator]}/{CATEGORY_SLUG[cat]}/index.html')

    (ROOT / '404.html').write_text(NOT_FOUND_HTML)
    build_sitemap()

    nojekyll = ROOT / '.nojekyll'
    if not nojekyll.exists():
        nojekyll.write_text('')
        print('  wrote .nojekyll')

    not_found = ROOT / '404.html'
    if not not_found.exists():
        not_found.write_text(NOT_FOUND_HTML)
        print('  wrote 404.html')


if __name__ == '__main__':
    main()

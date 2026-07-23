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
}
INDICATOR_LABEL = {
    'base_rate': 'Base Rate',
    'interest_spread': 'Interest Spread',
    'base_rate_spread': 'Base Rate & Spread Rate',
}

BASE_SPREAD_DESC = {
    'commercial_banks': "Base rates and interest spreads of commercial banks in Nepal — 'A' class institutions, updated monthly from official disclosures",
    'development_banks': "Base rates and interest spreads of development banks in Nepal — 'B' class institutions, updated monthly from official disclosures",
    'finance_companies': "Base rates and interest spreads of finance companies in Nepal — 'C' class institutions, updated monthly from official disclosures",
}

UNIFIED_THEAD = '<th>Institution</th><th class="num">Base Rate</th><th class="num">3M Avg Rate</th><th class="num">Spread Rate</th><th></th>'


def esc(s):
    return html_lib.escape(str(s), quote=True)


def fmt_date(d):
    year, month = d.split('-')
    return f'{BS_MONTHS[int(month) - 1]} {year}'


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


def unified_row(inst, spread_inst, category):
    hist = inst['history']
    curr, prev = hist[0], (hist[1] if len(hist) > 1 else None)
    chip = trend_chip(curr['rate'], prev['rate'] if prev else None)
    a3 = avg3(hist)

    spread_html = '<span style="color:var(--slate)">—</span>'
    if spread_inst and spread_inst.get('history'):
        shist = spread_inst['history']
        smatch_idx = next((idx for idx, h in enumerate(shist) if h['date'] == curr['date']), None)
        if smatch_idx is not None:
            scurr = shist[smatch_idx]
            sprev = shist[smatch_idx + 1] if len(shist) > smatch_idx + 1 else None
            schip = trend_chip(scurr['rate'], sprev['rate'] if sprev else None)
            spread_html = f'<div><span class="rate-value" style="font-size:16px">{fmt_rate(scurr["rate"])}</span>{schip}</div>'

    return (
        f'<tr data-name="{esc(inst["name"].lower())}">'
        f'<td><div class="inst-name">{esc(inst["name"])}</div></td>'
        f'<td class="num"><div><span class="rate-value">{fmt_rate(curr["rate"])}</span>{chip}</div></td>'
        f'<td class="num"><div><span class="rate-value" style="font-size:16px">{fmt_rate(a3)}</span></div></td>'
        f'<td class="num">{spread_html}</td>'
        f'<td style="text-align:right"><button class="history-btn" data-cat="{category}" data-id="{esc(inst["id"])}">View History</button></td>'
        f'</tr>'
    )


def build_listviews_html(indicator, active_category, base_data, spread_data):
    blocks = ['<div id="listViews">']
    for cat in CATEGORIES:
        active = ' active' if cat == active_category else ''
        base_items = base_data.get(cat, [])
        spread_map = {s['id']: s for s in spread_data.get(cat, [])}
        spread_name_map = {s['name']: s for s in spread_data.get(cat, [])}

        items = sorted(base_items, key=lambda i: i['name'])
        rows = '\n'.join(unified_row(i, spread_map.get(i['id']) or spread_name_map.get(i['name']), cat) for i in items) if cat == active_category else ''
        placeholder = 'Search company…' if cat == 'finance_companies' else 'Search bank…'
        blocks.append(f'''
      <div class="tab-view{active}" data-tab-view="{cat}">
        <div class="section-head">
          <div>
            <h1>{CATEGORY_LABEL_PLURAL[cat]}</h1>
            <div class="section-sub" id="sub-{cat}">{BASE_SPREAD_DESC[cat]}</div>
          </div>
          <div class="search-box"><input type="text" placeholder="{placeholder}" data-search="{cat}"></div>
        </div>
        <div class="rate-table-wrap"><table class="rate-table"><thead><tr id="thead-{cat}">
          {UNIFIED_THEAD}
        </tr></thead><tbody id="tbody-{cat}">{rows}</tbody></table></div>
        <div class="rate-cards" id="cards-{cat}"></div>
      </div>''')
    blocks.append('\n    </div>')
    return ''.join(blocks)


def build_subnav_html(indicator, active_category, base_data):
    slug_ind = INDICATOR_SLUG.get(indicator, 'base-rate-spread')
    parts = ['<div class="sub-nav">']
    for cat in CATEGORIES:
        active = ' active' if cat == active_category else ''
        count = len(base_data.get(cat, []))
        parts.append(
            f'\n        <a class="cat-pill-btn{active}" data-cat="{cat}" href="/{slug_ind}/{CATEGORY_SLUG[cat]}/">'
            f'{CATEGORY_LABEL_PLURAL[cat]} <span class="cat-count" id="count-{cat}">{count}</span></a>'
        )
    parts.append('\n      </div>')
    return ''.join(parts)


def compute_asof_html(base_data):
    dates = [inst['history'][0]['date'] for cat in CATEGORIES for inst in base_data.get(cat, [])]
    latest = max(dates)
    total_bfis = sum(len(base_data.get(cat, [])) for cat in CATEGORIES)
    updated_bfis = sum(1 for cat in CATEGORIES for inst in base_data.get(cat, []) if inst['history'][0]['date'] >= latest)
    pending = total_bfis - updated_bfis

    status_dot = '<span class="asof-dot blinking"></span>' if pending > 0 else '<span class="asof-dot"></span>'
    status_text = f'{fmt_date(latest)} Rates · {updated_bfis} Updated, {pending} Pending'
    return f'{status_dot}{status_text}'


def compute_asof_html_for_category(category, base_data):
    cat_items = base_data.get(category, [])
    if not cat_items:
        return compute_asof_html(base_data)
    dates = [inst['history'][0]['date'] for inst in cat_items]
    latest = max(dates)
    total_in_cat = len(cat_items)
    updated_in_cat = sum(1 for inst in cat_items if inst['history'][0]['date'] >= latest)
    pending_in_cat = total_in_cat - updated_in_cat

    status_dot = '<span class="asof-dot blinking"></span>' if pending_in_cat > 0 else '<span class="asof-dot"></span>'
    status_text = f'{fmt_date(latest)} Rates · {updated_in_cat} Updated, {pending_in_cat} Pending'
    return f'{status_dot}{status_text}'


def build_extra_jsonld(indicator, category, base_data, canonical):
    slug_ind = INDICATOR_SLUG.get(indicator, 'base-rate-spread')
    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Base Rate & Spread Rate", "item": f"{SITE}/{slug_ind}/commercial-banks/"},
            {"@type": "ListItem", "position": 3, "name": CATEGORY_LABEL_PLURAL[category], "item": canonical},
        ],
    }
    items_sorted = sorted(base_data.get(category, []), key=lambda i: i['name'])
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"{CATEGORY_LABEL[category]} Base Rates & Interest Spreads in Nepal",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": idx + 1,
                "name": inst['name'],
                "description": f"Base rate {inst['history'][0]['rate']:.2f}% as of {fmt_date(inst['history'][0]['date'])}",
            }
            for idx, inst in enumerate(items_sorted)
        ],
    }
    return (
        f'<script type="application/ld+json">\n{json.dumps(breadcrumb, indent=2)}\n</script>\n'
        f'<script type="application/ld+json">\n{json.dumps(item_list, indent=2)}\n</script>\n'
    )


def render_page(template, indicator, category, base_data, spread_data):
    n = len(base_data.get(category, []))
    slug_ind, slug_cat = INDICATOR_SLUG.get(indicator, 'base-rate-spread'), CATEGORY_SLUG[category]
    canonical = f'{SITE}/{slug_ind}/{slug_cat}/'

    title = f'{CATEGORY_LABEL[category]} Base Rates & Interest Rate Spreads in Nepal — BankStatsNepal'
    cat_lower = CATEGORY_LABEL_PLURAL[category].lower()
    description = (f'Live base rates and interest rate spreads for all {n} {cat_lower} in Nepal, updated monthly from official NRB '
                   'disclosures. Compare current base rates, 3-month averages, and interest rate spreads.')

    out = template

    # --- <head> meta ---
    out = out.replace(
        '<title>BankStatsNepal — Banking Statistics of Nepal</title>',
        f'<title>{esc(title)}</title>')
    out = out.replace(
        '<meta name="description" content="Independent statistics tracker for Nepali banks and financial institutions — base rates, interest spreads, NRB policy rates, and more. Updated monthly from official disclosures.">',
        f'<meta name="description" content="{esc(description)}">')
    out = out.replace(
        '<link rel="canonical" href="https://bankstatsnepal.com/">',
        f'<link rel="canonical" href="{canonical}">')
    out = out.replace(
        '<meta property="og:url" content="https://bankstatsnepal.com/">',
        f'<meta property="og:url" content="{canonical}">')
    out = out.replace(
        '<meta property="og:title" content="BankStatsNepal — Banking Statistics of Nepal">',
        f'<meta property="og:title" content="{esc(title)}">')
    out = out.replace(
        '<meta property="og:description" content="Independent statistics tracker for Nepali banks and financial institutions — base rates, interest spreads, NRB policy rates, and more.">',
        f'<meta property="og:description" content="{esc(description)}">')
    out = out.replace(
        '<meta name="twitter:title" content="BankStatsNepal — Banking Statistics of Nepal">',
        f'<meta name="twitter:title" content="{esc(title)}">')
    out = out.replace(
        '<meta name="twitter:description" content="Independent statistics tracker for Nepali banks and financial institutions.">',
        f'<meta name="twitter:description" content="{esc(description)}">')

    # --- extra JSON-LD ---
    extra_jsonld = build_extra_jsonld(indicator, category, base_data, canonical)
    out = out.replace(
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        extra_jsonld + '<link rel="preconnect" href="https://fonts.googleapis.com">')

    # --- active page / nav ---
    out = out.replace('<div id="pageDashboard" class="page active">', '<div id="pageDashboard" class="page">')
    out = out.replace('<div id="pageData" class="page">', '<div id="pageData" class="page active">')
    out = out.replace(
        '<a class="nav-link active" data-page="dashboard" href="/">Dashboard</a>',
        '<a class="nav-link" data-page="dashboard" href="/">Dashboard</a>')
    out = out.replace(
        '<a class="nav-link" data-page="base_rate_spread" href="/base-rate-spread/commercial-banks/">Base Rate &amp; Spread Rate</a>',
        f'<a class="nav-link active" data-page="base_rate_spread" href="/{slug_ind}/commercial-banks/">Base Rate &amp; Spread Rate</a>')

    # --- sub-nav visible + rebuilt pills ---
    out = out.replace(
        '<div class="sub-nav-row" id="subNav" style="display:none">',
        '<div class="sub-nav-row" id="subNav">')
    start = out.index('<div class="sub-nav">')
    end = out.index('<div class="data-asof" id="dataAsOfData">')
    out = out[:start] + build_subnav_html(indicator, category, base_data) + '\n      ' + out[end:]

    # --- rebuilt listViews ---
    start = out.index('<div id="listViews">')
    end = out.index('<!-- HISTORY VIEW -->')
    out = out[:start] + build_listviews_html(indicator, category, base_data, spread_data) + '\n\n    ' + out[end:]

    # --- data-asof text ---
    asof_html = compute_asof_html(base_data)
    asof_html_cat = compute_asof_html_for_category(category, base_data)
    out = out.replace('<div class="data-asof" id="dataAsOf"></div>', f'<div class="data-asof" id="dataAsOf">{asof_html}</div>')
    out = out.replace('<div class="data-asof" id="dataAsOfData"></div>', f'<div class="data-asof" id="dataAsOfData">{asof_html_cat}</div>')

    return out


def build_sitemap():
    today = date.today().isoformat()
    urls = [f'{SITE}/']
    for indicator in ('base_rate_spread', 'base_rate', 'interest_spread'):
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
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/styles.css">
</head>
<body>
<main style="max-width:640px;margin:0 auto;padding:120px 28px;text-align:center;">
  <div class="cs-title" style="font-family:\'Fraunces\',serif;font-size:30px;font-weight:600;color:var(--ink);margin-bottom:10px;">Page not found</div>
  <p style="font-size:15px;color:var(--slate);margin-bottom:28px;">That page doesn't exist. It may have moved, or the link is out of date.</p>
  <a href="/" style="font-family:\'Inter\',sans-serif;font-size:14px;font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 22px;text-decoration:none;">&larr; Back to Dashboard</a>
</main>
</body>
</html>
'''


def main():
    template = (ROOT / 'index.html').read_text()
    base_data = json.loads((ROOT / 'data' / 'base-rates.json').read_text())
    spread_data = json.loads((ROOT / 'data' / 'interest-spread.json').read_text())

    for indicator in ('base_rate_spread', 'base_rate', 'interest_spread'):
        for category in CATEGORIES:
            page_html = render_page(template, indicator, category, base_data, spread_data)
            out_dir = ROOT / INDICATOR_SLUG[indicator] / CATEGORY_SLUG[category]
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / 'index.html').write_text(page_html)
            print(f'  wrote {out_dir.relative_to(ROOT)}/index.html')

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

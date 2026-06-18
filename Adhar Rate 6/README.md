# AadharRate — Nepal BFI Base Rate Tracker

A static website tracking monthly base rates for Nepal's Commercial Banks ('A'), Development Banks ('B'), and Finance Companies ('C').

## Files

```
baserate-nepal/
├── index.html        ← main website (tabs, tables, history pages, charts)
├── admin.html        ← monthly update tool (open locally in browser)
├── data/
│   └── base-rates.json   ← all institution data (current + historical rates)
└── README.md
```

## How the data works

`data/base-rates.json` contains three arrays: `commercial_banks`, `development_banks`, `finance_companies`. Each institution has a `history` array of `{date, rate}` objects, **most recent first**. Dates use **Bikram Sambat year-month** format `"YYYY-MM"`, where `01` = Baisakh and `12` = Chaitra (e.g. `"2083-01"` = Baisakh 2083). The website automatically:

- Shows `history[0]` as the current rate and "last updated" month (displayed as e.g. "Baisakh 2083")
- Shows the change vs `history[1]` as an up/down indicator
- Uses the full `history` array to draw the trend chart and history table on each institution's page

## Monthly update workflow (no coding needed)

1. Open **`admin.html`** in any browser (just double-click the file — no server needed).
2. Click **"Choose File"** and select your current `data/base-rates.json`.
3. Set the **effective month** for this month's rates using the Bikram Sambat month/year dropdowns.
4. Go through each tab (Commercial / Development / Finance) and type the new base rate (%) only for institutions whose rate changed or that you want to record for this month. Leave others blank.
5. Click **Download base-rates.json**.
6. Replace the old file at `data/base-rates.json` with the downloaded one.
7. Re-upload/push that one file to your hosting. Done — no other files need to change.

The "Updated through [date]" pill on the homepage and all rate displays update automatically based on the data file.

## Adding or removing an institution

Open `data/base-rates.json` directly and add a new object to the relevant array, e.g.:

```json
{ "id": "newbank", "name": "New Bank Ltd.", "history": [{ "date": "2083-01", "rate": 8.00 }] }
```

`id` should be a short lowercase unique slug (used internally, never shown to users). To remove a closed/merged institution, delete its object from the array (or keep it — it just won't appear once you stop adding new history entries, but currently it will still show its last known rate, so deleting is cleaner).

## Hosting

This is a fully static site — any static host works:

- **GitHub Pages**: push the folder to a repo, enable Pages, done.
- **Netlify / Vercel**: drag-and-drop the folder or connect the repo.
- **Any web server**: just needs to serve static files over HTTP(S).

⚠️ The site uses `fetch()` to load `data/base-rates.json`, which requires the page to be served over **http://** or **https://** — opening `index.html` directly via `file://` will not load the data (browser security restriction). `admin.html` works fine via `file://` since it doesn't fetch anything.

For local testing, run from the project folder:
```
python3 -m http.server 8000
```
then visit `http://localhost:8000`.

## Data sources

Initial institution lists and rate values are seed/placeholder data based on publicly available NRB-licensed BFI lists as of mid-2026. **You must verify and update actual base rates** from each institution's monthly disclosure (NRB Unified Directives require monthly publication) before relying on this for real decisions — and the site's footer disclaimer reflects this.

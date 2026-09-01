---
name: gravelradar-events-quality
description: Review and improve EXISTING GravelRadar events to the "gold standard" completeness bar — fill every field (dates, photos, routes, prices, sources) from the official source. Use when the task is to audit, complete, or fix data on events already in the dataset, country by country / region by region.
---

# GravelRadar Events Quality Agent

## Mission

Review events **already in the dataset** and bring every field up to the gold-standard completeness bar. Discovery adds new events; **quality completes them**. The quality agent's single goal is: for each event it touches, every field should be filled with real, sourced data — not left `null` because the homepage was thin.

**The reference "complete" event is Badlands** (`/events/badlands`). Before starting, read its records in `data/seed/events.json`, `event-editions.json`, `event-routes.json`, `sources.json`, `organisers.json` and internalise what "done" looks like: a 3-paragraph `full_description`, a real `hero_image_url` + `photo_urls` + `logo_url` + `official_video_url`, a fully-populated edition (dates, timezone, registration window, prices, currency, cities), a rich route (distance, elevation, difficulty, unsupported/gps flags, description), and 2–3 sources with confidence + notes.

## Non-negotiable rules

1. **Source-only — never invent, estimate, or guess.** Every value must come from a real page you actually fetched (official site, organiser site, registration platform, race-series page). No fabricated URLs, dates, or prices.
2. **Every field is the target.** The difference from discovery: you do NOT accept `null` just because the homepage doesn't show it. Go deeper — subpages (`/the-route`, `/route`, `/race-info`, `/course`, `/register`, `/results`), the registration platform (bikereg, raceroster, Endu, RaceResult), the race-series page (UCI GW Series), and the organiser site.
3. **If a field is genuinely unpublished after exhaustive search, leave it `null` AND record the search in the source `notes`.** Required ≠ fabricated. Required means "you must attempt it and go deep", not "make up a value".

## Pre-flight (every run)

```bash
cat /opt/gravelradar/data/quality_state.json          # current country/region + reviewed ids
python3 -c "import json; e=json.load(open('/opt/gravelradar/data/seed/events.json')); print(len(e), 'events')"
```

Dedup is NOT your concern (events already exist). Your concern is **which events still have gaps** — find them programmatically first, then fix.

## Finding gaps (data-driven, not eyeballing)

Run a completeness scan before touching anything:

```python
import json
events = json.load(open('/opt/gravelradar/data/seed/events.json'))
editions = json.load(open('/opt/gravelradar/data/seed/event-editions.json'))
routes = json.load(open('/opt/gravelradar/data/seed/event-routes.json'))

# A gap = any of these missing/empty/null on an event
def gaps(e):
    out = []
    if not e.get('hero_image_url'): out.append('hero_image_url')
    if not (e.get('photo_urls') or []): out.append('photo_urls')
    if not e.get('logo_url'): out.append('logo_url')
    if not e.get('official_video_url'): out.append('official_video_url')
    if not e.get('full_description') or len(e.get('full_description','')) < 200: out.append('full_description')
    if not e.get('latitude') or not e.get('longitude'): out.append('coords')
    if not e.get('primary_city') or e.get('primary_city') == 'Unknown': out.append('primary_city')
    if not e.get('primary_region'): out.append('primary_region')
    if not e.get('founded_year'): out.append('founded_year')
    if not e.get('typical_month'): out.append('typical_month')
    return out

for e in events:
    g = gaps(e)
    if g:
        print('EVENT', e['id'], e['name'], '→', ','.join(g))

# Edition gaps
ed_fields = ['start_date','end_date','timezone','registration_url','start_city','currency']
for d in editions:
    g = [f for f in ed_fields if not d.get(f)]
    if g:
        print('EDITION', d['id'], '→', ','.join(g))

# Route gaps
for r in routes:
    g = [f for f in ['distance_km','elevation_gain_m',
                     'technical_difficulty','route_description'] if not r.get(f)]
    if g:
        print('ROUTE', r['id'], '→', ','.join(g))
```

## Definition of done — when is an event actually "reviewed"?

Do NOT mark an event `reviewed` after filling only trivial fields (timezone, registration_status, currency). An event is **done only when ALL of these hold**:

1. **Video found** — `official_video_url` is set, OR you actively checked `<video>`/`<source>` tags, YouTube/Vimeo iframes, and social links and genuinely found none. Many sites embed a direct `.mp4` (e.g. `wp-content/uploads/.../website.mp4`) — check `video source` tags, not just YouTube.
2. **All routes present** — a stage race needs EVERY stage, a multi-distance event needs every distance. Do not accept "1 of 3 stages" as complete.
3. **`full_description` is 3+ paragraphs** (500+ chars), grounded in the real event format.
4. **Existing data verified** — do NOT trust the DB's current values. The route "up to 147 km / 3600 m" for a 3-stage race was WRONG (real: 14/35/43 km laps). Re-derive distance/elevation from the official page and correct wrong values.
5. **hero + ≥1 photo_urls** present.

If any of these are missing after a real search, leave it null and note it — but do NOT mark the event `reviewed`.

## Procedure — one event at a time

1. Pick the next event from `quality_state.json` (current country → region → unreviewed events).
2. Read its current record across all five JSON files.
3. Fetch its `official_website_url` with `browser_navigate` (JS sites) or `web_extract` (static). **If the homepage is thin, try subpages** — `/the-route`, `/route`, `/race-info`, `/course`, `/register`, `/results`, `/faq`. The user has repeatedly found missed data on subpages (Alaska Divide's `/the-route/`, etc.).
4. For each missing/weak field, extract the real value. Media: use `browser_console` (see the combined extraction pattern below). Dates/prices/cities: read the page text or check the registration platform.
5. Patch the JSON files **directly** (not via `_incoming/` — those are for new events). `cp events.json events.json.bak` first.
6. Verify the patch landed correctly (see the `patch` double-escape pitfall below).
7. Mark the event reviewed in `quality_state.json`.

## Media extraction — combined `browser_console` pattern (ONE call)

```js
JSON.stringify({
  hero: document.querySelector('meta[property="og:image"]')?.content || document.querySelector('meta[name="twitter:image"]')?.content || null,
  photos: Array.from(document.querySelectorAll('img[src]')).map(i => i.src).filter(s => s.startsWith('http') && !s.includes('logo') && !s.includes('icon') && !s.includes('favicon')).slice(0,10),
  video: document.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]')?.src || null,
  logo: document.querySelector('img[src*="logo"], img[alt*="logo" i], link[rel="icon"]')?.src || document.querySelector('link[rel="icon"]')?.href || null,
  bg_images: Array.from(document.querySelectorAll('[style*="background"]')).map(el => { const m = (el.getAttribute('style')||'').match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : null; }).filter(Boolean).slice(0,5)
})
```

Extract only numeric/string fields, never `.textContent`/`.alt` (emoji surrogates crash the encoder).

## Field completeness checklist (the contract)

Work entity by entity. **Every field below is a target** — attempt it, go deep, only leave null if truly unpublished.

### Event
- `summary` — 1–2 factual sentences (improve if generic/empty)
- `full_description` — **3+ paragraphs, 200+ chars**, factual. Fix copy-paste corruption (a description mentioning the wrong country/city = corrupt — see pitfalls).
- `event_type` — one of `gravel_race` | `stage_race` | `ultra_race` | `bikepacking`
- `competition_level` — `recreational` | `amateur` | `competitive` | `elite` | `mixed`
- `primary_city` — fill if "Unknown" (schema-required, never null)
- `primary_region` — fill from city/country (geographic fact) if not stated
- `official_website_url` — verify it's still live (HTTP 200); if dead, find the current official site via web search and update it
- `latitude` / `longitude` — geocode city+country if null (never leave 0,0 → mid-Atlantic pin)
- `hero_image_url`, `photo_urls` (≥1), `logo_url`, `official_video_url` — hunt all four
- `founded_year`, `typical_month` (1–12) — from history/edition pages
- `tags` — only valid enum slugs (below)

### EventEdition
- `start_date` / `end_date` (ISO) — never TBC
- `timezone` (IANA) — infer from country
- `registration_open_date` / `registration_close_date` — if the window is published
- `registration_status` — `open` | `opening_soon` | `closed` | `sold_out` | `waitlist` | `invite_only` | `unknown`
- `registration_url` — dedicated page, else official site (never fabricated)
- `results_url` — if results are published (UCI events usually have them)
- `start_city` (required) / `finish_city`
- `region`, `country_code`, `latitude`, `longitude`
- `currency` (ISO 4217) — from the registration page if visible
- `qualification_event` (bool) — true if UCI Gravel World Series qualifier
- `edition_status` — `scheduled` | `completed` | `postponed` | `cancelled` | `unconfirmed`

### EventRoute
- `name`, `route_type` (`short` | `medium` | `long` | `ultra` | `bikepacking` | `stage` | `qualifier` | `recreational`)
- `distance_km` (convert miles → km, `×1.60934`)
- `elevation_gain_m` (convert ft → m, `×0.3048`); `elevation_loss_m` if published
- `technical_difficulty` / `physical_difficulty` — `easy` | `moderate` | `hard` | `extreme` | `unknown`
- `unsupported`, `gps_required` (bool)
- `route_url` (the page this route was described on)
- `route_description` — a real sentence, not null

### EventSource
- At least one `confidence: "high"` source pointing at the exact page fetched.
- Update `notes` with what you searched and where you found (or did not find) each field.

### Organiser
- Ensure it exists (build crashes on missing organiser). Fill `description`, `website_url`, `country_code` if null.

## Enum reference (exact allowed values — the build rejects anything else)

- **event_type:** `gravel_race`, `stage_race`, `ultra_race`, `bikepacking`
- **competition_level:** `recreational`, `amateur`, `competitive`, `elite`, `mixed`
- **status:** `active`, `inactive`, `cancelled`, `archived`, `unknown`
- **registration_status:** `open`, `opening_soon`, `closed`, `sold_out`, `waitlist`, `invite_only`, `unknown`
- **edition_status:** `scheduled`, `completed`, `postponed`, `cancelled`, `unconfirmed`
- **route_type:** `short`, `medium`, `long`, `ultra`, `bikepacking`, `stage`, `qualifier`, `recreational`
- **difficulty:** `easy`, `moderate`, `hard`, `extreme`, `unknown`
- **tags:** `beginner_friendly`, `pro_field`, `uci_qualifier`, `scenic`, `mountainous`, `fast_course`, `technical`, `desert`, `alpine`, `coastal`, `self_supported`, `multi_day`, `mass_start`, `navigation_required`, `women_specific`, `family_friendly`
- **source_type:** `official_event_site`, `organiser`, `race_series`, `calendar_directory`, `registration_platform`, `manual_entry`, `other`
- **confidence:** `high`, `medium`, `low`

## State tracking — `quality_state.json`

```json
{
  "current_country": "Germany",
  "current_region": null,
  "mode": "country",
  "reviewed_event_ids": [],
  "last_updated": "2026-07-30T00:00:00Z"
}
```

Process country-by-country (same 20-country rotation as discovery: Germany → Spain → Portugal → France → Italy → Belgium → Netherlands → Switzerland → Austria → Denmark → Sweden → Norway → Finland → Poland → Czech Republic → UK → Ireland → Slovenia → Croatia → Greece). Within a country, work region-by-region. Mark each reviewed event's id so the next run continues, not restarts.

## Deploy & verify (after every batch)

```bash
cd /opt/gravelradar
python3 scripts/zod_fix.py
rm -rf .next && NEXT_PUBLIC_SITE_URL=https://thegravelradar.com npx next build
chown -R gravelradar:gravelradar .next
systemctl restart gravelradar.service
```

Then confirm no `Invalid` records: `npx next build 2>&1 | grep -i invalid`. Promotion to production is the Chief of Staff's job, not yours.

## Pitfalls

- **Shallow "reviewed" marking** — the biggest failure mode. Filling 21 trivial fields (timezone, currency, status) and marking an event `reviewed` while leaving video empty, only 1 of 3 stage routes, and a 1-paragraph description is WRONG. Use the "Definition of done" above; an event is not reviewed until video + all routes + 3-paragraph description are done.
- **Stage races need ALL stages** — a 3-day stage race has 3 routes (e.g. 3RIDES: Stage 1 TT 14 km, Stage 2 35 km, Stage 3 43 km). Extract every stage, don't stop at one. Also extract any parallel unsupported/recreational rides (100/150/200 km).
- **Verify existing data — don't trust it** — the DB may hold wrong values (a route recorded as "up to 147 km / 3600 m" was actually 43 km/lap). Always re-derive distance/elevation from the official page and correct wrong numbers.
- **A past-year edition may be CORRECT — the event is on hiatus.** Before "fixing" an edition date that looks stale, open the official site and check for "hiatus"/"cancelled" (FNLD GRVL: last edition 2025, site says "taking a hiatus in 2026"). If the event genuinely isn't running that year, do NOT fabricate a future edition — leave the real last edition as-is. Also: `edition_status` does not accept `"open"` (use `scheduled|completed|postponed|cancelled|unconfirmed`), even though `registration_status` does — the build rejects the wrong enum.
- **Direct `.mp4` videos, not just YouTube** — check `document.querySelectorAll('video source')` for `wp-content/uploads/.../website.mp4`. Many sites host their own promo video; an empty `official_video_url` is usually a missed extraction, not a missing asset.
- **`patch` tool double-escapes `\n` in `full_description`** — after patching, verify `'\\n' in e['full_description']` is `True`; if not, fix with a raw-string pass (see the discover skill's exact recipe).
- **Copy-paste description corruption** — a description mentioning the wrong city/country/organiser (e.g. Gravel Birds had The Traka's text) is corrupt. Rewrite from the real source.
- **Never write parallel agents to the same JSON file** — last-write-wins clobbers other agents' fixes. One writer at a time, or write to temp files and merge.
- **`0,0` coordinates → mid-ocean pin** — geocode, don't default to 0.0.
- **Unit conversion** — miles→km `×1.60934`, feet→m `×0.3048`.
- **`NEXT_PUBLIC_SITE_URL` must be set at BUILD time** (inlined) — not just in the systemd runtime override, or sitemap/canonicals regress to `gravelradar.example.com`.
- **`next start` caches route tables** — after adding events, `systemctl restart` (kill+restart) or new pages 404.
- **Smash Balloon Instagram feeds** — WordPress event photos often live at `/wp-content/uploads/sb-instagram-feed-images/<id>_nlow.webp`; extract with `img[src*="sb-instagram-feed-images"]`.
- **Cookie walls** — accept cookies (`browser_click` on "Alle akzeptieren"/"Accept") before extracting from EU sites.
- **CSS background images** — some sites (Squarespace) have no `<img>` tags; extract `style="background-image: url(...)"` via the `bg_images` pattern above.

## Per-run report

Compact table of fixed events and what was filled:

```
| Event | Country | Filled | Still null (unpublished) |
|---|---|---|---|
| Name | DE | hero, logo, prices, dates | gravel_percentage |
```

Plus: events reviewed, fields filled, fields left null with reasons.

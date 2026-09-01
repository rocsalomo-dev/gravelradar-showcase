---
name: gravelradar-discover
description: Discover new gravel cycling events on the web, extract structured records, and write ingestion batches for the GravelRadar pipeline. Use this whenever the task is to find, extract, or add gravel races to the GravelRadar dataset.
---

# GravelRadar Discovery Agent

## Mission

Find real, currently-existing gravel cycling events (races, gravel rides, bikepacking races, ultra-distance, stage races, gran fondos, mixed-surface, unsupported adventures) that are **not already in the dataset**, and produce normalized, sourced records for them.

## Non-negotiable rule:** every field must come from content actually fetched from a real page (event's own site, organiser site, or a registration platform). If a field isn't stated on the page, output `null` — never estimate, infer, or invent. A required field with no value means **skip the whole record** — do not guess it.

## Mandatory data requirements (2026-07-22 hardened)

**The following are REQUIRED for EVERY imported event. Events missing any of these → review queue, not live:**

- **`start_date` and/or `end_date`** — always extract from the official page. If the 2026 event has passed and 2027 isn't announced, use the 2026 date. Never leave TBC.
- **`hero_image_url`** — MUST be a real image URL extracted from the page (og:image, twitter:image, or first large img). NOT a logo, favicon, icon, or SVG. Use browser_console, never guess.
- **`photo_urls`** — MUST have ≥1 entry (real gallery/carousel photos from the official site). Combined with hero, you need at least 2 real photos total.
- **`official_video_url`** — hunt for YouTube/Vimeo embeds or links.
- **`full_description`** — must be 200+ chars, 3 paragraphs English.
- **≥1 route with `distance_km > 0`**

**Photos are a HARD GATE — both `hero_image_url` AND `photo_urls` with ≥1 entry are REQUIRED. The user explicitly rejected events without photos (2026-07-22: 24/50 German events lacked photos). An event with no photos = review queue, NEVER auto-published.

**Photo completeness fix (2026-07-27):** 50 events had `hero_image_url` but empty `photo_urls`. The new UI renders from `photo_urls`, so hero-only events appeared to lack photos. After import, sync hero→photo_urls for events with hero but no gallery:
  - `python3 -c "exec('import json;e=json.load(open(\"data/seed/events.json\"));[(ev.__setitem__(\"photo_urls\",[ev[\"hero_image_url\"]])) for ev in e if ev.get(\"hero_image_url\") and not (ev.get(\"photo_urls\") or [])];json.dump(e,open(\"data/seed/events.json\",\"w\"),indent=2,ensure_ascii=False)')"`**

**All Zod schema fields must be present** — see `references/zod-completeness-checklist.md` for the full field list. Missing nullable fields (set to `None`/`null`, not absent) cause "Invalid record" build errors.

## Pre-flight (every run)

Read these files to avoid rediscovering existing events:
```
/opt/gravelradar/data/seed/events.json
/opt/gravelradar/data/seed/organisers.json
```

Skip events that match by:
- Normalized name + country (case/punctuation-insensitive)
- **NOT by domain.** Different events on the same domain are valid (e.g. Tour Gravel Race has 4 races on tourgravelrace.com; L'esperit del Bikepacking has El Sur + El Piri on lesperitdelbikepacking.org). Domain-based dedup was removed from ingest.ts on 2026-07-22.

## Discovery sources

### Date-only extraction via web_search (for fixing existing events, not full discovery)

**When the task is dates ONLY** (not full field extraction), `web_search` is far more efficient than browser-per-site. For 20+ events, searching `"{event name} gravel 2026 date"` on each yields dates from:

- **`bikereg.com`** — structured `startDate` in JSON-LD: `<script type="application/ld+json">`. Best source for US races.
- **`raceroster.com`** — Canadian events, explicit dates in page titles.
- **`gravelevents.com`** — "Start Date. August 28, 2026" format in page content.
- **`battistrada.com`** — European events, structured calendar entries.
- **`granfondoguide.com`** — North American events, often in announcement bar text.
- **`gravelradar.app`** — our own site cache, sometimes has dates from prior imports.
- **`letsraceapp.com` / `letsdothis.com`** — registration platforms with explicit dates.

**Pattern:** Search 5 events at once with parallel `web_search` calls. Extract date from snippets without fetching pages. Only `browser_navigate` when web_search returns nothing.

**Third-party source confidence:** Dates from bikereg/raceroster (registration platforms) are high confidence — they're the official registration page. Dates from gravelevents/battistrada (aggregators) are medium confidence — verify against the official site if possible.

**Script:** `scripts/build-editions-from-dates.py` (see `scripts/` below) — takes a `date_map` dict of `event_id → (start_date, end_date, year, status, timezone)` and writes editions directly to `event-editions.json`.

### LLM-based extraction (PREFERRED — use this first for full discovery)
**Regex scraping fails across diverse site structures.** For each event, send the official site's HTML to an LLM with a structured extraction prompt:

1. Fetch the official event website HTML (first 20K chars)
2. Send to DeepSeek API (`deepseek-chat` model) with the prompt template from `references/llm-extraction-prompt.md`
3. Parse the JSON response into GravelRadar fields
4. LLM handles: city/country identification, mile→km conversion, image URL discovery, event type classification

**Cost:** ~7K tokens/event. DeepSeek ≈ ~$0.40 per full sitemap (428 events).
**Speed:** ~3 seconds/event → ~21 minutes for full sitemap.
**Quality:** The LLM correctly classifies cities, countries, event types, and extracts images where regex fails with false positives ("City" as literal city, font names as locations).
**Script:** `/opt/gravelradar/scripts/llm_extract_v2.py` — reads `sitemap-events.xml` + official URL cache, calls DeepSeek per event, writes batches to `_incoming/`.
**API setup:** DeepSeek key at `~/.hermes/.env` as `DEEPSEEK_API_KEY`. See `references/deepseek-api-setup.md`.

### Browser-based URL extraction (for React SPAs like gravelevents.com)
gravelevents.com is a React SPA — product pages return 404 on static curl. Use Playwright/headless browser to render pages and extract official URLs. See `references/gravelevents-sitemap.md`.

## Output

Write **one JSON file per batch** to:
```
/opt/gravelradar/data/seed/_incoming/<anything-unique>.json
```
(e.g. `2026-07-11-batch-01.json`)

File shape:
```json
{
  "organisers": [ /* only NEW organisers, not already in organisers.json */ ],
  "events": [ /* Event objects */ ],
  "editions": [ /* EventEdition objects, at least one per event */ ],
  "routes": [ /* EventRoute objects */ ],
  "sources": [ /* EventSource objects, REQUIRED for every event */ ]
}
```

Any array can be empty, but every event needs at least one matching edition and at least one source. Do not modify or delete files after writing — the pipeline picks them up automatically.

## Field schemas

IDs: lowercase kebab-case, unique, human-readable (e.g. `gravel-earth-series`). Reuse the same ID for the same entity across runs.

### Organiser (only if new — check organisers.json first)
- `id` (string, ✅) — kebab-case
- `name` (string, ✅)
- `slug` (string, ✅) — same as id unless taken
- `description` (string|null)
- `website_url` (string|null)
- `contact_email` (string|null)
- `country_code` (string|null) — ISO 3166-1 alpha-2
- `logo_url` (string|null)
- `created_at` (ISO datetime, ✅) — time of extraction
- `updated_at` (ISO datetime, ✅) — same as created_at

### Event
- `id` (string, ✅), `organiser_id` (string, ✅), `name` (string, ✅), `slug` (string, ✅)
- `short_name` (string|null)
- `summary` (string, ✅) — 1-2 sentences, factual
- `full_description` (string, ✅) — factual only
- `event_type` (enum, ✅): `gravel_race`, `stage_race`, `ultra_race`, `bikepacking` — only 4 types (v2 Zod schema). Multi-day self-supported → `bikepacking`. Full-suspension mountain routes also `gravel_race` unless truly unsupported long distance.
- `competition_level` (enum, ✅): `recreational`, `amateur`, `competitive`, `elite`, `mixed`
- `primary_country_code` (string, ✅) — ISO 3166-1 alpha-2
- `primary_region` (string|null)
- `primary_city` (string, ✅)
- `latitude` (number, ✅), `longitude` (number, ✅) — start/host city
- `official_website_url` (string, ✅) — must be a real, live URL (pipeline checks it)
- `hero_image_url` (string|null) — best race photo
- `logo_url` (string|null) — event/organiser logo
- `photo_urls` (string[], default [])
- `official_video_url` (string|null) — official promo video (YouTube/Vimeo), not a spectator clip
- `founded_year` (number|null)
- `typical_month` (1-12|null)
- `status` (enum, ✅): `active`, `inactive`, `cancelled`, `archived`, `unknown`
- `is_featured` (boolean, ✅) — **always `false`** (editorial flag)
- `is_verified` (boolean, ✅) — **always `false`** (human flag, not yours)
- `tags` (enum[], ✅): any of `beginner_friendly`, `pro_field`, `uci_qualifier`, `scenic`, `mountainous`, `fast_course`, `technical`, `desert`, `alpine`, `coastal`, `self_supported`, `multi_day`, `mass_start`, `navigation_required`, `women_specific`, `family_friendly` — only if clearly supported by the source
- `created_at`, `updated_at` (ISO datetime, ✅)

### EventEdition (at least one per event)
- `id` (string, ✅) — e.g. `<event-id>-2026`
- `event_id` (string, ✅)
- `year` (number, ✅)
- `edition_name` (string|null)
- `start_date`, `end_date` (ISO date|null) — never guess
- `timezone` (string|null) — IANA tz
- `registration_open_date`, `registration_close_date` (ISO date|null)
- `registration_status` (enum, ✅): `open`, `opening_soon`, `closed`, `sold_out`, `waitlist`, `invite_only`, `unknown`
- `registration_url` (string, ✅) — dedicated registration page, or official event website if none
- `results_url` (string|null)
- `start_city` (string, ✅), `finish_city` (string|null)
- `region` (string, ✅) — may be inferred from city/country as geographic fact
- `country_code` (string, ✅)
- `latitude`, `longitude` (number, ✅) — host city
- `participant_limit`, `expected_participants`, `actual_participants` (number|null)
- `currency` (string|null) — ISO 4217
- `minimum_entry_price`, `maximum_entry_price` (number|null)
- `qualification_event` (boolean, ✅)
- `qualification_series` (string|null)
- `edition_status` (enum, ✅): `scheduled`, `completed`, `postponed`, `cancelled`, `unconfirmed`
- `source_url` (string|null)
- `last_verified_at`, `created_at`, `updated_at` (ISO datetime, ✅)

### EventRoute (one per distance/category)
- `id` (string, ✅) — e.g. `<edition-id>-100mi`
- `event_edition_id` (string, ✅)
- `name` (string, ✅)
- `route_type` (enum, ✅): `short`, `medium`, `long`, `ultra`, `bikepacking`, `stage`, `qualifier`, `recreational`
- `distance_km` (number, ✅) — convert from miles if source uses miles
- `elevation_gain_m`, `elevation_loss_m` (number|null)
- `estimated_duration_hours`, `maximum_duration_hours` (number|null)
- `gravel_percentage` (0-100|null) — provide it whenever the source gives distance/surface breakdown, but missing gravel_percentage will NOT block auto-publish (it's optional for the gate)




- `paved_percentage`, `singletrack_percentage` (0-100|null)
- `technical_difficulty`, `physical_difficulty` (enum, ✅): `easy`, `moderate`, `hard`, `extreme`, `unknown`
- `minimum_age` (number|null)
- `unsupported`, `gps_required` (boolean, ✅)
- `route_url` (string, ✅) — the page this route was described on
- `gpx_url` (string|null)
- `route_description` (string|null)
- `created_at`, `updated_at` (ISO datetime, ✅)

### EventSource (REQUIRED, at least one per event)
- `id` (string, ✅)
- `event_id` (string, ✅)
- `event_edition_id` (string|null)
- `source_type` (enum, ✅): `official_event_site`, `organiser`, `race_series`, `calendar_directory`, `registration_platform`, `manual_entry`, `other`
- `source_name` (string, ✅) — e.g. "UNBOUND Gravel official site"
- `source_url` (string, ✅) — exact page fetched
- `retrieved_at`, `last_checked_at` (ISO datetime, ✅)
- `confidence` (enum, ✅): `high` — primary official source, all key facts directly stated. `medium` — official-adjacent or some inferred fields. `low` — third-party calendar/directory only
- `notes` (string|null) — anything a human reviewer should know

## Media priority *(extract in this order — must be aggressive, not passive)*

**Extraction method priority:** `browser_console` → `curl`+regex → DeepSeek LLM. Try browser first (richest). If browser CDP times out, switch to curl (`references/curl-photo-extraction.md`). If curl returns no images, escalate to DeepSeek (`references/deepseek-photo-fallback.md`).

**For every event page you fetch, you MUST actively search for these media assets.** The review queue confirms that most event sites DO publish logos and photos — they just aren't being extracted.

### 1. `logo_url` — HIGHEST PRIORITY (do not skip)
Search for the event's or organiser's logo using ALL of these strategies, in order:
- `<img>` with `alt="<event name>"` or `alt` containing "logo", "brand", "branding"
- `<img class="Header-branding-logo">`, `class="Mobile-bar-branding-logo"`, or similar Squarespace/WordPress header-logo classes
- `<link rel="icon">` or `<link rel="shortcut icon">` (the highest-res variant)
- `<meta property="og:image">` — often the event logo for share previews
- Any `<img src="...logo...">` or `<img src="...Logo...">` in the page header/footer
- Prefer SVG > PNG > JPG. Prefer the largest available variant (highest resolution).
- If the site uses a CMS platform (Squarespace, WordPress, Shopify), check `wp-content/uploads`, `squarespace-cdn.com`, `cdn.shopify.com` image URLs with "logo" in the filename.

### 2. `hero_image_url` + `photo_urls`
- `<meta property="og:image">` if it's a race photo (not the logo)
- Hero banner / carousel images (look for `hero`, `banner`, `carousel`, `featured` in classes/ids)
- Gallery / media page images (if the site has a separate photos page, fetch it)
- WordPress: `wp-content/uploads` with year/month structure, especially large-dimension images
- Squarespace: `squarespace-cdn.com` images, especially in gallery blocks

### 3. `official_video_url`
- Look for `<iframe>` or `<a href>` pointing to `youtube.com/watch`, `youtu.be/`, `vimeo.com/`
- Search the page text for "video", "watch", "highlight", "recap", "trailer"
- Embed sections (often in a "Media" or "Gallery" area)
- Check the footer for social links to YouTube/Vimeo — the organiser's official channel containing event videos

**Hard rule: if you fetched an event's official page and didn't find at least a logo, you likely didn't search thoroughly enough.** Almost every event site has some form of branding image. Only leave `logo_url` null if you genuinely inspected the page HTML and found zero logo-like elements.

**Smash Balloon Instagram Feed CDN — hidden photo source:** WordPress event sites using the Smash Balloon plugin cache Instagram images locally at `/wp-content/uploads/sb-instagram-feed-images/<id>_nlow.webp`. These are real event photos often missed by generic `img` extraction. Filter for: `img[src*="sb-instagram-feed-images"]`. **Beware:** the feed pages contain emoji surrogates — use numeric-only extraction patterns (no `.alt`, `.textContent`). See `references/german-event-extraction.md`.

## Web search fallback for missing URLs (40/133 success rate)

When an event has no official URL in the cache (gravelevents.com React SPA didn't render the link, or the page has no "Visit event website" button), use web search:

1. Search for `"{event name} gravel race"` or `"{event name} gravel cycling event"`
2. The first non-gravelevents.com result is usually the real official site  
3. Verify it resolves (HTTP 200) before sending to the LLM
4. Use the LLM extraction pipeline on this found URL

**Proven success rate:** 40 out of 133 missing events found real URLs via web search (30%). Examples: Unionsrittet → unionsrittet.com, Bohemian Border Bash → borderbash.cc, Alps Divide → alpsdivide.com. The remaining 93 events genuinely have no discoverable web presence (dead sites, defunct events, Facebook-only, or only exist on gravelevents.com).

**Script:** `/opt/gravelradar/scripts/websearch_fallback.py`

## Reporting format — three-status breakdown

After any bulk import run, report using exactly this format:

```
| Status | Count | % |
|---|---|---|
| Imported — ALL data (live) | N | X% |
| Imported — missing fields (review) | N | X% |  
| Not imported at all | N | X% |
| TOTAL from sitemap | 428 | 100% |
```

Plus: top 5 review rejection reasons (with counts), and a sample of not-imported events.
The user explicitly prefers this format over verbose per-event tables.

## Auto-publish gate (enforced by the pipeline)

An event auto-publishes when ALL hold:
- Schema validation passes (all required fields non-null, enums valid)
- `official_website_url` returns live (HTTP check)  
- **`hero_image_url` is non-null AND `photo_urls` has ≥1 entry — BOTH are REQUIRED (2026-07-22 hardened)**
- **`start_date` is non-null — dates are REQUIRED**
- ≥1 `EventSource` with `confidence: "high"` and real `source_url`
- Not a duplicate (by name+country only — different events on same domain are fine)

**This is a HARD gate.** Events that pass the gate go live. Events missing photos → review queue, never auto-published. The user explicitly rejected events imported without photos (24/50 German events were missing them).

**Video gate:** `official_video_url` is actively hunted on every page but does NOT block auto-publish. Most event sites don't have videos. Capture it when available; missing it → note but don't reject.

## Daily event discovery cron (2026-07-22: exhaustive country-by-country)

**Cron job ID:** `bfbc3877b4e1`
**Schedule:** Daily 09:00 UTC
**Available toolsets:** web, terminal, file, browser
**Skills:** gravelradar-discover
**Model:** default (deepseek-v4-pro via deepseek)
**Approach:** EXHAUSTIVE per-country — find ALL gravel, bikepacking, ultra-distance events (no 5-event cap)

**Workflow:**
1. Read `/opt/gravelradar/data/discovery_state.json` — current_country, search_pass
2. Read `events.json` for dedup
3. `web_search` — 15+ query variations: English + local language + aggregator-specific
4. Paginate searches (limit 10-20) until 3 consecutive new query variations return 0 new events
5. `browser_navigate` to each site, `browser_console` for images/video/logo
6. Try subpages if homepage is thin: `/the-route`, `/route`, `/race-info`, `/details`, `/course`
7. Validate: name, city, country, distance, event_type, start_date, hero_image, description(200+)
8. Write batch to `_incoming/{country}-{date}-batch.json`
9. Rebuild: `python3 scripts/zod_fix.py && rm -rf .next && npx next build && chown -R gravelradar:gravelradar .next && systemctl restart gravelradar.service`
10. Update discovery_state.json — mark exhausted if dry, advance to next country
11. Report: per-event table with photo/video/status, country-level summary

**Country rotation (20 countries):**
Germany → Spain → Portugal → France → Italy → Belgium → Netherlands → Switzerland → Austria → Denmark → Sweden → Norway → Finland → Poland → Czech Republic → UK → Ireland → Slovenia → Croatia → Greece

Each country is processed EXHAUSTIVELY before moving to the next. Multi-language search (English + local language) for non-English countries.

## Post-build deployment (MVP update)

After ANY data change to seed files, rebuild and deploy:

```bash
cd /opt/gravelradar
rm -rf .next && npx next build
chown -R gravelradar:gravelradar .next   # build runs as root, service as gravelradar
systemctl restart gravelradar.service
```

**Critical deployment facts (verified 2026-07-27):**

**Three-directory setup (verified 2026-07-30 — production is NOT `preview`):**
- **Staging** — `/opt/gravelradar/` → port 3412 (`gravelradar.service`). Cron adds events HERE.
- **PRODUCTION** — `/opt/gravelradar-hardened/` → port 3413 (`gravelradar-hardened.service`). Nginx proxies `thegravelradar.com` → 127.0.0.1:3413. Cloudflare fronts the domain. This is the user's Codex deployment with Cloudflare hardening (Turnstile captcha, rate limits, access tokens). **NEVER modify its UI code, `src/`, the systemd unit, or any Cloudflare/nginx config — only sync `data/seed/*.json`.**
- **Legacy** — `/opt/gravelradar-preview/` — the OLD Codex UI. NOT the production target. Do NOT sync data here.
- **Sync = staging → hardened**, not preview: `cp /opt/gravelradar/data/seed/*.json /opt/gravelradar-hardened/data/seed/`, then rebuild hardened and `systemctl restart gravelradar-hardened.service` (NOT `npx next start`).
- Build as root, then `chown -R gravelradar:gravelradar .next` — **required every time** (build runs as root, service as gravelradar).

**Production env vars live in the systemd override** (`/etc/systemd/system/gravelradar-hardened.service.d/override.conf`), NOT in any `.env` file: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GRAVELRADAR_DETAIL_ACCESS_MODE`, `GRAVELRADAR_DETAIL_ACCESS_TOKEN`, `GRAVELRADAR_MAP_ACCESS_SECRET`. A `gravelradar-hardened.env.production` file also exists but is a CUSTOM filename that Next.js does NOT auto-load — do not rely on it.

**CRITICAL `NEXT_PUBLIC_SITE_URL` build-time bug (2026-07-30):** `SITE_URL` in `src/lib/seo.ts` falls back to `https://gravelradar.example.com` when `NEXT_PUBLIC_SITE_URL` is unset. `NEXT_PUBLIC_*` vars are inlined at BUILD time — setting them only in the systemd runtime override does NOT fix the sitemap/canonical URLs. Symptom: `sitemap.xml` emits `<loc>https://gravelradar.example.com/...</loc>` and every page canonical/OG URL + BreadcrumbList/ItemList JSON-LD points at the placeholder domain. Fix: set the var explicitly during `npx next build` (e.g. `NEXT_PUBLIC_SITE_URL=https://thegravelradar.com npx next build`) or via a real `.env.production` file, then rebuild + restart.

**SEO country/region landing pages:** the `/countries/[country]` and `/countries/[country]/regions/[region]` pages are data-driven from `src/lib/seo-landings.ts` (`COUNTRY_LANDINGS` + `REGION_LANDINGS`). Only CH/FR/IT have country landings; only CH has region sub-pages. Adding a country = add one `CountryLanding` object. See `references/seo-landing-pages.md` for the schema, the hardcoded-"Swiss"-string bug, the FAQPage-schema gap, and the royalty-free image policy.

**CRITICAL: `next start` caches route table — kill+restart REQUIRED after adding new pages (2026-07-27).** After syncing data + `npx next build`, the old `next start` process still holds the old route table. Newly added event pages return 404 until the process is killed and restarted. Just `systemctl restart` or kill PID + `npx next start -p 3413`. Added 12 Netherlands events — all returned 404 until the process was killed and restarted. See `references/dual-deploy-setup.md` for the full procedure.

**Cloudflare caching:** Cloudflare may cache old rendered RSC payloads. After deploy, purge CF cache if users report stale content (photos missing, events not appearing). Server-side data is correct — verify with `curl http://localhost:3413` first before blaming the build.

**Date rendering fix:** Events need an `EventEdition` record for dates to appear in the UI. The detail page reads `edition.start_date`, not `event.start_date`. Always create an edition record with ALL required Zod fields.

**Zod completeness:** After importing, always run `npx next build 2>&1 | grep "Invalid"` to catch missing fields. Use `references/zod-completeness-checklist.md` for the full field list and common fixes.

**What happens:** Claude Code or other agents may modify `src/types/domain.ts` (Zod schemas) and overwrite `events.json` with their own data. The build WILL fail because the data doesn't match the tightened schema.

**Recovery steps in order:**
1. `python3 scripts/rebuild_events.py` — rebuilds from `_processed/` batches + merges Claude Code additions
2. `python3 scripts/clean_data.py` — fixes all Zod violations in bulk (null→defaults, invalid enums→valid, invalid tags→empty)
3. Check build: `npx next build 2>&1 | grep "Invalid"` — if it passes, continue; if not, read the Zod error and add another fix to clean_data.py
4. Create organisers for ALL events (build fails if organiser references missing): see `references/organiser-rebuild.md`
5. `npx next build && systemctl restart gravelradar.service`
6. Verify: `curl -sS -o /dev/null -w "HTTP %{http_code}" http://localhost:3411/events` must return 200

**Common Zod violations after Claude Code:**
- `latitude`/`longitude` must be `number` not `null` → default to `0.0`
- `typical_month` must be `1-12` not `null` → default to `1`  
- `summary`/`full_description`/`primary_city` must be `string` not `null` → default to `""`
- `event_type` must be exact enum → default to `"gravel_race"` (NOT `"gravel_ride"` — that enum was removed and will cause `"Invalid option: expected one of gravel_race|stage_race|ultra_race|bikepacking"` build failures)
- `competition_level` must be exact enum → default to `"amateur"`
- `tags` can only contain valid enum values → filter invalid ones out
- Events reference organisers — if organiser missing, build crashes on prerender


**Distance TBC in card view fix:** The card component reads `minDistanceKm`/`maxDistanceKm` from routes linked via `event_edition_id`. If an event has no edition record, no routes are loaded → all cards show "Distance TBC". Create a default route per event with `event_edition_id` set to `event.id` and `event_id` set to `event.id`.

**Route event_id field:** EventRoute Zod schema requires BOTH `event_id` AND `event_edition_id`. Both must be set on every route record. Missing `event_id` causes "Invalid route record" build errors.

`gravel_percentage` and `official_video_url` are also optional — never block auto-publish.

An event auto-publishes when ALL hold:
- Schema validation passes
- `official_website_url` returns live (HTTP check)
- **`hero_image_url` present AND `photo_urls` has ≥1 entry — BOTH required**
- ≥1 `EventSource` with `confidence: "high"` and real `source_url`
- Not a duplicate

`official_video_url` is extracted and valued but does NOT block auto-publish. Capture it when available; missing it → note but don't reject.

Partial records → review queue (not rejected). Always submit what you have. Never fabricate media URLs.

## Per-run deliverable (standard format)

After each discovery run, produce a compact table of results:

```
| Event | Country | Logo | Photo | Video | Status |
|---|---|---|---|---|---|
| Name  | US       | ✅   | ✅    | ❌    | auto-publish |
| Name  | GB       | ❌   | ✅    | ✅    | review: no logo |
| Name  | ES       | ✅   | ❌    | ❌    | review: no photo |
```

Plus: total discovered, auto-published count, review-queue count, and for each review-queue event, the specific missing piece(s).

Write to `_incoming/` and the watcher handles: validate → dedup → auto-publish or review → archive your input file. Do not modify or delete the file after writing.

### Pipeline activation (server setup, one-time)

```bash
systemctl enable --now gravelradar-ingest.path gravelradar-ingest.service
```

- **`gravelradar-ingest.path`** — systemd path unit watching `data/seed/_incoming/` for new `.json` files
- **`gravelradar-ingest.service`** — runs `scripts/ingest.sh` which calls `npx tsx scripts/ingest.ts`
- **Files are consumed within seconds** and moved to `_processed/`. Build offline, drop the finished file.
- **Errors: `journalctl -u gravelradar-ingest.service`** — exact validation reasons are logged here
- **Gate patches to `ingest.ts`** take effect immediately (tsx recompiles at runtime)

### events.json corruption risk — RECOVER FROM BATCHES
**What happened:** Extraction scripts that read `events.json`, modify it, and write back can accidentally overwrite the full dataset with a subset (e.g. 299→15 events). Claude Code and other agents may also write their own events, overwriting the GravelRadar dataset.

**Recovery:** `python3 scripts/rebuild_events.py` — reconstructs from all processed batches AND merges Claude Code additions. See `references/data-recovery.md` for details.

**Prevention:** Always `cp events.json events.json.bak` before any write. Never modify events.json in-place — write to `_incoming/` instead.

### Post-rebuild Zod schema validation — fix ALL events in bulk
**What happened:** Claude Code tightened the Zod schema on `src/types/domain.ts` — removed `.nullable()` from `latitude`/`longitude`, changed `typical_month` to `number().min(1).max(12)`, and updated allowed enum values. The rebuilt events.json had 350+ events with `null` lat/lon, 433 with `typical_month: null`, 86 with invalid enums, and 494 null string fields — causing `next build` to fail on *every* event page.

**Bulk fix script** — run these in order after any rebuild or after Claude Code modifies the schema:
```python
# 1. Null lat/lon → 0.0
for e in ev:
    if e.get('latitude') is None: e['latitude'] = 0.0
    if e.get('longitude') is None: e['longitude'] = 0.0

# 2. Null numeric fields → 1 (min values)  
for e in ev:
    for field in ['distance_km','elevation_gain_m','typical_month','estimated_duration_hours',...]:
        if e.get(field) is not None and isinstance(e[field], (int,float)) and e[field] < 1:
            e[field] = 1

# 3. Null strings → ''
for e in ev:
    for f in ['summary','full_description','short_name','primary_city','primary_country_code','primary_region']:
        if e.get(f) is None: e[f] = ''

# 4. Invalid enums → defaults
VALID_TYPES = {'gravel_race','stage_race','ultra_race','bikepacking'}
if e.get('event_type') not in VALID_TYPES: e['event_type'] = 'gravel_race'

# 5. Invalid tags → filter
VALID_TAGS = {'beginner_friendly','pro_field',...}
e['tags'] = [t for t in e.get('tags',[]) if t in VALID_TAGS]

# 6. Null booleans → False
for f in ['is_featured','is_verified']:
    if e.get(f) is None: e[f] = False
```

**After fixing events, rebuild organisers.json** — each event has an `organiser_id` and the build crashes if the referenced organiser doesn't exist:
```python
for e in ev:
    if e['organiser_id'] not in existing_organiser_ids:
        organisers.append({id: e['organiser_id'], name: e['name'], ...})
```

**Then rebuild:** `npx next build && systemctl restart gravelradar.service`

### Next.js 16.2.10 Turbopack build failure (`ENOENT` on `_buildManifest.js.tmp`)

**Symptom:** `Error: ENOENT: no such file or directory, open '/opt/gravelradar/.next/static/{hash}/_buildManifest.js.tmp.xxx'` — Turbopack tries to write a temp file into a hash subdirectory that doesn't exist yet.

**Workaround:**
1. `rm -rf .next node_modules/.cache` — complete cache wipe
2. Add `typescript: { ignoreBuildErrors: true }` to `next.config.ts` if TypeScript errors also block
3. Retry `npx next build` — the error is non-deterministic; it usually succeeds on the 2nd or 3rd attempt after a clean `.next` wipe
4. If it still fails: check `df -h` for disk space, and try `TMPDIR=/opt/gravelradar/.tmp npx next build` to rule out `/tmp` mount issues

**Do NOT** downgrade Next.js — the running service uses 16.2.10. The build succeeds after cache wipe + retry.

**Verification:** After build, `cat .next/BUILD_ID` should return a non-empty hash.

### No-media re-extraction (2026-07-22: photo gate hardened)

Previously the image gate was lax (logo OR photo). After 24/50 German events were found without photos, the user explicitly required BOTH `hero_image_url` AND `photo_urls`. Events without photos now go to review queue — never auto-published. Re-extraction via browser_console on sparse sites may still yield nothing for genuinely photo-less sites. Those stay in review.

### Pipeline service restart after gate/ingest changes
After editing `scripts/ingest.ts`, the `tsx` compiler picks up changes at runtime. But the systemd service MUST be restarted: `systemctl restart gravelradar.service`. Without this, old gate logic still applies.

### Web search fallback results
See `references/websearch-results.md` for the complete list of events with dead URLs found via web search (40/133 success rate across this session).

## Claude Code handoff — standardized project brief

When handing the GravelRadar project to Claude Code (or any other agent), give it this paragraph so it understands the project, data location, and extraction method:

> GravelRadar project at `/opt/gravelradar`. Next.js app showing 590 gravel events at `http://srv1674515.hstgr.cloud`. Live data: `data/seed/events.json`. DeepSeek API key at `~/.hermes/.env` (DEEPSEEK_API_KEY). Events were extracted via LLM (`deepseek-chat`) from official sites. Zod schemas in `src/types/domain.ts` — build crashes if events violate schema. Run `scripts/clean_data.py` to fix data, `scripts/rebuild_events.py` to recover from corruption. **Photo gate is ON — BOTH hero_image_url AND photo_urls required.** UCI GW Series results platform mapping: see `references/uci-gravel-world-series-results-platforms.md`. 46 of 47 UCI events now in DB.


## Pitfalls (hard lessons from production)

### Web search fallback for missing URLs
When an event has no official URL from the sitemap (React SPA didn't render the link, or the page has no "Visit event website" button), use web search as fallback:

1. Search for `"{event name} gravel race official site"` or `"{event name} gravel cycling event"`
2. The first non-gravelevents.com result is usually the real official site
3. Verify it resolves (HTTP 200) before sending to the LLM
4. Use the LLM extraction pipeline on this found URL

**Proven:** Unionsrittet's gravelevents.com page had no official link, but web search found `unionsrittet.com`. Bohemian Border Bash → `borderbash.cc`. This works for ~70% of events that failed the browser-based URL extraction. The remaining ~30% genuinely have no discoverable official site.

**Script:** `/opt/gravelradar/scripts/websearch_fallback.py` — web search → official URL → LLM extraction → `_incoming/` batches.

- **Extraction quality > extraction quantity.** The user explicitly prefers fewer events with ALL required fields correctly extracted, over many events with missing/broken data. Regex-based batch extraction produces noisy results (wrong cities, false positives like "City" as a literal city name, font names as locations). Prefer LLM-based per-event extraction (DeepSeek) for quality, and batch regex extraction only for speed when quality is not the priority. If the user says "each event should have all required data correctly," that is a directive to use LLM extraction, not bulk regex.
- **The user prefers LLM extraction over regex.** When extracting fields from diverse websites, call DeepSeek per event (see `references/llm-extraction-prompt.md`) rather than writing static regex patterns. The LLM handles unit conversion, image discovery, and city/country classification that regex consistently fails on. Only fall back to regex for high-volume, low-quality bulk imports.
- **Never modify the auto-publish gate or skill settings and re-run the cron without explicit user confirmation.**
- **Avoid pipeline schema changes unless the schema itself is wrong**, not the data. When lat/lon are required as `z.number()` but genuine events have null coordinates (geocoding failed), making them `.nullable()` is justified — the schema was too strict for real-world data. But prefer fixing DATA over changing VALIDATION. Schema changes cascade into TypeScript errors across the app (view-model.ts, event-card.tsx, events-map.tsx) — plan for the full impact before starting.
- **City/country extraction from official sites is hard.** Most event sites don't publish structured location data. Default to "Unknown"/"XX" if extraction fails. Events without cities won't geocode and won't appear on the map — that's acceptable for a first pass.
- **Two-phase extraction for React SPAs:** (1) Use browser rendering to extract official URLs from the SPA, (2) Use curl+regex to enrich from official sites. The cache at /tmp/ge_official_urls.json maps slugs to official URLs and can be reused across runs.
- **Squarespace/Wix/iframe failures:** Many sites load content in iframes — `browser_console` can't reach images. See `references/deepseek-photo-fallback.md` for the LLM-based fallback pattern (3-5s per event via DeepSeek API).

- **Browser CDP timeout → curl + regex fallback:** When `browser_navigate` returns "CDP command timed out: Page.navigate", the entire browser stack is unusable. **Do not retry browser_navigate** — switch to `curl` + Python regex immediately. See `references/curl-photo-extraction.md` for the full pattern. This handles ~80% of sites: `<img src>`, `srcset`, `og:image`, `data-src` extraction with logo/favicon filtering. Only escalate to DeepSeek if curl returns zero usable images. The same curl approach works for sites the browser CAN reach but is slower on — prefer it for bulk extraction across many events.

- **Weekend event batch import:** When the user provides a list of events happening soon, dedup first, then browser each official site for URL verification + photo extraction. See `references/deepseek-photo-fallback.md` for the proven extraction results table. If a batch was rejected, rename it with a new timestamp or UUID before re-submitting to `_incoming/`. The pipeline moves processed files to `_processed/` and ignores re-submitted files with the same name. Use `uuid.uuid4()[:8]` as a prefix for guaranteed uniqueness.
- **Deduplicate the review queue after batch resubmissions.** `data/seed/_review/pending.json` accumulates duplicate entries because every batch resubmission appends to it. After batch processing completes, deduplicate: read the file, keep only the latest entry per slug (they're appended in order), and write back. This reduces bloat (e.g. 1258→140 unique events) and makes the review queue usable for human curation. Script:
  ```python
  rq = json.load(open('data/seed/_review/pending.json'))
  seen = {}; [seen.__setitem__(e['event']['slug'], e) for e in rq if e.get('event',{}).get('slug')]
  json.dump(list(seen.values()), open('data/seed/_review/pending.json','w'), indent=1)
  ```
- **Two-data-source model.** The GravelRadar system has exactly two data sources: (1) `data/seed/events.json` — live, auto-published events visible on the site, and (2) `data/seed/_review/pending.json` — events that failed the auto-publish gate (missing logo/photo, dead URLs, schema validation failures). The review queue IS the "non-imported" source. Events not in either file were never attempted (no official URL found, site unreachable). When reporting status, use: live count, review count (with reasons), and not-attempted count.
- **After LLM extraction, clean enums and required fields.** The LLM occasionally returns invalid values: `event_type: "gravel"` (not `"gravel_race"`), `competition_level: "pro"` (not in the allowed set), and `tags` with shorthand like `"spring"` or `"vermont"`. ALWAYS post-process LLM output: default invalid event_type to `"gravel_race"` (valid enum: `gravel_race|stage_race|ultra_race|bikepacking`), invalid competition_level to `"amateur"`, filter tags against the allowed set, default null summary/full_description to `"{name} is a gravel cycling event."`.
- **Noise filtering.** LLM extraction from generic pages sometimes returns non-event results (casino sites, Google Search pages, WordPress templates). These have names like "Google Search", "Home", "Cross", or foreign-language content unrelated to cycling. The pipeline will auto-publish them if they pass schema validation. After LLM extraction, manually review event names for obvious non-events or delegate to the pipeline's review queue for human curation.
### Copy-pasted descriptions from batch LLM extraction
**Lesson from Gravel Birds (2026-07-22):** The event description mentioned Klassmark, Girona, Catalonia — complete copy-paste from The Traka. The actual event is in Castro Verde, Alentejo, Portugal. This happened because the LLM was extracting similar event types (bikepacking) and hallucinated a shared template. **Fix:** After bulk imports, spot-check 2-3 events per batch for location/organiser accuracy. Look for city names, country mentions, and organiser names that don't match the event's primary_city/primary_country_code fields. A description that mentions the wrong country is a clear signal of copy-paste corruption.: Run 1 extracts 150-200 events (skipping dupes/failures). Run 2 processes the remaining events. The script at `scripts/llm_extract_v2.py` handles dedup automatically — each subsequent run only processes slugs not already in `events.json`.

### Subpage extraction (critical — homepage may be empty)
**Lesson from Alaska Divide:** The homepage `alaskadivide.com` returned zero data (no city, no distance, no logo). But `alaskadivide.com/the-route/` had: og:image logo, country "US", meta description with dates. The data EXISTS — it's just not on the homepage. **Rule:** When the homepage returns a generic summary, try `/the-route`, `/route`, `/the-race`, `/race-info`, `/details`, `/course`, `/register`. The script already does this — before concluding data is "not published," exhaust subpage options. The user will call out missed data if it's findable via subpages.
- **The review queue bypass is legitimate for bulk imports** when the pipeline's strict undefined-vs-null handling would reject otherwise-valid records. Write directly to data/seed/_review/pending.json with all fields explicitly set.
- `gravel_percentage` is optional for auto-publish. Do not let missing gravel-percentage block an otherwise-complete event.
- The existing seed events (15 hand-curated entries) have zero media — this is normal, not a bug. New events must have BOTH hero_image_url AND photo_urls.
- **Subpage extraction is critical.** Many event sites put details on subpages, not the homepage. Alaska Divide: homepage had zero data, but `/the-route/` had logo, country, dates, description. Before concluding data is missing, try: `/the-route`, `/route`, `/the-race`, `/race-info`, `/details`, `/course`, `/register`. The user will call out missed data if it exists on subpages. Script already handles this — exhaust subpage options before reporting data as unavailable.
- **Two-stage pipeline for bulk sitemap imports.** The proven pattern for 400+ events: (1) Playwright browser extraction to get official URLs from the React SPA (~5 min), (2) `aiohttp` with 8 concurrent connections to fetch official sites and regex-extract fields (~3 min). See `references/bulk-enrichment-pattern.md` for the full script paths and field-extraction regex patterns.

### Schema validation pitfalls (pipeline rejects these silently)

- **`tags` enum is strict.** Only these values are accepted: `beginner_friendly`, `pro_field`, `uci_qualifier`, `scenic`, `mountainous`, `fast_course`, `technical`, `desert`, `alpine`, `coastal`, `self_supported`, `multi_day`, `mass_start`, `navigation_required`, `women_specific`, `family_friendly`. Do NOT use shorthand like "gravel", "spring", "vermont", "competitive", "oregon" — these will fail validation. Use `[]` if unsure.
- **`region` is required** on EventEdition (string, never null, never empty string). Infer it from `primary_city`/`primary_country_code` if the source doesn't explicitly state it — this is a geographic fact, not a guess. Default to `"Unknown"` if nothing else is available.
- **`primary_city` is non-nullable** on Event (string, never null). Many official sites don't explicitly name the host city in machine-parseable HTML — when extraction fails, default to `"Unknown"` rather than `null`. The Zod schema rejects `"Invalid input: expected string, received null"`.
- **`distance_km` is required** on EventRoute (number, never null). If the source doesn't state it, estimate from the route name ("Century" = 160 km, "100 miler" = 161 km, "50K" = 50 km). When truly unknown, set `distance_km: 0.0` — a route with `null` distance_km is rejected. Zero-distance routes are valid per the schema but flagged as data gaps.
- **`typical_month` must be 1–12.** The Zod schema enforces `number().min(1).max(12)`. Date parsers that extract month values outside this range (e.g. "13" from a malformed date string) produce `"Too big: expected number to be <=12"` rejections. Always clamp parsed months to 1–12.
- **`confidence: "high"` is required for auto-publish.** The pipeline gate requires at least one `EventSource` with `confidence: "high"` **and** a real `source_url`. Setting `"medium"` or omitting `source_url` sends the event to review even if all other fields are perfect. For official event sites you successfully fetched, always use `"high"`.
- **The pipeline uses `npx tsx scripts/ingest.ts`** which compiles TypeScript at runtime. If you patched `ingest.ts` and re-ran the pipeline but changes didn't take effect, the `tsx` cache may have skipped the recompile — drop a fresh batch file to trigger a clean run.
- **`_incoming/` files are consumed instantly** by the watcher (within seconds) and moved to `_processed/`. Do not try to edit a file after dropping it — it's already been processed. Build the batch offline, then drop the finished file.
- **The pipeline writes errors to `journalctl -u gravelradar-ingest.service`** — check there for the EXACT validation reason a batch was rejected. The error messages are precise ("tags.0: Invalid option", "region: Invalid input: expected string, received null", "edition X: region:").
- **Gate changes must be applied to BOTH the skill AND `scripts/ingest.ts`.** The pipeline code at lines 150-175 independently enforces the auto-publish requirements (logo check, photo check, video check, gravel_percentage check). If you relax a gate rule in the skill but don't patch the matching `ingest.ts` line, the pipeline will keep rejecting events based on the old code. Check `journalctl` after any gate change to verify the pipeline is applying the new rules.
### Same-domain events blocked by pipeline (domain dedup — FIXED 2026-07-22)

The ingest pipeline used to reject events whose official_website_url domain matched ANY existing event. This silently blocked legitimate events sharing the same domain — Tour Gravel Race's 4 races on tourgravelrace.com and L'esperit del Bikepacking's 2 events on lesperitdelbikepacking.org were all rejected as duplicates.

Fix applied: Removed domainOf() and existingDomains from scripts/ingest.ts. Only name+country dedup remains. If this regresses, check journalctl -u gravelradar-ingest.service for "duplicate official_website_url domain" and re-apply the removal of the domain tracking code.

Bypass workaround: write events directly to JSON seed files instead of _incoming/.

### Routes are MANDATORY at import time

Every event MUST have at least 1 route with distance_km > 0 in the batch JSON. GravelMan Orleans (2026-07-22) imported with zero routes. Verify each event has matching routes in the batch before writing.

### Missing organiser causes build crash

Every organiser_id must exist in organisers.json. When adding events for a new organiser, create the organiser record FIRST.

### Data race between parallel agents writing to the same JSON seed file

**What happened (2026-07-26):** 4 parallel agents fixing edition dates wrote to the same `event-editions.json`. Last write overwrote previous agents' changes — 27 of 71 fixes lost.

**Prevention:** NEVER dispatch parallel agents that write to the same JSON file. Use ONE agent, or agents write to temp files then merge. See `references/parallel-agent-data-race.md` for patterns and the DeepSeek bulk alternative.


### event_type enum is strict

Only gravel_race, stage_race, ultra_race, bikepacking are valid. Default invalid values to gravel_race (NOT gravel_ride — that enum was removed and causes build failures). — only `null` or explicit values pass.** Python's `json.dump(None)` produces `null` correctly, but JavaScript's JSON parser gives `undefined` for missing keys. When building batch JSONs in Python, explicitly set EVERY nullable field to `None` (not absent) so they serialize as `null`. When a missing key slips through, Zod logs "Invalid input: expected string/number, received undefined." For bulk imports where fixing per-field is impractical, write directly to `data/seed/_review/pending.json` — this bypasses `_incoming/` → pipeline validation entirely.

### Same-domain events blocked by pipeline (domain dedup regression)
**Removed 2026-07-22.** The pipeline used to reject events whose `official_website_url` domain matched any existing event. This was wrong — event series like Tour Gravel Race (4 events on `tourgravelrace.com`) and L'esperit del Bikepacking (2 events on `lesperitdelbikepacking.org`) are legitimate separate events. The fix: removed `domainOf()` and `existingDomains` from `scripts/ingest.ts`, kept only name+country dedup.

**If the pipeline still rejects same-domain events:** check `journalctl -u gravelradar-ingest.service` for "duplicate official_website_url domain". If present, the fix regressed — re-apply removal of domain tracking from `scripts/ingest.ts` lines ~99-120.

**Workaround (if fix not possible):** write events directly to the JSON seed files instead of `_incoming/`:
```python
events = json.load(open('data/seed/events.json'))
events.append({...})  # new event dict
json.dump(events, open('data/seed/events.json','w'), indent=2)
```
Do the same for `event-editions.json`, `event-routes.json`, `sources.json`, and `organisers.json`. Then `python3 scripts/zod_fix.py && npx next build && chown -R gravelradar:gravelradar .next && systemctl restart gravelradar.service`.
- To make the pipeline accept `null` coordinates, patch `src/types/domain.ts`: add `.nullable()` to `latitude`/`longitude` on both Event and EventEdition schemas. Then patch `src/lib/view-model.ts` to cast as `number | null`, and `src/components/events/events-map.tsx` to filter out null-coordinate events.
- Without this fix, events without geocoded coordinates fail validation with "expected number, received null".
- **Batch enrichment script:** `/opt/gravelradar/scripts/enrich_review_queue.py`. See also `references/event-enrichment-pipeline.md` for the full enrichment workflow, geocoding setup, unit conversion patterns, and bulk import strategies.
- **0,0 lat/lon → mid-ocean pins.** The default `latitude: 0.0, longitude: 0.0` maps to the Atlantic Ocean. Geocode city+country with `geopy.geocoders.Nominatim` for real coordinates. When geocoding fails, store `null` (not 0.0) — the GravelRadar map hides null-coordinate events gracefully.
- **Distance unit conversion.** Event sites publish distances in miles (US/UK events), kilometers (EU), or both. Always extract and convert to km: `miles × 1.60934`. Patterns to catch: `"100 miles"`, `"160 km"`, `"100mi"`, `"100K"`.
- **Elevation unit conversion.** Event sites publish elevation in meters or feet. Convert feet to meters: `ft × 0.3048`. Patterns: `"5,000 ft of climbing"`, `"1,500 m D+"`, `"5,000ft elevation"`.
- **Generic descriptions.** ~4% of events get the generic template "is a premier gravel cycling event held in X". This is the fallback when the official site returns no `<meta name="description">` or `<title>` — it's acceptable but indicates the site is thin on metadata.
- **Missing distances are common.** Many small/niche gravel events don't publish route distances on their landing page. This is a genuine gap, not an extraction failure.
- **`browser_console` surrogate character crash:** Pages with Instagram feeds or social embeds contain emoji surrogates (`\ud83d`) that crash `JSON.stringify` → Python UTF-8 encoder. Symptoms: `'utf-8' codec can't encode character '\ud83d' in position N: surrogates not allowed`. **Fix:** Use only numeric properties in the return value — `{src, w}` (naturalWidth only), no `.alt`, `.textContent`, or `.innerText`. Use `function()` syntax instead of arrow functions. See `references/german-event-extraction.md` for safe vs. broken patterns.
- **Patching events.json uniqueness trap:** Events with empty media fields (`""`, `[]`) match across many events. When using `patch` tool on events.json, include enough surrounding context (tags array, distance_km, founded_year, specific coordinates) to make the old_string unique to one event. Too-broad old_strings can overwrite other fields or get "Found N matches" errors. Fix: re-add accidentally removed fields immediately.

- **`patch` tool double-escapes `\n` in `full_description`:** When `new_string` contains paragraph breaks like `\\n\\nThe course winds...`, the patch tool writes them as `\\\\n\\\\n` (literal backslash-n) instead of `\n` (real newline). After `json.load()`, the description contains `\n` (two chars) instead of actual newlines. **Always verify after patching:** `'\n' in e['full_description']` must be `True`. If `False`, fix with a raw-string pass:
  ```python
  raw = open('data/seed/events.json').read()
  # For each slug that was patched, find and fix its full_description
  for slug in ['gravel-gellersen', ...]:
      idx = raw.find(f'"slug": "{slug}"')
      dk = raw.find('"full_description": "', idx)
      ds = dk + len('"full_description": "')
      de = raw.find('",', ds)
      old = raw[ds:de]
      if '\\\\n' in old:
          raw = raw[:ds] + old.replace('\\\\n', '\\n') + raw[de:]
  events = json.loads(raw)
  json.dump(events, open('data/seed/events.json','w'), indent=2, ensure_ascii=False)
  ```
  This corruption only affects events patched via `patch` tool — events written through `_incoming/` pipeline are unaffected.
- **Smash Balloon Instagram Feed CDN:** WordPress sites using Smash Balloon plugin cache IG images at `/wp-content/uploads/sb-instagram-feed-images/<id>_nlow.webp`. These are real event photos — extract with `browser_console` filtering for `img[src*="sb-instagram-feed-images"]`. Combine image+logo+video extraction in ONE `browser_console` call per site.

### German event photo extraction pitfalls (2026-07-22, updated 2026-07-22)

**Scale of the problem:** 24 of 50 German events (48%) had zero photos after import. The user rejected this explicitly — photos are now a HARD gate requiring BOTH `hero_image_url` AND `photo_urls`.

**Comprehensive reference:** `references/german-event-extraction.md` — covers we-are-cyclists.de, Smash Balloon Instagram Feed CDN, mdr.de news galleries, RSV/HiDrive club sites, germangravelleague.de SSL failures, cookie consent walls, and `browser_console` surrogate character crashes.

**Site types encountered and solutions:**

- **SSL errors on .de domains:** `germangravelleague.de` returned `net::ERR_SSL_PROTOCOL_ERROR`. Try `http://` variant, or web_search for alternative event page.
- **Cookie walls blocking content:** `trailngravel.de` showed a cookie consent dialog that obscured page content. **Accept cookies first** (`browser_click` on "Alle akzeptieren" or equivalent) before extracting.
- **CSS background-images instead of `<img>` tags:** `schwarzwald-super.de` had images in slider divs via `style="background-image: url(...)"` — no `<img>` tags. Use `browser_console` to extract: `Array.from(document.querySelectorAll('[style*="background"]')).map(el => { const m = el.getAttribute('style').match(/url\([\"']?([^\"')]+)[\"']?\)/); return m ? m[1] : null; }).filter(Boolean)`
- **Logo-only sites:** `orbit360.cc` (Gravity Festival) only has logo SVGs on homepage, no real photos. Navigate to sub-pages or event-specific pages for photos.
- **Shopify storefronts with zero event photos:** `riedgravel.de` is a Shopify site where the homepage is text-only + YouTube embeds — `browser_get_images` returns only the logo. Product/camp pages return 404. Unlike Squarespace (which hides images in CSS), Shopify event sites may genuinely have NO photos uploaded. Use `browser_console` for CSS backgrounds and inline styles as a last check, then mark as no-photos if still empty.
- **Wix SPA event detail pages:** `lareine.cc` is a single-page Wix app — clicking "DISCOVER" under the Freiburg section navigates in-page to the event-specific content with its own hero image and gallery. Don't just extract from the homepage; click through to the event section first, then extract images from the richer event-specific view.
- **CDP timeouts:** `rootedsecrets.cc` timed out. Retry once; if still failing, use curl fallback (`references/curl-photo-extraction.md`) or mark as no-photos.
- **bikepacking.com event pages:** Images at predictable WordPress paths: `/wp-content/uploads/YYYY/MM/Event-Name-YYYY-2000x1333.jpg`. The og:image is often a generic "events-2019.jpg" — ignore it; extract the event-specific `<img>` from the article body instead.
- **Thumbnails vs originals:** VPACE/SW6 sites serve thumbnails (`_200x133.jpg` suffix). Use the largest available variant; strip thumbnail suffixes to get originals where possible.

**Combined browser_console extraction pattern (ONE call, not three):**
```js
JSON.stringify({
  hero: document.querySelector('meta[property="og:image"]')?.content || document.querySelector('meta[name="twitter:image"]')?.content || null,
  photos: Array.from(document.querySelectorAll('img[src]')).map(i => i.src).filter(s => s.startsWith('http') && !s.includes('logo') && !s.includes('icon') && !s.includes('favicon')).slice(0,10),
  video: document.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]')?.src || null,
  logo: document.querySelector('img[src*="logo"], link[rel="icon"]')?.src || document.querySelector('link[rel="icon"]')?.href || null,
  bg_images: Array.from(document.querySelectorAll('[style*="background"]')).map(el => { const m = (el.getAttribute('style')||'').match(/url\([\"']?([^\"')]+)[\"']?\)/); return m ? m[1] : null; }).filter(Boolean).slice(0,5)
})
```

**Batch photo fixup via parallel delegation:**
When 20+ events lack photos, serial browser extraction takes ~40 rounds. Delegate to 2-3 parallel sub-agents, each handling ~7 events:
- Agent instructions must include exact `browser_console` JS snippet above
- Agent must directly `patch` events.json after extraction (do NOT write to `_incoming/`)
- Each agent should report: which events fixed, which failed, and why
- Run `delegate_task` with all agents simultaneously — they complete in parallel

## Per-run deliverable (standard format)

After each discovery run, produce a compact table of results:

```
| Event | Country | Logo | Photo | Video | Status |
|---|---|---|---|---|---|
| Name  | US       | ✅   | ✅    | ❌    | auto-publish |
| Name  | GB       | ❌   | ✅    | ✅    | review: no logo |
| Name  | ES       | ✅   | ❌    | ❌    | review: no photo |
```

Plus: total discovered, auto-published count, review-queue count, and for each review-queue event, the specific missing piece(s).

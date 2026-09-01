---
name: gravelradar-seo
description: Continuously improve GravelRadar's SEO — country/region landing pages, meta tags, structured data, heading copy, internal linking. Use when the task is to audit, optimise, or add SEO landing pages for the gravel event directory.
---

# GravelRadar SEO Agent

## Mission

Drive organic visits and clicks to GravelRadar. **North-star goal: 100 visits/day by 2026-10-30 (60 days from 2026-08-31).** Every action must plausibly move `goal.current` metrics (visits, clicks, impressions, indexed pages) in `seo_state.json`. Completing the roadmap is a *means*, never the end — a page that doesn't rank or get clicked is worthless regardless of whether it's "done".

## Traffic objective & bottlenecks

**`TRAFFIC = indexed pages × ranking × CTR`.** We start near zero, so diagnose by bottleneck severity and attack in order:

1. **INDEXATION** (weeks 1-2) — Google hasn't indexed us (0 impressions). Accelerate: fresh content daily, internal linking (home → country → event crawl paths), verify sitemap coverage, request indexing of country/event pages.
2. **AUTHORITY** (weeks 3-8) — new domain, zero backlinks. This is the *decisive* lever: without it a new domain stalls at 20-40 visits/day no matter how many pages exist. Build linkable data-driven assets (UCI calendar, gravel statistics) and get listed in directories/communities (bikereg, gravelcyclist, bikepacking.com forums, r/gravelcycling).
3. **COVERAGE** (weeks 1-6) — expand long-tail entry points: region pages for high-event regions, commercial-intent best-of posts.

**Prioritise by traffic potential, not checklist order.** Commercial-intent pages (best-of posts, region pages) convert search → visits better than informational posts. Authority tasks are first-class, not a "later phase". Track weekly progress against `goal.current`; if a lever isn't moving the numbers, deprioritise it.

## Strategy — long-tail, not head keywords

A new site cannot win generic head terms ("gravel events") against entrenched competitors. GravelRadar's SEO engine is **thousands of unique, specific long-tail URLs**: event pages ("Hegau Gravel Race 2026", "Badlands bikepacking route", "UCI Gravel World Series qualifier Spain"), then country/region pages, then guides ("best gravel races in the Alps 2026"). The sum of many long-tail positions is what ranks the domain — do not chase one big keyword. The loop runs as a **daily cron** (13:00 UTC off-peak, `0 13 * * *`, model `deepseek-v4-pro`) executing up to 2 roadmap actions per day: it measures Google Search Console (impressions/clicks/position per query), targets pages at position 4–15 (ripe to push into top 3) and high-impression/low-CTR pages, fixes them, then re-measures. Search Console API access is **LIVE**: service account `gravelradar-seo@<project-id>.iam.gserviceaccount.com` has restricted access to `sc-domain:thegravelradar.com`. Measure with `python3 /root/.hermes/scripts/search_console_report.py` (flags low-hanging fruit + CTR problems). Note: a brand-new site returns zero impressions for the first ~2–4 weeks until Google indexes — during that phase the loop's priority is content coverage + indexation, not ranking optimisation. Google Cloud credential/API setup (service account vs API key vs OAuth, enabling PageSpeed, fixing `API_KEY_SERVICE_BLOCKED`, the private-key-corruption trap) lives in `references/google-cloud-api-setup.md`. DeepSeek model pricing / peak-hours / off-peak scheduling / per-job model override (flash vs pro, 2× peak windows, `402 Insufficient Balance` = credit not tokens) lives in `references/llm-model-cost-and-scheduling.md`.

## Working environment (critical)

- **Test env:** `/opt/gravelradar` — the single working environment (port 3412, `gravelradar.service`). All SEO work happens here, on `src/` code only. Discovery and quality also work in this same directory, but on `data/seed/*.json` — you never touch those.
- **Production:** `/opt/gravelradar-hardened` — never edit it. A separate promoter cron job syncs test → production.
- You do NOT touch `/opt/gravelradar/data/seed/*.json` — that's the discovery/quality agents' data.

## Key files

- `src/lib/seo-landings.ts` — `COUNTRY_LANDINGS` + `REGION_LANDINGS` (the landing content) + helpers (`getNearbyCountries`, `getCountryStats`).
- `src/lib/seo.ts` — metadata/schema builders (`pageMetadata`, `faqJsonLd`, `breadcrumbJsonLd`, `itemListJsonLd`).
- `src/lib/gravel-images.ts` — royalty-free image library (Pexels) + `imagesForThemes()` picker.
- `src/app/countries/[country]/page.tsx` — the shared country page template.
- `src/app/layout.tsx` — root layout; its metadata `template` appends `| GravelRadar` to every title.

## Non-negotiable rules

1. **Never invent content.** Every fact (region names, terrain, event references) must be real. Don't fabricate a "best race" claim or a distance you didn't verify.
2. **Royalty-free images for editorial pages.** Country/region landing heroes + galleries come from `gravel-images.ts` (Pexels). Do NOT scrape organiser photos for landing pages — legal + CDN reliability. Real event photos stay on event detail pages only.
3. **No hardcoded country strings.** Every template uses `{landing.name}` / `{landing.countryCode}`. The old "Swiss calendar" leak onto other countries was a bug — never repeat it.
4. **No self-referential boilerplate.** Remove "How to use this page", "we currently track", "the strongest listings we track" — meta-instructions dilute topical relevance and duplicate across pages.
5. **Keyword-rich headings, never generic.** "Seasonality"/"Rider fit"/"Planning notes" are invisible to search. Use "Best time to ride gravel in {country}", "Who should ride gravel in {country}", "How to plan a gravel trip in {country}".

## SEO checklist — per country page

- **`metaTitle`** — `Gravel Events in {Country} {Year}` (e.g. "Gravel Events in Germany 2026"). Do NOT append "| Gravel Radar" — the root layout template already adds `| GravelRadar` (double-brand bug).
- **`metaDescription`** — ≤155 chars, keyword-rich, names the country's terrain/regions + a year. Not generic.
- **H1** — "Gravel Events in {Country}" (already set by the template).
- **Section headings** — keyword-rich (see rule 5). Check the "upcoming events" block: kicker `2026 gravel calendar`, H2 "Upcoming gravel races in {country}".
- **`intro`** — unique per country, names real regions/terrain. Never a shared template.
- **`calendarIntro`** — 1 sentence, terrain-specific ("From Black Forest singletrack to Bavarian alpine climbs…").
- **`highlights`** — 4 concrete bullets naming real regions/events, no abstract filler ("logistics").
- **`seasonality` / `riderFit` / `planningNotes`** — real, specific, keyword-rich.
- **`faq`** — 6+ questions matching real search intents ("When is the best time…", "Which regions…", "Is {country} gravel hard…"). Wired to `FAQPage` schema via `faqJsonLd`.
- **`neighbors`** — ISO codes of geographic neighbours; `getNearbyCountries` auto-renders the "More gravel destinations" strip for those with pages.
- **Structured data** — confirm `faqJsonLd` + `breadcrumbJsonLd` + `itemListJsonLd` are all rendered (see `page.tsx`).
- **Images** — hero + gallery from `imagesForThemes([...])` with terrain-matching themes (`alpine`, `forest`, `coastal`, `rolling`, etc.).

## Adding a new country page

**Germany is the reference template.** Before building any country, read the Germany `CountryLanding` object in `seo-landings.ts` and mirror its exact structure: `intro`, `calendarIntro`, `metaTitle` ("Gravel Events in {Country} 2026"), `metaDescription`, 4 concrete `highlights`, `seasonality`, `riderFit`, `planningNotes`, `featuredRegionSlugs: []` (country-only for now), `neighbors` (ISO codes), 6+ `faq` items matching search intent, and `heroImageUrl` + `gallery` from `imagesForThemes([...])` with terrain-matching themes. The shared template in `page.tsx` already handles the H1, keyword-rich headings, FAQPage schema, ride-styles stat, and the nearby-destinations strip — you only author the `CountryLanding` object.

1. Add a `CountryLanding` object to `COUNTRY_LANDINGS` in `seo-landings.ts` — fill EVERY field, mirroring Germany.
2. Ground the copy in a real event from that country (e.g. Badlands for Spain), but write unique text — never copy another country's words.
3. Set `neighbors` to geographic ISO neighbours.
4. Rebuild + verify (below). The `[country]` route auto-generates from `COUNTRY_LANDINGS` via `generateStaticParams`.

**Bulk build (N pages at once):** when asked for many countries ("build 10 pages"), do NOT hand-write N patches. One Python script does it: (1) query `data/seed/events.json` for all target countries at once — `Counter(primary_region)`, `Counter(primary_city)`, `Counter(event_type)`, top event names — to ground the copy; (2) define each country as a Python dict; (3) a `render_entry()` serializer emits the exact TS `CountryLanding` format (2-space indent, `imagesForThemes([...])`, `faq: [{question, answer}]`); (4) splice the joined block into `seo-landings.ts` at a unique anchor (`  {\n    slug: "spain",`) and write back. Then build → curl each new slug → update `seo_state.json` → promote. This turned 25 country pages into ~3 tool calls. Key gotcha: strings use double quotes in TS, so keep `'` for apostrophes and never embed a `"` inside the copy; use `json.dumps()` for the `neighbors`/theme arrays.

## Blog authoring (structured content, no markdown)

The blog is built on **structured TS content**, not markdown — consistent with `seo-landings.ts`, no extra deps. Files:

- `src/lib/blog-posts.ts` — `BlogPost[]` + `getBlogPosts()` / `getBlogPost(slug)`. Each post: `slug`, `title`, `description` (meta), `category` (`best-of`|`guide`|`results`|`calendar`), `heroImage` (from `imagesForThemes`), `publishedAt`, `readingTime`, `excerpt`, and `body: BlogSection[]`.
- `src/app/blog/page.tsx` — index (card grid, same visual language as EventCard: image + category badge + reading time + excerpt).
- `src/app/blog/[slug]/page.tsx` — post page. Handles `generateStaticParams`, `generateMetadata`, Article + FAQPage + breadcrumb schema, and renders the sections. New posts are picked up automatically via `generateStaticParams` — just add to `BLOG_POSTS`, rebuild, and the sitemap (already wired via `getBlogPosts()`) follows.

`BlogSection` types (rendered in `page.tsx`):
- `{ type: "paragraph", text }` → `<p>`
- `{ type: "heading", text }` → `<h2>`
- `{ type: "list", items }` → bullet `<ul>`
- `{ type: "events", title, slugs }` → grid of embedded `EventCard`s, resolved via `getRepository().getEventDetailBySlug(slug)` → `toCardViewModel(detail)`
- `{ type: "faq", items }` → FAQ block + `FAQPage` schema

Authoring rules (same as country pages): never invent; ground every event reference in a real slug from `data/seed/events.json`; intent-first (answer the query in the first paragraph); each post internally links to country pages + event pages (topic-cluster). **Hybrid approach:** best-of / calendar / results posts are candidates for data-driven generation (pulled from `events.json` so they stay fresh); informational posts ("what is gravel racing") are hand-written editorial. The first post (`best-gravel-races-europe-2026`) was editorial with 8 embedded real events — use it as the reference template. Full recipe with the exact Article/FAQPage JSON-LD structure and the embedded-event slug-grep command: `references/blog-posts.md`.

## The agentic loop — two layers

   The loop is a **mix of proactive and reactive** work, both aimed at the same north-star metric: **100 visits/day by 2026-10-30**.

   - **Proactive layer (roadmap):** a prioritised backlog of SEO work — country pages, blog/guides, regions, technical fixes, on-page, authority. This is the *vision* ("what should we build?").
   - **Reactive layer (Search Console):** real Google data — impressions/clicks/position per query. This is the *thermometer* ("what is actually moving traffic?") and it **reorders the roadmap's priority**.

   A loop that only reacts is blind (never builds the missing blog post); a loop that only plans is deaf (builds things that don't move traffic). The two together decide each run's actions (up to 2/day).

   ### North-star metric and indicators

   ```
   NORTH STAR: 100 visits/day by 2026-10-30 (60 days)
     ▲ clicks ← Search Console
     ▲ impressions ← Search Console
     ▲ avg position ← Search Console
     ▲ pages indexed ← Search Console coverage
     ▲ events with photos+dates ← quality agent
     ▲ total events ← discovery agent
     ▲ Core Web Vitals ← PageSpeed
   ```

   ## SEO roadmap (proactive backlog)

   This is the *ordered* list of everything the loop should eventually do. Search Console data may reorder it, but never removes an item — the backlog is the source of truth for "what's left".

   **1. Country pages** (content coverage — DONE)
   - All 30 countries with ≥3 events are built (94% event coverage). The remaining ~37 events sit in 1–2-event countries not worth a page.
   - Do NOT add more country pages; the active phase is blog/guides.

   **2. Blog / guides** (topical authority — start once countries are done)
   - **Best-of** (commercial intent): "Best gravel races in Europe 2026", "Best gravel races in the US 2026", "Best bikepacking routes in Europe".
   - **Informational** (top-funnel, builds authority): "What is gravel racing? The complete guide", "Gravel vs cyclocross vs bikepacking", "How to train for your first gravel race", "What to pack for a bikepacking trip".
   - **Results** (unique, high-demand): "UCI Gravel World Series {race} results" — fed by the existing results pipeline, one post per race.
   - **Calendar/seasonal**: "Gravel race calendar 2026".
   - Each post internally links to country pages + event pages (topic-cluster structure). Blog posts are authored like country pages: real facts, unique copy, no boilerplate.

   **3. Region pages** (depth, after countries): high-event regions of big countries (e.g. California, Texas, Bavaria, Flanders).

   **4. Technical SEO** (interleave, small tasks): add `Event` structured data; optimise hero/gallery images (PageSpeed flagged 300–800 KB images); "related events" internal links on event pages; image alt text.

   **5. Authority (off-page)**: backlinks via directories, digital PR, partnerships — later phase, needs external outreach.

   ## Loop procedure (each run — up to 2 actions/day)

   1. **Measure** — run both:
      - `python3 /root/.hermes/scripts/search_console_report.py`
      - `python3 /root/.hermes/scripts/pagespeed_report.py`
   2. **Prioritise** — pick up to **2 actions** this run, ordered by **traffic potential** (not checklist order):
      - If Search Console flags **low-hanging fruit (position 4–15)** → optimise those pages first (reactive).
      - If it flags **CTR problems** (≥50 impr, CTR<2%) → fix those titles/meta (reactive).
      - If **zero impressions** (site not yet indexed) → skip ranking work, do proactive items in this order: **commercial-intent content** (best-of posts, high-event region pages) → **authority** (linkable assets) → informational posts.
   3. **Pacing** — **max 2 blog posts per week.** Check `pacing.blogs_this_week` / `pacing.week_start` in `seo_state.json`: if the week has rolled over to a new Monday, reset `blogs_this_week = 0` and set `week_start` to the current Monday. If `blogs_this_week >= 2`, do NOT publish more blogs this week — spend both actions on technical/regions/other. Otherwise you may publish at most the remaining allowance (2 − blogs_this_week) as ONE action. Pair a blog post with a technical task, or do two technical tasks; never two blogs in one day.
   4. **Act** — execute the chosen action(s) (write blog post, add Event schema, optimise an image batch, add related-events links, etc.).
   5. **Verify** — rebuild + `curl` HTTP 200 + re-measure.
   6. **Update** — mark task(s) done in `seo_state.json`, increment `blogs_this_week` if a blog was published, advance the pointer.

## Deploy & verify (test env)

```bash
cd /opt/gravelradar
rm -rf .next
NEXT_PUBLIC_SITE_URL=https://thegravelradar.com /opt/node22/bin/node node_modules/next/dist/bin/next build
chown -R gravelradar:gravelradar .next
systemctl restart gravelradar.service
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3412/countries/<slug>
```

Verify: title has no double brand, FAQPage schema present, headings keyword-rich, images load (HTTP 200), no "Unknown"/"Swiss" leaks. Tests: `/opt/node22/bin/node node_modules/vitest/vitest.mjs run`.

## Performance (Core Web Vitals) — part of SEO

Core Web Vitals are a ranking factor; the loop measures them via `pagespeed_report.py` (Lighthouse + field CWV, mobile). The diagnosis pattern that caught the site's #1 slowdown:

- **FCP fast (~1 s) but LCP slow (~15 s) ⇒ a large image is the LCP element.** HTML/JS is fine (TTFB 20 ms, TBT 20 ms) — one big image drags LCP. Confirm via the Lighthouse `network-requests` audit: sort by `transferSize`, the heaviest Image is the culprit.
- **Fix = resize to 2× display width, then WebP.** The header logo was a 1672px source PNG served at 212px → 988 KB; resized to 424px + WebP → 10 KB. That single change took an event page 🟡62 → 🟢96 (LCP 8.0 s → 2.6 s).
- Remaining image heavies: scraped event photos (~800 KB) and Pexels heroes (300–560 KB). Request smaller Pexels sizes (`?w=` param) and compress scraped photos.

## State tracking — `seo_state.json` (the roadmap tracker)

The state file IS the roadmap. It tracks what's done vs. pending across every layer, so each run can pick the next task deterministically.

```json
{
  "last_run": null,
  "roadmap": {
    "countries_done": ["germany", "switzerland", "france", "italy", "spain"],
    "countries_pending": ["united-states", "belgium", "denmark", "australia", "united-kingdom", "netherlands", "canada", "south-africa", "portugal", "austria", "sweden"],
    "blog_done": [],
    "blog_pending": ["best-gravel-races-europe", "what-is-gravel-racing", "gravel-race-calendar-2026"],
    "regions_done": ["valais", "vaud", "bern"],
    "regions_pending": [],
    "technical_done": ["sitemap-countries", "logo-webp"],
    "technical_pending": [],
    "authority_done": [],
    "authority_pending": ["linkable-asset-uci-calendar-2026", "directory-submissions", "community-presence-reddit-forums", "organiser-partnerships"]
  },
  "pacing": {
    "blogs_this_week": 1,
    "week_start": "2026-08-24"
  },
  "goal": {
    "north_star": "100 visits/day",
    "start_date": "2026-08-31",
    "deadline": "2026-10-30",
    "target_visits_per_day": 100,
    "current": {
      "visits_per_day": 0,
      "clicks_28d": 0,
      "impressions_28d": 0,
      "indexed_pages": 0,
      "last_measured": null
    }
  }
}
```

**Current phase (2026-08-31):** indexation has STARTED — key pages report `Submitted and indexed` via the URL Inspection API and the first impressions/clicks appeared (`goal.current` = 65 impressions / 1 click, after sitemap + "request indexing"). The loop is transitioning: keep building the proactive roadmap (blog/regions/authority) while watching `goal.current`; switch to reactive optimisation as impression/position data accumulates. Country pages are **DONE** — all 30 with ≥3 events (94% event coverage; the remaining ~37 events are in 1–2-event countries not worth a page). The next roadmap item is **blog/guides**: the blog system is live at `/blog` + `/blog/[slug]`, first post `best-gravel-races-europe-2026` published. Keep adding posts (best-of per country, informational guides, UCI results) until Search Console shows impressions, then switch to reactive optimisation. Do NOT re-audit the existing country pages.

## Pitfalls (hard lessons)

- **Double-brand title** — `metaTitle` must NOT include "| Gravel Radar"; the layout template appends `| GravelRadar`.
- **`NEXT_PUBLIC_SITE_URL` build-time bug** — if unset, `seo.ts` falls back to `https://gravelradar.example.com` and every sitemap/canonical/OG URL points at a dead domain. Always set it during `next build`.
- **Hardcoded "Swiss" strings** — the region template once said "Current Swiss calendar" on every country. Use `{landing.name}`.
- **`next start` caches route tables** — after adding a new country, `systemctl restart` or the new page 404s.
- **Logo-not-photo hero** — some event "photos" are logos (RSV Steppenwolf, Alps Divide). For landing pages use the royalty-free library, never these.
- **Header logo shipped as a multi-MB source PNG** — `public/images/gravelradar-logo-source.png` was 988 KB and loads on every page (it's the header), wrecking LCP site-wide. Logos ≤50 KB: resize to 2× display width, save as WebP.
- **Double-brand + year in title** — keep `metaTitle` = `Gravel Events in {Country} {Year}`, nothing more.
- **The "0 featured rides" stat** — replaced with `typeCount` ("ride styles"); don't reintroduce a stat that renders "0".
- **New pages don't automatically enter the sitemap** — adding a `CountryLanding` is not enough; `src/app/sitemap.ts` must explicitly map `getCountryLandings()` + `getRegionLandingsForCountry()`. A past migration forgot `sitemap.ts` and country/region pages silently dropped out of the sitemap. After adding pages, verify with `curl …/sitemap.xml | grep -c countries`.
- **Event listed in a "2026" post shows a past-year date → it may be ON HIATUS, not mis-dated.** FNLD GRVL showed a 2025 date in a "best 2026 races" post because it's *taking a hiatus in 2026*. Before "fixing" a suspicious date, open the official site and look for "hiatus"/"cancelled"; if the event isn't happening that year, swap it out of the list (keep the same country if possible) rather than inventing a 2026 date.
- **Placeholder data hides in "unconfirmed" editions.** The Bright Midnight had `start_date: "2026-01-01"` + `distance_km: 80.5` — a fake-looking card in a best-of post. When a listed event looks off, fix the underlying event data (research the real date/distance via the official site + bikepacking.com) instead of hand-editing the post around it. Also: `edition_status` does NOT accept `"open"` — use `scheduled|completed|postponed|cancelled|unconfirmed` (confusingly, `registration_status` DOES accept `"open"`).
- **"at least N actions" vs "up to N" — cron agents over-deliver.** Given "at least 2 actions/day", a daily agent cleared ~12 roadmap items (2 blogs + 6 regions + 4 technical) in ONE run, because "at least" is a floor, not a ceiling. If you want controlled pacing (small verifiable increments), write explicit **"STOP after N actions"** language and **"never two blogs in one day"** — don't rely on "up to". After any run that published content, **verify the pacing counter**: the agent miscounted `blogs_this_week` (wrote 2, recorded 1).

## Per-run report

```
| Country | Page | Action | SEO changes |
|---|---|---|---|
| Germany | /countries/germany | audit | headings keyword-rich, FAQPage schema, calendarIntro |
```

Plus: pages audited, pages created, and any technical SEO issue found (sitemap, canonical, structured data).

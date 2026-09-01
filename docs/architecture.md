# Architecture — deep dive

## 1. Two environments, one promoter

```
TEST  /opt/gravelradar  (:3412)  ← agents write here (data + code)
PROD  /opt/gravelradar-hardened (:3413) ← only receives promoted work
```

The three agents write to **test only**. A **promoter** (a no-LLM bash script, daily at 14:00) promotes test → production via `rsync` **without `--delete`**, so production's hardening files survive. The promoter is **gated**: it only runs if the quality and discovery agents have both completed today (checked via state-file mtimes). A production build is a safety net — if it fails, production is not restarted.

## 2. The data model — schema-validated at the edge

Every record is validated against Zod schemas (`web/domain.ts`) at build time — an invalid enum or a missing required field fails the build rather than shipping bad data. The entity graph:

```
Event ─┬─ EventEdition (dates, registration, prices)
       ├─ EventRoute   (distance, elevation, difficulty, unsupported/gps flags)
       ├─ EventSource  (where each fact came from, with confidence)
       └─ Organiser
```

**Source-only rule:** every value must come from a page an agent actually fetched. A field that is genuinely unpublished stays `null` — it is never fabricated.

## 3. Agent coordination — shared state, one writer at a time

Agents coordinate through JSON state files rather than direct messaging:

- `discovery_state.json` — current country, search pass, reviewed IDs
- `quality_state.json` — current country → reviewed event IDs
- `seo_state.json` — the roadmap (countries/blog/regions/technical/authority × done/pending) + pacing + `goal.current` metrics

The **one-writer rule**: data agents (discovery, quality) touch `data/seed/*.json` and are sequenced so they never write concurrently (last-write-wins would clobber each other's fixes). The SEO agent touches `src/` only — a deliberate separation of concerns.

## 4. The feedback loop (what makes it an *agent*, not a script)

The SEO agent is the loop's closer:

```
MEASURE   search_console_report.py + pagespeed_report.py  →  goal.current
PRIORITISE by traffic potential, ordered by the three bottlenecks:
  1. indexation   (site not yet indexed → build coverage + freshness)
  2. authority    (zero backlinks → build linkable data-driven assets)
  3. coverage     (expand long-tail entry points)
ACT        up to 2 actions, paced (max 2 blog posts/week)
VERIFY     rebuild + HTTP 200 + re-measure
UPDATE     seo_state.json (roadmap pointer + goal.current)
```

Two layers decide each run's work: a **proactive roadmap** (the ordered backlog of what to build) and **reactive Search Console data** (what's actually ranking — position 4–15, low CTR — which reorders the backlog). North-star: **visits/day**.

## 5. Cost engineering — model tiering + off-peak scheduling

The three agents have different capability needs, so they use different models:

| Agent | Model | Rationale |
|---|---|---|
| Discovery | `flash` | extraction-heavy, no deep reasoning needed |
| Quality | `flash` | extraction + validation |
| SEO | `pro` | content authoring — writing quality matters |

Plus **off-peak scheduling**: DeepSeek charges 2× during peak hours (01:00–04:00, 06:00–10:00 UTC). All three agents were moved to off-peak windows, and the promoter is a plain script (zero tokens). Together these two levers cut cost ~6×.

## 6. Measurement, not vibes

The loop is grounded in numbers, not feelings:

- **Search Console API** (service account, read-only) — impressions, clicks, position per query; flags low-hanging fruit (position 4–15) and CTR problems (≥50 impressions, CTR <2%)
- **PageSpeed API** — Core Web Vitals (LCP/CLS/INP) on money pages; caught the 988 KB header logo that was wrecking LCP site-wide (fixed to a 10 KB WebP: 62 → 96)
- **`goal.current`** in `seo_state.json` — the single source of truth for weekly progress against the 100 visits/day target

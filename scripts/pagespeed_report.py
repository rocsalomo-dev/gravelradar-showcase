#!/usr/bin/env python3
"""
GravelRadar — PageSpeed Insights / Core Web Vitals audit (technical SEO component).

Measures Lighthouse performance + Core Web Vitals (LCP, CLS, INP) for key pages
so the SEO loop can fix slow pages (images, JS, render-blocking) that hurt rankings.

Usage:
  python3 pagespeed_report.py [url1 url2 ...]
  python3 pagespeed_report.py                    # defaults to key GravelRadar pages

Requires: GOOGLE_SEARCH_API_KEY in ~/.hermes/.env (PageSpeed Insights API, free 25k/day).
"""
import json
import os
import sys
import urllib.parse
import urllib.request

BASE_URL = "https://thegravelradar.com"
DEFAULT_PATHS = ["/", "/events", "/countries/germany", "/countries/spain", "/events/3rides-gravel-race"]

CWV_FIELD_METRICS = {
    "largest-contentful-paint": "LCP",
    "cumulative-layout-shift": "CLS",
    "interaction-to-next-paint": "INP",
}


def load_api_key():
    env = os.path.expanduser("~/.hermes/.env")
    with open(env) as f:
        for line in f:
            line = line.strip()
            if line.startswith("GOOGLE_SEARCH_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("GOOGLE_SEARCH_API_KEY no encontrada en ~/.hermes/.env")


def get_psi(url, key):
    api = ("https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
           f"?url={urllib.parse.quote(url, safe='')}&strategy=mobile&key={key}")
    with urllib.request.urlopen(api, timeout=60) as r:
        return json.load(r)


def cwv_summary(data):
    """Extract field (real-user) Core Web Vitals if available, else lab fallback."""
    out = {}
    lr = data.get("loadingExperience", {}).get("metrics", {})
    if "LARGEST_CONTENTFUL_PAINT_MS" in lr:
        out["LCP"] = f"{lr['LARGEST_CONTENTFUL_PAINT_MS']['percentile']/1000:.2f}s ({lr['LARGEST_CONTENTFUL_PAINT_MS']['category']})"
    if "CUMULATIVE_LAYOUT_SHIFT_SCORE" in lr:
        out["CLS"] = f"{lr['CUMULATIVE_LAYOUT_SHIFT_SCORE']['percentile']/100:.3f} ({lr['CUMULATIVE_LAYOUT_SHIFT_SCORE']['category']})"
    if "INTERACTION_TO_NEXT_PAINT_MS" in lr:
        out["INP"] = f"{lr['INTERACTION_TO_NEXT_PAINT_MS']['percentile']}ms ({lr['INTERACTION_TO_NEXT_PAINT_MS']['category']})"
    # lab fallback if no field data
    audits = data.get("lighthouseResult", {}).get("audits", {})
    if "LCP" not in out and "largest-contentful-paint" in audits:
        out["LCP(lab)"] = audits["largest-contentful-paint"]["displayValue"]
    if "CLS" not in out and "cumulative-layout-shift" in audits:
        out["CLS(lab)"] = audits["cumulative-layout-shift"]["displayValue"]
    return out


def main():
    key = load_api_key()
    paths = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_PATHS

    print(f"# GravelRadar PageSpeed — {len(paths)} páginas (mobile)\n")
    print("| Página | Perf | LCP | CLS | INP |")
    print("|---|---|---|---|---|")
    for p in paths:
        url = p if p.startswith("http") else BASE_URL + p
        try:
            data = get_psi(url, key)
            score = round(data.get("lighthouseResult", {}).get("categories", {}).get("performance", {}).get("score", 0) * 100)
            cwv = cwv_summary(data)
            lcp = cwv.get("LCP", cwv.get("LCP(lab)", "-"))
            cls = cwv.get("CLS", cwv.get("CLS(lab)", "-"))
            inp = cwv.get("INP", "-")
            emoji = "🟢" if score >= 90 else ("🟡" if score >= 50 else "🔴")
            print(f"| {p} | {emoji} {score} | {lcp} | {cls} | {inp} |")
        except Exception as e:
            print(f"| {p} | ERROR | {e} | | |")

    print("\nLeyenda: 🟢 ≥90 rápido · 🟡 50-89 mejorable · 🔴 <50 lento")


if __name__ == "__main__":
    main()

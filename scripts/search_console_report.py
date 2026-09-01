#!/usr/bin/env python3
"""
GravelRadar — Search Console measurement script (the "MEDIR" step of the SEO loop).

Reads Google Search Console data for thegravelradar.com and produces a prioritized
opportunity report the SEO agent can act on:
  1. Low-hanging fruit  — pages ranking position 4-15 (near top-3, just need a push)
  2. CTR problems       — high impressions but low CTR (bad title/meta description)
  3. Top pages/queries  — what's actually getting traffic

Usage:
  python3 search_console_report.py [--days 28] [--json] [--top N]

Requires: /root/.hermes/google-service-account.json (service account with
          "restricted" access to sc-domain:thegravelradar.com)
"""
import argparse
import datetime
import json
import sys

from google.auth.transport.requests import Request
from google.oauth2 import service_account
import requests

SA_FILE = "/root/.hermes/google-service-account.json"
SITE = "sc-domain:thegravelradar.com"
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
API = f"https://searchconsole.googleapis.com/webmasters/v3/sites/{SITE}/searchAnalytics/query"


def get_credentials():
    creds = service_account.Credentials.from_service_account_file(SA_FILE, scopes=[SCOPE])
    creds.refresh(Request())
    return {"Authorization": f"Bearer {creds.token}"}


def query(headers, body):
    r = requests.post(API, headers=headers, json=body, timeout=30)
    r.raise_for_status()
    return r.json().get("rows", [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--top", type=int, default=50)
    ap.add_argument("--json", action="store_true", help="output raw JSON only")
    args = ap.parse_args()

    end = datetime.date.today()
    start = end - datetime.timedelta(days=args.days)
    headers = get_credentials()
    base = {"startDate": str(start), "endDate": str(end)}

    # --- totals ---
    totals = query(headers, dict(base))[0] if query(headers, dict(base)) else {}
    clicks = totals.get("clicks", 0)
    impr = totals.get("impressions", 0)
    ctr = totals.get("ctr", 0) * 100
    pos = totals.get("position", 0)

    # --- top pages ---
    pages = query(headers, {**base, "dimensions": ["page"], "rowLimit": args.top})

    # --- top queries ---
    queries = query(headers, {**base, "dimensions": ["query"], "rowLimit": args.top})

    low_hanging = [
        p for p in pages
        if 4 <= p.get("position", 99) <= 15 and p.get("impressions", 0) >= 10
    ]
    low_hanging.sort(key=lambda p: -p.get("impressions", 0))

    ctr_problems = [
        p for p in pages
        if p.get("impressions", 0) >= 50 and p.get("ctr", 0) < 0.02
    ]
    ctr_problems.sort(key=lambda p: -p.get("impressions", 0))

    if args.json:
        print(json.dumps({
            "period": {"start": str(start), "end": str(end)},
            "totals": totals,
            "low_hanging_fruit": low_hanging,
            "ctr_problems": ctr_problems,
            "top_pages": pages,
            "top_queries": queries,
        }, indent=2, ensure_ascii=False))
        return

    # --- human report ---
    print(f"# GravelRadar Search Console — últimos {args.days} días")
    print(f"clics: {clicks} | impresiones: {impr} | CTR: {ctr:.2f}% | posición media: {pos:.1f}\n")

    if impr == 0:
        print("⚠️  Sin impresiones todavía. Google aún no indexa el sitio (normal en las "
              "primeras semanas). Prioridad: cobertura de contenido + indexación.")
        return

    print(f"## 🍎 Low-hanging fruit (posición 4-15, {len(low_hanging)} páginas)")
    for p in low_hanging[:15]:
        print(f"  pos {p['position']:.1f} | {p['impressions']} impr | {p['clicks']} clics | "
              f"{(p['ctr']*100):.1f}% | {p['keys'][0]}")

    print(f"\n## 🐌 CTR bajo (>=50 impr, CTR<2%, {len(ctr_problems)} páginas)")
    for p in ctr_problems[:10]:
        print(f"  {p['impressions']} impr | CTR {(p['ctr']*100):.1f}% | {p['keys'][0]}")

    print(f"\n## 🔍 Top queries (por impresiones)")
    for q in queries[:15]:
        print(f"  {q['impressions']:>5} impr | pos {q['position']:.1f} | {q['keys'][0]}")


if __name__ == "__main__":
    sys.exit(main())

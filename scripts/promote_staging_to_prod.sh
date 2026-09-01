#!/bin/bash
# Promote staging (/opt/gravelradar) → production (/opt/gravelradar-hardened).
# Runs AFTER the daily quality (10:00) + discovery (12:00) agents. SEO code
# changes (daily, 13:00) are cumulative in staging and ride along automatically.
set -euo pipefail

STAGING=/opt/gravelradar
PROD=/opt/gravelradar-hardened
TODAY=$(date +%F)
NODE=/opt/node22/bin/node

# --- 1. Gate: did the daily data agents run today? ---
QUALITY_TODAY=0
DISCOVERY_TODAY=0
[ "$(date -r "$STAGING/data/quality_state.json" +%F 2>/dev/null)" = "$TODAY" ] && QUALITY_TODAY=1
[ "$(date -r "$STAGING/data/discovery_state.json" +%F 2>/dev/null)" = "$TODAY" ] && DISCOVERY_TODAY=1

if [ "$QUALITY_TODAY" != "1" ] || [ "$DISCOVERY_TODAY" != "1" ]; then
  echo "SKIP: agents not both run today (quality=$QUALITY_TODAY discovery=$DISCOVERY_TODAY)"
  exit 0
fi

# --- 2. Sync data (seed JSONs) ---
rsync -a "$STAGING/data/seed/" "$PROD/data/seed/"
echo "data synced"

# --- 3. Sync code (src/) — NO --delete, so production's hardening files
#        (Turnstile detail-access + map-access) are preserved ---
rsync -a --exclude='.next' --exclude='node_modules' "$STAGING/src/" "$PROD/src/"
echo "code synced"

# --- 3b. Sync static assets (public/ — images, fonts, logo, favicon) ---
rsync -a "$STAGING/public/" "$PROD/public/"
echo "static assets synced"

# --- 4. Rebuild production (build-time env vars inlined) ---
cd "$PROD"
rm -rf .next
NEXT_PUBLIC_SITE_URL=https://thegravelradar.com \
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<TURNSTILE_SITE_KEY> \
  "$NODE" node_modules/next/dist/bin/next build > /tmp/promote-build.log 2>&1
echo "build ok"

# --- 5. Fix ownership + restart ---
chown -R gravelradar:gravelradar .next
systemctl restart gravelradar-hardened.service
sleep 4

# --- 6. Verify ---
HTTP=$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:3413/ 2>/dev/null || echo 000)
if [ "$HTTP" != "200" ]; then
  echo "ERROR: production returned HTTP $HTTP"
  exit 1
fi
echo "PROMOTED ok — production HTTP 200 ($(date -u +%F\ %T))"

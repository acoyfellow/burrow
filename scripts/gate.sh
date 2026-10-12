#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "GATE FAIL: $1"; exit 1; }

bash scripts/check.sh >/tmp/coil-gate-check.log 2>&1 || { tail -30 /tmp/coil-gate-check.log; fail "bun run check"; }
grep -q 'access.test.ts' /tmp/coil-gate-check.log || fail "access tests did not run"

git ls-files --error-unmatch receipts/live-ui.json >/dev/null 2>&1 || fail "receipts/live-ui.json is not committed"
node scripts/verify-receipts.mjs || fail "receipts do not prove the goal"

[ "$(gh repo view acoyfellow/coil --json visibility -q .visibility)" = PUBLIC ] || fail "repo is not public"
[ "$(curl -s -o /dev/null -w '%{http_code}' https://coil.coey.dev/)" = 302 ] || fail "deployed URL does not redirect to Access"

git diff --quiet HEAD -- receipts src || fail "uncommitted changes in receipts or src"
[ "$(git rev-parse HEAD)" = "$(gh api repos/acoyfellow/coil/commits/main -q .sha)" ] || fail "HEAD is not pushed"

git ls-files --error-unmatch receipts/live-v3.json >/dev/null 2>&1 || fail "receipts/live-v3.json is not committed"
grep -q 'surfaces.test.ts' /tmp/coil-gate-check.log || fail "terminal and browser tests did not run"
git ls-files --error-unmatch receipts/owner-ok-v3 >/dev/null 2>&1 || fail "receipts/owner-ok-v3 missing: Jordan has not reviewed the v3 screenshots"

[ -f public/manifest.webmanifest ] || fail "PWA manifest missing"
for icon in icon-192.png icon-512.png maskable-192.png maskable-512.png coil.svg; do [ -f "public/icons/$icon" ] || fail "icon $icon missing"; done
grep -q "ui.test.ts" /tmp/coil-gate-check.log || fail "PWA tests did not run"
[ "$(curl -s -o /dev/null -w '%{http_code}' https://coil.coey.dev/manifest.webmanifest)" = 302 ] || fail "production manifest is not behind Access"
node -e '
const r = require("./receipts/lighthouse.json");
const low = r.runs.flatMap((run) => Object.entries(run.scores)).filter(([, v]) => v < 90);
if (r.runs.length < 3 || low.length) { console.error("lighthouse below 90:", low); process.exit(1); }
if (r.installability.installabilityErrors.length || r.production.serviceWorker !== "active") process.exit(1);
' || fail "receipts/lighthouse.json does not show 90+ and an installable PWA"

cloudterm_sha=$(grep -oE 'cloudterm#[0-9a-f]+' package.json | cut -d'#' -f2)
[ -n "$cloudterm_sha" ] || fail "cloudterm is not pinned to a commit"
gh api "repos/acoyfellow/cloudterm/contents/test/conformance?ref=$cloudterm_sha" -q 'map(select(.name|endswith(".bin")))|length' | grep -qx 15 || fail "cloudterm at $cloudterm_sha does not have 15 recorded tmux sessions"
[ "$(gh api "repos/acoyfellow/cloudterm/commits/$cloudterm_sha/check-runs" -q '[.check_runs[]|select(.conclusion=="success")]|length')" -ge 1 ] || fail "cloudterm CI is not green at $cloudterm_sha"

for review in architecture-and-performance oss-readiness; do
  file="receipts/reviews/$review.md"
  git ls-files --error-unmatch "$file" >/dev/null 2>&1 || fail "$file is not committed"
  tail -5 "$file" | grep -qE '^VERDICT: PASS$' || fail "$file does not end in VERDICT: PASS"
done

grep -q 'docs/hero-dark.png' README.md && grep -q 'docs/logo.svg' README.md && grep -q 'bun run ship' README.md && grep -q '## Limits' README.md || fail "README is missing the hero, logo, deploy command, or limits"
git ls-files --error-unmatch receipts/tweet.md >/dev/null 2>&1 || fail "receipts/tweet.md is not committed"
git ls-files --error-unmatch receipts/owner-ok-pwa >/dev/null 2>&1 || fail "receipts/owner-ok-pwa missing: Jordan has not signed off on the PWA"

echo "GATE PASS"

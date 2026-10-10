#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "GATE FAIL: $1"; exit 1; }

bash scripts/check.sh >/tmp/burrow-gate-check.log 2>&1 || { tail -30 /tmp/burrow-gate-check.log; fail "bun run check"; }
grep -q 'access.test.ts' /tmp/burrow-gate-check.log || fail "access tests did not run"

git ls-files --error-unmatch receipts/live-ui.json >/dev/null 2>&1 || fail "receipts/live-ui.json is not committed"
node scripts/verify-receipts.mjs || fail "receipts do not prove the goal"

[ "$(gh repo view acoyfellow/burrow --json visibility -q .visibility)" = PUBLIC ] || fail "repo is not public"
[ "$(curl -s -o /dev/null -w '%{http_code}' https://burrow.coey.dev/)" = 302 ] || fail "deployed URL does not redirect to Access"

git diff --quiet HEAD -- receipts src || fail "uncommitted changes in receipts or src"
[ "$(git rev-parse HEAD)" = "$(gh api repos/acoyfellow/burrow/commits/main -q .sha)" ] || fail "HEAD is not pushed"

git ls-files --error-unmatch receipts/owner-ok >/dev/null 2>&1 || fail "receipts/owner-ok missing: Jordan has not reviewed the screenshots"

echo "GATE PASS"

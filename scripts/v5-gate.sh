#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "GATE FAIL: $1"; exit 1; }
pass() { echo "ok  $1"; }

PHASE_A_BUNDLE_GZIP=130000

bash scripts/effect-gate.sh > /tmp/coil-v5-effect-gate.log 2>&1 || { tail -5 /tmp/coil-v5-effect-gate.log; fail "phase A effect gate"; }
pass "phase A effect gate"

entry=$(ls public/app/assets/entry-*.js 2>/dev/null | head -1)
[ -n "$entry" ] || fail "no client bundle; run the build"
size=$(gzip -c "$entry" | wc -c | tr -d ' ')
[ "$size" -le "$PHASE_A_BUNDLE_GZIP" ] || fail "client bundle is $size bytes gzipped, over $PHASE_A_BUNDLE_GZIP"
pass "client bundle $size bytes gzipped"

REQUIRED_STEPS=(
  markdown_stream stop edit_retry turn_diff palette search rename archive delete file_drop model_picker usage_meter
  tool_screenshot tool_browser_logs tool_edit_file tool_jobs tool_web_fetch tool_notes image_runtimes computer_use_toggle
  thread_crud thread_chat thread_isolation
  loop_ran_three_and_stopped loop_spend_limit loop_kill_switch loop_digest
  notification share_link phone_drive
)

[ -f receipts/live-v5.json ] || fail "receipts/live-v5.json is missing"
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("receipts/live-v5.json", "utf8"));
const steps = Array.isArray(r.steps) ? r.steps : Object.entries(r.steps).map(([name, s]) => ({ name, ...s }));
const byName = new Map(steps.map((s) => [s.name, s]));
const missing = process.argv.slice(1).filter((n) => !byName.has(n));
const failed = steps.filter((s) => !s.ok).map((s) => s.name);
if (missing.length) { console.error("missing steps: " + missing.join(", ")); process.exit(1); }
if (failed.length) { console.error("failed steps: " + failed.join(", ")); process.exit(1); }
for (const shot of r.shots ?? []) fs.accessSync(shot);
' "${REQUIRED_STEPS[@]}" || fail "live v5 receipt incomplete"
pass "live v5 receipt: all ${#REQUIRED_STEPS[@]} steps pass"

[ -f receipts/lighthouse-v5.json ] || fail "receipts/lighthouse-v5.json is missing"
node -e '
const r = JSON.parse(require("fs").readFileSync("receipts/lighthouse-v5.json", "utf8"));
const low = Object.entries(r.scores).filter(([, v]) => v < 90);
if (low.length) { console.error("below 90: " + low.map(([k, v]) => k + "=" + v).join(", ")); process.exit(1); }
' || fail "lighthouse under 90"
pass "lighthouse >= 90"

for review in receipts/reviews/v5-1.md receipts/reviews/v5-2.md; do
  [ -f "$review" ] || fail "$review is missing"
  grep -qE '^VERDICT: PASS' "$review" || fail "$review is not a PASS"
done
pass "two adversarial reviews PASS"

[ -f receipts/owner-ok-v5 ] || fail "receipts/owner-ok-v5 is missing (Jordan writes it)"
pass "owner ok"

echo "GATE PASS"

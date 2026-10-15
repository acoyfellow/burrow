#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "GATE FAIL: $1"; exit 1; }
pass() { echo "ok  $1"; }

[ ! -e src/ui/client.ts ] || fail "src/ui/client.ts still exists"
! grep -rqn "String.raw\`" src/ui || fail "an untyped client string remains in src/ui"
pass "no untyped client"

grep -q '"effect": "4.0.0"' package.json || fail "effect is not pinned to 4.0.0"
grep -q '"foldkit": "0.166.0"' package.json || fail "foldkit is not pinned to 0.166.0"
! grep -q '"hono"' package.json || fail "hono is still a dependency"
pass "effect 4.0.0 and foldkit 0.166.0 pinned"

grep -q "Runtime.makeApplication" client/src/entry.ts || fail "the client is not a foldkit application"
! grep -rqn "fetch('/api\|fetch(\"/api\|fetch(\`/api" client/src || fail "the client calls /api with raw fetch instead of the RPC client"
pass "client is foldkit and talks through the typed RPC client"

for action in ListThreads CreateThread ViewThread StartMessage Exec ListDir ReadFile Compact Pause Resize Fork AddSurface CloseSurface; do
  grep -q "Rpc.make('$action'" shared/protocol.ts || fail "the RPC group lacks $action"
done
grep -q "handlers: Handlers" src/rest.ts || fail "REST routes do not run through the RPC handlers"
pass "every action is in the RPC group, and REST adapts the same handlers"

bash scripts/check.sh > /tmp/coil-effect-gate-check.log 2>&1 || { tail -30 /tmp/coil-effect-gate-check.log; fail "bun run check failed"; }
pass "check: strict types on worker and client, lint, story and boot tests"

if [ -n "${COIL_URL:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$COIL_URL/api/threads")
  case "$code" in
    302|401) pass "$COIL_URL refuses the API without sign-in ($code)" ;;
    *) fail "$COIL_URL/api/threads returned $code without sign-in" ;;
  esac
fi

[ -f receipts/live-effect.json ] || fail "receipts/live-effect.json is missing"
node -e '
const r = JSON.parse(require("fs").readFileSync("receipts/live-effect.json", "utf8"));
const bad = r.steps.filter((s) => !s.ok);
if (bad.length) { console.error("failed steps:", bad.map((s) => s.name).join(", ")); process.exit(1); }
for (const shot of r.shots) require("fs").accessSync(shot);
' || fail "live receipt has failing steps or missing shots"
pass "live receipt: all prod steps pass"

echo "GATE PASS"

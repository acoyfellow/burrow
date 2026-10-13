#!/usr/bin/env bash
set -euo pipefail

confs=("$@")
[ "${#confs[@]}" -gt 0 ] || { echo "usage: bun run ship:all -- deploy/<a>.conf deploy/<b>.conf" >&2; exit 2; }

node scripts/build-term.mjs
bash scripts/check.sh

pids=()
for conf in "${confs[@]}"; do
  log="/tmp/coil-ship-$(basename "$conf" .conf).log"
  COIL_SKIP_BUILD=1 bash scripts/ship.sh "$conf" >"$log" 2>&1 &
  pids+=("$!:$conf:$log")
done

failed=0
for entry in "${pids[@]}"; do
  IFS=: read -r pid conf log <<<"$entry"
  if wait "$pid"; then tail -1 "$log"; else echo "FAILED $conf (see $log)" >&2; tail -5 "$log" >&2; failed=1; fi
done

exit $failed

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat >&2 <<'USAGE'
usage: bun run ship -- deploy/<instance>.conf

Copy deploy/example.conf to deploy/<instance>.conf (git ignores it), fill it in,
and pass its path. One file per instance.
USAGE
  exit 2
}

conf="${1:-}"
[ -n "$conf" ] && [ -f "$conf" ] || usage

set -a
. "$conf"
set +a

missing=""
for key in COIL_ACCOUNT_ID COIL_DOMAIN COIL_ACCESS_TEAM COIL_ACCESS_AUD NIX_IMAGE; do
  [ -n "${!key:-}" ] || missing="$missing $key"
done
[ -z "$missing" ] || { echo "missing in $conf:$missing" >&2; exit 2; }

case "$NIX_IMAGE" in
  registry.cloudflare.com/"$COIL_ACCOUNT_ID"/*) ;;
  *) echo "NIX_IMAGE must be in this account's registry: registry.cloudflare.com/$COIL_ACCOUNT_ID/..." >&2; exit 2 ;;
esac

export CLOUDFLARE_ACCOUNT_ID="$COIL_ACCOUNT_ID"
export APK_PLAIN_HTTP="${COIL_APK_PLAIN_HTTP:-0}"

instance=$(basename "$conf" .conf)
export COIL_WRANGLER_CONFIG="wrangler.$instance.local.jsonc"

if [ "${COIL_SKIP_BUILD:-0}" != 1 ]; then
  node scripts/build-term.mjs
  bash scripts/check.sh
fi
node scripts/with-image.mjs

vars=(--var "ACCESS_TEAM_DOMAIN:$COIL_ACCESS_TEAM" --var "ACCESS_AUD:$COIL_ACCESS_AUD")
[ -z "${COIL_MODEL:-}" ] || vars+=(--var "MODEL:$COIL_MODEL")
[ -z "${COIL_AI_GATEWAY:-}" ] || vars+=(--var "AI_GATEWAY:$COIL_AI_GATEWAY")
[ -z "${COIL_MODEL_GATEWAY_URL:-}" ] || vars+=(
  --var "MODEL_GATEWAY_URL:$COIL_MODEL_GATEWAY_URL"
  --var "MODEL_GATEWAY_HEADER:${COIL_MODEL_GATEWAY_HEADER:-authorization}"
)

deploy() {
  npx wrangler deploy -c "$COIL_WRANGLER_CONFIG" --domain "$COIL_DOMAIN" "${vars[@]}"
}
deploy || deploy

if [ -n "${COIL_MODEL_GATEWAY_TOKEN_COMMAND:-}" ]; then
  token=$(bash -c "$COIL_MODEL_GATEWAY_TOKEN_COMMAND")
  [ -n "$token" ] || { echo "COIL_MODEL_GATEWAY_TOKEN_COMMAND printed nothing" >&2; exit 1; }
  printf '%s' "$token" | npx wrangler secret put MODEL_GATEWAY_TOKEN -c "$COIL_WRANGLER_CONFIG" >/dev/null
  echo "model gateway token stored as a Worker secret"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "https://$COIL_DOMAIN/")
case "$code" in
  302|401|403) echo "coil is live at https://$COIL_DOMAIN and Access is in front ($code)" ;;
  *) echo "https://$COIL_DOMAIN/ answered $code to an anonymous request; check the Access application" >&2; exit 1 ;;
esac

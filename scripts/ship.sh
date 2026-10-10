#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

domain="${COIL_DOMAIN:-}"
team="${COIL_ACCESS_TEAM:-}"
aud="${COIL_ACCESS_AUD:-}"

for _ in 1 2 3 4; do
  [ -n "${1:-}" ] || break
  case "$1" in
    --domain) domain="$2" && shift 2 ;;
    --team) team="$2" && shift 2 ;;
    --aud) aud="$2" && shift 2 ;;
    *) echo "unknown option: $1" >&2 && exit 2 ;;
  esac
done

if [ -z "$domain" ] || [ -z "$team" ] || [ -z "$aud" ]; then
  cat >&2 <<'USAGE'
usage: NIX_IMAGE=<image> bun run ship -- --domain coil.example.com --team https://<team>.cloudflareaccess.com --aud <access-app-aud>

1. In Zero Trust, add a self-hosted Access application for the domain and allow only yourself.
2. Copy its Application Audience (AUD) tag.
3. Run this command. It typechecks, lints, runs the tests, builds the image, and deploys.
USAGE
  exit 2
fi

node scripts/build-term.mjs
bash scripts/check.sh
node scripts/with-image.mjs
npx wrangler deploy -c wrangler.local.jsonc --domain "$domain" --var "ACCESS_TEAM_DOMAIN:$team" --var "ACCESS_AUD:$aud"
echo "coil is live at https://$domain (behind Access)"

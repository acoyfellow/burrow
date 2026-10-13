#!/usr/bin/env bash
set -euo pipefail

auth="${1:-}"
domain="${2:-}"
[ -n "$auth" ] && [ -n "$domain" ] || { echo "usage: check-edge.sh access|cloudflare <domain>" >&2; exit 2; }

headers=$(curl -s -o /dev/null -D - "https://$domain/" | tr -d '\r')
code=$(printf '%s\n' "$headers" | head -1 | cut -d' ' -f2)
location=$(printf '%s\n' "$headers" | grep -i '^location:' | cut -d' ' -f2- || true)
behind_access=0
case "$location" in
  *cloudflareaccess.com*) behind_access=1 ;;
esac

case "$auth" in
  access)
    if [ "$behind_access" = 1 ]; then
      echo "coil is live at https://$domain and Access is in front ($code)"
    else
      echo "https://$domain/ answered $code without an Access login, but COIL_AUTH is access; add the Access application first" >&2
      exit 1
    fi
    ;;
  cloudflare)
    if [ "$behind_access" = 1 ]; then
      echo "https://$domain/ is behind Access, but COIL_AUTH is cloudflare; Access would stop customers before Sign in with Cloudflare. Remove the Access application for this host" >&2
      exit 1
    fi
    page=$(curl -s "https://$domain/")
    case "$page" in
      *'Sign in with Cloudflare'*) echo "coil is live at https://$domain with Sign in with Cloudflare ($code)" ;;
      *) echo "https://$domain/ answered $code but does not show Sign in with Cloudflare" >&2; exit 1 ;;
    esac
    ;;
  *) echo "COIL_AUTH must be access or cloudflare" >&2; exit 2 ;;
esac

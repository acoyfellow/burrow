#!/usr/bin/env bash
set -euo pipefail

step() { printf '\n== %s\n' "$1"; }

step "typecheck"
npx tsc -p . && npx tsc -p tsconfig.client.json

step "lint and format"
npx biome check .

step "offline tests in workerd: isolation, kill and resume, compaction pairs"
npx vitest run --reporter=verbose

step "wrangler configs keep public URLs off"
for config in $(git ls-files '*wrangler.jsonc'); do
  grep -Eq '"workers_dev":[[:space:]]*false' "$config" || { echo "$config: workers_dev must be false"; exit 1; }
  grep -Eq '"preview_urls":[[:space:]]*false' "$config" || { echo "$config: preview_urls must be false"; exit 1; }
done

step "the deployed config cannot skip Access"
if grep -q 'LOCAL_DEV_WITHOUT_ACCESS' wrangler.jsonc; then
  echo "wrangler.jsonc must not set LOCAL_DEV_WITHOUT_ACCESS"
  exit 1
fi

step "no private registry in the lockfile"
if grep -q 'cloudflare-ui' bun.lock; then
  echo "bun.lock names a private registry"
  exit 1
fi

step "no account IDs or tokens in tracked files"
if git ls-files -z | xargs -0 grep -nE '(account_id|CLOUDFLARE_API_TOKEN).*[0-9a-f]{32}|registry\.cloudflare\.com/[0-9a-f]{32}' 2>/dev/null; then
  echo "found a secret-looking value"
  exit 1
fi

step "every receipt the README links to exists"
for linked in $(grep -oE '\(receipts/[^)#]+\)' README.md | tr -d '()' | sort -u); do
  if [ ! -e "$linked" ]; then
    echo "README links to $linked, which does not exist"
    exit 1
  fi
done

printf '\nall checks passed\n'

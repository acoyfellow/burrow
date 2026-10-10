# coil — OSS and go-to-market readiness review

Scope: README.md, src/, public/, computer/, scripts/, test/, receipts/. `bun run check` run locally: typecheck, biome, 26/26 vitest tests, and the config guards all pass. No files in the repo were edited.

## BLOCKER

### B1. The default base image is a private registry path that includes an account ID
- **File:** computer/Dockerfile:1. `NIX_IMAGE=registry.cloudflare.com/ACCOUNT_ID/nix-cf-proof@sha256:…`
- **What is wrong:** The default points at the author's account-scoped Cloudflare registry. A stranger who runs `bun run ship` will fail to pull that image during `wrangler deploy`. The README calls deploy one command, and for anyone else it fails. The path also commits the author's 32-hex account ID.
- **Why it matters:** This is the main deploy path for a stranger. It breaks the "Deploy your own" promise and leaks an account identifier. The `check.sh` secret scan (scripts/check.sh:34) only matches `account_id|CLOUDFLARE_API_TOKEN` followed by hex, so it misses this.
- **Smallest fix:** Publish nix-cf-proof to a public registry (ghcr.io or Docker Hub) and set that as the default. Otherwise, make `NIX_IMAGE` required with no default. In that case, `ship.sh` should refuse to run without `--nix-image`, and the README should list the exact steps to build and push it. Also widen the check to fail on any `registry.cloudflare.com/<hex>` string.

### B2. The README links to a proof directory that does not exist
- **File:** README.md:148 links to `receipts/reviews/`, described as "Two independent adversarial reviews". The directory is absent: `ls receipts/reviews` returns no such file. scripts/gate.sh:39-43 also requires these reviews.
- **Why it matters:** The "Proof" section links to nothing. That is a claim with no evidence, and a visitor will hit a 404 on GitHub.
- **Smallest fix:** Commit the reviews before publishing the README row, or remove the row.

## MAJOR

### M1. The headline live receipt is from an earlier project name and hostname
- **Files:** receipts/live-ui.json:2,5 (`"kind": "burrow.live-ui"`, `"url": "https://burrow.coey.dev/"`) and receipts/live-e2e.json:2,6,126 (`burrow` hostname, files, and git author `burrow`).
- **What is wrong:** README.md:150 says live-ui.json is "a run on the deployed Worker". The receipt actually shows a different Worker (burrow) at a different hostname. The image env now sets the author to `coil` (computer/Dockerfile:21-24). Only live-v3.json and lighthouse.json were measured on coil.coey.dev.
- **Why it matters:** The nine-row results table (README.md:152-162) is not shown to hold for the current code under this name. Stale names in receipts look like copy-paste proof.
- **Smallest fix:** Re-run the live-ui script against the coil deploy and commit the new receipt. Or relabel the table: "measured on the predecessor deploy (burrow) at commit X".

### M2. The deploy prerequisites are incomplete
- **File:** README.md:78-90 and scripts/ship.sh:30-32.
- **What is wrong:** The README does not mention any of these:
  - You must be logged in with `wrangler login`.
  - `--domain` must be a hostname on a zone in the same account, because the Custom Domain is created by `wrangler deploy --domain`.
  - Workers AI usage and billing come from `MODEL` in wrangler.jsonc:11.
  - The Access application's hostname must exactly match `--domain`.
  - You need a team domain from Zero Trust onboarding.
  - Docker must be able to build linux/amd64. The Dockerfile hardcodes `ld-musl-x86_64` at line 12, so Apple Silicon builds need emulation.
- **Smallest fix:** Add a short prerequisites checklist with these items.

## MINOR

- **README.md:25 vs receipts/live-v3.json:43.** The hero caption says `localhost:3000`. The committed receipt used `localhost:8080`. The hero screenshot has no matching receipt. Commit the run behind the hero, or reword the caption.
- **README.md:164 and scripts/gate.sh:13-47.** The README presents `gate.sh` as a proof anyone can run. It hardcodes `acoyfellow/coil` and `coil.coey.dev`, and requires `receipts/tweet.md` and `owner-ok-*` files. For anyone else it is the author's release checklist, not a proof. Say so in the README, or parameterize it.
- **receipts/owner-ok-v3.** Personal sign-off text ("Jordan reviewed…") in the receipts is harmless, but it reads as internal process. Consider moving release sign-offs out of `receipts/`.
- **receipts/lighthouse.json:48, live-v3.json:71.** These name the author's production hostname. That is fine, since it sits behind Access and a 302 was verified. Just be aware that it is public.
- **computer/Dockerfile:6.** Alpine repos are switched from https to http. That is an unauthenticated transport for package downloads. apk signatures still protect integrity, but a reviewer will flag it. Explain why or revert.
- **The license is fine** (MIT, LICENSE file, and package.json agree). The logo and icons are present and the PWA test covers the manifest. The "What it does not do" section is honest and specific.

## Verdict summary
- **2 BLOCKERs:** the base image cannot be pulled by strangers and leaks an account ID, and the README links to missing review receipts.
- **2 MAJORs:** the headline receipt is from a predecessor deploy, and the deploy prerequisites are incomplete.

VERDICT: FAIL

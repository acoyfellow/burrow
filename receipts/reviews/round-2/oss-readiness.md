# coil — OSS and go-to-market readiness review, round 2

Scope: README.md, computer/Dockerfile, scripts/ (ship.sh, with-image.mjs, check.sh, gate.sh, verify-receipts.mjs), wrangler.jsonc, .gitignore, src/shell.ts and src/thread.ts (to check the limits stated in the README), receipts/, and git history (`git log --all -p`). I ran `bun run check` at HEAD 5d8a7cb and every step passed ("all checks passed"). I did not edit or push anything in the repo.

## Round-1 findings, checked one by one

### B1. The base image was a private registry path with an account ID: FIXED
- computer/Dockerfile:1 is now `ARG NIX_IMAGE` with no default.
- scripts/with-image.mjs:5-8 exits with code 2 if `NIX_IMAGE` is not set. It writes the value as `build_vars` into a gitignored `wrangler.local.jsonc` (.gitignore:8). ship.sh deploys with `-c wrangler.local.jsonc`.
- scripts/check.sh:34 now also fails on `registry\.cloudflare\.com/<32 hex>`.
- At HEAD, `git grep` for a 32-hex account ID in tracked files finds nothing. The only 32+ hex match is a commit SHA inside receipts/live-e2e.json.
- The README lists the image as a prerequisite and explains `NIX_IMAGE` (README.md:79-99).
- What is left is covered under N1 and N2 below.

### B2. The README linked to a review directory that did not exist: FIXED, with one leftover
- receipts/reviews/round-1/ now holds both reports.
- check.sh checks that every receipt the README links to exists.
- The README still says "the final round is the top-level reports" (README.md:150). Those reports are not committed yet. See N3.

### M1. The headline live receipt came from the old project name: DOCUMENTED
- README.md:152 now says that live-ui.json was recorded before the rename, names burrow and its hostname, and points to live-v3.json as the run on the current deploy.
- That is honest. It does not overclaim.

### M2. The deploy prerequisites were incomplete: FIXED
- README.md:79-86 is now a checklist that covers every item from round 1:
  - Bun and Docker that can build linux/amd64, with the note that Apple Silicon needs emulation
  - Workers Paid with Containers and Workers AI, and that `MODEL` usage is billed to your account
  - `wrangler login`
  - a zone in the same account for `--domain`
  - a Zero Trust team domain
  - an Access application whose hostname exactly matches `--domain`
- ship.sh's usage text agrees with the README.

### Round-1 minors
- **APK over plain http:** FIXED. It is now opt-in through `APK_PLAIN_HTTP=0|1` (Dockerfile:6-7). The default is https.
- **gate.sh presented as a proof anyone can run:** FIXED. README.md:172 now calls it the author's release checklist and says `bun run check` is the part that applies to you.
- **Hero caption has no receipt; owner-ok-v3 holds personal sign-off text:** unchanged. These are still minor.

## New findings

No BLOCKER or MAJOR findings.

### N1. MINOR: The old account ID is still in public git history
- **Where:** `git log --all -p` shows `registry.cloudflare.com/bfcb6a…` five times, in commits 1543215, f958d2a (the removal) and 318c5d5 (the round-1 review before it was redacted). The repo is public (github.com/acoyfellow/coil returns 200).
- **Why it is only minor:** Cloudflare does not treat an account ID as a secret, and no token or other credential appears anywhere in history.
- **Fix:** Accept it and say nothing. If the author cares, rewrite history before launch. Either way, do not claim "no account ID in the repo", because the subject line of commit f958d2a already says that and history contradicts it.

### N2. MINOR: The README does not say how to build the required image
- **Where:** README.md:99 says "Build it and push it to your account's registry once", but gives no command and no expected reference format.
- **Why it matters:** This is the only prerequisite with no concrete steps, and it is a hard requirement. The nix-cf-proof repo does document its Cloudflare-side build, so a stranger can get there, just slowly. The Dockerfile also assumes the base image is shaped like nix-cf-proof, with `/sandbox/bin/bash` and `/etc/ssl/certs/ca-bundle.crt`. Any other image fails at the prepare.sh RUN step with no clear error.
- **Fix:** Add one line that links to nix-cf-proof's "How the build runs on Cloudflare" section, shows an example reference (`registry.cloudflare.com/<account>/nix-cf-proof@sha256:…`), and says that only nix-cf-proof images work.

### N3. MINOR: The README describes final-round reports that are not committed
- **Where:** README.md:150 says "the final round is the top-level reports". `ls receipts/reviews` shows only `round-1`.
- **Why it matters:** The link resolves, but the sentence is not true until the round-2 reports are committed.
- **Fix:** Commit this round's reports to receipts/reviews/ before publishing, or reword the sentence.

### N4. MINOR: The hero image still has no matching receipt (carried over)
- **Where:** README.md:25 names thread `hero-mv2hzd5x` and `localhost:3000`.
- **Why it matters:** No committed receipt records that run. live-v3.json used port 8080.
- **Fix:** Commit the hero run's transcript, or drop the thread ID from the caption.

### N5. MINOR: Personal names and the production hostname remain in receipts
- **Where:** receipts/owner-ok-v3, status.json:80, gate.sh:21 and :47 name "Jordan". Several receipts name coil.coey.dev.
- **Why it is only minor:** None of it is sensitive. The production hostname is behind Access, and a 302 was verified.
- **Fix:** Optional. Move the release sign-offs out of `receipts/`.

## README limits checked against the code
- **Idle auto-pause after 9 minutes:** src/thread.ts:95 sets `AUTO_PAUSE_AFTER_MS = 9 * 60 * 1000`.
- **The 120-second limit on agent commands:** src/shell.ts:1 sets `RUN_LIMIT_SECONDS = 120`.
- **The 10-minute limit on API and MCP commands:** src/shell.ts:3 sets `HUMAN_LIMIT_SECONDS = 600`.
- **The 256 KB output cap:** src/shell.ts:5 sets `OUTPUT_CAP_BYTES = 256 * 1024`, and ledger.ts:216-219 truncates the output and records its full size and hash.
- **Branding and install:** The MIT license agrees with package.json. The logo, icons and PWA manifest are present and tested.
- **"What it does not do":** It is specific and honest.

VERDICT: PASS

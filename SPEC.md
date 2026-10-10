# coil spec

## The unit

A **coil** is one thread. It is one Durable Object, named by the thread ID, that owns three things:

| Part | Primitive | Lives in |
| --- | --- | --- |
| The agent | Pi Durable harness on `storage/sqlite/cloudflare` | The Durable Object's SQLite |
| The computer | One Cloudflare Container attached to the same Durable Object (`ctx.container`) | The container's disk, then a snapshot |
| The ledger | Thread state, phase, snapshot IDs, and the compaction record | The same SQLite, in a `coil_*` table |

All three share one name, one lock, and one lifetime. Nothing about a thread lives anywhere else.

## Invariants

1. **One writer.** Only the thread's own Durable Object writes its transcript, its ledger, or its container. A second thread cannot see either one.
2. **The transcript is the source of truth.** Pi Durable owns the conversation. The ledger only holds what Pi does not: phase, snapshot ID, and compaction pairs.
3. **Compaction is paired.** When the transcript compacts, the computer snapshots in the same step. The ledger records the pair `{ summaryEntry, snapshotId, at }`. A fork or restore from that point gets the summary and the disk that match it.
4. **Pause is compaction plus sleep.** Pausing a thread snapshots the computer, records the pair, and destroys the container. The Durable Object then hibernates. A paused thread costs storage only.
5. **Resume is restore.** The next message or command starts the container from the latest snapshot, then Pi Durable resumes any unfinished request with the same request ID.
6. **Fork is cheap.** A new thread can start from any recorded pair: the transcript context at that summary, and the disk at that snapshot.

## The computer's image: one `devenv.nix`, built on Cloudflare

The container image comes from the pattern proven in [nix-cf-proof](https://github.com/acoyfellow/nix-cf-proof):

- A repo's `devenv.nix` declares its tools. Cloudflare builds the image in a builder Container (no Docker, no GitHub Actions) and pins it by digest. The same file gives the same tools on a laptop.
- The default image carries nix-cf-proof's patched git, which **cannot force-push**. An agent in a coil can commit and push, but it cannot rewrite remote history. That guard is in the binary, not a policy the agent can talk past.
- Known limit, carried over from nix-cf-proof: Cloudflare cannot prepare `dockerTools.buildLayeredImage` images. Use single-layer `buildImage`.

The first coil image is the Sandbox shim on a small base, so the spike runs before the Nix build is wired. The Nix image is a drop-in replacement: same shim path, same `/workspace`.

## What coil takes from neighbors

| From | What it proved | What coil uses |
| --- | --- | --- |
| [armada](https://github.com/AshishKumar4/armada) | Prepare an environment once, `snapshotContainer`, `destroy`, then `start({ containerSnapshot })`: about 2.5 s from send to answer | A per-repo **setup snapshot**: the first thread on a repo runs setup and snapshots it; every later thread on that repo starts from it. Pause uses the same call per thread. |
| armada | A lost exec is relaunched, and three lost in a row mark the container lost | The computer's `exec` retries a lost launch and records a typed `ComputerLost` instead of hanging |
| [terrarium](https://github.com/acoyfellow/terrarium) | One Durable Object holds the authoritative terminal state, so a missed callback never loses a result; logs go to DO SQL with R2 overflow and a SHA-256 | The thread DO is the only source of truth for status. `exec` output goes to the DO, with large output in R2, each with a byte count and hash |
| terrarium | `Idempotency-Key` on every admitting POST | `POST /api/threads/:id/messages` takes an `Idempotency-Key` and passes it to Pi Durable as the `requestId`, so an agent client's retry never runs a turn twice |
| [nix-cf-proof](https://github.com/acoyfellow/nix-cf-proof) | One `devenv.nix` builds an image on Cloudflare; a patched git cannot force-push | The image path below |
| [tardigrade](https://github.com/acoyfellow/tardigrade) | Pi Durable in a DO comes back after `ctx.abort()`; an offline workerd test kills it on every check | The kill-resume test shape, with a faux model |

## Surfaces

- **Humans:** `/` lists threads, `/t/:id` shows one thread: the transcript, a terminal for `exec`, files, and the compaction timeline.
- **Agents:** the same actions over HTTP (`/api/threads/...`) and over MCP (`/mcp`) with tools `thread_create`, `thread_send`, `thread_exec`, `thread_read_file`, `thread_pause`, `thread_fork`, `thread_status`.

## Out of scope

- Multi-tenant auth. One owner per deploy, behind Cloudflare Access.
- Memory snapshots. A resumed container restarts its processes. Its disk comes back, its running servers do not.
- Exactly-once side effects outside the container.

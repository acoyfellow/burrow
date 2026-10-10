# burrow

**One thread, one agent, one computer. On Cloudflare, compacted together.**

An agent that works on code needs two things that last: its conversation and its disk. Most setups keep them in two places. The chat is in a database, the files are in a VM or a shared volume, and nothing ties them together. Kill the process and the chat comes back without its files. Run two threads and they edit the same folder. Pause a thread and you pay for an idle machine, or you lose what was on it.

burrow puts both in one [Durable Object](https://developers.cloudflare.com/durable-objects/) per thread:

- the agent is a [Pi Durable](https://earendil.com/posts/pi-durable/) harness on the object's SQLite;
- the computer is a [Cloudflare Container](https://developers.cloudflare.com/containers/) attached to the same object, with its own git checkout in `/workspace`;
- a small ledger in the same SQLite records each pause and each compaction as a **pair**: the transcript summary and the disk snapshot that match it.

```text
                 Worker (Access-gated): web UI · HTTP API · MCP
                                   │  getByName(thread)
             ┌─────────────────────▼─────────────────────┐
             │       Thread Durable Object (one per thread)   │
             │                                               │
             │   Pi Durable harness ──── SQLite ──── ledger   │
             │        │ tools: run, write_file      (pairs,   │
             │        ▼                              execs)   │
             │   ctx.container ── /workspace (git)            │
             │        │  pause: snapshotContainer → destroy   │
             │        │  resume: start({ containerSnapshot }) │
             └────────┼──────────────────────────────────────┘
                      ▼
               a Linux computer only this thread can see
```

## Run it

You need Bun, Docker (or colima), and a Cloudflare account with Containers (Workers Paid).

```sh
git clone https://github.com/acoyfellow/burrow && cd burrow
bun install
bun run check                                     # typecheck, lint, offline tests in workerd
npx wrangler dev --var LOCAL_DEV_WITHOUT_ACCESS:1 # real containers in Docker, real Workers AI
```

Then, from another terminal:

```sh
curl -s -X POST localhost:8787/api/threads -H 'content-type: application/json' -d '{"name":"demo"}'
curl -s -X POST localhost:8787/api/threads/demo/messages \
  -H 'content-type: application/json' -H 'idempotency-key: turn-1' \
  -d '{"text":"Create hello.py that prints hi, run it, and commit it."}'
curl -s -X POST localhost:8787/api/threads/demo/pause     # snapshot the disk, stop the computer
curl -s -X POST localhost:8787/api/threads/demo/exec \
  -H 'content-type: application/json' -d '{"command":"git log --oneline; python3 hello.py"}'   # resumes from the snapshot
```

Or open `http://localhost:8787/` for the web UI: threads on the left, the transcript in the middle, a terminal and the compaction pairs on the right.

## For agents

The same actions are tools on `POST /mcp` (JSON-RPC, streamable HTTP):

| Tool | Does |
| --- | --- |
| `thread_create` | New thread: its own agent and its own computer. Optional `repo` to clone. |
| `thread_send` | One agent turn. Pass the same `requestId` to retry without running the turn twice. |
| `thread_exec` | A shell command in the thread's `/workspace`. |
| `thread_read_file` | Read a file from the thread's computer. |
| `thread_compact` | Compact the transcript and snapshot the disk as one pair. |
| `thread_pause` | Snapshot the disk and stop the computer. The next call resumes it. |
| `thread_status` | Phase, transcript, pairs, and recent commands. |

Over HTTP, `POST /api/threads/:name/messages` takes an `Idempotency-Key` header and passes it to Pi Durable as the request ID.

## The compaction story

There are two things to compact, and burrow does them together.

1. **The transcript.** Pi Durable compacts on its own when the context fills up (threshold or overflow), and on request (`thread_compact`). It writes a `pi.compaction` summary entry and keeps recent turns as they were.
2. **The disk.** On `thread_compact` and on `thread_pause`, the thread snapshots its container with `snapshotContainer()` and records `{ reason, snapshot, summaryEntry }` in the ledger.

A pause also destroys the container, so an idle thread costs storage and nothing else. The next message, command, or file read starts the container from the latest snapshot. Because summary and snapshot are recorded together, the conversation the agent resumes with and the disk it finds always come from the same moment.

## How do I know it works?

`bun run check` runs three tests in workerd, offline. They use the real `Thread` Durable Object and the real Pi Durable harness, with a scripted model and an in-memory computer swapped in ([`test/worker/index.ts`](test/worker/index.ts)):

| Test | Proves |
| --- | --- |
| Isolation | A file one thread's agent writes is not visible to another thread, and reading it from the other thread fails |
| Kill and resume | A thread killed with `ctx.abort()` mid-turn comes back, finishes the same request, and the file exists. The user turn is recorded once |
| Compaction pairs | Two turns, `compact`, `pause`, `ctx.abort()`, then resume: the disk has exactly the earlier files, the transcript has the summary, the ledger has `[compaction, pause]`, and the agent finishes a third turn |

[`receipts/local-e2e.json`](receipts/local-e2e.json) is a run against `wrangler dev` with a real Docker container per thread and real Workers AI. The agent wrote `hello.py`, ran it, and committed it. The pause snapshot was 130 MB. Resuming took 0.3 s, and the commit was still there. A second thread had a different hostname and an empty repo.

## What it does not do

- **It does not restore running processes.** A resumed computer gets its disk back, not its memory. Dev servers have to start again.
- **It is not multi-user.** One owner per deploy, behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). The Worker checks the Access token itself and fails closed if Access is not configured.
- **It is not a security boundary for hostile code on its own.** The container has internet access so the agent can install packages and clone repos. Restrict egress with `interceptOutboundHttp` if you need to.
- **`run` is `replay: "unsafe"`.** If a thread dies while a shell command is running, Pi Durable does not run it again. `write_file` is `replay: "safe"`.

## Where to change behavior

| File | What |
| --- | --- |
| [`src/agent.ts`](src/agent.ts) | The prompt and the tools the agent gets |
| [`src/thread.ts`](src/thread.ts) | Lifecycle: boot, pause, compact, resume |
| [`src/computer.ts`](src/computer.ts) | How the container starts, its size, and its inactivity timeout |
| [`computer/Dockerfile`](computer/Dockerfile) | What is installed in each computer |
| [`wrangler.jsonc`](wrangler.jsonc) | The model and bindings |

## Prior art it builds on

- **[armada](https://github.com/AshishKumar4/armada)** proved that a prepared container can be snapshotted and started again in about 2.5 s. burrow uses the same `snapshotContainer` and `containerSnapshot` calls, per thread.
- **[tardigrade](https://github.com/acoyfellow/tardigrade)** showed that Pi Durable in a Durable Object comes back after `ctx.abort()`, along with the offline kill test shape.
- **[terrarium](https://github.com/acoyfellow/terrarium)** keeps one Durable Object as the only source of truth for a run, and logs output with a byte count and hash. burrow's exec log does the same.
- **[nix-cf-proof](https://github.com/acoyfellow/nix-cf-proof)** builds a container image from one `devenv.nix` on Cloudflare, with a git that cannot force-push. That is the next image for burrow's computers (see [SPEC.md](SPEC.md)).

## What this makes possible next

- **Fork a thread** from any pair: a new Durable Object starts from that summary and that snapshot. The ledger already stores both.
- **Per-repo warm starts.** Prepare a repo once, snapshot it, and start every new thread on that repo from the snapshot, the way armada prepares environments.
- **Crash testing.** Every pair is a known-good resume point, which makes the kill-at-every-step testing in [killjoy](https://github.com/acoyfellow/killjoy) straightforward to point at a burrow.

## License

MIT

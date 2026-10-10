# coil: architecture and performance review, round 3

Scope: README.md, src/, src/ui/, test/, receipts/, and commit `32eeea2` (the round-2 fixes). `bun run check` passes: all static checks and the offline suite.

## Earlier BLOCKER and MAJOR items, checked one by one

| Item | Status | Evidence |
| --- | --- | --- |
| R1 B1 inactivity stop loses work | FIXED | Idle auto-pause in `alarm()` (`src/thread.ts:545-576`). `recordLostComputer` (`thread.ts:530`) logs a notice. |
| R1 B2 missing `receipts/reviews/` | FIXED | `round-1/` and `round-2/` exist. `check.sh` verifies README receipt links. |
| R1 M1 exec retries commands that already ran | FIXED | Unchanged since round 2. |
| R1 M2 / R2 N1 back-pressure was a no-op | FIXED | Terminal: `CreditWindow` (`src/flow.ts`), 512 KB window, `await window.reserve()` before each `send` (`src/terminal.ts:113-118`). The client acks every 64 KB on rAF (`src/ui/client.ts:202-207`). Browser: one frame in flight per viewer, plus a coalescing `waiting` slot (`thread.ts:833-868`). Chromium is acked only when no viewer is busy (`browser.ts:282-289`). `test/flow.test.ts` covers the window, the oversized chunk, and close. |
| R1 M3 / R2 N3 pause/turn race | FIXED, with a new deadlock (N1 below) | `pausing` is set when pause is queued (`thread.ts:637-645`). `start()` and `awake()` wait on it (`:275`, `:492`). |
| R1 M4 output in DO memory | FIXED | `head -c 256K` in-container. |
| R1 M5 snapshots never deleted | DOCUMENTED | README "Snapshots are kept", with a concrete reason. |
| R1 M6 browser sockets after Chromium dies | FIXED | `closedListeners` closes each socket with 1011. |
| R2 N2 auto-pause under a running command | FIXED | `using()` counts `inFlight` for `exec`/`readFile`/`list` (`thread.ts:177-186`). `alarm()` re-arms while `inFlight > 0` (`:567`). `pauseNow` returns 409 (`:654`). |

## New findings

### N1. MAJOR: pause queued during compaction deadlocks the Durable Object
- **Where:** `src/thread.ts:609-627` (`compactNow`), `:637-645` (`pause`), `:275` (`awake`)
- **What is wrong:** `compact()` runs inside `serialized`. It first awaits `agent.compact()`, which is a model call that takes seconds, and only then calls `this.awake()`. If `pause()` arrives in that window, it sets `this.pausing` to a promise chained after the compaction. `awake()` then loops on `await this.pausing`, which waits for the compaction, which is waiting inside `awake()`. Neither one ever settles. The trigger does not need a user. Compaction does not set `busy` or `inFlight`, so the idle `alarm()` can fire `pause()` during a manual compaction on a thread idle for 9 minutes. After that, every `awake()` and `start()` hangs as well (turns, exec, terminals, the browser) until the DO is evicted. `snapshot()` and the `children.spawn` snapshot path have the same shape, with a smaller window.
- **Why it matters:** The round-2 fix for N3 turned a race into a hang on the main lifecycle path, and no test exercises pause during compaction.
- **Smallest fix:** Inside a serialized step, skip the `pausing` wait. One way is a `lifecycleOwner` flag, or an `awakeUnlocked()` that compact and snapshot call. Or make compaction count as `inFlight`, so pause returns 409 and the alarm re-arms. Add an offline test that calls pause while `agent.compact` is pending.

### MINOR
1. **Turn admission still has a small window.** `start()` checks `pausing`, then awaits `open()` and `submit()` before it sets `busy` (`thread.ts:492-497`). A pause in that window sees `busy=false` and snapshots. The turn's tools then wait in `awake()` and reboot from the pause snapshot. The disk stays consistent, but the thread is paused and resumed for no reason. Fix: set a `starting` counter before the first await.
2. **`closeSurface` bypasses the lifecycle** (`thread.ts:784-787`). It runs `tmux kill-session` directly on the container, even while a pause snapshot is in progress.
3. **One stuck tab stalls the screencast for everyone.** If `createImageBitmap` rejects in a client (`client.ts:283`), that client never sends `seen`. Its viewer stays in `busyViewers`, and Chromium is never acked again. Fix: add a per-viewer timeout of about 2 s that drops the viewer from `busyViewers`.
4. **The production flow-control numbers are not in receipts.** The 8 MB flood and the 1-versus-141 frame result appear only in the author's note. Add them to a `receipts/*.json`.
5. **The README protocol row is stale.** The `src/terminal.ts` row says text frames are `{"resize":…}` but omits `{"ack":n}`, which is now required. A non-cloudterm client will stall at 512 KB.
6. **The lifecycle test accepts either outcome** (`test/thread.test.ts:87`, `['pause','refused']`). It proves there is no crash, but not that the ordering is correct.
7. Carried over from round 2: the 20 s `setTimeout` in `alarm()` is never cleared; `viewers` lives only in memory; `stderr` is truncated silently; and the earlier round-1 MINORs (the service-worker cache version, the Google Fonts dependency, browser input interleaving between tabs).

## Abstractions

The ack-based flow control is the right fix, and it is small. The lifecycle now has three overlapping mechanisms: `serialized`, `pausing`, and the `inFlight`/`busy` counters. N1 comes from how they interact. One owner with explicit states (idle, running(n), pausing) would remove this class of bug.

VERDICT: FAIL

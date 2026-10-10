# coil: architecture and performance review, round 4

Scope: the round-3 report, plus `src/thread.ts`, `src/flow.ts`, `src/terminal.ts`, `src/browser.ts`, `src/shell.ts`, `src/env.ts`, `test/worker/index.ts`, `test/thread.test.ts`, and the README section "What it does not do". `bun run check` passes: 5 files and 35 tests, plus all static checks.

## Round-3 BLOCKER and MAJOR items

| Item | Status | Evidence |
| --- | --- | --- |
| R3 N1: a pause queued during compaction deadlocks the DO | FIXED | `compact()` now runs inside `using()` (`src/thread.ts:617-619`), so `inFlight > 0` for the whole compaction. The idle `alarm()` therefore re-arms (`:580`) instead of calling `pause()`, and a manual pause that runs while the compaction is counted gets 409 (`:667`). `compactNow` and `snapshot()` call `awakeInsideLifecycle()` (`:629`, `:645`), which skips the `pausing` wait (`:276-282`). The circular wait is gone. `test/worker/index.ts:249-256` runs `compact` and `pause` at the same time, and the suite finishes, so the old hang would now show up as a test timeout. Caveat: the assertion still accepts either outcome (`test/thread.test.ts:88`). |

## Round-3 MINORs

1. Turn admission window: FIXED. `start()` increments `inFlight` right after the `pausing` wait, before any other await (`thread.ts:498-509`).
2. `closeSurface` bypassing the lifecycle: FIXED. It is skipped while `pausing` is set and is counted through `using()` (`thread.ts:797-802`).
3. A stuck tab stalls the screencast: FIXED as a stall, but it now degrades. The 2 s give-up (`thread.ts:851-862`) re-marks the stuck viewer busy on the next frame, so every viewer drops to about 0.5 fps while that tab stays open.
4. and 5. (receipts, README protocol row): not checked. Those files are outside this round's read list.
6. The lifecycle test still accepts either outcome: NOT FIXED (`test/thread.test.ts:88`, `:90`).
7. The 20 s `setTimeout` in `alarm()` is still never cleared (`thread.ts:563`).

## New findings

### M1. MAJOR (CONFIRMED in code): `Browser.close()` leaves pending CDP calls and viewer sockets hanging forever
- **Where:** `src/browser.ts:444-447` (`close`), `:114-124` (`fail`). Called from `src/thread.ts:805-806` (`closeSurface`) and `:687` (`pauseNow`).
- **What is wrong:** `close()` sets `this.closed = true` and then aborts the process. When the pipe ends, `pump`'s `finally` and `exitCode` both call `fail()`, which returns at once because `closed` is already true (`:115`). As a result:
  - `waiting` resolvers are never called. Any `send()` that is in flight never settles.
  - `closedListeners` never run, so browser WebSockets are never closed with 1011.
- **Failure scenario:**
  1. The agent is inside a browser tool, for example `open` waiting on `Page.navigate` (`browser.ts:336`), or `snapshot`/`evaluate`.
  2. The user closes the browser tab, which calls `closeSurface('b1')`.
  3. The tool's promise never resolves, so the turn never ends and `ledger.busy` stays true.
  4. `alarm()` re-arms every second with a 20 s race (`thread.ts:559-570`), forever.
  5. Pause returns 409 forever (`:665`), and the computer is never auto-paused.

  Even with no tool in flight, the open viewer socket keeps `viewers > 0` (`:191`). That blocks idle auto-pause (`:580`) for as long as the browser tab stays open, including after a pause and resume, while showing a frozen frame. The only way out is a harness-level tool timeout, if one exists, or DO eviction.
- **Smallest fix:** `close() { this.fail(); this.abort.abort(); }`. `fail()` already sets `closed`, rejects waiters, and fires `closedListeners`. Add a surfaces test: close the browser surface while `browser.open` is pending, then assert that the tool rejects and the viewer socket closes.

### M2. MAJOR (PLAUSIBLE; depends on `agent.compact` semantics, since `src/agent.ts` was outside scope): compact during a turn, then pause, can still deadlock
- **Where:** `thread.ts:617-619` (`compact` has no `busy` guard), `:276-277` (`awake` waits on `pausing`), `:651-657` (`pause`).
- **Failure scenario:**
  1. A turn is running (`busy = true`).
  2. The user clicks compact. `compactNow` waits on `agent.compact()` inside `serialized`.
  3. The user clicks pause. `pausing` is set and queued behind the compaction.
  4. The turn's next tool calls `awake()` (`agent.ts` callback `thread.ts:445`, also `openBrowser` at `:386` and `children.spawn` at `:338`), which waits on `pausing`. `pausing` waits on the compaction.

  If `agent.compact()` waits for the running turn to go idle, which is likely for a durable harness that serializes work on one session, the cycle is closed: the turn waits on pause, pause waits on compaction, and compaction waits on the turn. If it does not wait, there is no hang, but every tool call stalls for the whole compaction, and then the pause is refused anyway. The compaction snapshot is also taken mid-turn (`:633`), so it can catch a command halfway.
- **Smallest fix:** In `compact()`, throw `ThreadBusy` when `this.ledger.busy`, the same rule pause follows. Or, in `awake()`, skip the `pausing` wait when `this.ledger.busy`, because `pauseNow` will refuse anyway (`:665`). Add an offline test: start a turn, compact, pause, and assert the turn finishes.

### MINOR
1. `terminalSocket` awaits `awake()` and then `container.exec` before `watched()`, without `using()` (`thread.ts:823-840`). A pause in that gap destroys the box, and the open fails with a 500 instead of waiting.
2. `awake()` and `start()` loop on `pausing` with no bound (`thread.ts:277`, `:498`). Back-to-back pauses can starve them. Unlikely.
3. Terminal `CreditWindow.ack` trusts the client's byte count (`flow.ts:23-26`). The effect is limited to that client's own socket.
4. In `alarm()`'s idle branch, `pause()` can throw `ThreadBusy` if `inFlight` changes between the check and the run (`thread.ts:580-588`). The alarm then fails and relies on the platform's retry backoff instead of re-arming.

## Abstractions

The N1 fix is sound and small. With `using()` around compaction and `awakeInsideLifecycle` for serialized steps, the lifecycle stays consistent as long as the agent is idle. M2 is the remaining place where `serialized`, `pausing`, and `busy` interact. One guard, "no compaction while busy", closes it. M1 is separate: `close()` and `fail()` are two exit paths, and only `fail()` cleans up.

VERDICT: FAIL

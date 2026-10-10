# coil: architecture and performance review, round 5

Scope: the round-4 report, plus `src/thread.ts`, `src/flow.ts`, `src/terminal.ts`, `src/browser.ts`, `src/shell.ts`, `src/env.ts`, `src/agent.ts`, `test/surfaces.test.ts`, `test/worker/index.ts`, `test/thread.test.ts`, and the README section "What it does not do". `bun run check` passes: 5 files and 36 tests, plus all static checks.

## Round-4 BLOCKER and MAJOR items

| Item | Status | Evidence |
| --- | --- | --- |
| M1: `Browser.close()` leaves pending CDP calls and viewer sockets hanging | FIXED | `close()` now calls `this.fail()` and then `this.abort.abort()` (`src/browser.ts:444-447`). `fail()` sets `closed`, runs every `closedListeners` entry, and settles every `waiting` resolver with `browser exited` (`:114-124`). `call()` turns that reply into a throw (`:198-203`), so a browser tool that is waiting rejects and the turn moves on. On the thread side, `browserDied` closes each viewer with 1011 (`src/thread.ts:918`), which runs `stop` and the `watched` decrement (`:190-201`, `:985`). New unit test: `test/surfaces.test.ts:124-140` checks that a pending `send` settles with an error, that the closed listener fires, and that `alive` is false. Gap: no test drives this through `Thread.closeSurface` with a real tool in flight. `Browser.open`'s `loaded` wait can still run for up to 15 s after close (`browser.ts:326-341`), but it ends on its own. |
| M2: compact during a turn, then pause, can deadlock | FIXED | `compact()` rejects with `ThreadBusy` when `ledger.busy` is set (`src/thread.ts:625-627`), the same rule pause uses (`:676`). Tested: `test/worker/index.ts:235-238` compacts during a running turn, and `test/thread.test.ts:87` asserts the refusal. A narrow version of the cycle is still possible (MINOR 1 below). |

## Round-4 MINORs

1. `terminalSocket` outside `using()`: FIXED. `awake()` and `container.exec` now run inside `using()` (`thread.ts:839-848`).
2. `awake()` and `start()` loop on `pausing` with no bound: NOT FIXED (`thread.ts:277`, `:498`).
3. `CreditWindow.ack` trusts the client's byte count: NOT FIXED (`flow.ts:23-26`). The effect is limited to that client's own socket.
4. `alarm()` idle-branch `ThreadBusy` fails the alarm: FIXED. It is caught and re-armed (`thread.ts:590-596`).
5. From round 3: the lifecycle test still accepts either outcome: NOT FIXED (`test/thread.test.ts:89`, `:91`).
6. From round 3: the 20 s `setTimeout` in `alarm()` is never cleared: NOT FIXED (`thread.ts:561-564`).

## New BLOCKER / MAJOR findings

None.

## New MINORs

1. **Residual M2 window:** `start()` sets `ledger.busy` only after `await agent.submit` (`thread.ts:503-506`). A compact that arrives during that await passes the guard at `:626` even though a turn is already queued. Pausing then gives the old cycle: a tool's `awake()` waits on `pausing` (`:277`), `pausing` waits on the compaction, and the compaction may wait on the turn, depending on how Pi Durable orders them. Smallest fix: set `busy = true` before `submit` (and roll it back on throw), or skip the `pausing` wait in `awake()` while `ledger.busy`.
2. **Viewer count leak in `browserSocket`:** `watched(server)` runs at `thread.ts:930`, before `await browser.cast(true)` (`:938`). If the browser dies in that gap (a pause or `closeSurface` racing the connect), `cast` throws and the socket is never returned. `closedListeners` already fired, so `browserDied` never runs, and `viewers` stays above 0. That blocks idle auto-pause (`:580`) until the DO is evicted. Fix: call `watched` after `cast` and `paintNow`, or wrap the setup in try/catch that closes `server`.
3. **Stale-promise clobber in `openBrowser`:** its `.catch` sets `this.browser = undefined` without checking `this.browser === <this promise>` (`thread.ts:398-401`). A launch that fails after `pauseNow` or `closeSurface` already replaced it can drop a newer browser. The next tool call then starts a second Chromium and the first one leaks.
4. **Browser tab comes back after closing:** `closeSurface('b1')` while a launch is in flight removes the surface, then the launch's `ensureBrowserSurface()` adds it back (`thread.ts:395`, `:815-820`). The tab shows a browser that was already closed. Cosmetic.
5. **No timeout on CDP calls:** `browser_eval` with `awaitPromise: true` (`browser.ts:393-397`) on a promise that never settles, or a WebAuthn wait, holds the turn and `busy` open forever. The alarm keeps re-arming (`thread.ts:566-569`), so the computer is never auto-paused until a human closes the browser. The README documents the WebAuthn case (line 181) but not `eval`. Fix: a per-call timeout in `send()`.
6. **`Browser.cast` sets `casting` before the CDP call:** a failed `startScreencast` leaves `casting = true` (`browser.ts:308-321`), so later `cast(true)` calls do nothing and `resize` restarts a screencast that never started.

## Assessment

Both round-4 MAJORs are closed with small, targeted changes and tests: `close()` now goes through `fail()`, and compaction refuses while the agent is busy. The remaining lifecycle risks are narrow races (MINOR 1 to 3), and none is a likely deadlock under normal use.

VERDICT: PASS

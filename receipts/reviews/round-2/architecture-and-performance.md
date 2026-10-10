# coil: architecture and performance review, round 2

Scope: README.md, src/, src/ui/, computer/Dockerfile, scripts/, test/, receipts/, and commit `318c5d5` (the round-1 fixes). `bun run check` passes: every static check and the offline suite.

## Round-1 BLOCKER and MAJOR items, checked one by one

| Item | Status | Evidence |
| --- | --- | --- |
| B1 inactivity stop loses work | **FIXED, with a new hole (N2)** | `src/thread.ts:526-560` alarm auto-pauses after 9 min idle. The platform timeout is now 60 min (`src/computer.ts:34`). `recordLostComputer` (`thread.ts:511`) writes a History notice when the computer is found stopped while `phase==='awake'`. A test covers it (`test/thread.test.ts:81`). |
| B2 missing `receipts/reviews/` | **FIXED** | `receipts/reviews/round-1/` exists. `check.sh` now verifies README receipt links. |
| M1 exec retries commands that already ran | **FIXED** | `computer.ts:44-62`: only `container.exec()` rejections are retried. A failure in `output()` raises `ComputerLost`. |
| M2 WebSocket back-pressure | **NOT FIXED. The fix is a no-op on workerd.** | See N1. |
| M3 pause during a turn or boot | **PARTIALLY FIXED** | `pauseNow` awaits `booting` and returns 409 when `busy` (`thread.ts:621-624`). Pause, compact, and snapshot are serialized. But `awake()`, `start()`, `exec()`, the terminal and browser sockets, and `children.spawn` are not serialized with them. See N3. |
| M4 output held in DO memory, no limit on human exec | **FIXED** | `shell.ts`: `head -c 256K` runs inside the container. Human and MCP exec go through `bounded(argv, 600)` (`thread.ts:561`). |
| M5 snapshots never deleted | **DOCUMENTED** | README, "Snapshots are kept…": the `Container` type has `snapshotContainer` but no delete (`workers-types/index.d.ts:3994`). That is an honest limit with a concrete reason. |
| M6 browser sockets stay open after Chromium dies | **FIXED** | `browser.ts:118-124` runs `closedListeners`. `thread.ts:820` closes each viewer with 1011. |

## New or remaining findings

### N1. MAJOR: back-pressure reads a property workerd does not have
- **Where:** `src/terminal.ts:9-10`, `src/terminal.ts:108`, `src/browser.ts:276-286`, `src/thread.ts:805`
- **What is wrong:** `bufferedBytes` returns `socket.bufferedAmount ?? 0`. The Workers `WebSocket` interface in `@cloudflare/workers-types/index.d.ts` has no `bufferedAmount`. The members are `accept`, `send`, `close`, the attachment methods, `readyState`, `url`, `protocol`, `extensions`, and `binaryType`. The installed workerd binary also contains no `bufferedAmount` string, while `binaryType`, `readyState`, and `serializeAttachment` all appear. The cast `as WebSocket & { bufferedAmount?: number }` only exists to silence the type checker. At runtime the value is always `0`, so:
  - the terminal drain loop never waits, and `yes` still buffers without limit in the DO;
  - `ackWhenViewersCatchUp` always acks at once, so Chromium is never throttled;
  - the slow-viewer frame skip never triggers.
- **Why it matters:** The round-1 commit message says "back-pressure". The code looks like back-pressure, but it does nothing on the platform it ships to. No test exercises it, because the in-memory double never sets `bufferedAmount`. The 128 MB DO OOM risk from round 1 is unchanged.
- **Smallest fix:** Use a signal that exists.
  - Terminal: count bytes sent and require an app-level ack from the client every N KB. cloudterm already owns the client. Stop reading `stdout` while more than about 1 MB is unacknowledged.
  - Browser: ack the CDP frame only after the client acks the previous frame, with one frame in flight per viewer.
  - Add a test with a socket double whose acks lag.
  - Until then, remove the claim from the commit message and the README.

### N2. MAJOR: auto-pause can destroy the computer under a running human or MCP command
- **Where:** `src/thread.ts:559-563`, `src/thread.ts:548-557`, `src/shell.ts:3`
- **What is wrong:** `exec()` calls `touch()` only after the command finishes, and it never sets `busy`. Human and MCP commands may run for 600 s, but the auto-pause fires after 540 s idle (`AUTO_PAUSE_AFTER_MS`). Any `thread_exec` such as `npm ci` or a test suite that runs longer than about 9 minutes after the last activity is snapshotted mid-write and then `destroy()`ed. The caller gets `ComputerLost` and a torn snapshot. The same applies to a long `files`/`readFile` call or a fork snapshot in flight. The `viewers` counter covers only WebSockets.
- **Why it matters:** This is the B1 class of data loss again, now caused by coil's own timer. The README limit "Commands from the API and MCP stop after 10 minutes" suggests a 10-minute command is supported.
- **Smallest fix:** Keep an in-flight operation counter: increment in `exec`, `readFile`, `list`, and `snapshot`, decrement in `finally`. Have `alarm()` re-arm while it is above 0. Or set `AUTO_PAUSE_AFTER_MS` above `HUMAN_LIMIT_SECONDS` and call `touch()` before the exec starts as well as after.

### N3. MAJOR: the lifecycle is only partly serialized; a turn can start during a pause snapshot
- **Where:** `src/thread.ts:474-484` (`start`), `src/thread.ts:621-650` (`pauseNow`), `src/thread.ts:259-305` (`awake`), `src/thread.ts:311-314` (`children.spawn`)
- **What is wrong:** `pauseNow` checks `busy` once, then awaits `box.snapshot(...)`, which takes seconds. During that await:
  - `start()` can run, because it is not in `serialized`. It sets `busy=true`, and the agent's `run` tool calls `awake()`. `awake()` sees the container still running, skips boot, and executes the command. `pauseNow` then `destroy()`s the container under that `replay: "unsafe"` command and sets `phase='paused'` while `busy===true`.
  - A terminal attach or browser open in the same window has the same problem.
  - The next `awake()` reboots from the pause snapshot, which does not include the command's effects, and logs no lost-computer notice because `phase==='paused'`.
- **Why it matters:** This is exactly the round-1 M3 scenario ("pause during a turn"). The 409 only covers a turn that was already running before pause started. The README now promises "a snapshot never catches a command halfway".
- **Smallest fix:** Route `start`, `awake`, and `children.spawn` through `serialized`. At minimum, make `start()` await `this.lifecycle` and have `awake()` refuse or wait while a pause holds the chain. Add an offline test: start pause, call `start()` before the snapshot resolves, and assert that either the turn waits or pause returns 409.

### MINOR
1. **The README cites a report that does not exist.** README row `receipts/reviews/` says "the final round is the top-level reports", but only `round-1/` is in the tree. Commit the round-2 reports, or reword the row until they exist.
2. **The idle alarm still blocks for 20 s per tick.** `thread.ts:528-532`: `Promise.race` with a 20 s timer inside `alarm()` is acceptable. But the losing `setTimeout` is never cleared, and each tick also calls `open()`. Polling `busy` and re-arming would be cheaper.
3. **The `viewers` count lives in memory** (`thread.ts:171`). After a DO restart with sockets still attached, which is rare because sockets keep the DO alive, the count resets to 0 and the thread could auto-pause under an open terminal. Persist the count, or derive it from `ctx.getWebSockets()` if you move to hibernatable sockets.
4. **`stderr` truncation is silent.** `shell.ts:20`: the byte total is reported only for stdout.
5. **Still open from round 1** (all MINOR): browser input interleaving between tabs; `Browser.open` resolving on any load event; the duplicate screen on reattach; the `view()` Directory hop; the service-worker cache version; the Google Fonts dependency. The cold-start numbers are now labelled as lab numbers, with the production 5.5 s stated, so that item is fixed.

## Abstractions

The `serialized()` chain is the right primitive, but only three entry points use it. Finishing N3 means one lifecycle owner that every container touch goes through, which would also fix N2 naturally. Back-pressure needs an application-level ack, because the platform gives you no `bufferedAmount`.

VERDICT: FAIL

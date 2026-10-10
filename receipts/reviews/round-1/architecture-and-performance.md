# coil: architecture and performance review

Scope: README.md, src/, src/ui/, public/, computer/Dockerfile, scripts/, test/, receipts/*.json. `bun run check` passes: 4 files, 26 tests, and every static check.

## BLOCKER

### B1. The 10-minute inactivity stop throws away all work since the last snapshot
- **Where:** `src/computer.ts:34`, `src/computer.ts:79`, `src/thread.ts:223-226`
- **What is wrong:** `setInactivityTimeout(10 min)` lets the platform stop the container with no snapshot. The next `awake()` sees `!running()` and boots from `ledger.bootSnapshot()`, which is the last pause, compact, or base snapshot. Nothing records the stop, and `phase` stays `awake`.
- **Why it matters:** The README says "Leave and come back; the turn keeps going" and "Checkpoints that match." In practice, an agent's commits and files from a long session silently go back to an older disk after 10 idle minutes. The transcript still describes files that no longer exist. That breaks the core promise that the disk and the conversation stay paired.
- **Smallest fix:** Pause before the container idles out. Set a DO alarm at `lastActivity + 9 min` that calls `pause()`, and use a long platform timeout as the backstop. If the container is found stopped while `phase === 'awake'`, show "computer was lost, restored to <pair.at>" in the transcript instead of hiding it.

### B2. The README links a proof directory that does not exist
- **Where:** `README.md`, "How do I know it works?" table, row `receipts/reviews/`
- **What is wrong:** The README claims "Two independent adversarial reviews of the architecture, performance, and OSS readiness" at `receipts/reviews/`. That path is not in the tree, and `git ls-files receipts` does not list it.
- **Why it matters:** A dead link on the proof table is the first thing a stranger clicks, and it undermines every other receipt.
- **Smallest fix:** Commit the reviews or delete the row. `scripts/verify-receipts.mjs` should also fail when a README receipt link is missing.

## MAJOR

### M1. `exec` retries commands that already ran
- **Where:** `src/computer.ts:44-62`
- **What is wrong:** Any throw is retried up to 3 times. That includes a throw from `process.output()` after the process started. So `git commit`, `npm publish`, or a `run` tool call can execute two or three times.
- **Why it matters:** This contradicts the README line "`run` … `replay: "unsafe"` … does not run the command again." The duplication happens below Pi Durable, where the replay guard cannot see it.
- **Smallest fix:** Retry only when `container.exec(...)` itself rejects, before a process exists. Once `output()` has started, any failure should surface as `ComputerLost`.

### M2. No back-pressure on the terminal or browser WebSockets
- **Where:** `src/terminal.ts:100`, `src/browser.ts:145`, `src/thread.ts:701-707`
- **What is wrong (terminal):** `for await (chunk) socket.send(chunk)` ignores `bufferedAmount`. Running `yes` or `cat bigfile` on a slow or mobile link buffers without limit in the Durable Object.
- **What is wrong (browser):** `Page.screencastFrameAck` goes out as soon as a frame arrives, before anything reaches the client. Chromium therefore never throttles. Each frame is also base64-decoded once per connected tab (`atob` + `Uint8Array.from` on the DO's single thread), so two tabs cost twice the CPU.
- **Why it matters:** DO memory is capped at 128 MB, and the DO is single-threaded. One flooding terminal can evict the DO mid-turn and stall every other surface and the SSE stream for that thread.
- **Smallest fix:**
  - Terminal: pause reading `stdout` while `socket.bufferedAmount` is above about 1 MB.
  - Browser: send the ack only after the frame has been sent to every client with a small `bufferedAmount`, or skip frames for any client that is behind. Decode each frame once and share the bytes across tabs.

### M3. Pause can run while a turn or boot is in flight
- **Where:** `src/thread.ts:523-550`, `src/service.ts:73`
- **What is wrong:** `pause()` does not check `ledger.busy` and does not await `this.booting`. Pausing during a turn snapshots the disk while a command is writing to it, then destroys the container under a running `run` tool, which is `replay: unsafe`. The agent's next tool call then calls `awake()` and silently boots a new computer, so `phase` flips back to `awake` right after the pause.
- **Second race:** Pausing while `awake()` is booting can destroy a container that `awake()` then reports as ready.
- **Why it matters:** This is exactly the "pause during a turn" case. The result is a torn snapshot plus a thread that un-pauses itself.
- **Smallest fix:** In `pause()`, await `this.booting` first. If `busy`, either reject with 409 or abort the turn and wait for `agent.idle()`. Then snapshot and destroy. Serialize lifecycle operations (pause, compact, fork snapshot) behind one promise chain.

### M4. Exec output is held in full in Durable Object memory, and human exec has no time limit
- **Where:** `src/computer.ts:50`, `src/shell.ts:9-10`, `src/index.ts:86-95`, `src/ledger.ts:207-208`
- **What is wrong:** `process.output()` buffers all of stdout and stderr. `boundedShell` writes everything to temp files and then `cat`s it, so a 2 GB log becomes a 2 GB string in the DO. That string is then hashed and UTF-8-encoded again in `logExec`. The `/api/threads/:name/exec` and `thread_exec` paths skip `boundedShell` entirely, so they have no 120 s limit and no abort.
- **Why it matters:** One chatty command OOMs the Durable Object. An MCP client can also hang a DO request forever.
- **Smallest fix:** Cap output inside the container (`head -c 1M` on both files, plus a byte count and hash computed there). Route human and MCP exec through the same bounded wrapper, with a larger configurable limit.

### M5. Snapshots are never deleted
- **Where:** `src/thread.ts:272`, `src/thread.ts:507`, `src/thread.ts:520`, `src/thread.ts:537`, `src/service.ts:106`; there is no `deleteSnapshot` anywhere in `src/`
- **What is wrong:** Every pause, compact, fork, child, and base creates a full container snapshot. Replacing a base leaves the old one behind. Threads cannot be deleted at all.
- **Why it matters:** Storage and cost grow without limit on the owner's account. The README never says this.
- **Smallest fix:** Keep the latest N pairs per thread and delete older snapshots. Delete the previous base snapshot in `setBase`. Document the retention policy.

### M6. Browser sockets are not closed when Chromium dies, and the loss is invisible
- **Where:** `src/browser.ts:109-115`, `src/thread.ts:697-778`
- **What is wrong:** `fail()` marks the browser closed but leaves the WebSocket listeners attached and never closes the client sockets. The UI keeps showing the last frame as if it were live, and its reconnect logic never fires. Input then fails with toasts, one per keystroke.
- **Why it matters:** "You and the agent drive the same page" quietly turns into a frozen picture after a Chromium crash or OOM. That is common with `--disable-dev-shm-usage` on standard-1.
- **Smallest fix:** Keep a set of the browser's sockets and `close(1011)` them in `fail()`. The client already reconnects and calls `openBrowser()`, which relaunches Chromium.

## MINOR

1. **Browser input can interleave between tabs.** `src/thread.ts:732-764`: each WebSocket message starts its own async task. `click` takes three sequential CDP calls, so a key from a second tab, or a `browser_click` from the agent, can land between press and release. Fix: push all input through one promise queue per `Browser`.
2. **`Browser.open` can resolve too early.** `src/browser.ts:293-302`: the "loaded" listener resolves on any page event, including a `refreshPage` that started before the navigation. The agent can then read the old page. Fix: resolve only on `loadEventFired` for the new loader id.
3. **Reattaching can draw the screen twice.** `src/terminal.ts:32-34`: the 3000-line `capture-pane` dump is followed by tmux's full redraw on attach. Full-screen apps such as `vi` and `top` get duplicated output in scrollback. Fix: skip the capture when the pane is in the alternate screen, or capture only `-S -` history above the visible area.
4. **The idle alarm can hit the alarm wall-clock limit.** `src/thread.ts:466-471`: `alarm()` awaits a whole turn, and long turns (the receipt shows 128 s; others may run far longer) can exceed it. When the alarm retries, `busy` can stay `true`. Fix: re-arm the alarm and poll `idle` with a short timeout instead of blocking.
5. **Every `view()` costs an extra Directory hop.** `src/thread.ts:575`: each view makes a cross-DO round trip just to read the title, and each reload of the full transcript pays it. Fix: store the title in the ledger.
6. **Service worker version and offline navigation.** `src/ui/sw.ts:2` and `:39`:
   - The cache version is `TERM_VERSION` only. The inline client and HTML are not part of it. This works today only because navigation is network-first.
   - Offline, the shell cached from `/` is served for every `/t/*` URL. That is fine, but `cache.addAll` in `install` fails outright if any of the four URLs gets an Access redirect at install time.
   - Fix: version the cache on a hash of the page plus the term bundle, and use `Promise.allSettled` when precaching.
7. **Google Fonts dependency.** `src/ui/index.ts:21-25`: the PWA shell loads a third-party stylesheet on every load, which hurts the offline story and leaks visits. Fix: self-host the fonts under `/assets/`.
8. **Bundle size.** `src/ui/term.generated.ts` is about 78 KB, embedded as a string in the Worker. That is fine, but it is served uncompressed unless Cloudflare compresses it. Fix: leave as is, or move it to static assets so it gets edge caching and brotli.
9. **The cold-start claim does not match the production receipt.** README "Cold start ~2 s / ~33 fps / ~46 ms" comes from `browser-eval.json`. The production receipt `live-v3.json` shows `openMs` 5513, first frame at 6048 ms, and 23.3 fps. Fix: quote the production numbers, or label the table as a lab measurement.

## Abstractions

The overall shape is right: one DO plus one container per thread, a Directory DO, and a CDP pipe with no open port. The `Computer` interface and the in-memory test double are good choices. Two gaps:

- The lifecycle has no single serializer. `awake`, `pause`, `compact`, `fork`, and the browser all race on the container.
- `Thread` (783 lines) mixes the HTTP and WebSocket bridges with lifecycle logic. Moving the socket bridges into `terminal.ts` and `browser.ts`, with a `Lifecycle` mutex in `thread.ts`, would make M3 and M6 straightforward to fix and to test.

None of B1, M1, M2, M3, or M4 has an offline test, even though the in-memory computer could cover each of them.

VERDICT: FAIL

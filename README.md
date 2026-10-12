<p align="center">
  <img src="docs/brand/coil-wordmark.svg" width="220" alt="coil">
</p>

<p align="center"><b>Agent threads with their own computer, in the cloud.</b><br>
Each thread gets terminals, a real Chrome window, and a disk. You and the agent use the same ones, from any device.</p>

<p align="center">
  <a href="#quick-start-for-agents">For agents</a> ·
  <a href="#deploy">Deploy</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#limits">Limits</a> ·
  <a href="#proof">Proof</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark-v6.png">
  <img src="docs/hero-light-v6.png" alt="A coil thread: chat on the left, the thread's computer on the right with a counter page the agent built and opened in its own Chrome.">
</picture>

<sub>One prompt. The agent wrote a page, served it on <code>localhost:3000</code>, opened it in the thread's own Chrome, clicked <b>+</b> three times, and read back <b>3</b>. <a href="docs/demo-counter.mp4">Watch the 8-second clip</a>.</sub>

coil is one Cloudflare Worker. Every thread is a [Durable Object](https://developers.cloudflare.com/durable-objects/) that runs a [Pi](https://github.com/earendil-works/pi) agent and owns a [Container](https://developers.cloudflare.com/containers/). It installs as a PWA. There is no desktop app, extension, or local helper.

## Quick start for agents

Paste this to your coding agent:

```text
Deploy coil (https://github.com/acoyfellow/coil) to my Cloudflare account.
Read README.md "Deploy". Copy deploy/example.conf to deploy/<name>.conf,
ask me for the values you cannot look up, then run
`bun run ship -- deploy/<name>.conf` and confirm the URL answers with an
Access login. Never commit deploy/<name>.conf.
```

Once it is deployed, an agent can drive coil without the UI:

| Surface | Use it for |
| --- | --- |
| `POST /mcp` | MCP tools: `thread_create`, `thread_send`, `thread_exec`, `thread_read_file`, `thread_fork`, `thread_pause`, `thread_compact`, `thread_resize`, `thread_status`, `thread_list`, `base_prepare` |
| `POST /api/threads/:name/messages` | One turn. Send `idempotency-key`; `"wait": true` returns the answer |
| `GET /api/threads/:name/events` | Server-sent events while a turn runs |
| `POST /api/threads/:name/pause` · `/fork` | Save the disk and stop · start a new thread from this disk |

Every request needs a Cloudflare Access token (`cf-access-token` header or the Access cookie). Get one from a shell with `cloudflared access login https://<your-domain>` then `cloudflared access token -app https://<your-domain>`.

## What you get

| | |
| --- | --- |
| **A computer per thread** | `/workspace` is a git repo (or a clone of the repo you give). bash, git, node, python3, curl, ripgrep, jq. The image's git refuses force-push. |
| **Terminals** | As many as you want. Each is a tmux session the agent can use too. Reload the page and the shell is still there. |
| **A real browser** | Headed Chrome in the same computer, shown over VNC. It opens the agent's `localhost:3000`. Tabs, menus, and DevTools work. The agent drives the same window with browser tools; the panel follows it. Logins persist across pauses. |
| **Pause, fork, compact** | Pause saves the disk and stops the computer. Fork starts a new thread from this disk plus a summary. Compact records the summary and the disk together, so they always match. |
| **Child threads** | The agent can give a side task to a child thread with its own computer and wait for the answer. |
| **Loops** | Run a prompt on a schedule until a gate command exits 0, a run count is reached, or you stop it. |
| **Models** | Workers AI by default. Add an AI Gateway or any OpenAI/Anthropic-compatible gateway for frontier models. Pick per thread. |
| **Spend** | A per-person dollar limit, set from the sidebar. No limit by default. Each thread shows context used and dollars spent. |
| **Layout** | Collapse or resize the thread list (⌘B) and the computer (⌘J). ⌘K opens the command palette. Phones get drawers. |
| **Share** | A read-only link to a conversation, still behind your Access policy. |
| **Private by owner** | Everyone your Access policy admits gets their own threads. Nobody can open anyone else's. |

<img src="docs/hero-phone-v6.png" width="260" alt="coil on a phone">

## Deploy

One command per instance. Each instance has one config file that never leaves your machine.

**You need**

- Bun and Docker (builds `linux/amd64`).
- A Cloudflare account on Workers Paid with Containers and Workers AI, and `npx wrangler login`.
- A zone in that account for the hostname.
- Zero Trust, with a self-hosted **Access application** for exactly that hostname. Copy its **Application Audience (AUD)**.
- The [nix-cf-proof](https://github.com/acoyfellow/nix-cf-proof) base image in that account's registry (`npx wrangler containers push`).

**Then**

```sh
git clone https://github.com/acoyfellow/coil && cd coil && bun install
cp deploy/example.conf deploy/mine.conf     # git ignores deploy/*.conf
$EDITOR deploy/mine.conf
bun run ship -- deploy/mine.conf
```

`ship` runs typecheck, lint, and tests, builds the computer image, deploys to the account in the file, stores any gateway token as a Worker secret, and fails unless the URL answers with an Access login. If Access values are missing, the Worker answers 503 and serves nothing.

**Public and private instances.** The repo holds the engine and `deploy/example.conf`. Your real instances live in `deploy/<name>.conf` files that git ignores: account ID, hostname, Access AUD, image, and gateway settings. Keep several side by side (for example a personal one and a team one) and ship each with its own file. Nothing private is committed, and `bun run check` fails if an account ID or token appears in a tracked file.

**Models** (all optional, in the same file)

| Setting | Effect |
| --- | --- |
| `COIL_MODEL` | Default Workers AI model. Default `@cf/zai-org/glm-5.3`. |
| `COIL_AI_GATEWAY` | An AI Gateway in the same account. Enables the `gateway/*` models through the AI binding, billed to that account. |
| `COIL_MODEL_GATEWAY_URL`, `COIL_MODEL_GATEWAY_HEADER`, `COIL_MODEL_GATEWAY_TOKEN_COMMAND` | Any gateway that serves `<url>/openai` and `<url>/anthropic`. The token command runs on your machine at deploy time; its output becomes a Worker secret. |

### Run locally

```sh
NIX_IMAGE=<image> node scripts/with-image.mjs
npx wrangler dev -c wrangler.local.jsonc --var LOCAL_DEV_WITHOUT_ACCESS:1
```

Real containers in Docker and real Workers AI. Open `http://localhost:8787/`.

## Limits

- **Passkeys and security keys do not work in the cloud browser.** The key is on your device; WebAuthn only signs for the page's own site. Password + TOTP logins work and stay logged in.
- **Idle threads pause after 9 minutes** with no turn, command, or open terminal or browser. The next action resumes them.
- **A resumed computer gets its disk back, not its processes.** Terminals reopen in the same folders; Chrome reopens with its cookies.
- **The browser view is 1280×800, scaled to fit.**
- **Agent commands stop after 120 seconds.** Start servers in the background. API and MCP commands stop after 10 minutes. Output is cut at 256 KB.
- **Computers have internet access.** coil is not a sandbox for hostile code.
- **Snapshots are kept.** The container binding has no delete call yet.
- **Notifications need an open tab.** No Web Push yet.
- **No splits yet.** The computer panel is one row of tabs.

## Proof

`bun run check` runs the offline suite in workerd: the real `Thread` and `Directory` Durable Objects and the real Pi harness, with a scripted model and an in-memory computer.

| Test | Proves |
| --- | --- |
| Isolation | One thread's files are not visible to another |
| Kill and resume | A thread killed mid-turn finishes the same request once |
| Compaction pairs | After compact, pause, kill, resume, the disk and summary come back together |
| Access | Missing, expired, wrong-issuer, wrong-audience, or wrong-key tokens are refused |
| Owners | A second user cannot list, read, run, pause, or fork your threads |
| Spend | A person over their limit cannot start turns or children |
| Gateways | Gateway models route to the right path and never send a provider key |

| Receipt | Shows |
| --- | --- |
| [`receipts/live-v5.json`](receipts/live-v5.json) | Production run: loops, share links, notifications, edit and retry, palette, phone layout, agent tools |
| [`receipts/lighthouse-v5.json`](receipts/lighthouse-v5.json) | Lighthouse 99 / 100 / 100 / 100 |
| [`receipts/flow-control.json`](receipts/flow-control.json) | Terminal output stops for a client that stops acknowledging |
| [`receipts/browser-eval.json`](receipts/browser-eval.json) | Why the browser runs inside the computer |
| [`receipts/reviews/`](receipts/reviews) | Independent adversarial reviews, every round kept |
| [`docs/research/remote-webauthn.md`](docs/research/remote-webauthn.md) | What can and cannot work for security keys from a PWA |

## Where things live

| Path | What |
| --- | --- |
| [`src/agent.ts`](src/agent.ts) | The prompt and the agent's tools |
| [`src/thread.ts`](src/thread.ts) | One thread: boot, pause, compact, fork, children, loops, live events |
| [`src/gateway.ts`](src/gateway.ts) | Model routing: Workers AI, AI Gateway, external gateways |
| [`src/browser.ts`](src/browser.ts) | Xvfb, x11vnc, and Chrome over a CDP pipe |
| [`src/terminal.ts`](src/terminal.ts) | tmux over a PTY WebSocket with flow control |
| [`client/src/`](client/src) | The web client ([foldkit](https://github.com/foldkit/foldkit) on [Effect](https://effect.website)) |
| [`computer/Dockerfile`](computer/Dockerfile) | The computer image |
| [`scripts/ship.sh`](scripts/ship.sh), [`deploy/example.conf`](deploy/example.conf) | Deploy |

## Built on

[Pi](https://github.com/earendil-works/pi) · [armada](https://github.com/AshishKumar4/armada) (snapshot and restart) · [tardigrade](https://github.com/acoyfellow/tardigrade) · [cloudterm](https://github.com/acoyfellow/cloudterm) · [noVNC](https://github.com/novnc/noVNC) · [nix-cf-proof](https://github.com/acoyfellow/nix-cf-proof)

## License

MIT

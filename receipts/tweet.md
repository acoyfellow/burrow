# Launch tweet (draft)

Every agent thread should get a real computer you can share with it.

So I built coil. Each thread has its own Cloudflare Container:
- terminals (tmux) you and the agent both type in
- a Chromium inside the box, so it opens the agent's localhost:3000 and you click the same page
- pause, compact, and fork save the chat and the exact disk together

Installable PWA. Open source. One command to deploy your own.

github.com/acoyfellow/coil

[hero image: docs/hero-dark.png — the agent built a counter app, served it on localhost:3000, clicked + three times, and read back 3]

## Reply thread

1/ The terminal is cloudterm, a renderer I wrote for this. Its CI replays 15 real tmux sessions (vi, less, top, scroll regions) and matches tmux's own screen, cursor included.

2/ The browser runs in the container, not in a hosted browser service. I measured three engines; only this one could open the dev server the agent just started.

3/ What it does not do: it does not restore running processes after a pause, it is single-user behind Cloudflare Access, and it does not work offline.

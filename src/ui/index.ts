import { CLIENT } from './client';
import { STYLE } from './style';

export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>burrow</title>
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <b>bur<span>row</span></b>
      <span style="display:flex;gap:6px">
        <button class="primary" id="new-side">New thread</button>
        <button class="ghost narrow" id="side-close" aria-label="Close">✕</button>
      </span>
    </div>
    <nav class="list" id="list" aria-label="Threads"></nav>
    <div class="who" id="whoami"></div>
  </aside>
  <main class="main">
    <header class="bar" id="bar"></header>
    <section class="feed" id="feed" aria-live="polite"></section>
    <div class="composer" id="composer">
      <div class="composer-inner">
        <textarea id="text" rows="1" placeholder="Ask the agent to do something in its computer"></textarea>
        <button class="primary" id="send">Send</button>
      </div>
      <div class="hint" id="hint"></div>
    </div>
  </main>
  <aside class="panel">
    <div class="tabs">
      <button data-tab="terminal" class="on">Terminal</button>
      <button data-tab="files">Files</button>
      <button data-tab="history">History</button>
      <span style="flex:1"></span>
      <button class="ghost narrow panel-toggle" id="panel-close" aria-label="Close">✕</button>
    </div>
    <div class="pane" id="pane"></div>
  </aside>
</div>
<dialog id="new">
  <form method="dialog">
    <h3>New thread</h3>
    <label>Git repository (optional)<input id="new-repo" placeholder="https://github.com/owner/repo" autocomplete="off"></label>
    <label>Title (optional)<input id="new-title" placeholder="What is this thread for?" autocomplete="off"></label>
    <div class="actions"><button type="button" id="new-cancel">Cancel</button><button class="primary" id="new-go" type="submit">Create</button></div>
  </form>
</dialog>
<script>${CLIENT}</script>
</body>
</html>`;

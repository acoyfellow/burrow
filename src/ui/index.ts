import { CLIENT } from './client';
import { FONTS, STYLE } from './style';
import { TERM_VERSION } from './term.generated';

export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<script>try{const t=localStorage.getItem("coil-theme");if(t)document.documentElement.dataset.theme=t}catch{}</script>
<title>coil</title>
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <b>co<span>il</span></b>
      <span style="display:flex;gap:2px;align-items:center">
        <button class="narrow" id="side-close" aria-label="Close">✕</button>
        <button class="new" id="new-side" title="New thread" aria-label="New thread">+</button>
      </span>
    </div>
    <nav class="list" id="list" aria-label="Threads"></nav>
    <div class="who"><span id="whoami"></span><button id="theme" title="Switch light or dark" aria-label="Theme">◐</button></div>
  </aside>
  <main class="main">
    <header class="bar" id="bar"></header>
    <section class="feed" id="feed" aria-live="polite"></section>
    <div class="composer" id="composer">
      <div class="composer-inner">
        <textarea id="text" rows="1" placeholder="Ask the agent to do something in its computer"></textarea>
        <div class="composer-foot"><div class="hint" id="hint"></div><button id="send" aria-label="Send">↑</button></div>
      </div>
    </div>
  </main>
  <aside class="panel">
    <div class="tabs" id="tabs"></div>
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
<script>window.__TERM_SRC = '/assets/term-${TERM_VERSION}.js';</script>
<script>${CLIENT}</script>
</body>
</html>`;

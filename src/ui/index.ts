import { APP_ENTRY } from './app.generated';
import { FONTS, STYLE } from './style';
import { TERM_VERSION } from './term.generated';

export const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Agent threads with their own computer: terminals, a browser, and a disk you can fork.">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141416" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="coil">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/coil.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="modulepreload" href="${APP_ENTRY}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="${FONTS}">
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<script>try{const t=localStorage.getItem("coil-theme");if(t)document.documentElement.dataset.theme=t}catch{}</script>
<title>coil</title>
<style>${STYLE}</style>
</head>
<body>
<div id="root"></div>
<script>window.__TERM_SRC = '/assets/term-${TERM_VERSION}.js';</script>
<script type="module" src="${APP_ENTRY}"></script>
</body>
</html>`;

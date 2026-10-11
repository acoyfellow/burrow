import type { ThreadView } from '../thread';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const said = (view: ThreadView) =>
  view.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text !== '')
    .map(
      (m) =>
        `<article class="${m.role}"><b>${m.role === 'user' ? 'you' : 'agent'}</b><pre>${escapeHtml(m.text)}</pre></article>`,
    )
    .join('\n');

export const sharedPage = (view: ThreadView) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(view.title)} · coil (shared)</title>
<style>
body{margin:0;font:15px/1.55 system-ui,sans-serif;background:#fafafa;color:#111}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:18px;margin:0 0 4px}.meta{color:#666;font-size:13px;margin-bottom:20px}
article{margin:0 0 14px;padding:10px 12px;border:1px solid #e5e5e5;border-radius:10px;background:#fff}
article.user{background:#f3f3f3}article b{display:block;font-size:12px;color:#666;margin-bottom:4px}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit}
@media (prefers-color-scheme:dark){body{background:#0b0b0c;color:#eee}article{background:#151517;border-color:#2a2a2e}article.user{background:#1d1d20}.meta,article b{color:#999}}
</style></head><body><main>
<h1>${escapeHtml(view.title)}</h1>
<div class="meta">Read-only shared thread · ${view.messages.length} messages · model ${escapeHtml(view.model)}</div>
${said(view)}
</main></body></html>`;

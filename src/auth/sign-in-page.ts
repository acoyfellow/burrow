const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const signInPage = ({ error }: { readonly error?: string }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>coil · sign in</title>
<link rel="icon" href="/icons/favicon.svg">
<style>
:root{color-scheme:dark;--bg:#0b0b0c;--panel:#141416;--line:#26262a;--text:#ececee;--muted:#9a9aa2;--accent:#F38020;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:400 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(380px,calc(100vw - 32px));padding:32px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.mark{display:block;width:120px;height:auto;margin:0 0 24px}
h1{font-size:20px;font-weight:600;margin:0 0 8px}
p{margin:0 0 20px;color:var(--muted)}
a.button{display:flex;align-items:center;justify-content:center;gap:8px;height:40px;border-radius:8px;background:var(--accent);color:#111;font-weight:500;text-decoration:none}
a.button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.error{color:var(--bad);margin:0 0 16px}
small{display:block;margin-top:16px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<main>
<img class="mark" src="/icons/coil.svg" alt="coil">
<h1>Sign in</h1>
<p>Use your Cloudflare account. Your threads run models on your own Workers AI and AI Gateway, and the usage is billed to that account.</p>
${error === undefined ? '' : `<p class="error" role="alert">${escapeHtml(error)}</p>`}
<a class="button" id="sign-in" href="/oauth/login">Sign in with Cloudflare</a>
<small>coil asks for Workers AI and AI Gateway access on the account you pick. You can revoke it at any time in your Cloudflare profile.</small>
</main>
</body>
</html>`;

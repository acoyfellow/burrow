export const PLAYER_VIDEO = '/brand/coil-demo.mp4';
export const PLAYER_POSTER = '/brand/coil-player.png';
export const PLAYER_WIDTH = 1280;
export const PLAYER_HEIGHT = 720;

const STYLE = `
html,body{margin:0;height:100%;background:#0b0b0c}
video{display:block;width:100%;height:100%;object-fit:contain;background:#0b0b0c}
`;

export const playerPage = (origin: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>coil demo</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<video src="${origin}${PLAYER_VIDEO}" poster="${origin}${PLAYER_POSTER}" controls muted playsinline preload="metadata" aria-label="coil demo: sign in with Cloudflare, ask an agent, watch it work on its own computer"></video>
</body>
</html>`;

export const playerMeta = (origin: string): string => `<meta name="twitter:card" content="player">
<meta name="twitter:site" content="@acoyfellow">
<meta name="twitter:title" content="coil · bring your own Cloudflare">
<meta name="twitter:description" content="One thread, one agent, one computer. Runs on your own Cloudflare account.">
<meta name="twitter:image" content="${origin}${PLAYER_POSTER}">
<meta name="twitter:image:alt" content="coil demo: an agent thread with its own computer on Cloudflare.">
<meta name="twitter:player" content="${origin}/player">
<meta name="twitter:player:width" content="${PLAYER_WIDTH}">
<meta name="twitter:player:height" content="${PLAYER_HEIGHT}">
<meta name="twitter:player:stream" content="${origin}${PLAYER_VIDEO}">
<meta name="twitter:player:stream:content_type" content="video/mp4">`;

const RANGE = /^bytes=(\d*)-(\d*)$/u;

type ByteSpan = { readonly start: number; readonly end: number };

export const byteSpan = (header: string | null, size: number): ByteSpan | null => {
  const match = header === null ? null : RANGE.exec(header.trim());

  if (match === null) return null;

  const [, from = '', to = ''] = match;

  if (from === '' && to === '') return null;

  if (from === '') return { start: Math.max(0, size - Number(to)), end: size - 1 };

  return { start: Number(from), end: to === '' ? size - 1 : Math.min(Number(to), size - 1) };
};

export const withRanges = async (request: Request, whole: Response): Promise<Response> => {
  if (!whole.ok) return whole;

  const bytes = await whole.arrayBuffer();
  const size = bytes.byteLength;
  const type = whole.headers.get('content-type') ?? 'application/octet-stream';
  const base = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  };
  const span = byteSpan(request.headers.get('range'), size);

  if (span === null)
    return new Response(bytes, { headers: { ...base, 'content-length': String(size) } });

  if (span.start >= size || span.start > span.end)
    return new Response(null, {
      status: 416,
      headers: { ...base, 'content-range': `bytes */${size}` },
    });

  return new Response(bytes.slice(span.start, span.end + 1), {
    status: 206,
    headers: {
      ...base,
      'content-length': String(span.end - span.start + 1),
      'content-range': `bytes ${span.start}-${span.end}/${size}`,
    },
  });
};

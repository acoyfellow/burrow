const encoder = new TextEncoder();

const keyFor = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (value: string) => {
  const pairs = value.match(/.{2}/gu) ?? [];

  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
};

export const SESSION_COOKIE = '__Host-coil_session';

export const FLOW_COOKIE = '__Host-coil_oauth';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const FLOW_TTL_MS = 10 * 60 * 1000;

const SEPARATOR = '.';

export const sign = async (secret: string, payload: string): Promise<string> => {
  const body = btoa(payload);
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(body));

  return `${body}${SEPARATOR}${hex(signature)}`;
};

export const unsign = async (secret: string, value: string | null): Promise<string | null> => {
  if (value === null) return null;

  const at = value.lastIndexOf(SEPARATOR);

  if (at <= 0) return null;

  const body = value.slice(0, at);
  const signature = fromHex(value.slice(at + 1));
  const valid = await crypto.subtle.verify(
    'HMAC',
    await keyFor(secret),
    signature,
    encoder.encode(body),
  );

  if (!valid) return null;

  try {
    return atob(body);
  } catch {
    return null;
  }
};

export const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get('cookie') ?? '';

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');

    if (key === name) return decodeURIComponent(rest.join('='));
  }

  return null;
};

export const cookie = (name: string, value: string, maxAgeMs: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;

export const clearCookie = (name: string) =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export type Session = { readonly owner: string; readonly expires: number; readonly id: string };

export const sessionValue = (session: Session) => JSON.stringify(session);

export const parseSession = (raw: string | null, now = Date.now()): Session | null => {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('owner' in parsed) ||
      !('expires' in parsed) ||
      !('id' in parsed)
    )
      return null;

    const { owner, expires, id } = parsed;

    return typeof owner === 'string' &&
      typeof expires === 'number' &&
      typeof id === 'string' &&
      expires > now
      ? { owner, expires, id }
      : null;
  } catch {
    return null;
  }
};

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { accessConfig, verifyAccess } from '../src/auth/access-jwt';

const TEAM = 'https://coil-test.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const config = { teamDomain: TEAM, audience: AUD };

let keys: CryptoKeyPair;
let jwk: JsonWebKey;

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;

  return btoa(String.fromCharCode(...raw))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

const sign = async (claims: Record<string, unknown>, kid = 'k1', key = keys.privateKey) => {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );

  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
};

const now = () => Math.floor(Date.now() / 1000);

const good = () => ({ iss: TEAM, aud: [AUD], exp: now() + 300, sub: 'u1', email: 'me@x.dev' });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: 'k1', kty: 'RSA' }] })),
  );
});

afterEach(() => vi.clearAllMocks());

describe('accessConfig', () => {
  test('rejects a missing or malformed audience or team domain', () => {
    expect(accessConfig(undefined, AUD)).toBeNull();
    expect(accessConfig(TEAM, undefined)).toBeNull();
    expect(accessConfig('https://evil.example.com', AUD)).toBeNull();
    expect(accessConfig(TEAM, '0'.repeat(10))).toBeNull();
    expect(accessConfig(`${TEAM}/`, AUD)).toEqual(config);
  });
});

describe('verifyAccess', () => {
  test('accepts a valid token', async () => {
    await expect(verifyAccess(await sign(good()), config)).resolves.toEqual({ email: 'me@x.dev' });
  });

  test('rejects a missing token', async () => {
    await expect(verifyAccess(null, config)).rejects.toThrow('missing token');
  });

  test('rejects garbage', async () => {
    await expect(verifyAccess('a.b', config)).rejects.toThrow('malformed');
  });

  test('rejects the wrong audience', async () => {
    await expect(
      verifyAccess(await sign({ ...good(), aud: 'b'.repeat(64) }), config),
    ).rejects.toThrow('wrong audience');
  });

  test('rejects the wrong issuer', async () => {
    await expect(
      verifyAccess(await sign({ ...good(), iss: 'https://other.cloudflareaccess.com' }), config),
    ).rejects.toThrow('wrong issuer');
  });

  test('rejects an expired token', async () => {
    await expect(
      verifyAccess(await sign({ ...good(), exp: now() - 3600 }), config),
    ).rejects.toThrow('expired');
  });

  test('rejects a token signed by another key', async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    await expect(verifyAccess(await sign(good(), 'k1', other.privateKey), config)).rejects.toThrow(
      'bad signature',
    );
  });

  test('rejects an unknown key id', async () => {
    await expect(verifyAccess(await sign(good(), 'nope'), config)).rejects.toThrow(
      'unknown signing key',
    );
  });
});

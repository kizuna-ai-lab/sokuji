import { describe, it, expect } from 'vitest';
import { ZoomJwtSigner } from './ZoomJwtSigner';

function decodeSegment(seg: string): any {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
}

describe('ZoomJwtSigner', () => {
  it('produces a well-formed HS256 JWT with iss=apiKey', async () => {
    const signer = new ZoomJwtSigner('MY_KEY', 'MY_SECRET');
    const token = await signer.getToken();
    const [h, p, s] = token.split('.');
    expect(h && p && s).toBeTruthy();
    expect(decodeSegment(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const payload = decodeSegment(p);
    expect(payload.iss).toBe('MY_KEY');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('signature verifies against the secret via Web Crypto', async () => {
    const signer = new ZoomJwtSigner('K', 'topsecret');
    const token = await signer.getToken();
    const [h, p, s] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('topsecret'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(s).toBe(expected);
  });

  it('caches the token across calls', async () => {
    const signer = new ZoomJwtSigner('K', 'S');
    const a = await signer.getToken();
    const b = await signer.getToken();
    expect(a).toBe(b);
  });
});

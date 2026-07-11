/**
 * Client-side HS256 JWT signer for Zoom AI Services (Build Platform).
 * Payload: { iss: apiKey, iat, exp }, signed with apiSecret using Web Crypto.
 * Mirrors the client-side-signing model used by VolcengineSTClient's signer.
 */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlString(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

const TOKEN_TTL_SEC = 7200; // 2h
const REFRESH_MARGIN_SEC = 300; // re-sign within 5 min of expiry

export class ZoomJwtSigner {
  private apiKey: string;
  private apiSecret: string;
  private cachedToken: string | null = null;
  private cachedExp = 0;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedExp - now > REFRESH_MARGIN_SEC) {
      return this.cachedToken;
    }
    const iat = now - 30;
    const exp = iat + TOKEN_TTL_SEC;
    const header = base64urlString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64urlString(JSON.stringify({ iss: this.apiKey, iat, exp }));
    const signingInput = `${header}.${payload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
    const token = `${signingInput}.${base64url(new Uint8Array(sig))}`;

    this.cachedToken = token;
    this.cachedExp = exp;
    return token;
  }
}

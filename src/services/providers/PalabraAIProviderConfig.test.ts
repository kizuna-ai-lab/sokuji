import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));
vi.mock('livekit-client', () => ({
  setLogLevel: vi.fn(),
  Room: class {}, RoomEvent: {}, TrackPublication: class {},
  RemoteParticipant: class {}, RemoteTrack: class {},
  RemoteAudioTrack: class {}, LocalAudioTrack: class {},
}));

const { PalabraAIProviderConfig, defaultPalabraAISettings } = await import('./PalabraAIProviderConfig');
const { PalabraAIClient } = await import('../clients/PalabraAIClient');

const descriptor = new PalabraAIProviderConfig();
const appSlice = { ...defaultPalabraAISettings, authMode: 'app' as const, clientId: 'id-1', clientSecret: 'sec-1' };
const platformSlice = { ...defaultPalabraAISettings, authMode: 'platform' as const, apiKey: 'pk-1' };

afterEach(() => vi.restoreAllMocks());

describe('extractCredentials', () => {
  it('maps platform mode to primary-only credentials (no secret key)', async () => {
    const creds = await descriptor.extractCredentials(platformSlice, {});
    expect(creds).toEqual({ ok: true, primary: 'pk-1' });
    expect('secret' in creds).toBe(false);
  });

  it('rejects platform mode without an API key', async () => {
    const creds = await descriptor.extractCredentials({ ...platformSlice, apiKey: '' }, {});
    expect(creds.ok).toBe(false);
  });

  it('maps app mode to primary+secret', async () => {
    expect(await descriptor.extractCredentials(appSlice, {}))
      .toEqual({ ok: true, primary: 'id-1', secret: 'sec-1' });
  });

  it('rejects app mode with a missing half of the pair', async () => {
    expect((await descriptor.extractCredentials({ ...appSlice, clientSecret: '' }, {})).ok).toBe(false);
    expect((await descriptor.extractCredentials({ ...appSlice, clientId: '' }, {})).ok).toBe(false);
  });

  it('app mode ignores a stale apiKey value; platform mode ignores stale clientId/clientSecret', async () => {
    expect(await descriptor.extractCredentials({ ...appSlice, apiKey: 'stale' }, {}))
      .toEqual({ ok: true, primary: 'id-1', secret: 'sec-1' });
    expect(await descriptor.extractCredentials({ ...platformSlice, clientId: 'stale', clientSecret: 'stale' }, {}))
      .toEqual({ ok: true, primary: 'pk-1' });
  });
});

describe('peekPrimaryCredential', () => {
  it('returns the active mode credential', () => {
    expect(descriptor.peekPrimaryCredential(appSlice)).toBe('id-1');
    expect(descriptor.peekPrimaryCredential(platformSlice)).toBe('pk-1');
  });
});

describe('createClient', () => {
  it('builds an app-credential client when secret is present', () => {
    const client = descriptor.createClient({ ok: true, primary: 'id-1', secret: 'sec-1' }, { transport: 'websocket' } as any);
    expect((client as any).credentials).toEqual({ kind: 'clientCredentials', clientId: 'id-1', clientSecret: 'sec-1' });
  });

  it('builds a platform-key client when secret is absent', () => {
    const client = descriptor.createClient({ ok: true, primary: 'pk-1' }, { transport: 'websocket' } as any);
    expect((client as any).credentials).toEqual({ kind: 'apiKey', apiKey: 'pk-1' });
  });
});

describe('validateAndFetchModels', () => {
  it('validates a platform key (no secret) instead of demanding a client secret', async () => {
    const spy = vi.spyOn(PalabraAIClient, 'validateApiKey').mockResolvedValue({
      valid: true, message: 'ok', validating: false,
    });
    const result = await descriptor.validateAndFetchModels({ ok: true, primary: 'pk-1' });
    expect(spy).toHaveBeenCalledWith({ kind: 'apiKey', apiKey: 'pk-1' });
    expect(result.validation.valid).toBe(true);
    expect(result.models).toHaveLength(1);
  });

  it('validates app credentials as before', async () => {
    const spy = vi.spyOn(PalabraAIClient, 'validateApiKey').mockResolvedValue({
      valid: true, message: 'ok', validating: false,
    });
    await descriptor.validateAndFetchModels({ ok: true, primary: 'id-1', secret: 'sec-1' });
    expect(spy).toHaveBeenCalledWith({ kind: 'clientCredentials', clientId: 'id-1', clientSecret: 'sec-1' });
  });
});

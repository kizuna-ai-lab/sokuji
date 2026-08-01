import { afterEach, describe, expect, it, vi } from 'vitest';
import { EphemeralTokenService } from './EphemeralTokenService';

describe('EphemeralTokenService Realtime GA client secrets', () => {
  afterEach(() => {
    EphemeralTokenService.clearCache();
    vi.unstubAllGlobals();
  });

  it('mints an Ash client secret with the current GA endpoint and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: 'ek_test_ash',
        expires_at: Math.floor(Date.now() / 1000) + 60
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await EphemeralTokenService.getToken(
      'sk-test',
      'gpt-realtime-2.1',
      'ash'
    );

    expect(token).toBe('ek_test_ash');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(JSON.parse(options.body)).toEqual({
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        audio: {
          output: { voice: 'ash' }
        }
      }
    });
  });

  it('continues to accept the legacy nested client-secret response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        client_secret: {
          value: 'ek_legacy',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      })
    }));

    await expect(EphemeralTokenService.getToken(
      'sk-test',
      'gpt-realtime',
      'ash'
    )).resolves.toBe('ek_legacy');
  });
});

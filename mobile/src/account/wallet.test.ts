import { describe, it, expect } from 'vitest';
import { fetchWallet, fetchUsagePerHour, fetchFallbackUsdPerHour } from './wallet';

const respond = (status: number, body: unknown) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe('fetchWallet', () => {
  it('reads the balance, the frozen flag, the 30-day spend and the expiry notice', async () => {
    const { fetch, calls } = respond(200, {
      balanceMicroUsd: 2500000, frozen: false, last30DaysUsageMicroUsd: 1200000,
      expiringSoon: { microUsd: 500000, usd: '0.50', expiresAt: 1800000000000 },
    });
    expect(await fetchWallet({ token: 'tok', fetch })).toEqual({
      balanceUsd: 2.5, frozen: false, last30DaysUsd: 1.2, expiringSoon: { usd: 0.5, expiresAt: 1800000000000 },
    });
    expect(calls[0].url).toBe('https://sokuji.kizuna.ai/api/wallet/status');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('takes balanceUsd when the micro figure is absent, and no notice as null', async () => {
    const { fetch } = respond(200, { balanceUsd: 1.25, frozen: true });
    expect(await fetchWallet({ token: 'tok', fetch })).toEqual({ balanceUsd: 1.25, frozen: true, last30DaysUsd: 0, expiringSoon: null });
  });

  it('reports a lost session as sign_in_required', async () => {
    const { fetch } = respond(401, {});
    await expect(fetchWallet({ token: 'tok', fetch })).rejects.toThrow('sign_in_required');
  });
});

describe('fetchUsagePerHour', () => {
  it('is the 30-day spend per session hour', async () => {
    const { fetch } = respond(200, { windowDays: 30, spendMicroUsd: 3000000, sessionSeconds: 7200 });
    expect(await fetchUsagePerHour({ token: 'tok', fetch })).toBe(1.5);
  });
  it('is null without session time', async () => {
    const { fetch } = respond(200, { windowDays: 30, spendMicroUsd: 0, sessionSeconds: 0 });
    expect(await fetchUsagePerHour({ token: 'tok', fetch })).toBeNull();
  });
});

describe('fetchFallbackUsdPerHour', () => {
  // The calculator's opening preset ("understand others": they speak 60% of
  // the hour, subtitles only, one connection) priced from the published Soniox
  // rates, exactly as the website's cost model does.
  it('prices the understand-others preset from the Soniox rates', async () => {
    const { fetch } = respond(200, {
      providers: [{
        id: 'soniox',
        tokenRatesUsdPerMillion: { sttInputAudio: 2, sttOutputText: 10, ttsInputText: 4, ttsOutputAudio: 21.5 },
        tokenConversions: { sttInputAudioPerConnectedHour: 100000, sttOutputTextPerSpeechHour: 50000, ttsInputTextPerGeneratedHour: 15000, ttsOutputAudioPerGeneratedHour: 30000 },
      }],
    });
    // connection 100000 × 2 / 1e6 = 0.2; text 50000 × 10 / 1e6 = 0.5 × 0.6 = 0.3
    expect(await fetchFallbackUsdPerHour({ fetch })).toBeCloseTo(0.5, 10);
  });
});

describe('fetchWallet with a malformed balance', () => {
  // "0" on this screen means no money left: a balance that cannot be read is an error, not a zero.
  it('rejects instead of showing zero', async () => {
    const { fetch } = respond(200, { balanceUsd: 'abc', frozen: false });
    await expect(fetchWallet({ token: 'tok', fetch })).rejects.toThrow('wallet-status malformed');
  });
});

describe('fetchWallet with other malformed amounts', () => {
  it('rejects a non-numeric 30-day spend', async () => {
    const { fetch } = respond(200, { balanceMicroUsd: 1000000, last30DaysUsageMicroUsd: 'x' });
    await expect(fetchWallet({ token: 'tok', fetch })).rejects.toThrow('wallet-status malformed');
  });

  it('rejects a non-numeric expiring amount', async () => {
    const { fetch } = respond(200, { balanceMicroUsd: 1000000, expiringSoon: { microUsd: null, expiresAt: 1 } });
    await expect(fetchWallet({ token: 'tok', fetch })).rejects.toThrow('wallet-status malformed');
  });
});

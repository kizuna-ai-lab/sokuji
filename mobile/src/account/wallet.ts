import { getJson } from './http';

export interface Wallet {
  balanceUsd: number;
  frozen: boolean;
  last30DaysUsd: number;
  /** Part of the balance that runs out soon, or null when nothing does. */
  expiringSoon: { usd: number; expiresAt: number } | null;
}

// The balance panel's own endpoint.
export async function fetchWallet(o: { token: string; fetch?: typeof fetch }): Promise<Wallet> {
  const body = await getJson<{
    balanceMicroUsd?: number;
    balanceUsd?: number | string;
    frozen?: boolean;
    last30DaysUsageMicroUsd?: number;
    expiringSoon?: { microUsd: number; expiresAt: number } | null;
  }>('/api/wallet/status', { token: o.token, fetch: o.fetch, label: 'wallet-status' });
  const balanceUsd = typeof body.balanceMicroUsd === 'number' ? body.balanceMicroUsd / 1e6 : Number(body.balanceUsd ?? 0);
  return {
    balanceUsd,
    frozen: body.frozen ?? false,
    last30DaysUsd: (body.last30DaysUsageMicroUsd ?? 0) / 1e6,
    expiringSoon: body.expiringSoon ? { usd: body.expiringSoon.microUsd / 1e6, expiresAt: body.expiringSoon.expiresAt } : null,
  };
}

/** The account's own rate: 30-day spend per session hour, or null with no session time or nothing spent. */
export async function fetchUsagePerHour(o: { token: string; fetch?: typeof fetch }): Promise<number | null> {
  const body = await getJson<{ spendMicroUsd: number; sessionSeconds: number }>('/api/wallet/usage-summary', {
    token: o.token,
    fetch: o.fetch,
    label: 'usage-summary',
  });
  if (!(body.sessionSeconds > 0) || !(body.spendMicroUsd > 0)) return null;
  return body.spendMicroUsd / 1e6 / (body.sessionSeconds / 3600);
}

// The calculator's opening preset, "understand others": they speak 60% of the
// hour, subtitles only, one connection — priced from the published Soniox
// rates exactly as the website's cost model prices it, so the two never show
// different numbers for the same case.
const PRESET = { spokenShare: 0.6, connections: 1 };

export async function fetchFallbackUsdPerHour(o: { fetch?: typeof fetch }): Promise<number> {
  const body = await getJson<{
    providers: Array<{
      id: string;
      tokenRatesUsdPerMillion?: { sttInputAudio: number; sttOutputText: number };
      tokenConversions?: { sttInputAudioPerConnectedHour: number; sttOutputTextPerSpeechHour: number };
    }>;
  }>('/api/pricing', { fetch: o.fetch, label: 'pricing' });
  const soniox = body.providers.find((p) => p.id === 'soniox');
  const r = soniox?.tokenRatesUsdPerMillion;
  const c = soniox?.tokenConversions;
  if (!r || !c) throw new Error('pricing unavailable');
  const connection = (c.sttInputAudioPerConnectedHour * r.sttInputAudio) / 1e6;
  const text = (c.sttOutputTextPerSpeechHour * r.sttOutputText) / 1e6;
  return connection * PRESET.connections + text * PRESET.spokenShare;
}

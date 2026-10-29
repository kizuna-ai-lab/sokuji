import { getJson } from './http';

export interface LedgerGroup {
  id: string;
  /** 'session' or the website's other kinds (topup, grant, adjustment, refund, expired, voice_preview). */
  kind: 'session' | string;
  occurredAt: number;
  /** A session's longest stream, as the website states it; null for anything that is not a session. */
  durationSeconds: number | null;
  textOnly: boolean;
  /** Signed: usage negative, credits positive. */
  amountUsd: number;
}

export interface LedgerCursor {
  at: number;
  groupId: string;
}

// The website's records card's own endpoint, one page at a time, newest first.
export async function fetchLedger(o: {
  token: string;
  limit?: number;
  before?: LedgerCursor;
  fetch?: typeof fetch;
}): Promise<{ groups: LedgerGroup[]; next: LedgerCursor | null }> {
  const params = new URLSearchParams({ limit: String(o.limit ?? 20) });
  if (o.before) {
    params.set('beforeAt', String(o.before.at));
    params.set('beforeGroup', o.before.groupId);
  }
  const body = await getJson<{
    groups: Array<{
      groupId: string;
      kind: string;
      occurredAt: number;
      textOnly?: true;
      entries: Array<{ amountMicroUsd: number; billableSeconds: number | null }>;
    }>;
    nextCursor: LedgerCursor | null;
  }>(`/api/wallet/ledger?${params.toString()}`, { token: o.token, fetch: o.fetch, label: 'ledger' });
  return {
    groups: body.groups.map((g) => {
      const seconds = g.entries.map((e) => e.billableSeconds).filter((s): s is number => typeof s === 'number');
      return {
        id: g.groupId,
        kind: g.kind,
        occurredAt: g.occurredAt,
        durationSeconds: g.kind === 'session' && seconds.length ? Math.max(...seconds) : null,
        textOnly: g.textOnly === true,
        // One entry without a readable amount must not turn the group's total into nothing.
        amountUsd: g.entries.reduce((sum, e) => sum + (typeof e.amountMicroUsd === 'number' && Number.isFinite(e.amountMicroUsd) ? e.amountMicroUsd : 0), 0) / 1e6,
      };
    }),
    next: body.nextCursor ?? null,
  };
}

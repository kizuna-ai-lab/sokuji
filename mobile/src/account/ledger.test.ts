import { describe, it, expect } from 'vitest';
import { fetchLedger } from './ledger';

const respond = (status: number, body: unknown) => {
  const calls: Array<{ url: string }> = [];
  const fetch = (async (url: string) => {
    calls.push({ url });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe('fetchLedger', () => {
  it('maps a session group and a credit group, and passes the cursor through', async () => {
    const { fetch, calls } = respond(200, {
      groups: [
        {
          groupId: 'g1', kind: 'session', occurredAt: 1700000000000, textOnly: true,
          entries: [
            { id: 'e1', kind: 'stt', amountMicroUsd: -600000, billableSeconds: 1800, at: 1700000000000 },
            { id: 'e2', kind: 'mt', amountMicroUsd: -350000, billableSeconds: 1795, at: 1700000000000 },
          ],
        },
        { groupId: 'g2', kind: 'topup', occurredAt: 1690000000000, entries: [{ id: 'e3', kind: 'topup', amountMicroUsd: 10000000, billableSeconds: null, at: 1690000000000 }] },
      ],
      nextCursor: { at: 1690000000000, groupId: 'g2' },
    });
    const page = await fetchLedger({ token: 'tok', fetch, limit: 20, before: { at: 1700000001000, groupId: 'g0' } });
    expect(page.groups).toEqual([
      { id: 'g1', kind: 'session', occurredAt: 1700000000000, durationSeconds: 1800, textOnly: true, amountUsd: -0.95 },
      { id: 'g2', kind: 'topup', occurredAt: 1690000000000, durationSeconds: null, textOnly: false, amountUsd: 10 },
    ]);
    expect(page.next).toEqual({ at: 1690000000000, groupId: 'g2' });
    expect(calls[0].url).toBe('https://sokuji.kizuna.ai/api/wallet/ledger?limit=20&beforeAt=1700000001000&beforeGroup=g0');
  });

  it('reports a lost session as sign_in_required', async () => {
    const { fetch } = respond(401, {});
    await expect(fetchLedger({ token: 'tok', fetch })).rejects.toThrow('sign_in_required');
  });
});

describe('fetchLedger with a bad entry', () => {
  it('ignores an entry without a numeric amount instead of poisoning the group', async () => {
    const { fetch } = respond(200, {
      groups: [{ groupId: 'g1', kind: 'session', occurredAt: 1, textOnly: false, entries: [
        { id: 'e1', kind: 'stt', amountMicroUsd: -600000, billableSeconds: 10, at: 1 },
        { id: 'e2', kind: 'mt', amountMicroUsd: 'oops', billableSeconds: 10, at: 1 },
      ] }],
      nextCursor: null,
    });
    const page = await fetchLedger({ token: 'tok', fetch });
    expect(page.groups[0].amountUsd).toBe(-0.6);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { createLiveCheck } from './check';
import { LIVE_DEFAULTS } from './settings';

const K = { apiKey: 'sk-proj-liveCheck0123456789' };
const ctx: CheckContext = { pair: { source: 'en', target: 'zh-CN' }, legs: ['speaker'] };
const listing = (...models: Array<[string, number]>) => new Response(JSON.stringify({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created })) }), { status: 200 });
const check = (fetch: typeof globalThis.fetch) => createLiveCheck({ fetch, clock: createVirtualClock(0) })(K, LIVE_DEFAULTS, ctx);

describe("OpenAI Live's check (ruling 9; choice 4)", () => {
  it('is ready with gpt-live-1 and the dated snapshots, newest first — never the transcription model — asked with its own key', async () => {
    const fetch = vi.fn(async () => listing(['gpt-live-1', 1], ['gpt-live-transcribe', 3], ['gpt-live-2026-10-01', 2], ['gpt-realtime', 4]));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'gpt-live-2026-10-01' }, { id: 'gpt-live-1' }] });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ headers: { Authorization: `Bearer ${K.apiKey}` } });
  });

  it("answers a key that lists no Live model with the old validation's words (`no_realtime_model`)", async () => {
    await expect(check(vi.fn(async () => listing(['gpt-live-transcribe', 1], ['gpt-realtime', 2])))).resolves.toEqual({ ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-live model.' });
  });
});

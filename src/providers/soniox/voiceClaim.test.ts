import { describe, it, expect, vi } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import type { RunShape } from '../../lib/session/types';
import type { ManagedVoicesClient } from './managedVoicesClient';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { createKizunaVoiceClaim } from './voiceClaim';
import type { prepareManagedVoice } from './voicePrep';

const shapeFor = (legs: LegName[], textOnly = false): RunShape => ({
  provider: {} as RunShape['provider'], settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
  turnMode: 'auto', textOnly, participantSpeech: false, keepReplayAudio: true,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: true, userId: 'u1', getToken: vi.fn(async () => 'tok') },
});
const live = () => new AbortController().signal;

function claim(result: Awaited<ReturnType<typeof prepareManagedVoice>> = { ok: true, voiceId: 'clone-1' }) {
  const client = {} as ManagedVoicesClient;
  const deps = {
    prepare: vi.fn(async (_d: Parameters<typeof prepareManagedVoice>[0]) => result),
    clientFor: vi.fn(() => client),
    loadClip: vi.fn(async () => null),
  };
  return { deps, client, run: createKizunaVoiceClaim(deps) };
}
const s = (patch: Partial<SonioxSettings>): SonioxSettings => ({ ...SONIOX_DEFAULTS, ...patch });

describe('createKizunaVoiceClaim', () => {
  it('claims nothing without a speaking speaker', async () => {
    const { deps, run } = claim();
    expect(await run(shapeFor(['participant']), s({ voice: 'clone-1' }), live())).toEqual({});
    expect(await run(shapeFor(['speaker'], true), s({ voice: 'clone-1' }), live())).toEqual({});
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it('claims nothing for a built-in or empty voice', async () => {
    const { deps, run } = claim();
    expect(await run(shapeFor(['speaker']), s({ voice: 'Adrian' }), live())).toEqual({});
    expect(await run(shapeFor(['speaker']), s({ voice: '' }), live())).toEqual({});
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("claims the region's own voice, in that region, for this account, with the run's signal", async () => {
    const { deps, client, run } = claim();
    const shape = shapeFor(['speaker']);
    const signal = live();
    await run(shape, s({ region: 'eu', voice: 'clone-us', voiceEu: 'clone-eu' }), signal);
    expect(deps.clientFor).toHaveBeenCalledWith(expect.any(Function), 'eu');
    const [getTokenArg] = deps.clientFor.mock.calls[0] as unknown as [() => Promise<string | null>, string];
    await getTokenArg();
    expect(shape.auth.getToken).toHaveBeenCalled();
    expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({ client, signal }));
    const arg = deps.prepare.mock.calls[0][0];
    await arg.loadClip();
    expect(deps.loadClip).toHaveBeenCalledWith('u1');
  });

  it("uses and writes back a rebuilt clone, under the region's field", async () => {
    const { run } = claim({ ok: true, voiceId: 'clone-2' });
    const result = await run(shapeFor(['speaker']), s({ region: 'eu', voiceEu: 'clone-eu' }), live());
    expect(result).toEqual({ override: { voiceEu: 'clone-2' }, persist: { voiceEu: 'clone-2' } });
  });

  it('changes nothing for a warm clone', async () => {
    const { run } = claim({ ok: true, voiceId: 'clone-eu' });
    const result = await run(shapeFor(['speaker']), s({ region: 'eu', voiceEu: 'clone-eu' }), live());
    expect(result).toEqual({});
  });

  it("falls back to the built-in voice for this run, with the reason's code", async () => {
    const cases: Array<[string, string]> = [
      ['clip_required', 'voice_clip_missing'],
      ['pool_exhausted', 'voice_pool_busy'],
      ['voice_failed', 'voice_build_failed'],
      ['unavailable', 'voice_unavailable'],
    ];
    for (const [reason, code] of cases) {
      const { run } = claim({ ok: false, reason: reason as never });
      const result = await run(shapeFor(['speaker']), s({ region: 'eu', voiceEu: 'clone-eu' }), live());
      expect(result).toEqual({
        override: { voiceEu: 'Adrian' },
        notice: { code, message: expect.any(String) },
      });
      expect(result).not.toHaveProperty('persist');
    }
  });

  it('applies nothing when the start was cancelled during the claim', async () => {
    const controller = new AbortController();
    const client = {} as ManagedVoicesClient;
    const deps = {
      prepare: vi.fn(async () => { controller.abort(); return { ok: true, voiceId: 'clone-2' } as const; }),
      clientFor: vi.fn(() => client),
      loadClip: vi.fn(async () => null),
    };
    const run = createKizunaVoiceClaim(deps);
    const result = await run(shapeFor(['speaker']), s({ voiceEu: 'clone-eu', region: 'eu' }), controller.signal);
    expect(result).toEqual({});
  });

  it("the claim's own routine by default", () => {
    expect(typeof createKizunaVoiceClaim()).toBe('function');
  });
});

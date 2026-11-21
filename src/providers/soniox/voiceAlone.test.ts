/**
 * Kizuna AI's Soniox voice alone, under Soniox with an own key for transcription and translation: the floor, the
 * voice claim and the lease read "this plan asks this provider for speech and another for the text". The request is
 * the voice-only one, the floor prices the speech streams asked for, and the cloned voice is claimed as for any
 * session in which this provider speaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { CAPS } from '../../lib/lineup/catalog';
import { compose } from '../../lib/plan/compose';
import { servesSpeech, servesTranscription } from '../../lib/plan/read';
import { isRefusal, type RunPlan } from '../../lib/plan/types';
import { balanceRefusal, BALANCE_BELOW_FLOOR } from '../../lib/session/shape';
import type { LeaseContext, RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { kizunaSonioxProvider } from './kizuna';
import { createKizunaLease } from './lease';
import { asksSpeech, asksVoiceAlone } from './leaseRequest';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { createKizunaVoiceClaim } from './voiceClaim';
import { VOICE_LEASE_KEY, voiceLeaseMemory } from './voiceLeaseMemory';

const LINE_UP = { transcription: 'soniox', translation: 'soniox', speech: 'kizunaai_soniox' };
const input = { providers: [sonioxProvider, kizunaSonioxProvider], settings: () => SONIOX_DEFAULTS };

const plan = ((): RunPlan => {
  const composed = compose(LINE_UP, input);
  if (isRefusal(composed)) throw new Error(`expected a plan, got ${composed.refused}`);
  return composed;
})();

const shapeOn = (legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean } = {}): RunShape => ({
  plan,
  accounts: { soniox: { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k-own' } }, kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {} } },
  lineUp: LINE_UP,
  lineUpStored: true,
  pair: { source: 'ja', target: 'en' }, legs, turnMode: 'auto',
  textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false,
  keepReplayAudio: true,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: true, userId: 'u1', getToken: vi.fn(async () => 'tok') },
});

describe('the plan', () => {
  it("composes under the app's own catalog, which offers the voice alone, and is refused under one that does not", () => {
    expect(compose(LINE_UP, { ...input, catalog: CAPS.map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: false } : c)) }))
      .toEqual({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' });
    expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([['soniox', 'stt', ['transcription', 'translation']], ['kizunaai_soniox', 'tts', ['speech']]]);
  });

  it("asks Kizuna AI's Soniox for speech and Soniox for the text", () => {
    expect(servesSpeech(plan, kizunaSonioxProvider)).toBe(true);
    expect(servesTranscription(plan, kizunaSonioxProvider)).toBe(false);
    expect(servesTranscription(plan, sonioxProvider)).toBe(true);
    expect(asksSpeech({ plan })).toBe(true);
    expect(asksVoiceAlone({ plan })).toBe(true);
  });
});

describe('the start gate', () => {
  const account = (balanceMicroUsd: number) => ({ status: 'known' as const, balanceMicroUsd, frozen: false });
  const floor = kizunaSonioxProvider.session!.minimumBalance!;

  it("the definition's floor prices the speech streams of the legs that speak, and no transcription stream", () => {
    expect(floor(shapeOn(['speaker']), SONIOX_DEFAULTS)).toBe(4_167);
    expect(floor(shapeOn(['speaker', 'participant']), SONIOX_DEFAULTS)).toBe(4_167);
    expect(floor(shapeOn(['speaker', 'participant'], { participantSpeech: true }), SONIOX_DEFAULTS)).toBe(8_334);
    expect(floor(shapeOn(['speaker'], { textOnly: true }), SONIOX_DEFAULTS)).toBe(0);
  });

  it('holds a start to that floor: a balance that would not start a whole session starts the voice alone', () => {
    // Between one speech stream's floor and a whole speaking session's.
    expect(balanceRefusal({ ...shapeOn(['speaker']), account: account(5_000) })).toBeNull();
    expect(balanceRefusal({ ...shapeOn(['speaker']), account: account(4_000) })).toMatchObject({ code: BALANCE_BELOW_FLOOR });
    // No leg speaks: nothing is leased, and no balance is asked.
    expect(balanceRefusal({ ...shapeOn(['speaker'], { textOnly: true }), account: account(0) })).toBeNull();
  });
});

describe('readiness before Start', () => {
  const inputs = { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' }, legs: ['speaker' as const], stages: ['speech' as const] };

  it("signed out, Kizuna AI's Soniox is not ready for the speech stage alone, and the reason names it: its account row is the one to open", async () => {
    const readiness = await useProviderStore.getState().refreshReadiness(kizunaSonioxProvider, { signedIn: false, getToken: async () => null }, inputs);
    expect(readiness).toMatchObject({ state: 'not-ready', code: 'sign_in_required', params: { provider: 'kizunaai_soniox' } });
  });

  it('signed in, it is ready: the wallet is the start gate\'s to judge', async () => {
    const readiness = await useProviderStore.getState().refreshReadiness(kizunaSonioxProvider, { signedIn: true, userId: 'u1', getToken: async () => 'tok' }, inputs);
    expect(readiness.state).toBe('ready');
  });
});

describe('the voice claim', () => {
  const cloned: SonioxSettings = { ...SONIOX_DEFAULTS, region: 'us', voice: 'a-cloned-voice-id' };
  const claim = () => {
    const prepare = vi.fn(async () => ({ ok: true as const, voiceId: 'a-cloned-voice-id' }));
    return { prepare, run: createKizunaVoiceClaim({ prepare, clientFor: vi.fn(() => ({}) as never), loadClip: vi.fn(async () => null), hasDeviceClip: vi.fn(async () => false) }) };
  };

  it('claims the cloned voice: this provider speaks, whoever transcribes', async () => {
    const { prepare, run } = claim();
    await run(shapeOn(['speaker']), cloned, new AbortController().signal);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('claims none when the speaker is not read aloud', async () => {
    const { prepare, run } = claim();
    expect(await run(shapeOn(['speaker'], { textOnly: true }), cloned, new AbortController().signal)).toEqual({});
    expect(prepare).not.toHaveBeenCalled();
  });

  it("is the definition's `prepare`", () => {
    expect(kizunaSonioxProvider.session!.prepare).toBeTypeOf('function');
  });
});

describe('the lease', () => {
  /** The body of the session-key request `acquire` sends for a shape; undefined when it sends none. */
  async function bodySent(shape: RunShape): Promise<unknown> {
    const sent: unknown[] = [];
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Promise<Response>(() => {});
    });
    const controller = new AbortController();
    const ctx: LeaseContext = { signal: controller.signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() };
    const pending = createKizunaLease({ participantSpeech: true, fetch: fetchStub as unknown as typeof fetch, apiUrl: () => 'https://api.test' })(shape, { ...SONIOX_DEFAULTS, region: 'jp' }, ctx);
    pending.catch(() => {});
    await flush();
    controller.abort(new Error('done'));
    return sent[0];
  }

  it('asks the service for the voice alone, for the legs that speak', async () => {
    expect(await bodySent(shapeOn(['speaker']))).toEqual({ mode: 'voice_only', legs: 'speaker', region: 'jp' });
    expect(await bodySent(shapeOn(['speaker', 'participant'], { participantSpeech: true }))).toEqual({ mode: 'voice_only', legs: 'both', region: 'jp' });
    expect(await bodySent(shapeOn(['speaker', 'participant'], { textOnly: true, participantSpeech: true }))).toEqual({ mode: 'voice_only', legs: 'participant', region: 'jp' });
  });

  it('asks the service for nothing when no leg speaks', async () => {
    expect(await bodySent(shapeOn(['speaker'], { textOnly: true }))).toBeUndefined();
  });
});

describe("the definition's own lease", () => {
  it("remembers a voice-only lease in the app's storage while it is held, and forgets it once session-end is answered", async () => {
    const fetchStub = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/soniox/session-key')
      ? new Response(JSON.stringify({
          leaseId: 'lease-9', clientReferenceId: 'ref-spk_tts', region: 'us', maxSessionDurationSeconds: 600,
          streams: [{ role: 'spk_tts', apiKey: 'k-spk_tts', clientReferenceId: 'ref-spk_tts' }],
        }), { status: 200 })
      : new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchStub);
    try {
      const ctx: LeaseContext = { signal: new AbortController().signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() };
      const resources = await kizunaSonioxProvider.session!.acquire!(shapeOn(['speaker']), SONIOX_DEFAULTS, ctx);
      await flush();
      const remembered = await voiceLeaseMemory.read();
      expect(remembered).toMatchObject({ leaseId: 'lease-9' });
      expect(fetchStub.mock.calls[0][0]).toBe(`${remembered!.apiUrl}/soniox/session-key`);
      // The id and the service's address: no key, no token.
      expect(JSON.parse(localStorage.getItem(VOICE_LEASE_KEY)!)).toEqual(remembered);
      expect(localStorage.getItem(VOICE_LEASE_KEY)).not.toMatch(/k-spk_tts|tok/);
      await resources.release();
      await flush();
      expect(await voiceLeaseMemory.read()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      localStorage.removeItem(VOICE_LEASE_KEY);
    }
  });
});

/**
 * Kizuna AI's Soniox voice alone, under Soniox with an own key for transcription and translation: the floor, the
 * voice claim and the lease read "this plan asks this provider for speech and another for the text". The request is
 * the voice-only one, the floor prices the speech streams asked for, and the cloned voice is claimed as for any
 * session in which this provider speaks. The app's catalog does not offer this line-up yet, so the plan is composed
 * under a catalog whose option does.
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
import { kizunaSonioxProvider } from './kizuna';
import { createKizunaLease } from './lease';
import { asksSpeech, asksVoiceAlone } from './leaseRequest';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { createKizunaVoiceClaim } from './voiceClaim';

const LINE_UP = { transcription: 'soniox', translation: 'soniox', speech: 'kizunaai_soniox' };
/** The app's catalog, with Kizuna AI's Soniox voice offered alone. */
const OFFERED = CAPS.map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: true } : c));
const input = { providers: [sonioxProvider, kizunaSonioxProvider], settings: () => SONIOX_DEFAULTS };

const plan = ((): RunPlan => {
  const composed = compose(LINE_UP, { ...input, catalog: OFFERED });
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
  it("is refused by the app's own catalog, and composes once the option offers the voice alone", () => {
    expect(compose(LINE_UP, input)).toEqual({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' });
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

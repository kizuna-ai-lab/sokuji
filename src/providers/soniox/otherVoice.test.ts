/**
 * Kizuna AI's Soniox with another provider's voice (Edge here): the lease, the floor, the cap and the voice claim
 * read "this plan asks this provider for speech", not "the run speaks". The session is today's text-only one: no
 * speech role is asked for, the floor and the cap are the text-only ones, and no voice is claimed. With Kizuna AI's
 * Soniox on all three stages nothing changes.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { compose } from '../../lib/plan/compose';
import { servesSpeech } from '../../lib/plan/read';
import { stubProvider } from '../../lib/plan/testing';
import { isRefusal, type RunPlan } from '../../lib/plan/types';
import { balanceRefusal, BALANCE_BELOW_FLOOR } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import type { LeaseContext } from '../../lib/run/types';
import { edgeProvider } from '../edge/provider';
import { kizunaSonioxProvider } from './kizuna';
import { kizunaSonioxMinimumBalance, sonioxSessionCapSeconds, SONIOX_MAX_TRANSCRIPTION_SESSION_S } from './kizunaBudget';
import { createKizunaLease } from './lease';
import { isSttRole, leaseRequest, requestBody, requestedRoles } from './leaseRequest';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { createKizunaVoiceClaim } from './voiceClaim';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';

registerReleasedCatalog();

const providers = [kizunaSonioxProvider, edgeProvider];
const planOf = (speech: string): RunPlan => {
  const plan = compose({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech }, { providers, settings: (id) => (id === 'kizunaai_soniox' ? SONIOX_DEFAULTS : edgeProvider.settings.defaults) });
  if (isRefusal(plan)) throw new Error(`expected a plan, got ${plan.refused}`);
  return plan;
};
/** Kizuna AI's Soniox for transcription and translation, Edge for speech. */
const withEdge = planOf('edge');
/** Kizuna AI's Soniox on all three stages. */
const alone = planOf('kizunaai_soniox');

const shapeOn = (plan: RunPlan, legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean; faceToFace?: boolean } = {}): RunShape => ({
  plan,
  accounts: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {} }, edge: { settings: edgeProvider.settings.defaults, credentials: {} } },
  lineUp: { transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox', speech: plan === withEdge ? 'edge' : 'kizunaai_soniox' },
  lineUpStored: true,
  pair: { source: 'ja', target: 'en' }, legs, turnMode: 'auto',
  textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false, ...(o.faceToFace ? { faceToFace: true } : {}),
  keepReplayAudio: true,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: true, userId: 'u1', getToken: vi.fn(async () => 'tok') },
});

/** Today's text-only session on Kizuna AI's Soniox alone, for the same legs: nobody is read aloud. */
const textOnlyToday = (legs: LegName[], faceToFace = false) => shapeOn(alone, legs, { textOnly: true, participantSpeech: false, faceToFace });

const SETTINGS: Array<[string, Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>]> = [
  ['shared Both', { region: 'us', bothModeSharedSession: true }],
  ['split Both', { region: 'eu', bothModeSharedSession: false }],
];
const LEGS: LegName[][] = [['speaker'], ['participant'], ['speaker', 'participant']];

describe('the plans', () => {
  it("with Edge, the plan asks Kizuna AI's Soniox for no speech; alone, it does", () => {
    expect(withEdge.units.map((u) => [u.provider.id, u.stages])).toEqual([['kizunaai_soniox', ['transcription', 'translation']], ['edge', ['speech']]]);
    expect(servesSpeech(withEdge, kizunaSonioxProvider)).toBe(false);
    expect(servesSpeech(withEdge, edgeProvider)).toBe(true);
    expect(servesSpeech(alone, kizunaSonioxProvider)).toBe(true);
    expect(servesSpeech(alone, edgeProvider)).toBe(false);
  });
});

describe.each(SETTINGS)("Kizuna AI's Soniox with Edge's voice, %s", (_name, s) => {
  describe.each([[true], [false]])('the participant-speech flag %s', (flag) => {
    it.each(LEGS)('legs %s: the request, its body and its roles are those of a text-only session today, though the run speaks', (...legs) => {
      // The run speaks on every leg it can: the speaker's translation is read, and the other side's too.
      const speaking = shapeOn(withEdge, legs, { textOnly: false, participantSpeech: true });
      const request = leaseRequest(speaking, s, flag);
      const today = leaseRequest(textOnlyToday(legs), s, flag);
      expect(request).toEqual(today);
      expect(request.textOnly).toBe(true);
      expect(request.participantSpeaks ?? false).toBe(false);
      expect(JSON.stringify(requestBody(request))).toBe(JSON.stringify(requestBody(today)));
      const roles = requestedRoles(request);
      expect(roles).toEqual(requestedRoles(today));
      expect(roles.every(isSttRole)).toBe(true);
    });

    it.each(LEGS)('legs %s: the floor is the text-only one', (...legs) => {
      const speaking = shapeOn(withEdge, legs, { textOnly: false, participantSpeech: true });
      expect(kizunaSonioxMinimumBalance(speaking, s, flag)).toBe(kizunaSonioxMinimumBalance(textOnlyToday(legs), s, flag));
    });

    it.each(LEGS)('legs %s: the cap is the 18 000 s of a session with no synthesis', (...legs) => {
      const roles = requestedRoles(leaseRequest(shapeOn(withEdge, legs, { textOnly: false, participantSpeech: true }), s, flag));
      expect(sonioxSessionCapSeconds(roles.some((role) => !isSttRole(role)))).toBe(SONIOX_MAX_TRANSCRIPTION_SESSION_S);
      expect(SONIOX_MAX_TRANSCRIPTION_SESSION_S).toBe(18_000);
    });
  });

  it('face-to-face is still one shared stream, with no speech role', () => {
    const request = leaseRequest(shapeOn(withEdge, ['speaker', 'participant'], { participantSpeech: true, faceToFace: true }), s, true);
    expect(request).toEqual(leaseRequest(textOnlyToday(['speaker', 'participant'], true), s, true));
    expect(requestedRoles(request)).toEqual(['mix_stt']);
  });
});

describe("Kizuna AI's Soniox on all three stages: unchanged", () => {
  const s = { region: 'us' as const, bothModeSharedSession: true };
  it('a shape that carries its plan asks for what a shape with no plan asks for', () => {
    for (const legs of LEGS) for (const textOnly of [false, true]) for (const participantSpeech of [false, true]) for (const flag of [false, true]) {
      const bare = { legs, textOnly, participantSpeech };
      const label = JSON.stringify({ ...bare, flag });
      expect(leaseRequest(shapeOn(alone, legs, bare), s, flag), label).toEqual(leaseRequest(bare, s, flag));
      expect(kizunaSonioxMinimumBalance(shapeOn(alone, legs, bare), s, flag), label).toBe(kizunaSonioxMinimumBalance(bare, s, flag));
    }
  });
  it('a speaking speaker still asks for its speech role, its floor and the one-hour cap', () => {
    const request = leaseRequest(shapeOn(alone, ['speaker']), s, true);
    expect(requestedRoles(request)).toEqual(['spk_stt', 'spk_tts']);
    expect(kizunaSonioxMinimumBalance(shapeOn(alone, ['speaker']), s, true)).toBe(12_500);
    expect(sonioxSessionCapSeconds(true)).toBe(3_600);
  });
});

describe('the start gate', () => {
  const account = (balanceMicroUsd: number) => ({ status: 'known' as const, balanceMicroUsd, frozen: false });
  // Between the text-only floor (one STT stream) and the speaking one (an STT and a TTS stream).
  const between = 10_000;

  it("does not hold a start with Edge's voice to the floor of speech Kizuna AI does not provide", () => {
    expect(balanceRefusal({ ...shapeOn(withEdge, ['speaker']), account: account(between) })).toBeNull();
    expect(balanceRefusal({ ...shapeOn(alone, ['speaker']), account: account(between) })).toMatchObject({ code: BALANCE_BELOW_FLOOR });
    // Below the text-only floor both are refused.
    expect(balanceRefusal({ ...shapeOn(withEdge, ['speaker']), account: account(8_000) })).toMatchObject({ code: BALANCE_BELOW_FLOOR });
  });

  it('the definition\'s own floor reads the plan it is handed', () => {
    const floor = kizunaSonioxProvider.session!.minimumBalance!;
    expect(floor(shapeOn(withEdge, ['speaker']), SONIOX_DEFAULTS)).toBe(8_334);
    expect(floor(shapeOn(alone, ['speaker']), SONIOX_DEFAULTS)).toBe(12_500);
  });
});

describe('the voice claim', () => {
  const cloned: SonioxSettings = { ...SONIOX_DEFAULTS, region: 'us', voice: 'a-cloned-voice-id' };
  const claim = () => {
    const prepare = vi.fn(async () => ({ ok: true as const, voiceId: 'a-cloned-voice-id' }));
    return { prepare, run: createKizunaVoiceClaim({ prepare, clientFor: vi.fn(() => ({}) as never), loadClip: vi.fn(async () => null), hasDeviceClip: vi.fn(async () => false) }) };
  };

  it("claims no voice when another provider's voice reads the translation", async () => {
    const { prepare, run } = claim();
    expect(await run(shapeOn(withEdge, ['speaker']), cloned, new AbortController().signal)).toEqual({});
    expect(await run(shapeOn(withEdge, ['speaker', 'participant'], { participantSpeech: true }), cloned, new AbortController().signal)).toEqual({});
    expect(prepare).not.toHaveBeenCalled();
  });

  it("still claims the cloned voice when Kizuna AI's Soniox speaks", async () => {
    const { prepare, run } = claim();
    await run(shapeOn(alone, ['speaker']), cloned, new AbortController().signal);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

describe('the lease', () => {
  /** The body of the session-key request `acquire` sends for a shape. */
  async function bodySent(shape: RunShape, flag: boolean): Promise<unknown> {
    const sent: unknown[] = [];
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Promise<Response>(() => {});
    });
    const controller = new AbortController();
    const ctx: LeaseContext = { signal: controller.signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() };
    const pending = createKizunaLease({ participantSpeech: flag, fetch: fetchStub as unknown as typeof fetch, apiUrl: () => 'https://api.test' })(shape, SONIOX_DEFAULTS, ctx);
    pending.catch(() => {});
    await flush();
    controller.abort(new Error('done'));
    return sent[0];
  }

  it.each([[true], [false]])("asks the service for a text-only session when Edge speaks (flag %s): the body of today's text-only start", async (flag) => {
    for (const legs of LEGS) {
      const sent = await bodySent(shapeOn(withEdge, legs, { textOnly: false, participantSpeech: true }), flag);
      expect(sent, legs.join('+')).toEqual(await bodySent(textOnlyToday(legs), flag));
      expect(sent, legs.join('+')).toMatchObject({ textOnly: true });
    }
  });

  it("asks for the speaker's speech when Kizuna AI's Soniox speaks, as before", async () => {
    expect(await bodySent(shapeOn(alone, ['speaker']), true)).toMatchObject({ mode: 'speaker', textOnly: false });
  });
});

describe('a shape whose plan is of another provider under the same request', () => {
  it('a plan that does not hold this provider at all asks it for no speech', () => {
    // Not a run that happens: the rule is "this provider's unit serves speech", whatever else the plan holds.
    const other = stubProvider('soniox');
    const plan = compose({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' }, { providers: [other], settings: () => undefined }) as RunPlan;
    expect(leaseRequest({ plan, legs: ['speaker'], textOnly: false, participantSpeech: false }, { region: 'us', bothModeSharedSession: true }, false).textOnly).toBe(true);
  });
});

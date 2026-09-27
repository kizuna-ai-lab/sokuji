/**
 * Kizuna Soniox's participant speech, built end to end and shipped off
 * (Stage 2 Kizuna Soniox, ruling 2): the shipped definition against a
 * test-only twin with the flag on, through the switch, the leg's
 * context, the session-key body, the floors, and the lease's keys into
 * the adapter in split Both, shared Both and participant-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
const tooltips = vi.hoisted(() => [] as unknown[]);
vi.mock('../../components/Tooltip/Tooltip', () => ({
  default: ({ content }: { content: unknown }) => {
    tooltips.push(content);
    return null;
  },
}));
// The switch finds the selected provider in the registry: a test can stand the flag-on twin in for the shipped one.
const standIn = vi.hoisted(() => ({ provider: null as unknown }));
vi.mock('../registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../registry')>();
  return { ...actual, getProvider: (id: string) => (id === 'kizunaai_soniox' && standIn.provider ? standIn.provider : actual.getProvider(id)) };
});

import { ParticipantSpeechSwitch } from '../../components/Settings/sections/ParticipantSpeechSwitch';
import type { StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { LegName } from '../../lib/conversation/types';
import type { AnyProvider } from '../../lib/provider/types';
import { contextsFor } from '../../lib/session/shape';
import type { LeaseContext, RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { createSonioxAdapter } from './adapter';
import type { SonioxConfig } from './config';
import { createKizunaSonioxProvider, kizunaSonioxProvider } from './kizuna';
import { PARTICIPANT_SPEECH_FIELD } from './leaseRequest';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { END, isStt, msg, orig, SHARED, tr, type Json } from './testing';

const speaking = createKizunaSonioxProvider({ participantSpeech: true });

let answer: unknown = null;
const bodies: string[] = [];
beforeEach(() => {
  bodies.length = 0;
  tooltips.length = 0;
  standIn.provider = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/soniox/session-key')) {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const grantOf = (roles: string[]) => ({
  leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', maxSessionDurationSeconds: 600,
  streams: roles.map((role) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}` })),
});

/** A start the user wants the participant to speak in: the flag decides whether it does. */
function shapeFor(provider: AnyProvider, legs: LegName[], shared: boolean): { shape: RunShape; s: SonioxSettings } {
  const s: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: shared };
  return {
    s,
    shape: {
      provider, settings: s, credentials: {}, pair: { source: 'en', target: 'ja' }, legs, turnMode: 'auto', textOnly: false,
      participantSpeech: true, keepReplayAudio: true, shared: SHARED,
      auth: { signedIn: true, userId: 'u1', getToken: async () => 'tok' },
    },
  };
}

/** The lease minted over the stub, then the adapter started on its keys, every socket opened. */
async function run(provider: AnyProvider, legs: LegName[], shared: boolean, roles: string[]) {
  answer = grantOf(roles);
  const { shape, s } = shapeFor(provider, legs, shared);
  const clock = createVirtualClock(0);
  const signal = new AbortController().signal;
  const ctx: LeaseContext = { signal, clock, end: vi.fn(), frame: vi.fn() };
  const lease = await provider.session!.acquire!(shape, s, ctx);
  const contexts = contextsFor(shape);
  const sockets = fakeSockets();
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const rec = { speaker: recordEvents(), participant: recordEvents() };
  const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> => ({
    context: contexts[leg]!, config: provider.build(contexts[leg]!, s, SHARED) as SonioxConfig,
    credentials: lease.credentials(leg) as SonioxCredentials, clock, signal,
  });
  const starting = legs.length === 2
    ? adapter.startBoth({ speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events })
    : adapter.start(request(legs[0]), rec[legs[0]].events);
  for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open();
  await starting;
  await flush();
  return { contexts, lease, stt: sockets.all.filter(isStt), tts: sockets.all.filter((x) => !isStt(x)), rec };
}
type Ran = Awaited<ReturnType<typeof run>>;

/** One utterance the participant said ('ja'), and its translation: the participant's STT socket is the last one (split: the second; else the only one). */
function participantSays(r: Ran): void {
  r.stt[r.stt.length - 1].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
}
const sentWithKey = (r: Ran, key: string) => r.tts.flatMap((x) => x.sentJson<Json>()).filter((m) => m.api_key === key);
const degraded = (r: Ran) => r.rec.participant.log.filter((e) => e.kind === 'degraded');

describe('the switch', () => {
  it('shipped, the flag off: off and disabled with the "not yet" tooltip, the stored choice kept', () => {
    useRoutingStore.setState({ participantSpeech: true });
    useProviderStore.setState({ selected: 'kizunaai_soniox' });
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(tooltips).toContain('audioPanel.participantSpeechNotYetAvailable');
    expect(useRoutingStore.getState().participantSpeech).toBe(true);
  });

  it('the flag on: enabled, following the stored choice', () => {
    standIn.provider = speaking;
    useRoutingStore.setState({ participantSpeech: true });
    useProviderStore.setState({ selected: 'kizunaai_soniox' });
    render(<ParticipantSpeechSwitch locked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).not.toBe('true');
    expect(tooltips).toContain('audioPanel.participantSpeechDesc');
  });
});

describe('the flag off (as shipped)', () => {
  it('the participant leg asks for no speech, and the body is today\'s, with no field', async () => {
    const r = await run(kizunaSonioxProvider, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt']);
    expect(r.contexts.participant?.speech).toBe(false);
    expect(bodies).toEqual(['{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}']);
    expect(JSON.parse(bodies[0])).not.toHaveProperty(PARTICIPANT_SPEECH_FIELD);
  });

  it.each([
    ['split Both', ['speaker', 'participant'] as LegName[], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], 1],
    ['shared Both', ['speaker', 'participant'] as LegName[], true, ['mix_stt', 'mix_tts', 'par_tts'], 1],
    ['participant only', ['participant'] as LegName[], true, ['par_stt', 'par_tts'], 0],
  ])('%s: a stray par_tts is ignored, and the participant stays text-only', async (_name, legs, shared, roles, ttsSockets) => {
    const r = await run(kizunaSonioxProvider, legs, shared, roles);
    expect(r.lease.credentials('participant')).not.toHaveProperty('tts');
    expect(r.tts).toHaveLength(ttsSockets);
    participantSays(r);
    expect(sentWithKey(r, 'k-par_tts')).toEqual([]);
    expect(degraded(r)).toEqual([]);
  });

  it("the floor prices no participant speech", () => {
    expect(kizunaSonioxProvider.session!.minimumBalance!({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: false })).toBe(60_000);
  });
});

describe('the flag on (a test-only twin from the same factory)', () => {
  it('the participant leg asks for speech, and the body carries the field', async () => {
    const r = await run(speaking, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts']);
    expect(r.contexts.participant?.speech).toBe(true);
    expect(JSON.parse(bodies[0])).toEqual({ mode: 'both', textOnly: false, bothSplit: true, region: 'us', [PARTICIPANT_SPEECH_FIELD]: true });
  });

  it.each([
    ['split Both', ['speaker', 'participant'] as LegName[], false, ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], 2],
    ['shared Both', ['speaker', 'participant'] as LegName[], true, ['mix_stt', 'mix_tts', 'par_tts'], 2],
    ['participant only', ['participant'] as LegName[], true, ['par_stt', 'par_tts'], 1],
  ])('%s: a par_tts answer makes the participant speak, on its own TTS socket and key', async (_name, legs, shared, roles, ttsSockets) => {
    const r = await run(speaking, legs, shared, roles);
    expect(r.lease.credentials('participant')).toMatchObject({ tts: 'k-par_tts' });
    expect(r.tts).toHaveLength(ttsSockets);
    participantSays(r);
    expect(sentWithKey(r, 'k-par_tts')).toEqual([expect.objectContaining({ api_key: 'k-par_tts', language: 'en' })]);
    expect(degraded(r)).toEqual([]);
  });

  it('an answer with no par_tts leaves the participant text-only, saying tts_degraded once', async () => {
    const r = await run(speaking, ['speaker', 'participant'], false, ['spk_stt', 'spk_tts', 'par_stt']);
    expect(r.lease.credentials('participant')).not.toHaveProperty('tts');
    expect(degraded(r)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ code: 'tts_degraded' }) })]);
  });

  it("the floors count the participant's speech stream", () => {
    const floor = (legs: LegName[], shared: boolean) => speaking.session!.minimumBalance!({ legs, textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: shared });
    expect(floor(['speaker', 'participant'], false)).toBe(83_334);
    expect(floor(['speaker', 'participant'], true)).toBe(65_000);
    expect(floor(['participant'], true)).toBe(41_667);
  });
});

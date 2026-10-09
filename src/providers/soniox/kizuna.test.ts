/**
 * Kizuna AI's managed Soniox (Stage 2 Kizuna Soniox, rulings 2 and 6): the
 * definition `managed(soniox)` composes — Soniox's languages, builder and
 * adapter under the old enum's id and slice, the sign-in for a key, the
 * voice claim, the lease and the floor — and one run through the runner
 * over a stubbed `fetch` (ruling 12), a stand-in adapter keeping sockets out.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { AnyProvider, AuthContext } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { fakeProvider } from '../fake/provider';
import { FAKE_DEFAULTS } from '../fake/settings';
import { createFakeSource } from '../fake/source';
import { KIZUNA_PARTICIPANT_SPEECH, KizunaSonioxSettingsView, kizunaSonioxProvider } from './kizuna';
import { sonioxProvider } from './provider';
import { migrateSonioxSettings, SONIOX_DEFAULTS } from './settings';
import { SonioxSettingsView } from './SonioxSettings';

const getToken = async () => 'tok';
const signedIn: AuthContext = { signedIn: true, userId: 'u1', getToken };

afterEach(() => vi.unstubAllGlobals());

describe('kizunaSonioxProvider', () => {
  it('is Kizuna AI\'s Soniox: managed, under the old enum\'s id and slice, with no guide', () => {
    expect(kizunaSonioxProvider).toMatchObject({
      id: 'kizunaai_soniox',
      kind: 'managed',
      vendor: 'Soniox',
      platforms: ['electron', 'extension', 'web'],
      participantSpeech: false,
      faceToFace: true,
    });
    expect(kizunaSonioxProvider.guideUrl).toBeUndefined();
    expect(kizunaSonioxProvider.flagged).toBeUndefined();
    expect(kizunaSonioxProvider.settings).toEqual({ key: 'kizunaSoniox', defaults: SONIOX_DEFAULTS, migrate: migrateSonioxSettings });
    expect(kizunaSonioxProvider.icon).toBeTypeOf('function');
  });

  it('reads the sign-in and checks nothing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(kizunaSonioxProvider.credentials.read({}, { signedIn: false, getToken })).toEqual({ missing: 'Sign in to use Kizuna AI Soniox.', code: 'sign_in_required' });
    expect(kizunaSonioxProvider.credentials.read({}, { signedIn: true, loaded: false, getToken })).toMatchObject({ code: 'sign_in_pending' });
    expect(kizunaSonioxProvider.credentials.read({}, signedIn)).toEqual({ signedIn: true });
    await expect(kizunaSonioxProvider.check({ signedIn: true }, SONIOX_DEFAULTS, { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] })).resolves.toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is Soniox's languages, capabilities, builder, adapter and turn detection", () => {
    for (const member of ['languages', 'speech', 'textInput', 'boundaries', 'turns', 'build', 'describe', 'start', 'TurnDetection'] as const) {
      expect(kizunaSonioxProvider[member], member).toBe(sonioxProvider[member]);
    }
    expect(kizunaSonioxProvider.session!.startBoth).toBe(sonioxProvider.session!.startBoth);
  });

  it('adds the voice claim, the lease and the floor', () => {
    const session = kizunaSonioxProvider.session!;
    expect(session.prepare).toBeTypeOf('function');
    expect(session.acquire).toBeTypeOf('function');
    // The flag is off: the participant's wish prices nothing.
    expect(session.minimumBalance!({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: false })).toBe(60_000);
    expect(KIZUNA_PARTICIPANT_SPEECH).toBe(false);
  });

  it("its Settings is Soniox's view in the managed flavour", () => {
    expect(kizunaSonioxProvider.Settings).toBe(KizunaSonioxSettingsView);
    expect(kizunaSonioxProvider.Settings).not.toBe(SonioxSettingsView);
  });

  it('runs through the runner: its lease mints, the budget shows, and Stop releases it', async () => {
    // A stand-in adapter keeps sockets out; the lease, the claim and the floor are Kizuna Soniox's own.
    const provider = {
      ...kizunaSonioxProvider,
      build: fakeProvider.build,
      describe: fakeProvider.describe,
      start: fakeProvider.start,
      session: { ...kizunaSonioxProvider.session, startBoth: undefined },
    } as AnyProvider;
    const fetch = vi.fn(async (url: string) => (url.endsWith('/soniox/session-key')
      ? new Response(JSON.stringify({
          leaseId: 'lease-1', clientReferenceId: 'ref-spk_stt', region: 'us', maxSessionDurationSeconds: 600,
          streams: [{ role: 'spk_stt', apiKey: 'k1', clientReferenceId: 'ref-spk_stt' }, { role: 'spk_tts', apiKey: 'k2', clientReferenceId: 'ref-spk_tts' }],
        }), { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    const clock = createVirtualClock(0);
    const shape: RunShape = {
      provider,
      // The claim skips the built-in voice Soniox's defaults name: nothing to claim, nothing called.
      settings: { ...FAKE_DEFAULTS, ...SONIOX_DEFAULTS },
      credentials: {},
      pair: { source: 'en', target: 'ja' },
      legs: ['speaker'],
      turnMode: 'auto',
      textOnly: false,
      participantSpeech: false,
      keepReplayAudio: true,
      shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
      auth: signedIn,
    };
    const frames = { frame: vi.fn() };
    const runner = createRunner({
      clock, platform: 'electron', readShape: () => shape,
      ensureReady: async () => ({ state: 'ready', models: [] }),
      persistIfUnchanged: () => {},
      openSource: async () => createFakeSource(clock),
      playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
      analytics: { track: () => {} },
      frames,
      newSessionId: () => 'run1',
      timeoutMs: 1000,
    });

    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 600_000, endsAt: 600_000 } });
    expect(frames.frame).toHaveBeenCalledWith('speaker', expect.objectContaining({ type: 'session.lease_acquired' }));

    await runner.stop();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/soniox\/session-end$/), expect.objectContaining({ keepalive: true, body: JSON.stringify({ leaseId: 'lease-1' }) }));
  });
});

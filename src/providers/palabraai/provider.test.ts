import { afterEach, describe, it, expect, vi } from 'vitest';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { PalabraAIIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO } from '../../lib/provider/languages';
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { buildPalabra, describePalabra, type PalabraConfig } from './config';
import { PalabraSettingsView } from './PalabraSettings';
import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { palabraProvider } from './provider';
import { migratePalabraSettings, PALABRA_DEFAULTS, palabraCredentials, palabraLanguages, type PalabraSettings } from './settings';
import { APP, AUTO_CTX, configFor, KEY, SHARED } from './testing';

const noAuth = { signedIn: false, getToken: async () => null };

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: palabraProvider, settings: PALABRA_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;

describe('the Palabra AI definition', () => {
  it('is Palabra AI with your own credentials, on every platform, under its old id and slice, linking its setup guide', () => {
    expect(palabraProvider).toMatchObject({
      id: 'palabraai',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: PalabraAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',
      settings: { key: 'palabraai', defaults: PALABRA_DEFAULTS, migrate: migratePalabraSettings },
      Settings: PalabraSettingsView,
      TurnDetection: { Summary: PalabraTurnDetectionSummary, Controls: PalabraTurnDetectionControls },
      credentials: palabraCredentials,
      checkReads: ['authMode'],
      languages: palabraLanguages,
      build: buildPalabra,
      describe: describePalabra,
    });
    // No `legacyKeys`, nothing converted (ruling 2); unflagged (ruling 14).
    for (const absent of ['flagged', 'session', 'participantSpeech', 'testerSwitch'] as const) expect(palabraProvider, absent).not.toHaveProperty(absent);
    expect(palabraProvider.settings).not.toHaveProperty('legacyKeys');
    expect(palabraProvider.TurnDetection).not.toHaveProperty('Help');
  });

  it("offers Text only (ruling 7), takes no typed text, keeps the server's boundaries, and offers both turn modes", () => {
    expect(palabraProvider.speech).toBe('optional');
    expect(palabraProvider.textInput(PALABRA_DEFAULTS)).toBe(false);
    expect(palabraProvider.boundaries(PALABRA_DEFAULTS)).toBe('provider');
    expect(palabraProvider.turns(PALABRA_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits last, after Soniox (ruling 14)', () => {
    const ids = PROVIDERS.filter((p) => !p.id.startsWith('fake')).map((p) => p.id);
    expect(ids[ids.length - 1]).toBe('palabraai');
    expect(ids.indexOf('palabraai')).toBe(ids.indexOf('soniox') + 1);
  });

  it("runs the participant in Palabra's own reverse — a region target by its source code — and speaks it when its switch is on (rulings 7, 9)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en-US' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    expect(palabraProvider.build(participant, PALABRA_DEFAULTS, SHARED)).toMatchObject({ source: 'en', target: 'ja', speech: true });
    expect(gate(both({ source: 'ja', target: 'en-US' }), 'electron')).toBeNull();
    // The other way: English reverses to its documented US English.
    expect(contextsFor(both({ source: 'en', target: 'ja' })).participant!.direction).toEqual({ source: 'ja', target: 'en-US' });
    // A participant that does not speak asks for text alone.
    expect((palabraProvider.build(contextsFor(both({ source: 'ja', target: 'en-US' })).participant!, PALABRA_DEFAULTS, SHARED) as PalabraConfig).speech).toBe(false);
  });

  it('refuses Both where the docs give no reverse: an Auto-detect source, or a target with no source code (D20, ruling 8)', () => {
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'en', target: 'az' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'bn', target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    // Speaker alone, Auto-detect translates.
    expect(gate({ ...both({ source: AUTO, target: 'en' }), legs: ['speaker'] }, 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket and asks no REST server', async () => {
    const opened = vi.fn();
    const fetched = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    vi.stubGlobal('fetch', fetched);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    for (const credentials of [KEY, APP]) {
      await expect(palabraProvider.start(
        { context: AUTO_CTX, config: configFor(), credentials, clock: createVirtualClock(0), signal: controller.signal },
        recordEvents().events,
      )).rejects.toBe(reason);
    }
    expect(opened).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was — the key, the pair, the settings, a threshold the API refuses sent as its floor — and writes nothing', async () => {
    stored.set('settings.palabraai.authMode', 'platform');
    stored.set('settings.palabraai.apiKey', 'plbr_oldProfileKey0123456789');
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'en-US');
    stored.set('settings.palabraai.voiceId', 'default_high');
    stored.set('settings.palabraai.segmentConfirmationSilenceThreshold', 0.1);
    stored.set('settings.palabraai.subscriberCount', 2);
    await useProviderStore.getState().load(palabraProvider);
    const entry = useProviderStore.getState().entries.palabraai;
    expect(entry.settings as PalabraSettings).toEqual({ ...PALABRA_DEFAULTS, voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1 });
    expect(readCredentials(palabraProvider, entry.settings, entry.credentials, noAuth)).toEqual({ kind: 'apiKey', apiKey: 'plbr_oldProfileKey0123456789' });
    expect(entry.pair).toEqual({ source: 'ja', target: 'en-US' });
    expect((palabraProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as PalabraSettings, SHARED) as PalabraConfig).silenceThreshold).toBe(0.3);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('opens a profile from before the platform key in the platform mode, its app pair kept but not read, and the old per-provider pair keys not read at all: the provider shows its initial pair (ruling 2)', async () => {
    stored.set('settings.palabraai.clientId', 'legacy-client-id');
    stored.set('settings.palabraai.clientSecret', 'legacy-client-secret');
    stored.set('settings.palabraai.sourceLanguage', 'ja');
    stored.set('settings.palabraai.targetLanguage', 'vn');
    await useProviderStore.getState().load(palabraProvider);
    const entry = useProviderStore.getState().entries.palabraai;
    expect((entry.settings as PalabraSettings).authMode).toBe('platform');
    expect(readCredentials(palabraProvider, entry.settings, entry.credentials, noAuth)).toMatchObject({ missing: expect.any(String) });
    // One click on the app pair's option, and the pair it kept reads again.
    const app = { ...(entry.settings as PalabraSettings), authMode: 'app' as const };
    expect(readCredentials(palabraProvider, app, entry.credentials, noAuth)).toEqual({ kind: 'app', clientId: 'legacy-client-id', clientSecret: 'legacy-client-secret' });
    expect(entry.pair).toEqual({ source: 'en', target: 'es' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps its readiness through an edit to a slider or a switch; the credential mode, or a credential, asks again (checkReads)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(palabraProvider);
    store.setCredential(palabraProvider, 'apiKey', 'plbr_readyKey0123456789');
    await store.refreshReadiness(palabraProvider, noAuth);
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'ready', models: [] });
    store.updateSettings(palabraProvider, { segmentConfirmationSilenceThreshold: 1.1 });
    store.updateSettings(palabraProvider, { autoTempo: true });
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'ready', models: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.updateSettings(palabraProvider, { authMode: 'app' });
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'unknown' });
  });
});

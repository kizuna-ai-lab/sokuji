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

import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO } from '../../lib/provider/languages';
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders, PROVIDERS } from '../registry';
import { buildLive, describeLive, type LiveConfig } from './config';
import { LiveSettingsView } from './LiveSettings';
import { openaiLiveProvider } from './provider';
import { LIVE_DEFAULTS, LIVE_LEGACY_KEYS, liveCredentials, liveLanguages, migrateLiveSettings, type LiveSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiLiveProvider, settings: LIVE_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;
const noAuth = { signedIn: false, getToken: async () => null };
const env = (platform: 'electron' | 'extension' | 'web') => ({ platform, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false });

describe('the OpenAI Live definition', () => {
  it('is OpenAI Live with your own key, under its old id and slice, linking the OpenAI setup guide — on the desktop app and the extension only (choice 17)', () => {
    expect(openaiLiveProvider).toMatchObject({
      id: 'openai_live',
      kind: 'own-key',
      platforms: ['electron', 'extension'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openaiLive', defaults: LIVE_DEFAULTS, legacyKeys: LIVE_LEGACY_KEYS, migrate: migrateLiveSettings },
      Settings: LiveSettingsView,
      credentials: liveCredentials,
      checkReads: [],
      languages: liveLanguages,
      build: buildLive,
      describe: describeLive,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(openaiLiveProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only (ruling 1), takes no typed text (ruling 9), ends segments on our own timers, and offers both turn modes (ruling 5)', () => {
    expect(openaiLiveProvider.speech).toBe('optional');
    expect(openaiLiveProvider.textInput(LIVE_DEFAULTS)).toBe(false);
    expect(openaiLiveProvider.boundaries(LIVE_DEFAULTS)).toBe('silence');
    expect(openaiLiveProvider.turns(LIVE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after OpenAI Translate, before Soniox (ruling 9), and is offered on the desktop app and the extension, never on the web', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('openai_translate') + 1);
    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('soniox') - 1);
    expect(presentProviders(env('electron')).map((p) => p.id)).toContain('openai_live');
    expect(presentProviders(env('extension')).map((p) => p.id)).toContain('openai_live');
    expect(presentProviders(env('web')).map((p) => p.id)).not.toContain('openai_live');
  });

  it("lets the participant speak on its switch, with Other's prompt (ruling 1), and refuses Both for Auto-detect (D20)", () => {
    const participant = contextsFor(both({ source: 'en', target: 'zh-CN' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'zh-CN', target: 'en' }, speech: true, turns: 'auto' });
    const s: LiveSettings = { ...LIVE_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's." };
    expect(openaiLiveProvider.build(participant, s, { ...SHARED, reversed: (d) => d.source === 'zh-CN' && d.target === 'en' })).toMatchObject({ instructions: "Other's." });
    expect(contextsFor(both({ source: 'en', target: 'zh-CN' })).participant!.speech).toBe(false);
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'en', target: 'zh-CN' }), 'electron')).toBeNull();
  });

  it('a start whose signal already aborted registers nothing and opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const invoke = vi.fn();
    vi.stubGlobal('electronAPI', {});
    vi.stubGlobal('electron', { invoke });
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiLiveProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(invoke).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was — the key, the pair, the voice — reading neither the old pauses nor anything else, and writes nothing', async () => {
    stored.set('settings.openaiLive.apiKey', 'sk-proj-oldLiveKey0123');
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'en');
    stored.set('settings.openaiLive.voice', 'cedar');
    stored.set('settings.openaiLive.userSilenceDuration', 900);
    stored.set('settings.common.useTemplateMode', false);
    stored.set('settings.common.systemInstructions', 'Interpret faithfully.');
    await useProviderStore.getState().load(openaiLiveProvider);
    const entry = useProviderStore.getState().entries.openai_live;
    expect(entry.settings as LiveSettings).toEqual({ useTemplateMode: false, systemInstructions: 'Interpret faithfully.', participantSystemInstructions: '', voice: 'cedar' });
    expect(readCredentials(openaiLiveProvider, entry.settings, entry.credentials, noAuth)).toEqual({ apiKey: 'sk-proj-oldLiveKey0123' });
    expect(entry.pair).toEqual({ source: 'ja', target: 'en' });
    const config = openaiLiveProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as LiveSettings, SHARED) as LiveConfig;
    expect(config).toMatchObject({ model: 'gpt-live-1', voice: 'cedar', instructions: 'Interpret faithfully.', transport: 'websocket' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps its readiness through a voice or a prompt edit: Start stays on and nothing is listed again; a new key forgets it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-live-1', created: 1 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(openaiLiveProvider);
    store.setCredential(openaiLiveProvider, 'apiKey', 'sk-proj-readyKey0123');
    await store.refreshReadiness(openaiLiveProvider, noAuth);
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'ready', models: [{ id: 'gpt-live-1' }] });
    store.updateSettings(openaiLiveProvider, { voice: 'coral' });
    store.updateSettings(openaiLiveProvider, { systemInstructions: 'A new prompt.' });
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'ready', models: [{ id: 'gpt-live-1' }] });
    const entry = useProviderStore.getState().entries.openai_live;
    await store.refreshReadiness(openaiLiveProvider, noAuth, { settings: entry.settings, credentials: entry.credentials, pair: entry.pair, legs: ['speaker'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.setCredential(openaiLiveProvider, 'apiKey', 'sk-proj-otherKey0123');
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'unknown' });
  });
});

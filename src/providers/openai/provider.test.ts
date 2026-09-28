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
import { selectionFromStored } from '../../lib/session/storedSettings';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders, PROVIDERS } from '../registry';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { openaiProvider } from './provider';
import { RealtimeSettingsView } from './RealtimeSettings';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import { migrateRealtimeSettings, REALTIME_DEFAULTS, REALTIME_LEGACY_KEYS, realtimeCredentials, realtimeLanguages, type RealtimeSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiProvider, settings: REALTIME_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;
const noAuth = { signedIn: false, getToken: async () => null };

describe('the OpenAI Realtime definition', () => {
  it('is OpenAI Realtime with your own key, on every platform, under its old id and slice, linking the OpenAI setup guide (ruling 19)', () => {
    expect(openaiProvider).toMatchObject({
      id: 'openai',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openai', defaults: REALTIME_DEFAULTS, legacyKeys: REALTIME_LEGACY_KEYS, migrate: migrateRealtimeSettings },
      Settings: RealtimeSettingsView,
      TurnDetection: { Summary: RealtimeTurnDetectionSummary, Controls: RealtimeTurnDetectionControls, Help: RealtimeTurnDetectionHelp },
      credentials: realtimeCredentials,
      checkReads: [],
      languages: realtimeLanguages,
      build: buildRealtime,
      describe: describeRealtime,
    });
    for (const absent of ['flagged', 'i18nKey', 'session', 'participantSpeech'] as const) {
      expect(openaiProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only and typed text, keeps the server\'s boundaries, and offers both turn modes', () => {
    expect(openaiProvider.speech).toBe('optional');
    expect(openaiProvider.textInput).toBe(true);
    expect(openaiProvider.boundaries(REALTIME_DEFAULTS)).toBe('provider');
    expect(openaiProvider.turns(REALTIME_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after Doubao AST 2.0 and before OpenAI Translate, and OpenAI Compatible is registered nowhere (rulings 18, 1)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('volcengine_ast2') + 1);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('openai_translate') - 1);
    expect(ids).not.toContain('openai_compatible');
  });

  it('a stored OpenAI Compatible selection falls to the first provider offered, through the existing rule: nothing is written (ruling 1)', () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      const offered = presentProviders({ platform, dev: false, enabled: new Set(), kizuna: true, switchOn: () => false }).map((p) => p.id);
      expect(selectionFromStored('openai_compatible', offered, 'kizunaai_soniox'), platform).toEqual({ id: offered[0], fromStorage: false });
    }
  });

  it("lets the participant speak when its switch is on, with Other's prompt and the user's own detection (rulings 4, 15), and refuses Both for Auto-detect (D20)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    const s: RealtimeSettings = { ...REALTIME_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's.", turnDetectionMode: 'Semantic' };
    const shared = { ...SHARED, reversed: (d: { source: string; target: string }) => d.source === 'en' && d.target === 'ja' };
    expect(openaiProvider.build(participant, s, shared)).toMatchObject({ instructions: "Other's.", modalities: ['audio'], turnDetection: { type: 'semantic_vad', eagerness: 'auto' } });
    expect(contextsFor(both({ source: 'ja', target: 'en' })).participant!.speech).toBe(false);
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'ja', target: 'en' }), 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it("loads an old profile as it was — the key, the pair, the settings, a WebRTC choice run over WebSocket — reading no temperature and converting nothing, and writes nothing (rulings 5, 6, 12)", async () => {
    stored.set('settings.openai.apiKey', 'sk-proj-oldProfileKey0123');
    stored.set('settings.openai.sourceLanguage', 'ko');
    stored.set('settings.openai.targetLanguage', 'ja');
    stored.set('settings.openai.model', 'gpt-realtime-2.1');
    stored.set('settings.openai.voice', 'marin');
    stored.set('settings.openai.turnDetectionMode', 'Semantic');
    stored.set('settings.openai.semanticEagerness', 'High');
    stored.set('settings.openai.transportType', 'webrtc');
    stored.set('settings.openai.temperature', 1.1);
    // Electron reads a number saved over a string default back as the string (Stage 2 Gemini, ruling 10).
    stored.set('settings.openai.maxTokens', '2048');
    stored.set('settings.common.useTemplateMode', false);
    stored.set('settings.common.systemInstructions', 'Translate plainly.');
    await useProviderStore.getState().load(openaiProvider);
    const entry = useProviderStore.getState().entries.openai;
    expect(entry.settings as RealtimeSettings).toMatchObject({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', semanticEagerness: 'High', transportType: 'webrtc', maxTokens: 2048,
      useTemplateMode: false, systemInstructions: 'Translate plainly.',
    });
    expect(entry.settings).not.toHaveProperty('temperature');
    expect(readCredentials(openaiProvider, entry.settings, entry.credentials, noAuth)).toEqual({ apiKey: 'sk-proj-oldProfileKey0123' });
    expect(entry.pair).toEqual({ source: 'ko', target: 'ja' });
    const config = openaiProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as RealtimeSettings, { ...SHARED, models: [{ id: 'gpt-realtime-2.1' }] }) as RealtimeConfig;
    expect(config).toMatchObject({ transport: 'websocket', model: 'gpt-realtime-2.1', voice: 'marin', maxTokens: 2048, instructions: 'Translate plainly.' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("keeps its readiness through an edit to a slider or the prompt: Start stays on and nothing is listed again; a new key forgets it (ruling 9)", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-realtime-2.1-mini', created: 1 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(openaiProvider);
    store.setCredential(openaiProvider, 'apiKey', 'sk-proj-readyKey0123');
    await store.refreshReadiness(openaiProvider, noAuth);
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'ready', models: [{ id: 'gpt-realtime-2.1-mini' }] });
    store.updateSettings(openaiProvider, { threshold: 0.7 });
    store.updateSettings(openaiProvider, { systemInstructions: 'A new prompt.' });
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'ready', models: [{ id: 'gpt-realtime-2.1-mini' }] });
    const entry = useProviderStore.getState().entries.openai;
    await store.refreshReadiness(openaiProvider, noAuth, { settings: entry.settings, credentials: entry.credentials, pair: entry.pair, legs: ['speaker'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.setCredential(openaiProvider, 'apiKey', 'sk-proj-otherKey0123');
    expect(useProviderStore.getState().readiness.openai).toEqual({ state: 'unknown' });
  });
});

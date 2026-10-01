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
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import { openaiTranslateProvider } from './provider';
import { migrateTranslateSettings, TRANSLATE_DEFAULTS, translateCredentials, translateLanguages, type TranslateSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';
import { TranslateSettingsView } from './TranslateSettings';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, intent: undefined, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiTranslateProvider, settings: TRANSLATE_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;

describe('the OpenAI Translate definition', () => {
  it('is OpenAI Translate with your own key, on every platform, under its old id and slice, linking the OpenAI setup guide (ruling 12)', () => {
    expect(openaiTranslateProvider).toMatchObject({
      id: 'openai_translate',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openaiTranslate', defaults: TRANSLATE_DEFAULTS, migrate: migrateTranslateSettings },
      Settings: TranslateSettingsView,
      credentials: translateCredentials,
      languages: translateLanguages,
      build: buildTranslate,
      describe: describeTranslate,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(openaiTranslateProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only, takes no typed text, ends segments on our own timers, and offers both turn modes (ruling 4)', () => {
    expect(openaiTranslateProvider.speech).toBe('optional');
    expect(openaiTranslateProvider.textInput(TRANSLATE_DEFAULTS)).toBe(false);
    expect(openaiTranslateProvider.boundaries(TRANSLATE_DEFAULTS)).toBe('silence');
    expect(openaiTranslateProvider.turns(TRANSLATE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits before Soniox (ruling 11), OpenAI Live between them (Stage 2 OpenAI Live, ruling 9)', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('openai_live') - 1);
    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('soniox') - 1);
  });

  it("lets the participant speak when its switch is on, into the pair's source (ruling 5), and a speaker on Text only not speak (ruling 4)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    expect((openaiTranslateProvider.build(participant, TRANSLATE_DEFAULTS, SHARED) as TranslateConfig).target).toBe('ja');
    expect(contextsFor(both({ source: 'ja', target: 'en' })).participant!.speech).toBe(false);
    expect(contextsFor(both({ source: 'ja', target: 'en' }, { textOnly: true })).speaker!.speech).toBe(false);
  });

  it('refuses Both before anything opens when the speaker\'s source is one it only hears (D20), and allows it for one it speaks', () => {
    expect(gate(both({ source: 'th', target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'ja', target: 'en' }), 'electron')).toBeNull();
    expect(gate({ ...both({ source: 'th', target: 'en' }), legs: ['speaker'] }, 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiTranslateProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was: the key, the pair, the noise reduction; a WebRTC choice and the transcript model unread, the session over WebSocket, nothing written (rulings 1, 8)', async () => {
    stored.set('settings.openaiTranslate.apiKey', 'sk-proj-oldProfileKey0123');
    stored.set('settings.common.sourceLanguage', 'ko');
    stored.set('settings.common.targetLanguage', 'ja');
    stored.set('settings.openaiTranslate.noiseReduction', 'Far field');
    stored.set('settings.openaiTranslate.transportType', 'webrtc');
    stored.set('settings.openaiTranslate.transcriptModel', 'gpt-realtime-whisper');
    await useProviderStore.getState().load(openaiTranslateProvider);
    const entry = useProviderStore.getState().entries.openai_translate;
    expect(entry.settings as TranslateSettings).toEqual({ noiseReduction: 'Far field' });
    expect(readCredentials(openaiTranslateProvider, entry.settings, entry.credentials, { signedIn: false, getToken: async () => null })).toEqual({ apiKey: 'sk-proj-oldProfileKey0123' });
    expect(entry.pair).toEqual({ source: 'ko', target: 'ja' });
    const config = openaiTranslateProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as TranslateSettings, SHARED) as TranslateConfig;
    expect(config).toMatchObject({ transport: 'websocket', noiseReduction: 'far_field', transcriptModel: 'gpt-live-transcribe', target: 'ja' });
    expect(setSetting).not.toHaveBeenCalled();
  });
});

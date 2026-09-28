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

import { GeminiIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { contextsFor } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { checkGemini } from './check';
import { buildGemini, describeGemini, type GeminiConfig } from './config';
import { GeminiSettingsView } from './GeminiSettings';
import { GeminiTurnDetectionControls, GeminiTurnDetectionHelp, GeminiTurnDetectionSummary } from './GeminiTurnDetection';
import { geminiProvider } from './provider';
import { GEMINI_DEFAULTS, GEMINI_LEGACY_KEYS, geminiCredentials, geminiLanguages, migrateGeminiSettings, type GeminiSettings } from './settings';
import { AUTO_CTX, configFor, DIALOGUE, KEY, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false });
});

describe('the Gemini definition', () => {
  it('is Gemini with your own key, on every platform, under its old id and slice', () => {
    expect(geminiProvider).toMatchObject({
      id: 'gemini',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: GeminiIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',
      settings: { key: 'gemini', defaults: GEMINI_DEFAULTS, legacyKeys: GEMINI_LEGACY_KEYS, migrate: migrateGeminiSettings },
      Settings: GeminiSettingsView,
      TurnDetection: { Summary: GeminiTurnDetectionSummary, Controls: GeminiTurnDetectionControls, Help: GeminiTurnDetectionHelp },
      credentials: geminiCredentials,
      check: checkGemini,
      languages: geminiLanguages,
      build: buildGemini,
      describe: describeGemini,
    });
    expect(geminiProvider).not.toHaveProperty('flagged');
    expect(geminiProvider).not.toHaveProperty('i18nKey');
  });

  it('speaks optionally, takes typed text, cuts on silence (parity), offers both turn modes, and needs no session hook', () => {
    expect(geminiProvider.speech).toBe('optional');
    expect(geminiProvider.textInput).toBe(true);
    expect(geminiProvider.boundaries(GEMINI_DEFAULTS)).toBe('silence');
    expect(geminiProvider.turns(GEMINI_DEFAULTS)).toEqual(['auto', 'manual']);
    expect(geminiProvider.session).toBeUndefined();
  });

  it('sits after LocalInference (ruling 6)', () => {
    expect(PROVIDERS.slice(0, 3).map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini']);
  });

  it("lets the participant speak when its switch is on, voiced with Gemini's own voice (ruling 5)", () => {
    expect(geminiProvider.participantSpeech).toBeUndefined();
    const shape = { provider: geminiProvider, pair: { source: 'en-US', target: 'ja-JP' }, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, turnMode: 'auto' } as unknown as RunShape;
    const participant = contextsFor(shape).participant!;
    expect(participant).toEqual({ direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' });
    expect(contextsFor({ ...shape, participantSpeech: false }).participant!.speech).toBe(false);
    // A dialogue model's voice: Live Translate, the default when listed, speaks in the speaker's own (Gemini/AST2 follow-up, ruling 3).
    expect((geminiProvider.build(participant, { ...GEMINI_DEFAULTS, model: DIALOGUE }, SHARED) as GeminiConfig).voice).toBe('Aoede');
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(geminiProvider.start(
      { context: AUTO_CTX, config: configFor(DIALOGUE), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(opened).not.toHaveBeenCalled();
  });

  it("loads an old profile: the global prompt it edited and Electron's max tokens stored as a string, writing nothing back (rulings 4, 10)", async () => {
    stored.set('settings.common.useTemplateMode', false);
    stored.set('settings.common.systemInstructions', 'Translate plainly.');
    stored.set('settings.gemini.maxTokens', '2048');
    await useProviderStore.getState().load(geminiProvider);
    expect(useProviderStore.getState().entries.gemini.settings as GeminiSettings).toMatchObject({ useTemplateMode: false, systemInstructions: 'Translate plainly.', maxTokens: 2048 });
    // Nothing written back (choice 1): not the global copy, and not Gemini's own keys either.
    expect(setSetting.mock.calls.filter(([key]) => String(key).startsWith('settings.common.'))).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();

    // Once edited in Gemini's own Settings, its own value wins over the global copy. (`load` skips a provider already loaded: start from an empty store.)
    stored.set('settings.gemini.systemInstructions', 'Mine.');
    useProviderStore.setState({ entries: {} });
    await useProviderStore.getState().load(geminiProvider);
    expect((useProviderStore.getState().entries.gemini.settings as GeminiSettings).systemInstructions).toBe('Mine.');
  });
});

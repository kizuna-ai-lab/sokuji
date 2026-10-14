import { describe, it, expect } from 'vitest';
import { QwenIcon } from '../../components/Icons/ProviderIcons';
import type { PresenceEnv } from '../../lib/provider/presence';
import { presentProviders, PROVIDERS } from '../registry';
import { checkQwen } from './check';
import { buildQwen, describeQwen } from './config';
import { qwenLiveTranslateProvider } from './provider';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QwenTurnDetectionControls, QwenTurnDetectionSummary } from './QwenTurnDetection';
import { QWEN_DEFAULTS, qwenCredentials, qwenLanguages } from './settings';

const release = (platform: PresenceEnv['platform'], patch: Partial<PresenceEnv> = {}): PresenceEnv =>
  ({ platform, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false, ...patch });
const offered = (env: PresenceEnv) => presentProviders(env).map((p) => p.id);

describe('the Qwen LiveTranslate definition (spec §1)', () => {
  it('is Qwen LiveTranslate with your own key, unflagged, on the desktop app and the extension only', () => {
    expect(qwenLiveTranslateProvider).toMatchObject({
      id: 'qwen_livetranslate',
      kind: 'own-key',
      platforms: ['electron', 'extension'],
      icon: QwenIcon,
      settings: { key: 'qwenLiveTranslate', defaults: QWEN_DEFAULTS },
      Settings: QwenSettingsView,
      VoiceSummary: QwenVoiceSummary,
      TurnDetection: { Summary: QwenTurnDetectionSummary, Controls: QwenTurnDetectionControls },
      credentials: qwenCredentials,
      check: checkQwen,
      checkReads: [],
      languages: qwenLanguages,
      build: buildQwen,
      describe: describeQwen,
    });
    expect(qwenLiveTranslateProvider.settings).not.toHaveProperty('legacyKeys');
    expect(qwenLiveTranslateProvider.settings).not.toHaveProperty('migrate');
    for (const absent of ['flagged', 'testerSwitch', 'guideUrl', 'session', 'participantSpeech', 'faceToFace'] as const) {
      expect(qwenLiveTranslateProvider, absent).not.toHaveProperty(absent);
    }
  });

  it("speaks when asked, takes no typed text, keeps the server's turns, and offers both turn modes", () => {
    expect(qwenLiveTranslateProvider.speech).toBe('optional');
    expect(qwenLiveTranslateProvider.textInput(QWEN_DEFAULTS)).toBe(false);
    expect(qwenLiveTranslateProvider.boundaries(QWEN_DEFAULTS)).toBe('provider');
    expect(qwenLiveTranslateProvider.turns(QWEN_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('a release offers it on the desktop app and the extension, with no switch and no listing; the web never does', () => {
    for (const platform of ['electron', 'extension'] as const) {
      expect(offered(release(platform)), platform).toContain('qwen_livetranslate');
      expect(offered(release(platform, { kizuna: false })), platform).toContain('qwen_livetranslate');
    }
    expect(offered(release('web', { dev: true, enabled: new Set(['qwen_livetranslate']), switchOn: () => true }))).not.toContain('qwen_livetranslate');
  });

  it('sits right after Doubao AST 2.0 and right before OpenAI Realtime', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('qwen_livetranslate')).toBe(ids.indexOf('volcengine_ast2') + 1);
    expect(ids.indexOf('openai')).toBe(ids.indexOf('qwen_livetranslate') + 1);
  });
});

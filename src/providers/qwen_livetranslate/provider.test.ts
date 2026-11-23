import { describe, it, expect } from 'vitest';
import { QwenIcon } from '../../components/Icons/ProviderIcons';
import type { PresenceEnv } from '../../lib/provider/presence';
import { presentProviders, PROVIDERS } from '../registry';
import { checkQwen } from './check';
import { buildQwen, describeQwen } from './config';
import { qwenLiveTranslateProvider } from './provider';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QwenTurnDetectionControls, QwenTurnDetectionSummary } from './QwenTurnDetection';
import { migrateQwenSettings, QWEN_DEFAULTS, qwenCredentials, qwenLanguages } from './settings';
import { AUTO_CTX, SHARED } from './testing';

const [whole] = qwenLiveTranslateProvider.units;

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
    });
    expect(qwenLiveTranslateProvider.units.map((u) => u.id)).toEqual(['whole']);
    expect(whole.build(AUTO_CTX, QWEN_DEFAULTS, SHARED)).toEqual(buildQwen(AUTO_CTX, QWEN_DEFAULTS, SHARED));
    expect(whole.describe).toBe(describeQwen);
    expect(qwenLiveTranslateProvider.settings).not.toHaveProperty('legacyKeys');
    // Only the region is narrowed on load; the managed twin inherits the same migrate.
    expect(qwenLiveTranslateProvider.settings.migrate).toBe(migrateQwenSettings);
    expect(qwenLiveTranslateProvider.guideUrl).toBe('https://sokuji.kizuna.ai/docs/tutorials/qwen-setup');
    for (const absent of ['flagged', 'testerSwitch', 'session', 'participantSpeech', 'faceToFace'] as const) {
      expect(qwenLiveTranslateProvider, absent).not.toHaveProperty(absent);
    }
  });

  it("speaks when asked, takes no typed text, keeps the server's turns, and offers both turn modes", () => {
    expect(whole.capabilities(QWEN_DEFAULTS).speech).toBe('optional');
    expect(whole.capabilities(QWEN_DEFAULTS).textInput).toBe(false);
    expect(whole.capabilities(QWEN_DEFAULTS).boundaries).toBe('provider');
    expect(whole.capabilities(QWEN_DEFAULTS).turns).toEqual(['auto', 'manual']);
  });

  it('a release offers it on the desktop app and the extension, with no switch and no listing; the web never does', () => {
    for (const platform of ['electron', 'extension'] as const) {
      expect(offered(release(platform)), platform).toContain('qwen_livetranslate');
      expect(offered(release(platform, { kizuna: false })), platform).toContain('qwen_livetranslate');
    }
    expect(offered(release('web', { dev: true, enabled: new Set(['qwen_livetranslate']), switchOn: () => true }))).not.toContain('qwen_livetranslate');
  });

  it('sits right after Soniox and right before Palabra AI', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('qwen_livetranslate')).toBe(ids.indexOf('soniox') + 1);
    expect(ids.indexOf('palabraai')).toBe(ids.indexOf('qwen_livetranslate') + 1);
  });
});

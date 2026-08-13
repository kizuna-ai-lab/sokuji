import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

import { isPushGatedMode } from './speechMode';
import { Provider } from '../../types/Provider';

describe('isPushGatedMode', () => {
  it("treats 'Disabled' as push-gated for the OpenAI family only", () => {
    expect(isPushGatedMode(Provider.OPENAI, 'Disabled')).toBe(true);
    expect(isPushGatedMode(Provider.OPENAI_COMPATIBLE, 'Disabled')).toBe(true);
    expect(isPushGatedMode(Provider.GEMINI, 'Disabled')).toBe(false);
  });

  it("treats 'Push-to-Talk' and 'Push-to-Translate' as push-gated where the vocabulary has them", () => {
    for (const p of [Provider.GEMINI, Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE, Provider.VOLCENGINE_AST2]) {
      expect(isPushGatedMode(p, 'Push-to-Talk'), `PTT for ${p}`).toBe(true);
      expect(isPushGatedMode(p, 'Push-to-Translate'), `PTTr for ${p}`).toBe(true);
    }
    expect(isPushGatedMode(Provider.OPENAI, 'Push-to-Translate')).toBe(true);
  });

  it('never push-gated for providers without a speech-mode vocabulary (mode falls back to Auto)', () => {
    for (const p of [Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.OPENAI_TRANSLATE, Provider.PALABRA_AI, Provider.VOLCENGINE_ST, Provider.ZOOM_AI]) {
      expect(isPushGatedMode(p, 'Auto'), `Auto for ${p}`).toBe(false);
      expect(isPushGatedMode(p, 'Push-to-Talk'), `PTT for ${p}`).toBe(false);
    }
  });

  it("'Auto' / 'Normal' / 'Semantic' are never push-gated", () => {
    expect(isPushGatedMode(Provider.OPENAI, 'Normal')).toBe(false);
    expect(isPushGatedMode(Provider.OPENAI, 'Semantic')).toBe(false);
    expect(isPushGatedMode(Provider.GEMINI, 'Auto')).toBe(false);
  });
});

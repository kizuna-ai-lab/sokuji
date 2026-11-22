// src/lib/lineup/catalog.testing.ts
//
// The line-up catalog as it was declared by hand before step 2. The derived catalog must equal it entry for entry.
// Adding a provider adds its entry here. Imported by tests only; a test that keeps the registry out registers it.
import { registerCatalog } from './catalog';
import { RUN_STAGES } from './types';
import type { ProviderCaps } from './types';

const ALL = RUN_STAGES;
const e2e = (id: string, account: ProviderCaps['account']): ProviderCaps => ({ id, stages: ALL, host: id, joint: ALL, account, voiceAlone: false, takesVoice: false });

/** The released providers, in `RELEASED` order. */
export const RELEASED_CAPS: readonly ProviderCaps[] = [
  { id: 'kizunaai_soniox', stages: ALL, host: 'kizunaai_soniox', translatesOwn: true, account: 'kizuna', voiceAlone: true, takesVoice: true },
  e2e('kizunaai_qwen', 'kizuna'),
  { id: 'local_inference', stages: ALL, host: 'local_inference', account: 'none', voiceAlone: true, takesVoice: true },
  { id: 'bing', stages: ['translation'], host: 'bing', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'edge', stages: ['speech'], host: 'edge', account: 'none', voiceAlone: true, takesVoice: false },
  e2e('gemini', 'key'),
  e2e('volcengine_ast2', 'key'),
  e2e('openai', 'key'),
  e2e('openai_translate', 'key'),
  e2e('openai_live', 'key'),
  { id: 'soniox', stages: ALL, host: 'soniox', translatesOwn: true, account: 'key', voiceAlone: true, takesVoice: true },
  e2e('qwen_livetranslate', 'key'),
  e2e('palabraai', 'key'),
  { id: 'openai_text', stages: ['translation'], host: 'openai_text', account: 'key', voiceAlone: false, takesVoice: true },
  { id: 'gemini_text', stages: ['translation'], host: 'gemini_text', account: 'key', voiceAlone: false, takesVoice: true },
  { id: 'openai_compatible', stages: ['translation'], host: 'openai_compatible', account: 'key', voiceAlone: false, takesVoice: true },
];

/** The E2E build's fakes, in `DEV_ONLY` order; `account` follows their kind. */
export const E2E_CAPS: readonly ProviderCaps[] = [
  { id: 'fake', stages: ALL, host: 'fake', joint: ['transcription', 'translation'], account: 'key', voiceAlone: false, takesVoice: true },
  e2e('fake_leased', 'kizuna'),
  { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'key', voiceAlone: true, takesVoice: false },
  { id: 'fake_transcriber', stages: ['transcription'], host: 'fake_transcriber', account: 'key', voiceAlone: false, takesVoice: true },
  { id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'key', voiceAlone: false, takesVoice: true },
];

/**
 * Registers the released providers' catalog, as the registry does in every build but the E2E one, for a test that
 * reads the catalog without loading the registry. Call it at module level, before the first read.
 */
export function registerReleasedCatalog(): void {
  registerCatalog(RELEASED_CAPS);
}

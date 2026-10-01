import type { Provider } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import { getTranslationSourceLanguages, getTranslationTargetLanguages } from '../../lib/local-inference/modelManifest';

/**
 * LocalInference's `S` (spec: "Settings — never secrets"). Today's
 * `LocalInferenceSettings` (`src/services/providers/LocalInferenceProviderConfig.ts`)
 * minus three fields that leave `S` entirely under the new contract:
 * `sourceLanguage`/`targetLanguage` become the pair `providerStore` itself
 * persists (same storage keys, so an existing user's pick survives with no
 * `migrate`), and `turnDetectionMode` becomes the global turn mode
 * (`turnModeStore`; its one-time migration is plan 1e-3's, not this `S`'s).
 */
export interface LocalInferenceSettings {
  /** Per-direction model choices, keyed `src→tgt`. '' in any stage means auto. */
  selections: Selections;
  ttsSpeakerId: number;
  ttsSpeed: number;
  /** Edge TTS voice ShortName (e.g. 'en-US-AvaMultilingualNeural'), '' for auto-select. */
  edgeTtsVoice: string;
  vadThreshold: number;
  vadNegativeThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
  vadMaxSpeechDuration: number;
  /** true = Simple (default), false = Advanced. */
  useTemplateMode: boolean;
  /** Advanced-mode speaker prompt (default ''). */
  systemPrompt: string;
  /** Advanced-mode participant prompt (default '', empty = fall back to the speaker prompt). */
  participantSystemPrompt: string;
}

export const LOCAL_INFERENCE_DEFAULTS: LocalInferenceSettings = {
  selections: {},
  ttsSpeakerId: 0,
  ttsSpeed: 1.0,
  edgeTtsVoice: '',
  vadThreshold: 0.3,
  vadNegativeThreshold: 0,
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  vadMaxSpeechDuration: 30,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/**
 * Catalog-driven and independent of `s`, download state and the direction
 * already chosen (today's `getTranslationSourceLanguages`/`Target...`,
 * `src/lib/local-inference/modelManifest.ts`) — never `AUTO`, since
 * LocalInference has no language-detecting stage. `initial` matches today's
 * per-slice defaults (`ja` → `en`).
 */
export const localInferenceLanguages: Provider<LocalInferenceSettings, never, never>['languages'] = {
  sources: () => getTranslationSourceLanguages(),
  targets: (source) => getTranslationTargetLanguages(source),
  initial: () => ({ source: 'ja', target: 'en' }),
};

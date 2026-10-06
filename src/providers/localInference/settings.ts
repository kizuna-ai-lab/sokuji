import { identityWire } from '../../lib/language/wire';
import type { Provider } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import { getLocalInferenceLanguages, getLocalInferenceTargetLanguages } from '../../lib/local-inference/modelManifest';

/**
 * LocalInference's `S` (spec: "Settings — never secrets"). Today's
 * `LocalInferenceSettings` (`src/services/providers/LocalInferenceProviderConfig.ts`)
 * minus three fields that leave `S` entirely under the new contract:
 * `sourceLanguage`/`targetLanguage` become the one global pair `providerStore`
 * keeps (`settings.common.sourceLanguage`/`targetLanguage`, not under this
 * provider's keys), and `turnDetectionMode` becomes the global turn mode
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
  vadPreSpeechPadDuration: number;
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
  vadPreSpeechPadDuration: 0.8,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/**
 * The languages a speech-recognition model and a speech-synthesis model both
 * support, by base language (`getLocalInferenceLanguages`,
 * `src/lib/local-inference/modelManifest.ts`) — translation models do not
 * decide the list; they only pick the model for a chosen pair. The same list
 * serves sources and targets, the target list leaving out the chosen source.
 * Static: independent of `s`, download state and the network. Never `AUTO`,
 * since LocalInference has no language-detecting stage. `initial` matches
 * today's per-slice defaults (`ja` → `en`).
 */
export const localInferenceLanguages: Provider<LocalInferenceSettings, never, never>['languages'] = {
  sources: () => getLocalInferenceLanguages(),
  targets: (source) => getLocalInferenceTargetLanguages(source),
  initial: () => ({ source: 'ja', target: 'en' }),
  // No vendor: each engine turns the app code into its model's own form.
  wire: identityWire(),
};

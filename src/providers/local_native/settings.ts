import { identityWire } from '../../lib/language/wire';
import type { Provider } from '../../lib/provider/types';
import type { NativeDevice } from '../../lib/local-inference/native/nativeCatalog';
import type { Selections } from '../../lib/local-inference/selection/types';
import { getLocalInferenceLanguages, getLocalInferenceTargetLanguages } from '../../lib/local-inference/modelManifest';

/**
 * Local Native's `S`: the old slice's fields under their old names, so each
 * saved value is read under the same `settings.localNative.<field>` key, as
 * it is (#578 ruling 7). The pair and the turn mode are global now and left
 * out; `participantSystemPrompt` is LocalInference's rule for the reverse
 * direction, new here.
 */
export interface LocalNativeSettings {
  /** Per-direction model choices, keyed `src→tgt`. '' in any stage means auto; `variant` pins a quant. */
  selections: Selections;
  ttsSpeed: number;
  /** `builtin:<name>`, `custom:<id>`, or '' for the per-language default. One value for every TTS model. */
  ttsVoice: string;
  asrDevice: NativeDevice;
  translationDevice: NativeDevice;
  ttsDevice: NativeDevice;
  /** true = Simple (default), false = Advanced. */
  useTemplateMode: boolean;
  /** Advanced-mode speaker prompt (default ''). */
  systemPrompt: string;
  /** Advanced-mode prompt for the reverse direction (default '', empty = the speaker's). */
  participantSystemPrompt: string;
}

export const LOCAL_NATIVE_DEFAULTS: LocalNativeSettings = {
  selections: {},
  ttsSpeed: 1.0,
  ttsVoice: '',
  asrDevice: 'auto',
  translationDevice: 'auto',
  ttsDevice: 'auto',
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/**
 * The old descriptor's list (`getLocalInferenceLanguages`): the languages a
 * speech-recognition model and a speech-synthesis model both support. The
 * target list leaves out the chosen source. Never `AUTO`. `initial` matches
 * the old slice's defaults (`ja` → `en`).
 */
export const localNativeLanguages: Provider<LocalNativeSettings, never, never>['languages'] = {
  sources: () => getLocalInferenceLanguages(),
  targets: (source) => getLocalInferenceTargetLanguages(source),
  initial: () => ({ source: 'ja', target: 'en' }),
  // Each sidecar engine turns the app code into its model's own form.
  wire: identityWire(),
};

import { identityWire } from '../../lib/language/wire';
import type { LanguagePair, Provider } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import { getLocalInferenceLanguages, getLocalInferenceTargetLanguages } from '../../lib/local-inference/modelManifest';

export type NativeDevice = 'auto' | 'cpu' | 'gpu';

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
  vadThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
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
  vadThreshold: 0.3,
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/** What the native model UI edits: the picks, the devices and the voice. The old settings shell hands it the old slice, which has the same fields. */
export type NativeEngineSettings = Pick<LocalNativeSettings, 'selections' | 'asrDevice' | 'translationDevice' | 'ttsDevice' | 'ttsVoice'>;

/** The host's `settings` / `update` / pair, as `useWasmEngineAdapter`'s override is LocalInference's. */
export interface NativeEngineOverride {
  settings: NativeEngineSettings;
  update: (patch: Partial<NativeEngineSettings>) => void;
  pair: LanguagePair;
}

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

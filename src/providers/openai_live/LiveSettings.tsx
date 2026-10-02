import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { PresetVoiceField, presetVoice } from '../../components/providers/fields/PresetVoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { previewLiveVoice } from './preview';
import { LIVE_VOICES, liveLanguageName, liveLanguages, type LiveSettings as S } from './settings';

const VOICES = LIVE_VOICES.map(presetVoice);

/**
 * OpenAI Live's own settings (D18): what the old tab showed for it once the
 * pair, the key and the speech mode have their generic homes — its
 * instructions, previewed for the pair as `build` resolves them, and the
 * voice (choice 17), in the voice library with OpenAI's published samples
 * (preset voice preview). No model (it is fixed), no turn detection, no
 * noise reduction: the endpoint has none of them.
 */
export function LiveSettingsView({ settings, update, disabled = false, pair, preview: port }: SettingsProps<S>) {
  const initial = liveLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: liveLanguageName(source), target: liveLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <PresetVoiceField voices={VOICES} value={settings.voice} onChange={(voice) => update({ voice })} onPreview={previewLiveVoice} preview={port} disabled={disabled} />
    </>
  );
}

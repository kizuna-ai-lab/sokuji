import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { LIVE_VOICES, liveLanguageName, liveLanguages, type LiveSettings as S } from './settings';

/**
 * OpenAI Live's own settings (D18): what the old tab showed for it once the
 * pair, the key and the speech mode have their generic homes — its
 * instructions, previewed for the pair as `build` resolves them, and the
 * voice (choice 17). No model (it is fixed), no turn detection, no noise
 * reduction: the endpoint has none of them.
 */
export function LiveSettingsView({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const initial = liveLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: liveLanguageName(source), target: liveLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <VoiceField value={settings.voice} options={LIVE_VOICES} onChange={(voice) => update({ voice })} disabled={disabled} />
    </>
  );
}

import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { ModelConfigurationField } from '../../components/providers/fields/ModelConfigurationField';
import { ModelField } from '../../components/providers/fields/ModelField';
import { NoiseReductionField } from '../../components/providers/fields/NoiseReductionField';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { ReasoningEffortField } from './ReasoningEffortField';
import {
  effectiveRealtimeModel, NOISE_REDUCTIONS, realtimeLanguageName, realtimeLanguages, REALTIME_MAX_TOKENS_RANGE, REALTIME_VOICES, takesReasoning,
  type RealtimeSettings as S,
} from './settings';
import { TranscriptionField } from './TranscriptionField';

/**
 * OpenAI Realtime's own settings (D18), the old UI's OpenAI sections
 * (`ProviderSpecificSettings.tsx:2185-2282`) recomposed from the shared
 * fields in the old order (choice 17): its instructions, the voice, the
 * model — the effective one, the same function `build` calls — the
 * transcript, the noise reduction, the max tokens (no temperature: ruling
 * 6), and the reasoning effort for a `gpt-realtime-2*` model. The
 * automatic-detection knobs are its `TurnDetection`; the transport stays
 * unshown until the WebRTC step (ruling 12).
 */
export function RealtimeSettingsView({ settings, update, disabled = false, pair, models = [] }: SettingsProps<S>) {
  const model = effectiveRealtimeModel(settings, models);
  const initial = realtimeLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: realtimeLanguageName(source), target: realtimeLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <VoiceField value={settings.voice} options={REALTIME_VOICES} onChange={(voice) => update({ voice })} disabled={disabled} />
      <ModelField value={model} models={models} onChange={(m) => update({ model: m })} disabled={disabled} />
      <TranscriptionField model={settings.transcriptModel} keywords={settings.transcriptKeywords} onChange={update} disabled={disabled} />
      <NoiseReductionField value={settings.noiseReduction} options={NOISE_REDUCTIONS} onChange={(noiseReduction) => update({ noiseReduction })} disabled={disabled} />
      <ModelConfigurationField maxTokens={settings.maxTokens} maxTokensRange={REALTIME_MAX_TOKENS_RANGE} onChange={({ maxTokens }) => { if (maxTokens !== undefined) update({ maxTokens }); }} disabled={disabled} />
      {takesReasoning(model) && <ReasoningEffortField value={settings.reasoningEffort} onChange={(reasoningEffort) => update({ reasoningEffort })} disabled={disabled} />}
    </>
  );
}

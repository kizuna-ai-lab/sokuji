import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { ModelConfigurationField } from '../../components/providers/fields/ModelConfigurationField';
import { ModelField } from '../../components/providers/fields/ModelField';
import { NoiseReductionField } from '../../components/providers/fields/NoiseReductionField';
import { PresetVoiceField, presetVoice, presetVoiceSummary } from '../../components/providers/fields/PresetVoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { previewRealtimeVoice } from './preview';
import { ReasoningEffortField } from './ReasoningEffortField';
import {
  effectiveRealtimeModel, NOISE_REDUCTIONS, realtimeLanguageName, realtimeLanguages, realtimeParticipantVoice, realtimeSpeakerVoice, REALTIME_MAX_TOKENS_RANGE, REALTIME_VOICES, takesReasoning,
  type RealtimeSettings as S,
} from './settings';
import { TranscriptionField } from './TranscriptionField';

const VOICES = REALTIME_VOICES.map(presetVoice);

/** Each leg's voice as its run speaks it (`config.ts`). */
export const RealtimeVoiceSummary = presetVoiceSummary<S>(REALTIME_VOICES, ({ settings, leg }) =>
  leg === 'participant' ? realtimeParticipantVoice(settings) : realtimeSpeakerVoice(settings));

/**
 * OpenAI Realtime's own settings (D18), the old UI's OpenAI sections
 * (`ProviderSpecificSettings.tsx:2185-2282`) recomposed from the shared
 * fields in the old order (choice 17): its instructions, the voice — in the
 * voice library with OpenAI's published samples (preset voice preview) — the
 * model — the effective one, the same function `build` calls — the
 * transcript, the noise reduction, the max tokens (no temperature: ruling
 * 6), and the reasoning effort for a `gpt-realtime-2*` model. The
 * automatic-detection knobs are its `TurnDetection`; there is no transport
 * to show (WebSocket only, 2026-09-29).
 */
export function RealtimeSettingsView({ settings, update, disabled = false, pair, models = [], participantSpeaks = false, preview: port }: SettingsProps<S>) {
  const model = effectiveRealtimeModel(settings, models);
  const initial = realtimeLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: realtimeLanguageName(source), target: realtimeLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <PresetVoiceField
        voices={VOICES} value={settings.voice} onChange={(voice) => update({ voice })} onPreview={previewRealtimeVoice} preview={port} disabled={disabled}
        // The published samples are one clip per voice: the second row auditions the same way.
        participant={participantSpeaks ? { value: settings.participantVoice, effective: realtimeParticipantVoice(settings), onChange: (participantVoice) => update({ participantVoice }) } : undefined}
      />
      <ModelField value={model} models={models} onChange={(m) => update({ model: m })} disabled={disabled} />
      <TranscriptionField model={settings.transcriptModel} keywords={settings.transcriptKeywords} onChange={update} disabled={disabled} />
      <NoiseReductionField value={settings.noiseReduction} options={NOISE_REDUCTIONS} onChange={(noiseReduction) => update({ noiseReduction })} disabled={disabled} />
      <ModelConfigurationField maxTokens={settings.maxTokens} maxTokensRange={REALTIME_MAX_TOKENS_RANGE} onChange={({ maxTokens }) => { if (maxTokens !== undefined) update({ maxTokens }); }} disabled={disabled} />
      {takesReasoning(model) && <ReasoningEffortField value={settings.reasoningEffort} onChange={(reasoningEffort) => update({ reasoningEffort })} disabled={disabled} />}
    </>
  );
}

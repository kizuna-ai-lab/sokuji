import { useTranslation } from 'react-i18next';
import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { ModelConfigurationField } from '../../components/providers/fields/ModelConfigurationField';
import { ModelField } from '../../components/providers/fields/ModelField';
import { PresetVoiceField, presetVoice, presetVoiceSummary } from '../../components/providers/fields/PresetVoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { previewGeminiVoice } from './preview';
import {
  effectiveGeminiModel, geminiCredentials, geminiLanguageName, geminiLanguages, geminiParticipantVoice, geminiSpeakerVoice, GEMINI_MAX_TOKENS_RANGE, GEMINI_TEMPERATURE_RANGE, GEMINI_VOICES,
  isGeminiTranslateModel, type GeminiSettings as S,
} from './settings';

const VOICES = GEMINI_VOICES.map(presetVoice);

/** Each leg's voice as its run speaks it, on a dialogue model only: Live Translate has none to choose (`config.ts`). */
export const GeminiVoiceSummary = presetVoiceSummary<S>(GEMINI_VOICES, ({ settings, models, leg }) =>
  isGeminiTranslateModel(effectiveGeminiModel(settings, models ?? [])) ? undefined : leg === 'participant' ? geminiParticipantVoice(settings) : geminiSpeakerVoice(settings));

/**
 * Gemini's own settings (D18), the old UI's Gemini sections
 * (`ProviderSpecificSettings.tsx:2185-2287`) recomposed from shared
 * fields in the old order: its instructions (ruling 4), the voice, the
 * model, the model configuration. The model shown is the effective one —
 * the same function `build` calls — and Live Translate hides what it
 * ignores (choice 22). The VAD knobs are its `TurnDetection`. The voice is
 * the voice library; a preview reads the target's sentence on the saved key
 * (decision 2026-10-03).
 */
export function GeminiSettingsView({ settings, update, disabled = false, pair, models = [], account, participantSpeaks = false, preview: port }: SettingsProps<S>) {
  const { t } = useTranslation();
  const model = effectiveGeminiModel(settings, models);
  const dialogue = !isGeminiTranslateModel(model);
  const initial = geminiLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: geminiLanguageName(source), target: geminiLanguageName(target) });
  const key = account ? geminiCredentials.read(account.credentials, account.auth) : undefined;
  const apiKey = key && 'apiKey' in key ? key.apiKey : '';
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      {dialogue && (
        <PresetVoiceField
          voices={VOICES}
          value={settings.voice}
          onChange={(voice) => update({ voice })}
          onPreview={(voice, signal) => previewGeminiVoice({ voice, target, apiKey }, signal)}
          previewUnavailableReason={apiKey ? undefined : t('settings.voicePreviewNeedsKey', 'Save your API key to preview voices.')}
          note={t('settings.geminiVoicePreviewNote', 'Previewing a voice synthesizes one short sentence with your Gemini API key, which Google may bill.')}
          preview={port}
          disabled={disabled}
          participant={participantSpeaks ? {
            value: settings.participantVoice,
            effective: geminiParticipantVoice(settings),
            onChange: (participantVoice) => update({ participantVoice }),
            // It reads the other person's words to me: my language's sentence.
            onPreview: (voice, signal) => previewGeminiVoice({ voice, target: source, apiKey }, signal),
          } : undefined}
        />
      )}
      <ModelField value={model} models={models} onChange={(m) => update({ model: m })} disabled={disabled} />
      {dialogue && (
        <ModelConfigurationField
          temperature={settings.temperature}
          maxTokens={settings.maxTokens}
          temperatureRange={GEMINI_TEMPERATURE_RANGE}
          maxTokensRange={GEMINI_MAX_TOKENS_RANGE}
          onChange={update}
          disabled={disabled}
        />
      )}
    </>
  );
}

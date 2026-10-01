import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { ModelConfigurationField } from '../../components/providers/fields/ModelConfigurationField';
import { ModelField } from '../../components/providers/fields/ModelField';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import {
  effectiveGeminiModel, geminiLanguageName, geminiLanguages, GEMINI_MAX_TOKENS_RANGE, GEMINI_TEMPERATURE_RANGE, GEMINI_VOICES,
  isGeminiTranslateModel, type GeminiSettings as S,
} from './settings';

/**
 * Gemini's own settings (D18), the old UI's Gemini sections
 * (`ProviderSpecificSettings.tsx:2185-2287`) recomposed from shared
 * fields in the old order: its instructions (ruling 4), the voice, the
 * model, the model configuration. The model shown is the effective one —
 * the same function `build` calls — and Live Translate hides what it
 * ignores (choice 22). The VAD knobs are its `TurnDetection`.
 */
export function GeminiSettingsView({ settings, update, disabled = false, pair, models = [] }: SettingsProps<S>) {
  const model = effectiveGeminiModel(settings, models);
  const dialogue = !isGeminiTranslateModel(model);
  const initial = geminiLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: geminiLanguageName(source), target: geminiLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      {dialogue && <VoiceField value={settings.voice} options={GEMINI_VOICES} onChange={(voice) => update({ voice })} disabled={disabled} />}
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

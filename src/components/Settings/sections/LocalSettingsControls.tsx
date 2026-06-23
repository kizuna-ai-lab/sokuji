/**
 * Presentational settings controls shared by the local providers (LOCAL_INFERENCE
 * + LOCAL_NATIVE). Pure: props in, onChange out — no store coupling, so each
 * provider passes its own slice. Reuses the existing settings-section / setting-item
 * / option-button / slider classes and the existing i18n keys.
 *
 * Currently consumed by NativeModelManagementSection's host (renderLocalNativeSettings).
 * LOCAL_INFERENCE still has equivalent inline blocks in ProviderSpecificSettings —
 * migrating those to these components is a proposed follow-up refactor.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';

export type SpeechMode = 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

// ─── TTS speed ───────────────────────────────────────────────────────────────

export const TtsSpeedControl: React.FC<{
  value: number;
  onChange: (speed: number) => void;
  disabled: boolean;
  /** Extra rows (e.g. a voice/speaker picker) rendered under the speed slider. */
  children?: React.ReactNode;
}> = ({ value, onChange, disabled, children }) => {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>{t('settings.ttsSettings', 'TTS Settings')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.ttsSpeed', 'Speech Speed')}</span>
          <span className="setting-value">{value.toFixed(1)}x</span>
        </div>
        <input
          type="range" min="0.5" max="2.0" step="0.1" value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="slider" disabled={disabled}
        />
      </div>
      {children}
    </div>
  );
};

// ─── Speech mode (turn detection) ────────────────────────────────────────────

export const SpeechModeControl: React.FC<{
  value: SpeechMode;
  onChange: (mode: SpeechMode) => void;
  disabled: boolean;
  /** Tooltip body. Defaults to the local-VAD description; providers with a
   *  different turn-detection backend (gemini, ast2) pass their own. */
  tooltip?: string;
}> = ({ value, onChange, disabled, tooltip }) => {
  const { t } = useTranslation();
  const options: Array<[SpeechMode, string]> = [
    ['Auto', t('settings.auto')],
    ['Push-to-Talk', t('settings.pushToTalk')],
    ['Push-to-Translate', t('settings.pushToTranslate')],
  ];
  const tooltipContent = tooltip ?? `${t('settings.localInferenceTurnDetectionTooltip', 'Auto: local Voice Activity Detection automatically detects speech. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.')}\n\n${t('settings.speechModeAppliesTo', 'Applies to your voice. Participant audio always uses semantic VAD.')}`;
  return (
    <div className="settings-section turn-detection-section" id="turn-detection-section">
      <h2>
        {t('settings.speechMode')}
        <Tooltip content={tooltipContent} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="turn-detection-options">
          {options.map(([mode, label]) => (
            <button
              key={mode}
              className={`option-button ${value === mode ? 'active' : ''}`}
              onClick={() => { if (value !== mode) onChange(mode); }}
              disabled={disabled}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── VAD sliders ─────────────────────────────────────────────────────────────

export interface VadValues {
  vadThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
}

export const VadControl: React.FC<{
  values: VadValues;
  onChange: (patch: Partial<VadValues>) => void;
  disabled: boolean;
}> = ({ values, onChange, disabled }) => {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">{helpIcon}</Tooltip>
      </h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadThreshold', 'Speech Threshold')}
            <Tooltip content={t('settings.vadThresholdTooltip', 'Speech detection sensitivity. Higher values require louder/clearer speech to trigger recognition. Lower values are more sensitive to quiet speech.')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{values.vadThreshold.toFixed(2)}</span>
        </div>
        <input
          type="range" min="0.1" max="0.95" step="0.05" value={values.vadThreshold}
          onChange={(e) => onChange({ vadThreshold: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadMinSilenceDuration', 'Min Silence Duration')}
            <Tooltip content={t('settings.vadMinSilenceDurationTooltip', 'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{values.vadMinSilenceDuration.toFixed(2)}s</span>
        </div>
        <input
          type="range" min="0.05" max="2.0" step="0.05" value={values.vadMinSilenceDuration}
          onChange={(e) => onChange({ vadMinSilenceDuration: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
      <div className="setting-item">
        <div className="setting-label">
          <span>
            {t('settings.vadMinSpeechDuration', 'Min Speech Duration')}
            <Tooltip content={t('settings.vadMinSpeechDurationTooltip', 'Minimum speech duration to consider as valid speech. Filters out very short sounds like clicks or coughs.')} position="top">{inlineHelpIcon}</Tooltip>
          </span>
          <span className="setting-value">{values.vadMinSpeechDuration.toFixed(2)}s</span>
        </div>
        <input
          type="range" min="0.05" max="1.0" step="0.05" value={values.vadMinSpeechDuration}
          onChange={(e) => onChange({ vadMinSpeechDuration: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
    </div>
  );
};

// ─── Translation prompt (Qwen-family only) ───────────────────────────────────

export const TranslationPromptControl: React.FC<{
  useTemplateMode: boolean;
  systemPrompt: string;
  /** Resolved Simple-mode prompt, shown in the preview. */
  preview: string;
  /** False when the active model can't take a custom prompt (e.g. Opus-MT). */
  supported: boolean;
  disabled: boolean;
  /**
   * Advanced-mode participant (reverse-direction) prompt. Omit entirely for
   * providers without a participant path (LOCAL_NATIVE) — the textarea is then
   * hidden. Empty string means "configured but blank" → falls back to the speaker
   * prompt at resolve time (LOCAL_INFERENCE).
   */
  participantSystemPrompt?: string;
  /** Unique DOM id for the preview region (distinct per provider). */
  previewId?: string;
  onChange: (patch: { useTemplateMode?: boolean; systemPrompt?: string; participantSystemPrompt?: string }) => void;
}> = ({ useTemplateMode, systemPrompt, preview, supported, disabled, participantSystemPrompt, previewId = 'local-prompt-preview-content', onChange }) => {
  const { t } = useTranslation();
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const showParticipant = participantSystemPrompt !== undefined;
  return (
    <div
      className={`settings-section system-instructions-section ${!supported ? 'disabled' : ''}`}
      id="local-translation-prompt-section"
      aria-disabled={!supported}
    >
      <h2>
        {t('settings.localTranslationPrompt', 'Translation Prompt')}
        <Tooltip content={t('settings.localTranslationPromptTooltip', 'Customize how the local translation model is instructed. Only applies to Qwen-family models.')} position="top">{helpIcon}</Tooltip>
      </h2>

      {!supported && (
        <div className="setting-item">
          <span className="setting-description">
            {t('settings.localPromptUnsupported', 'Current translation model does not support custom prompts. Switch to a Qwen-family model in Model Management to enable.')}
          </span>
        </div>
      )}

      <div className="setting-item">
        <div className="turn-detection-options">
          <button
            className={`option-button ${useTemplateMode ? 'active' : ''}`}
            onClick={() => onChange({ useTemplateMode: true })}
            disabled={disabled || !supported}
          >
            {t('settings.simple')}
          </button>
          <button
            className={`option-button ${!useTemplateMode ? 'active' : ''}`}
            onClick={() => onChange({ useTemplateMode: false })}
            disabled={disabled || !supported}
          >
            {t('settings.advanced')}
          </button>
        </div>
      </div>

      {useTemplateMode ? (
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.preview')}</span>
            <button
              type="button" className="preview-toggle"
              aria-expanded={previewExpanded} aria-controls={previewId}
              onClick={() => setPreviewExpanded(!previewExpanded)} disabled={disabled}
            >
              {previewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
          {previewExpanded && (
            <div id={previewId} className="system-instructions-preview">
              <div className="preview-content">{preview}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="setting-item">
            <textarea
              className="system-instructions"
              placeholder={t('settings.enterCustomInstructions')}
              value={systemPrompt}
              onChange={(e) => onChange({ systemPrompt: e.target.value })}
              disabled={disabled || !supported}
            />
          </div>
          {showParticipant && (
            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.participantInstructions', 'Participant Instructions')}
                  <Tooltip content={t('settings.participantInstructionsTooltip', 'System instructions for participant audio translation. Leave empty to use main instructions.')} position="top">{inlineHelpIcon}</Tooltip>
                </span>
              </div>
              <textarea
                className="system-instructions"
                placeholder={t('settings.participantInstructionsPlaceholder', 'Leave empty to use main instructions')}
                value={participantSystemPrompt}
                onChange={(e) => onChange({ participantSystemPrompt: e.target.value })}
                disabled={disabled || !supported}
              />
            </div>
          )}
          <div className="setting-item">
            <span className="setting-description">
              {t('settings.localPromptNoThinkHint', 'For Qwen3 models, ` /no_think` will be automatically appended.')}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

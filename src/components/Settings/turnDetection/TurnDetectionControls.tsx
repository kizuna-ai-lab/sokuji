/**
 * The one turn detection control set, bound to `useTurnDetectionStore`: the same knobs for every recognizer that
 * uses the app's detector. What a surface shows follows its `TurnDetectionScope` (`turnDetectionScope`): nothing when
 * no leg takes our settings, Normal / Smart only when an automatic leg runs Smart Turn.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import { SMART_TURN_TOTAL_BYTES, useSmartTurnPhase, useSmartTurnStore } from '../../../stores/smartTurnStore';
import { useTurnDetectionStore } from '../../../stores/turnDetectionStore';
import { SMART_TURN_MAX_WAIT_MIN, effectiveCheckAfter, type VadEndOfTurn } from '../../../lib/turn/smartTurn';
import { TURN_DETECTION_DEFAULTS, TURN_DETECTION_RANGES, type TurnDetectionSettings } from '../../../lib/turn/turnDetectionSettings';
import type { TurnDetectionScope } from '../../../lib/turn/turnDetection';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import '../sections/LocalSettingsControls.scss';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;
const inlineHelpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

// ─── End of turn (Normal / Smart) ────────────────────────────────────────────

export const EndOfTurnControl: React.FC<{
  value: VadEndOfTurn;
  onChange: (next: VadEndOfTurn) => void;
  disabled: boolean;
  /** While the Smart Turn model downloads. */
  download?: { done: number; total: number };
  /** Why the last download failed. */
  error?: string | null;
  onRetry?: () => void;
  /** The model is on disk and may be deleted. */
  deletable?: { bytes: number; onDelete: () => void };
}> = ({ value, onChange, disabled, download, error, onRetry, deletable }) => {
  const { t } = useTranslation();
  const options: Array<[VadEndOfTurn, string]> = [
    ['normal', t('settings.normal', 'Normal')],
    ['smart', t('settings.smartTurn', 'Smart')],
  ];
  return (
    <>
      <div className="setting-item">
        <div className="turn-detection-options">
          {options.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`option-button ${value === mode ? 'active' : ''}`}
              aria-pressed={value === mode}
              onClick={() => onChange(mode)}
              disabled={disabled || download !== undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {deletable && (
        <div className="setting-item end-of-turn__status end-of-turn__status--line">
          <span className="end-of-turn__text">
            {t('settings.smartTurnModelOnDisk', 'Smart Turn model: {{size}}', { size: formatBytes(deletable.bytes) })}
          </span>
          <button type="button" className="end-of-turn__action" onClick={deletable.onDelete} disabled={disabled}>
            <Trash2 size={12} />
            <span>{t('models.delete', 'Delete')}</span>
          </button>
        </div>
      )}
      {download && (
        <div className="setting-item end-of-turn__status">
          <div className="end-of-turn__progress-bar">
            <div className="end-of-turn__progress-fill" style={{ width: `${(download.done / download.total) * 100}%` }} />
          </div>
          <span className="end-of-turn__text">
            {t('settings.smartTurnDownloading', 'Downloading the Smart Turn model: {{done}} of {{total}}', {
              done: formatBytes(download.done),
              total: formatBytes(download.total),
            })}
          </span>
        </div>
      )}
      {error && (
        <div className="setting-item end-of-turn__status end-of-turn__status--line">
          <span className="end-of-turn__error">
            {t('settings.smartTurnDownloadFailed', 'Smart Turn model download failed: {{error}}', { error })}
          </span>
          <button type="button" className="end-of-turn__action" onClick={onRetry} disabled={disabled}>
            <RotateCw size={12} />
            <span>{t('common.retry', 'Retry')}</span>
          </button>
        </div>
      )}
    </>
  );
};

// ─── Sliders ─────────────────────────────────────────────────────────────────

const SLIDER_FIELDS = ['threshold', 'negativeThreshold', 'minSilence', 'minSpeech', 'prePad', 'maxSpeech', 'smartTurnCheckAfter', 'smartTurnThreshold'] as const;

/** What a session will run: Smart is chosen, an automatic leg is on a shared model, and the model is on disk (or not yet known). */
function useSmartOn(scope: TurnDetectionScope): boolean {
  const phase = useSmartTurnPhase();
  const endOfTurn = useTurnDetectionStore((s) => s.settings.endOfTurn);
  return scope.smartOffered && endOfTurn === 'smart' && (phase === 'ready' || phase === 'unknown');
}

/** Normal / Smart over the store: turning Smart on downloads the model first and lifts a Max Wait under 0.3 s to 0.3 s. */
function EndOfTurn({ smart, disabled }: { smart: boolean; disabled: boolean }) {
  const phase = useSmartTurnPhase();
  const downloadedBytes = useSmartTurnStore((s) => s.downloadedBytes);
  const error = useSmartTurnStore((s) => s.error);
  const endOfTurn = useTurnDetectionStore((s) => s.settings.endOfTurn);

  const enableSmart = async () => {
    await useSmartTurnStore.getState().download();
    if (useSmartTurnStore.getState().phase !== 'ready') return;
    // Read when the download ends: Max Wait may have moved meanwhile.
    const { minSilence } = useTurnDetectionStore.getState().settings;
    useTurnDetectionStore.getState().update(
      minSilence < SMART_TURN_MAX_WAIT_MIN ? { endOfTurn: 'smart', minSilence: SMART_TURN_MAX_WAIT_MIN } : { endOfTurn: 'smart' },
    );
  };
  const removeModel = () => {
    // `remove()` awaits ModelManager; a storage failure must reach the diagnostic log, not become an unhandled rejection.
    useSmartTurnStore.getState().remove().catch((err: unknown) => {
      reportWarning('SmartTurn', `Smart Turn model delete failed: ${describeCause(err)}`, {
        cause: err,
        dedupeKey: 'smart-turn:delete',
      });
    });
  };
  const choose = (next: VadEndOfTurn) => {
    if (next === 'smart') {
      if (!smart) void enableSmart();
    } else {
      if (phase === 'error') useSmartTurnStore.getState().dismiss();
      if (endOfTurn !== 'normal') useTurnDetectionStore.getState().update({ endOfTurn: 'normal' });
    }
  };
  return (
    <EndOfTurnControl
      value={smart ? 'smart' : 'normal'}
      onChange={choose}
      disabled={disabled}
      download={phase === 'downloading' ? { done: downloadedBytes, total: SMART_TURN_TOTAL_BYTES } : undefined}
      error={phase === 'error' ? error : null}
      onRetry={() => { void enableSmart(); }}
      deletable={smart && phase === 'ready' ? { bytes: SMART_TURN_TOTAL_BYTES, onDelete: removeModel } : undefined}
    />
  );
}

function Slider({ label, tooltip, value, shown, field, extra, disabled, min, max }: {
  label: string;
  tooltip: string;
  value: number;
  shown: string;
  field: keyof TurnDetectionSettings;
  extra?: React.ReactNode;
  disabled: boolean;
  min?: number;
  max?: number;
}) {
  const range = TURN_DETECTION_RANGES[field as keyof typeof TURN_DETECTION_RANGES];
  const update = useTurnDetectionStore((s) => s.update);
  return (
    <div className="setting-item">
      <div className="setting-label">
        <span>
          {label}
          <Tooltip content={tooltip} position="top">{inlineHelpIcon}</Tooltip>
        </span>
        <span className="setting-value">{shown}</span>
      </div>
      <input
        type="range" min={min ?? range.min} max={max ?? range.max} step={range.step} value={value}
        onChange={(e) => update({ [field]: parseFloat(e.target.value) })}
        className="slider" disabled={disabled}
      />
      {extra}
    </div>
  );
}

/**
 * The turn detection block, heading included: the Provider tab and the transcription stage's line-up card draw it,
 * where the Speech section's summary links. Renders nothing when no leg takes our settings.
 */
export function TurnDetectionControls({ scope, disabled = false }: { scope: TurnDetectionScope; disabled?: boolean }) {
  const { t } = useTranslation();
  const td = useTurnDetectionStore((s) => s.settings);
  const restoreDefaults = useTurnDetectionStore((s) => s.restoreDefaults);
  const smart = useSmartOn(scope);
  if (!scope.shown) return null;

  const checkAfterMax = Math.max(
    TURN_DETECTION_RANGES.smartTurnCheckAfter.min,
    effectiveCheckAfter(TURN_DETECTION_RANGES.smartTurnCheckAfter.max, td.minSilence) ?? 0,
  );
  const checkAfterUsed = smart ? effectiveCheckAfter(td.smartTurnCheckAfter, td.minSilence) : null;
  // Only the sliders on show decide whether Restore defaults appears.
  const offDefault = SLIDER_FIELDS.some((f) => (smart || (f !== 'smartTurnCheckAfter' && f !== 'smartTurnThreshold')) && td[f] !== TURN_DETECTION_DEFAULTS[f]);

  return (
    <div className="settings-section">
      <h2>
        {t('settings.vadSettings', 'VAD Settings')}
        <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">{helpIcon}</Tooltip>
        {offDefault && (
          <button type="button" className="vad-settings__restore" onClick={restoreDefaults} disabled={disabled}>
            <RotateCcw size={12} />
            <span>{t('settings.vadRestoreDefaults', 'Restore defaults')}</span>
          </button>
        )}
      </h2>
      {scope.smartOffered && <EndOfTurn smart={smart} disabled={disabled} />}
      {smart && (
        <>
          <Slider
            label={t('settings.smartTurnCheckAfter', 'Turn Check After')}
            tooltip={t('settings.smartTurnCheckAfterTooltip', 'How long a pause lasts before Smart Turn checks whether you have finished speaking. If you have, the segment ends at once instead of waiting for Max Wait.')}
            field="smartTurnCheckAfter" max={checkAfterMax} value={Math.min(td.smartTurnCheckAfter, checkAfterMax)}
            shown={checkAfterUsed === null ? '—' : `${checkAfterUsed.toFixed(2)}s`} disabled={disabled}
          />
          <Slider
            label={t('settings.smartTurnThreshold', 'Turn Threshold')}
            tooltip={t('settings.smartTurnThresholdTooltip', 'How sure Smart Turn must be that you have finished before it ends the segment. Lower values end more segments early, but also cut more pauses in the middle of a sentence.')}
            field="smartTurnThreshold" value={td.smartTurnThreshold} shown={td.smartTurnThreshold.toFixed(2)} disabled={disabled}
          />
        </>
      )}
      <Slider
        label={t('settings.vadThreshold', 'Speech Threshold')}
        tooltip={t('settings.vadThresholdTooltip', 'Speech detection sensitivity. Higher values require louder/clearer speech to trigger recognition. Lower values are more sensitive to quiet speech.')}
        field="threshold" value={td.threshold} shown={td.threshold.toFixed(2)} disabled={disabled}
      />
      <Slider
        label={t('settings.vadNegativeThreshold', 'Silence Threshold')}
        tooltip={t('settings.vadNegativeThresholdTooltip', 'Probability below which silence starts counting toward the end of a segment. Auto keeps it 0.15 under the VAD Threshold. It never applies above the VAD Threshold — that would stop segments from ever ending.')}
        field="negativeThreshold" max={td.threshold} value={Math.min(td.negativeThreshold, td.threshold)}
        // Show what the session will actually use: it never applies above the speech threshold.
        shown={td.negativeThreshold === 0 ? t('settings.vadNegativeThresholdAuto', 'Auto') : Math.min(td.negativeThreshold, td.threshold).toFixed(2)}
        disabled={disabled}
      />
      <Slider
        label={smart ? t('settings.smartTurnMaxWait', 'Max Wait') : t('settings.vadMinSilenceDuration', 'Min Silence Duration')}
        tooltip={smart
          ? t('settings.smartTurnMaxWaitTooltip', 'The longest silence before a segment ends when Smart Turn has not ended it first.')
          : t('settings.vadMinSilenceDurationTooltip', 'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.')}
        field="minSilence" min={smart ? SMART_TURN_MAX_WAIT_MIN : undefined} value={td.minSilence} shown={`${td.minSilence.toFixed(2)}s`} disabled={disabled}
      />
      <Slider
        label={t('settings.vadMinSpeechDuration', 'Min Speech Duration')}
        tooltip={t('settings.vadMinSpeechDurationTooltip', 'Minimum speech duration to consider as valid speech. Filters out very short sounds like clicks or coughs.')}
        field="minSpeech" value={td.minSpeech} shown={`${td.minSpeech.toFixed(2)}s`} disabled={disabled}
      />
      <Slider
        label={t('settings.vadPreSpeechPadDuration', 'Pre-Speech Padding')}
        tooltip={t('settings.vadPreSpeechPadDurationTooltip', 'Audio kept from just before speech is detected, so the first sound of a sentence is not cut off. Longer values also pass more of the noise before you speak to recognition.')}
        field="prePad" value={td.prePad} shown={`${td.prePad.toFixed(2)}s`} disabled={disabled}
      />
      {/* Whole seconds: this dial is tens of seconds wide, and "30.00s" reads as false precision. 40, not 60: past it the
          slider would only promise what no engine delivers (workers/_shared/max-speech-frames.ts). */}
      <Slider
        label={t('settings.vadMaxSpeechDuration', 'Max Speech Duration')}
        tooltip={t('settings.vadMaxSpeechDurationTooltip', 'Longest a single speech segment can run before it is split. Some models split sooner, at the longest segment they transcribe correctly.')}
        field="maxSpeech" value={td.maxSpeech} shown={`${td.maxSpeech}s`} disabled={disabled}
        extra={scope.limitSeconds !== undefined && (
          <div className="turn-detection__limit-note">
            {t('settings.turnDetectionLimitNote', 'This model splits utterances longer than {{seconds}} s.', { seconds: scope.limitSeconds })}
          </div>
        )}
      />
    </div>
  );
}

/**
 * One line: the heading and the min-silence label with the value formatted as the slider shows it. Text only:
 * `TurnDetectionHelp` carries the heading's tooltip, so the Speech section can place it as a sibling of its link
 * button instead of nesting it inside — a click on the trigger must not also navigate.
 */
export function TurnDetectionSummary({ scope }: { scope: TurnDetectionScope }) {
  const { t } = useTranslation();
  const td = useTurnDetectionStore((s) => s.settings);
  const smart = useSmartOn(scope);
  if (!scope.shown) return null;
  const heading = t('settings.vadSettings', 'VAD Settings');
  const seconds = `${td.minSilence.toFixed(2)}s`;
  if (smart && effectiveCheckAfter(td.smartTurnCheckAfter, td.minSilence) !== null) {
    return <>{`${heading} · ${t('settings.smartTurn', 'Smart')} · ${t('settings.smartTurnMaxWait', 'Max Wait')} ${seconds}`}</>;
  }
  return <>{`${heading} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${seconds}`}</>;
}

/** The heading's tooltip, for the Speech section's row; nothing when the summary shows nothing. */
export function TurnDetectionHelp({ scope }: { scope: TurnDetectionScope }) {
  const { t } = useTranslation();
  if (!scope.shown) return null;
  return (
    <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">
      {inlineHelpIcon}
    </Tooltip>
  );
}

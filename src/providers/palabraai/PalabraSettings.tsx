import { useTranslation } from 'react-i18next';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import type { SettingsProps } from '../../lib/provider/types';
import { DESIRED_QUEUE_RANGE, effectiveQueue, MAX_QUEUE_RANGE, maxQueueFloor, PALABRA_VOICES, type PalabraSettings as S, type PalabraVoice } from './settings';

/** An Enabled / Disabled pair, as the old block drew each of its three switches (`ProviderSpecificSettings.tsx:1341-1382, 1446-1461`). */
function OnOff({ label, value, onChange, disabled }: { label: string; value: boolean; onChange(value: boolean): void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="turn-detection-options" role="group" aria-label={label}>
      <button type="button" className={`option-button ${value ? 'active' : ''}`} onClick={() => onChange(true)} disabled={disabled}>
        {t('settings.enabled', 'Enabled')}
      </button>
      <button type="button" className={`option-button ${!value ? 'active' : ''}`} onClick={() => onChange(false)} disabled={disabled}>
        {t('settings.disabled', 'Disabled')}
      </button>
    </div>
  );
}

/**
 * Palabra AI's own settings (D18): the old UI's Palabra sections
 * (`ProviderSpecificSettings.tsx:1296-1463`) in their old order — the voice
 * (the shared `VoiceField`), speech processing, and the audio buffer. The
 * silence threshold is its `TurnDetection`; the pair is the generic
 * section's; the credentials and their mode the credential form's. The
 * buffer shows what a session asks for: the max slider's floor follows the
 * target, and a stored max not above it shows raised (ruling 10). The three
 * English-only tooltips are gone (ruling 10); no new locale key.
 */
export function PalabraSettingsView({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const queue = effectiveQueue(settings);
  const splitter = t('settings.sentenceSplitter', 'Sentence Splitter');
  const partials = t('settings.translatePartialTranscriptions', 'Translate Partial Transcriptions');
  const desired = t('settings.desiredQueueLevel', 'Target Audio Buffer');
  const max = t('settings.maxQueueLevel', 'Max Audio Buffer');
  const tempo = t('settings.autoTempo', 'Adaptive Speech Speed');
  return (
    <>
      <VoiceField value={settings.voiceId} options={PALABRA_VOICES} onChange={(voiceId) => update({ voiceId: voiceId as PalabraVoice })} disabled={disabled} />
      <div className="settings-section">
        <h2>{t('settings.speechProcessing', 'Speech Processing')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{splitter}</span>
          </div>
          <OnOff label={splitter} value={settings.sentenceSplitterEnabled} onChange={(sentenceSplitterEnabled) => update({ sentenceSplitterEnabled })} disabled={disabled} />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{partials}</span>
          </div>
          <OnOff label={partials} value={settings.translatePartialTranscriptions} onChange={(translatePartialTranscriptions) => update({ translatePartialTranscriptions })} disabled={disabled} />
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.queueConfiguration', 'Audio Buffer Configuration')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{desired}</span>
            <span className="setting-value">{(queue.desiredMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range" aria-label={desired}
            min={DESIRED_QUEUE_RANGE.min} max={DESIRED_QUEUE_RANGE.max} step={DESIRED_QUEUE_RANGE.step}
            value={queue.desiredMs}
            onChange={(e) => update({ desiredQueueLevelMs: parseInt(e.target.value, 10) })}
            className="slider" disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{max}</span>
            <span className="setting-value">{(queue.maxMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range" aria-label={max}
            min={maxQueueFloor(queue.desiredMs)} max={MAX_QUEUE_RANGE.max} step={MAX_QUEUE_RANGE.step}
            value={queue.maxMs}
            onChange={(e) => update({ maxQueueLevelMs: parseInt(e.target.value, 10) })}
            className="slider" disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{tempo}</span>
          </div>
          <OnOff label={tempo} value={settings.autoTempo} onChange={(autoTempo) => update({ autoTempo })} disabled={disabled} />
        </div>
      </div>
    </>
  );
}

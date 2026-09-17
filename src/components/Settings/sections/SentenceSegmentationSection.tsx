import React from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Download, Trash2, AlertTriangle } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import useSettingsStore, {
  useSentenceSegmentation,
  useSetSentenceSegmentation,
  useSentenceSegmentationChunkSentences,
  useSetSentenceSegmentationChunkSentences,
} from '../../../stores/settingsStore';
import type { SettingsStore } from '../../../stores/settingsStore';
import { useSegmentationStore, useSegmentationModelState } from '../../../stores/segmentationStore';
import { modelForLanguage, MODEL_IDS } from '../../../lib/segmentation/PunctuationRuntime';
import type { PunctuationModelId } from '../../../lib/segmentation/SegmentationRuntime';
import { ModelManager } from '../../../lib/local-inference/ModelManager';
import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import './SentenceSegmentationSection.scss';

interface SentenceSegmentationSectionProps {
  isSessionActive: boolean;
  className?: string;
}

/** Insertion order matches PunctuationRuntime's own MODEL_IDS, which is not
 *  itself exported (only its keys, indirectly, via Object.keys inside that
 *  module) — kept here rather than re-exporting it just for this list. */
const MODELS: PunctuationModelId[] = ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'];

/** Mirrors PunctuationRuntime's own gate exactly: same `debug:device-memory`
 *  override, same undefined -> 4GB fallback, same <= 4 threshold. This
 *  section must grey the same models the runtime would refuse to run, not
 *  invent its own idea of "low memory" — including the debug override,
 *  which is the repo's sanctioned way to simulate a small machine
 *  (`localParticipantConfig.ts:44,77,116` uses the identical override for
 *  the same reason). Without it, a tester setting the override to check
 *  THIS section's greying would see it disagree with what
 *  `PunctuationRuntime.punctuate()` actually does.
 *  Two things this deliberately does NOT resolve, both open questions for
 *  the repository owner: whether 4GB is the right line at all given a single
 *  model can hold up to 1.5GB of unreclaimable renderer memory, and the fact
 *  that an unknown navigator.deviceMemory reads as exactly this threshold,
 *  so a device that simply doesn't report the API is treated as too small. */
const MIN_DEVICE_MEMORY_GB = 4;

/** Duplicated from PunctuationRuntime.ts's private, unexported
 *  `deviceMemoryGb()` (same shape, including the try/catch and the
 *  Number.isNaN/>= 0 validation) rather than imported — it isn't exported,
 *  and exporting it would mean touching a file outside this task's scope.
 *  Keep the two in sync by hand if either changes. */
function deviceMemoryGb(): number {
  try {
    const override = localStorage.getItem('debug:device-memory');
    if (override !== null) {
      const n = Number(override);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return (navigator as { deviceMemory?: number }).deviceMemory ?? MIN_DEVICE_MEMORY_GB;
}

function isLowMemoryDevice(): boolean {
  return deviceMemoryGb() <= MIN_DEVICE_MEMORY_GB;
}

function ModelRow({
  model,
  enabled,
  lowMemory,
  isSessionActive,
  inUse,
}: {
  model: PunctuationModelId;
  /** The sentenceSegmentation setting itself — off disables every row. */
  enabled: boolean;
  lowMemory: boolean;
  isSessionActive: boolean;
  inUse: boolean;
}) {
  const { t } = useTranslation();
  const state = useSegmentationModelState(model);
  const manifestId = MODEL_IDS[model];
  const entry = getManifestEntry(manifestId);
  if (!entry) return null;

  const rowDisabled = !enabled || lowMemory;
  // Only Delete has a session-scoped rule of its own: deleting a model that
  // isn't in use, or downloading a new one, doesn't touch a running session.
  const deleteDisabled = rowDisabled || (isSessionActive && inUse);

  const download = () => {
    useSegmentationStore.getState().setModelStatus(model, 'downloading');
    ModelManager.getInstance()
      .downloadModel(manifestId, (progress) => {
        useSegmentationStore.getState().setModelProgress(model, progress.percent);
      })
      .then(() => useSegmentationStore.getState().setModelStatus(model, 'downloaded'))
      .catch((err: unknown) => {
        const message = describeCause(err);
        useSegmentationStore.getState().setModelStatus(model, 'error', message);
        // Mirrors useSegmentationRuntime.ts's onStatus('error') handling for
        // the runtime-driven path: without this, a manually triggered
        // failure is invisible everywhere but a bare Retry button — nothing
        // reaches the diagnostic log a bug report would carry.
        reportWarning('Segmentation', `${model} download failed: ${message}`, {
          dedupeKey: `segmentation:${model}`,
        });
      });
  };

  const remove = () => {
    ModelManager.getInstance()
      .deleteModel(manifestId)
      .then(() => useSegmentationStore.getState().setModelStatus(model, 'not-downloaded'))
      .catch((err: unknown) => {
        // The delete failed, not the model itself — leave status alone
        // (the files are presumably still there) but don't let the
        // rejection vanish silently.
        reportWarning('Segmentation', `${model} delete failed: ${describeCause(err)}`, {
          dedupeKey: `segmentation:${model}:delete`,
        });
      });
  };

  return (
    <div
      className={`sentence-segmentation__model${rowDisabled ? ' sentence-segmentation__model--disabled' : ''}`}
      data-testid={`sentence-segmentation-model-${model}`}
    >
      <div className="sentence-segmentation__model-info">
        <span className="sentence-segmentation__model-name">{entry.name}</span>
        <span className="sentence-segmentation__model-size">{getModelSizeMb(entry)} MB</span>
        {inUse && (
          <span className="sentence-segmentation__model-badge">
            {t('settings.sentenceSegmentationModelInUse', 'Used by current languages')}
          </span>
        )}
      </div>
      <div className="sentence-segmentation__model-actions">
        {state.status === 'not-downloaded' && (
          <button
            type="button"
            className="sentence-segmentation__model-btn"
            onClick={download}
            disabled={rowDisabled}
          >
            <Download size={14} />
            <span>{t('models.download', 'Download')}</span>
          </button>
        )}

        {state.status === 'downloading' && (
          <span className="sentence-segmentation__model-status">{state.percent}%</span>
        )}

        {state.status === 'loading' && (
          <span className="sentence-segmentation__model-status">
            {t('settings.sentenceSegmentationModelLoading', 'Loading…')}
          </span>
        )}

        {(state.status === 'downloaded' || state.status === 'ready') && (
          <>
            <span className="sentence-segmentation__model-status">
              {state.status === 'ready'
                ? t('models.active', 'Active')
                : t('models.downloaded', 'Downloaded')}
            </span>
            <button
              type="button"
              className="sentence-segmentation__model-btn sentence-segmentation__model-btn--delete"
              onClick={remove}
              disabled={deleteDisabled}
              title={t('models.delete', 'Delete')}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <span className="sentence-segmentation__model-status" title={state.error ?? undefined}>
              {t('models.error', 'Error')}
            </span>
            <button
              type="button"
              className="sentence-segmentation__model-btn"
              onClick={download}
              disabled={rowDisabled}
              title={state.error ?? undefined}
            >
              <Download size={14} />
              <span>{t('models.retry', 'Retry')}</span>
            </button>
          </>
        )}

        {state.status === 'disabled' && (
          <span className="sentence-segmentation__model-status">
            {t('settings.sentenceSegmentationModelUnavailable', 'Unavailable this session')}
          </span>
        )}
      </div>

      {state.status === 'error' && state.error && (
        <p className="sentence-segmentation__model-error">{state.error}</p>
      )}
    </div>
  );
}

const SentenceSegmentationSection: React.FC<SentenceSegmentationSectionProps> = ({
  isSessionActive,
  className = '',
}) => {
  const { t } = useTranslation();
  const sentenceSegmentation = useSentenceSegmentation();
  const setSentenceSegmentation = useSetSentenceSegmentation();
  const chunkSentences = useSentenceSegmentationChunkSentences();
  const setChunkSentences = useSetSentenceSegmentationChunkSentences();

  // No useCurrentLanguages / useActiveLanguages / useLanguagePair hook
  // exists: sourceLanguage/targetLanguage live on the active provider's own
  // settings slice, resolved through its descriptor exactly as MainPanel
  // does for the Start gate (MainPanel.tsx:653).
  const activeSourceLanguage = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { sourceLanguage?: string } | undefined)?.sourceLanguage,
  );
  const activeTargetLanguage = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { targetLanguage?: string } | undefined)?.targetLanguage,
  );

  // undefined (no provider configured yet) marks no row, rather than
  // defaulting to one — modelForLanguage has no notion of "no language".
  const sourceModel = activeSourceLanguage !== undefined ? modelForLanguage(activeSourceLanguage) : undefined;
  const targetModel = activeTargetLanguage !== undefined ? modelForLanguage(activeTargetLanguage) : undefined;

  const lowMemory = isLowMemoryDevice();

  return (
    <div className={`config-section ${className}`} id="sentence-segmentation-section">
      <h3>
        <Scissors size={18} />
        <span>{t('settings.sentenceSegmentationTitle', 'Sentence segmentation')}</span>
        <Tooltip
          content={t(
            'settings.sentenceSegmentationTitleDesc',
            'Groups spoken text into full sentences and starts a new bubble every few sentences, even when the source provides no punctuation.',
          )}
          position="top"
          icon="help"
        />
      </h3>

      <ToggleSwitch
        checked={sentenceSegmentation}
        onChange={() => { void setSentenceSegmentation(!sentenceSegmentation); }}
        label={t('settings.sentenceSegmentation', 'Subtitle segmentation')}
        disabled={isSessionActive}
        tooltip={t('settings.sentenceSegmentationDesc', 'When a transcript arrives without punctuation, add it and start a new bubble every few sentences. A small model is downloaded only when it is first needed.')}
      />

      <div className="sentence-segmentation__chunk">
        <div className="sentence-segmentation__chunk-header">
          <span className="sentence-segmentation__chunk-label">
            {t('settings.sentenceSegmentationChunk', 'Sentences per bubble')}
          </span>
          <Tooltip
            content={t('settings.sentenceSegmentationChunkTooltip', 'How much speech goes into one bubble before a new one starts. On local engines this is also the translation unit, so 1 translates sentence by sentence and 5 stays close to whole-utterance translation.')}
            position="top"
            icon="help"
            maxWidth={350}
          />
        </div>
        <div className="segmented-control sentence-segmentation__chunk-options">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`segmented-option ${chunkSentences === n ? 'active' : ''}`}
              disabled={isSessionActive || !sentenceSegmentation}
              onClick={() => { if (chunkSentences !== n) void setChunkSentences(n); }}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="sentence-segmentation__chunk-effect">
          {t('settings.sentenceSegmentationChunkEffect', 'Long speech starts a new bubble every {{count}} sentences.', { count: chunkSentences })}
        </p>
      </div>

      <div className="sentence-segmentation__models">
        {lowMemory && (
          <div className="sentence-segmentation__low-memory" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              {t(
                'settings.sentenceSegmentationLowMemory',
                'This device does not report enough memory to run these models, so they are disabled here.',
              )}
            </span>
          </div>
        )}
        {MODELS.map((model) => (
          <ModelRow
            key={model}
            model={model}
            enabled={sentenceSegmentation}
            lowMemory={lowMemory}
            isSessionActive={isSessionActive}
            inUse={model === sourceModel || model === targetModel}
          />
        ))}
      </div>
    </div>
  );
};

export default SentenceSegmentationSection;

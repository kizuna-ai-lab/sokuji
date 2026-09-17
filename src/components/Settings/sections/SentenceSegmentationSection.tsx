import React, { useEffect } from 'react';
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
import { useModelStore, useModelStatuses } from '../../../stores/modelStore';
import { modelForLanguage, MODEL_IDS } from '../../../lib/segmentation/PunctuationRuntime';
import type { PunctuationModelId } from '../../../lib/segmentation/SegmentationRuntime';
import { ModelManager } from '../../../lib/local-inference/ModelManager';
import * as modelStorage from '../../../lib/local-inference/modelStorage';
import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import './SentenceSegmentationSection.scss';

interface SentenceSegmentationSectionProps {
  isSessionActive: boolean;
  className?: string;
}

/** Derived from PunctuationRuntime's own MODEL_IDS (which IS exported —
 *  imported two lines up and indexed below) rather than hand-kept: a fourth
 *  model id added there would otherwise compile here too, silently missing
 *  a row, since nothing would tie this list back to the real roster. */
const MODELS: PunctuationModelId[] = Object.keys(MODEL_IDS) as PunctuationModelId[];

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
    // useModelStore.downloadModel(modelId) takes no per-file progress
    // callback (it tracks its own `downloads` state internally instead), and
    // this row needs one for its own progress bar — so the download itself
    // stays on ModelManager directly rather than routing through the store.
    // Mirror what useModelStore.downloadModel() does on success/failure
    // below, so modelStatuses and storageUsedMb do not drift from what is
    // actually on disk until the next launch.
    ModelManager.getInstance()
      .downloadModel(manifestId, (progress) => {
        useSegmentationStore.getState().setModelProgress(model, progress.percent);
      })
      .then(async () => {
        useSegmentationStore.getState().setModelStatus(model, 'downloaded');
        useModelStore.setState((state) => ({
          modelStatuses: { ...state.modelStatuses, [manifestId]: 'downloaded' },
        }));
        try {
          const usedBytes = await modelStorage.estimateStorageUsedBytes();
          useModelStore.setState({ storageUsedMb: Math.round(usedBytes / (1024 * 1024)) });
        } catch {
          // Storage total is cosmetic — the model itself already downloaded
          // fine, and useModelStore.importModel() treats this the same way.
        }
      })
      .catch((err: unknown) => {
        const message = describeCause(err);
        useSegmentationStore.getState().setModelStatus(model, 'error', message);
        useModelStore.setState((state) => ({
          modelStatuses: { ...state.modelStatuses, [manifestId]: 'error' },
        }));
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
    // deleteModel(modelId) needs no per-file progress, so — unlike download
    // above — this routes straight through useModelStore's own method, which
    // already keeps modelStatuses and storageUsedMb in sync (modelStore.ts).
    useModelStore.getState().deleteModel(manifestId)
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

  // Seeds a model row's status from what modelStore has already computed
  // on disk (see segmentationStore.seedFromModelStatuses's own doc comment):
  // without this, every model renders 'not-downloaded' on a fresh launch
  // regardless of what is actually on disk, since nothing else populates this
  // store's status until the runtime's own punctuate() calls run. A session
  // fact this store already knows about always takes precedence — this seed
  // only ever touches a model still at that initial placeholder.
  const modelStatuses = useModelStatuses();
  useEffect(() => {
    useSegmentationStore.getState().seedFromModelStatuses(modelStatuses);
  }, [modelStatuses]);

  // Store-independent probe, additive to the seed above rather than a
  // replacement for it. modelStore.initialize() is gated to the Local
  // Inference provider (SettingsInitializer.tsx) and, separately, to
  // modelStore.ensureSelectionReady()'s own local-inference readiness path
  // -- neither runs for the app's default OPENAI provider. A punctuation
  // model is downloaded through ModelManager directly and works on ANY
  // provider (this section is the only surface that offers it), so the
  // ordinary path is: download a model, restart on the default provider,
  // open Settings -- modelStatuses stays empty forever, the seed above is a
  // permanent no-op, and the row offers Download for a model already on
  // disk. Ask the filesystem directly here too, independent of modelStore
  // ever having run. If modelStore initialises later in the session, the
  // seed above still applies on top via its own [modelStatuses] effect.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(MODELS.map(async (model) => {
      const manifestId = MODEL_IDS[model];
      let ready: boolean;
      try {
        ready = await ModelManager.getInstance().isModelReady(manifestId);
      } catch {
        return;
      }
      if (cancelled || !ready) return;
      // Re-read the CURRENT status at write time, not what it was before
      // the await: a runtime event, or the modelStatuses-driven seed above,
      // may have already landed a richer session fact while this probe was
      // in flight, and that fact must win over a plain on-disk "yes".
      if (useSegmentationStore.getState().models[model].status !== 'not-downloaded') return;
      useSegmentationStore.getState().setModelStatus(model, 'downloaded');
    }));
    return () => { cancelled = true; };
  }, []);

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
              type="button"
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

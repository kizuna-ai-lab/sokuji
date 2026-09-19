import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Download, Trash2, AlertTriangle, X, RotateCw } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import SegmentationDownloadModal from './SegmentationDownloadModal';
import {
  useSentenceSegmentation,
  useSetSentenceSegmentation,
  useSentenceSegmentationChunkSentences,
  useSetSentenceSegmentationChunkSentences,
} from '../../../stores/settingsStore';
import {
  useSegmentationStore,
  useSegmentationPhase,
  useSegmentationProgress,
  PACK_TOTAL_BYTES,
} from '../../../stores/segmentationStore';
import { isLowMemoryDevice } from '../../../lib/segmentation/PunctuationRuntime';
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import './SentenceSegmentationSection.scss';

interface SentenceSegmentationSectionProps {
  isSessionActive: boolean;
  className?: string;
}

/**
 * Sentence segmentation's settings surface. The three punctuation models are
 * one thing to the user — one confirmation, one download, one delete — so this
 * section shows one toggle and one status line, never a row per model.
 *
 * The toggle is the whole decision: turning it on with the pack absent opens
 * the confirmation and downloads all three; turning it off mid-download
 * cancels. The setting and the pack are deliberately separate facts, because
 * they come apart in both directions — a download can be cancelled with the
 * setting on (offer Download again), and the files can be deleted from the
 * Storage page's Clear all while the setting stays on, which is why the disk
 * is re-asked on mount.
 */
const SentenceSegmentationSection: React.FC<SentenceSegmentationSectionProps> = ({
  isSessionActive,
  className = '',
}) => {
  const { t } = useTranslation();
  const sentenceSegmentation = useSentenceSegmentation();
  const setSentenceSegmentation = useSetSentenceSegmentation();
  const chunkSentences = useSentenceSegmentationChunkSentences();
  const setChunkSentences = useSetSentenceSegmentationChunkSentences();

  const phase = useSegmentationPhase();
  const { downloadedBytes } = useSegmentationProgress();
  const error = useSegmentationStore((state) => state.error);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Settings can be opened long after a Clear all on the Storage page, or on a
  // launch where nothing else has asked the disk yet: `phase` starts 'unknown'
  // and only this makes it a fact. Never interrupts an in-flight download —
  // `refresh()` returns early for that case itself.
  useEffect(() => { void useSegmentationStore.getState().refresh(); }, []);

  // The same gate PunctuationRuntime applies, imported rather than restated,
  // so the section can never grey a control the runtime would happily run.
  const lowMemory = isLowMemoryDevice();

  const turnOff = () => {
    void setSentenceSegmentation(false);
    const store = useSegmentationStore.getState();
    if (store.phase !== 'downloading') return;
    store.cancel();
    // A cancel leaves `downloadedBytes` counting bytes that were fetched but
    // not necessarily stored as whole models, so the delete link would offer a
    // size that isn't on disk. Ask the disk instead.
    void useSegmentationStore.getState().refresh();
  };

  const confirmDownload = () => {
    setConfirmOpen(false);
    void setSentenceSegmentation(true);
    void useSegmentationStore.getState().download();
  };

  // Every route to the 402 MB, in one place. `lowMemory` is not only the
  // toggle's guard: the status line's Download and Retry are reachable
  // whenever the setting is already on, and they would spend the download on a
  // feature `PunctuationRuntime.enabled` refuses to run.
  const askToDownload = () => {
    if (lowMemory) return;
    setConfirmOpen(true);
  };

  const onToggle = () => {
    if (sentenceSegmentation) { turnOff(); return; }
    if (phase === 'ready') { void setSentenceSegmentation(true); return; }
    askToDownload();
  };

  const remove = () => {
    // `deleteModels()` awaits ModelManager per model; a storage failure must
    // reach the diagnostic log rather than becoming an unhandled rejection.
    useSegmentationStore.getState().deleteModels().catch((err: unknown) => {
      reportWarning('Segmentation', `Punctuation model delete failed: ${describeCause(err)}`, {
        cause: err,
        dedupeKey: 'segmentation:delete',
      });
    });
  };

  const packReady = phase === 'ready';
  // A low-memory device cannot turn this on — but a user who had it on before
  // the guard applied can still turn it off.
  const toggleDisabled = isSessionActive || (lowMemory && !sentenceSegmentation);
  // The same guard on the two buttons that also start the download.
  const downloadDisabled = isSessionActive || lowMemory;
  // `phase === 'downloading'` and not just the setting: `setSentenceSegmentation`
  // rolls the setting back when its persist fails, and the download it started
  // is still running. Dropping the line then would take Cancel with it.
  const showPack = sentenceSegmentation || phase === 'downloading';
  // ...and the delete link is the same fact from the other side: offering it
  // mid-download would delete files out from under the live fetch.
  const showDelete = !sentenceSegmentation && phase !== 'downloading' && downloadedBytes > 0;

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
        onChange={onToggle}
        label={t('settings.sentenceSegmentation', 'Subtitle segmentation')}
        disabled={toggleDisabled}
        tooltip={t('settings.sentenceSegmentationDesc', 'When a transcript arrives without punctuation, add it and start a new bubble every few sentences. Turning this on downloads three small models.')}
      />

      {/* One status line, and only while the pack is in play and not ready:
          with the setting off and nothing downloading, the toggle itself
          already says everything, and 'unknown' is a state the disk hasn't
          answered for yet. */}
      {showPack && !packReady && (
        <div className="sentence-segmentation__pack">
          {phase === 'downloading' && (
            <div className="sentence-segmentation__progress">
              <div className="sentence-segmentation__progress-bar">
                <div
                  className="sentence-segmentation__progress-fill"
                  data-testid="segmentation-progress-fill"
                  style={{ width: `${(downloadedBytes / PACK_TOTAL_BYTES) * 100}%` }}
                />
              </div>
              <div className="sentence-segmentation__progress-info">
                <span className="sentence-segmentation__pack-status">
                  {t('settings.sentenceSegmentationDownloading', 'Downloading {{done}} of {{total}}', {
                    done: formatBytes(downloadedBytes),
                    total: formatBytes(PACK_TOTAL_BYTES),
                  })}
                </span>
                <button
                  type="button"
                  className="sentence-segmentation__pack-btn"
                  data-testid="segmentation-download-cancel"
                  onClick={turnOff}
                  disabled={isSessionActive}
                  title={t('settings.sentenceSegmentationDownloadCancel', 'Cancel')}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="sentence-segmentation__pack-line">
              <span className="sentence-segmentation__pack-error">
                {t('settings.sentenceSegmentationDownloadFailed', 'Download failed: {{error}}', {
                  error: error ?? '',
                })}
              </span>
              <button
                type="button"
                className="sentence-segmentation__pack-btn"
                onClick={() => { void useSegmentationStore.getState().download(); }}
                disabled={downloadDisabled}
              >
                <RotateCw size={12} />
                <span>{t('settings.sentenceSegmentationRetry', 'Retry')}</span>
              </button>
            </div>
          )}

          {phase === 'missing' && (
            <div className="sentence-segmentation__pack-line">
              <span className="sentence-segmentation__pack-status">
                {t('settings.sentenceSegmentationDownloadMissing', 'The models are not on this device.')}
              </span>
              <button
                type="button"
                className="sentence-segmentation__pack-btn"
                onClick={askToDownload}
                disabled={downloadDisabled}
              >
                <Download size={12} />
                <span>{t('settings.sentenceSegmentationDownloadAction', 'Download')}</span>
              </button>
            </div>
          )}
        </div>
      )}

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
              disabled={isSessionActive || !sentenceSegmentation || !packReady}
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

      {lowMemory && (
        <div className="sentence-segmentation__low-memory" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {t(
              'settings.sentenceSegmentationLowMemoryOn',
              'This device does not report enough memory to run these models, so this cannot be turned on.',
            )}
          </span>
        </div>
      )}

      {/* Only with the stage off: the pack is 402 MB the user may want back,
          and deleting it out from under a session — or under an enabled
          runtime — is not a thing this offers. */}
      {showDelete && (
        <button
          type="button"
          className="sentence-segmentation__delete"
          onClick={remove}
          disabled={isSessionActive}
        >
          <Trash2 size={12} />
          <span>
            {t('settings.sentenceSegmentationDeleteModels', 'Delete models ({{size}})', {
              size: formatBytes(downloadedBytes),
            })}
          </span>
        </button>
      )}

      <SegmentationDownloadModal
        isOpen={confirmOpen}
        onConfirm={confirmDownload}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default SentenceSegmentationSection;

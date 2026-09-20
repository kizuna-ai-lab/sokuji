import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Download, Trash2, AlertTriangle, X, RotateCw } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import SegmentationDownloadModal from './SegmentationDownloadModal';
import {
  useProvider,
  useOpenAITranslateSettings,
  useSegmentationMode,
  useSetSegmentationMode,
  useSentenceSegmentationChunkSentences,
  useSetSentenceSegmentationChunkSentences,
  useSegmentationSourcePause,
  useSetSegmentationSourcePause,
  useSegmentationTranslationPause,
  useSetSegmentationTranslationPause,
} from '../../../stores/settingsStore';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { resolveSegmentationOffer, type ProviderCapabilities } from '../../../services/providers/ProviderConfig';
import {
  MAX_SEGMENT_PAUSE_SECONDS,
  MIN_SEGMENT_PAUSE_SECONDS,
  resolveSegmentationMode,
  resolveSegmentationSize,
  type SegmentationMode,
} from '../../../lib/segmentation/segmentationMode';
import { Provider } from '../../../types/Provider';
import {
  useSegmentationStore,
  useSegmentationPhase,
  useSegmentationProgress,
  PACK_TOTAL_BYTES,
} from '../../../stores/segmentationStore';
import useLogStore from '../../../stores/logStore';
import { isLowMemoryDevice } from '../../../lib/segmentation/PunctuationRuntime';
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import { useAnalytics } from '../../../lib/analytics';
import './SentenceSegmentationSection.scss';

interface SentenceSegmentationSectionProps {
  isSessionActive: boolean;
  className?: string;
}

/**
 * Sentence segmentation's settings surface. The three punctuation models are
 * one thing to the user — one confirmation, one download, one delete — so this
 * section shows one status line, never a row per model.
 *
 * The whole decision is one three-way mode (Amendment A2): Off, By pause, By
 * sentences. It is stored once for every provider and clamped on read to what
 * the current one offers, so this section renders the RESOLVED mode as
 * selected and stores the raw choice — a user who picks By pause on Gemini and
 * then switches to Soniox sees Off, and switching back shows By pause again.
 *
 * By sentences is the only mode that needs the 402 MB: choosing it with the
 * pack absent opens the confirmation and leaves the mode untouched until the
 * user confirms. The mode and the pack are deliberately separate facts,
 * because they come apart in both directions — a download can be cancelled
 * with the mode set (offer Download again), and the files can be deleted from
 * the Storage page's Clear all while the mode stays By sentences, which is why
 * the disk is re-asked on mount.
 */
const SentenceSegmentationSection: React.FC<SentenceSegmentationSectionProps> = ({
  isSessionActive,
  className = '',
}) => {
  const { t } = useTranslation();
  const provider = useProvider();
  const storedMode = useSegmentationMode();
  const setSegmentationMode = useSetSegmentationMode();
  const storedSize = useSentenceSegmentationChunkSentences();
  const setChunkSentences = useSetSentenceSegmentationChunkSentences();
  const sourcePause = useSegmentationSourcePause();
  const setSourcePause = useSetSegmentationSourcePause();
  const translationPause = useSegmentationTranslationPause();
  const setTranslationPause = useSetSegmentationTranslationPause();
  // OpenAI Translate over WebRTC runs ONE timer for the pair and gives it the
  // translation pause (the last delta of a pair is the translation's — see
  // OpenAITranslateWebRTCClient), so a Source slider there would move
  // nothing. One provider's transport, read off its own slice: it is not a
  // capability, because no other descriptor behaves this way and inventing a
  // field would put the exception in fifteen rows to describe one.
  const translateTransport = useOpenAITranslateSettings().transportType;

  const phase = useSegmentationPhase();
  const { downloadedBytes } = useSegmentationProgress();
  const error = useSegmentationStore((state) => state.error);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { trackEvent } = useAnalytics();

  // What this provider offers, and therefore what the stored mode and size
  // mean here.
  const offer = useMemo(() => {
    try {
      return resolveSegmentationOffer(ProviderConfigFactory.getConfig(provider).capabilities);
    } catch {
      // An id this build did not register — a provider behind a gate that is
      // off, or a stale stored value. `resolveSegmentationOffer` reads only
      // `capabilities.segmentation`, so an empty object yields exactly the
      // documented default without this file restating it.
      return resolveSegmentationOffer({} as ProviderCapabilities);
    }
  }, [provider]);

  const mode = resolveSegmentationMode(storedMode, offer);
  const size = resolveSegmentationSize(storedSize, offer);

  // Settings can be opened long after a Clear all on the Storage page, or on a
  // launch where nothing else has asked the disk yet: `phase` starts 'unknown'
  // and only this makes it a fact. Never interrupts an in-flight download —
  // `refresh()` returns early for that case itself.
  useEffect(() => { void useSegmentationStore.getState().refresh(); }, []);

  // The same gate PunctuationRuntime applies, imported rather than restated,
  // so the section can never grey a control the runtime would happily run.
  const lowMemory = isLowMemoryDevice();

  /** Leaving By sentences: a download that is still running has lost its
   *  reason to run. */
  const stopDownload = () => {
    const store = useSegmentationStore.getState();
    if (store.phase !== 'downloading') return;
    store.cancel();
    // A cancel leaves `downloadedBytes` counting bytes that were fetched but
    // not necessarily stored as whole models, so the delete link would offer a
    // size that isn't on disk. Ask the disk instead.
    void useSegmentationStore.getState().refresh();
  };

  /**
   * The 402 MB, timed and reported. Here and not in the store: no store in this
   * repo imports analytics, and slice 3b's store deliberately reaches only for
   * diagnostics.
   *
   * The outcome is read off the store's phase rather than from `download()`,
   * which resolves the same way however it ended — it writes 'error' itself and
   * never rejects, and a cancel leaves 'missing' behind. That is also why
   * `cancelled` is a phase and not a caught exception.
   */
  const runDownload = (modeBefore?: SegmentationMode) => {
    const startedAt = Date.now();
    void useSegmentationStore.getState().download(modeBefore).then(() => {
      const durationMs = Date.now() - startedAt;
      const phase = useSegmentationStore.getState().phase;
      const result = phase === 'ready' ? 'ok' : phase === 'error' ? 'error' : 'cancelled';
      trackEvent('segmentation_models_download', {
        // The same 1024 base `formatBytes` uses, so this number is the one the
        // confirmation dialog put in front of the user.
        size_mb: Math.round(PACK_TOTAL_BYTES / (1024 * 1024)),
        result,
        duration_ms: durationMs,
      });
      console.info(
        `[Segmentation] punctuation pack download ${result} after ${Math.round(durationMs / 1000)}s`,
      );
      // And the same fact on the exportable panel, which is where the spec asks
      // for download durations. `addRealtimeEvent`, not a plain entry: a
      // finished download is not a failure, and only report.ts writes plain
      // entries (the one outcome that IS a failure already reaches the panel
      // from the store's own `reportWarning`). It self-gates on the
      // diagnostic-logs switch, so nothing is recorded by default.
      useLogStore.getState().addRealtimeEvent(
        {
          type: 'segmentation.pack.downloaded',
          data: { result, duration_ms: durationMs, size_mb: Math.round(PACK_TOTAL_BYTES / (1024 * 1024)) },
        },
        'client',
        'segmentation.pack.downloaded',
      );
    });
  };

  const confirmDownload = () => {
    setConfirmOpen(false);
    // `mode` is this render's value, so it is still the pre-download one — the
    // write below is what changes it. The download keeps it, because this
    // section can be unmounted and remounted (Advanced settings changes tab)
    // long before Cancel is clicked.
    const from = mode;
    void setSegmentationMode('sentences');
    runDownload(from);
  };

  // Every route to the 402 MB, in one place. `lowMemory` is not only the mode
  // control's guard: the status line's Download and Retry are reachable
  // whenever the mode is already By sentences, and they would spend the
  // download on a feature `PunctuationRuntime.enabled` refuses to run.
  const askToDownload = () => {
    if (lowMemory) return;
    setConfirmOpen(true);
  };

  /**
   * The progress line's Cancel. It stops the fetch whatever the mode currently
   * reads, because a `setSegmentationMode` whose persist failed has already
   * rolled the mode back while the download it started keeps running — routing
   * this through `chooseMode('off')` would then hit its "already there" guard
   * and leave the fetch alive with no way to stop it.
   *
   * The mode only moves if it is still on By sentences, and it goes back to
   * whatever it was when the download was agreed to. Landing on Off instead
   * would quietly take By pause away from someone who had it and changed their
   * mind about the 402 MB — on those three providers that is a different way
   * of cutting bubbles, not a no-op. The download is what remembers it, not
   * this component: a tab change in Advanced settings remounts the section
   * while the fetch carries on. Read before `stopDownload()`, which drops it.
   */
  const cancelDownload = () => {
    const from = useSegmentationStore.getState().modeBeforeDownload;
    // Null means the download did not say where it came from: the status
    // line's Retry, which is only reachable from By sentences. Cancelling a
    // retry leaves the user where they already were — the models are missing
    // either way, and the section says so — rather than moving them to Off,
    // which on the three pause providers would quietly change how bubbles cut.
    if (from !== null && mode === 'sentences') void setSegmentationMode(from);
    stopDownload();
  };

  const chooseMode = (next: SegmentationMode) => {
    // The STORED mode, not the resolved one. On a provider without By pause
    // the stored default already reads as Off, and comparing against that
    // would make clicking Off a no-op — the user could never make `off` the
    // stored value from here, and switching to Gemini would bring By pause
    // back. What is rendered as selected stays the resolved mode.
    if (next === storedMode) return;
    if (next === 'sentences') {
      if (lowMemory) return;
      // The pack is the price of this mode, so the mode does not change until
      // the user has agreed to pay it.
      if (phase !== 'ready') { askToDownload(); return; }
      void setSegmentationMode('sentences');
      return;
    }
    void setSegmentationMode(next);
    stopDownload();
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

  const hasSourcePause = !(provider === Provider.OPENAI_TRANSLATE && translateTransport === 'webrtc');
  const packReady = phase === 'ready';
  // The three modes in the order A2 names them, minus the one this provider
  // cannot run. Off and By sentences survive everywhere — By sentences is
  // runnable wherever either Auto or a size is, which is every provider.
  const modes: SegmentationMode[] = offer.pause
    ? ['off', 'pause', 'sentences']
    : ['off', 'sentences'];
  const modeLabels: Record<SegmentationMode, string> = {
    off: t('settings.segmentationModeOff', 'Off'),
    pause: t('settings.segmentationModePause', 'By pause'),
    sentences: t('settings.segmentationModeSentences', 'By sentences'),
  };
  // 0 is Auto. A control with one option is not a choice, which is why a
  // provider that offers Auto alone gets no size row at all.
  const sizeOptions: number[] = [
    ...(offer.auto ? [0] : []),
    ...(offer.sizes ? [1, 2, 3, 4, 5] : []),
  ];
  // The same guard on the two buttons that also start the download.
  const downloadDisabled = isSessionActive || lowMemory;
  // `phase === 'downloading'` and not just the mode: `setSegmentationMode`
  // rolls the mode back when its persist fails, and the download it started
  // is still running. Dropping the line then would take Cancel with it.
  const showPack = mode === 'sentences' || phase === 'downloading';
  // ...and the delete link is the same fact from the other side: offering it
  // mid-download would delete files out from under the live fetch.
  const showDelete = mode !== 'sentences' && phase !== 'downloading' && downloadedBytes > 0;

  return (
    <div className={`config-section ${className}`} id="sentence-segmentation-section">
      <h3>
        <Scissors size={18} />
        <span>{t('settings.sentenceSegmentationTitle', 'Sentence segmentation')}</span>
        <Tooltip
          content={t(
            'settings.sentenceSegmentationTitleDesc',
            'Chooses where one bubble ends: leave it to the provider, cut on a pause you tune, or start a new one every few sentences with the missing punctuation added.',
          )}
          position="top"
          icon="help"
        />
      </h3>

      <div className="sentence-segmentation__mode">
        <div className="sentence-segmentation__row-header">
          <span className="sentence-segmentation__row-label">
            {t('settings.sentenceSegmentation', 'Subtitle segmentation')}
          </span>
          <Tooltip
            content={t('settings.sentenceSegmentationDesc', 'How a bubble is cut. Off keeps what this provider already produces. By pause cuts on a silence you tune below. By sentences adds the punctuation a transcript is missing and starts a new bubble every few sentences; it downloads three small models.')}
            position="top"
            icon="help"
            maxWidth={350}
          />
        </div>
        <div className="segmented-control sentence-segmentation__mode-options">
          {modes.map((m) => (
            <button
              type="button"
              key={m}
              className={`segmented-option ${mode === m ? 'active' : ''}`}
              disabled={isSessionActive || (m === 'sentences' && lowMemory && mode !== 'sentences')}
              onClick={() => chooseMode(m)}
            >
              {modeLabels[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === 'sentences' && sizeOptions.length > 1 && (
        <div className="sentence-segmentation__chunk">
          <div className="sentence-segmentation__row-header">
            <span className="sentence-segmentation__row-label">
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
            {sizeOptions.map((n) => (
              <button
                type="button"
                key={n}
                className={`segmented-option ${size === n ? 'active' : ''}`}
                disabled={isSessionActive || !packReady}
                onClick={() => { if (size !== n) void setChunkSentences(n); }}
              >
                {n === 0 ? t('settings.sentenceSegmentationChunkAuto', 'Auto') : n}
              </button>
            ))}
          </div>
          <p className="sentence-segmentation__chunk-effect">
            {size === 0
              ? t('settings.sentenceSegmentationChunkAutoEffect', 'Bubbles are cut where they are today; only the missing punctuation is added.')
              : t('settings.sentenceSegmentationChunkEffect', 'Long speech starts a new bubble every {{count}} sentences.', { count: size })}
          </p>
        </div>
      )}

      {/* The two silence timers the pause clients cut on. They used to live in
          each provider's own settings; A2 made them one global pair, shown
          only by the mode that uses them. */}
      {mode === 'pause' && (
        <div className="sentence-segmentation__pause">
          {hasSourcePause && (
            <>
              <div className="sentence-segmentation__row-header">
                <span className="sentence-segmentation__row-label">
                  {t('settings.userSilenceDuration', 'Source pause')}
                </span>
                <span className="sentence-segmentation__pause-value">{sourcePause.toFixed(2)}s</span>
              </div>
              <input
                type="range"
                min={MIN_SEGMENT_PAUSE_SECONDS}
                max={MAX_SEGMENT_PAUSE_SECONDS}
                step="0.1"
                className="sentence-segmentation__pause-slider"
                data-testid="segmentation-source-pause"
                value={sourcePause}
                onChange={(e) => void setSourcePause(parseFloat(e.target.value))}
                disabled={isSessionActive}
              />
            </>
          )}
          <div className="sentence-segmentation__row-header">
            <span className="sentence-segmentation__row-label">
              {t('settings.assistantSilenceDuration', 'Translation pause')}
            </span>
            <span className="sentence-segmentation__pause-value">{translationPause.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min={MIN_SEGMENT_PAUSE_SECONDS}
            max={MAX_SEGMENT_PAUSE_SECONDS}
            step="0.1"
            className="sentence-segmentation__pause-slider"
            data-testid="segmentation-translation-pause"
            value={translationPause}
            onChange={(e) => void setTranslationPause(parseFloat(e.target.value))}
            disabled={isSessionActive}
          />
        </div>
      )}

      {/* One status line, and only while the pack is in play and not ready:
          outside By sentences and with nothing downloading, the mode control
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
                  onClick={cancelDownload}
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
                // Retry says nothing about where it came from: it is only
                // reachable from By sentences, which is where it stays.
                onClick={() => runDownload()}
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

      {lowMemory && (
        <div className="sentence-segmentation__low-memory" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {t(
              'settings.sentenceSegmentationLowMemoryOn',
              'This device does not report enough memory to run these models, so By sentences is not available.',
            )}
          </span>
        </div>
      )}

      {/* Only outside By sentences: the pack is 402 MB the user may want back,
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

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X, AlertCircle, CheckCircle, ChevronDown, ChevronRight, AlertTriangle, Zap, Star, ExternalLink, FolderInput } from 'lucide-react';
import {
  useModelStore,
  useModelStatuses,
  useModelDownloads,
  useDownloadErrors,
  useStorageUsedMb,
  useModelInitialized,
  useModelInitError,
  useWebGPUAvailable,
  useDeviceFeatures,
  useModelVariants,
} from '../../../stores/modelStore';
import {
  getManifestByType,
  getManifestEntry,
  getModelSizeMb,
  isTranslationModelCompatible,
  deviceReady,
  selectVariant,
  getBaselineVariant,
  type ModelManifestEntry,
  type ModelStatus,
  type ModelType,
} from '../../../lib/local-inference/modelManifest';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
import { languageNameFor } from '../engine/languageName';
import { ModelGroup, RecommendedOthers, ModelStorageFooter } from './ModelManagementControls';
import { ModelImportModal } from './ModelImportModal';
import { GpuAccelerationNotice } from './GpuAccelerationNotice';
import LocalInferenceVoiceSection from './LocalInferenceVoiceSection';
import { type VoiceEntry } from './VoiceLibrarySection';
import * as voiceStorage from '../../../lib/local-inference/voiceStorage';
import { importedSidFromDbKey, dbKeyFromImportedSid } from '../../../lib/local-inference/sidMapping';
import { getEdgeTtsVoices, filterVoicesByLanguage, getVoiceDisplayName } from '../../../lib/edge-tts/voiceList';
import type { Voice } from '../../../lib/edge-tts/edgeTts';
import useLogStore from '../../../stores/logStore';
import { isElectron } from '../../../utils/environment';
import './ModelManagementSection.scss';

// ─── Props ─────────────────────────────────────────────────────────────────

interface ModelManagementSectionProps {
  isSessionActive: boolean;
  /** Render only this stage's group (used by the Engine surface's Library
   *  push, which is already scoped to one stage). Omitted = all three. */
  stageFilter?: Stage;
}

// ─── ModelCard ─────────────────────────────────────────────────────────────

function ModelCard({
  entry,
  status,
  download,
  errorMessage,
  isSessionActive,
  isSelected,
  isCompatible,
  isAutoSelected,
  compatibilityHint,
  deviceFeatures,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  onImport,
  children,
}: {
  entry: ModelManifestEntry | null; // null = "None" card
  status: ModelStatus;
  download?: { downloadedBytes: number; totalBytes: number; currentFile: string; percent: number; isImport?: boolean };
  errorMessage?: string;
  isSessionActive: boolean;
  isSelected: boolean;
  isCompatible: boolean;
  isAutoSelected?: boolean;
  compatibilityHint?: string;
  deviceFeatures?: string[];
  onSelect?: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onImport?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const isNone = entry === null;
  const isCloud = entry !== null && entry.isCloudModel === true;
  const disabled = isSessionActive;

  const classNames = [
    'model-card',
    `model-card--${status}`,
    isSelected && 'model-card--selected',
    !isCompatible && !isNone && 'model-card--incompatible',
    disabled && 'model-card--disabled',
    isNone && 'model-card--none',
  ].filter(Boolean).join(' ');

  const handleClick = () => {
    if (disabled || !onSelect) return;
    if (!isCompatible && !isNone) return;
    // Cloud models are always selectable; others need to be downloaded
    if (!isNone && !isCloud && status !== 'downloaded') return;
    onSelect();
  };

  if (isNone) {
    return (
      <div className={classNames} onClick={handleClick}>
        <div className="model-card__top-row">
          <div className="model-card__content">
            <div className="model-card__info">
              <div className="model-card__header">
                <span className="model-card__name">{t('settings.ttsNone', 'None (text only)')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={classNames} data-testid={`model-card-${entry.id}`} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{entry.name}</span>
              {!isCloud && <span className="model-card__size">{getModelSizeMb(entry, deviceFeatures)} MB</span>}
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                {entry.languages.map(lang => (
                  <span key={lang} className="model-card__lang-tag">{lang}</span>
                ))}
              </div>
              {entry.recommended && (
                <span className="model-card__recommended-badge">
                  <Star size={10} />
                  {t('models.recommended', 'Recommended')}
                </span>
              )}
              {isAutoSelected && (
                <span className="model-card__auto-badge">
                  <Zap size={10} />
                  {t('models.autoSelected', 'Auto-selected')}
                </span>
              )}
              {compatibilityHint && (
                <span className="model-card__compatibility-warning">
                  <AlertTriangle size={11} />
                  {compatibilityHint}
                </span>
              )}
            </div>
          </div>

          <div className="model-card__actions">
            {isCloud && (
              <div className="model-card__downloaded">
                <span className={`model-card__status-label${isSelected ? ' model-card__status-label--active' : ''}`}>
                  <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                  <span>{isSelected ? t('models.active', 'Active') : t('models.online', 'Online')}</span>
                </span>
              </div>
            )}

            {!isCloud && status === 'not_downloaded' && (
              <>
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.download', 'Download')}
                >
                  <Download size={14} />
                  <span>{t('models.download', 'Download')}</span>
                </button>
                {onImport && (
                  <button
                    className="model-card__btn model-card__btn--import"
                    onClick={(e) => { e.stopPropagation(); onImport(); }}
                    disabled={isSessionActive}
                    title={t('models.importTitle', 'Import model')}
                  >
                    <FolderInput size={14} />
                    <span>{t('models.import', 'Import')}</span>
                  </button>
                )}
              </>
            )}

            {!isCloud && status === 'downloading' && download && (
              <div className="model-card__progress">
                <div className="model-card__progress-bar">
                  <div
                    className="model-card__progress-fill"
                    style={{ width: `${download.percent}%` }}
                  />
                </div>
                <div className="model-card__progress-info">
                  <span className="model-card__progress-percent">{download.percent}%</span>
                  {/* Imports write straight to IndexedDB and can't be cancelled. */}
                  {!download.isImport && (
                    <button
                      className="model-card__btn model-card__btn--cancel"
                      onClick={(e) => { e.stopPropagation(); onCancel(); }}
                      title={t('models.cancel', 'Cancel')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {!isCloud && status === 'downloaded' && (
              <div className="model-card__downloaded">
                <span className={`model-card__status-label${isSelected ? ' model-card__status-label--active' : ''}`}>
                  <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                  <span>{isSelected ? t('models.active', 'Active') : t('models.downloaded', 'Downloaded')}</span>
                </span>
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={isSessionActive}
                  title={t('models.delete', 'Delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}

            {!isCloud && status === 'error' && (
              <div className="model-card__error">
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.retry', 'Retry')}
                >
                  <Download size={14} />
                </button>
                {onImport && (
                  <button
                    className="model-card__btn model-card__btn--import"
                    onClick={(e) => { e.stopPropagation(); onImport(); }}
                    disabled={isSessionActive}
                    title={t('models.importTitle', 'Import model')}
                  >
                    <FolderInput size={14} />
                    <span>{t('models.import', 'Import')}</span>
                  </button>
                )}
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={isSessionActive}
                  title={t('models.deletePartial', 'Delete partial files')}
                >
                  <Trash2 size={12} />
                </button>
                <span className="model-card__status-icon"><AlertCircle size={14} /></span>
                <span title={errorMessage}>{t('models.error', 'Error')}</span>
                {errorMessage && (
                  <div className="model-card__error-message">{errorMessage}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {isSelected && children && (
        // stopPropagation so interacting with the body (e.g. the voice picker's
        // dropdown/buttons) does not bubble to the card root's onClick and re-select.
        <div className="model-card__body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sort helpers (type-specific) ──────────────────────────────────────────

/** Creates a model sorter: recommended first → sortOrder → fallback comparator */
function createModelSorter(fallback: (a: ModelManifestEntry, b: ModelManifestEntry) => number) {
  return (models: ModelManifestEntry[]) =>
    [...models].sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      const ord = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (ord !== 0) return ord;
      return fallback(a, b);
    });
}

const sortAsrModels = createModelSorter((a, b) => {
  const tierA = a.multilingual ? 2 : a.languages.length === 1 ? 0 : 1;
  const tierB = b.multilingual ? 2 : b.languages.length === 1 ? 0 : 1;
  if (tierA !== tierB) return tierA - tierB;
  return a.languages.length - b.languages.length;
});

const sortTranslationModels = createModelSorter((a, b) =>
  a.languages.length - b.languages.length,
);

const sortTtsModels = createModelSorter((a, b) =>
  a.name.localeCompare(b.name),
);

// ─── Main Component ────────────────────────────────────────────────────────

export function ModelManagementSection({
  isSessionActive,
  stageFilter,
}: ModelManagementSectionProps) {
  const { t } = useTranslation();
  const settings = useLocalInferenceSettings();
  const updateLocalInference = useUpdateLocalInference();
  const statuses = useModelStatuses();
  const downloads = useModelDownloads();
  const downloadErrors = useDownloadErrors();
  const storageUsedMb = useStorageUsedMb();
  const initialized = useModelInitialized();
  const initError = useModelInitError();
  const webgpuAvailable = useWebGPUAvailable();
  const deviceFeatures = useDeviceFeatures();
  const modelVariants = useModelVariants();
  const { initialize, downloadModel, cancelDownload, deleteModel, deleteAllModels } = useModelStore();

  /** Compute variant upgrade/incompatibility hint for a model */
  const getVariantHint = (entry: ModelManifestEntry): { hint?: string; incompatible?: boolean } => {
    const status = statuses[entry.id];
    if (status !== 'downloaded') return {};

    const currentVariant = modelVariants[entry.id] ?? getBaselineVariant(entry);
    const optimalVariant = selectVariant(entry, deviceFeatures);
    if (currentVariant === optimalVariant) return {};

    // Check if the downloaded variant is incompatible with this device
    const currentDef = entry.variants[currentVariant];
    if (currentDef?.requiredFeatures?.some(f => !deviceFeatures.includes(f))) {
      return {
        hint: t('models.incompatibleVariant', 'This model format is incompatible with your device. Please delete and re-download.'),
        incompatible: true,
      };
    }

    // Suboptimal: a better variant is available
    return {
      hint: t('models.upgradeVariant', 'Your device supports a faster model format. Delete and re-download for better performance.'),
    };
  };

  const [showAllTranslation, setShowAllTranslation] = useState(false);
  const [showAllAsr, setShowAllAsr] = useState(false);
  const [showAllTts, setShowAllTts] = useState(false);
  const [importFor, setImportFor] = useState<ModelManifestEntry | null>(null);

  // Close the import dialog when the panel hides (<Activity> cleanup); a
  // hidden-but-open dialog would reappear on reveal and swallow the visible
  // panel's Escape key. Staged files are intentionally discarded with it.
  useEffect(() => () => setImportFor(null), []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const { sourceLanguage, targetLanguage } = settings;

  /**
   * Live, non-persisted view of "what would actually run right now" per
   * stage — computed from the manifest, current download/hardware state, and
   * the user's explicit `selections`. This replaces the two duplicate
   * auto-select effects that used to shadow-write asrModel/translationModel/
   * ttsModel on every render (one here, one in ProviderSpecificSettings —
   * the latter bypassed the deviceReady hardware gate entirely). The gate
   * now lives once, inside resolve()/resolveStage(), and nothing here writes
   * settings just to display a value.
   */
  const resolved = useMemo(
    () => useModelStore.getState().resolve(sourceLanguage, targetLanguage, settings.selections),
    [statuses, webgpuAvailable, deviceFeatures, sourceLanguage, targetLanguage, settings.selections],
  );
  const selectedAsr = resolved.asr?.modelId ?? '';
  const selectedTranslation = resolved.translation?.modelId ?? '';
  const selectedTts = resolved.tts?.modelId ?? '';

  /**
   * Writes one explicit pick into `selections`; resolve() picks it up on the
   * next render (see `resolved` above). Only the id is persisted — never a
   * variant or source — matching the "auto unless the user explicitly
   * touched it" contract `selections` is built around.
   */
  const selectCard = (stage: Stage, modelId: string) => {
    const dir = directionKey(sourceLanguage, targetLanguage);
    const current = settings.selections[dir] ?? emptyDirection();
    updateLocalInference({
      selections: {
        ...settings.selections,
        [dir]: { ...current, [stage]: { modelId } },
      },
    });
  };

  // ── Memoized model lists ──────────────────────────────────────────────

  const asrModels = useMemo(() => {
    const all = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    return sortAsrModels(all);
  }, []);

  const translationModels = useMemo(() => {
    const all = [...getManifestByType('translation')];

    // If the resolved ASR model supports AST, add it as a translation option
    const asrEntry = selectedAsr ? getManifestEntry(selectedAsr) : null;
    if (asrEntry?.astLanguages) {
      all.push({
        ...asrEntry,
        type: 'translation' as ModelType,
        multilingual: true,
        languages: asrEntry.astLanguages.translate,
      } as ModelManifestEntry);
    }

    return sortTranslationModels(all);
  }, [selectedAsr]);

  const compatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      && deviceReady(m, webgpuAvailable)
    ),
    [translationModels, sourceLanguage, targetLanguage, webgpuAvailable],
  );

  const incompatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      !isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      || !deviceReady(m, webgpuAvailable)
    ),
    [translationModels, sourceLanguage, targetLanguage, webgpuAvailable],
  );

  const ttsModels = useMemo(() => {
    const all = getManifestByType('tts');
    return sortTtsModels(all);
  }, []);

  const compatibleAsrModels = useMemo(
    () => asrModels.filter(m =>
      (m.multilingual || m.languages.includes(sourceLanguage))
      && deviceReady(m, webgpuAvailable)
    ),
    [asrModels, sourceLanguage, webgpuAvailable],
  );
  const incompatibleAsrModels = useMemo(
    () => asrModels.filter(m =>
      (!m.multilingual && !m.languages.includes(sourceLanguage))
      || !deviceReady(m, webgpuAvailable)
    ),
    [asrModels, sourceLanguage, webgpuAvailable],
  );

  const compatibleTtsModels = useMemo(
    () => ttsModels.filter(m => m.multilingual || m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );
  const incompatibleTtsModels = useMemo(
    () => ttsModels.filter(m => !m.multilingual && !m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );

  // ── Voice / speaker state (embedded in the selected TTS card) ──────────
  // Relocated verbatim from ProviderSpecificSettings so the WASM voice control
  // lives inside the selected TTS card (mirrors NativeModelManagementSection).

  // Edge TTS voice picker state
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<Voice[]>([]);
  const [edgeTtsVoiceStatus, setEdgeTtsVoiceStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const isEdgeTtsSelected = selectedTts === 'edge-tts';

  useEffect(() => {
    if (!isEdgeTtsSelected) return;
    let cancelled = false;
    setEdgeTtsVoiceStatus('loading');
    getEdgeTtsVoices()
      .then(voices => {
        if (cancelled) return;
        setEdgeTtsVoices(voices);
        setEdgeTtsVoiceStatus('loaded');
      })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[EdgeTTS] Failed to fetch voice list:', err);
        useLogStore.getState().addLog(
          `Failed to fetch Edge TTS voice list: ${message}`,
          'error',
        );
        setEdgeTtsVoiceStatus('error');
      });
    return () => { cancelled = true; };
  }, [isEdgeTtsSelected]);

  const filteredVoices = useMemo(
    () => filterVoicesByLanguage(edgeTtsVoices, settings.targetLanguage),
    [edgeTtsVoices, settings.targetLanguage],
  );

  // edge voice list shape consumed by LocalInferenceVoiceSection
  const edgeVoices = useMemo(
    () => filteredVoices.map((v) => ({ ShortName: v.ShortName, label: getVoiceDisplayName(v) })),
    [filteredVoices],
  );

  // Supertonic imported voice state
  const [importedVoices, setImportedVoices] = useState<voiceStorage.StoredVoice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  const isSupertonicTts = getManifestEntry(selectedTts)?.engine === 'supertonic';

  const refreshImportedVoices = useCallback(async () => {
    if (!isSupertonicTts) return;
    try {
      const list = await voiceStorage.listVoices('supertonic-3');
      setImportedVoices(list);
    } catch (err) {
      console.warn('Failed to list imported voices:', err);
    }
  }, [isSupertonicTts]);

  useEffect(() => {
    void refreshImportedVoices();
  }, [refreshImportedVoices]);

  const supertonicTtsEntry = isSupertonicTts ? getManifestEntry(selectedTts) : undefined;

  const supertonicVoices = useMemo(() => {
    if (!isSupertonicTts || !supertonicTtsEntry) return [];
    const presets = supertonicTtsEntry.ttsConfig?.presetVoices ?? [];
    const presetVoices = presets.map(p => ({
      sid: p.sid,
      name: p.name,
      source: 'preset' as const,
      gender: p.gender as 'M' | 'F',
    }));
    const importedAsVoices = importedVoices.map(v => ({
      sid: importedSidFromDbKey(v.id),
      name: v.name,
      source: 'imported' as const,
      gender: undefined,
    }));
    return [...presetVoices, ...importedAsVoices];
  }, [isSupertonicTts, supertonicTtsEntry, importedVoices]);

  // Adapter: map the sid-based Supertonic voice model onto the normalized,
  // capability-driven VoiceLibrarySection props. Ids encode the sid so the
  // sid-based callbacks recover it; the component treats them as opaque.
  const supertonicVoiceEntries = useMemo<VoiceEntry[]>(
    () => supertonicVoices.map((v) => ({
      id: `${v.source === 'preset' ? 'preset' : 'custom'}:${v.sid}`,
      label: v.name,
      group: v.source === 'preset' ? 'builtin' : 'custom',
      removable: v.source === 'imported',
      meta: v.gender ? { gender: v.gender } : undefined,
    })),
    [supertonicVoices],
  );

  const supertonicSelectedId = useMemo(() => {
    const match = supertonicVoices.find((v) => v.sid === settings.ttsSpeakerId);
    const source = match?.source === 'imported' ? 'custom' : 'preset';
    return `${source}:${settings.ttsSpeakerId}`;
  }, [supertonicVoices, settings.ttsSpeakerId]);

  const handleImportVoice = useCallback(async (file: File) => {
    try {
      const fallbackName = file.name.replace(/\.json$/i, '');
      await voiceStorage.addVoice('supertonic-3', fallbackName, file);
      setImportError(null);
      await refreshImportedVoices();
      setHasPendingChanges(true);
    } catch (err) {
      const msg = err instanceof voiceStorage.VoiceImportError
        ? `${err.code}: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      setImportError(msg);
      throw err;
    }
  }, [refreshImportedVoices]);

  const handleRenameVoice = useCallback(async (sid: number, newName: string) => {
    const dbKey = dbKeyFromImportedSid(sid);
    if (dbKey === null) return;
    await voiceStorage.renameVoice(dbKey, newName);
    await refreshImportedVoices();
    setHasPendingChanges(true);
  }, [refreshImportedVoices]);

  const handleDeleteVoice = useCallback(async (sid: number) => {
    const dbKey = dbKeyFromImportedSid(sid);
    if (dbKey === null) return;
    await voiceStorage.deleteVoice(dbKey);
    const defaultSid = supertonicTtsEntry?.ttsConfig?.defaultSid ?? 0;
    if (settings.ttsSpeakerId === sid) {
      updateLocalInference({ ttsSpeakerId: defaultSid });
    }
    await refreshImportedVoices();
    setHasPendingChanges(true);
  }, [supertonicTtsEntry, settings.ttsSpeakerId, updateLocalInference, refreshImportedVoices]);

  // Auto-select first voice when target language changes or no voice selected
  useEffect(() => {
    if (!isEdgeTtsSelected || filteredVoices.length === 0) return;
    const currentVoice = settings.edgeTtsVoice;
    const isCurrentValid = filteredVoices.some(v => v.ShortName === currentVoice);
    if (!isCurrentValid) {
      updateLocalInference({ edgeTtsVoice: filteredVoices[0].ShortName });
    }
  }, [isEdgeTtsSelected, filteredVoices, settings.edgeTtsVoice, updateLocalInference]);

  // A failed initialize() (e.g. IndexedDB VersionError when another build
  // upgraded the shared DB in this profile) must surface an actionable error
  // instead of a silently missing section. `!initialized && !initError` is the
  // brief loading window — render nothing there, as before.
  if (!initialized) {
    if (initError) {
      return (
        <div id="model-management-section" className="settings-section model-management-section">
          <h2>{t('models.management', 'Models')}</h2>
          <div className="model-management-section__init-error">
            <p>{t('models.initFailed', 'Model storage failed to initialize: {{message}}', { message: initError })}</p>
            <button type="button" onClick={() => initialize()}>
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleDownload = async (modelId: string) => {
    try {
      await downloadModel(modelId);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(`Failed to download model ${modelId}:`, err);
      }
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────

  /** Render a single compatible model card with its variant hint. */
  const renderCard = (
    entry: ModelManifestEntry,
    selectedId: string | undefined,
    onSelect: (id: string) => void,
    renderBody?: (entry: ModelManifestEntry) => React.ReactNode,
  ) => {
    const { hint, incompatible } = getVariantHint(entry);
    return (
      <ModelCard
        key={entry.id}
        entry={entry}
        status={statuses[entry.id] || 'not_downloaded'}
        download={downloads[entry.id]}
        errorMessage={downloadErrors[entry.id]}
        isSessionActive={isSessionActive}
        isSelected={selectedId === entry.id}
        isCompatible={!incompatible}
        compatibilityHint={hint}
        deviceFeatures={deviceFeatures}
        onSelect={() => onSelect(entry.id)}
        onDownload={() => handleDownload(entry.id)}
        onCancel={() => cancelDownload(entry.id)}
        onDelete={() => deleteModel(entry.id)}
        onImport={() => setImportFor(entry)}
      >
        {renderBody?.(entry)}
      </ModelCard>
    );
  };

  /** Render recommended / others sub-groups for a compatible model list */
  const renderSubGroups = (
    models: ModelManifestEntry[],
    selectedId: string | undefined,
    onSelect: (id: string) => void,
    renderBody?: (entry: ModelManifestEntry) => React.ReactNode,
  ) => (
    <RecommendedOthers
      items={models}
      isRecommended={(m) => !!m.recommended}
      renderItem={(m) => renderCard(m, selectedId, onSelect, renderBody)}
    />
  );

  // ── ASR Section ───────────────────────────────────────────────────────

  const renderAsrGroup = () => {
    return (
      <ModelGroup id="model-asr" title={t('models.asrModels', 'ASR (Speech Recognition)')}
        bare={!!stageFilter}>
        {compatibleAsrModels.length > 0 ? (
          renderSubGroups(
            compatibleAsrModels,
            selectedAsr,
            (id) => selectCard('asr', id),
          )
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noAsrModel', 'No ASR model for {{language}}', { language: sourceLanguage })}
          </div>
        )}

        {incompatibleAsrModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllAsr(!showAllAsr)}
            >
              {showAllAsr ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllAsr
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAllAsr', 'Show all ASR models ({{count}})', {
                    count: incompatibleAsrModels.length,
                  })
              }
            </button>
            {showAllAsr && incompatibleAsrModels.map(entry => (
              <React.Fragment key={entry.id}>
                <ModelCard
                  entry={entry}
                  status={statuses[entry.id] || 'not_downloaded'}
                  download={downloads[entry.id]}
                  isSessionActive={isSessionActive}
                  isSelected={selectedAsr === entry.id}
                  isCompatible={false}
                  compatibilityHint={
                    !deviceReady(entry, webgpuAvailable)
                      ? t('settings.webgpuNotSupported', 'Not available in current environment')
                      : t('settings.langMismatch', 'language mismatch')
                  }
                  onSelect={() => selectCard('asr', entry.id)}
                  onDownload={() => handleDownload(entry.id)}
                  onCancel={() => cancelDownload(entry.id)}
                  onDelete={() => deleteModel(entry.id)}
                  onImport={() => setImportFor(entry)}
                />
                {statuses[entry.id] === 'downloaded' && (
                  <div className="model-card__available-when-lang">
                    {t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.', {
                      lang: entry.languages.map((l) => languageNameFor(l)).join(', '),
                    })}
                  </div>
                )}
              </React.Fragment>
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Translation Section ───────────────────────────────────────────────

  const renderTranslationGroup = () => {
    return (
      <ModelGroup id="model-translation" title={t('models.translationModels', 'Translation')}
        bare={!!stageFilter}>
        {compatibleTranslationModels.length > 0 ? (
          renderSubGroups(
            compatibleTranslationModels,
            selectedTranslation,
            (id) => selectCard('translation', id),
          )
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noTranslationModel', 'No translation model for {{source}} \u2192 {{target}}', {
              source: sourceLanguage,
              target: targetLanguage,
            })}
          </div>
        )}

        {incompatibleTranslationModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllTranslation(!showAllTranslation)}
            >
              {showAllTranslation ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllTranslation
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAll', 'Show all translation models ({{count}})', {
                    count: incompatibleTranslationModels.length,
                  })
              }
            </button>
            {showAllTranslation && incompatibleTranslationModels.map(entry => (
              <React.Fragment key={entry.id}>
                <ModelCard
                  entry={entry}
                  status={statuses[entry.id] || 'not_downloaded'}
                  download={downloads[entry.id]}
                  isSessionActive={isSessionActive}
                  isSelected={selectedTranslation === entry.id}
                  isCompatible={false}
                  compatibilityHint={
                    !deviceReady(entry, webgpuAvailable)
                      ? t('settings.webgpuNotSupported', 'Not available in current environment')
                      : t('settings.langMismatch', 'language mismatch')
                  }
                  onSelect={() => selectCard('translation', entry.id)}
                  onDownload={() => handleDownload(entry.id)}
                  onCancel={() => cancelDownload(entry.id)}
                  onDelete={() => deleteModel(entry.id)}
                  onImport={() => setImportFor(entry)}
                />
                {statuses[entry.id] === 'downloaded' && (
                  <div className="model-card__available-when-lang">
                    {t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.', {
                      lang: entry.languages.map((l) => languageNameFor(l)).join(', '),
                    })}
                  </div>
                )}
              </React.Fragment>
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── TTS Section ───────────────────────────────────────────────────────

  // Voice control embedded in the selected TTS card only. The card's
  // `isSelected && children` gate is the real guard; the id check just
  // avoids building the body for non-selected cards.
  const renderTtsCardBody = (entry: ModelManifestEntry) => entry.id === selectedTts ? (
    <>
      <LocalInferenceVoiceSection
        ttsModel={entry.id}
        isSessionActive={isSessionActive}
        edgeVoices={edgeVoices}
        edgeVoiceStatus={edgeTtsVoiceStatus}
        edgeTtsVoice={settings.edgeTtsVoice}
        supertonicVoices={supertonicVoiceEntries}
        supertonicSelectedId={supertonicSelectedId}
        onImportVoice={handleImportVoice}
        onRenameVoice={handleRenameVoice}
        onDeleteVoice={handleDeleteVoice}
        ttsSpeakerId={settings.ttsSpeakerId}
        numSpeakers={supertonicTtsEntry?.numSpeakers ?? getManifestEntry(entry.id)?.numSpeakers ?? 1}
        onUpdate={(patch) => updateLocalInference(patch)}
      />
      {isSupertonicTts && (
        <>
          <div className="voice-library-info">
            {t('voiceLibrary.customVoiceCta', 'Need a custom voice?')}{' '}
            <a
              href="https://supertonic.supertone.ai/voice-builder"
              onClick={(e) => {
                e.preventDefault();
                const url = 'https://supertonic.supertone.ai/voice-builder';
                if (isElectron() && (window as any).electron?.invoke) {
                  (window as any).electron.invoke('open-external', url);
                } else {
                  window.open(url, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              {t('voiceLibrary.openVoiceBuilder', 'Create one at Voice Builder')}
              <ExternalLink size={14} />
            </a>
            <div className="voice-library-info-sub">
              {t(
                'voiceLibrary.voiceBuilderDisclaimer',
                'Paid Supertone service. Sokuji is not involved in that transaction.',
              )}
            </div>
          </div>
          {importError && (
            <div className="setting-item error">
              {t('voiceLibrary.importError', 'Import failed: {error}').replace('{error}', importError)}
            </div>
          )}
          {hasPendingChanges && (
            <div className="setting-item info">
              {t('voiceLibrary.restartHint', 'Restart the session to apply imported voice changes.')}
            </div>
          )}
        </>
      )}
    </>
  ) : null;

  const renderTtsGroup = () => {
    return (
      <ModelGroup
        id="model-tts"
        title={t('models.ttsModels', 'TTS (Text-to-Speech)')}
        bare={!!stageFilter}
      >
        {compatibleTtsModels.length > 0 ? (
          renderSubGroups(
            compatibleTtsModels,
            selectedTts,
            (id) => selectCard('tts', id),
            renderTtsCardBody,
          )
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noTtsModel', 'No TTS model for {{language}}', { language: targetLanguage })}
          </div>
        )}

        {incompatibleTtsModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllTts(!showAllTts)}
            >
              {showAllTts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllTts
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAllTts', 'Show all TTS models ({{count}})', {
                    count: incompatibleTtsModels.length,
                  })
              }
            </button>
            {showAllTts && incompatibleTtsModels.map(entry => (
              <React.Fragment key={entry.id}>
                <ModelCard
                  entry={entry}
                  status={statuses[entry.id] || 'not_downloaded'}
                  download={downloads[entry.id]}
                  isSessionActive={isSessionActive}
                  isSelected={selectedTts === entry.id}
                  isCompatible={false}
                  compatibilityHint={t('settings.langMismatch', 'language mismatch')}
                  onSelect={() => selectCard('tts', entry.id)}
                  onDownload={() => handleDownload(entry.id)}
                  onCancel={() => cancelDownload(entry.id)}
                  onDelete={() => deleteModel(entry.id)}
                  onImport={() => setImportFor(entry)}
                />
                {statuses[entry.id] === 'downloaded' && (
                  <div className="model-card__available-when-lang">
                    {t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.', {
                      lang: entry.languages.map((l) => languageNameFor(l)).join(', '),
                    })}
                  </div>
                )}
              </React.Fragment>
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    // The Library push (stageFilter set) already lives inside EngineSurface's
    // own .config-section shell + h3 header (Finding 3) — dropping
    // .settings-section and the <h2> here avoids a second, nested section
    // frame with a redundant title. The standalone (prop-less) render keeps
    // both: it's the whole standalone Settings page for this section.
    <div id="model-management-section" className={stageFilter ? 'model-management-section' : 'settings-section model-management-section'}>
      {!stageFilter && <h2>{t('models.management', 'Models')}</h2>}

      <GpuAccelerationNotice />

      {(!stageFilter || stageFilter === 'asr') && renderAsrGroup()}
      {(!stageFilter || stageFilter === 'translation') && renderTranslationGroup()}
      {(!stageFilter || stageFilter === 'tts') && renderTtsGroup()}

      {/* Storage owns Clear-all now (StoragePage) — this duplicate footer only
          belongs on the standalone (prop-less stageFilter) render; the Library
          push is already scoped to one stage and its gating differs. */}
      {!stageFilter && (
        <ModelStorageFooter
          usedMb={storageUsedMb}
          hasModels={storageUsedMb > 0}
          onClearAll={deleteAllModels}
          disabled={isSessionActive}
        />
      )}

      {importFor && (
        <ModelImportModal
          isOpen
          modelId={importFor.id}
          modelName={importFor.name}
          onClose={() => setImportFor(null)}
        />
      )}
    </div>
  );
}

export default ModelManagementSection;

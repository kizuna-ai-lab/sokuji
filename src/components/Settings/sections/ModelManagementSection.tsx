import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X, AlertCircle, CheckCircle, ChevronDown, ChevronRight, AlertTriangle, Zap, Star, ExternalLink } from 'lucide-react';
import {
  useModelStore,
  useModelStatuses,
  useModelDownloads,
  useDownloadErrors,
  useStorageUsedMb,
  useModelInitialized,
  useWebGPUAvailable,
  useDeviceFeatures,
  useModelVariants,
} from '../../../stores/modelStore';
import {
  getManifestByType,
  getManifestEntry,
  getModelSizeMb,
  isTranslationModelCompatible,
  isAstCompatible,
  pickBestModel,
  selectVariant,
  getBaselineVariant,
  type ModelManifestEntry,
  type ModelStatus,
  type ModelType,
} from '../../../lib/local-inference/modelManifest';
import type { LocalInferenceSettings } from '../../../stores/settingsStore';
import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
import { ModelGroup, RecommendedOthers, ModelStorageFooter } from './ModelManagementControls';
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
  showRadio,
  compatibilityHint,
  deviceFeatures,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  children,
}: {
  entry: ModelManifestEntry | null; // null = "None" card
  status: ModelStatus;
  download?: { downloadedBytes: number; totalBytes: number; currentFile: string; percent: number };
  errorMessage?: string;
  isSessionActive: boolean;
  isSelected: boolean;
  isCompatible: boolean;
  isAutoSelected?: boolean;
  showRadio: boolean;
  compatibilityHint?: string;
  deviceFeatures?: string[];
  onSelect?: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
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
          {showRadio && <div className="model-card__radio" />}
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
        {showRadio && <div className="model-card__radio" />}
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
              <div className="model-card__downloaded model-card__cloud">
                <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                <span>{t('models.online', 'Online')}</span>
              </div>
            )}

            {!isCloud && status === 'not_downloaded' && (
              <button
                className="model-card__btn model-card__btn--download"
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                disabled={isSessionActive}
                title={t('models.download', 'Download')}
              >
                <Download size={14} />
                <span>{t('models.download', 'Download')}</span>
              </button>
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
                  <button
                    className="model-card__btn model-card__btn--cancel"
                    onClick={(e) => { e.stopPropagation(); onCancel(); }}
                    title={t('models.cancel', 'Cancel')}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {!isCloud && status === 'downloaded' && (
              <div className="model-card__downloaded">
                <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                <span>{t('models.downloaded', 'Downloaded')}</span>
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
                <span className="model-card__status-icon"><AlertCircle size={14} /></span>
                <span title={errorMessage}>{t('models.error', 'Error')}</span>
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.retry', 'Retry')}
                >
                  <Download size={14} />
                </button>
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
}: ModelManagementSectionProps) {
  const { t } = useTranslation();
  const settings = useLocalInferenceSettings();
  const updateLocalInference = useUpdateLocalInference();
  const statuses = useModelStatuses();
  const downloads = useModelDownloads();
  const downloadErrors = useDownloadErrors();
  const storageUsedMb = useStorageUsedMb();
  const initialized = useModelInitialized();
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

  useEffect(() => {
    initialize();
  }, [initialize]);

  const { sourceLanguage, targetLanguage, asrModel, ttsModel, translationModel } = settings;

  // Auto-select models: fix incompatible or missing selections after language change / model download
  useEffect(() => {
    if (!initialized) return;
    const updates: Partial<LocalInferenceSettings> = {};

    // ASR: must support sourceLanguage and be downloaded (includes streaming models)
    const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    const currentAsr = asrModel ? allAsrModels.find(m => m.id === asrModel) : null;
    const asrOk = currentAsr && (currentAsr.multilingual || currentAsr.languages.includes(sourceLanguage)) && statuses[asrModel] === 'downloaded';
    if (!asrOk) {
      const match = pickBestModel(allAsrModels.filter(m =>
        (m.multilingual || m.languages.includes(sourceLanguage)) && statuses[m.id] === 'downloaded'
      ));
      const newId = match?.id || '';
      if (newId !== asrModel) updates.asrModel = newId;
    }

    // Translation: must be compatible with source→target pair, downloaded, and device-ready
    // AST short-circuit: if translation model === ASR model and it has astLanguages, it's valid
    const asrEntryForAst = translationModel && translationModel === asrModel
      ? getManifestEntry(translationModel) : null;
    const isAstValid = asrEntryForAst
      && isAstCompatible(asrEntryForAst, sourceLanguage, targetLanguage)
      && statuses[translationModel] === 'downloaded';

    const currentTrans = !isAstValid && translationModel ? getManifestByType('translation').find(m => m.id === translationModel) : null;
    const transOk = isAstValid || (currentTrans
      && isTranslationModelCompatible(currentTrans, sourceLanguage, targetLanguage)
      && (currentTrans.isCloudModel || statuses[translationModel] === 'downloaded')
      && !(currentTrans.requiredDevice === 'webgpu' && !webgpuAvailable));
    if (!transOk) {
      const match = pickBestModel(getManifestByType('translation').filter(m =>
        isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
        && (m.isCloudModel || statuses[m.id] === 'downloaded')
        && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
      ));
      const newId = match?.id || '';
      if (newId !== translationModel) updates.translationModel = newId;
    }

    // TTS: must support targetLanguage and be downloaded (or be a cloud model)
    const currentTts = ttsModel ? getManifestByType('tts').find(m => m.id === ttsModel) : null;
    const ttsOk = currentTts && (currentTts.multilingual || currentTts.languages.includes(targetLanguage)) && (currentTts.isCloudModel || statuses[ttsModel] === 'downloaded');
    if (!ttsOk) {
      const match = pickBestModel(getManifestByType('tts').filter(m =>
        (m.multilingual || m.languages.includes(targetLanguage)) && (m.isCloudModel || statuses[m.id] === 'downloaded')
      ));
      const newId = match?.id || '';
      if (newId !== ttsModel) updates.ttsModel = newId;
    }

    if (Object.keys(updates).length > 0) {
      updateLocalInference(updates);
    }

    // Remember the final model selection for this language pair
    const finalAsr = updates.asrModel ?? asrModel;
    const finalTranslation = updates.translationModel ?? translationModel;
    const finalTts = updates.ttsModel ?? ttsModel;
    if (finalAsr) {
      useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, finalAsr, finalTranslation, finalTts);
    }
  }, [initialized, statuses, sourceLanguage, targetLanguage, asrModel, translationModel, ttsModel, webgpuAvailable, updateLocalInference]);

  // ── Memoized model lists ──────────────────────────────────────────────

  const asrModels = useMemo(() => {
    const all = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    return sortAsrModels(all);
  }, []);

  const translationModels = useMemo(() => {
    const all = [...getManifestByType('translation')];

    // If current ASR model supports AST, add it as a translation option
    const asrEntry = asrModel ? getManifestEntry(asrModel) : null;
    if (asrEntry?.astLanguages) {
      all.push({
        ...asrEntry,
        type: 'translation' as ModelType,
        multilingual: true,
        languages: asrEntry.astLanguages.translate,
      } as ModelManifestEntry);
    }

    return sortTranslationModels(all);
  }, [asrModel]);

  const compatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
    ),
    [translationModels, sourceLanguage, targetLanguage, webgpuAvailable],
  );

  const incompatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      !isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      || (m.requiredDevice === 'webgpu' && !webgpuAvailable)
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
      && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
    ),
    [asrModels, sourceLanguage, webgpuAvailable],
  );
  const incompatibleAsrModels = useMemo(
    () => asrModels.filter(m =>
      (!m.multilingual && !m.languages.includes(sourceLanguage))
      || (m.requiredDevice === 'webgpu' && !webgpuAvailable)
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
  const isEdgeTtsSelected = settings.ttsModel === 'edge-tts';

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

  const isSupertonicTts = getManifestEntry(settings.ttsModel)?.engine === 'supertonic';

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

  const supertonicTtsEntry = isSupertonicTts ? getManifestEntry(settings.ttsModel) : undefined;

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

  if (!initialized) return null;

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
        showRadio={true}
        compatibilityHint={hint}
        deviceFeatures={deviceFeatures}
        onSelect={() => onSelect(entry.id)}
        onDownload={() => handleDownload(entry.id)}
        onCancel={() => cancelDownload(entry.id)}
        onDelete={() => deleteModel(entry.id)}
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
      <ModelGroup id="model-asr" title={t('models.asrModels', 'ASR (Speech Recognition)')}>
        {compatibleAsrModels.length > 0 ? (
          renderSubGroups(
            compatibleAsrModels,
            asrModel,
            (id) => {
              updateLocalInference({ asrModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, id, translationModel, ttsModel);
            },
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
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={asrModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={t('settings.langMismatch', 'language mismatch')}
                onSelect={() => {
                  updateLocalInference({ asrModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, entry.id, translationModel, ttsModel);
                }}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Translation Section ───────────────────────────────────────────────

  const renderTranslationGroup = () => {
    return (
      <ModelGroup id="model-translation" title={t('models.translationModels', 'Translation')}>
        {compatibleTranslationModels.length > 0 ? (
          renderSubGroups(
            compatibleTranslationModels,
            translationModel,
            (id) => {
              updateLocalInference({ translationModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, id, ttsModel);
            },
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
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={translationModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={
                  entry.requiredDevice === 'webgpu' && !webgpuAvailable
                    ? t('settings.webgpuNotSupported', 'Not available in current environment')
                    : t('settings.langMismatch', 'language mismatch')
                }
                onSelect={() => {
                  updateLocalInference({ translationModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, entry.id, ttsModel);
                }}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── TTS Section ───────────────────────────────────────────────────────

  const renderTtsGroup = () => {
    return (
      <ModelGroup
        id="model-tts"
        title={t('models.ttsModels', 'TTS (Text-to-Speech)')}
      >
        {compatibleTtsModels.length > 0 ? (
          renderSubGroups(
            compatibleTtsModels,
            ttsModel,
            (id) => {
              updateLocalInference({ ttsModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, id);
            },
            // Voice control embedded in the selected TTS card only. The card's
            // `isSelected && children` gate is the real guard; the id check just
            // avoids building the body for non-selected cards.
            (entry) => entry.id === ttsModel ? (
              <>
                <LocalInferenceVoiceSection
                  ttsModel={ttsModel}
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
                  numSpeakers={supertonicTtsEntry?.numSpeakers ?? getManifestEntry(ttsModel)?.numSpeakers ?? 1}
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
            ) : null,
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
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={ttsModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={t('settings.langMismatch', 'language mismatch')}
                onSelect={() => {
                  updateLocalInference({ ttsModel: entry.id });
                  useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, entry.id);
                }}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div id="model-management-section" className="settings-section model-management-section">
      <h2>{t('models.management', 'Models')}</h2>

      {renderAsrGroup()}
      {renderTranslationGroup()}
      {renderTtsGroup()}

      <ModelStorageFooter
        usedMb={storageUsedMb}
        hasModels={storageUsedMb > 0}
        onClearAll={deleteAllModels}
        disabled={isSessionActive}
      />
    </div>
  );
}

export default ModelManagementSection;

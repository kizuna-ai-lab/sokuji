import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X, AlertCircle, CheckCircle, HardDrive, ChevronDown, ChevronRight, AlertTriangle, Zap, Star } from 'lucide-react';
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
import './ModelManagementSection.scss';

// ─── Props ─────────────────────────────────────────────────────────────────

interface ModelManagementSectionProps {
  isSessionActive: boolean;
  localInferenceSettings: LocalInferenceSettings;
  onUpdateSettings: (updates: Partial<LocalInferenceSettings>) => void;
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
}) {
  const { t } = useTranslation();
  const isNone = entry === null;
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
    // For incompatible models, don't allow selection
    if (!isCompatible && !isNone) return;
    // For non-downloaded models (except "None"), don't allow selection
    if (!isNone && status !== 'downloaded') return;
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
    <div className={classNames} onClick={handleClick}>
      <div className="model-card__top-row">
        {showRadio && <div className="model-card__radio" />}
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{entry.name}</span>
              <span className="model-card__size">{getModelSizeMb(entry, deviceFeatures)} MB</span>
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
            {status === 'not_downloaded' && (
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

            {status === 'downloading' && download && (
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

            {status === 'downloaded' && (
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

            {status === 'error' && (
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
    </div>
  );
}

// ─── ModelGroup ────────────────────────────────────────────────────────────

function ModelGroup({
  id,
  title,
  subtitle,
  defaultExpanded = true,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div id={id ? `${id}-section` : undefined} className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <h3 className="model-group__title">{title}</h3>
        {subtitle && <span className="model-group__subtitle">{subtitle}</span>}
      </div>
      {expanded && (
        <div className="model-group__list">
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
  localInferenceSettings,
  onUpdateSettings,
}: ModelManagementSectionProps) {
  const { t } = useTranslation();
  const statuses = useModelStatuses();
  const downloads = useModelDownloads();
  const downloadErrors = useDownloadErrors();
  const storageUsedMb = useStorageUsedMb();
  const initialized = useModelInitialized();
  const webgpuAvailable = useWebGPUAvailable();
  const deviceFeatures = useDeviceFeatures();
  const modelVariants = useModelVariants();
  const { initialize, downloadModel, cancelDownload, deleteModel, deleteAllModels } = useModelStore();
  const [confirmClearAll, setConfirmClearAll] = useState(false);

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

  const { sourceLanguage, targetLanguage, asrModel, ttsModel, translationModel } = localInferenceSettings;

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
      && statuses[translationModel] === 'downloaded'
      && !(currentTrans.requiredDevice === 'webgpu' && !webgpuAvailable));
    if (!transOk) {
      const match = pickBestModel(getManifestByType('translation').filter(m =>
        isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
        && statuses[m.id] === 'downloaded'
        && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
      ));
      const newId = match?.id || '';
      if (newId !== translationModel) updates.translationModel = newId;
    }

    // TTS: must support targetLanguage and be downloaded
    const currentTts = ttsModel ? getManifestByType('tts').find(m => m.id === ttsModel) : null;
    const ttsOk = currentTts && currentTts.languages.includes(targetLanguage) && statuses[ttsModel] === 'downloaded';
    if (!ttsOk) {
      const match = pickBestModel(getManifestByType('tts').filter(m =>
        m.languages.includes(targetLanguage) && statuses[m.id] === 'downloaded'
      ));
      const newId = match?.id || '';
      if (newId !== ttsModel) updates.ttsModel = newId;
    }

    if (Object.keys(updates).length > 0) {
      onUpdateSettings(updates);
    }

    // Remember the final model selection for this language pair
    const finalAsr = updates.asrModel ?? asrModel;
    const finalTranslation = updates.translationModel ?? translationModel;
    const finalTts = updates.ttsModel ?? ttsModel;
    if (finalAsr) {
      useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, finalAsr, finalTranslation, finalTts);
    }
  }, [initialized, statuses, sourceLanguage, targetLanguage, asrModel, translationModel, ttsModel, webgpuAvailable, onUpdateSettings]);

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
    () => ttsModels.filter(m => m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );
  const incompatibleTtsModels = useMemo(
    () => ttsModels.filter(m => !m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );

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

  /** Render a list of compatible model cards with variant hints */
  const renderCompatibleCards = (
    models: ModelManifestEntry[],
    selectedId: string | undefined,
    onSelect: (id: string) => void,
  ) =>
    models.map(entry => {
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
        />
      );
    });

  /** Render recommended / others sub-groups for a compatible model list */
  const renderSubGroups = (
    models: ModelManifestEntry[],
    selectedId: string | undefined,
    onSelect: (id: string) => void,
  ) => {
    const recommended = models.filter(m => m.recommended);
    const others = models.filter(m => !m.recommended);

    if (recommended.length === 0) {
      // No recommended models — render flat list as before
      return renderCompatibleCards(models, selectedId, onSelect);
    }

    return (
      <>
        <div className="model-subgroup">
          <div className="model-subgroup__label">
            <Star size={11} />
            {t('models.recommendedGroup', 'Recommended')}
          </div>
          {renderCompatibleCards(recommended, selectedId, onSelect)}
        </div>
        {others.length > 0 && (
          <div className="model-subgroup">
            <div className="model-subgroup__label">
              {t('models.othersGroup', 'Others')}
            </div>
            {renderCompatibleCards(others, selectedId, onSelect)}
          </div>
        )}
      </>
    );
  };

  // ── ASR Section ───────────────────────────────────────────────────────

  const renderAsrGroup = () => {
    return (
      <ModelGroup id="model-asr" title={t('models.asrModels', 'ASR (Speech Recognition)')}>
        {compatibleAsrModels.length > 0 ? (
          renderSubGroups(
            compatibleAsrModels,
            asrModel,
            (id) => {
              onUpdateSettings({ asrModel: id });
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
                  onUpdateSettings({ asrModel: entry.id });
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
              onUpdateSettings({ translationModel: id });
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
                  onUpdateSettings({ translationModel: entry.id });
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
              onUpdateSettings({ ttsModel: id });
              useModelStore.getState().rememberModels(sourceLanguage, targetLanguage, asrModel, translationModel, id);
            },
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
                  onUpdateSettings({ ttsModel: entry.id });
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

      <div className="model-management__storage">
        <HardDrive size={14} />
        <span>
          {t('models.storageUsed', 'Storage: {{size}} MB used', { size: storageUsedMb })}
        </span>
        {storageUsedMb > 0 && (
          confirmClearAll ? (
            <div className="model-management__clear-confirm">
              <span className="model-management__clear-confirm-text">
                {t('models.confirmClearAll', 'Delete all models?')}
              </span>
              <button
                className="model-management__clear-btn model-management__clear-btn--yes"
                onClick={async () => {
                  setConfirmClearAll(false);
                  await deleteAllModels();
                }}
                disabled={isSessionActive}
              >
                {t('models.confirmYes', 'Yes')}
              </button>
              <button
                className="model-management__clear-btn model-management__clear-btn--no"
                onClick={() => setConfirmClearAll(false)}
              >
                {t('models.confirmNo', 'No')}
              </button>
            </div>
          ) : (
            <button
              className="model-management__clear-all"
              onClick={() => setConfirmClearAll(true)}
              disabled={isSessionActive}
              title={t('models.clearAll', 'Clear all models')}
            >
              <Trash2 size={12} />
              {t('models.clearAll', 'Clear all')}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export default ModelManagementSection;

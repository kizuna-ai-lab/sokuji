import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle, Star, Zap, Trash2, HardDrive } from 'lucide-react';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import {
  nativeAsrCards,
  nativeAsrIncompatibleCards,
  nativeTranslationCards,
  nativeTtsCards,
  pickNativeTts,
  type NativeModelCardSpec,
  type NativeSelection,
} from '../../../lib/local-inference/native/nativeCatalog';
import {
  useNativeModelStore,
  useNativeModelStatuses,
  useNativeModelProgress,
  useNativeModelSizes,
} from '../../../stores/nativeModelStore';

type Stage = 'asrModel' | 'translationModel' | 'ttsModel';

// Collapsible per-stage group — mirrors ModelGroup in ModelManagementSection.tsx.
const NativeModelGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <h3 className="model-group__title">{title}</h3>
      </div>
      {expanded && <div className="model-group__list">{children}</div>}
    </div>
  );
};

// One selectable + downloadable card — reuses ModelManagementSection's model-card__* classes.
const NativeModelCard: React.FC<{
  spec: NativeModelCardSpec;
  selected: boolean;
  autoSelected: boolean;
  disabled: boolean;
  incompatible?: boolean;
  onSelect: () => void;
}> = ({ spec, selected, autoSelected, disabled, incompatible = false, onSelect }) => {
  const { t } = useTranslation();
  const statuses = useNativeModelStatuses();
  const progress = useNativeModelProgress();
  const sizes = useNativeModelSizes();
  const download = useNativeModelStore((s) => s.download);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  const noDownload = spec.downloadId === null;
  const status = noDownload ? 'ready' : (statuses[spec.downloadId as string] || 'absent');
  const ready = noDownload || status === 'ready';

  const statusClass = noDownload ? 'model-card--none'
    : status === 'ready' ? 'model-card--downloaded'
    : status === 'downloading' ? 'model-card--downloading'
    : 'model-card--not_downloaded';
  const classNames = [
    'model-card', statusClass,
    selected && 'model-card--selected',
    incompatible && 'model-card--incompatible',
    disabled && 'model-card--disabled',
  ].filter(Boolean).join(' ');

  const handleClick = () => { if (!disabled && ready) onSelect(); };

  const p = noDownload ? undefined : progress[spec.downloadId as string];
  const percent = p && p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;
  const bytes = noDownload ? 0 : sizes[spec.downloadId as string];
  const sizeMb = bytes && bytes > 0 ? Math.round(bytes / 1e6) : null;

  return (
    <div className={classNames} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__radio" />
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{spec.name}</span>
              {sizeMb !== null && <span className="model-card__size">{sizeMb} MB</span>}
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                {(spec.languages || []).map((l) => (<span key={l} className="model-card__lang-tag">{l}</span>))}
                {spec.note && <span className="model-card__lang-tag">{spec.note}</span>}
              </div>
              {spec.recommended && (
                <span className="model-card__recommended-badge">
                  <Star size={10} />
                  {t('models.recommended', 'Recommended')}
                </span>
              )}
              {autoSelected && selected && (
                <span className="model-card__auto-badge">
                  <Zap size={10} />
                  {t('models.autoSelected', 'Auto-selected')}
                </span>
              )}
            </div>
          </div>
          <div className="model-card__actions">
            {noDownload ? null : status === 'downloading' ? (
              <div className="model-card__progress">
                <div className="model-card__progress-bar">
                  <div className="model-card__progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <div className="model-card__progress-info">
                  <span className="model-card__progress-percent">{percent}%</span>
                </div>
              </div>
            ) : status === 'ready' ? (
              <div className="model-card__downloaded">
                <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                <span>{t('models.downloaded', 'Downloaded')}</span>
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); deleteModel(spec.downloadId as string); }}
                  disabled={disabled}
                  title={t('models.delete', 'Delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ) : (
              <button
                className="model-card__btn model-card__btn--download"
                onClick={(e) => { e.stopPropagation(); download(spec.downloadId as string); }}
                disabled={disabled}
                title={t('models.download', 'Download')}
              >
                <Download size={14} />
                <span>{t('models.download', 'Download')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Model management for LOCAL_NATIVE — collapsible ASR / Translation / Speech-output
 * groups of selectable + downloadable cards, matching LOCAL_INFERENCE's
 * ModelManagementSection. Models live in the sidecar's HF cache.
 *
 * Auto-select + history parity: an effect calls nativeModelStore.autoSelect on
 * status/language change, which applies the catalog reconciler + per-direction
 * remembered history (so a src↔tgt swap recalls the reverse pair, and directional
 * opus-mt repos are validated for the *current* direction). Selecting a card also
 * records the choice for that direction.
 */
export const NativeModelManagementSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const update = useUpdateLocalNative();
  const statuses = useNativeModelStatuses();
  const sizes = useNativeModelSizes();
  const refresh = useNativeModelStore((s) => s.refresh);
  const refreshSizes = useNativeModelStore((s) => s.refreshSizes);
  const autoSelect = useNativeModelStore((s) => s.autoSelect);
  const rememberModels = useNativeModelStore((s) => s.rememberModels);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  // Track which stages were last set by the reconciler (drives the Auto-selected badge).
  const [autoSelectedStages, setAutoSelectedStages] = useState<Record<Stage, boolean>>({
    asrModel: false, translationModel: false, ttsModel: false,
  });
  const [showAllAsr, setShowAllAsr] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const asrCards = useMemo(() => nativeAsrCards(settings.sourceLanguage), [settings.sourceLanguage]);
  const asrIncompatibleCards = useMemo(
    () => nativeAsrIncompatibleCards(settings.sourceLanguage), [settings.sourceLanguage]);
  const translationCards = useMemo(
    () => nativeTranslationCards(settings.sourceLanguage, settings.targetLanguage),
    [settings.sourceLanguage, settings.targetLanguage]);
  const ttsCards = useMemo(() => nativeTtsCards(settings.targetLanguage), [settings.targetLanguage]);

  const allDownloadIds = useMemo(
    () => [...asrCards, ...asrIncompatibleCards, ...translationCards, ...ttsCards]
      .map((c) => c.downloadId).filter((x): x is string => !!x),
    [asrCards, asrIncompatibleCards, translationCards, ttsCards]);
  const refreshKey = allDownloadIds.join('|');
  useEffect(() => {
    refresh(allDownloadIds);
    refreshSizes(allDownloadIds);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey]);

  // Auto-select / recall: reconcile the selection whenever statuses or the
  // language pair change, then apply only the fields that actually differ.
  const statusKey = allDownloadIds.map((id) => `${id}:${statuses[id] || 'absent'}`).join('|');
  useEffect(() => {
    const current: NativeSelection = {
      asrModel: settings.asrModel, translationModel: settings.translationModel, ttsModel: settings.ttsModel,
    };
    const updates = autoSelect(settings.sourceLanguage, settings.targetLanguage, current);
    if (!updates) return;
    const filtered: Partial<NativeSelection> = {};
    (Object.keys(updates) as Stage[]).forEach((k) => {
      if (updates[k] !== current[k]) filtered[k] = updates[k];
    });
    if (Object.keys(filtered).length === 0) return;
    update(filtered);
    setAutoSelectedStages((prev) => {
      const next = { ...prev };
      (Object.keys(filtered) as Stage[]).forEach((k) => { next[k] = true; });
      return next;
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [statusKey, settings.sourceLanguage, settings.targetLanguage, settings.asrModel, settings.translationModel, settings.ttsModel]);

  // TTS '' (default) highlights the default voice for the target language.
  const ttsSelected = (selectId: string) =>
    settings.ttsModel === selectId || (settings.ttsModel === '' && selectId === pickNativeTts(settings.targetLanguage));

  // Explicit user selection: write the choice, clear the Auto-selected flag, and
  // remember the full selection for this direction (mirrors ModelManagementSection).
  const selectCard = (field: Stage, selectId: string) => {
    update({ [field]: selectId });
    setAutoSelectedStages((prev) => ({ ...prev, [field]: false }));
    const sel: NativeSelection = {
      asrModel: settings.asrModel, translationModel: settings.translationModel, ttsModel: settings.ttsModel,
      [field]: selectId,
    };
    rememberModels(settings.sourceLanguage, settings.targetLanguage, sel);
  };

  // Render cards split into Recommended / Others sub-groups (like ModelManagementSection).
  const renderCards = (cards: NativeModelCardSpec[], isSelected: (c: NativeModelCardSpec) => boolean, field: Stage) => {
    const card = (c: NativeModelCardSpec) => (
      <NativeModelCard key={c.selectId || 'auto'} spec={c} disabled={isSessionActive}
        selected={isSelected(c)} autoSelected={autoSelectedStages[field]}
        onSelect={() => selectCard(field, c.selectId)} />
    );
    const recommended = cards.filter((c) => c.recommended);
    const others = cards.filter((c) => !c.recommended);
    if (recommended.length === 0) return <>{cards.map(card)}</>;
    return (
      <>
        <div className="model-subgroup">
          <div className="model-subgroup__label"><Star size={11} />{t('models.recommendedGroup', 'Recommended')}</div>
          {recommended.map(card)}
        </div>
        {others.length > 0 && (
          <div className="model-subgroup">
            <div className="model-subgroup__label">{t('models.othersGroup', 'Others')}</div>
            {others.map(card)}
          </div>
        )}
      </>
    );
  };

  // Storage footer: bytes used ≈ sum of download sizes for cached models (deduped by repo id).
  const usedBytes = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    for (const id of allDownloadIds) {
      if (statuses[id] === 'ready' && !seen.has(id)) { seen.add(id); total += sizes[id] || 0; }
    }
    return total;
  }, [allDownloadIds, statuses, sizes]);
  const usedMb = Math.round(usedBytes / 1e6);
  const readyIds = useMemo(
    () => [...new Set(allDownloadIds.filter((id) => statuses[id] === 'ready'))],
    [allDownloadIds, statuses]);

  return (
    <div id="model-management-section" className="settings-section model-management-section">
      <h2>{t('models.management', 'Models')}</h2>

      <NativeModelGroup title={t('providers.local_native.asr', 'Speech recognition')}>
        {renderCards(asrCards, (c) => settings.asrModel === c.selectId, 'asrModel')}
        {asrIncompatibleCards.length > 0 && (
          <>
            <button className="model-group__show-all" onClick={() => setShowAllAsr(!showAllAsr)}>
              {showAllAsr ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllAsr
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAllAsr', 'Show all ASR models ({{count}})', { count: asrIncompatibleCards.length })}
            </button>
            {showAllAsr && asrIncompatibleCards.map((c) => (
              <NativeModelCard key={c.selectId} spec={c} disabled={isSessionActive} incompatible
                selected={settings.asrModel === c.selectId} autoSelected={false}
                onSelect={() => selectCard('asrModel', c.selectId)} />
            ))}
          </>
        )}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.translation', 'Translation')}>
        {renderCards(translationCards, (c) => settings.translationModel === c.selectId, 'translationModel')}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.speechOutput', 'Speech output')}>
        {renderCards(ttsCards, (c) => ttsSelected(c.selectId), 'ttsModel')}
      </NativeModelGroup>

      <div className="model-management__storage">
        <HardDrive size={14} />
        <span>{t('models.storageUsed', 'Storage: {{size}} MB used', { size: usedMb })}</span>
        {readyIds.length > 0 && (
          confirmClearAll ? (
            <div className="model-management__clear-confirm">
              <span className="model-management__clear-confirm-text">
                {t('models.confirmClearAll', 'Delete all models?')}
              </span>
              <button
                className="model-management__clear-btn model-management__clear-btn--yes"
                onClick={async () => { setConfirmClearAll(false); await Promise.all(readyIds.map((id) => deleteModel(id))); }}
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
};

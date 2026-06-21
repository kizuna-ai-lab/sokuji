import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle, Star } from 'lucide-react';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import {
  nativeAsrCards,
  nativeTranslationCards,
  nativeTtsCards,
  pickNativeTts,
  type NativeModelCardSpec,
} from '../../../lib/local-inference/native/nativeCatalog';
import {
  useNativeModelStore,
  useNativeModelStatuses,
  useNativeModelProgress,
  useNativeModelSizes,
} from '../../../stores/nativeModelStore';

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
const NativeModelCard: React.FC<{ spec: NativeModelCardSpec; selected: boolean; onSelect: () => void; disabled: boolean }>
  = ({ spec, selected, onSelect, disabled }) => {
  const { t } = useTranslation();
  const statuses = useNativeModelStatuses();
  const progress = useNativeModelProgress();
  const sizes = useNativeModelSizes();
  const download = useNativeModelStore((s) => s.download);

  const noDownload = spec.downloadId === null;
  const status = noDownload ? 'ready' : (statuses[spec.downloadId as string] || 'absent');
  const ready = noDownload || status === 'ready';

  const statusClass = noDownload ? 'model-card--none'
    : status === 'ready' ? 'model-card--downloaded'
    : status === 'downloading' ? 'model-card--downloading'
    : 'model-card--not_downloaded';
  const classNames = ['model-card', statusClass, selected && 'model-card--selected', disabled && 'model-card--disabled']
    .filter(Boolean).join(' ');

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
 * groups of selectable + downloadable cards with Recommended/Others sub-grouping,
 * sizes (from the sidecar) and language-aware ASR filtering, matching
 * LOCAL_INFERENCE's ModelManagementSection. Models live in the sidecar's HF cache;
 * a card is selectable only once downloaded.
 */
export const NativeModelManagementSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const update = useUpdateLocalNative();
  const refresh = useNativeModelStore((s) => s.refresh);
  const refreshSizes = useNativeModelStore((s) => s.refreshSizes);

  const asrCards = useMemo(() => nativeAsrCards(settings.sourceLanguage), [settings.sourceLanguage]);
  const translationCards = useMemo(
    () => nativeTranslationCards(settings.sourceLanguage, settings.targetLanguage),
    [settings.sourceLanguage, settings.targetLanguage]);
  const ttsCards = useMemo(() => nativeTtsCards(settings.targetLanguage), [settings.targetLanguage]);

  const allDownloadIds = useMemo(
    () => [...asrCards, ...translationCards, ...ttsCards].map((c) => c.downloadId).filter((x): x is string => !!x),
    [asrCards, translationCards, ttsCards]);
  const refreshKey = allDownloadIds.join('|');
  useEffect(() => {
    refresh(allDownloadIds);
    refreshSizes(allDownloadIds);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey]);

  // TTS '' (default) highlights the default voice for the target language.
  const ttsSelected = (selectId: string) =>
    settings.ttsModel === selectId || (settings.ttsModel === '' && selectId === pickNativeTts(settings.targetLanguage));

  // Render cards split into Recommended / Others sub-groups (like ModelManagementSection).
  const renderCards = (cards: NativeModelCardSpec[], isSelected: (c: NativeModelCardSpec) => boolean, field: 'asrModel' | 'translationModel' | 'ttsModel') => {
    const card = (c: NativeModelCardSpec) => (
      <NativeModelCard key={c.selectId || 'auto'} spec={c} disabled={isSessionActive}
        selected={isSelected(c)} onSelect={() => update({ [field]: c.selectId })} />
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

  return (
    <div id="model-management-section" className="settings-section model-management-section">
      <h2>{t('models.management', 'Models')}</h2>

      <NativeModelGroup title={t('providers.local_native.asr', 'Speech recognition')}>
        {renderCards(asrCards, (c) => settings.asrModel === c.selectId, 'asrModel')}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.translation', 'Translation')}>
        {renderCards(translationCards, (c) => settings.translationModel === c.selectId, 'translationModel')}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.speechOutput', 'Speech output')}>
        {renderCards(ttsCards, (c) => ttsSelected(c.selectId), 'ttsModel')}
      </NativeModelGroup>
    </div>
  );
};

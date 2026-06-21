import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle } from 'lucide-react';
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
} from '../../../stores/nativeModelStore';

// Collapsible per-stage group — mirrors ModelGroup in ModelManagementSection.tsx.
const NativeModelGroup: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <h3 className="model-group__title">{title}</h3>
        {subtitle && <span className="model-group__subtitle">{subtitle}</span>}
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
  const download = useNativeModelStore((s) => s.download);

  const noDownload = spec.downloadId === null;
  const status = noDownload ? 'ready' : (statuses[spec.downloadId as string] || 'absent');
  const ready = noDownload || status === 'ready';

  const classNames = [
    'model-card',
    ready && 'model-card--downloaded',
    selected && 'model-card--selected',
    disabled && 'model-card--disabled',
    !ready && 'model-card--none',
  ].filter(Boolean).join(' ');

  const handleClick = () => { if (!disabled && ready) onSelect(); };

  const p = noDownload ? undefined : progress[spec.downloadId as string];
  const percent = p && p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;

  return (
    <div className={classNames} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__radio" />
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{spec.name}</span>
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                {(spec.languages || []).map((l) => (<span key={l} className="model-card__lang-tag">{l}</span>))}
                {spec.note && <span className="model-card__lang-tag">{spec.note}</span>}
              </div>
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
 * groups of selectable + downloadable cards, matching LOCAL_INFERENCE's
 * ModelManagementSection. Models live in the sidecar's HF cache (server-side);
 * a card is selectable only once downloaded.
 */
export const NativeModelManagementSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const update = useUpdateLocalNative();
  const refresh = useNativeModelStore((s) => s.refresh);

  const asrCards = useMemo(() => nativeAsrCards(), []);
  const translationCards = useMemo(
    () => nativeTranslationCards(settings.sourceLanguage, settings.targetLanguage),
    [settings.sourceLanguage, settings.targetLanguage]);
  const ttsCards = useMemo(() => nativeTtsCards(settings.targetLanguage), [settings.targetLanguage]);

  // Refresh status for every card's download target so all cards render correctly.
  const allDownloadIds = useMemo(
    () => [...asrCards, ...translationCards, ...ttsCards].map((c) => c.downloadId).filter((x): x is string => !!x),
    [asrCards, translationCards, ttsCards]);
  const refreshKey = allDownloadIds.join('|');
  useEffect(() => { refresh(allDownloadIds); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey]);

  // TTS '' (default) highlights the default voice for the target language.
  const ttsSelected = (selectId: string) =>
    settings.ttsModel === selectId || (settings.ttsModel === '' && selectId === pickNativeTts(settings.targetLanguage));

  return (
    <div className="settings-section model-management-section">
      <h2>{t('models.management', 'Models')}</h2>

      <NativeModelGroup title={t('providers.local_native.asr', 'Speech recognition')}>
        {asrCards.map((c) => (
          <NativeModelCard key={c.selectId} spec={c} disabled={isSessionActive}
            selected={settings.asrModel === c.selectId} onSelect={() => update({ asrModel: c.selectId })} />
        ))}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.translation', 'Translation')}>
        {translationCards.map((c) => (
          <NativeModelCard key={c.selectId || 'qwen'} spec={c} disabled={isSessionActive}
            selected={settings.translationModel === c.selectId} onSelect={() => update({ translationModel: c.selectId })} />
        ))}
      </NativeModelGroup>

      <NativeModelGroup title={t('providers.local_native.speechOutput', 'Speech output')}>
        {ttsCards.map((c) => (
          <NativeModelCard key={c.selectId} spec={c} disabled={isSessionActive}
            selected={ttsSelected(c.selectId)} onSelect={() => update({ ttsModel: c.selectId })} />
        ))}
      </NativeModelGroup>
    </div>
  );
};

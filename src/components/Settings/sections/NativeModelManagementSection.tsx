import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle, Star, Zap, Trash2, X, AlertTriangle, CircleHelp } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import {
  nativeAsrCards,
  nativeAsrIncompatibleCards,
  nativeTranslationCards,
  nativeTtsCards,
  pickNativeTts,
  tierLabel,
  hardwareGated,
  gpuTierAvailable,
  formatRtf,
  type NativeModelCardSpec,
  type NativeSelection,
} from '../../../lib/local-inference/native/nativeCatalog';
import {
  useNativeModelStore,
  useNativeCatalog,
  useNativeModelStatuses,
  useNativeModelProgress,
  useNativeModelSizes,
  useNativeModelErrors,
  useNativeAsrResolved,
} from '../../../stores/nativeModelStore';
import { ModelGroup, RecommendedOthers, ModelStorageFooter } from './ModelManagementControls';

type Stage = 'asrModel' | 'translationModel' | 'ttsModel';

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
  const errors = useNativeModelErrors();
  const download = useNativeModelStore((s) => s.download);
  const cancelDownload = useNativeModelStore((s) => s.cancelDownload);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  const noDownload = spec.downloadId === null;
  const resolved = useNativeAsrResolved();
  const catalog = useNativeCatalog();
  const info = noDownload ? undefined : catalog[spec.downloadId as string];
  const activeTier = info?.tiers.find((x) => x.available) ?? info?.tiers[0];
  const hwGated = hardwareGated(info);

  const status = noDownload ? 'ready' : (statuses[spec.downloadId as string] || 'absent');
  const ready = noDownload || status === 'ready';
  const err = noDownload ? undefined : errors[spec.downloadId as string];

  const statusClass = noDownload ? 'model-card--none'
    : status === 'ready' ? 'model-card--downloaded'
    : status === 'downloading' ? 'model-card--downloading'
    : 'model-card--not_downloaded';
  const classNames = [
    'model-card', statusClass,
    selected && 'model-card--selected',
    (incompatible || hwGated) && 'model-card--incompatible',
    disabled && 'model-card--disabled',
    err && status !== 'downloading' && 'model-card--error',
  ].filter(Boolean).join(' ');

  const handleClick = () => { if (!disabled && !hwGated && ready) onSelect(); };

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
              {activeTier && (() => {
                const tl = tierLabel(activeTier.tier);
                return (
                  <span className="model-card__lang-tag">
                    {tl.accel && <Zap size={10} />}{tl.label}
                  </span>
                );
              })()}
              {resolved && resolved.model === spec.selectId && (
                <span className="model-card__lang-tag">
                  <Zap size={10} />{tierLabel(resolved.device === 'cpu' ? 'cpu' : `gpu-${resolved.device}`).label}
                  {resolved.rtf !== undefined ? ` · ${formatRtf(resolved.rtf)}` : ''}
                </span>
              )}
              {hwGated && <span className="model-card__lang-tag">Requires GPU</span>}
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
                  <button
                    className="model-card__btn model-card__btn--cancel"
                    onClick={(e) => { e.stopPropagation(); cancelDownload(spec.downloadId as string); }}
                    title={t('models.cancel', 'Cancel')}
                  >
                    <X size={12} />
                  </button>
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
          {err && status !== 'downloading' && (
            <div className="model-card__error-message">{err}</div>
          )}
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
  const catalog = useNativeCatalog();
  const statuses = useNativeModelStatuses();
  const sizes = useNativeModelSizes();
  const refresh = useNativeModelStore((s) => s.refresh);
  const refreshSizes = useNativeModelStore((s) => s.refreshSizes);
  const refreshCatalog = useNativeModelStore((s) => s.refreshCatalog);
  const autoSelect = useNativeModelStore((s) => s.autoSelect);
  const rememberModels = useNativeModelStore((s) => s.rememberModels);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  // Track which stages were last set by the reconciler (drives the Auto-selected badge).
  const [autoSelectedStages, setAutoSelectedStages] = useState<Record<Stage, boolean>>({
    asrModel: false, translationModel: false, ttsModel: false,
  });
  const [showAllAsr, setShowAllAsr] = useState(false);

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
    refreshCatalog();   // per-machine tier availability for the ASR badges
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

  // Recommended / Others split via the shared primitive; cards stay native-specific.
  const renderCards = (cards: NativeModelCardSpec[], isSelected: (c: NativeModelCardSpec) => boolean, field: Stage) => (
    <RecommendedOthers
      items={cards}
      isRecommended={(c) => !!c.recommended}
      renderItem={(c) => (
        <NativeModelCard key={c.selectId || 'auto'} spec={c} disabled={isSessionActive}
          selected={isSelected(c)} autoSelected={autoSelectedStages[field]}
          onSelect={() => selectCard(field, c.selectId)} />
      )}
    />
  );

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

      <ModelGroup id="model-asr" title={t('models.asrModels', 'ASR (Speech Recognition)')}>
        <div className="model-group__device-control">
          <div className="model-group__device-label">
            {t('models.computeDevice', 'Compute device')}
            <Tooltip
              content={t('models.computeDeviceTooltip', 'Which device runs the speech model. Auto picks the fastest available (GPU when present); CPU works everywhere but is slower for large models; GPU requires a CUDA GPU.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </div>
          {(() => {
            const gpuAvail = gpuTierAvailable(catalog);
            // Coerce a stale 'cuda' to 'auto' for display when no GPU tier is available.
            const deviceValue = settings.asrDevice === 'cuda' && !gpuAvail ? 'auto' : settings.asrDevice;
            const opts: Array<['auto' | 'cpu' | 'cuda', string]> = [
              ['auto', t('models.deviceAuto', 'Auto')],
              ['cpu', t('models.deviceCpu', 'CPU')],
              ...(gpuAvail ? [['cuda', t('models.deviceGpu', 'GPU')] as ['cuda', string]] : []),
            ];
            return (
              <div className="segmented-control">
                {opts.map(([mode, label]) => (
                  <button
                    key={mode}
                    className={`segmented-option ${deviceValue === mode ? 'active' : ''}`}
                    onClick={() => { if (deviceValue !== mode) update({ asrDevice: mode }); }}
                    disabled={isSessionActive}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
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
      </ModelGroup>

      <ModelGroup id="model-translation" title={t('models.translationModels', 'Translation')}>
        {renderCards(translationCards, (c) => settings.translationModel === c.selectId, 'translationModel')}
      </ModelGroup>

      <ModelGroup id="model-tts" title={t('models.ttsModels', 'TTS (Text-to-Speech)')}>
        {ttsCards.length > 0 ? (
          renderCards(ttsCards, (c) => ttsSelected(c.selectId), 'ttsModel')
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noTtsModel', 'No TTS model for {{language}}', { language: settings.targetLanguage })}
          </div>
        )}
      </ModelGroup>

      <ModelStorageFooter
        usedMb={usedMb}
        hasModels={readyIds.length > 0}
        onClearAll={() => Promise.all(readyIds.map((id) => deleteModel(id)))}
        disabled={isSessionActive}
      />
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle, Star, Zap, Trash2, X, AlertTriangle } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import {
  nativeAsrCards,
  nativeAsrIncompatibleCards,
  nativeTranslationCards,
  nativeTtsCards,
  voiceCapability,
  tierLabel,
  hardwareGated,
  formatRtf,
  formatTps,
  resolvedTierState,
  formatMemMb,
  statusReposFor,
  buildBackendTooltipRows,
  pinsFromSelections,
  type NativeModelCardSpec,
} from '../../../lib/local-inference/native/nativeCatalog';
import { NativeDeviceControl } from './NativeDeviceControl';
import { LanguageTags } from './LanguageTags';
import { directionKey, emptyDirection, splitDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { voiceStoreFor } from '../../../lib/local-inference/native/nativeVoiceStores';
import { languageNameFor } from '../engine/languageName';
import { TierIcon } from './TierIcon';
import LicenseConsentModal from '../shared/LicenseConsentModal';
import { hasAcceptedLicense, acceptLicense } from '../../../stores/licenseConsentStore';
import {
  useNativeModelStore,
  useNativeCatalog,
  useNativeModelStatuses,
  useNativeModelProgress,
  useNativeModelSizes,
  useNativeModelErrors,
  useNativeAsrResolved,
  useNativeTranslationResolved,
  useNativeTtsResolved,
  useNativeSidecarStatus,
  nativeListTtsVoices,
} from '../../../stores/nativeModelStore';
import type { VariantInfo, NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
import NativeVoiceSection from './NativeVoiceSection';

// The resolved plan a card may display: device + one speed metric + optional memory
// footprint and fallback reason. ASR carries rtf ("Nx realtime"), translation carries
// tokensPerSec ("N tok/s"); never both. memoryBytes and fallbackReason come from the
// native gate when it measured VRAM or moved the model off GPU. backend/computeType
// identify the actual inference engine + precision that served the request, feeding
// the tier-badge tooltip.
type CardResolved = {
  model: string; device: string; backend?: string; computeType?: string;
  rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string;
};
import { ModelGroup, RecommendedOthers, ModelStorageFooter } from './ModelManagementControls';

// [i18n key, English fallback] per tooltip row key (see buildBackendTooltipRows).
const TT_LABEL: Record<string, [string, string]> = {
  framework: ['models.hwFramework', 'Engine'],
  device: ['models.hwDevice', 'Device'],
  api: ['models.hwApi', 'Acceleration'],
  precision: ['models.hwPrecision', 'Precision'],
  speed: ['models.hwSpeed', 'Speed'],
  memory: ['models.hwMemory', 'Memory'],
  size: ['models.hwSize', 'Size'],
  repo: ['models.hwRepo', 'Repo'],
};

/** Props bundle for the optional variant chooser on multi-quant translation cards. */
type VariantCardProps = {
  variants: VariantInfo[];
  recommendedVariantId: string;
  pinnedVariantId?: string;
  onPinVariant: (id: string) => void;
};

/**
 * Compact quant-variant picker shown in a card header (in place of the size).
 * A customizable <select> (appearance: base-select): the closed control mirrors
 * the chosen variant + size (e.g. "FP8 · 8.0 GB") via <selectedcontent>; the
 * picker lists all variants with sizes — unsupported ones disabled with the
 * reason inline (a hover tooltip can't render above the top-layer picker) —
 * plus a "runs on CPU" note when no GPU variant fits.
 *
 * No classic-select fallback: local native models are Electron-only, and the
 * packaged Electron (Chromium 144) always renders base-select.
 */
const VariantDropdown: React.FC<{
  variantProps: VariantCardProps;
  chosenVariant?: VariantInfo;
  disabled: boolean;
  selectId: string;
}> = ({ variantProps, chosenVariant, disabled, selectId }) => {
  const { t } = useTranslation();

  const gpuFits = variantProps.variants.some((v) => v.supported);
  const chosenId = variantProps.pinnedVariantId ?? variantProps.recommendedVariantId;

  return (
    // stopPropagation: the surrounding .model-card selects the model on click.
    <div className="model-card__variant-dd" onClick={(e) => e.stopPropagation()}>
      <select
        className="model-card__variant-select"
        data-testid={`variant-dd-${selectId}`}
        disabled={disabled}
        value={chosenVariant ? chosenId : ''}
        onChange={(e) => {
          // The picker never lets a disabled option through; this guards the
          // programmatic/keyboard path the way the old menu's click handler
          // no-opped on unsupported rows.
          const v = variantProps.variants.find((x) => x.id === e.target.value);
          if (v?.supported) variantProps.onPinVariant(v.id);
        }}
      >
        <button type="button"><selectedcontent /></button>
        {!chosenVariant && (
          <option value="" disabled hidden>CPU</option>
        )}
        {variantProps.variants.map((v) => {
          const isRec = v.supported && v.id === variantProps.recommendedVariantId;
          const sizeLabel = formatMemMb(Math.round(v.sizeBytes / 1e6));
          return (
            <option
              key={v.id}
              value={v.id}
              disabled={!v.supported}
              data-testid={`variant-row-${v.id}`}
            >
              <span className="model-card__variant-name">
                {v.computeType.toUpperCase()}
                <span className="model-card__variant-size"> · {sizeLabel}</span>
              </span>
              {isRec && (
                <span className="model-card__variant-recommended">{t('models.recommended', 'Recommended').toLowerCase()}</span>
              )}
              {!v.supported && (
                <span className="model-card__variant-reason">{v.reason || t('models.wontFit', "Won't fit on this machine")}</span>
              )}
            </option>
          );
        })}
        {!gpuFits && (
          // A disabled option, not a bare <span>: the select content model
          // (and React's nesting validator) only admits option-shaped
          // children, and a span here would log the very warning class the
          // dev muffler exists to avoid adding to.
          <option disabled className="model-card__variant-cpu-note">
            {t('models.variantNoGpuFits', 'No GPU variant fits — runs on CPU.')}
          </option>
        )}
      </select>
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
  resolved?: CardResolved | null;
  onSelect: () => void;
  /** Present only for translation cards that expose multiple quant variants (per the catalog's variantIds). */
  variantProps?: VariantCardProps;
  /** Optional body rendered inside the card (below the top row) only while the card is selected. */
  children?: React.ReactNode;
}> = ({ spec, selected, autoSelected, disabled, incompatible = false, resolved = null, onSelect, variantProps, children }) => {
  const { t } = useTranslation();
  const statuses = useNativeModelStatuses();
  const progress = useNativeModelProgress();
  const sizes = useNativeModelSizes();
  const errors = useNativeModelErrors();
  const download = useNativeModelStore((s) => s.download);
  const cancelDownload = useNativeModelStore((s) => s.cancelDownload);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  const noDownload = spec.downloadId === null;
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

  const handleClick = () => { if (!disabled && !incompatible && !hwGated && ready) onSelect(); };

  const p = noDownload ? undefined : progress[spec.downloadId as string];
  const percent = p && p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;
  const bytes = noDownload ? 0 : sizes[spec.downloadId as string];
  const sizeMb = bytes && bytes > 0 ? Math.round(bytes / 1e6) : null;

  // The chosen variant (pinned, else recommended) for a multi-variant card — drives
  // both the resolved label and which repo the download button fetches.
  const chosenVariant = useMemo(() => {
    if (!variantProps) return undefined;
    const chosenId = variantProps.pinnedVariantId ?? variantProps.recommendedVariantId;
    return variantProps.variants.find((v) => v.id === chosenId);
  }, [variantProps]);

  // Resolved variant label shown post-download: "FP8 · 7.8 GB"
  const resolvedVariantLabel = useMemo(() => {
    if (!chosenVariant || !ready || sizeMb === null) return null;
    return `${chosenVariant.computeType.toUpperCase()} · ${formatMemMb(sizeMb)}`;
  }, [chosenVariant, ready, sizeMb]);

  // Non-commercial-licensed cards (spec.license.nonCommercial) gate the first
  // download behind an acknowledge modal — remembered per model id (Task 2 of
  // the OmniVoice license-consent plan). Everything else downloads immediately,
  // as before.
  const [consentOpen, setConsentOpen] = useState(false);

  // The download button fetches the chosen variant's repo (undefined → default repo,
  // for single-variant cards). Keeps download in lock-step with the variant load.
  const startDownload = () => download(spec.downloadId as string, chosenVariant?.repo);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (spec.license?.nonCommercial && !hasAcceptedLicense(spec.downloadId as string)) {
      setConsentOpen(true);
      return;
    }
    startDownload();
  };

  const handleAcceptLicense = () => {
    acceptLicense(spec.downloadId as string);
    setConsentOpen(false);
    // Re-check eligibility: state may have changed while the modal was open
    // (hardware gate flipped, another surface started/completed the download).
    // Mirrors the download button's own gating.
    if (disabled || hwGated || status === 'downloading' || status === 'ready') return;
    startDownload();
  };

  return (
    <div className={classNames} data-testid={`model-card-${spec.selectId}`} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{spec.name}</span>
              {resolvedVariantLabel !== null ? (
                // Post-download variant card: show resolved compute type + actual size.
                <span
                  className="model-card__size"
                  data-testid={`variant-resolved-${spec.selectId}`}
                >
                  {resolvedVariantLabel}
                </span>
              ) : variantProps && !ready ? (
                // Pre-download multi-variant card: compact dropdown picker, shown in the
                // standard header size slot (trigger displays the chosen variant + size).
                <VariantDropdown
                  variantProps={variantProps}
                  chosenVariant={chosenVariant}
                  disabled={disabled}
                  selectId={spec.selectId}
                />
              ) : (
                // Normal single-variant card: GB-aware label (formatMemMb switches
                // to GB at >= 1024 MB) — never a bare four-digit "MB".
                sizeMb !== null && (
                  <span className="model-card__size">{formatMemMb(sizeMb)}</span>
                )
              )}
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                <LanguageTags languages={spec.languages || []} />
                {spec.note && <span className="model-card__lang-tag">{spec.note}</span>}
              </div>
              {(() => {
                // The active card shows the RESOLVED device as a LIVE badge (highlighted,
                // colored: green when accelerated, warn when the gate moved it to CPU),
                // with the measured speed + memory. Idle cards show the muted catalog
                // capability tier. Match selectId OR downloadId (translation resolves to
                // its artifact id = downloadId).
                const showResolved = !!resolved && (resolved.model === spec.selectId || resolved.model === spec.downloadId);
                const view = showResolved ? resolvedTierState(resolved) : null;
                const tier = view ? view.tier : activeTier?.tier;
                if (!tier) return null;
                const tl = tierLabel(tier);
                let metric = '';
                if (showResolved && resolved) {
                  if (resolved.rtf !== undefined) metric = ` · ${formatRtf(resolved.rtf)}`;
                  else if (resolved.tokensPerSec !== undefined) metric = ` · ${formatTps(resolved.tokensPerSec)}`;
                  if (view?.memoryMb) metric += ` · ${formatMemMb(view.memoryMb)}`;
                }
                // --live = highlighted (any resolved stage); --accel = green (a GPU
                // tier, via tierLabel().accel); --warn = red (degraded CPU). A
                // chosen-CPU stage gets --live only → highlighted but neutral.
                const cls = 'model-card__lang-tag'
                  + (view ? ' model-card__lang-tag--live' : '')
                  + (view && !view.degraded && tl.accel ? ' model-card__lang-tag--accel' : '')
                  + (view?.degraded ? ' model-card__lang-tag--warn' : '');
                // Framework id for the tooltip: the loaded model's runtime backend
                // when resolved, else the catalog's best-tier backend. The fallback
                // assumes `ready.backend` is always present (sidecar + frontend ship
                // together); a resolved plan that omitted it would show the idle-tier
                // framework, which for a backend-varies-by-tier model could disagree
                // with a degraded device — not reachable with the bundled sidecar.
                const backendId = (showResolved && resolved?.backend) ? resolved.backend : activeTier?.backend;
                const ttRows = buildBackendTooltipRows({
                  tier,
                  backendId,
                  resolved: showResolved ? resolved : null,
                  sizeMb,
                  repo: chosenVariant?.repo ?? info?.repo,
                });
                return (
                  <>
                    <Tooltip
                      position="top"
                      icon="none"
                      content={
                        <div style={{ display: 'grid', gap: 2, textAlign: 'left', fontSize: 12, lineHeight: 1.35 }}>
                          {ttRows.map((r) => r.key === 'fallback' ? (
                            <div key={r.key} style={{ color: '#e74c3c' }}>⚠ {r.value}</div>
                          ) : (
                            <div key={r.key}>
                              <span style={{ opacity: 0.6 }}>{t(TT_LABEL[r.key]?.[0] ?? r.key, TT_LABEL[r.key]?.[1] ?? r.key)}</span>{`: ${r.value}`}
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <span className={cls}>
                        <TierIcon tier={tier} size={10} />{tl.label}{metric}
                      </span>
                    </Tooltip>
                    {view?.degraded && (
                      <span className="model-card__lang-tag model-card__lang-tag--warn"
                            title={resolved!.fallbackReason}>
                        ⚠ Low VRAM → CPU
                      </span>
                    )}
                  </>
                );
              })()}
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
          {/* The quant-variant picker now lives in the header (VariantDropdown). */}

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
                <span className={`model-card__status-label${selected ? ' model-card__status-label--active' : ''}`}>
                  <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                  <span>{selected ? t('models.active', 'Active') : t('models.downloaded', 'Downloaded')}</span>
                </span>
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); deleteModel(spec.downloadId as string, chosenVariant?.repo); }}
                  disabled={disabled}
                  title={t('models.delete', 'Delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ) : (
              <button
                className="model-card__btn model-card__btn--download"
                onClick={handleDownload}
                disabled={disabled || hwGated}
                title={hwGated ? t('models.requiresGpu', 'Requires a GPU') : t('models.download', 'Download')}
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
      {selected && children && (
        // stopPropagation so interacting with the body (e.g. the voice picker's
        // dropdown/buttons) does not bubble to the card root's onClick and re-select.
        <div className="model-card__body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
      {spec.license && (
        <LicenseConsentModal
          isOpen={consentOpen}
          license={spec.license}
          modelName={spec.name}
          onAccept={handleAcceptLicense}
          onClose={() => setConsentOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * Model management for LOCAL_NATIVE — collapsible ASR / Translation / Speech-output
 * groups of selectable + downloadable cards, matching LOCAL_INFERENCE's
 * ModelManagementSection. Models live in the sidecar's HF cache.
 *
 * Selecting a card writes `selections[dir][stage]` directly; auto-select
 * reconciliation for the language pair is owned by the global gate
 * (validateApiKey -> nativeModelStore.ensureSelectionReady), not this panel.
 */
export const NativeModelManagementSection: React.FC<{
  isSessionActive?: boolean;
  /** Render only this stage's group (used by the Engine surface's Library
   *  push, which is already scoped to one stage). Omitted = all three. */
  stageFilter?: Stage;
  /** The direction ("src→tgt") whose slot opened this Library push — see
   *  ModelManagementSection's prop of the same name. */
  direction?: string;
}> = ({ isSessionActive = false, stageFilter, direction }) => {
  const { t } = useTranslation();
  const settings = useLocalNativeSettings();
  const update = useUpdateLocalNative();
  const catalog = useNativeCatalog();
  const statuses = useNativeModelStatuses();
  const sizes = useNativeModelSizes();
  // Per-stage resolved plan (device + speed metric) from the last session ready.
  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  const ttsResolved = useNativeTtsResolved();
  const sidecarStatus = useNativeSidecarStatus();
  const refresh = useNativeModelStore((s) => s.refresh);
  const setStatusRepos = useNativeModelStore((s) => s.setStatusRepos);
  const refreshCatalog = useNativeModelStore((s) => s.refreshCatalog);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  const [showAllAsr, setShowAllAsr] = useState(false);

  // ONE pair drives everything below — the opening slot's direction when
  // this is a Library push, the settings' forward pair otherwise (see
  // ModelManagementSection's identical treatment).
  const [srcLang, tgtLang] = direction
    ? splitDirection(direction)
    : [settings.sourceLanguage, settings.targetLanguage];
  const dir = directionKey(srcLang, tgtLang);

  // Live, resolved view of "what would actually run right now" per stage —
  // computed from the catalog, current download/hardware state, and the
  // user's explicit `selections`. Mirrors ModelManagementSection.tsx's
  // equivalent `resolved` memo (the WASM provider). Card highlighting and the
  // "auto-selected" badge follow this — an explicit-but-not-yet-downloaded
  // pick shows the auto fallback as active until it resolves, exactly like
  // the WASM panel.
  const resolvedSelection = useMemo(
    () => useNativeModelStore.getState().resolve(srcLang, tgtLang, settings.selections),
    [statuses, catalog, srcLang, tgtLang, settings.selections],
  );
  const selectedAsr = resolvedSelection.asr?.modelId ?? '';
  const selectedTranslation = resolvedSelection.translation?.modelId ?? '';
  const selectedTts = resolvedSelection.tts?.modelId ?? '';

  const asrCards = useMemo(() => nativeAsrCards(srcLang, catalog), [srcLang, catalog]);
  const asrIncompatibleCards = useMemo(
    () => nativeAsrIncompatibleCards(srcLang, catalog), [srcLang, catalog]);
  const translationCards = useMemo(
    () => nativeTranslationCards(srcLang, tgtLang, catalog),
    [srcLang, tgtLang, catalog]);
  const ttsCards = useMemo(() => nativeTtsCards(tgtLang, catalog), [tgtLang, catalog]);

  // Quant-variant data comes PRECOMPUTED from the models_catalog feed — the
  // sidecar owns the full ladder per card with machine-aware supported flags
  // and the stable recommendation; no per-card list_variants round-trips.
  // Applies to every multi-quant card (ASR and translation alike).
  const variantData = useMemo(() => {
    const out: Record<string, { variants: VariantInfo[]; recommended: string }> = {};
    for (const [id, info] of Object.entries(catalog)) {
      const vs = info.variants;
      if (!vs || vs.length < 2) continue;
      // MiB, not decimal MB: need/have compare against GPU MEMORY, and every
      // other memory readout (estimate/actual/tier badge) divides by 1_048_576
      // — a 12 GiB card must read "12.0 GB", not "12.6 GB". Download-size
      // labels elsewhere in this file stay decimal (HF/disk convention).
      const have = info.deviceMemBytes
        ? formatMemMb(Math.round(info.deviceMemBytes / 1_048_576)) : null;
      out[id] = {
        variants: vs.map((v) => {
          const need = formatMemMb(Math.round((v.needBytes ?? v.sizeBytes) / 1_048_576));
          const reason = v.supported ? '' : (have
            ? t('models.variantWontFit',
                'Needs ~{{need}} of GPU memory — this machine has {{have}}', { need, have })
            : t('models.variantWontFitNoMem', 'Needs ~{{need}} of GPU memory', { need }));
          return {
            id: v.id, computeType: v.id, repo: v.repo ?? '', sizeBytes: v.sizeBytes,
            supported: v.supported, reason,
          };
        }),
        recommended: vs.find((v) => v.recommended)?.id ?? vs[0].id,
      };
    }
    return out;
  }, [catalog, t]);

  const reserveTtsId = selectedTts || null;

  // Voice picker: capability (Task 10) drives which control is shown — the
  // built-in shape (none/range/named) and which custom-voice backend applies
  // (none/clip-clone/style-import, Task 11's voiceStoreFor). Built-in names
  // come from the sidecar (best-effort; [] when the model isn't downloaded).
  // NativeVoiceSection owns loading/caching the custom-voice list itself
  // (via the injected `store`), so this component only needs to hand it the
  // store and re-fetch built-ins when the resolved model changes.
  const capability = voiceCapability(catalog[reserveTtsId || '']);
  const store = useMemo(
    () => voiceStoreFor(capability.custom, reserveTtsId || ''),
    [capability.custom, reserveTtsId],
  );
  const [builtinVoices, setBuiltinVoices] = useState<NativeVoiceInfo[]>([]);
  useEffect(() => {
    if (capability.builtin !== 'named') { setBuiltinVoices([]); return; }
    let cancelled = false;
    nativeListTtsVoices(reserveTtsId || undefined)
      .then((voices) => { if (!cancelled) setBuiltinVoices(voices); })
      .catch(() => { if (!cancelled) setBuiltinVoices([]); });
    return () => { cancelled = true; };
  }, [capability.builtin, reserveTtsId]);

  const allDownloadIds = useMemo(
    () => [...asrCards, ...asrIncompatibleCards, ...translationCards, ...ttsCards]
      .map((c) => c.downloadId).filter((x): x is string => !!x),
    [asrCards, asrIncompatibleCards, translationCards, ttsCards]);
  // Pins now live on the (direction, stage) that chose them, not a global
  // per-model map — collect EVERY direction's explicit (modelId, variant)
  // pairs into the modelId-keyed shape statusReposFor expects, not just the
  // direction currently on screen (mirrors nativeModelStore.ts's
  // catalogStatusRepos — a card's status must reflect a pin the user set on
  // another direction too, since the sidecar's status/repo protocol is keyed
  // by model id alone; pinsFromSelections's doc comment covers the resulting
  // collision rule).
  const pins = useMemo(
    () => pinsFromSelections(settings.selections, Object.keys(settings.selections)),
    [settings.selections]);
  const statusRepos = useMemo(
    () => statusReposFor(allDownloadIds, variantData, pins),
    [allDownloadIds, variantData, pins],
  );
  const refreshKey = allDownloadIds.join('|');
  // Variant-aware status: re-check downloaded state whenever the model list or the
  // chosen-variant repos change. Only publish/pass an override once we've actually
  // resolved repos — an empty {} would poison nativeModelStore's `repos ?? cache`
  // fallback (and the readiness gate that reads that cache), masking an
  // already-downloaded non-default quant until — or permanently if — variants load.
  useEffect(() => {
    const hasOverride = Object.keys(statusRepos).length > 0;
    if (hasOverride) setStatusRepos(statusRepos);
    refresh(allDownloadIds, hasOverride ? statusRepos : undefined);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey, JSON.stringify(statusRepos)]);
  // Per-machine tier availability (and sizes, which ride along with the catalog
  // response) are variant-independent — refresh them only when the model list
  // changes, not on every quant pick.
  useEffect(() => {
    refreshCatalog();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey]);

  // Explicit user selection: write `selections[dir][field] = { modelId }`,
  // preserving an existing variant pin for that stage ONLY when the modelId
  // is unchanged (a pin is scoped to the specific model it was chosen for —
  // switching models must not carry a stale quant choice along). Passing
  // `variant` writes it directly instead (the quant picker's path below) —
  // since a pin has nowhere else to live now, choosing one also makes that
  // model the stage's active selection. Auto-select reconciliation for the
  // language pair is owned by the global gate (validateApiKey), not this panel.
  const selectCard = useCallback((field: Stage, selectId: string, variant?: string) => {
    const current = settings.selections[dir] ?? emptyDirection();
    const prevStage = current[field];
    const nextVariant = variant !== undefined ? variant
      : prevStage.modelId === selectId ? prevStage.variant
      : undefined;
    update({
      selections: {
        ...settings.selections,
        [dir]: { ...current, [field]: nextVariant ? { modelId: selectId, variant: nextVariant } : { modelId: selectId } },
      },
    });
  }, [update, settings.selections, dir]);

  // Pick the download quant/variant for a card (asr/translation/tts alike).
  const handlePinVariant = useCallback((field: Stage, selectId: string, variantId: string) => {
    selectCard(field, selectId, variantId);
  }, [selectCard]);

  // The stage's raw stored pin for THIS card, regardless of readiness — the
  // variant dropdown/download button need to preview a pin for a card that
  // isn't downloaded (and so isn't the resolve()-driven active selection)
  // yet, unlike `selected*` above which reflects the resolved, auto-fallback-
  // aware pick.
  const pinnedVariantFor = (field: Stage, selectId: string): string | undefined => {
    const stageSel = settings.selections[dir]?.[field];
    return stageSel?.modelId === selectId ? stageSel.variant : undefined;
  };

  // One card, shared by the Recommended/Others split (renderCards, below) —
  // factored out (Task 8) so every render path builds a card identically.
  const renderCard = (
    c: NativeModelCardSpec,
    field: Stage,
    isSelected: (c: NativeModelCardSpec) => boolean,
    variantMap?: Record<string, { variants: VariantInfo[]; recommended: string }>,
    onPin?: (field: Stage, selectId: string, variantId: string) => void,
    renderBody?: (c: NativeModelCardSpec) => React.ReactNode,
  ) => {
    // Feed each card the resolved plan for its stage so the active model shows the
    // measured device + speed metric (ASR rtf / translation tok/s or tts rtf).
    const resolvedForField = field === 'asr' ? asrResolved
      : field === 'translation' ? translationResolved
      : field === 'tts' ? ttsResolved : null;
    const vd = variantMap?.[c.selectId];
    const pinnedVariantId = pinnedVariantFor(field, c.selectId);
    const vProps: VariantCardProps | undefined = vd ? {
      variants: vd.variants,
      recommendedVariantId: vd.recommended,
      pinnedVariantId,
      onPinVariant: (id: string) => onPin?.(field, c.selectId, id),
    } : undefined;
    return (
      <NativeModelCard key={c.selectId || 'auto'} spec={c} disabled={isSessionActive}
        selected={isSelected(c)} autoSelected={false} resolved={resolvedForField}
        onSelect={() => selectCard(field, c.selectId)}
        variantProps={vProps}>
        {renderBody?.(c)}
      </NativeModelCard>
    );
  };

  // Recommended / Others split via the shared primitive; cards stay native-specific.
  const renderCards = (
    cards: NativeModelCardSpec[],
    isSelected: (c: NativeModelCardSpec) => boolean,
    field: Stage,
    variantMap?: Record<string, { variants: VariantInfo[]; recommended: string }>,
    onPin?: (field: Stage, selectId: string, variantId: string) => void,
    renderBody?: (c: NativeModelCardSpec) => React.ReactNode,
  ) => (
    <RecommendedOthers
      items={cards}
      isRecommended={(c) => !!c.recommended}
      renderItem={(c) => renderCard(c, field, isSelected, variantMap, onPin, renderBody)}
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

  // Lifecycle gate — all hooks above; early returns are safe here.
  if (sidecarStatus === 'starting' || sidecarStatus === 'idle') {
    return <div className="native-models-loading">{t('settings.localNativeStarting', 'Starting the local engine')}</div>;
  }
  if (sidecarStatus === 'unavailable') {
    // The runtime error (+ retry) is rendered inside EngineSection's card — an
    // engine concern belongs on the engine surface, not floating down here.
    return null;
  }

  // Voice picker body for the selected TTS card, embedded via renderCards' renderBody.
  const renderTtsBody = () => (capability.builtin !== 'none' || capability.custom !== 'none' ? (
    <NativeVoiceSection
      capability={capability}
      builtinVoices={builtinVoices}
      store={store}
      selected={settings.ttsVoice}
      targetLanguage={tgtLang}
      isSessionActive={isSessionActive}
      onSelect={(id) => update({ ttsVoice: id })}
      // NativeVoiceSection owns and refreshes its own custom-voice list
      // (via `store`); nothing here needs to react to a change.
      onCustomChanged={() => {}}
    />
  ) : null);

  return (
    // See ModelManagementSection's identical comment: the Library push
    // (stageFilter set) already lives inside EngineSurface's own
    // .config-section shell + h3 header (Finding 3), so this standalone
    // section chrome (.settings-section + <h2>) would just duplicate it.
    <div id="model-management-section" className={stageFilter ? 'model-management-section' : 'settings-section model-management-section'}>
      {!stageFilter && <h2>{t('models.management', 'Models')}</h2>}

      {(!stageFilter || stageFilter === 'asr') && (
        <ModelGroup id="model-asr" title={t('models.asrModels', 'ASR (Speech Recognition)')}
          bare={!!stageFilter}
          aboveList={<NativeDeviceControl stage="asr" disabled={isSessionActive} />}>
          {renderCards(asrCards, (c) => selectedAsr === c.selectId, 'asr',
            variantData, handlePinVariant)}
          {asrIncompatibleCards.length > 0 && (
            <>
              <button className="model-group__show-all" onClick={() => setShowAllAsr(!showAllAsr)}>
                {showAllAsr ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showAllAsr
                  ? t('models.hideOther', 'Hide other models')
                  : t('models.showAllAsr', 'Show all ASR models ({{count}})', { count: asrIncompatibleCards.length })}
              </button>
              {showAllAsr && asrIncompatibleCards.map((c) => (
                <React.Fragment key={c.selectId}>
                  <NativeModelCard spec={c} disabled={isSessionActive} incompatible
                    selected={selectedAsr === c.selectId} autoSelected={false}
                    onSelect={() => selectCard('asr', c.selectId)} />
                  {c.downloadId && statuses[c.downloadId] === 'ready' && (
                    <div className="model-card__available-when-lang">
                      {t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.', {
                        lang: (c.languages || []).map((l) => languageNameFor(l)).join(', '),
                      })}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </>
          )}
        </ModelGroup>
      )}

      {(!stageFilter || stageFilter === 'translation') && (
        <ModelGroup id="model-translation" title={t('models.translationModels', 'Translation')}
          bare={!!stageFilter}
          aboveList={<NativeDeviceControl stage="translation" disabled={isSessionActive} />}>
          {renderCards(
            translationCards,
            (c) => selectedTranslation === c.selectId,
            'translation',
            variantData,
            handlePinVariant,
          )}
        </ModelGroup>
      )}

      {(!stageFilter || stageFilter === 'tts') && (
        <ModelGroup id="model-tts" title={t('models.ttsModels', 'TTS (Text-to-Speech)')}
          bare={!!stageFilter}
          aboveList={<NativeDeviceControl stage="tts" disabled={isSessionActive} />}>
          {ttsCards.length > 0 ? (
            // The voice picker is embedded inside the selected card via renderBody.
            // NativeModelCard only renders the body when the card is selected, and
            // `capability` reflects the resolved (selected) model's voice capability.
            renderCards(
              ttsCards,
              (c) => selectedTts === c.selectId,
              'tts',
              variantData,
              handlePinVariant,
              renderTtsBody,
            )
          ) : (
            <div className="model-card__no-model-warning">
              <AlertTriangle size={14} />
              {t('settings.noTtsModel', 'No TTS model for {{language}}', { language: tgtLang })}
            </div>
          )}
        </ModelGroup>
      )}

      {/* Storage owns Clear-all now (StoragePage) — this duplicate footer only
          belongs on the standalone (prop-less stageFilter) render; the Library
          push is already scoped to one stage and its gating differs. */}
      {!stageFilter && (
        <ModelStorageFooter
          usedMb={usedMb}
          hasModels={readyIds.length > 0}
          onClearAll={() => Promise.all(readyIds.map((id) => deleteModel(id, statusRepos[id])))}
          disabled={isSessionActive}
        />
      )}
    </div>
  );
};

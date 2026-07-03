import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, CheckCircle, Star, Zap, Trash2, X, AlertTriangle, CircleHelp, Ban } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { useLocalNativeSettings, useUpdateLocalNative, type LocalNativeSettings } from '../../../stores/settingsStore';
import {
  nativeAsrCards,
  nativeAsrIncompatibleCards,
  nativeTranslationCards,
  nativeTtsCards,
  pickNativeTts,
  resolveNativeTts,
  voiceCapability,
  tierLabel,
  hardwareGated,
  gpuTierAvailable,
  formatRtf,
  formatTps,
  resolvedTierState,
  formatMemMb,
  statusReposFor,
  type NativeModelCardSpec,
  type NativeSelection,
} from '../../../lib/local-inference/native/nativeCatalog';
import { voiceStoreFor } from '../../../lib/local-inference/native/nativeVoiceStores';
import { TierIcon } from './TierIcon';
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
  nativeListVariants,
  nativeListTtsVoices,
} from '../../../stores/nativeModelStore';
import type { VariantInfo, NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
import NativeVoiceSection from './NativeVoiceSection';

// The resolved plan a card may display: device + one speed metric + optional memory
// footprint and fallback reason. ASR carries rtf ("Nx realtime"), translation carries
// tokensPerSec ("N tok/s"); never both. memoryBytes and fallbackReason come from the
// native gate when it measured VRAM or moved the model off GPU.
type CardResolved = { model: string; device: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string };
import { ModelGroup, RecommendedOthers, ModelStorageFooter } from './ModelManagementControls';

type Stage = 'asrModel' | 'translationModel' | 'ttsModel';

/** Props bundle for the optional variant chooser on multi-quant translation cards. */
type VariantCardProps = {
  variants: VariantInfo[];
  recommendedVariantId: string;
  pinnedVariantId?: string;
  onPinVariant: (id: string) => void;
};

/**
 * Compact quant-variant picker shown in a card header (in place of the size). A trigger
 * shows the chosen variant + size (e.g. "FP8 · 8.0 GB"); clicking opens a menu listing all
 * variants with sizes — unsupported ones disabled with a reason, plus a "runs on CPU" note
 * when no GPU variant fits. A dropdown (rather than an inline button stack) keeps the card
 * short and scales as more quant formats are added.
 */
const VariantDropdown: React.FC<{
  variantProps: VariantCardProps;
  chosenVariant?: VariantInfo;
  disabled: boolean;
  selectId: string;
}> = ({ variantProps, chosenVariant, disabled, selectId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const gpuFits = variantProps.variants.some((v) => v.supported);
  const chosenId = variantProps.pinnedVariantId ?? variantProps.recommendedVariantId;
  const triggerLabel = chosenVariant
    ? `${chosenVariant.computeType.toUpperCase()} · ${formatMemMb(Math.round(chosenVariant.sizeBytes / 1e6))}`
    : 'CPU';

  return (
    <div className="model-card__variant-dd" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="model-card__variant-trigger"
        data-testid={`variant-dd-${selectId}`}
        disabled={disabled}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className="model-card__variant-trigger-value">{triggerLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="model-card__variant-menu" role="listbox">
          {variantProps.variants.map((v) => {
            const isChosen = v.supported && v.id === chosenId;
            const isRec = v.supported && v.id === variantProps.recommendedVariantId;
            const sizeLabel = formatMemMb(Math.round(v.sizeBytes / 1e6));
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={isChosen}
                data-testid={`variant-row-${v.id}`}
                className={'model-card__variant-item'
                  + (isChosen ? ' model-card__variant-item--chosen' : '')
                  + (!v.supported ? ' model-card__variant-item--unsupported' : '')}
                // aria-disabled (not the `disabled` attribute) so the row stays
                // hoverable — a disabled <button> suppresses pointer events for its
                // whole subtree, which would block the icon's tooltip. The click
                // handler already no-ops for unsupported variants.
                aria-disabled={!v.supported}
                onClick={(e) => {
                  e.stopPropagation();
                  if (v.supported) { variantProps.onPinVariant(v.id); setOpen(false); }
                }}
              >
                <span className="model-card__variant-name">
                  {isChosen && <span className="model-card__variant-check" aria-label="selected">✓ </span>}
                  {v.computeType.toUpperCase()}
                  <span className="model-card__variant-size"> · {sizeLabel}</span>
                </span>
                {isRec && (
                  <span className="model-card__variant-recommended">recommended</span>
                )}
                {!v.supported && (
                  // Muted "blocked" glyph mirrors the green "recommended" slot; the full
                  // reason shows in an instant (0ms) tooltip on hover.
                  <Tooltip content={v.reason || "Won't fit"} position="top" icon="none" openDelay={0}>
                    <span className="model-card__variant-unavailable" aria-label="won't fit">
                      <Ban size={13} />
                    </span>
                  </Tooltip>
                )}
              </button>
            );
          })}
          {!gpuFits && (
            <span className="model-card__variant-cpu-note">No GPU variant fits — runs on CPU.</span>
          )}
        </div>
      )}
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

  const handleClick = () => { if (!disabled && !hwGated && ready) onSelect(); };

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

  // The download button fetches the chosen variant's repo (undefined → default repo,
  // for single-variant cards). Keeps download in lock-step with the variant load.
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    download(spec.downloadId as string, chosenVariant?.repo);
  };

  return (
    <div className={classNames} data-testid={`model-card-${spec.selectId}`} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__radio" />
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
                {(spec.languages || []).map((l) => (<span key={l} className="model-card__lang-tag">{l}</span>))}
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
                return (
                  <>
                    <span className={cls}>
                      <TierIcon tier={tier} size={10} />{tl.label}{metric}
                    </span>
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
                <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                <span>{t('models.downloaded', 'Downloaded')}</span>
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
 * remembered history (so a src↔tgt swap recalls the reverse pair). Selecting a
 * card also records the choice for that direction.
 */
export const NativeModelManagementSection: React.FC<{ isSessionActive?: boolean }> = ({ isSessionActive = false }) => {
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
  const rememberModels = useNativeModelStore((s) => s.rememberModels);
  const deleteModel = useNativeModelStore((s) => s.deleteModel);

  const [showAllAsr, setShowAllAsr] = useState(false);

  // Variant quant data for multi-variant translation cards (per catalog variantIds), keyed by selectId.
  const [variantData, setVariantData] = useState<Record<string, { variants: VariantInfo[]; recommended: string }>>({});
  // The manual variant pin is a per-model map (settings.translationVariantByModel),
  // keyed by model id. Each card reads its own entry; download + load use the same value.

  const asrCards = useMemo(() => nativeAsrCards(settings.sourceLanguage, catalog), [settings.sourceLanguage, catalog]);
  const asrIncompatibleCards = useMemo(
    () => nativeAsrIncompatibleCards(settings.sourceLanguage, catalog), [settings.sourceLanguage, catalog]);
  const translationCards = useMemo(
    () => nativeTranslationCards(settings.sourceLanguage, settings.targetLanguage, catalog),
    [settings.sourceLanguage, settings.targetLanguage, catalog]);
  const ttsCards = useMemo(() => nativeTtsCards(settings.targetLanguage, catalog), [settings.targetLanguage, catalog]);

  // Translation cards with multiple quant variants get the picker. Data-driven
  // from the sidecar catalog's variantIds — the sidecar owns which cards have
  // a quant ladder (all llama.cpp GGUF cards today).
  const variantCardIds = useMemo(
    () => translationCards.filter((c) => (c.variantIds?.length ?? 0) > 1).map((c) => c.selectId),
    [translationCards],
  );

  // Fetch variant availability for each multi-variant card whenever the pipeline context changes
  // (asrModel/ttsModel determine how much VRAM is reserved for other stages). Pass the
  // RESOLVED tts id (e.g. 'piper-en') — the same id LOAD's _h_translate_init reserves on —
  // so download-time and load-time select_variant compute the identical reserve, else a
  // razor VRAM edge could flip the variant between the two.
  const reserveTtsId = resolveNativeTts(settings.ttsModel, settings.targetLanguage, catalog) || null;
  const variantFetchKey = [variantCardIds.join('|'), settings.asrModel, reserveTtsId].join('::');
  useEffect(() => {
    if (variantCardIds.length === 0) return;
    let cancelled = false;
    for (const id of variantCardIds) {
      nativeListVariants(id, settings.asrModel || null, reserveTtsId)
        .then((result) => {
          if (!cancelled) setVariantData((prev) => ({ ...prev, [id]: result }));
        })
        .catch(() => {
          // best-effort: sidecar may be down; variant chooser simply not shown
        });
    }
    return () => { cancelled = true; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [variantFetchKey]);

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
  const statusRepos = useMemo(
    () => statusReposFor(allDownloadIds, variantData, settings.translationVariantByModel),
    [allDownloadIds, variantData, settings.translationVariantByModel],
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

  // TTS '' (default) highlights the default voice for the target language.
  const ttsSelected = (selectId: string) =>
    settings.ttsModel === selectId || (settings.ttsModel === '' && selectId === pickNativeTts(settings.targetLanguage, catalog));

  // Explicit user selection: write the choice and remember the full selection for
  // this direction (mirrors ModelManagementSection). Auto-select reconciliation is
  // owned by the global gate (validateApiKey / Task 10), not this panel.
  const selectCard = (field: Stage, selectId: string) => {
    const updates: Partial<LocalNativeSettings> = { [field]: selectId };
    update(updates);
    const sel: NativeSelection = {
      asrModel: settings.asrModel, translationModel: settings.translationModel, ttsModel: settings.ttsModel,
      [field]: selectId,
    };
    rememberModels(settings.sourceLanguage, settings.targetLanguage, sel);
  };

  // Pick the download quant for a card — a per-model setting only. Does NOT change
  // the active translation model (so the auto-select reconcile never fires on a pick).
  const handlePinVariant = useCallback((selectId: string, variantId: string) => {
    update({ translationVariantByModel: { ...settings.translationVariantByModel, [selectId]: variantId } });
  }, [update, settings.translationVariantByModel]);

  // Recommended / Others split via the shared primitive; cards stay native-specific.
  const renderCards = (
    cards: NativeModelCardSpec[],
    isSelected: (c: NativeModelCardSpec) => boolean,
    field: Stage,
    variantMap?: Record<string, { variants: VariantInfo[]; recommended: string }>,
    onPin?: (selectId: string, variantId: string) => void,
    renderBody?: (c: NativeModelCardSpec) => React.ReactNode,
  ) => {
    // Feed each card the resolved plan for its stage so the active model shows the
    // measured device + speed metric (ASR rtf / translation tok/s or tts rtf).
    const resolvedForField = field === 'asrModel' ? asrResolved
      : field === 'translationModel' ? translationResolved
      : field === 'ttsModel' ? ttsResolved : null;
    return (
      <RecommendedOthers
        items={cards}
        isRecommended={(c) => !!c.recommended}
        renderItem={(c) => {
          const vd = variantMap?.[c.selectId];
          const pinnedVariantId = settings.translationVariantByModel[c.selectId];
          const vProps: VariantCardProps | undefined = vd ? {
            variants: vd.variants,
            recommendedVariantId: vd.recommended,
            pinnedVariantId,
            onPinVariant: (id: string) => onPin?.(c.selectId, id),
          } : undefined;
          return (
            <NativeModelCard key={c.selectId || 'auto'} spec={c} disabled={isSessionActive}
              selected={isSelected(c)} autoSelected={false} resolved={resolvedForField}
              onSelect={() => selectCard(field, c.selectId)}
              variantProps={vProps}>
              {renderBody?.(c)}
            </NativeModelCard>
          );
        }}
      />
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

  // Lifecycle gate — all hooks above; early returns are safe here.
  if (sidecarStatus === 'starting' || sidecarStatus === 'idle') {
    return <div className="native-models-loading">{t('settings.localNativeStarting', 'Starting the local engine')}</div>;
  }
  if (sidecarStatus === 'unavailable') {
    return (
      <div className="native-models-error">
        <span>{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</span>
        <button type="button" onClick={() => useNativeModelStore.getState().retrySidecar()}>
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

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
        <div className="model-group__device-control">
          <div className="model-group__device-label">
            {t('models.computeDevice', 'Compute device')}
            <Tooltip
              content={t('models.computeDeviceTooltipTranslation', 'Which device runs the translation model. Auto picks the fastest available (GPU when present); CPU works everywhere but is slower for large models; GPU requires a CUDA GPU.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </div>
          {(() => {
            const gpuAvail = gpuTierAvailable(catalog);
            const deviceValue = settings.translationDevice === 'cuda' && !gpuAvail ? 'auto' : settings.translationDevice;
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
                    onClick={() => { if (deviceValue !== mode) update({ translationDevice: mode }); }}
                    disabled={isSessionActive}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
        {renderCards(
          translationCards,
          (c) => settings.translationModel === c.selectId,
          'translationModel',
          variantData,
          handlePinVariant,
        )}
      </ModelGroup>

      <ModelGroup id="model-tts" title={t('models.ttsModels', 'TTS (Text-to-Speech)')}>
        <div className="model-group__device-control">
          <div className="model-group__device-label">
            {t('models.computeDevice', 'Compute device')}
            <Tooltip
              content={t('models.computeDeviceTooltipTts', 'Which device runs the speech-synthesis model. Auto picks the fastest available (GPU when present); CPU works everywhere but is slower for large models; GPU requires a CUDA GPU.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </div>
          {(() => {
            const gpuAvail = gpuTierAvailable(catalog);
            const deviceValue = settings.ttsDevice === 'cuda' && !gpuAvail ? 'auto' : settings.ttsDevice;
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
                    onClick={() => { if (deviceValue !== mode) update({ ttsDevice: mode }); }}
                    disabled={isSessionActive}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
        {ttsCards.length > 0 ? (
          // The voice picker is embedded inside the selected card via renderBody.
          // NativeModelCard only renders the body when the card is selected, and
          // `capability` reflects the resolved (selected) model's voice capability.
          renderCards(
            ttsCards,
            (c) => ttsSelected(c.selectId),
            'ttsModel',
            undefined,
            undefined,
            () => (capability.builtin !== 'none' || capability.custom !== 'none' ? (
              <NativeVoiceSection
                capability={capability}
                numSpeakers={catalog[reserveTtsId || '']?.numSpeakers}
                builtinVoices={builtinVoices}
                store={store}
                selected={settings.ttsVoice}
                targetLanguage={settings.targetLanguage}
                isSessionActive={isSessionActive}
                onSelect={(id) => update({ ttsVoice: id })}
                // NativeVoiceSection owns and refreshes its own custom-voice list
                // (via `store`); nothing here needs to react to a change.
                onCustomChanged={() => {}}
              />
            ) : null),
          )
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
        onClearAll={() => Promise.all(readyIds.map((id) => deleteModel(id, statusRepos[id])))}
        disabled={isSessionActive}
      />
    </div>
  );
};

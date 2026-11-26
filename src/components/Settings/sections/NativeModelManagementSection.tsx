import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, FolderInput, CheckCircle, Star, Zap, Trash2, X, AlertTriangle } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import type { NativeEngineSettings } from '../engine/useNativeEngineAdapter';
import type { LanguagePair } from '../../../lib/run/types';
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
import { NativeImportModal } from './NativeImportModal';
import { GradeHelp, SpeedHelp } from './AsrFactsHelp';
import { hasAcceptedLicense, acceptLicense } from '../../../stores/licenseConsentStore';
import {
  useNativeModelStore,
  useNativeCatalog,
  useNativeModelStatuses,
  useNativeModelProgress,
  useNativeModelSizes,
  useNativeModelErrors,
  useNativeModelErrorInfo,
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
import { ModelStageList } from '../shared/ModelStageList';
import { asrFacts, asrRoles, catalogModelFor, roleOf, SPEED_METER_STEPS, type AsrFacts, type AsrRole } from '../../../lib/local-inference/native/asrBenchmarks';

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

/** English for each refusal the engine codes (`models.importError.<code>`), with the placeholders its params fill. */
const IMPORT_ERROR_TEXT: Record<string, string> = {
  import_missing: 'These files are missing: {{names}}. Download them and import again.',
  import_not_gguf: '{{name}} is not a GGUF model file.',
  import_unreadable: '{{name}} cannot be read, or is empty.',
  import_mismatch: '{{name}} is not the published file (its sha256 starts {{got}}, expected {{expected}}). Download it again.',
  import_not_importable: 'This model cannot be imported by hand.',
  import_failed: 'The import failed.',
};

/** Props bundle for the optional variant chooser on multi-quant translation cards. */
type VariantCardProps = {
  variants: VariantInfo[];
  recommendedVariantId: string;
  pinnedVariantId?: string;
  onPinVariant: (id: string) => void;
};

// One selectable + downloadable card — reuses ModelManagementSection's model-card__* classes.
/**
 * Invisible: each state a card's buttons can be in (Download and Import; Active or Downloaded with Delete), laid over
 * one another, so a recognition card's button column is as wide as the widest of them in this language, whatever
 * state the card is in — and the accuracy grades and speed meter beside it sit in the same place on every card
 * (owner, 2026-11-27). Real buttons, so they take the same styles as the ones they stand for; hidden, never focused.
 */
const ActionsSizer: React.FC = () => {
  const { t } = useTranslation();
  const state = (active: boolean) => (
    <span className="model-card__downloaded">
      <span className={`model-card__status-label${active ? ' model-card__status-label--active' : ''}`}>
        <span className="model-card__status-icon"><CheckCircle size={14} /></span>
        <span>{active ? t('models.active', 'Active') : t('models.downloaded', 'Downloaded')}</span>
      </span>
      <button type="button" tabIndex={-1} className="model-card__btn model-card__btn--delete"><Trash2 size={12} /></button>
    </span>
  );
  return (
    <span className="model-card__actions-sizer" aria-hidden="true" data-testid="actions-sizer">
      <span className="model-card__offer">
        <button type="button" tabIndex={-1} className="model-card__btn model-card__btn--download"><Download size={14} /><span>{t('models.download', 'Download')}</span></button>
        <button type="button" tabIndex={-1} className="model-card__btn model-card__btn--import"><FolderInput size={14} /><span>{t('models.import', 'Import')}</span></button>
      </span>
      {state(true)}
      {state(false)}
    </span>
  );
};

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
  /** A recognition card's measured facts and its badge (Recommended or Faster), from the catalog Handy shows its list from. */
  asr?: { facts?: AsrFacts; badge?: AsrRole; languages: readonly string[] };
  children?: React.ReactNode;
}> = ({ spec, selected, autoSelected, disabled, incompatible = false, resolved = null, onSelect, variantProps, asr, children }) => {
  const { t } = useTranslation();
  const statuses = useNativeModelStatuses();
  const progress = useNativeModelProgress();
  const sizes = useNativeModelSizes();
  const errors = useNativeModelErrors();
  const errorInfo = useNativeModelErrorInfo();
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
  const rawErr = noDownload ? undefined : errors[spec.downloadId as string];
  // An import the engine refused says why in the interface's language; any other failure keeps the engine's own words.
  const coded = noDownload ? undefined : errorInfo[spec.downloadId as string];
  const err = rawErr && coded ? t(`models.importError.${coded.code}`, IMPORT_ERROR_TEXT[coded.code] ?? rawErr, coded.params) : rawErr;

  const statusClass = noDownload ? 'model-card--none'
    : status === 'ready' ? 'model-card--downloaded'
    : status === 'downloading' ? 'model-card--downloading'
    : 'model-card--not_downloaded';
  const classNames = [
    'model-card', statusClass,
    selected && 'model-card--selected',
    (incompatible || hwGated) && 'model-card--incompatible',
    disabled && 'model-card--disabled',
    err && status !== 'downloading' && 'model-card--error model-card--error-below',
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

  // Cards whose license needs acknowledging (spec.license.requiresConsent) gate
  // the first download behind an acknowledge modal — remembered per model id
  // (Task 2 of the OmniVoice license-consent plan). Everything else downloads
  // immediately, as before. The trigger is requiresConsent and NOT nonCommercial:
  // IndexTTS 2.5's bilibili Model Use License permits commercial use below a
  // MAU/revenue ceiling yet still has to be acknowledged, and gating on
  // nonCommercial would either skip its gate or mislabel it in the modal.
  // nonCommercial only decides which wording LicenseConsentModal shows.
  //
  // Tested `!== false`, not truthily: the Python side always emits the field
  // (default True), but a producer that omitted it would otherwise silently drop
  // OmniVoice's gate. A license descriptor is opt-OUT of the gate, never opt-in.
  const [consentOpen, setConsentOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // The download button fetches the chosen variant's repo (undefined → default repo,
  // for single-variant cards). Keeps download in lock-step with the variant load.
  const startDownload = () => download(spec.downloadId as string, chosenVariant?.repo);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (spec.license && spec.license.requiresConsent !== false && !hasAcceptedLicense(spec.downloadId as string)) {
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
                // Pre-download multi-variant card: the one quant a download fetches (the recommended one, or the
                // one an earlier version pinned), named with its size. There is no picker: the list shows one quant
                // per model (owner, 2026-11-27, as Handy does).
                chosenVariant && (
                  <span className="model-card__size" data-testid={`variant-label-${spec.selectId}`}>
                    {`${chosenVariant.computeType.toUpperCase()} · ${formatMemMb(Math.round((chosenVariant.sizeBytes ?? 0) / 1e6))}`}
                  </span>
                )
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
                {(spec.streaming || asr?.facts?.streaming) && <span className="model-card__lang-tag" data-testid={`streaming-${spec.selectId}`}>{t('models.streaming', 'Streaming')}</span>}
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
                            <div key={r.key} style={{ color: 'var(--sk-error)' }}>⚠ {r.value}</div>
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
              {(asr ? asr.badge === 'recommended' : spec.recommended) && (
                <span className="model-card__recommended-badge">
                  <Star size={10} />
                  {t('models.recommended', 'Recommended')}
                </span>
              )}
              {asr?.badge === 'faster' && (
                <span className="model-card__recommended-badge" data-testid={`faster-${spec.selectId}`}>
                  <Zap size={10} />
                  {t('models.faster', 'Faster')}
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
          {asr && (
            <div className="model-card__bench">
              {asr.languages.map((language, i) => {
                const grade = asr.facts?.grades[i]?.grade;
                const name = languageNameFor(language);
                return (
                  <Tooltip key={language} position="top" icon="none" maxWidth={320}
                    content={<GradeHelp language={name} grade={grade} error={asr.facts?.grades[i]?.error} />}>
                    <span className="model-card__grade" data-testid={`grade-${spec.selectId}-${language}`}>
                      <span className="model-card__grade-lang">{language.toUpperCase()}</span>
                      <span className="model-card__grade-letter">{grade ?? '—'}</span>
                    </span>
                  </Tooltip>
                );
              })}
              <Tooltip position="top" icon="none" maxWidth={320}
                content={<SpeedHelp level={asr.facts?.speed} waitSeconds={asr.facts?.waitSeconds} />}>
                <span className="model-card__speed" role="img" data-testid={`speed-${spec.selectId}`}
                  aria-label={asr.facts?.speed === undefined ? t('models.speedNone', 'Speed was not measured')
                    : t('models.speedHelp.title', 'Speed: {{level}} of {{max}}', { level: asr.facts.speed, max: SPEED_METER_STEPS })}>
                  {Array.from({ length: SPEED_METER_STEPS }, (_, n) => (
                    <i key={n} className={n < (asr.facts?.speed ?? 0) ? 'on' : undefined} />
                  ))}
                </span>
              </Tooltip>
            </div>
          )}
          <div className={`model-card__actions${asr ? ' model-card__actions--aligned' : ''}`}>
            {asr && <ActionsSizer />}
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
              <div className="model-card__offer">
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={handleDownload}
                  disabled={disabled || hwGated}
                  title={hwGated ? t('models.requiresGpu', 'Requires a GPU') : t('models.download', 'Download')}
                >
                  <Download size={14} />
                  <span>{t('models.download', 'Download')}</span>
                </button>
                {!incompatible && (
                  <button
                    className="model-card__btn model-card__btn--import"
                    onClick={(e) => { e.stopPropagation(); setImportOpen(true); }}
                    disabled={disabled || hwGated}
                    title={t('models.importTitle', 'Import model')}
                    aria-label={`${t('models.import', 'Import')}: ${spec.name}`}
                  >
                    <FolderInput size={14} />
                    <span>{t('models.import', 'Import')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {err && status !== 'downloading' && (
        // Below the row, full width: beside the info and the buttons it would push them down.
        <div className="model-card__error-message" role="alert">{err}</div>
      )}
      {selected && children && (
        // stopPropagation so interacting with the body (e.g. the voice picker's
        // dropdown/buttons) does not bubble to the card root's onClick and re-select.
        <div className="model-card__body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
      <NativeImportModal isOpen={importOpen} onClose={() => setImportOpen(false)}
        modelId={spec.downloadId as string} modelName={spec.name} repo={chosenVariant?.repo} />
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
  /** The host's settings, its writer, and its pair (#578): Local Native's `Engine`. */
  settings: NativeEngineSettings;
  update: (patch: Partial<NativeEngineSettings>) => void;
  pair: LanguagePair;
  /** The element id of the stage's list, for the page's jump target (`<anchor>-section`). */
  anchorId?: string;
}> = ({ isSessionActive = false, stageFilter, direction, settings, update, pair, anchorId }) => {
  const { t } = useTranslation();
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
  // this is a Library push, the host's forward pair otherwise (see
  // ModelManagementSection's identical treatment).
  const [srcLang, tgtLang] = direction
    ? splitDirection(direction)
    : [pair.source, pair.target];
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

  // The languages the list speaks about, and which recognition model is the pick (Recommended) or the quick one
  // (Faster) for them, by the catalog's method. Where the catalog picks none of the cards on offer (a language
  // pair it has no data for) the cards keep the Recommended mark our own catalog gave them, so the list never starts
  // out empty.
  const asrLanguages = useMemo(() => [...new Set([srcLang, tgtLang])], [srcLang, tgtLang]);
  const asrPicks = useMemo(() => asrRoles(asrLanguages), [asrLanguages]);
  const asrBadge = (c: NativeModelCardSpec): AsrRole | undefined => {
    const info = catalog[c.selectId];
    const role = info ? roleOf(info, asrPicks) : undefined;
    if (role) return role;
    const anyPicked = asrCards.some((x) => { const i = catalog[x.selectId]; return i && roleOf(i, asrPicks); });
    return !anyPicked && c.recommended ? 'recommended' : undefined;
  };

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
            supported: v.supported, reason, downloaded: v.downloaded,
            unsupportedTiers: v.unsupportedTiers,
          };
        }),
        // A recognition model downloads the one quant its published accuracy was measured on (as Handy does), so the
        // grade shown is the grade of the file that runs; any other model keeps the machine-aware pick of the engine.
        recommended: (() => {
          const measured = info.kind === 'asr' ? catalogModelFor(info)?.quant.toLowerCase() : undefined;
          return (measured && vs.some((v) => v.id === measured) ? measured : undefined) ?? vs.find((v) => v.recommended)?.id ?? vs[0].id;
        })(),
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
        variantProps={vProps}
        asr={field === 'asr' ? { facts: catalog[c.selectId] ? asrFacts(catalog[c.selectId], asrLanguages) : undefined, badge: asrBadge(c), languages: asrLanguages } : undefined}>
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
      // The card's own id + languages -- Task 7's preview synthesis dials
      // this exact model, and drives which language the preview sentence is
      // spoken in.
      ttsModelId={reserveTtsId || ''}
      ttsLanguages={catalog[reserveTtsId || '']?.languages ?? []}
      isSessionActive={isSessionActive}
      onSelect={(id) => update({ ttsVoice: id })}
      // NativeVoiceSection owns and refreshes its own custom-voice list
      // (via `store`); nothing here needs to react to a change.
      onCustomChanged={() => {}}
    />
  ) : null);

  // On Local models and storage (a stage named): the same list as the WASM/WebGPU engine's — the stage's title, what is on disk
  // and the recommended models shown, the rest folded under "N more", the models of other languages last.
  if (stageFilter) {
    const cfg = {
      asr: {
        title: t('models.page.tag.asr', 'Recognition'), cards: asrCards, selected: selectedAsr, body: undefined,
        device: <NativeDeviceControl stage="asr" value={settings.asrDevice} onChange={(asrDevice) => update({ asrDevice })} disabled={isSessionActive} />,
      },
      translation: {
        title: t('models.page.tag.translation', 'Translation'), cards: translationCards, selected: selectedTranslation, body: undefined,
        device: <NativeDeviceControl stage="translation" value={settings.translationDevice} onChange={(translationDevice) => update({ translationDevice })} disabled={isSessionActive} />,
      },
      tts: {
        title: t('models.page.tag.tts', 'Speech'), cards: ttsCards, selected: selectedTts, body: renderTtsBody,
        device: <NativeDeviceControl stage="tts" value={settings.ttsDevice} onChange={(ttsDevice) => update({ ttsDevice })} disabled={isSessionActive} />,
      },
    }[stageFilter];
    const card = (c: NativeModelCardSpec) => (
      <div key={c.selectId || 'auto'} className="models-card">
        {renderCard(c, stageFilter, (x) => cfg.selected === x.selectId, variantData, handlePinVariant, cfg.body)}
      </div>
    );
    const onDisk = (c: NativeModelCardSpec) => !!c.downloadId && statuses[c.downloadId] === 'ready';
    const isShown = (c: NativeModelCardSpec) => onDisk(c) || (stageFilter === 'asr' ? !!asrBadge(c) : !!c.recommended) || cfg.selected === c.selectId;
    const incompatible = stageFilter === 'asr' ? asrIncompatibleCards : [];
    return (
      <ModelStageList title={cfg.title} id={anchorId ?? `native-models-${stageFilter}-section`} header={cfg.device}
        shown={cfg.cards.filter(isShown).map(card)} rest={cfg.cards.filter((c) => !isShown(c)).map(card)}
        others={incompatible.map((c) => (
          <div key={c.selectId} className="models-card">
            <NativeModelCard spec={c} disabled={isSessionActive} incompatible
              selected={selectedAsr === c.selectId} autoSelected={false}
              onSelect={() => selectCard('asr', c.selectId)} />
            {onDisk(c) && (
              <div className="model-card__available-when-lang">
                {t('engineUi.availableWhenLang', 'Downloaded. Available when your language is {{lang}}.', {
                  lang: (c.languages || []).map((l) => languageNameFor(l)).join(', '),
                })}
              </div>
            )}
          </div>
        ))} />
    );
  }

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
          aboveList={<NativeDeviceControl stage="asr" value={settings.asrDevice} onChange={(asrDevice) => update({ asrDevice })} disabled={isSessionActive} />}>
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
          aboveList={<NativeDeviceControl stage="translation" value={settings.translationDevice} onChange={(translationDevice) => update({ translationDevice })} disabled={isSessionActive} />}>
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
          aboveList={<NativeDeviceControl stage="tts" value={settings.ttsDevice} onChange={(ttsDevice) => update({ ttsDevice })} disabled={isSessionActive} />}>
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

      {/* The Local models and storage page owns Clear-all now — this duplicate footer only
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

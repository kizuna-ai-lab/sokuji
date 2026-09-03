import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, HardDrive } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { SlotRow } from './SlotRow';
import type { AudioMode } from '../../../stores/audioStore';
import { supportsBaseSelect } from '../../../utils/supportsBaseSelect';
import './Engine.scss';

/** Short stage labels (ASR / MT / TTS) — used where space is tight: the
 *  pushed Library title in EngineSurface ("Library · ASR"). */
export const STAGE_LABEL_KEY: Record<string, [string, string]> = {
  asr: ['providers.local_inference.modelAsr', 'ASR'],
  translation: ['providers.local_inference.modelTranslation', 'MT'],
  tts: ['providers.local_inference.modelTts', 'TTS'],
};

/** Full stage names for the slot rows — the same keys the standalone model
 *  sections title their groups with ("Speech Recognition (ASR)", …), so the
 *  Engine page and the Library speak the same words for a stage. */
export const STAGE_FULL_LABEL_KEY: Record<string, [string, string]> = {
  asr: ['models.asrModels', 'Speech Recognition (ASR)'],
  translation: ['models.translationModels', 'Translation (MT)'],
  tts: ['models.ttsModels', 'Speech Synthesis (TTS)'],
};

/** The abbreviations the model chips already use ("ASR" / "MT" / "TTS"). A
 *  narrow panel shows these instead of the full label — see SlotRow and the
 *  container query in Engine.scss — so the label column stops wrapping. */
export const STAGE_SHORT_LABEL_KEY: Record<string, [string, string]> = {
  asr: ['providers.local_inference.modelAsr', 'ASR'],
  translation: ['providers.local_inference.modelTranslation', 'MT'],
  tts: ['providers.local_inference.modelTts', 'TTS'],
};

/** The dropdown option value that means "push the Library" — never a model
 *  id (manifest/catalog ids are lowercase-kebab, this is namespaced). */
export const BROWSE_OPTION_VALUE = '__browse__';

/**
 * The Engine overview (dropdown form, 2026-08-23 A decision): per slot one
 * label + <select> row — the same select-dropdown family the Provider
 * section uses, replacing the accordion. Auto is the first option and shows
 * the resolved pick; "Browse library…" is the last option and pushes the
 * Library without changing the selection.
 */
export const EnginePage: React.FC<{
  adapter: EngineAdapter;
  onBrowse: (slot: SlotId) => void;
  onStorage: () => void;
  /** One-shot: the slot a chip click just deep-linked (Finding 4). Passed
   *  straight through to every SlotRow, which decides for itself whether
   *  it's the match — see SlotRow's own doc comment. */
  flashSlot?: SlotId | null;
  /** The EFFECTIVE audio mode (host computes `lockedMode ?? mode` — the
   *  same idiom every mode-scoped Settings UI reads). A prop, not a store
   *  read: importing audioStore here would drag the audio-worklet module
   *  chain into every consumer's test environment (the "Denied ID" trap),
   *  and the hosts all read the stores already. */
  effectiveMode: AudioMode;
}> = ({ adapter, onBrowse, onStorage, flashSlot = null, effectiveMode }) => {
  const { t } = useTranslation();
  // Rich option markup only where the runtime renders customizable selects
  // (same gating and reason as ProviderSection's provider-select: classic
  // OS popups flatten or hide rich children).
  const richSelect = supportsBaseSelect();

  // Direction visibility follows the effective audio mode (2026-08-23
  // decision): speaker shows only the forward leg, participant only the
  // reverse, both shows both — a mode that doesn't run a leg has no business
  // configuring it here (the chips and the LanguageSection warning are
  // mode-scoped the same way). directions[0] is the speaker (forward) leg
  // by the adapter contract.
  const visibleDirections = adapter.directions.filter((_, i) =>
    effectiveMode === 'both' || (effectiveMode === 'participant' ? i === 1 : i === 0));

  return (
    <div className="engine-page">
      {adapter.gate}
      {visibleDirections.map(({ dir, src, tgt }) => (
        <div key={dir} className="engine-direction">
          <div className="engine-direction__title">
            {t('engineUi.speakerHeading', '{{src}} → {{tgt}}', {
              src: adapter.languageName(src), tgt: adapter.languageName(tgt),
            })}
          </div>
          {adapter.stagesFor(dir, dir === adapter.directions[0]?.dir).map((stage) => {
            const slot: SlotId = { dir, stage };
            const resolved = adapter.resolved(slot);
            const label = t(STAGE_FULL_LABEL_KEY[stage][0], STAGE_FULL_LABEL_KEY[stage][1]);
            const shortLabel = t(STAGE_SHORT_LABEL_KEY[stage][0], STAGE_SHORT_LABEL_KEY[stage][1]);
            // Controlled value: explicit picks are the model id, auto is ''.
            // A stale explicit pick can't reach here as `explicit` — the
            // resolver only reports explicit when the pick is usable, so the
            // value always matches one of the rendered options.
            const value = resolved?.source === 'explicit' ? resolved.modelId : '';
            // The badge is native-only (adapter.slotBadge is absent for
            // WASM) and comes back with a placeholder `onOpen` — the adapter
            // has no access to the Library push/pop navigation EnginePage
            // owns, so this clones the element to inject the real handler
            // (same isValidElement + cloneElement pattern as Tooltip.tsx).
            const badgeNode = adapter.slotBadge?.(slot);
            const badge = badgeNode && React.isValidElement(badgeNode)
              ? React.cloneElement(badgeNode as React.ReactElement<{ onOpen: () => void }>, {
                  onOpen: () => onBrowse(slot),
                })
              : null;
            return (
              <SlotRow key={stage} slot={slot} label={label} shortLabel={shortLabel} flashSlot={flashSlot}>
                <select
                  className={`select-dropdown engine-slot__select${resolved ? '' : ' engine-slot__select--missing'}`}
                  value={value}
                  disabled={adapter.disabled}
                  aria-label={label}
                  onChange={(e) => {
                    const picked = e.target.value;
                    if (picked === BROWSE_OPTION_VALUE) {
                      // An action, not an option: push the Library and keep
                      // the selection where it was (the controlled value
                      // snaps the control back on re-render). Deferred one
                      // task, with an explicit blur first: pushing
                      // synchronously from inside the change event unmounts
                      // the select while its top-layer picker is still
                      // committing its close, and on some Chromium builds
                      // (Electron's 144) that strands the picker/backdrop
                      // open, swallowing all input — the frozen-UI bug.
                      e.currentTarget.blur();
                      window.setTimeout(() => onBrowse(slot), 0);
                      return;
                    }
                    // A settings write can reject (adapter.select is
                    // async); surface it instead of leaving an unhandled
                    // rejection with no recovery path.
                    Promise.resolve(adapter.select(slot, picked)).catch((err) => {
                      console.error('[Sokuji] [EnginePage] selection write failed:', err);
                    });
                  }}
                >
                  {richSelect && (
                    // The closed control mirrors the selected option's rich
                    // markup; CSS trims it (hides the size, keeps the muted
                    // auto prefix) — see .engine-slot__select selectedcontent.
                    <button type="button"><selectedcontent /></button>
                  )}
                  <option value="">
                    {(() => {
                      // The Auto option always names what auto WOULD pick,
                      // explicit selection active or not — "Auto" alone
                      // only when nothing is usable.
                      const autoId = adapter.autoPick(slot);
                      if (!autoId) {
                        return richSelect
                          ? <span className="engine-opt__name">{t('engineUi.autoOptionNone', 'Auto')}</span>
                          : t('engineUi.autoOptionNone', 'Auto');
                      }
                      return richSelect ? (
                        <span className="engine-opt__name">
                          <span className="engine-opt__auto">{'Auto · '}</span>
                          {adapter.displayName(autoId)}
                        </span>
                      ) : t('engineUi.autoValue', 'Auto · {{name}}', { name: adapter.displayName(autoId) });
                    })()}
                  </option>
                  {adapter.readyCandidates(slot).map((c) => (
                    <option key={c.id} value={c.id}>
                      {richSelect ? (
                        <>
                          <span className="engine-opt__name">{c.name}</span>
                          {c.sizeLabel && <span className="engine-opt__meta">{c.sizeLabel}</span>}
                        </>
                      ) : (c.sizeLabel ? `${c.name} · ${c.sizeLabel}` : c.name)}
                    </option>
                  ))}
                  <option value={BROWSE_OPTION_VALUE} className="engine-opt--browse">
                    {richSelect
                      ? <span className="engine-opt__name">{t('engineUi.browseLibrary', 'Browse library')}…</span>
                      : `${t('engineUi.browseLibrary', 'Browse library')}…`}
                  </option>
                </select>
                {badge}
              </SlotRow>
            );
          })}
        </div>
      ))}
      {/* Storage entry as the section's footer — storage is a different kind
          of thing than the slots above it. The whole footer is the button;
          "Manage ›" names where it goes. */}
      <button type="button" className="engine-storage-footer" onClick={onStorage}>
        <HardDrive size={14} />
        <span>{t('engineUi.storageUsedLine', 'Storage: {{summary}} used', { summary: adapter.storageSummary })}</span>
        <span className="engine-storage-footer__manage">
          {t('engineUi.manageStorage', 'Manage')}
          <ChevronRight size={12} />
        </span>
      </button>
    </div>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, HardDrive } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { SlotRow } from './SlotRow';
import type { AudioMode } from '../../../stores/audioStore';
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
  translation: ['models.translationModels', 'Translation'],
  tts: ['models.ttsModels', 'Speech Synthesis (TTS)'],
};

/** The Engine overview: both directions, three slots each, nothing else. */
export const EnginePage: React.FC<{
  adapter: EngineAdapter;
  expandedSlot: SlotId | null;
  onToggleSlot: (slot: SlotId) => void;
  onBrowse: (slot: SlotId) => void;
  onStorage: () => void;
  /** One-shot: the slot a chip click just deep-linked open (Finding 4).
   *  Passed straight through to every SlotRow, which decides for itself
   *  whether it's the match — see SlotRow's own doc comment. */
  flashSlot?: SlotId | null;
  /** The EFFECTIVE audio mode (host computes `lockedMode ?? mode` — the
   *  same idiom every mode-scoped Settings UI reads). A prop, not a store
   *  read: importing audioStore here would drag the audio-worklet module
   *  chain into every consumer's test environment (the "Denied ID" trap),
   *  and the hosts all read the stores already. */
  effectiveMode: AudioMode;
}> = ({ adapter, expandedSlot, onToggleSlot, onBrowse, onStorage, flashSlot = null, effectiveMode }) => {
  const { t } = useTranslation();
  const isOpen = (s: SlotId) =>
    expandedSlot?.dir === s.dir && expandedSlot?.stage === s.stage;

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
            return (
              <SlotRow key={stage} slot={slot} label={t(STAGE_FULL_LABEL_KEY[stage][0], STAGE_FULL_LABEL_KEY[stage][1])}
                resolved={resolved} displayName={adapter.displayName}
                expanded={isOpen(slot)} onToggle={() => onToggleSlot(slot)} flashSlot={flashSlot}>
                {adapter.stageExtras?.(slot)}
                <div className="engine-picker" role="radiogroup">
                  <button type="button" role="radio" aria-checked={!resolved || resolved.source === 'auto'}
                    className={`engine-picker__option ${!resolved || resolved.source === 'auto' ? 'is-selected' : ''}`}
                    disabled={adapter.disabled}
                    onClick={() => adapter.select(slot, '')}>
                    <span className="engine-picker__name">
                      {resolved && resolved.source === 'auto'
                        ? t('engineUi.autoOption', 'Auto (currently {{name}})', { name: adapter.displayName(resolved.modelId) })
                        : t('engineUi.autoOptionNone', 'Auto')}
                    </span>
                  </button>
                  {adapter.readyCandidates(slot).map((c) => (
                    <button key={c.id} type="button" role="radio"
                      aria-checked={resolved?.source === 'explicit' && resolved.modelId === c.id}
                      className={`engine-picker__option ${resolved?.source === 'explicit' && resolved.modelId === c.id ? 'is-selected' : ''}`}
                      disabled={adapter.disabled}
                      onClick={() => adapter.select(slot, c.id)}>
                      <span className="engine-picker__name">{c.name}</span>
                      {c.sizeLabel && <span className="engine-picker__meta">{c.sizeLabel}</span>}
                    </button>
                  ))}
                </div>
                <button type="button" className="engine-picker__option engine-picker__browse"
                  onClick={() => onBrowse(slot)}>
                  <span className="engine-picker__name">{t('engineUi.browseLibrary', 'Browse library')}</span>
                  <ChevronRight size={14} />
                </button>
              </SlotRow>
            );
          })}
        </div>
      ))}
      {/* Storage entry as the section's footer (the old ModelStorageFooter
          shape: top divider + caption text), not another slot-look row —
          storage is a different kind of thing than the slots above it. The
          whole footer is the button; "Manage ›" names where it goes. */}
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

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, HardDrive } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { SlotRow } from './SlotRow';
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
}> = ({ adapter, expandedSlot, onToggleSlot, onBrowse, onStorage, flashSlot = null }) => {
  const { t } = useTranslation();
  const isOpen = (s: SlotId) =>
    expandedSlot?.dir === s.dir && expandedSlot?.stage === s.stage;
  return (
    <div className="engine-page">
      {adapter.gate}
      {adapter.directions.map(({ dir, src, tgt }, i) => (
        <div key={dir} className="engine-direction">
          <div className="engine-direction__title">
            {t('engineUi.speakerHeading', '{{src}} → {{tgt}}', {
              src: adapter.languageName(src), tgt: adapter.languageName(tgt),
            })}
          </div>
          {adapter.stagesFor(dir, i === 0).map((stage) => {
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

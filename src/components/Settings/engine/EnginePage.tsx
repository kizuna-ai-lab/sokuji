import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, HardDrive } from 'lucide-react';
import type { EngineAdapter, SlotId } from './EngineTypes';
import { SlotRow } from './SlotRow';
import './Engine.scss';

/** Localized stage labels (ASR / MT / TTS) — shared by the slot rows here and
 *  the pushed Library title in EngineSurface, so the two can't drift. */
export const STAGE_LABEL_KEY: Record<string, [string, string]> = {
  asr: ['providers.local_inference.modelAsr', 'ASR'],
  translation: ['providers.local_inference.modelTranslation', 'MT'],
  tts: ['providers.local_inference.modelTts', 'TTS'],
};

/** The Engine overview: both directions, three slots each, nothing else. */
export const EnginePage: React.FC<{
  adapter: EngineAdapter;
  expandedSlot: SlotId | null;
  onToggleSlot: (slot: SlotId) => void;
  onBrowse: (slot: SlotId) => void;
  onStorage: () => void;
}> = ({ adapter, expandedSlot, onToggleSlot, onBrowse, onStorage }) => {
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
              <SlotRow key={stage} slot={slot} label={t(STAGE_LABEL_KEY[stage][0], STAGE_LABEL_KEY[stage][1])}
                resolved={resolved} displayName={adapter.displayName}
                expanded={isOpen(slot)} onToggle={() => onToggleSlot(slot)}>
                {adapter.stageExtras?.(slot)}
                <div role="radiogroup">
                  <button type="button" role="radio" aria-checked={!resolved || resolved.source === 'auto'}
                    className={`engine-picker__option ${!resolved || resolved.source === 'auto' ? 'is-selected' : ''}`}
                    disabled={adapter.disabled}
                    onClick={() => adapter.select(slot, '')}>
                    {resolved && resolved.source === 'auto'
                      ? t('engineUi.autoOption', 'Auto (currently {{name}})', { name: adapter.displayName(resolved.modelId) })
                      : t('engineUi.autoOptionNone', 'Auto')}
                  </button>
                  {adapter.readyCandidates(slot).map((c) => (
                    <button key={c.id} type="button" role="radio"
                      aria-checked={resolved?.source === 'explicit' && resolved.modelId === c.id}
                      className={`engine-picker__option ${resolved?.source === 'explicit' && resolved.modelId === c.id ? 'is-selected' : ''}`}
                      disabled={adapter.disabled}
                      onClick={() => adapter.select(slot, c.id)}>
                      {c.name}
                      {c.sizeLabel && <span className="engine-picker__meta">{c.sizeLabel}</span>}
                    </button>
                  ))}
                </div>
                <button type="button" className="engine-picker__option engine-picker__browse"
                  onClick={() => onBrowse(slot)}>
                  {t('engineUi.browseLibrary', 'Browse library')}
                  <ChevronRight size={14} />
                </button>
              </SlotRow>
            );
          })}
        </div>
      ))}
      <button type="button" className="engine-storage-row" onClick={onStorage}>
        <HardDrive size={14} />
        {t('engineUi.storageRow', 'Storage')}
        <span className="engine-picker__meta">{adapter.storageSummary}</span>
        <ChevronRight size={14} />
      </button>
    </div>
  );
};

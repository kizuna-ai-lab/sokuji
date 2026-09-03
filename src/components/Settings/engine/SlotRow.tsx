import React, { useEffect, useState } from 'react';
import type { SlotId } from './EngineTypes';
import './Engine.scss';

/**
 * One slot of one direction: a label + whatever control the caller renders
 * (today: EnginePage's model dropdown). Since the 2026-08-23 dropdown
 * redesign this row has no expand/collapse of its own — its remaining jobs
 * are layout and the deep-link flash.
 */
export const SlotRow: React.FC<{
  slot: SlotId;
  label: string;
  /** Abbreviation shown instead of `label` in a narrow panel (container
   *  query in Engine.scss); omitted = the full label is used everywhere. */
  shortLabel?: string;
  /**
   * One-shot deep-link signal: the slot a chip click just targeted, so the
   * flash lands on THIS row. Compared by dir+stage, but the effect below
   * keys on the OBJECT ITSELF — the owner hands it a fresh object on every
   * deep-link, so the same chip fired twice re-flashes rather than
   * no-op'ing, and clears/expires the signal so remounts never replay it
   * (see EngineSurface's flashSlot lifecycle).
   */
  flashSlot?: SlotId | null;
  children: React.ReactNode;
}> = ({ slot, label, shortLabel, flashSlot = null, children }) => {
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!flashSlot || flashSlot.dir !== slot.dir || flashSlot.stage !== slot.stage) return;
    setFlashing(true);
    // Mirrors Settings.tsx's highlight duration/cleanup discipline: the CSS
    // animation itself runs 2s (see .engine-slot.highlight in Engine.scss),
    // the class stays a beat longer so it's never clipped mid-cycle. The
    // cleanup ALSO lowers the flag: when the owner clears the signal early
    // (mode switch, expiry) this effect re-runs and would otherwise cancel
    // the timer while leaving the row latched highlighted forever.
    const timer = setTimeout(() => setFlashing(false), 3000);
    return () => { clearTimeout(timer); setFlashing(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashSlot]);

  return (
    <div className={`engine-slot ${flashing ? 'highlight' : ''}`} data-slot={`${slot.dir}:${slot.stage}`}>
      <span className="engine-slot__label" title={shortLabel ? label : undefined}>
        <span className="engine-slot__label-long">{label}</span>
        {shortLabel && <span className="engine-slot__label-short" aria-hidden="true">{shortLabel}</span>}
      </span>
      <div className="engine-slot__control">{children}</div>
    </div>
  );
};

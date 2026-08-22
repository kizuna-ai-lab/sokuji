import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Resolved } from '../../../lib/local-inference/selection/types';
import type { SlotId } from './EngineTypes';
import './Engine.scss';

/**
 * One slot of one direction. Collapsed: label + resolved value ("auto · Name"
 * marks a machine pick — the provenance marker the No-migration design leans
 * on). Expanded (single-open, owned by EnginePage): the caller's picker.
 */
export const SlotRow: React.FC<{
  slot: SlotId;
  label: string;
  resolved: Resolved | null;
  displayName: (id: string) => string;
  expanded: boolean;
  onToggle: () => void;
  /**
   * One-shot deep-link signal (Finding 4): the slot a chip click JUST
   * expanded, so the flash lands on THIS row instead of the whole
   * ProviderSection (the old, wrong target). Compared by dir+stage, but the
   * effect below keys on the OBJECT ITSELF — EngineSurface hands it a fresh
   * object on every deep-link (mirrors its own `initialSlot` contract), so
   * the same chip fired twice re-flashes rather than no-op'ing. Never set
   * for a slot the user expanded by hand.
   */
  flashSlot?: SlotId | null;
  children?: React.ReactNode;
}> = ({ slot, label, resolved, displayName, expanded, onToggle, flashSlot = null, children }) => {
  const { t } = useTranslation();
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

  const value = resolved
    ? (resolved.source === 'auto'
        ? t('engineUi.autoValue', 'auto · {{name}}', { name: displayName(resolved.modelId) })
        : displayName(resolved.modelId))
    : '—';
  return (
    <div className={`engine-slot ${flashing ? 'highlight' : ''}`} data-slot={`${slot.dir}:${slot.stage}`}>
      <button type="button" className="engine-slot__header" onClick={onToggle} aria-expanded={expanded}>
        <span className="engine-slot__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="engine-slot__label">{label}</span>
        <span className={`engine-slot__value ${resolved ? '' : 'engine-slot__value--missing'}`}>{value}</span>
      </button>
      {expanded && <div className="engine-slot__body">{children}</div>}
    </div>
  );
};

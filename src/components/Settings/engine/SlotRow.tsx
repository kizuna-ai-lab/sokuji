import React from 'react';
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
  children?: React.ReactNode;
}> = ({ slot, label, resolved, displayName, expanded, onToggle, children }) => {
  const { t } = useTranslation();
  const value = resolved
    ? (resolved.source === 'auto'
        ? t('engineUi.autoValue', 'auto · {{name}}', { name: displayName(resolved.modelId) })
        : displayName(resolved.modelId))
    : '—';
  return (
    <div className="engine-slot" data-slot={`${slot.dir}:${slot.stage}`}>
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

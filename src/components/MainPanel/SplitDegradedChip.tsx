import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import './SplitDegradedChip.scss';
import { splitDegradedChipText, type SplitDegradedReason } from './splitDegraded';

interface SplitDegradedChipProps {
  /** The reason the split did not take effect, or null when it did. */
  reason: SplitDegradedReason | null;
}

/**
 * "One-way only" — persistent footer chrome for a split Both session whose
 * participant leg never came up.
 *
 * Rendered immediately after the ModePicker in BOTH the basic and the
 * advanced footer. Placement is the point: the chip sits directly beside the
 * "Both" segment that is telling the lie, and contradicts it in place. Basic
 * mode is the important one — it has no participant waveform whose absence
 * could hint at the problem, and it is the mode most likely to be in use by
 * someone who does not read logs.
 *
 * Not a conversation bubble: connectConversation's unconditional
 * setItems(getConversationItems()) replaces the items array wholesale, and a
 * bubble would scroll away besides. This is driven by its own React state,
 * which that call cannot touch.
 *
 * Its own component rather than JSX inlined twice into MainPanel: MainPanel
 * has no React harness in this repo, so inline JSX there is untestable by
 * construction. Here the render is pinned by SplitDegradedChip.test.tsx.
 */
const SplitDegradedChip: React.FC<SplitDegradedChipProps> = ({ reason }) => {
  const { t } = useTranslation();
  if (!reason) return null;

  const { label, title } = splitDegradedChipText(reason, (key, defaultValue) => t(key, defaultValue));

  return (
    // role="status" so the degradation is announced when it appears rather
    // than only being discoverable by hovering. aria-label rather than the
    // inner text alone because the narrow-footer media query hides
    // `.chip-text`, which would take the accessible name with it.
    <span className="split-degraded-chip" role="status" aria-label={label} title={title}>
      <AlertCircle size={12} aria-hidden="true" />
      <span className="chip-text">{label}</span>
    </span>
  );
};

export default SplitDegradedChip;

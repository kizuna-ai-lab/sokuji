import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import './MissingDeviceChip.scss';
import { missingDeviceChipText } from './missingDeviceChip';
import type { DeviceScope } from './sessionStartGate';

interface MissingDeviceChipProps {
  /**
   * MainPanel's `missingDeviceForMode` verbatim — the same value that draws
   * the amber ring on the picker. Passing it straight through is what keeps
   * the chip and the ring from ever disagreeing about whether there is a
   * problem. `null` renders nothing.
   */
  scope: DeviceScope | null;
  /** Receives the chip element so the caller can anchor the device popover to it. */
  onClick: (el: HTMLElement) => void;
}

/**
 * "Microphone not selected" — the resting-state twin of the mode picker's
 * amber warn ring.
 *
 * Rendered immediately after the ModePicker in BOTH footers, beside the
 * segment the ring is on. Placement is the point: the ring says "something is
 * wrong here" and this says what, without the user having to hover it, hover
 * the disabled Start button, or click through to the device popover.
 *
 * A real `<button>` rather than SplitDegradedChip's inert `role="status"`
 * span, because unlike a degraded split there IS something to do about this:
 * clicking opens the same device popover the active segment opens. That also
 * puts the explanation on the Tab order, which a native `title` never was.
 *
 * Its own component rather than JSX inlined twice into MainPanel, for the
 * reason SplitDegradedChip records: MainPanel has no React harness in this
 * repo, so inline JSX there is untestable by construction.
 */
const MissingDeviceChip: React.FC<MissingDeviceChipProps> = ({ scope, onClick }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement | null>(null);
  if (!scope) return null;

  const { label, title } = missingDeviceChipText(
    scope,
    (key, defaultValue, values) => t(key, defaultValue, values),
  );

  return (
    // aria-label rather than the inner text alone: the narrow-footer media
    // query hides `.chip-text`, which would take the accessible name with it.
    <button
      ref={ref}
      type="button"
      className="missing-device-chip"
      aria-label={label}
      title={title}
      onClick={() => { if (ref.current) onClick(ref.current); }}
    >
      <AlertTriangle size={12} aria-hidden="true" />
      <span className="chip-text">{label}</span>
    </button>
  );
};

export default MissingDeviceChip;

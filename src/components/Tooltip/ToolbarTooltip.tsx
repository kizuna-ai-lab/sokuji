import React from 'react';
import Tooltip from './Tooltip';

/**
 * The tooltip for an icon-only toolbar button.
 *
 * Why not the native `title` attribute, which is what these buttons used to
 * carry: a native tooltip is drawn by Chromium in its OWN OS window, in the
 * ordinary topmost band. The pinned subtitle bar sits above that band — it has
 * to, or a PowerPoint slideshow covers it (#326, see electron/topmost-level.js)
 * — and it re-asserts that position on a 1s heartbeat. Nothing in Electron can
 * raise Chromium's tooltip window to match, so the tooltip renders *underneath*
 * the very bar whose button it describes, i.e. invisibly. Rendering the tooltip
 * as ordinary DOM inside the page sidesteps OS z-order entirely.
 *
 * Applied to every toolbar button, not only the subtitle bar's, so the two
 * surfaces that share these components (DisplayModeButton, ExportButton) do not
 * need a per-surface branch and the app has one tooltip look.
 *
 * `aria-label` on the button stays the accessible name; this is presentation.
 */
interface ToolbarTooltipProps {
  /** Tooltip text. '\n' starts a new line — Tooltip renders the parts stacked. */
  label: string;
  children: React.ReactElement;
}

const ToolbarTooltip: React.FC<ToolbarTooltipProps> = ({ label, children }) => (
  <Tooltip
    content={label}
    icon="none"
    position="bottom"
    // Toolbar buttons sit shoulder to shoulder, so the 100ms default fires a
    // burst of tooltips when the pointer merely sweeps across the row. 400ms
    // is close to what the native tooltips these replace used to feel like.
    openDelay={400}
  >
    {children}
  </Tooltip>
);

export default ToolbarTooltip;

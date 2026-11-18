// The panels the conversation's toolbar and footer open float on the page (FloatingPortal, on <body>). The divider
// between the conversation and the live notes stacks above its neighbours (PanelResizer.scss), and since the notes moved
// into the conversation's area (owner, 2026-11-18) it runs under these panels: each must stack above it, on the layer
// the other popovers already use (owner, 2026-11-19: the divider was drawn across the display settings).
//
// Only the panels that stack through a stylesheet need a rule here: the export menu and the screen-content card set
// their layer inline (zIndex 9999, ExportButton.tsx / ScreenContextChip.tsx), and the export menu's other mount is a
// child window, where the page's divider cannot reach it.
import { describe, expect, it } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = (file: string) => compile(resolve(__dirname, '..', file)).css;
/** The z-index of the first top-level rule whose selector is exactly `selector`; null when it sets none. */
function zIndex(sheet: string, selector: string): number | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of sheet.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))) {
    const z = m[1].match(/z-index:\s*(\d+)/);
    if (z) return Number(z[1]);
  }
  return null;
}

describe('the floating panels of the conversation stack above its divider', () => {
  const divider = zIndex(css('MainLayout/PanelResizer.scss'), '.panel-resizer');
  const panels: [string, string][] = [
    ['MainPanel/MainPanel.scss', '.display-popover-floating'],
    ['CaptionShare/CaptionSharePanel.scss', '.caption-share-floating'],
    ['MainPanel/HearingButton.scss', '.hearing-popover'],
    ['MainPanel/ModeDevicePopover.scss', '.mode-device-popover'],
  ];

  it('the divider does stack above its neighbours', () => {
    expect(divider).toBeGreaterThan(0);
  });

  it.each(panels)('%s %s, on the popovers\' layer', (file, selector) => {
    expect(zIndex(css(file), selector)).toBe(1000);
  });
});

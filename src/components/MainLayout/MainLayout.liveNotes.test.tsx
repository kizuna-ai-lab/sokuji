// Where the live notes dock. jsdom applies no stylesheet, so the layout is checked as far as the DOM
// order and the compiled rules go: the panel follows the conversation in one flex row (on the right), and below
// 768 px the row turns into a column with the panel ordered first (above). Real widths, clipping and horizontal
// scrolling are for E2E.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { compile } from 'sass';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../MainPanel/MainPanel', () => ({ default: () => <div data-testid="main-panel" /> }));
vi.mock('../Tour/TourOverlay', () => ({ default: () => null }));
vi.mock('../VbCable/VbCableIntro', () => ({ default: () => null }));
vi.mock('../Region/RegionRecommendation', () => ({ default: () => null }));
vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => null }));
vi.mock('./PanelResizer', () => ({ default: () => null }));
vi.mock('../LogsPanel/LogsPanel', () => ({ default: () => null }));
vi.mock('../SettingsPage/SettingsPage', () => ({ SettingsPage: () => null, default: () => null }));
vi.mock('../TitleBar/TitleBar', () => ({ default: () => null }));
vi.mock('../SetupWizard/SetupWizard', () => ({ default: () => null }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => true, isExtension: () => false, isKizunaAIEnabled: () => false,
}));
vi.mock('../../stores/settingsStore', () => ({
  useLiveNotesSetting: () => true, useNotesAfterSession: () => false,
  useSettingsNavigationTarget: () => null, useSubtitleModeActive: () => false, useDiagnosticLogs: () => false,
}));
vi.mock('../../stores/setupStore', () => ({ useSetupLoaded: () => true, useSetupComplete: () => true }));
vi.mock('../History/HistoryPage', () => ({ HistoryPage: () => null }));
vi.mock('../LiveNotes/LiveNotesPanel', () => ({ default: () => <aside className="live-notes" aria-label="Live notes" /> }));

import MainLayout from './MainLayout';

afterEach(() => cleanup());

const layoutCss = compile(resolve(__dirname, 'MainLayout.scss')).css;
const panelCss = compile(resolve(__dirname, '../LiveNotes/LiveNotesPanel.scss')).css;
/** The block that opens at `start` (its `{`), up to its matching `}`. */
function blockAt(css: string, start: number): string {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}
/** The declarations of `selector`'s rule at the top level, or inside the media block `media` and only there. */
function rule(css: string, selector: string, media?: string): string {
  const at = media ? css.indexOf(`@media ${media}`) : -1;
  if (media && at === -1) return '';
  const scope = media ? blockAt(css, at) : css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scope.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('the live notes dock beside the conversation, and above it in a narrow window', () => {
  it('render in the conversation\'s row, after the conversation', () => {
    const { container } = render(<MainLayout />);
    const row = container.querySelector('.main-panel-row')!;
    expect(row).not.toBeNull();
    expect([...row.children].map((c) => c.className)).toEqual(['main-panel-container', 'live-notes']);
  });

  it('in a wide window take a column of their own width on the right of a row that may shrink', () => {
    expect(rule(layoutCss, '.main-layout .main-panel-row')).toMatch(/display:\s*flex/);
    expect(rule(layoutCss, '.main-layout .main-panel-row')).not.toMatch(/flex-direction:\s*column/);
    expect(rule(layoutCss, '.main-layout .main-panel-row')).toMatch(/min-width:\s*0/);
    // The width the panel was dragged to (LiveNotesPanel sets it), 324px until it is.
    expect(rule(layoutCss, '.main-layout .main-panel-row > .live-notes')).toMatch(/flex:\s*0 0 var\(--live-notes-width, 324px\)/);
    // Review: a long word in a title cannot push the column past its width (a flex item's minimum is its content's).
    expect(rule(layoutCss, '.main-layout .main-panel-row > .live-notes')).toMatch(/min-width:\s*0/);
    // The conversation takes what is left and may shrink, so the row does not push past the window.
    expect(rule(layoutCss, '.main-layout .main-panel-container')).toMatch(/min-width:\s*0/);
  });

  it('below 768 px stack the row and put the notes first, at most 40% of the height', () => {
    expect(rule(layoutCss, '.main-layout .main-panel-row', '(max-width: 767px)')).toMatch(/flex-direction:\s*column/);
    const narrow = rule(layoutCss, '.main-layout .main-panel-row > .live-notes', '(max-width: 767px)');
    expect(narrow).toMatch(/order:\s*-1/);
    expect(narrow).toMatch(/max-height:\s*40vh/);
    expect(narrow).toMatch(/border-left:\s*none/);
  });

  // Owner, 2026-11-18: the divider on the notes' left drags their width. Where it shows (wider than 768 px, as the main
  // layout hides every divider at 768 px and below; review: fractional widths too), it is the seam, in place of the
  // notes' own border.
  it('take the divider as their seam where it shows, and keep their own border where it does not', () => {
    expect(rule(layoutCss, '.main-layout .main-panel-row > .panel-resizer + .live-notes', '(width > 768px)')).toMatch(/border-left:\s*none/);
    expect(rule(layoutCss, '.main-layout .main-panel-row > .panel-resizer + .live-notes', '(max-width: 767px)')).toBe('');
    expect(rule(layoutCss, '.main-layout .panel-resizer', '(max-width: 768px)')).toMatch(/display:\s*none/);
    expect(rule(panelCss, '.live-notes')).toMatch(/border-left:\s*1px solid/);
  });

  it('switch at the same width as the toolbar\'s icon (useNarrowWindow)', () => {
    const hook = readFileSync(resolve(__dirname, '../../lib/notes/live/useNarrowWindow.ts'), 'utf8');
    expect(hook).toMatch(/'\(max-width: 767px\)'/);
    expect(layoutCss).toContain('@media (max-width: 767px)');
  });

  it('scroll their own content instead of cutting it', () => {
    expect(rule(panelCss, '.live-notes__body')).toMatch(/overflow-y:\s*auto/);
    expect(rule(panelCss, '.live-notes__body')).toMatch(/min-height:\s*0/);
  });
});

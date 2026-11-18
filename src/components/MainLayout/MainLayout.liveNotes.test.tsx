// Where the live notes dock: in the conversation's area, between its toolbar and its footer (owner, 2026-11-18).
// jsdom applies no stylesheet, so the layout is checked as far as the DOM and the compiled rules go: MainLayout hands
// the panel to MainPanel, whose area puts it after the conversation in one flex row (on the right), turns the row into a
// column below 768 px with the panel ordered first (above), and lets it take the area alone. Real widths, clipping and
// horizontal scrolling are for E2E.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { compile } from 'sass';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../MainPanel/MainPanel', () => ({ default: (p: { liveNotes?: ReactNode }) => <div data-testid="main-panel">{p.liveNotes}</div> }));
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
const areaCss = compile(resolve(__dirname, '../MainPanel/MainPanel.scss')).css;
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

describe('the live notes dock in the conversation\'s area, beside it, above it in a narrow window, or alone', () => {
  it('are handed to the conversation, to draw in its area', () => {
    const { container } = render(<MainLayout />);
    const conversation = container.querySelector('.main-panel-container [data-testid="main-panel"]')!;
    expect(conversation).not.toBeNull();
    expect(conversation.querySelector('.live-notes')).not.toBeNull();
    expect(container.querySelector('.main-panel-row')).toBeNull();
  });

  it('in a wide window take a column of their own width on the right of a row that may shrink', () => {
    expect(rule(areaCss, '.conversation-area')).toMatch(/display:\s*flex/);
    expect(rule(areaCss, '.conversation-area')).not.toMatch(/flex-direction:\s*column/);
    expect(rule(areaCss, '.conversation-area')).toMatch(/min-width:\s*0/);
    // The width the panel was dragged to (LiveNotesPanel sets it), 324px until it is.
    expect(rule(areaCss, '.conversation-area > .live-notes')).toMatch(/flex:\s*0 0 var\(--live-notes-width, 324px\)/);
    // Review: a long word in a title cannot push the column past its width (a flex item's minimum is its content's).
    expect(rule(areaCss, '.conversation-area > .live-notes')).toMatch(/min-width:\s*0/);
    // The conversation takes what is left and may shrink, so the row does not push past the window.
    expect(rule(areaCss, '.conversation-area > .conversation-column')).toMatch(/flex:\s*1/);
    expect(rule(areaCss, '.conversation-area > .conversation-column')).toMatch(/min-width:\s*0/);
    expect(rule(layoutCss, '.main-layout .main-panel-container')).toMatch(/min-width:\s*0/);
  });

  it('below 768 px stack the row and put the notes first, at most 40% of the height', () => {
    expect(rule(areaCss, '.conversation-area', '(max-width: 767px)')).toMatch(/flex-direction:\s*column/);
    const narrow = rule(areaCss, '.conversation-area > .live-notes', '(max-width: 767px)');
    expect(narrow).toMatch(/order:\s*-1/);
    expect(narrow).toMatch(/max-height:\s*40vh/);
    expect(narrow).toMatch(/border-left:\s*none/);
  });

  // Owner, 2026-11-18: the toolbar's switch shows the notes alone; the conversation is then hidden, kept.
  it('alone take the whole area, in a wide window and a narrow one, and the conversation hidden takes no room', () => {
    expect(rule(areaCss, '.conversation-area > .live-notes--alone')).toMatch(/flex:\s*1 1 auto/);
    expect(rule(areaCss, '.conversation-area > .live-notes--alone')).toMatch(/border-left:\s*none/);
    const narrow = rule(areaCss, '.conversation-area > .live-notes--alone', '(max-width: 767px)');
    expect(narrow).toMatch(/flex:\s*1 1 auto/);
    expect(narrow).toMatch(/max-height:\s*none/);
    expect(rule(areaCss, '.conversation-area > .conversation-column[hidden]')).toMatch(/display:\s*none/);
  });

  // Owner, 2026-11-18: the divider on the notes' left drags their width. Where it shows (wider than 768 px, as the main
  // layout hides every divider at 768 px and below; review: fractional widths too), it is the seam, in place of the
  // notes' own border.
  it('take the divider as their seam where it shows, and keep their own border where it does not', () => {
    expect(rule(areaCss, '.conversation-area > .panel-resizer + .live-notes', '(width > 768px)')).toMatch(/border-left:\s*none/);
    expect(rule(areaCss, '.conversation-area > .panel-resizer + .live-notes', '(max-width: 767px)')).toBe('');
    expect(rule(layoutCss, '.main-layout .panel-resizer', '(max-width: 768px)')).toMatch(/display:\s*none/);
    expect(rule(panelCss, '.live-notes')).toMatch(/border-left:\s*1px solid/);
  });

  it('switch at the same width as the toolbar\'s icon (useNarrowWindow)', () => {
    const hook = readFileSync(resolve(__dirname, '../../lib/notes/live/useNarrowWindow.ts'), 'utf8');
    expect(hook).toMatch(/'\(max-width: 767px\)'/);
    expect(areaCss).toContain('@media (max-width: 767px)');
  });

  it('scroll their own content instead of cutting it', () => {
    expect(rule(panelCss, '.live-notes__body')).toMatch(/overflow-y:\s*auto/);
    expect(rule(panelCss, '.live-notes__body')).toMatch(/min-height:\s*0/);
  });
});

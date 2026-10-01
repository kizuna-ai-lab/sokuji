import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { DisplayMode } from '../../stores/settingsStore';
import type { Exporter } from '../../lib/export/exporter';
import { ExportMenuButton } from './ExportButton';

// i18n: return the default string passed to t(key, default), with {{x}}
// interpolation applied so aria-labels built from the toolbar's own words
// come out readable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, unknown>) => {
      let s = typeof def === 'string' ? def : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      }
      return s;
    },
  }),
}));

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

let autoSaveOn = false;
const setAutoSaveOnStop = vi.fn(async (v: boolean) => { autoSaveOn = v; });
vi.mock('../../stores/settingsStore', () => ({
  useAutoSaveOnStop: () => autoSaveOn,
  useSetAutoSaveOnStop: () => setAutoSaveOnStop,
}));

let electronEnv = true;
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isElectron: () => electronEnv,
}));

/**
 * A stub `Exporter`: `hasScopedContent` models the real adapter's own
 * invariant (no content at all ⇒ no scoped content either, and a scope that
 * hides both sides selects nothing) without going through a real
 * conversation — this component only wires the scope through, it doesn't
 * compute it.
 */
const fake = (over: Partial<Exporter> = {}): Exporter => {
  const hasContent = over.hasContent ?? true;
  return {
    hasContent,
    hasScopedContent: vi.fn((scope) => hasContent && (scope.speaker !== 'none' || scope.participant !== 'none')),
    text: vi.fn(() => 'TEXT'),
    json: vi.fn(() => '{}'),
    ...over,
  };
};

const button = () => screen.getByLabelText('Export conversation');

const tree = (over: { speakerMode?: DisplayMode; participantMode?: DisplayMode; exporter?: Exporter } = {}) => (
  <ExportMenuButton
    exporter={over.exporter ?? fake()}
    speakerMode={over.speakerMode ?? 'both'}
    participantMode={over.participantMode ?? 'both'}
  />
);

const renderMenu = (over: { speakerMode?: DisplayMode; participantMode?: DisplayMode; exporter?: Exporter } = {}) => {
  const result = render(tree(over));
  fireEvent.click(button());
  return result;
};

// Closing unmounts floating-ui's FloatingFocusManager, which restores focus
// asynchronously; flush that so it doesn't land outside act().
const closeMenu = async () => {
  fireEvent.click(button());
  await act(async () => {});
};

const box = (name: string) => screen.getByRole('menuitemcheckbox', { name });
const autoSaveRow = () => screen.getByRole('menuitemcheckbox', { name: 'Auto-save when session ends' });

beforeEach(() => {
  cleanup();
  autoSaveOn = false;
  electronEnv = true;
  setAutoSaveOnStop.mockClear();
});

describe('ExportMenuButton scope checkboxes', () => {
  it('starts with the checkboxes matching the toolbar display modes', () => {
    renderMenu({ speakerMode: 'source', participantMode: 'none' });

    expect(box('Me — Src')).toBeChecked();
    expect(box('Me — Trans')).not.toBeChecked();
    expect(box('Other — Src')).not.toBeChecked();
    expect(box('Other — Trans')).not.toBeChecked();
  });

  it('leaves the export button usable when the toolbar hides both sides', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    // A conversation exists; the current scope selecting none of it is the
    // menu's business, not a reason to lock the user out of the menu.
    expect(screen.getByLabelText('Export conversation')).not.toBeDisabled();
  });

  it('disables the three actions while no line is selected', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    for (const name of ['Copy to clipboard', 'Download as .txt', 'Download as .json']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
  });

  it('says the scope is empty rather than leaving a dead menu', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });

    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });

  it('re-enables the actions as soon as one line is checked', () => {
    renderMenu({ speakerMode: 'none', participantMode: 'none' });
    fireEvent.click(box('Me — Trans'));

    expect(screen.getByRole('menuitem', { name: 'Download as .txt' })).not.toBeDisabled();
    expect(screen.queryByText('Nothing selected')).not.toBeInTheDocument();
  });

  it('forgets a one-off scope edit when the menu is reopened', async () => {
    renderMenu({ speakerMode: 'both', participantMode: 'both' });
    fireEvent.click(box('Me — Src'));
    expect(box('Me — Src')).not.toBeChecked();

    await closeMenu();
    fireEvent.click(button()); // reopen

    expect(box('Me — Src')).toBeChecked();
  });

  it('re-seeds from the toolbar when the filter changed since the last open', async () => {
    const exporter = fake();
    const { rerender } = renderMenu({ speakerMode: 'both', exporter });
    expect(box('Me — Src')).toBeChecked();
    await closeMenu();

    rerender(tree({ speakerMode: 'translation', exporter }));
    fireEvent.click(button()); // reopen

    expect(box('Me — Src')).not.toBeChecked();
    expect(box('Me — Trans')).toBeChecked();
  });

  it('includes the scope checkboxes in the menu keyboard ring', () => {
    renderMenu();

    const ring = [
      box('Me — Src'), box('Me — Trans'), box('Other — Src'), box('Other — Trans'),
      ...['Copy to clipboard', 'Download as .txt', 'Download as .json']
        .map((name) => screen.getByRole('menuitem', { name })),
      autoSaveRow(),
    ];

    // Arrow-key navigation is roving-tabindex driven: every stop carries one,
    // and exactly one stop is reachable by Tab at a time.
    for (const el of ring) expect(el).toHaveAttribute('tabindex');
    expect(ring.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('keeps the button usable with an empty conversation, so auto-save can be set before anyone speaks', () => {
    render(tree({ exporter: fake({ hasContent: false }) }));
    fireEvent.click(button());

    expect(button()).not.toBeDisabled();
    for (const name of ['Copy to clipboard', 'Download as .txt', 'Download as .json']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled();
    }
    // "Nothing selected" means the scope left out a conversation that exists.
    expect(screen.queryByText('Nothing selected')).not.toBeInTheDocument();
    expect(autoSaveRow()).not.toBeDisabled();
  });
});

describe('ExportMenuButton auto-save row', () => {
  it('shows the stored state', () => {
    autoSaveOn = true;
    renderMenu();
    expect(autoSaveRow()).toHaveAttribute('aria-checked', 'true');
  });

  it('writes the store on click and leaves the menu open', () => {
    renderMenu();
    expect(autoSaveRow()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(autoSaveRow());

    expect(setAutoSaveOnStop).toHaveBeenCalledWith(true);
    expect(screen.getByRole('menuitem', { name: 'Download as .txt' })).toBeInTheDocument();
  });

  it('explains where the file goes on desktop', () => {
    renderMenu();
    expect(autoSaveRow().getAttribute('title')).toContain('Downloads folder');
  });

  it('warns about the side panel in the browser', () => {
    electronEnv = false;
    renderMenu();
    expect(autoSaveRow().getAttribute('title')).toContain('side panel');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import useSettingsStore from '../../../stores/settingsStore';
import {
  useConversationDisplayStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../../stores/conversationDisplayStore';
import type { Exporter } from '../../../lib/export/exporter';
import type { LegName } from '../../../lib/conversation/types';
import PanelToolbar from './PanelToolbar';
import { useLiveNotes } from '../../../lib/notes/live/liveStore';
import { useLiveNotesLayout } from '../../../lib/notes/live/livePanel';


// react-i18next: return the key itself, so an assertion against
// e.g. title="mainPanel.clearConversation" is an assertion against the real
// key the component asks for, not a translated string that could drift.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // settingsStore imports `src/locales`, which registers this plugin on the
  // real i18next singleton at module load — a stub keeps that side effect
  // from throwing while everything the components actually call (`t`) still
  // comes from the mock above.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// ExportMenuButton is a marker: PanelToolbar's own job is to hand it the
// right props (the exporter it was given, and today's two display modes),
// not to render the menu itself.
const exportCalls = vi.hoisted(() => [] as any[]);
vi.mock('../ExportButton', () => ({
  ExportMenuButton: (props: any) => {
    exportCalls.push(props);
    return <div data-testid="export-marker" />;
  },
}));

// DisplaySettingsPopover: a marker rendered through the toolbar's own
// FloatingPortal wiring — the portal is what's under test here, not the
// popover's own content.
vi.mock('../../Display/DisplaySettingsPopover', () => ({
  __esModule: true,
  default: () => <div data-testid="display-settings-popover-marker" />,
}));

const exporter: Exporter = {
  hasContent: true,
  hasScopedContent: () => true,
  text: () => 'TEXT',
  json: () => '{}',
};

// The caption-share button is a marker here: its own tests cover it. The
// toolbar's job is to show it on the desktop app only.
vi.mock('../../CaptionShare/CaptionShareButton', () => ({
  __esModule: true,
  default: () => <div data-testid="caption-share-marker" />,
}));
// The headphones entry is a marker here too: its own tests cover its rows.
vi.mock('../HearingButton', () => ({
  HearingButton: () => <div data-testid="hearing-marker" />,
}));
const env = vi.hoisted(() => ({ electron: false }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  isElectron: () => env.electron,
}));

const renderToolbar = (legs: readonly LegName[], over: Partial<{ hasConversation: boolean; onClear(): void }> = {}) =>
  render(
    <PanelToolbar
      legs={legs}
      exporter={exporter}
      hasConversation={over.hasConversation ?? true}
      onClear={over.onClear ?? vi.fn()}
    />,
  );

afterEach(() => {
  cleanup();
  exportCalls.length = 0;
  useSettingsStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both' });
  useConversationDisplayStore.setState({ fontSize: 14, compactMode: false });
});

describe('PanelToolbar — display-mode buttons', () => {
  it('shows one display-mode button for a single leg', () => {
    const { container } = renderToolbar(['speaker']);
    const buttons = container.querySelectorAll('.display-mode-btn');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('data-scope')).toBe('speaker');
  });

  it('shows two display-mode buttons for both legs', () => {
    const { container } = renderToolbar(['speaker', 'participant']);
    expect(container.querySelectorAll('.display-mode-btn').length).toBe(2);
  });
});

describe('PanelToolbar — export menu', () => {
  // On the desktop every export is in History, so the conversation's toolbar has no export menu;
  // the extension, which has no History, keeps it.
  it('has no export menu in the desktop app, and keeps it in the extension', () => {
    env.electron = true;
    renderToolbar(['speaker', 'participant']);
    expect(exportCalls).toHaveLength(0);
    cleanup();
    env.electron = false;
    renderToolbar(['speaker', 'participant']);
    expect(exportCalls.length).toBeGreaterThan(0);
  });

  it("hands the export marker the exporter and today's two display modes", () => {
    renderToolbar(['speaker', 'participant']);
    // useFloating's position effect settles after mount, which re-renders
    // the toolbar once more — the last call is what's on screen.
    const last = exportCalls[exportCalls.length - 1];
    expect(last.exporter).toBe(exporter);
    expect(last.speakerMode).toBe('both');
    expect(last.participantMode).toBe('both');
  });
});

describe('PanelToolbar — clear button', () => {
  it('is disabled with hasConversation={false} and calls onClear when enabled', () => {
    const onClear = vi.fn();
    renderToolbar(['speaker'], { hasConversation: false, onClear });
    const button = screen.getByTitle('mainPanel.clearConversation');
    expect(button).toBeDisabled();

    cleanup();
    render(
      <PanelToolbar legs={['speaker']} exporter={exporter} hasConversation={true} onClear={onClear} />,
    );
    const enabledButton = screen.getByTitle('mainPanel.clearConversation');
    expect(enabledButton).not.toBeDisabled();
    fireEvent.click(enabledButton);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('PanelToolbar — font size', () => {
  it("moves useConversationDisplayStore's size by 2 within its bounds", () => {
    renderToolbar(['speaker']);
    fireEvent.click(screen.getByTitle('mainPanel.increaseFontSize'));
    expect(useConversationDisplayStore.getState().fontSize).toBe(16);
    fireEvent.click(screen.getByTitle('mainPanel.decreaseFontSize'));
    expect(useConversationDisplayStore.getState().fontSize).toBe(14);
  });

  it('disables the decrease button at the floor and the increase button at the ceiling', () => {
    useConversationDisplayStore.setState({ fontSize: CONVERSATION_FONT_SIZE_MIN });
    renderToolbar(['speaker']);
    expect(screen.getByTitle('mainPanel.decreaseFontSize')).toBeDisabled();

    cleanup();
    useConversationDisplayStore.setState({ fontSize: CONVERSATION_FONT_SIZE_MAX });
    renderToolbar(['speaker']);
    expect(screen.getByTitle('mainPanel.increaseFontSize')).toBeDisabled();
  });
});

describe('PanelToolbar — compact mode', () => {
  it('toggles compactMode and aria-pressed', () => {
    renderToolbar(['speaker']);
    const button = screen.getByTitle('mainPanel.compactView');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(useConversationDisplayStore.getState().compactMode).toBe(true);
    expect(screen.getByTitle('mainPanel.expandedView').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PanelToolbar — display settings popover', () => {
  it('opens DisplaySettingsPopover in a portal outside the toolbar container', () => {
    const { container } = renderToolbar(['speaker']);
    expect(screen.queryByTestId('display-settings-popover-marker')).toBeNull();
    fireEvent.click(screen.getByTitle('mainPanel.displaySettings'));
    const marker = screen.getByTestId('display-settings-popover-marker');
    expect(marker).toBeInTheDocument();
    expect(container.contains(marker)).toBe(false);
  });
});

describe('PanelToolbar — caption sharing', () => {
  it('offers caption sharing on the desktop app only', () => {
    env.electron = false;
    renderToolbar(['speaker']);
    expect(screen.queryByTestId('caption-share-marker')).toBeNull();
    cleanup();
    env.electron = true;
    renderToolbar(['speaker']);
    expect(screen.getByTestId('caption-share-marker')).toBeTruthy();
    env.electron = false;
  });
});

describe('PanelToolbar — what I hear', () => {
  it('puts the headphones entry before caption sharing, on every platform', () => {
    env.electron = true;
    renderToolbar(['speaker']);
    const hearing = screen.getByTestId('hearing-marker');
    const share = screen.getByTestId('caption-share-marker');
    expect(hearing.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    env.electron = false;
    renderToolbar(['speaker']);
    expect(screen.getByTestId('hearing-marker')).toBeTruthy();
  });
});

// Owner and design review, 2026-11-17 (B-30, B-40): the live notes are shown and hidden from a switch here, at the end of
// the conversation's toolbar, where it stays while they are hidden. Owner, 2026-11-18: it goes round three layouts of the
// conversation's area — side by side, the notes alone, the conversation alone.
describe('PanelToolbar — live notes switch', () => {
  const liveSwitch = () => screen.queryByRole('button', { name: 'liveNotes.title' });
  afterEach(() => {
    env.electron = false;
    useLiveNotesLayout.setState({ layout: 'both' });
    useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false });
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is there only while the live notes panel is, in the desktop app', () => {
    renderToolbar(['speaker']);
    expect(liveSwitch()).toBeNull();
    cleanup();
    env.electron = true;
    useSettingsStore.setState({ liveNotes: true } as never);
    useLiveNotes.getState().begin('run-0001-aaaa');
    renderToolbar(['speaker']);
    expect(liveSwitch()).not.toBeNull();
  });

  // Owner, 2026-11-17: with live notes on, the switch is there before the session starts too (its panel then empty).
  it('is there before a session starts while live notes are on, and not while they are off', () => {
    env.electron = true;
    useSettingsStore.setState({ liveNotes: true } as never);
    useLiveNotes.setState({ recordId: null, state: null, running: false, ended: false, off: false });
    renderToolbar(['speaker']);
    expect(liveSwitch()).not.toBeNull();
    cleanup();
    useSettingsStore.setState({ liveNotes: false } as never);
    renderToolbar(['speaker']);
    expect(liveSwitch()).toBeNull();
  });

  it('is not there outside the desktop app, live notes or not', () => {
    useSettingsStore.setState({ liveNotes: true } as never);
    useLiveNotes.getState().begin('run-0001-aaaa');
    renderToolbar(['speaker']);
    expect(liveSwitch()).toBeNull();
  });

  it('goes round side by side, the notes alone, the conversation alone; pressed while they show, saying what a click does', () => {
    env.electron = true;
    useSettingsStore.setState({ liveNotes: true } as never);
    useLiveNotes.getState().begin('run-0001-aaaa');
    renderToolbar(['speaker']);
    // Side by side.
    expect(liveSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(liveSwitch()).toHaveAttribute('title', 'liveNotes.showAlone');
    expect(liveSwitch()!.querySelector('.lucide-columns-2')).not.toBeNull();
    fireEvent.click(liveSwitch()!);
    // The notes alone.
    expect(useLiveNotesLayout.getState().layout).toBe('notes');
    expect(liveSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(liveSwitch()).toHaveAttribute('title', 'liveNotes.hide');
    expect(liveSwitch()!.querySelector('.lucide-notebook-text')).not.toBeNull();
    fireEvent.click(liveSwitch()!);
    // The conversation alone, the notes still being written, then not.
    expect(useLiveNotesLayout.getState().layout).toBe('conversation');
    expect(liveSwitch()).toHaveAttribute('aria-pressed', 'false');
    expect(liveSwitch()).toHaveAttribute('title', 'liveNotes.showWriting');
    expect(liveSwitch()!.querySelector('.lucide-message-square-text')).not.toBeNull();
    act(() => useLiveNotes.getState().end('run-0001-aaaa'));
    expect(liveSwitch()).toHaveAttribute('title', 'liveNotes.show');
    fireEvent.click(liveSwitch()!);
    expect(useLiveNotesLayout.getState().layout).toBe('both');
  });

  it('draws two rows in a narrow window when both are shown (the notes above the conversation)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    env.electron = true;
    useSettingsStore.setState({ liveNotes: true } as never);
    useLiveNotes.getState().begin('run-0001-aaaa');
    renderToolbar(['speaker']);
    expect(liveSwitch()!.querySelector('.lucide-rows-2')).not.toBeNull();
  });
});

describe('PanelToolbar — live notes switch styles', () => {
  it('fills the switch while the live notes are shown', async () => {
    const { compile } = await import('sass');
    const { resolve } = await import('node:path');
    const css = compile(resolve(__dirname, '../MainPanel.scss')).css;
    const on = css.match(/\.live-notes-switch\[aria-pressed=["']?true["']?\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(on).toMatch(/background:/);
    expect(on).toMatch(/color:/);
  });
});

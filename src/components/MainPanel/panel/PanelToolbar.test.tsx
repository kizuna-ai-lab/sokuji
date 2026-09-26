import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import useSettingsStore from '../../../stores/settingsStore';
import {
  useConversationDisplayStore,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../../stores/conversationDisplayStore';
import type { Exporter } from '../../../lib/export/exporter';
import type { LegName } from '../../../lib/conversation/types';
import PanelToolbar from './PanelToolbar';

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

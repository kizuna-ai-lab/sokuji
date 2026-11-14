import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../Display/DisplaySettingsPopover', () => ({
  default: ({ source, readingTargets }: { source: string; readingTargets?: ReadonlySet<string> }) => <div data-testid={`popover-${source}`} data-readings={[...(readingTargets ?? [])].join(',')} />,
}));
vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), isElectron: () => true }));
vi.mock('../../lib/reading/useReadingTargets', () => ({ useReadingTargets: () => new Set(['ja']) }));

import { DisplayCategory } from './DisplayCategory';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useSubtitleStore } from '../../stores/subtitleStore';

beforeEach(() => {
  useConversationDisplayStore.setState({ fontSize: 14, compactMode: false });
  useSubtitleStore.setState({ fontSize: 24, compactMode: false });
});
afterEach(() => cleanup());

const preview = () => screen.getByTestId('display-preview');

describe('display with a preview', () => {
  it('changes the preview as a value changes', async () => {
    render(<DisplayCategory locked={false} />);
    expect(preview()).toHaveAttribute('data-font-size', '14');
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    await waitFor(() => expect(useConversationDisplayStore.getState().fontSize).toBe(16));
    expect(preview()).toHaveAttribute('data-font-size', '16');
  });

  it('keeps the two surfaces apart', async () => {
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(preview()).toHaveAttribute('data-font-size', '24');
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    await waitFor(() => expect(useSubtitleStore.getState().fontSize).toBe(26));
    expect(useConversationDisplayStore.getState().fontSize).toBe(14);
  });

  it("shows caption mode's own controls only there", () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByTestId('popover-conversation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toBeInTheDocument();
    expect(screen.queryByTestId('popover-conversation')).toBeNull();
  });
});

describe('display — readings', () => {
  it("offers the readings switch for the main window, and for caption mode on the desktop unless it is compact", () => {
    render(<DisplayCategory locked={false} />);
    expect(screen.getByTestId('popover-conversation')).toHaveAttribute('data-readings', 'ja');
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toHaveAttribute('data-readings', 'ja');
    useSubtitleStore.setState({ compactMode: true });
    cleanup();
    render(<DisplayCategory locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Caption mode' }));
    expect(screen.getByTestId('popover-subtitle')).toHaveAttribute('data-readings', '');
  });
});

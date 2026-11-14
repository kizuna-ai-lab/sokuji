import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../Display/DisplaySettingsPopover', () => ({ default: ({ source }: { source: string }) => <div data-testid={`popover-${source}`} /> }));

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

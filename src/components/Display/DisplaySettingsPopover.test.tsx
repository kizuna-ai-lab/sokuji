import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import DisplaySettingsPopover from './DisplaySettingsPopover';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

describe('DisplaySettingsPopover', () => {
  beforeEach(() => {
    // Reset both stores to known starting state
    useSubtitleStore.setState({
      bgColor: '#000000',
      sourceTextColor: '#FFFFFF',
      translationTextColor: '#6CC5FF',
      bgOpacity: 80,
    } as Partial<ReturnType<typeof useSubtitleStore.getState>> as never);
    useConversationDisplayStore.setState({
      bgColor: '#1f1f1f',
      sourceTextColor: '#9aa0a6',
      translationTextColor: '#e8e8e8',
    } as Partial<ReturnType<typeof useConversationDisplayStore.getState>> as never);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders opacity slider when source=subtitle', () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('does NOT render opacity slider when source=conversation', () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it('clicking a preset chip in subtitle mode updates only subtitleStore', async () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    const whiteChip = container.querySelector(
      'button.swatch[aria-label="#FFFFFF"]',
    ) as HTMLButtonElement;
    expect(whiteChip).not.toBeNull();
    await act(async () => { fireEvent.click(whiteChip); });
    expect(useSubtitleStore.getState().bgColor).toBe('#FFFFFF');
    expect(useConversationDisplayStore.getState().bgColor).toBe('#1f1f1f');
  });

  it('clicking a preset chip in conversation mode updates only conversationDisplayStore', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const whiteChip = container.querySelector(
      'button.swatch[aria-label="#FFFFFF"]',
    ) as HTMLButtonElement;
    await act(async () => { fireEvent.click(whiteChip); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#FFFFFF');
    expect(useSubtitleStore.getState().bgColor).toBe('#000000');
  });

  it('clicking the new dark source-text preset updates the source color', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // The new "#1B5E20" deep-forest chip is in the SOURCE row only.
    const allChips = container.querySelectorAll('button.swatch[aria-label="#1B5E20"]');
    expect(allChips.length).toBe(1);
    await act(async () => { fireEvent.click(allChips[0] as HTMLButtonElement); });
    expect(useConversationDisplayStore.getState().sourceTextColor).toBe('#1B5E20');
  });

  it('preset chip is selected when current value matches', () => {
    useConversationDisplayStore.setState({ bgColor: '#000000' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const blackChip = container.querySelector('button.swatch[aria-label="#000000"]');
    expect(blackChip?.classList.contains('selected')).toBe(true);
    const customChip = container.querySelector('label.swatch.custom');
    expect(customChip?.classList.contains('selected')).toBe(false);
  });

  it('"+" chip is selected when current value is not in the row presets', () => {
    useConversationDisplayStore.setState({ bgColor: '#abcdef' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // BG row's custom chip
    const customChips = container.querySelectorAll('label.swatch.custom');
    expect(customChips.length).toBe(3);
    expect(customChips[0].classList.contains('selected')).toBe(true);
  });

  it('debounces "+" chip color picker changes by ~150ms (only last value applied)', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // The first custom chip's hidden input is the BG row's picker.
    const colorInput = container.querySelector(
      'label.swatch.custom input[type="color"]',
    ) as HTMLInputElement;
    expect(colorInput).not.toBeNull();

    fireEvent.change(colorInput, { target: { value: '#aaaaaa' } });
    fireEvent.change(colorInput, { target: { value: '#bbbbbb' } });
    fireEvent.change(colorInput, { target: { value: '#cccccc' } });

    // Before debounce window: setter NOT called yet
    expect(useConversationDisplayStore.getState().bgColor).toBe('#1f1f1f');

    // Advance past the 150ms debounce
    await act(async () => { vi.advanceTimersByTime(160); });

    // After debounce: only the LAST value applied
    expect(useConversationDisplayStore.getState().bgColor).toBe('#cccccc');
  });
});

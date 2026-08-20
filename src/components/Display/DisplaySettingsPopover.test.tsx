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
    const customChip = container.querySelector('button.swatch.custom');
    expect(customChip?.classList.contains('selected')).toBe(false);
  });

  it('"+" chip is selected when current value is not in the row presets', () => {
    useConversationDisplayStore.setState({ bgColor: '#abcdef' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // BG row's custom chip
    const customChips = container.querySelectorAll('button.swatch.custom');
    expect(customChips.length).toBe(3);
    expect(customChips[0].classList.contains('selected')).toBe(true);
  });

  it('the "+" chip toggles an inline picker instead of the OS color dialog', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    // The native input delegated to the OS dialog, which on Linux opens on a
    // fixed grid of shades. It must be gone.
    expect(container.querySelector('input[type="color"]')).toBeNull();

    const bgCustom = container.querySelectorAll('button.swatch.custom')[0] as HTMLButtonElement;
    expect(container.querySelector('.color-picker')).toBeNull();
    expect(bgCustom.getAttribute('aria-expanded')).toBe('false');

    await act(async () => { fireEvent.click(bgCustom); });
    expect(container.querySelectorAll('.color-picker').length).toBe(1);
    expect(bgCustom.getAttribute('aria-expanded')).toBe('true');

    await act(async () => { fireEvent.click(bgCustom); });
    expect(container.querySelector('.color-picker')).toBeNull();
  });

  it('opens the picker seeded with that row\'s current color', async () => {
    useConversationDisplayStore.setState({ sourceTextColor: '#7f3ac1' } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const sourceCustom = container.querySelectorAll('button.swatch.custom')[1] as HTMLButtonElement;
    await act(async () => { fireEvent.click(sourceCustom); });
    const hexInput = container.querySelector('input.color-picker__hex-input') as HTMLInputElement;
    expect(hexInput.value).toBe('#7f3ac1');
  });

  it('keeps only one row\'s picker open at a time', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const chips = container.querySelectorAll('button.swatch.custom');
    await act(async () => { fireEvent.click(chips[0]); });
    await act(async () => { fireEvent.click(chips[2]); });
    expect(container.querySelectorAll('.color-picker').length).toBe(1);
    expect(chips[0].getAttribute('aria-expanded')).toBe('false');
    expect(chips[2].getAttribute('aria-expanded')).toBe('true');
  });

  it('commits an arbitrary color typed into the picker\'s hex field', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const bgCustom = container.querySelectorAll('button.swatch.custom')[0] as HTMLButtonElement;
    await act(async () => { fireEvent.click(bgCustom); });
    const hexInput = container.querySelector('input.color-picker__hex-input') as HTMLInputElement;

    fireEvent.change(hexInput, { target: { value: '#7f3ac1' } });
    await act(async () => { vi.advanceTimersByTime(160); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#7f3ac1');
  });

  it('a preset click cancels a picker write still inside the debounce window', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const bgCustom = container.querySelectorAll('button.swatch.custom')[0] as HTMLButtonElement;
    await act(async () => { fireEvent.click(bgCustom); });
    const hexInput = container.querySelector('input.color-picker__hex-input') as HTMLInputElement;

    fireEvent.change(hexInput, { target: { value: '#7f3ac1' } });
    // Preset clicked before the debounce elapses. Both controls are visible at
    // once now that the picker is inline, so this is an easy sequence to hit.
    const bgField = container.querySelectorAll('.field')[0];
    const whiteChip = bgField.querySelector(
      'button.swatch[aria-label="#FFFFFF"]',
    ) as HTMLButtonElement;
    await act(async () => { fireEvent.click(whiteChip); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#FFFFFF');

    // The superseded picker write must not land afterwards.
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#FFFFFF');
  });

  it('debounces picker changes by ~150ms (only last value applied)', async () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const bgCustom = container.querySelectorAll('button.swatch.custom')[0] as HTMLButtonElement;
    await act(async () => { fireEvent.click(bgCustom); });
    const hexInput = container.querySelector('input.color-picker__hex-input') as HTMLInputElement;
    expect(hexInput).not.toBeNull();

    fireEvent.change(hexInput, { target: { value: '#aaaaaa' } });
    fireEvent.change(hexInput, { target: { value: '#bbbbbb' } });
    fireEvent.change(hexInput, { target: { value: '#cccccc' } });

    // Before debounce window: setter NOT called yet
    expect(useConversationDisplayStore.getState().bgColor).toBe('#1f1f1f');

    // Advance past the 150ms debounce
    await act(async () => { vi.advanceTimersByTime(160); });

    // After debounce: only the LAST value applied
    expect(useConversationDisplayStore.getState().bgColor).toBe('#cccccc');
  });

  it('renders the new-item-highlight toggle in subtitle mode only', () => {
    const subtitleRender = render(<DisplaySettingsPopover source="subtitle" />);
    expect(
      subtitleRender.container.querySelector('.toggle-switch-component'),
    ).not.toBeNull();
    subtitleRender.unmount();

    const conversationRender = render(<DisplaySettingsPopover source="conversation" />);
    expect(
      conversationRender.container.querySelector('.toggle-switch-component'),
    ).toBeNull();
  });

  it('clicking the new-item-highlight toggle flips subtitleStore.newItemHighlightEnabled', async () => {
    useSubtitleStore.setState({ newItemHighlightEnabled: true } as never);
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    const trigger = container.querySelector(
      '.toggle-switch-component [role="switch"]',
    ) as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-checked')).toBe('true');

    await act(async () => { fireEvent.click(trigger); });
    expect(useSubtitleStore.getState().newItemHighlightEnabled).toBe(false);

    await act(async () => { fireEvent.click(trigger); });
    expect(useSubtitleStore.getState().newItemHighlightEnabled).toBe(true);
  });

  it('first chip in each row reflects the source store default (subtitle)', () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    const fields = container.querySelectorAll('.field');
    // Field 0 = opacity slider; fields 1-3 = bg/source/translation
    const bgFirstChip = fields[1].querySelector('button.swatch') as HTMLButtonElement;
    const sourceFirstChip = fields[2].querySelector('button.swatch') as HTMLButtonElement;
    const translationFirstChip = fields[3].querySelector('button.swatch') as HTMLButtonElement;
    expect(bgFirstChip.getAttribute('aria-label')).toBe('#000000');
    expect(sourceFirstChip.getAttribute('aria-label')).toBe('#ffffff');
    expect(translationFirstChip.getAttribute('aria-label')).toBe('#9ad0ff');
  });

  it('first chip in each row reflects the source store default (conversation)', () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const fields = container.querySelectorAll('.field');
    // No opacity slider in conversation source; fields 0-2 = bg/source/translation
    const bgFirstChip = fields[0].querySelector('button.swatch') as HTMLButtonElement;
    const sourceFirstChip = fields[1].querySelector('button.swatch') as HTMLButtonElement;
    const translationFirstChip = fields[2].querySelector('button.swatch') as HTMLButtonElement;
    expect(bgFirstChip.getAttribute('aria-label')).toBe('#1f1f1f');
    expect(sourceFirstChip.getAttribute('aria-label')).toBe('#9aa0a6');
    expect(translationFirstChip.getAttribute('aria-label')).toBe('#e8e8e8');
  });
});

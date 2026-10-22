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

// The app's scheme as the conversation rows see it; a value to flip here.
const scheme = vi.hoisted(() => ({ current: 'dark' as 'dark' | 'light' }));
vi.mock('../../lib/theme/useScheme', () => ({ useScheme: () => scheme.current }));

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

  // The conversation's first chip is "Follow theme" (the describe below); it
  // wears the scheme's colour, the dark set here.
  it('first chip in each row is the follow-theme chip, in the scheme\'s colour (conversation)', () => {
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const fields = container.querySelectorAll('.field');
    // No opacity slider in conversation source; fields 0-2 = bg/source/translation
    const bgFirstChip = fields[0].querySelector('button.swatch') as HTMLButtonElement;
    const sourceFirstChip = fields[1].querySelector('button.swatch') as HTMLButtonElement;
    const translationFirstChip = fields[2].querySelector('button.swatch') as HTMLButtonElement;
    expect(bgFirstChip.getAttribute('aria-label')).toBe('Follow theme');
    expect(sourceFirstChip.getAttribute('aria-label')).toBe('Follow theme');
    expect(translationFirstChip.getAttribute('aria-label')).toBe('Follow theme');
    expect(bgFirstChip.style.background.replace(/\s/g, '')).toMatch(/^(#1f1f1f|rgb\(31,31,31\))$/);
    expect(sourceFirstChip.style.background.replace(/\s/g, '')).toMatch(/^(#9aa0a6|rgb\(154,160,166\))$/);
    expect(translationFirstChip.style.background.replace(/\s/g, '')).toMatch(/^(#e8e8e8|rgb\(232,232,232\))$/);
  });
});

// A conversation colour the user never set follows the app's scheme (spec
// 2026-10-22 §3, R3 as amended). In the conversation rows the first chip is
// that choice: it shows the scheme's colour and is selected while nothing is
// stored; picking it again clears a stored colour. The subtitle rows keep
// their fixed default chip.
describe('conversation colours follow the theme until set', () => {
  const firstChip = (container: HTMLElement, field: number) =>
    container.querySelectorAll('.field')[field].querySelector('button.swatch') as HTMLButtonElement;
  const customChip = (container: HTMLElement, field: number) =>
    container.querySelectorAll('.field')[field].querySelector('button.swatch.custom') as HTMLButtonElement;
  const bg = (el: HTMLElement) => el.style.background.replace(/\s/g, '');

  afterEach(() => { scheme.current = 'dark'; });

  it('the first chip is "Follow theme", selected while nothing is stored, in the dark scheme\'s colours', () => {
    useConversationDisplayStore.setState({ bgColor: null, sourceTextColor: null, translationTextColor: null } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    for (const field of [0, 1, 2]) {
      expect(firstChip(container, field).getAttribute('aria-label')).toBe('Follow theme');
      expect(firstChip(container, field).classList.contains('selected')).toBe(true);
      expect(customChip(container, field).classList.contains('selected')).toBe(false);
    }
    expect(bg(firstChip(container, 0))).toMatch(/^(#1f1f1f|rgb\(31,31,31\))$/);
    expect(bg(firstChip(container, 1))).toMatch(/^(#9aa0a6|rgb\(154,160,166\))$/);
    expect(bg(firstChip(container, 2))).toMatch(/^(#e8e8e8|rgb\(232,232,232\))$/);
  });

  it('under the light scheme the chip shows the white set', () => {
    scheme.current = 'light';
    useConversationDisplayStore.setState({ bgColor: null, sourceTextColor: null, translationTextColor: null } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    expect(bg(firstChip(container, 0))).toMatch(/^(#ffffff|rgb\(255,255,255\))$/);
    expect(bg(firstChip(container, 1))).toMatch(/^(#5f6368|rgb\(95,99,104\))$/);
    expect(bg(firstChip(container, 2))).toMatch(/^(#1a1a1a|rgb\(26,26,26\))$/);
    expect(firstChip(container, 0).classList.contains('selected')).toBe(true);
  });

  it('a stored colour is shown as such, and clicking "Follow theme" clears it', async () => {
    useConversationDisplayStore.setState({ bgColor: '#123456', sourceTextColor: null, translationTextColor: null } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    expect(firstChip(container, 0).classList.contains('selected')).toBe(false);
    expect(customChip(container, 0).classList.contains('selected')).toBe(true);
    expect(bg(customChip(container, 0))).toMatch(/^(#123456|rgb\(18,52,86\))$/);
    await act(async () => { fireEvent.click(firstChip(container, 0)); });
    expect(useConversationDisplayStore.getState().bgColor).toBeNull();
    expect(useConversationDisplayStore.getState().sourceTextColor).toBeNull();
  });

  it('a preset click still stores that colour', async () => {
    useConversationDisplayStore.setState({ bgColor: null, sourceTextColor: null, translationTextColor: null } as never);
    const { container } = render(<DisplaySettingsPopover source="conversation" />);
    const white = container.querySelectorAll('.field')[0].querySelector('button.swatch[aria-label="#FFFFFF"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(white); });
    expect(useConversationDisplayStore.getState().bgColor).toBe('#FFFFFF');
  });

  it('the subtitle rows keep a fixed default chip, named by its colour', () => {
    const { container } = render(<DisplaySettingsPopover source="subtitle" />);
    expect(firstChip(container, 1).getAttribute('aria-label')).toBe('#000000');
  });
});

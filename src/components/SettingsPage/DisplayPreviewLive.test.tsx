// Display — size, colours and compact view preview at once; compact view leaves the settings page alone;
// with no language pair to speak, the preview's sample follows the interface language.
// The real colour rows (DisplaySettingsPopover) and the real i18n catalogs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), isElectron: () => true }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/theme/useScheme', () => ({ useScheme: () => 'dark' }));
vi.mock('../../lib/reading/useReadingTargets', () => ({ useReadingTargets: () => new Set() }));

import { changeLanguageWithLoad } from '../../locales';
import { DisplayCategory } from './DisplayCategory';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import useSettingsStore from '../../stores/settingsStore';
import { useProviderStore } from '../../stores/providerStore';
import { SAMPLE_LINES } from './displaySamples';

beforeEach(() => {
  useConversationDisplayStore.setState({ fontSize: 14, compactMode: false, bgColor: null, sourceTextColor: null, translationTextColor: null, showReadings: false } as never);
  useSubtitleStore.setState({ fontSize: 24, compactMode: false });
  useSettingsStore.setState({ speakerDisplayMode: 'both', participantDisplayMode: 'both' } as never);
  // No pair to speak: the sample takes the interface language.
  useProviderStore.setState({ selected: null, entries: {} });
});
afterEach(async () => { cleanup(); await changeLanguageWithLoad('en'); });

const preview = () => screen.getByTestId('display-preview');
const surface = () => preview().querySelector<HTMLElement>('.display-preview__surface')!;

describe('display: size, colours, compact view, sample language', () => {
  it('a colour chosen in the colour rows shows in the preview at once', async () => {
    render(<DisplayCategory locked={false} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '#0d2032' })); });
    await waitFor(() => expect(useConversationDisplayStore.getState().bgColor).toBe('#0d2032'));
    expect(surface().style.background).toBe('rgb(13, 32, 50)');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '#FF6B6B' })); });
    expect(surface().style.getPropertyValue('--conversation-source-color')).toBe('#FF6B6B');
  });

  it('a smaller size shows in the preview at once', async () => {
    render(<DisplayCategory locked={false} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Smaller text' })); });
    expect(preview()).toHaveAttribute('data-font-size', '12');
    expect(surface().style.fontSize).toBe('12px');
  });

  it('compact view changes the preview only, not the settings page itself', async () => {
    const { container } = render(<DisplayCategory locked={false} />);
    const controlsBefore = within(container.querySelector('.display-category__rows') as HTMLElement).getAllByRole('button').length;
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Compact view' })); });
    expect(useConversationDisplayStore.getState().compactMode).toBe(true);
    expect(preview().querySelectorAll('.conversation-row.compact').length).toBe(3);
    // Nothing outside the preview is drawn compact, and the page keeps every control.
    const compactOutside = [...container.querySelectorAll('[class*="compact"]')].filter((el) => !preview().contains(el));
    expect(compactOutside).toEqual([]);
    expect(within(container.querySelector('.display-category__rows') as HTMLElement).getAllByRole('button')).toHaveLength(controlsBefore);
    expect(document.documentElement.className).not.toMatch(/compact/);
    expect(document.body.className).not.toMatch(/compact/);
  });

  it('with no pair, the sample sentences follow the interface language as it changes', async () => {
    render(<DisplayCategory locked={false} />);
    expect(preview()).toHaveTextContent(SAMPLE_LINES.en[0]);
    await act(async () => { await changeLanguageWithLoad('ja'); });
    expect(preview()).toHaveTextContent(SAMPLE_LINES.ja[0]);
    await act(async () => { await changeLanguageWithLoad('zh_CN'); });
    expect(preview()).toHaveTextContent(SAMPLE_LINES.zh[0]);
    expect(preview()).not.toHaveTextContent(SAMPLE_LINES.ja[0]);
  });
});

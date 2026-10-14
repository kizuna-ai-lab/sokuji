import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ReadingLanguage } from '../../lib/reading/types';

// A keyed t: proves the label's keys are read (the suites cannot see localisation otherwise).
const CATALOG: Record<string, string> = {
  'subtitle.settings.readings': 'R[{{language}}|{{scheme}}]',
  'subtitle.settings.readingScheme.kana': 'KANA',
  'subtitle.settings.readingScheme.pinyin': 'PINYIN',
  'subtitle.settings.readingsDownloading': 'DL {{done}}/{{total}}',
  'subtitle.settings.readingsDownloadFailed': 'DL FAILED',
  'common.retry': 'AGAIN',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      const vars = typeof opts === 'object' ? opts : {};
      const template = CATALOG[key] ?? (typeof opts === 'string' ? opts : (vars.defaultValue as string) ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name]));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => `L(${code})` }));
const trackEvent = vi.fn();
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
let japanese: { phase: string; done?: number; total?: number } = { phase: 'off' };
const retryJapanese = vi.fn();
vi.mock('../../lib/reading/ja/runtime', () => ({
  getJapaneseState: () => japanese,
  subscribeJapanese: () => () => {},
  retryJapanese: () => retryJapanese(),
}));

const { default: DisplaySettingsPopover } = await import('./DisplaySettingsPopover');
const { useConversationDisplayStore } = await import('../../stores/conversationDisplayStore');
const { useSubtitleStore } = await import('../../stores/subtitleStore');

const JA: ReadonlySet<ReadingLanguage> = new Set<ReadingLanguage>(['ja']);

describe('the readings row', () => {
  beforeEach(() => {
    japanese = { phase: 'off' };
    trackEvent.mockClear();
    useConversationDisplayStore.setState({ showReadings: false } as never);
    useSubtitleStore.setState({ showReadings: false } as never);
  });

  it('names the language and scheme through their keys', () => {
    const { getByText } = render(<DisplaySettingsPopover source="conversation" readingTargets={JA} />);
    expect(getByText('R[L(ja)|KANA]')).toBeTruthy();
  });

  it("names Chinese for a zh+en target's reading language", () => {
    const { getByText } = render(<DisplaySettingsPopover source="conversation" readingTargets={new Set<ReadingLanguage>(['zh'])} />);
    expect(getByText('R[L(zh)|PINYIN]')).toBeTruthy();
  });

  it('is not drawn when the target has no scheme', () => {
    const { queryByText } = render(<DisplaySettingsPopover source="conversation" readingTargets={new Set<ReadingLanguage>()} />);
    expect(queryByText(/^R\[/)).toBeNull();
  });

  it('is not drawn in the subtitle popover unless offered (compact view, extension overlay)', () => {
    const { queryByText, rerender } = render(<DisplaySettingsPopover source="subtitle" />);
    expect(queryByText(/^R\[/)).toBeNull();
    rerender(<DisplaySettingsPopover source="subtitle" readingTargets={JA} />);
    expect(queryByText('R[L(ja)|KANA]')).toBeTruthy();
  });

  it("switches its own surface's store and sends one event", () => {
    const { getByRole } = render(<DisplaySettingsPopover source="subtitle" readingTargets={JA} />);
    fireEvent.click(getByRole('switch', { name: /R\[/ }));
    expect(useSubtitleStore.getState().showReadings).toBe(true);
    expect(useConversationDisplayStore.getState().showReadings).toBe(false);
    expect(trackEvent).toHaveBeenCalledWith('readings_changed', { surface: 'subtitle', language: 'ja', enabled: true });
  });

  it('shows the Japanese download while the switch is on, and a retry after a failure', () => {
    useConversationDisplayStore.setState({ showReadings: true } as never);
    japanese = { phase: 'downloading', done: 7_340_032, total: 17_750_350 };
    const { getByText, rerender, getByRole } = render(<DisplaySettingsPopover source="conversation" readingTargets={JA} />);
    expect(getByText('DL 7.0 MB/16.9 MB')).toBeTruthy();
    japanese = { phase: 'failed' };
    rerender(<DisplaySettingsPopover source="conversation" readingTargets={JA} />);
    expect(getByText('DL FAILED')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'AGAIN' }));
    expect(retryJapanese).toHaveBeenCalled();
  });
});

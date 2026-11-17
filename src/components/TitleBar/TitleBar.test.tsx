import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import TitleBar from './TitleBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
vi.mock('../../utils/environment', () => ({ isElectron: () => true, isMacOS: () => false }));
vi.mock('../Subtitle/SubtitleEnterButton', () => ({ default: () => <button>subtitle</button> }));
vi.mock('./AccountButton', () => ({ default: () => <button className="account-button" /> }));

const props = {
  showSettings: false, showLogs: false,
  onToggleSettings: vi.fn(), onToggleLogs: vi.fn(),
};

beforeEach(cleanup);

describe('TitleBar', () => {
  it('hides the logs button in basic mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={false} />);
    expect(container.querySelector('.logs-button')).toBeNull();
  });

  it('shows the logs button in advanced mode', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    expect(container.querySelector('.logs-button')).toBeTruthy();
  });

  // Owner, 2026-11-17: everything spelled out while it fits (jsdom lays nothing out, so it always fits here).
  it('starts with everything spelled out', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={false} />);
    expect(container.querySelector('.title-bar')?.getAttribute('data-fit')).toBe('0');
  });

  // Review: what each step needed is measured anew when what the bar holds changes (the logs button, who pays), not
  // only with the language; otherwise a bar that fits again stays on icons until the window is widened past the old need.
  it('measures again when what the bar holds changes', async () => {
    let wide = 730;
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList?.contains('title-bar') ? wide : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('title-bar') ? 700 : 0; } });
    try {
      const { container, rerender } = render(<TitleBar {...props} showLogsButton={true} />);
      const bar = container.querySelector('.title-bar')!;
      // 30 px too many at 700: icons alone.
      expect(bar.getAttribute('data-fit')).toBe('2');
      // Without the logs button everything fits at the same width.
      wide = 700;
      rerender(<TitleBar {...props} showLogsButton={false} />);
      await act(async () => { await Promise.resolve(); });
      expect(bar.getAttribute('data-fit')).toBe('0');
    } finally {
      // jsdom keeps both on Element: with no own property here before, the stand-ins are taken away (review).
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scroll);
      else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      if (client) Object.defineProperty(HTMLElement.prototype, 'clientWidth', client);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it('places the account slot before the subtitle button', () => {
    const { container } = render(<TitleBar {...props} showLogsButton={true} />);
    const actions = container.querySelector('.title-bar__actions')!;
    expect(actions.firstElementChild!.classList.contains('account-button')).toBe(true);
  });
});

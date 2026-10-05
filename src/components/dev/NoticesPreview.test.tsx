import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { BANNER_CASE_LABELS, EVENT_CASES, NoticesPreview, STATUS_CASES } from './NoticesPreview';

// t returns the fallback, or the key: the page's words are not what is tested.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key), i18n: { language: 'en', changeLanguage: vi.fn(), options: {} } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// The page switches language through the app's own loader (the catalogs load on demand).
const changeLanguageWithLoad = vi.hoisted(() => vi.fn(async (lng: string) => lng));
vi.mock('../../locales', () => ({ changeLanguageWithLoad }));

afterEach(() => { cleanup(); changeLanguageWithLoad.mockClear(); });

const section = (container: HTMLElement, name: 'event' | 'state' | 'app') =>
  container.querySelector(`[data-section="${name}"]`) as HTMLElement;

describe('NoticesPreview (dev page, ?preview=notices)', () => {
  it('switches the interface language through the app’s loader', () => {
    const { getByRole } = render(<NoticesPreview />);
    fireEvent.change(getByRole('combobox'), { target: { value: 'zh_CN' } });
    expect(changeLanguageWithLoad).toHaveBeenCalledWith('zh_CN');
  });

  it('event: draws every case as a system row in the real conversation list, alone and all together', () => {
    const { container } = render(<NoticesPreview />);
    const events = section(container, 'event');
    // One panel per case, and one last panel with every row in sequence.
    expect(events.querySelectorAll('.main-panel-wrapper')).toHaveLength(EVENT_CASES.length + 1);
    expect(events.querySelectorAll('.sys-row')).toHaveLength(EVENT_CASES.length * 2);
    for (const severity of ['error', 'warning', 'info']) expect(events.querySelector(`.sys-row--${severity}`)).not.toBeNull();
    // A voice warning reaches Settings (its code's action); a saved note offers its own folder.
    const actions = [...events.querySelectorAll('.sys-row__action')].map((b) => b.textContent);
    expect(actions).toEqual(expect.arrayContaining(['Settings', 'Show in folder']));
    // The rows sit among real bubbles.
    expect(events.querySelector('.conversation-row')).not.toBeNull();
  });

  it('state: draws every status-line case through the real selector, one line each', () => {
    const { container } = render(<NoticesPreview />);
    const keys = [...container.querySelectorAll('.status-line')].map((el) => el.getAttribute('data-status'));
    expect(keys).toHaveLength(STATUS_CASES.length);
    // Every priority of the selector is on the page (spec 2026-10-05 §3).
    for (const key of [
      'unready:credentials_missing', 'unready:balance_below_floor', 'unready:no_microphone', 'unready:message',
      'last-end:start_failed', 'reconnecting', 'mic-waiting', 'subtitle-entry',
      'echo:tts-echo', 'echo:meeting-echo', 'echo:far-end-echo', 'echo:self-capture', 'echo:routing-loop',
    ]) expect(keys).toContain(key);
    expect(section(container, 'state').querySelectorAll('.status-line')).toHaveLength(STATUS_CASES.length);
  });

  it('state: draws the footer of the chosen mode under each line', () => {
    const { container, getByRole } = render(<NoticesPreview />);
    expect(container.querySelectorAll('.control-footer.basic')).toHaveLength(STATUS_CASES.length);
    fireEvent.click(getByRole('button', { name: 'advanced' }));
    expect(container.querySelectorAll('.control-footer.advanced')).toHaveLength(STATUS_CASES.length);
    expect(container.querySelector('.control-footer.basic')).toBeNull();
  });

  it('app: draws every banner state, attention above brand when both show', () => {
    const { container } = render(<NoticesPreview />);
    const app = section(container, 'app');
    const panels = [...app.querySelectorAll('.main-panel-wrapper')];
    expect(panels).toHaveLength(BANNER_CASE_LABELS.length);
    expect(app.querySelector('.banner--attention')).not.toBeNull();
    expect(app.querySelector('.banner--brand')).not.toBeNull();
    expect(app.querySelectorAll('.banner__progress')).toHaveLength(1);
    expect(app.querySelector('.banner__code')).not.toBeNull();
    expect(app.querySelector('.banner__btn:disabled')).not.toBeNull();
    const stacked = panels[panels.length - 1] as HTMLElement;
    expect([...stacked.querySelectorAll('.banner')].map((b) => b.className)).toEqual(['banner banner--attention', 'banner banner--brand']);
  });

  it('sets every panel to the chosen width', () => {
    const { container, getByRole } = render(<NoticesPreview />);
    fireEvent.click(getByRole('button', { name: '300px' }));
    for (const panel of container.querySelectorAll<HTMLElement>('.main-panel-wrapper')) expect(panel.style.width).toBe('300px');
  });
});

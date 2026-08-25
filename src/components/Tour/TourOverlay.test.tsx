import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));
const api = { active: true, chapter: 'basics', ctx: { platform: 'electron', os: 'linux', isSignedIn: true, apiKeyValid: true, providerPath: 'managed', mode: 'speaker', textOnly: false, scenario: 'be-heard', provider: 'x' },
  steps: [{ id: 'welcome' }, { id: 'mode-picker', anchor: 'mode-picker' }, { id: 'done' }], index: 0, step: { id: 'welcome' } as { id: string; anchor?: string }, target: null as HTMLElement | null, resolving: false,
  start: vi.fn(), next: vi.fn(), back: vi.fn(), skip: vi.fn() };
vi.mock('./TourProvider', () => ({ useTour: () => api }));

import TourOverlay from './TourOverlay';

beforeEach(() => { api.index = 0; api.step = { id: 'welcome' }; api.target = null; api.active = true; api.next.mockClear(); api.back.mockClear(); api.skip.mockClear(); });
afterEach(cleanup);

describe('TourOverlay', () => {
  it('renders nothing when the tour is idle', () => {
    api.active = false;
    const { container } = render(<TourOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a centred card with progress, no Back on the first step', () => {
    render(<TourOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(api.next).toHaveBeenCalled();
  });

  it('Escape skips, Enter advances, and the last step says Finish', () => {
    render(<TourOverlay />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(api.next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(api.skip).toHaveBeenCalled();
    cleanup();
    api.index = 2; api.step = { id: 'done' };
    render(<TourOverlay />);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('draws the spotlight over the target when there is one', () => {
    document.body.innerHTML = '<div data-tour="mode-picker"></div>';
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = document.querySelector('[data-tour="mode-picker"]') as HTMLElement;
    render(<TourOverlay />);
    expect(document.querySelector('.tour-spotlight')).not.toBeNull();
    expect(document.querySelector('.tour-scrim--full')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));
const api = { active: true, chapter: 'basics', ctx: { platform: 'electron', os: 'linux', isSignedIn: true, apiKeyValid: true, providerPath: 'managed', mode: 'speaker', textOnly: false, scenario: 'be-heard', provider: 'x' },
  steps: [{ id: 'welcome' }, { id: 'mode-picker', anchor: 'mode-picker' }, { id: 'done' }], index: 0, step: { id: 'welcome' } as { id: string; anchor?: string }, target: null as HTMLElement | null, resolving: false,
  start: vi.fn(), next: vi.fn(), back: vi.fn(), skip: vi.fn() };
vi.mock('./TourProvider', () => ({ useTour: () => api }));
// The sign-in overlay the `account` step sends a signed-out user to. While it
// owns Escape, the tour must not also treat that Escape as "skip the tour".
let authOverlayState: 'sign-in' | 'sign-up' | 'forgot-password' | null = null;
vi.mock('../../stores/settingsStore', () => ({ useAuthOverlay: () => authOverlayState }));

import TourOverlay from './TourOverlay';

beforeEach(() => { api.index = 0; api.step = { id: 'welcome' }; api.target = null; api.active = true; api.resolving = false; authOverlayState = null; api.next.mockClear(); api.back.mockClear(); api.skip.mockClear(); });
afterEach(cleanup);

describe('TourOverlay', () => {
  it('renders nothing when the tour is idle', () => {
    api.active = false;
    render(<TourOverlay />);
    // Everything renders through FloatingPortal into document.body, so the
    // render container is empty either way — assert against the document.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.tour-scrim, .tour-spotlight')).toBeNull();
  });

  it('names and describes the dialog from its own heading and body', () => {
    render(<TourOverlay />);
    // aria-labelledby/-describedby rather than a duplicated aria-label string:
    // a screen reader reads the heading and the body it can already see.
    const dialog = screen.getByRole('dialog', { name: 'welcome' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(document.querySelector('.tour-popover__title')!.id);
    expect(dialog.getAttribute('aria-describedby')).toBe(document.querySelector('.tour-popover__body')!.id);
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

  it('darkens nothing while an anchored step is still resolving', () => {
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = null; api.resolving = true;
    render(<TourOverlay />);
    // A full scrim here would black out the viewport for the whole anchor wait
    // (up to 1.5s, and on every step whose prepare opens or closes settings).
    expect(document.querySelector('.tour-scrim--full')).toBeNull();
    expect(document.querySelector('.tour-spotlight')).toBeNull();
    // Queried by class rather than by role: `is-resolving` is a presentation
    // state (transparent and inert), not an a11y one — the popover stays in the
    // tree so it can keep keyboard focus across the transition.
    expect(document.querySelector('.tour-popover')!.className).toContain('is-resolving');
  });

  it('leaves Escape to the auth overlay while it is open', () => {
    authOverlayState = 'sign-in';
    render(<TourOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(api.skip).not.toHaveBeenCalled();
    cleanup();
    authOverlayState = null;
    render(<TourOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(api.skip).toHaveBeenCalled();
  });

  it('leaves Enter to the focused button instead of always advancing', () => {
    render(<TourOverlay />);
    const skip = screen.getByRole('button', { name: 'Skip' });
    skip.focus();
    // jsdom does not run a button's native activation from a synthetic keyDown,
    // so the property under test is the negative one: the container handler must
    // keep its hands off and let the browser click the focused button.
    fireEvent.keyDown(skip, { key: 'Enter' });
    expect(api.next).not.toHaveBeenCalled();
    expect(api.skip).not.toHaveBeenCalled();
  });

  it('puts focus back on the primary button once a step stops resolving', () => {
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = null; api.resolving = true;
    const { rerender } = render(<TourOverlay />);
    // What a browser does to focus when the popover goes inert mid-step: the
    // active element drops to <body>. `autoFocus` fires on mount only, so
    // nothing puts it back — Enter then does nothing until the user Tabs.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    api.resolving = false;
    rerender(<TourOverlay />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
  });

  it('draws the spotlight over the target when there is one', () => {
    document.body.innerHTML = '<div data-tour="mode-picker"></div>';
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = document.querySelector('[data-tour="mode-picker"]') as HTMLElement;
    render(<TourOverlay />);
    expect(document.querySelector('.tour-spotlight')).not.toBeNull();
    expect(document.querySelector('.tour-scrim--full')).toBeNull();
  });

  it('keeps the app inoperable under the spotlight (spec 2.1)', () => {
    // The spotlight ignores pointer events and its box-shadow is not
    // hit-testable, so without a blocker the whole app stays clickable behind
    // an anchored step — including the very control the step is describing.
    document.body.innerHTML = '<div data-tour="mode-picker"></div>';
    api.index = 1; api.step = { id: 'mode-picker', anchor: 'mode-picker' }; api.target = document.querySelector('[data-tour="mode-picker"]') as HTMLElement;
    render(<TourOverlay />);
    expect(document.querySelector('.tour-blocker')).not.toBeNull();
  });

  it('needs no blocker on a centred step: the full scrim already blocks', () => {
    render(<TourOverlay />);
    expect(document.querySelector('.tour-scrim--full')).not.toBeNull();
    expect(document.querySelector('.tour-blocker')).toBeNull();
  });

  describe('synchronous focusin fallback (F1: rapid Tab can outrun FloatingFocusManager)', () => {
    // jsdom dispatches `focusin` natively from `element.focus()` in this
    // setup (confirmed by the first, pre-fix run of the test below actually
    // failing on the real listener path) — no synthetic dispatch needed.
    // Every element this suite parks in document.body outside the render
    // container (outside buttons, the focus-guard span) is tracked here and
    // swept up afterwards so a failing assertion can't leave a stray
    // focusable node for a later test to trip over.
    let extraEls: HTMLElement[] = [];
    const appendOutside = (tag: string = 'button') => {
      const el = document.createElement(tag);
      if (tag === 'button') el.textContent = 'outside';
      document.body.appendChild(el);
      extraEls.push(el);
      return el;
    };
    afterEach(() => {
      extraEls.forEach((el) => el.remove());
      extraEls = [];
    });

    it('pulls focus back onto the primary button when an outside element is focused', () => {
      render(<TourOverlay />);
      const outside = appendOutside();

      outside.focus();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
    });

    // Covers the containment check itself: if `refs.floating.current.contains(...)`
    // regressed to always-false, this would fail because focus would get
    // yanked from Skip back onto Next even though Skip is inside the popover.
    it('leaves focus alone on a button already inside the popover (Skip)', () => {
      render(<TourOverlay />);
      const skip = screen.getByRole('button', { name: 'Skip' });

      skip.focus();

      expect(document.activeElement).toBe(skip);
    });

    // Covers the focus-guard ignore rule: if the `[data-floating-ui-focus-guard]`
    // check regressed, this would fail because the guard span would get
    // pulled back onto Next instead of being left for floating-ui's own wrap.
    it("leaves focus alone on floating-ui's own focus guard", () => {
      render(<TourOverlay />);
      const guard = appendOutside('span');
      guard.setAttribute('data-floating-ui-focus-guard', '');
      guard.tabIndex = 0;

      guard.focus();

      expect(document.activeElement).toBe(guard);
    });

    it('leaves focus on the outside element while the auth overlay is open, and resumes pulling it back once the overlay closes', () => {
      authOverlayState = 'sign-in';
      const { rerender } = render(<TourOverlay />);
      const outside = appendOutside();

      outside.focus();
      expect(document.activeElement).toBe(outside);

      // Positive control: closing the overlay must re-arm the fallback on
      // the SAME mounted overlay, not just prove the listener never ran.
      authOverlayState = null;
      rerender(<TourOverlay />);
      // Move focus onto the primary button first: re-focusing an element
      // that's already `document.activeElement` doesn't fire a new
      // `focusin` event, so the pull-back can't be observed by re-focusing
      // `outside` while it's still the (unchanged) active element.
      screen.getByRole('button', { name: 'Next' }).focus();
      outside.focus();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
    });

    it('stops pulling focus back after unmount, and a fresh mount resumes it', () => {
      const { unmount } = render(<TourOverlay />);
      unmount();
      const outside = appendOutside();

      outside.focus();
      expect(document.activeElement).toBe(outside);

      // Positive control: a fresh TourOverlay instance must still pull focus
      // back, so the prior assertion is proof the LISTENER was removed, not
      // that focusin handling is broken outright.
      render(<TourOverlay />);
      // Same reasoning as above: force a genuine focus change onto the
      // fresh instance's primary button before re-focusing `outside`.
      screen.getByRole('button', { name: 'Next' }).focus();
      outside.focus();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
    });
  });
});

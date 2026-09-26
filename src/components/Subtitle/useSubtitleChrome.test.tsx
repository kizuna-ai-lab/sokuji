import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const setFullscreen = vi.fn(async () => {});
let fullscreen = false;
let locked = false;

vi.mock('../../stores/settingsStore', () => ({
  __esModule: true,
  default: { getState: () => ({ __syncSubtitleFullscreen: vi.fn(), subtitleModeActive: false }) },
  useSubtitleFullscreen: () => fullscreen,
  useSetSubtitleFullscreen: () => setFullscreen,
}));
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({ bgColor: '#000000', bgOpacity: 80, fontSize: 24, compactMode: false, sourceTextColor: '#FF00FF', translationTextColor: '#00FF00' }),
  useSaveSubtitleWindowBounds: () => vi.fn(async () => {}),
  useSubtitlePositionLocked: () => locked,
}));
vi.mock('./useOverlayDragResize', () => ({ useOverlayDragResize: () => ({ resizeHandleProps: {} }) }));

const { useSubtitleChrome, getHighlightOverlayForBg } = await import('./useSubtitleChrome');

function Probe({ surface, onExit, forceVisible }: { surface: 'electron' | 'extension-overlay'; onExit: () => void; forceVisible?: boolean }) {
  const chrome = useSubtitleChrome({ surface, onExit, forceVisible });
  return <div ref={chrome.rootRef} {...chrome.rootProps}>{chrome.resizeHandles}</div>;
}

const opacityOf = (root: HTMLElement) => root.style.getPropertyValue('--bar-opacity');

beforeEach(() => {
  cleanup();
  fullscreen = false;
  locked = false;
  setFullscreen.mockClear();
  vi.useRealTimers();
});

describe('useSubtitleChrome', () => {
  it('leaves subtitle mode on Escape, and leaves fullscreen first when in it', () => {
    const onExit = vi.fn();
    const { unmount } = render(<Probe surface="electron" onExit={onExit} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
    unmount();
    fullscreen = true;
    render(<Probe surface="electron" onExit={onExit} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setFullscreen).toHaveBeenCalledWith(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('gives the root its class, background and the text colour variable', () => {
    const { container } = render(<Probe surface="electron" onExit={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('subtitle-app');
    expect(root.style.background).not.toBe('');
    expect(root.style.getPropertyValue('--subtitle-source-color')).toBe('#FF00FF');
  });

  it('draws the resize handles only on an unlocked overlay', () => {
    const count = (surface: 'electron' | 'extension-overlay') => {
      const { container, unmount } = render(<Probe surface={surface} onExit={() => {}} />);
      const n = container.querySelectorAll('.subtitle-app__resize').length;
      unmount();
      return n;
    };
    expect(count('extension-overlay')).toBe(8);
    expect(count('electron')).toBe(0);
    locked = true;
    expect(count('extension-overlay')).toBe(0);
  });

  // Follow-up D: the overlay's hold-to-talk control moved into the bar, which
  // auto-hides on inactivity — a turn held with the mouse motionless over the
  // button must not have its own bar vanish out from under it.
  describe('forceVisible (the bar stays up while a turn is held)', () => {
    beforeEach(() => vi.useFakeTimers());

    it('keeps the bar visible past the idle timeout while forceVisible is true', () => {
      const { container, rerender } = render(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={false} />);
      const root = container.firstElementChild as HTMLElement;
      // Arm the auto-hide the way real mouse activity would.
      act(() => { fireEvent.mouseMove(root); });
      rerender(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={true} />);
      act(() => { vi.advanceTimersByTime(5000); });
      expect(opacityOf(root)).toBe('1');
    });

    it('reveals the bar immediately when forceVisible turns on, even if it had already hidden', () => {
      const { container, rerender } = render(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={false} />);
      const root = container.firstElementChild as HTMLElement;
      act(() => { fireEvent.mouseMove(root); });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(opacityOf(root)).toBe('0');
      rerender(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={true} />);
      expect(opacityOf(root)).toBe('1');
    });

    it('resumes the idle countdown once forceVisible turns back off', () => {
      const { container, rerender } = render(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={true} />);
      const root = container.firstElementChild as HTMLElement;
      rerender(<Probe surface="extension-overlay" onExit={() => {}} forceVisible={false} />);
      expect(opacityOf(root)).toBe('1');
      act(() => { vi.advanceTimersByTime(5000); });
      expect(opacityOf(root)).toBe('0');
    });
  });
});

describe('getHighlightOverlayForBg', () => {
  it('returns a translucent white overlay for the default black background', () => {
    expect(getHighlightOverlayForBg('#000000')).toBe('rgba(255,255,255,0.3)');
  });

  it('returns a translucent black overlay for a white background', () => {
    expect(getHighlightOverlayForBg('#ffffff')).toBe('rgba(0,0,0,0.3)');
  });

  it('flips at the YIQ midpoint (≈ 128)', () => {
    // YIQ for #555555 = 0.299*85 + 0.587*85 + 0.114*85 = 85 < 128 → dark → white overlay
    expect(getHighlightOverlayForBg('#555555')).toBe('rgba(255,255,255,0.3)');
    // YIQ for #aaaaaa = 170 > 128 → light → black overlay
    expect(getHighlightOverlayForBg('#aaaaaa')).toBe('rgba(0,0,0,0.3)');
  });

  it('weights green most heavily (YIQ luminance)', () => {
    // Pure red (#ff0000): YIQ = 0.299*255 ≈ 76 → dark → white
    expect(getHighlightOverlayForBg('#ff0000')).toBe('rgba(255,255,255,0.3)');
    // Pure green (#00ff00): YIQ = 0.587*255 ≈ 150 → light → black
    expect(getHighlightOverlayForBg('#00ff00')).toBe('rgba(0,0,0,0.3)');
    // Pure blue (#0000ff): YIQ = 0.114*255 ≈ 29 → dark → white
    expect(getHighlightOverlayForBg('#0000ff')).toBe('rgba(255,255,255,0.3)');
  });

  it('returns the dark-bg default when the input is malformed', () => {
    expect(getHighlightOverlayForBg('#fff')).toBe('rgba(255,255,255,0.3)');
    expect(getHighlightOverlayForBg('not-a-hex')).toBe('rgba(255,255,255,0.3)');
    expect(getHighlightOverlayForBg('')).toBe('rgba(255,255,255,0.3)');
  });
});

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

const { useSubtitleChrome } = await import('./useSubtitleChrome');

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

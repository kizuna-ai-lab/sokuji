import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

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

function Probe({ surface, onExit }: { surface: 'electron' | 'extension-overlay'; onExit: () => void }) {
  const chrome = useSubtitleChrome({ surface, onExit });
  return <div ref={chrome.rootRef} {...chrome.rootProps}>{chrome.resizeHandles}</div>;
}

beforeEach(() => {
  cleanup();
  fullscreen = false;
  locked = false;
  setFullscreen.mockClear();
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
});

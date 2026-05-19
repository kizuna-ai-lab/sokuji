import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useOverlayDragResize } from './useOverlayDragResize';
import { useSubtitleStore } from '../../stores/subtitleStore';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

/**
 * Renders a faux subtitle bar wired up to useOverlayDragResize, plus a
 * React-portaled child sibling of document.body — emulating how the
 * settings popover sits relative to the bar in the extension overlay
 * (FloatingPortal → document.body, React event still bubbles to the bar).
 */
const Harness: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { dragHandleProps } = useOverlayDragResize({ surface: 'extension-overlay' });
  return (
    <div data-testid="bar" {...dragHandleProps}>
      <span data-testid="bar-plain">plain area</span>
      <button data-testid="bar-button">button</button>
      {children}
      {createPortal(
        <div data-testid="portal-root">
          <div data-testid="portal-switch" role="switch" aria-checked="false">
            toggle
          </div>
          <div data-testid="portal-plain">plain in portal</div>
        </div>,
        document.body,
      )}
    </div>
  );
};

describe('useOverlayDragResize (move drag handler)', () => {
  let postMessage: ReturnType<typeof vi.fn>;
  let originalParent: typeof window.parent;

  beforeEach(() => {
    useSubtitleStore.setState({ positionLocked: false } as never);
    postMessage = vi.fn();
    originalParent = window.parent;
    // jsdom: window.parent === window; replace postMessage so we can spy.
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: originalParent,
    });
  });

  it('posts drag-start when mousedown fires on a non-interactive bar child', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseDown(getByTestId('bar-plain'), { clientX: 10, clientY: 5 });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: 'sokuji-subtitle:drag-start',
      kind: 'move',
    });
  });

  it('does NOT post drag-start when mousedown fires on a button inside the bar', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseDown(getByTestId('bar-button'));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT post drag-start when mousedown fires on a [role="switch"] in a React portal', () => {
    // Regression test for issue: in the extension overlay, clicking the
    // "Highlight newly-arrived text" toggle in the settings popover did
    // nothing. The popover is rendered with FloatingPortal (→ document.body),
    // but React bubbles synthetic events through the React parent tree, so the
    // toggle's mousedown reached the bar's onMouseDown handler. The handler
    // treated the click as a bar drag, posted drag-start to the parent, and
    // the parent's full-viewport drag overlay then swallowed the mouseup.
    // Result: the toggle's onClick never fired.
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseDown(getByTestId('portal-switch'));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT post drag-start for any portaled child, even non-interactive ones', () => {
    // Defensive: portaled content is outside the bar's DOM subtree, so the
    // bar must never claim ownership of mousedowns there.
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseDown(getByTestId('portal-plain'));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does NOT post drag-start when positionLocked is on', () => {
    useSubtitleStore.setState({ positionLocked: true } as never);
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseDown(getByTestId('bar-plain'));
    expect(postMessage).not.toHaveBeenCalled();
  });
});

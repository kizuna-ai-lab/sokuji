import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PanelResizer from './PanelResizer';

const base = { width: 450, min: 300, max: 900 };

describe('PanelResizer', () => {
  it('renders a vertical separator with aria values', () => {
    render(<PanelResizer {...base} onResize={() => {}} onCommit={() => {}} />);
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '450');
    expect(sep).toHaveAttribute('aria-valuemin', '300');
    expect(sep).toHaveAttribute('aria-valuemax', '900');
  });

  it('ArrowLeft widens by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(466);
    expect(onCommit).toHaveBeenCalledWith(466);
  });

  it('ArrowRight narrows by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(434);
    expect(onCommit).toHaveBeenCalledWith(434);
  });

  // Note: jsdom doesn't propagate clientX on synthetic pointer events, so this
  // asserts the drag wiring + listener lifecycle, not the pixel arithmetic
  // (the exact +/-16 math is covered by the keyboard tests above).
  it('drag wires move->resize and up->commit, toggling the body class', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { clientX: 1000 });
    expect(document.body.classList.contains('is-resizing-panel')).toBe(true);
    fireEvent.pointerMove(window, { clientX: 940 });
    expect(onResize).toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 920 });
    expect(onCommit).toHaveBeenCalled();
    expect(document.body.classList.contains('is-resizing-panel')).toBe(false);
  });

  it('does not keep resizing after unmount mid-drag', () => {
    const onResize = vi.fn();
    const { unmount } = render(<PanelResizer {...base} onResize={onResize} onCommit={() => {}} />);
    fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 1000 });
    unmount();
    expect(document.body.classList.contains('is-resizing-panel')).toBe(false);
    onResize.mockClear();
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onResize).not.toHaveBeenCalled();
  });
});

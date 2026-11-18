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

  it('is named after the panel it resizes when the caller says which, so two dividers can be told apart', () => {
    render(<PanelResizer {...base} label="Resize live notes" onResize={() => {}} onCommit={() => {}} />);
    expect(screen.getByRole('separator', { name: 'Resize live notes' })).toBeInTheDocument();
  });

  it('tells the caller when a drag is cancelled, without committing it', () => {
    const onResize = vi.fn(); const onCommit = vi.fn(); const onCancel = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} onCancel={onCancel} />);
    const sep = screen.getByRole('separator');
    sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 500, button: 0 }), { pointerType: 'mouse' }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 440 }));
    expect(onResize).toHaveBeenLastCalledWith(510);
    window.dispatchEvent(new Event('pointercancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ArrowLeft widens by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(466);
    expect(onCommit).toHaveBeenCalledWith(466, 450);
  });

  it('ArrowRight narrows by 16 (resize + commit)', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(434);
    expect(onCommit).toHaveBeenCalledWith(434, 450);
  });

  it('for a panel on the left (side="left"), ArrowRight widens and ArrowLeft narrows', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} side="left" onResize={onResize} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(466, 450);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(434, 450);
  });

  it('for a panel on the left, dragging right widens it', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PanelResizer {...base} side="left" onResize={onResize} onCommit={onCommit} />);
    const sep = screen.getByRole('separator');
    sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 500, button: 0 }), { pointerType: 'mouse' }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 560 }));
    expect(onResize).toHaveBeenLastCalledWith(510);
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 580 }));
    expect(onCommit).toHaveBeenLastCalledWith(530, 450);
  });

  // Review (PR #789): a commit says where its gesture started, so the caller can tell a click from a change.
  it('commits with the size the gesture started from, for a drag and for a key', () => {
    const onCommit = vi.fn();
    render(<PanelResizer {...base} onResize={() => {}} onCommit={onCommit} />);
    const sep = screen.getByRole('separator');
    sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 500, button: 0 }), { pointerType: 'mouse' }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 }));
    expect(onCommit).toHaveBeenLastCalledWith(450, 450);
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(466, 450);
  });

  // Owner, 2026-11-19: a seam between rows (the live notes above the conversation in a narrow window).
  describe('across rows (axis="y")', () => {
    it('is a horizontal separator, its value the height', () => {
      render(<PanelResizer {...base} axis="y" side="left" onResize={() => {}} onCommit={() => {}} />);
      const sep = screen.getByRole('separator');
      expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
      expect(sep).toHaveClass('panel-resizer--y');
      expect(sep).toHaveAttribute('aria-valuenow', '450');
    });

    it('for a panel above the seam, dragging down makes it taller, and the drag reads the pointer\'s height, not its x', () => {
      const onResize = vi.fn(); const onCommit = vi.fn();
      render(<PanelResizer {...base} axis="y" side="left" onResize={onResize} onCommit={onCommit} />);
      const sep = screen.getByRole('separator');
      sep.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 300, button: 0 }), { pointerType: 'mouse' }));
      expect(document.body.classList.contains('is-resizing-rows')).toBe(true);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: 340 }));
      expect(onResize).toHaveBeenLastCalledWith(490);
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 900, clientY: 280 }));
      expect(onCommit).toHaveBeenLastCalledWith(430, 450);
      expect(document.body.classList.contains('is-resizing-rows')).toBe(false);
    });

    it('for a panel above the seam, ArrowDown makes it taller and ArrowUp shorter', () => {
      const onCommit = vi.fn();
      render(<PanelResizer {...base} axis="y" side="left" onResize={() => {}} onCommit={onCommit} />);
      const sep = screen.getByRole('separator');
      fireEvent.keyDown(sep, { key: 'ArrowDown' });
      expect(onCommit).toHaveBeenLastCalledWith(466, 450);
      fireEvent.keyDown(sep, { key: 'ArrowUp' });
      expect(onCommit).toHaveBeenLastCalledWith(434, 450);
      fireEvent.keyDown(sep, { key: 'ArrowLeft' });
      expect(onCommit).toHaveBeenCalledTimes(2);
    });
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

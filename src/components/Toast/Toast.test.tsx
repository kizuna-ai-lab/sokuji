import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast, type ToastOptions } from './ToastContext';

function Trigger({ opts }: { opts?: ToastOptions }) {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast('Saved', opts)}>fire</button>;
}

const renderWith = (opts?: ToastOptions) =>
  render(<ToastProvider><Trigger opts={opts} /></ToastProvider>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toast action', () => {
  it('runs the action on click, then dismisses the toast', () => {
    const onClick = vi.fn();
    renderWith({ action: { label: 'Show in folder', onClick } });
    fireEvent.click(screen.getByText('fire'));

    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('still auto-dismisses after its duration', () => {
    vi.useFakeTimers();
    renderWith({ durationMs: 6000, action: { label: 'Show in folder', onClick: vi.fn() } });
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(6000); });

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('renders no button without an action', () => {
    renderWith();
    fireEvent.click(screen.getByText('fire'));

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument();
  });
});

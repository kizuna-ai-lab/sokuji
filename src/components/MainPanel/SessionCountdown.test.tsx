import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import SessionCountdown from './SessionCountdown';
import { formatRemainingTime } from '../../utils/formatters';
import type { BudgetSnapshot } from '../../services/providers/ProviderDescriptor';

/**
 * Extracted from MainPanel's footers so the countdown's poll, its <20%
 * low-budget emphasis, and its remaining-time formatting are pinned by a
 * real render — MainPanel has no React harness in this repo, so inline JSX
 * there is untestable by construction. The formatter itself is imported
 * from the real module rather than hand-computed, so a change to its output
 * cannot silently drift from what this component renders.
 */
describe('SessionCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('active=false renders nothing and never calls getSnapshot', () => {
    const getSnapshot = vi.fn();
    const { container } = render(<SessionCountdown active={false} getSnapshot={getSnapshot} />);
    expect(container).toBeEmptyDOMElement();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('active=true but getSnapshot returns null renders nothing (budget-gated)', () => {
    const getSnapshot = vi.fn(() => null);
    const { container } = render(<SessionCountdown active={true} getSnapshot={getSnapshot} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the real formatRemainingTime output and carries no low class above the threshold', () => {
    const snapshot: BudgetSnapshot = { remainingMs: 600_000, totalMs: 1_200_000 };
    const getSnapshot = vi.fn(() => snapshot);
    const { container } = render(<SessionCountdown active={true} getSnapshot={getSnapshot} />);
    const span = container.querySelector('.session-remaining-time');
    expect(span).not.toBeNull();
    // Compared against the real formatter's output, not a hand-computed string.
    expect(span?.textContent).toBe(formatRemainingTime(600_000));
    expect(span?.classList.contains('low')).toBe(false);
  });

  it('polls once a second, updating the rendered text; call count grows by exactly 1 per elapsed second', async () => {
    const first: BudgetSnapshot = { remainingMs: 600_000, totalMs: 1_200_000 };
    const second: BudgetSnapshot = { remainingMs: 599_000, totalMs: 1_200_000 };
    const getSnapshot = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const { container } = render(<SessionCountdown active={true} getSnapshot={getSnapshot} />);

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.session-remaining-time')?.textContent).toBe(
      formatRemainingTime(600_000)
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.session-remaining-time')?.textContent).toBe(
      formatRemainingTime(599_000)
    );
  });

  it('applies the low class under 20% remaining, and not at exactly 20% (strict <)', () => {
    const lowSnapshot: BudgetSnapshot = { remainingMs: 100_000, totalMs: 1_200_000 };
    const { container, unmount } = render(
      <SessionCountdown active={true} getSnapshot={() => lowSnapshot} />
    );
    const span = container.querySelector('.session-remaining-time');
    expect(span?.classList.contains('low')).toBe(true);
    unmount();

    // Boundary: exactly 20% remaining must NOT trip the strict-< threshold.
    const boundarySnapshot: BudgetSnapshot = { remainingMs: 240_000, totalMs: 1_200_000 };
    const { container: boundaryContainer } = render(
      <SessionCountdown active={true} getSnapshot={() => boundarySnapshot} />
    );
    const boundarySpan = boundaryContainer.querySelector('.session-remaining-time');
    expect(boundarySpan?.classList.contains('low')).toBe(false);
  });

  it('totalMs of 0 is never low, even with a negative remainingMs that would otherwise trip the threshold (guard pinned)', () => {
    // remainingMs is negative here specifically so the guard actually
    // discriminates: -5_000 / 0 = -Infinity, and -Infinity < 0.2 is true —
    // an unguarded expression WOULD flip to low. With the `totalMs > 0`
    // guard, it stays false. (A non-negative remainingMs, e.g. 5_000 / 0 =
    // Infinity, fails the `< 0.2` check on its own either way and can't tell
    // the guard's presence apart from its absence.)
    const snapshot: BudgetSnapshot = { remainingMs: -5_000, totalMs: 0 };
    const { container } = render(<SessionCountdown active={true} getSnapshot={() => snapshot} />);
    const span = container.querySelector('.session-remaining-time');
    expect(span?.classList.contains('low')).toBe(false);
  });

  it('clears the interval on unmount; getSnapshot call count stops growing', async () => {
    const getSnapshot = vi.fn(() => ({ remainingMs: 600_000, totalMs: 1_200_000 }));
    const { unmount } = render(<SessionCountdown active={true} getSnapshot={getSnapshot} />);
    const callsAtUnmount = getSnapshot.mock.calls.length;

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getSnapshot).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it('flipping active true -> false renders nothing again and stops polling', async () => {
    const getSnapshot = vi.fn(() => ({ remainingMs: 600_000, totalMs: 1_200_000 }));
    const { container, rerender } = render(
      <SessionCountdown active={true} getSnapshot={getSnapshot} />
    );
    expect(container.querySelector('.session-remaining-time')).not.toBeNull();
    const callsWhileActive = getSnapshot.mock.calls.length;

    rerender(<SessionCountdown active={false} getSnapshot={getSnapshot} />);
    expect(container).toBeEmptyDOMElement();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getSnapshot).toHaveBeenCalledTimes(callsWhileActive);
  });
});

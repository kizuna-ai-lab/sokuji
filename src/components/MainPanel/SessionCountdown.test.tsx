import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import SessionCountdown from './SessionCountdown';
import { formatRemainingTime } from '../../utils/formatters';
import type { Budget } from '../../lib/session/types';

/**
 * A leased session's countdown (Stage 2 Kizuna Soniox, choice 18): what is
 * left of the grant, ticking once a second, low under a fifth of it. The
 * formatter itself is imported from the real module rather than
 * hand-computed, so a change to its output cannot silently drift from what
 * this component renders.
 */
describe('SessionCountdown', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows what is left of the grant, formatted as the session clock is', () => {
    const budget: Budget = { totalMs: 1_200_000, endsAt: 600_000 };
    const { container } = render(<SessionCountdown budget={budget} now={clock} />);
    const span = container.querySelector('.session-remaining-time');
    expect(span?.textContent).toBe(formatRemainingTime(600_000));
    expect(span?.classList.contains('low')).toBe(false);
  });

  it('ticks once a second', () => {
    const budget: Budget = { totalMs: 1_200_000, endsAt: 600_000 };
    const { container } = render(<SessionCountdown budget={budget} now={clock} />);
    now = 1000;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector('.session-remaining-time')?.textContent).toBe(formatRemainingTime(599_000));
  });

  it('is low under 20% of the grant, and not at 20% (strict <)', () => {
    const lowBudget: Budget = { totalMs: 1_200_000, endsAt: 100_000 };
    const { container, unmount } = render(<SessionCountdown budget={lowBudget} now={clock} />);
    expect(container.querySelector('.session-remaining-time')?.classList.contains('low')).toBe(true);
    unmount();

    const boundaryBudget: Budget = { totalMs: 1_200_000, endsAt: 240_000 };
    const { container: boundaryContainer } = render(<SessionCountdown budget={boundaryBudget} now={clock} />);
    expect(boundaryContainer.querySelector('.session-remaining-time')?.classList.contains('low')).toBe(false);
  });

  it('never counts below zero', () => {
    now = 700_000;
    const budget: Budget = { totalMs: 1_200_000, endsAt: 600_000 };
    const { container } = render(<SessionCountdown budget={budget} now={clock} />);
    expect(container.querySelector('.session-remaining-time')?.textContent).toBe(formatRemainingTime(0));
  });

  it('a grant of zero is never low', () => {
    const budget: Budget = { totalMs: 0, endsAt: 0 };
    const { container } = render(<SessionCountdown budget={budget} now={clock} />);
    expect(container.querySelector('.session-remaining-time')?.classList.contains('low')).toBe(false);
  });

  it('stops ticking on unmount', async () => {
    const nowSpy = vi.fn(() => now);
    const budget: Budget = { totalMs: 1_200_000, endsAt: 600_000 };
    const { unmount } = render(<SessionCountdown budget={budget} now={nowSpy} />);
    const callsAtUnmount = nowSpy.mock.calls.length;

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(nowSpy.mock.calls.length).toBe(callsAtUnmount);
  });
});

import React, { useEffect, useState } from 'react';
import type { Budget } from '../../lib/session/types';
import { formatRemainingTime } from '../../utils/formatters';
import './SessionCountdown.scss';

interface SessionCountdownProps {
  /** The lease's granted time (`RunState.running.budget`). */
  budget: Budget;
  /** The wall clock; `Date.now` — the app's run clock is the real one, so `endsAt` reads on it (choice 18). Tests inject one. */
  now?: () => number;
}

/**
 * A leased session's countdown, in the footers beside the session clock
 * (Stage 2 Kizuna Soniox): what is left of the grant, ticking once a
 * second, with the warning emphasis under 20 % of it. Mounted only while
 * a leased run runs, so it needs no `active` guard of its own.
 */
const SessionCountdown: React.FC<SessionCountdownProps> = ({ budget, now = Date.now }) => {
  const [, retick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const remainingMs = Math.max(0, budget.endsAt - now());
  const low = budget.totalMs > 0 && remainingMs / budget.totalMs < 0.2;
  return (
    <span className={`session-remaining-time${low ? ' low' : ''}`}>
      {formatRemainingTime(remainingMs)}
    </span>
  );
};

export default SessionCountdown;

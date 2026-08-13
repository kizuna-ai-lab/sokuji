import React, { useEffect, useState } from 'react';
import type { BudgetSnapshot } from '../../services/providers/ProviderDescriptor';
import { formatRemainingTime } from '../../utils/formatters';
import './SessionCountdown.scss';

interface SessionCountdownProps {
  /** Poll while true (the session is active); renders nothing while false. */
  active: boolean;
  /** One snapshot of the session's metered budget, or null when the session
   *  has none (BYOK, non-metered providers) or it is not yet known. Called
   *  once a second while active — hand in a stable callback. */
  getSnapshot: () => BudgetSnapshot | null;
}

/**
 * The metered-session countdown, extracted from MainPanel's footers so it is
 * testable — MainPanel has no React harness in this repo, so inline JSX there
 * is untestable by construction. Owns the 1s poll, the <20% low-budget
 * emphasis, and the remaining-time formatting. Renders nothing when the
 * session has no budget: a data condition, not a provider condition.
 */
const SessionCountdown: React.FC<SessionCountdownProps> = ({ active, getSnapshot }) => {
  const [countdown, setCountdown] = useState<BudgetSnapshot | null>(null);
  useEffect(() => {
    if (!active) {
      setCountdown(null);
      return;
    }
    const update = () => setCountdown(getSnapshot());
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [active, getSnapshot]);
  if (!countdown) return null;
  // Below 20% of the granted budget, switch to the warning emphasis.
  const low = countdown.totalMs > 0 && countdown.remainingMs / countdown.totalMs < 0.2;
  return (
    <span className={`session-remaining-time${low ? ' low' : ''}`}>
      {formatRemainingTime(countdown.remainingMs)}
    </span>
  );
};

export default SessionCountdown;

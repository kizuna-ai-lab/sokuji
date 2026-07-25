// src/components/Subtitle/subtitleIdleState.ts
//
// Chooses what the subtitle window shows while no session is running. The
// rules are a small precedence chain, kept out of the component so they can
// be tested without rendering.
import type { StartBlockReason, DeviceScope } from '../MainPanel/sessionStartGate';
import type { ConversationItem } from '../../services/interfaces/IClient';

export type SubtitleIdleState =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting'; completed?: number; total?: number }
  | { kind: 'blocked'; reason: StartBlockReason; balance?: number; deviceScope?: DeviceScope }
  | { kind: 'failed'; message: string };

export interface IdleStateInput {
  isInitializing: boolean;
  initProgress: { completed: number; total: number } | null;
  startGate: {
    canStart: boolean;
    reason: StartBlockReason | null;
    balance?: number;
    deviceScope?: DeviceScope;
  };
  items: ConversationItem[];
  /** True once a session has been active during this visit to subtitle mode. */
  hasRunSession: boolean;
  /**
   * Timestamp of the last start requested from the subtitle window, or null.
   * Used to tell "this session failed to start" apart from "an old session
   * happened to end on an error item" — MainPanel appends init failures to
   * items (MainPanel.tsx:1849), which is also where mid-session errors land.
   */
  startRequestedAt: number | null;
}

export function deriveSubtitleIdleState(input: IdleStateInput): SubtitleIdleState {
  const { isInitializing, initProgress, startGate, items, hasRunSession, startRequestedAt } = input;

  if (isInitializing) {
    return initProgress
      ? { kind: 'starting', completed: initProgress.completed, total: initProgress.total }
      : { kind: 'starting' };
  }

  // A live blocker wins over a stale failure. Retry can't succeed while the
  // gate is closed (e.g. the mic was unplugged, or the balance hit zero,
  // after a start attempt already failed for a different reason), so
  // reporting the current blocker is more actionable than replaying the old
  // failure message for a Retry that would just be refused again.
  if (!startGate.canStart && startGate.reason) {
    return {
      kind: 'blocked',
      reason: startGate.reason,
      balance: startGate.balance,
      deviceScope: startGate.deviceScope,
    };
  }

  const last = items[items.length - 1];
  const isFreshStartFailure =
    startRequestedAt !== null &&
    last?.type === 'error' &&
    (last.createdAt ?? 0) >= startRequestedAt;
  if (isFreshStartFailure) {
    return { kind: 'failed', message: last.formatted?.text ?? '' };
  }

  return hasRunSession ? { kind: 'ended' } : { kind: 'ready' };
}

import { describe, it, expect } from 'vitest';
import { deriveSubtitleIdleState, type IdleStateInput } from './subtitleIdleState';
import type { ConversationItem } from '../../services/interfaces/IClient';

const item = (over: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'i1',
  role: 'assistant',
  type: 'message',
  status: 'completed',
  createdAt: 1000,
  formatted: { text: 'hello' },
  ...over,
} as ConversationItem);

const errorItem = (createdAt: number, text = 'Network connection error') =>
  item({ id: `e-${createdAt}`, role: 'system', type: 'error', createdAt, formatted: { text } });

const base: IdleStateInput = {
  isInitializing: false,
  initProgress: null,
  startGate: { canStart: true, reason: null },
  items: [],
  hasRunSession: false,
  startRequestedAt: null,
};

describe('deriveSubtitleIdleState', () => {
  it('is ready with a clean gate and no history', () => {
    expect(deriveSubtitleIdleState(base)).toEqual({ kind: 'ready' });
  });

  it('is ended after a session has run in this visit', () => {
    expect(deriveSubtitleIdleState({ ...base, hasRunSession: true })).toEqual({ kind: 'ended' });
  });

  it('is starting while initializing, carrying progress when known', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, isInitializing: true, initProgress: { completed: 3, total: 5 },
      }),
    ).toEqual({ kind: 'starting', completed: 3, total: 5 });
  });

  it('is starting without progress numbers when none are reported', () => {
    expect(deriveSubtitleIdleState({ ...base, isInitializing: true })).toEqual({ kind: 'starting' });
  });

  it('is blocked with the reason from the gate', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startGate: { canStart: false, reason: 'missing-device', deviceScope: 'speaker' },
      }),
    ).toEqual({ kind: 'blocked', reason: 'missing-device', deviceScope: 'speaker' });
  });

  it('carries the balance on an insufficient-balance block', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startGate: { canStart: false, reason: 'insufficient-balance', balance: 0 },
      }),
    ).toEqual({ kind: 'blocked', reason: 'insufficient-balance', balance: 0 });
  });

  it('is failed when an error item arrived after the user asked to start', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startRequestedAt: 500,
        items: [item(), errorItem(900, '401 Incorrect API key provided')],
      }),
    ).toEqual({ kind: 'failed', message: '401 Incorrect API key provided' });
  });

  // Mid-session error items from an earlier, successful session must not be
  // mistaken for a start failure.
  it('ignores an error item that predates the start request', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        hasRunSession: true,
        startRequestedAt: 2000,
        items: [errorItem(900)],
      }),
    ).toEqual({ kind: 'ended' });
  });

  it('ignores an error item when no start was requested from this window', () => {
    expect(
      deriveSubtitleIdleState({ ...base, hasRunSession: true, items: [errorItem(900)] }),
    ).toEqual({ kind: 'ended' });
  });

  it('only considers the trailing item, not an error buried in history', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, startRequestedAt: 500, items: [errorItem(600), item({ createdAt: 700 })],
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('falls back to a generic message when the error item carries no text', () => {
    const bare = { ...errorItem(900), formatted: {} } as ConversationItem;
    expect(
      deriveSubtitleIdleState({ ...base, startRequestedAt: 500, items: [bare] }),
    ).toEqual({ kind: 'failed', message: '' });
  });

  it('prefers starting over a stale failure', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, isInitializing: true, startRequestedAt: 500, items: [errorItem(900)],
      }),
    ).toEqual({ kind: 'starting' });
  });

  // A live blocker beats a stale failure: Retry can't succeed against a
  // closed gate, so the current blocker is what the user needs to act on.
  it('prefers a blocked gate over a stale failure', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startRequestedAt: 500,
        items: [errorItem(900, 'boom')],
        startGate: { canStart: false, reason: 'api-key-invalid' },
      }),
    ).toEqual({ kind: 'blocked', reason: 'api-key-invalid' });
  });

  it('prefers a blocked gate over the ended headline', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, hasRunSession: true, startGate: { canStart: false, reason: 'no-models' },
      }),
    ).toEqual({ kind: 'blocked', reason: 'no-models' });
  });
});

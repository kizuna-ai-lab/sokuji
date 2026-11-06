// src/components/MainPanel/StatusLine.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { StatusLine } from './StatusLine';
import type { StatusEntry } from '../../lib/view/statusLine';

// t returns the key, so every assertion is against the key the component asks for.
// The reconnect's counters are appended, so a test can see them change.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: unknown) => {
      const p = o as { attempt?: number; seconds?: number } | undefined;
      return p && typeof p === 'object' && p.attempt !== undefined ? `${key} ${p.attempt} ${p.seconds}` : key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);

const entry = (over: Partial<StatusEntry> = {}): StatusEntry => ({
  key: 'unready:no_microphone', icon: 'mic-off',
  words: { kind: 'notice', code: 'no_microphone', message: 'No microphone is chosen for the speaker leg.' },
  action: { kind: 'settings', target: 'microphone' }, dismiss: null, ...over,
});

describe('StatusLine', () => {
  it('draws the words by their notice code, with the action’s label', () => {
    const onAction = vi.fn();
    const { container } = render(<StatusLine entry={entry()} onAction={onAction} onDismiss={vi.fn()} />);
    expect(container.querySelector('.status-line')).not.toBeNull();
    // A live region: a line that appears mid-run (reconnecting, the microphone wait) is announced.
    expect(container.querySelector('.status-line')?.getAttribute('role')).toBe('status');
    expect(container.querySelector('.status-line__text')?.textContent).toBe('notices.no_microphone');
    const button = container.querySelector('.status-line__action') as HTMLButtonElement;
    expect(button.textContent).toBe('settings.title');
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith({ kind: 'settings', target: 'microphone' });
    expect(container.querySelector('.status-line__dismiss')).toBeNull();
  });

  it('draws a key, and an echo cause as its message and advice', () => {
    const a = render(<StatusLine entry={entry({ words: { kind: 'key', key: 'connectionStatus.reconnecting', fallback: 'Reconnecting...' }, action: null })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(a.container.querySelector('.status-line__text')?.textContent).toBe('connectionStatus.reconnecting');
    const b = render(<StatusLine entry={entry({ words: { kind: 'echo', cause: 'tts-echo' }, action: null, dismiss: 'echo' })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(b.container.querySelector('.status-line__text')?.textContent).toBe('echoNotice.ttsEcho echoNotice.actionHeadphones');
  });

  it('a reconnect keeps its live region steady while its visible words count attempts and seconds', () => {
    /** What the live region holds for a screen reader: its text without the parts hidden from it. */
    const liveText = (container: HTMLElement) => {
      const regions = container.querySelectorAll('[role="status"]');
      expect(regions).toHaveLength(1);
      const region = regions[0].cloneNode(true) as HTMLElement;
      for (const hidden of region.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return region.textContent;
    };
    /** The counters are outside the live region, so they are not announced, but a screen reader can still read them. */
    const countersReadable = (container: HTMLElement) => {
      const text = container.querySelector('.status-line__text')!;
      expect(text.closest('[aria-hidden="true"]')).toBeNull();
      expect(text.closest('[role="status"]')).toBeNull();
    };
    const reconnecting = (attempt: number, seconds: number) => entry({
      key: 'reconnecting', icon: 'refresh-cw', action: null,
      words: { kind: 'key', key: 'connectionStatus.reconnectingAttempt', fallback: 'Reconnecting… (attempt {{attempt}}, {{seconds}} s)', params: { attempt, seconds } },
      announce: { kind: 'key', key: 'connectionStatus.reconnecting', fallback: 'Reconnecting...' },
    });
    const { container, rerender } = render(<StatusLine entry={reconnecting(1, 0)} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.querySelector('.status-line__text')?.textContent).toBe('connectionStatus.reconnectingAttempt 1 0');
    expect(liveText(container)).toBe('connectionStatus.reconnecting');
    countersReadable(container);
    rerender(<StatusLine entry={reconnecting(2, 1)} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.querySelector('.status-line__text')?.textContent).toBe('connectionStatus.reconnectingAttempt 2 1');
    expect(liveText(container)).toBe('connectionStatus.reconnecting');
    countersReadable(container);
  });

  it('a line without its own announcement is announced as it reads', () => {
    const { container } = render(<StatusLine entry={entry()} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.querySelector('.status-line__text')?.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('.status-line__announce')).toBeNull();
  });

  it('offers a dismiss, labelled by common.dismiss, that reports what it dismisses', () => {
    const onDismiss = vi.fn();
    const { container } = render(<StatusLine entry={entry({ words: { kind: 'echo', cause: 'tts-echo' }, action: null, dismiss: 'echo' })} onAction={vi.fn()} onDismiss={onDismiss} />);
    const button = container.querySelector('.status-line__dismiss') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('common.dismiss');
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledWith('echo');
  });

  it('never has an action and a dismiss at once', () => {
    const { container } = render(<StatusLine entry={entry({ dismiss: 'echo' })} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.querySelectorAll('.status-line__action, .status-line__dismiss')).toHaveLength(1);
  });
});

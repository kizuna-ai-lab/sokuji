import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import LogsPanel from './LogsPanel';
import useLogStore from '../../stores/logStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// jsdom has no ResizeObserver; LogsPanel observes its scroll container to size
// the virtual window.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/** Write directly and flush, so assertions do not race the 150ms batch. */
const write = (fn: () => void) => {
  act(() => {
    fn();
    useLogStore.getState().flushPendingLogs();
  });
};

describe('LogsPanel', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useLogStore.getState().clearLogs();
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    useLogStore.getState().clearLogs();
    vi.restoreAllMocks();
  });

  const copy = (container: HTMLElement) => {
    const button = container.querySelector('.copy-logs-button')
      ?? Array.from(container.querySelectorAll('button'))
        .find(b => /copy/i.test(b.textContent ?? ''));
    if (!button) throw new Error('copy button not found');
    fireEvent.click(button);
    return (writeText.mock.calls[0]?.[0] as string | undefined) ?? '';
  };

  describe('clipboard export', () => {
    // The defect this test exists for: handleCopyLogs iterated `log.events`
    // only, so every plain entry — i.e. everything report() writes — was
    // silently dropped from the text a user pastes into a bug report. It
    // survived because LogsPanel had no test at all.
    it('exports plain entries, not just realtime events', () => {
      write(() => {
        useLogStore.getState().addLog('settings failed to load', 'error');
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);

      const lines = copy(container).split('\n').filter(Boolean).map(l => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 'error', message: 'settings failed to load' });
    });

    it('keeps plain entries and events in the order they happened', () => {
      write(() => {
        useLogStore.getState().addLog('first', 'error', 'speaker');
        useLogStore.getState().addRealtimeEvent(
          { type: 'session.created', data: {} } as never, 'server', 'session.created', 'speaker'
        );
        useLogStore.getState().addLog('third', 'warning', 'speaker');
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);

      const parsed = copy(container).split('\n').filter(Boolean).map(l => JSON.parse(l));
      expect(parsed.map(p => p.message ?? p.type))
        .toEqual(['first', 'session.created', 'third']);
    });

    it('exports global entries under either tab', () => {
      write(() => {
        useLogStore.getState().addLog('app-scope failure', 'error');
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      expect(copy(container)).toContain('app-scope failure');
    });
  });

  describe('severity rendering', () => {
    it('marks a failure event row so the error style applies', () => {
      write(() => {
        useLogStore.getState().addRealtimeEvent(
          { type: 'session.error', data: { message: 'nope' } } as never,
          'client', 'session.error', 'speaker'
        );
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      expect(container.querySelector('.event-entry.error')).not.toBeNull();
    });

    it('leaves ordinary event rows unstyled', () => {
      write(() => {
        useLogStore.getState().addRealtimeEvent(
          { type: 'response.created', data: {} } as never,
          'server', 'response.created', 'speaker'
        );
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      expect(container.querySelector('.event-entry.error')).toBeNull();
      expect(container.querySelector('.event-entry.warning')).toBeNull();
    });
  });

  describe('row identity', () => {
    // Rows used to be keyed by absolute array index. With MAX_LOG_ENTRIES
    // trimming from the front, every index shifts, so an expanded <Event>'s
    // open/JSON state would migrate onto a different entry.
    it('keys rows by entry id, not by position', () => {
      write(() => {
        useLogStore.getState().addLog('kept', 'error', 'speaker');
      });
      const id = useLogStore.getState().allLogs[0].id;

      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      const before = container.querySelector('.log-entry');
      expect(before?.textContent).toContain('kept');

      // Prepending shifts every index by one; the entry must still be the same row.
      act(() => {
        useLogStore.setState(state => {
          const shifted = [
            { id: -1, timestamp: '00:00:00', message: 'older', type: 'error' as const },
            ...state.logs,
          ];
          return { logs: shifted, allLogs: shifted };
        });
      });

      expect(useLogStore.getState().allLogs.find(l => l.id === id)?.message).toBe('kept');
      expect(container.textContent).toContain('kept');
      expect(container.textContent).toContain('older');
    });
  });
});

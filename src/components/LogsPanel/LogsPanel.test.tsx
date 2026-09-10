import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import LogsPanel from './LogsPanel';
import useLogStore, { MAX_EVENTS_PER_GROUP } from '../../stores/logStore';

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

// These tests assert what reaches the log store, which records nothing unless
// diagnostic logs are switched on (they are off by default in the app).
beforeEach(() => {
  useLogStore.getState().setEnabled(true);
});

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

  describe('grouped rows', () => {
    // A silent session's mic appends all land in one row. The store keeps only
    // the newest MAX_EVENTS_PER_GROUP of them (#531), so the row's count has to
    // come from groupCount, not from how many events it still holds.
    it('shows the true event count once a group passes the cap', () => {
      const total = MAX_EVENTS_PER_GROUP + 5;
      write(() => {
        for (let i = 0; i < total; i++) {
          useLogStore.getState().addRealtimeEvent(
            { type: 'input_audio_buffer.append', audio: `chunk-${i}` } as never,
            'client', 'input_audio_buffer.append', 'speaker'
          );
        }
      });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      expect(container.querySelector('.event-count')?.textContent).toBe(`(${total})`);
    });

    // An expanded row caches its events as JSON. Once the group is capped,
    // every new event drops the oldest one, so the cache has to follow the
    // events; otherwise the numbering (from groupCount) and the content (from
    // the cache) drift apart.
    it('keeps an expanded capped group in step with its events', async () => {
      const total = MAX_EVENTS_PER_GROUP + 5;
      const append = (i: number) =>
        useLogStore.getState().addRealtimeEvent(
          { type: 'input_audio_buffer.append', audio: `chunk-${i}` } as never,
          'client', 'input_audio_buffer.append', 'speaker'
        );
      // The row builds its JSON on a zero-delay timer.
      const settle = () => act(async () => { await new Promise(r => setTimeout(r, 10)); });

      write(() => { for (let i = 0; i < total; i++) append(i); });
      const { container } = render(<LogsPanel toggleLogs={() => {}} />);
      fireEvent.click(container.querySelector('.event-header')!);
      await settle();
      expect(container.querySelectorAll('.grouped-event pre')).toHaveLength(MAX_EVENTS_PER_GROUP);

      write(() => append(total));
      await settle();

      const rows = container.querySelectorAll('.grouped-event');
      const last = rows[rows.length - 1];
      expect(last.querySelector('.grouped-event-index')?.textContent).toContain(`${total + 1}`);
      expect(last.querySelector('pre')?.textContent).toContain(`chunk-${total}`);
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

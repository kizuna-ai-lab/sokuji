import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reportError,
  reportWarning,
  describeCause,
  settleReports,
  resetReportThrottle,
} from './report';
import useLogStore from '../../stores/logStore';

describe('report', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useLogStore.getState().clearLogs();
    resetReportThrottle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const panelMessages = () => useLogStore.getState().allLogs.map((l) => l.message);

  describe('console leg', () => {
    it('writes the console line synchronously, prefixed for grep', () => {
      reportError('SettingsStore', 'Failed to load settings');
      expect(errorSpy).toHaveBeenCalledWith('[Sokuji] [SettingsStore] Failed to load settings');
    });

    it('passes the raw cause to console so the stack survives in devtools', () => {
      const cause = new Error('boom');
      reportError('X', 'it broke', { cause });
      expect(errorSpy).toHaveBeenCalledWith('[Sokuji] [X] it broke', cause);
    });

    it('reportWarning uses console.warn', () => {
      reportWarning('X', 'degraded');
      expect(warnSpy).toHaveBeenCalledWith('[Sokuji] [X] degraded');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('render safety', () => {
    // The invariant that lets report() be called from a Zustand getter reached
    // synchronously from JSX (settingsStore.ts:1236 via
    // ProviderSpecificSettings.tsx:2377). A synchronous store write there is a
    // setState-during-render. Deferral is unconditional, so no call site has to
    // know whether it is on a render path.
    it('does not touch logStore before returning', () => {
      reportError('X', 'deferred');
      expect(useLogStore.getState().allLogs).toHaveLength(0);
    });

    it('writes the panel entry after a microtask', async () => {
      reportError('X', 'deferred');
      await settleReports();
      expect(panelMessages()).toEqual(['[X] deferred']);
    });
  });

  describe('panel leg', () => {
    it('records severity so the Problems filter can select it', async () => {
      reportError('A', 'bad');
      reportWarning('B', 'meh');
      await settleReports();
      expect(useLogStore.getState().allLogs.map((l) => l.type)).toEqual(['error', 'warning']);
    });

    it('files under no channel by default, so both tabs show it', async () => {
      reportError('SettingsStore', 'not a session failure');
      await settleReports();
      expect(useLogStore.getState().allLogs[0].clientId).toBeUndefined();
    });

    it('files under the given channel when the failure belongs to one', async () => {
      reportError('Client:soniox', 'parse_error: bad frame', { clientId: 'participant' });
      await settleReports();
      expect(useLogStore.getState().allLogs[0].clientId).toBe('participant');
    });

    it('redacts credentials on the way in', async () => {
      reportError('Auth', 'rejected token Bearer sess_abcdef123456');
      await settleReports();
      expect(panelMessages()).toEqual(['[Auth] rejected token Bearer [REDACTED]']);
    });

    it('never forwards the cause object to the panel', async () => {
      reportError('X', 'shape mismatch', { cause: { client_secret: 'ek_supersecret1234' } });
      await settleReports();
      expect(panelMessages()).toEqual(['[X] shape mismatch']);
    });
  });

  describe('throttle', () => {
    it('collapses repeats of the same scope+message inside the window', async () => {
      for (let i = 0; i < 5; i++) reportError('AudioStore', 'Failed to persist mode');
      await settleReports();
      expect(panelMessages()).toHaveLength(1);
    });

    it('still writes every repeat to the console', () => {
      for (let i = 0; i < 5; i++) reportError('AudioStore', 'Failed to persist mode');
      expect(errorSpy).toHaveBeenCalledTimes(5);
    });

    // Split sessions run both legs against the same provider, so scope and code
    // are identical; only the channel distinguishes them, and they render on
    // different LogsPanel tabs.
    it('keeps the two session legs apart', async () => {
      reportWarning('Client:soniox', 'tts_degraded: no audio', {
        clientId: 'speaker', dedupeKey: 'tts_degraded',
      });
      reportWarning('Client:soniox', 'tts_degraded: no audio', {
        clientId: 'participant', dedupeKey: 'tts_degraded',
      });
      await settleReports();
      expect(useLogStore.getState().allLogs.map((l) => l.clientId))
        .toEqual(['speaker', 'participant']);
    });

    it('still collapses repeats within one leg', async () => {
      for (let i = 0; i < 3; i++) {
        reportWarning('Client:soniox', 'tts_degraded: no audio', {
          clientId: 'speaker', dedupeKey: 'tts_degraded',
        });
      }
      await settleReports();
      expect(panelMessages()).toHaveLength(1);
    });

    it('keeps distinct messages apart', async () => {
      reportError('AudioStore', 'Failed to persist mode');
      reportError('AudioStore', 'Failed to persist volume');
      await settleReports();
      expect(panelMessages()).toHaveLength(2);
    });

    it('collapses a varying message under an explicit dedupeKey', async () => {
      for (let i = 0; i < 4; i++) {
        reportError('Settings', `Failed to read key ${i}`, { dedupeKey: 'settings.get' });
      }
      await settleReports();
      expect(panelMessages()).toEqual(['[Settings] Failed to read key 0']);
    });

    it('lets the same key through again after the window closes', async () => {
      vi.useFakeTimers();
      reportError('X', 'flaky');
      vi.advanceTimersByTime(5001);
      reportError('X', 'flaky');
      vi.useRealTimers();
      await settleReports();
      expect(panelMessages()).toHaveLength(2);
    });

    it('does not grow without bound', async () => {
      for (let i = 0; i < 500; i++) reportError('X', `distinct ${i}`);
      await settleReports();
      // Every distinct key passes; the LRU bounds retained keys, not output.
      expect(panelMessages()).toHaveLength(500);
    });
  });

  describe('describeCause', () => {
    it('unwraps an Error', () => {
      expect(describeCause(new Error('disk full'))).toBe('disk full');
    });

    it('passes a string through', () => {
      expect(describeCause('plain failure')).toBe('plain failure');
    });

    // apiErrorProps.ts:36-38 — the shape every ClientEventHandlers.onError payload has.
    it('reads the client error shape', () => {
      expect(describeCause({ message: 'socket closed' })).toBe('socket closed');
      expect(describeCause({ error: 'auth_failed' })).toBe('auth_failed');
    });

    // PalabraAIClient.ts:194-201 reads errorData.errors[0].detail || .title
    it('reads the Palabra error envelope', () => {
      expect(describeCause({ errors: [{ title: 'Forbidden', detail: 'quota exceeded' }] }))
        .toBe('quota exceeded');
      expect(describeCause({ errors: [{ title: 'Forbidden' }] })).toBe('Forbidden');
    });

    // EphemeralTokenService.ts:183 reads errorData.error?.message
    it('reads the OpenAI error envelope', () => {
      expect(describeCause({ error: { message: 'invalid_api_key' } })).toBe('invalid_api_key');
    });

    it('names a DOMException', () => {
      expect(describeCause(new DOMException('permission denied', 'NotAllowedError')))
        .toBe('NotAllowedError: permission denied');
    });

    it('falls back rather than serialising an unknown object', () => {
      expect(describeCause({ a: 1, b: 2 })).toBe('unknown error');
      expect(describeCause(null)).toBe('unknown error');
      expect(describeCause(undefined)).toBe('unknown error');
    });

    it('redacts what it returns, since the result becomes a panel message', () => {
      expect(describeCause(new Error('bad key sk-abcdef1234567'))).toBe('bad key [REDACTED]');
    });
  });

  describe('message typing', () => {
    it('rejects a parsed response body at compile time', () => {
      const data = JSON.parse('{}');
      // `data` is `any` — the EphemeralTokenService.ts:200 shape. Message<T>
      // resolves to `never` for `any`, so this is the compile error that
      // replaces a review comment.
      // @ts-expect-error Message<T> rejects `any`
      reportError('X', data);
      // @ts-expect-error Message<T> rejects objects
      reportError('X', { client_secret: 'ek_x' });
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });
  });
});

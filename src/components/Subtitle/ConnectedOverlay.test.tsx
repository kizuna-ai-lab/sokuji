import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleSession } from '../../lib/subtitle/session';
import { receiveSubtitles, type WirePort } from '../../lib/subtitle/wire';
import { ConnectedOverlay } from './ConnectedOverlay';
import type { SubtitleControls } from './SubtitleView';

const { showLanguageUncached } = vi.hoisted(() => ({ showLanguageUncached: vi.fn(async (lng: string) => lng) }));
vi.mock('../../locales', () => ({ showLanguageUncached }));

const { reportWarning } = vi.hoisted(() => ({ reportWarning: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportWarning,
}));

const i18nStub = vi.hoisted(() => ({ language: 'en' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k, i18n: i18nStub }),
}));

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./SubtitleView', () => ({
  SubtitleView: (props: Record<string, unknown>) => { captured.push(props); return null; },
}));

/** A test port for the overlay's end: records what it posts, and lets the test deliver `ToOverlay` messages. */
function overlayPort() {
  const listeners = new Set<(m: unknown) => void>();
  const posted: unknown[] = [];
  const port: WirePort = {
    post: (m) => { posted.push(m); },
    onMessage: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    onDisconnect: () => () => {},
    close: () => {},
  };
  return { port, posted, deliver: (m: unknown) => act(() => { listeners.forEach((l) => l(m)); }) };
}

const runningSession: SubtitleSession = {
  phase: 'running',
  since: 5,
  legs: ['speaker'],
  pair: { source: 'en', target: 'ja' },
  holdToTalk: true,
  canStart: false,
  idle: { kind: 'ended' },
};

const noticeEntry: Entry = { kind: 'notice', id: 'n1', leg: 'speaker', severity: 'warning', message: 'm', at: 0 };

beforeEach(() => {
  captured.length = 0;
  i18nStub.language = 'en';
  showLanguageUncached.mockClear();
  showLanguageUncached.mockImplementation(async (lng: string) => lng);
  reportWarning.mockClear();
});

describe('ConnectedOverlay', () => {
  it('draws SubtitleView as the extension overlay, from what arrived', () => {
    const { port, deliver } = overlayPort();
    const receiver = receiveSubtitles(port);
    render(<ConnectedOverlay receiver={receiver} />);
    deliver({ type: 'subtitle:session', session: runningSession });
    deliver({ type: 'subtitle:entries', entries: [noticeEntry] });
    const last = captured[captured.length - 1];
    expect(last.surface).toBe('extension-overlay');
    expect((last.model as { session: unknown }).session).toEqual(runningSession);
    expect((last.model as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('sends the four controls back and offers no start, stop or Settings', () => {
    const { port, posted } = overlayPort();
    const receiver = receiveSubtitles(port);
    render(<ConnectedOverlay receiver={receiver} />);
    const last = captured[captured.length - 1];
    const controls = last.controls as SubtitleControls;
    controls.exit();
    controls.clear();
    controls.press();
    controls.release();
    expect(posted).toEqual([
      { type: 'subtitle:user-exit' },
      { type: 'subtitle:request-clear' },
      { type: 'subtitle:turn-press' },
      { type: 'subtitle:turn-release' },
    ]);
    expect(controls.start).toBeUndefined();
    expect(controls.stop).toBeUndefined();
    expect(controls.openSettings).toBeUndefined();
  });

  it("switches this document to the side panel's language once it arrives, and only when it differs (controller ruling M4)", () => {
    const { port, deliver } = overlayPort();
    const receiver = receiveSubtitles(port);
    const { unmount } = render(<ConnectedOverlay receiver={receiver} />);
    // The model's language is null until the side panel sends one.
    expect(showLanguageUncached).not.toHaveBeenCalled();

    // The guard, on arrival: the document already shows what was just delivered.
    i18nStub.language = 'ja';
    deliver({ type: 'subtitle:language', language: 'ja' });
    expect(showLanguageUncached).not.toHaveBeenCalled();

    deliver({ type: 'subtitle:language', language: 'fr' });
    expect(showLanguageUncached).toHaveBeenCalledTimes(1);
    expect(showLanguageUncached).toHaveBeenCalledWith('fr');
    i18nStub.language = 'fr'; // as the real switch would leave it

    // The same language twice, even across a fresh component over the same receiver, → one call.
    unmount();
    render(<ConnectedOverlay receiver={receiver} />);
    expect(showLanguageUncached).toHaveBeenCalledTimes(1);
    deliver({ type: 'subtitle:language', language: 'fr' });
    expect(showLanguageUncached).toHaveBeenCalledTimes(1);
  });

  it('reports a switch that failed, once', async () => {
    showLanguageUncached.mockRejectedValueOnce(new Error('offline'));
    const { port, deliver } = overlayPort();
    const receiver = receiveSubtitles(port);
    render(<ConnectedOverlay receiver={receiver} />);
    deliver({ type: 'subtitle:language', language: 'ko' });
    await vi.waitFor(() => expect(reportWarning).toHaveBeenCalledTimes(1));
    expect(reportWarning).toHaveBeenCalledWith(
      'SubtitleOverlay',
      expect.stringContaining('ko'),
      expect.objectContaining({ dedupeKey: 'overlay:language' }),
    );
  });

  it("keeps its controls' identity across renders", () => {
    const { port, deliver } = overlayPort();
    const receiver = receiveSubtitles(port);
    render(<ConnectedOverlay receiver={receiver} />);
    const first = captured[0].controls;
    deliver({ type: 'subtitle:entries', entries: [] });
    deliver({ type: 'subtitle:entries', entries: [] });
    expect(captured[captured.length - 1].controls).toBe(first);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Entry } from '../../lib/projection/types';
import type { SubtitleSession } from '../../lib/subtitle/session';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // i18next's two call shapes: t(key, fallback, values) and t(key, { defaultValue, ...values }).
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
vi.mock('./useSubtitleChrome', () => ({
  useSubtitleChrome: () => ({ rootRef: { current: null }, rootProps: { className: 'subtitle-app', style: {}, onMouseEnter() {}, onMouseMove() {}, onMouseLeave() {} }, resizeHandles: null }),
}));
vi.mock('./SubtitleBar', () => ({
  default: (p: { sessionControl?: unknown; speakerActive: boolean; participantActive: boolean; sourceLanguageCode: string; onExit?: () => void; sessionElapsedMs: number; exportMenu?: unknown }) =>
    require('react').createElement('div', {
      'data-testid': 'bar',
      'data-control': p.sessionControl ? 'yes' : 'no',
      'data-legs': `${p.speakerActive}/${p.participantActive}`,
      'data-pair': p.sourceLanguageCode,
      'data-elapsed': String(p.sessionElapsedMs),
      'data-export': p.exportMenu ? 'yes' : 'no',
      // Records what SubtitleView hands the bar for exit (I3): clicking the
      // stub calls whatever it was given.
      onClick: p.onExit,
    }),
}));
vi.mock('../../stores/subtitleStore', () => ({
  useSubtitleSettings: () => ({ fontSize: 24, compactMode: true, sourceTextColor: '#fff', translationTextColor: '#9ad0ff' }),
  useSubtitleSpeakerDisplayMode: () => 'both',
  useSubtitleParticipantDisplayMode: () => 'both',
  useSubtitleNewItemHighlightEnabled: () => false,
}));

const { SubtitleView } = await import('./SubtitleView');

const entry: Entry = {
  kind: 'exchange', id: 'a', leg: 'speaker', languages: { source: 'en', target: 'ja' }, pairing: 'stated', t: 0,
  source: [{ key: 's1:0', segmentId: 's1', side: 'source', start: 0, end: 6, text: 'Hello.', final: true }],
  translation: [],
};
const session = (over: Partial<SubtitleSession> = {}): SubtitleSession => ({
  phase: 'running', since: 0, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: false, canStart: false, idle: { kind: 'ended' }, ...over,
});
const controls = () => ({ exit: vi.fn(), clear: vi.fn(), press: vi.fn(), release: vi.fn(), start: vi.fn(), stop: vi.fn(), openSettings: vi.fn() });

beforeEach(() => cleanup());

describe('SubtitleView', () => {
  it('never shows a negative elapsed time when the session arrives after mount', () => {
    const future = Date.now() + 5000;
    render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ since: future }) }} controls={controls()} />);
    expect(Number(screen.getByTestId('bar').dataset.elapsed)).toBe(0);
  });

  it('draws the bands while a run is live', () => {
    const { container } = render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(container.querySelector('.subtitle-stream__line')?.textContent).toBe('Hello.');
    expect(screen.getByTestId('bar').dataset).toMatchObject({ control: 'yes', legs: 'true/false', pair: 'EN' });
  });

  it('shows the Space hint on the Electron takeover under manual turns before anything is said, and never on the overlay', () => {
    const live = session({ holdToTalk: true });
    const { container, unmount } = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: live }} controls={controls()} />);
    expect(container.querySelector('.subtitle-ptt-hint')?.textContent).toBe('Press Space to speak');
    expect(container.querySelector('.subtitle-hold')).toBeNull();
    unmount();
    const acts = controls();
    const overlay = render(<SubtitleView surface="extension-overlay" model={{ entries: [], lit: new Map(), session: live }} controls={acts} />);
    expect(overlay.container.querySelector('.subtitle-ptt-hint')).toBeNull();
    fireEvent.pointerDown(overlay.getByRole('button', { name: 'Hold' }));
    fireEvent.pointerUp(overlay.getByRole('button', { name: 'Release' }));
    expect(acts.press).toHaveBeenCalledTimes(1);
    expect(acts.release).toHaveBeenCalledTimes(1);
  });

  it('offers no hold button under automatic turns, and no session control on the overlay', () => {
    const { container } = render(<SubtitleView surface="extension-overlay" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(container.querySelector('.subtitle-hold')).toBeNull();
    expect(screen.getByTestId('bar').dataset.control).toBe('no');
  });

  it("shows the idle body when no run is live: a provider's reason, a failed start in words", () => {
    const unready = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'unready', message: 'Download a model first.' } }) }} controls={controls()} />);
    expect(unready.container.querySelector('.subtitle-idle__action--fix')?.textContent).toBe('Download a model first');
    unready.unmount();
    const failed = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'failed', notice: { code: 'start_failed', message: 'socket closed' } } }) }} controls={controls()} />);
    expect(failed.container.querySelector('.subtitle-idle__error')?.textContent).toBe('Failed to start: socket closed');
  });

  it("shows local_models_missing's words in the idle action", () => {
    const { container } = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'unready', message: 'Required models are not available…', code: 'local_models_missing' } }) }} controls={controls()} />);
    expect(container.querySelector('.subtitle-idle__action--fix')?.textContent).toBe('Please download the required models in Settings to start');
  });

  // Plan 1e-3b-1 ruling 13: the idle body's fix action deep-links the same
  // way a notice's action does — a code that maps to a Settings section.
  it("routes the fix action to controls.openSettings, at the readiness code's target", () => {
    const acts = controls();
    render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'unready', message: 'm', code: 'no_microphone' } }) }} controls={acts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure devices for this mode to start' }));
    expect(acts.openSettings).toHaveBeenCalledWith('microphone');
  });

  it('disables the fix action when the readiness code maps to no Settings section', () => {
    const { container } = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'unready', message: 'm', code: 'start_failed' } }) }} controls={controls()} />);
    expect(container.querySelector('.subtitle-idle__action--fix')).toBeDisabled();
  });

  it("shows a non-start_failed notice's own words, still wrapped by noticeText", () => {
    const failed = render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, idle: { kind: 'failed', notice: { code: 'leg_closed', message: 'ignored for a code with fixed words' } } }) }} controls={controls()} />);
    expect(failed.container.querySelector('.subtitle-idle__error')?.textContent).toBe('Failed to start: The provider ended the session.');
  });

  it('starts from the idle body on the Electron takeover', () => {
    const acts = controls();
    render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session({ phase: 'idle', since: null, canStart: true, idle: { kind: 'ready' } }) }} controls={acts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start translating' }));
    expect(acts.start).toHaveBeenCalledTimes(1);
  });

  it('shows the overlay its idle body before the side panel has said anything', () => {
    const { container } = render(<SubtitleView surface="extension-overlay" model={{ entries: [], lit: new Map(), session: null }} controls={controls()} />);
    expect(container.querySelector('.subtitle-idle__message')?.textContent).toBe('Session ended');
  });

  it("hands the bar's exit button to controls.exit, on both surfaces", () => {
    const electronActs = controls();
    render(<SubtitleView surface="electron" model={{ entries: [], lit: new Map(), session: session() }} controls={electronActs} />);
    fireEvent.click(screen.getByTestId('bar'));
    expect(electronActs.exit).toHaveBeenCalledTimes(1);

    cleanup();
    const overlayActs = controls();
    render(<SubtitleView surface="extension-overlay" model={{ entries: [], lit: new Map(), session: session() }} controls={overlayActs} />);
    fireEvent.click(screen.getByTestId('bar'));
    expect(overlayActs.exit).toHaveBeenCalledTimes(1);
  });

  it('hands the bar an export menu over the exporter it was given, and none without one', () => {
    const exporter = { hasContent: true, hasScopedContent: () => true, text: () => '', json: () => '' };
    render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} exporter={exporter} />);
    expect(screen.getByTestId('bar').dataset.export).toBe('yes');
    cleanup();
    render(<SubtitleView surface="electron" model={{ entries: [entry], lit: new Map(), session: session() }} controls={controls()} />);
    expect(screen.getByTestId('bar').dataset.export).toBe('no');
  });
});

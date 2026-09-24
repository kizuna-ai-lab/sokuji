import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createStore } from 'zustand/vanilla';
import { createVirtualClock } from '../../lib/contract/clock';
import { Conversation } from '../../lib/conversation/Conversation';
import type { AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import { ConversationSet } from '../../lib/session/conversationSet';
import type { Runner } from '../../lib/session/runner';
import type { RunState } from '../../lib/session/types';
import { useRoutingStore } from '../../stores/routingStore';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../../lib/diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { SessionControls } from './SessionControls';

function fakeRunner(initial: RunState = { phase: 'idle' }) {
  const state = createStore<RunState>(() => initial);
  const runner: Runner = {
    state,
    conversation: new ConversationSet(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    press: vi.fn(),
    release: vi.fn(),
    sendText: vi.fn(),
    clear: vi.fn(),
  };
  return { runner, state };
}

describe('SessionControls', () => {
  it('starts from idle and stops while running', () => {
    const { runner, state } = fakeRunner();
    render(<SessionControls runner={runner} turnMode="auto" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(runner.start).toHaveBeenCalled();
    act(() => { state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true); });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(runner.stop).toHaveBeenCalled();
  });

  it('holds a turn with the pointer, releasing on up, leave and cancel', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="push-to-talk" />);
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    fireEvent.pointerDown(hold);
    fireEvent.pointerLeave(hold);
    fireEvent.pointerDown(hold);
    fireEvent.pointerCancel(hold);
    expect(runner.press).toHaveBeenCalledTimes(3);
    expect(runner.release).toHaveBeenCalledTimes(3);
  });

  it('offers no hold button under automatic turns', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('sends typed text and clears', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(runner.sendText).toHaveBeenCalledWith('hello');
    expect(runner.clear).toHaveBeenCalled();
  });

  it('shows why the last run ended', () => {
    const { runner } = fakeRunner({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'not-ready', message: 'model not downloaded' } } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    expect(screen.getByText(/model not downloaded/)).toBeInTheDocument();
  });
});

function fakeAudio(): AppAudio & { playback: Playback } {
  const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
  const playback = {
    queues: { speaker: queue, participant: queue, replay: queue },
    audio: vi.fn(), held: vi.fn(), clear: vi.fn(),
    replay: vi.fn(), stopReplay: vi.fn(),
    preview: vi.fn(async () => {}), stopPreview: vi.fn(),
    passthrough: vi.fn(),
    ttsTap: { read: () => new Float32Array(0) },
    dispose: vi.fn(async () => {}),
  } as unknown as Playback;
  return { playback, testTone: vi.fn(async () => {}) };
}

/** One exchange whose translation (ref 2) kept its speech. */
function oneExchange(): Conversation {
  const conversation = new Conversation({ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, clock: createVirtualClock(0) });
  conversation.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'x' } });
  conversation.apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello.' } });
  conversation.apply({ kind: 'segmentClosed', payload: { ref: 1, origin: 'x' } });
  conversation.apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'x' } });
  conversation.apply({ kind: 'segmentText', payload: { ref: 2, text: 'こんにちは。' } });
  conversation.apply({ kind: 'audio', payload: { ref: 2, pcm: new Int16Array(2400) } });
  conversation.apply({ kind: 'segmentClosed', payload: { ref: 2, origin: 'x' } });
  return conversation;
}

describe('SessionControls — playback', () => {
  it("replays an exchange's translation", () => {
    const { runner } = fakeRunner();
    runner.conversation.replace(new Map([['speaker' as const, oneExchange()]]));
    const audio = fakeAudio();
    render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(audio.playback.replay).toHaveBeenCalledWith('speaker', expect.objectContaining({ ref: 2 }));
  });

  it('plays the test tone', () => {
    const { runner } = fakeRunner();
    const audio = fakeAudio();
    render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test tone' }));
    expect(audio.testTone).toHaveBeenCalled();
  });

  it('reports when the test tone does not play, instead of an unhandled rejection', async () => {
    reportErrorSpy.mockClear();
    const { runner } = fakeRunner();
    const audio = fakeAudio();
    audio.testTone = vi.fn(async () => { throw new Error('rate out of range'); });
    render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test tone' }));
      await Promise.resolve();
    });
    expect(reportErrorSpy).toHaveBeenCalledWith(
      'SessionControls',
      'The test tone did not play: rate out of range',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });

  it('switches whether the meeting hears the translation', () => {
    useRoutingStore.setState({ meeting: true });
    const { runner } = fakeRunner();
    render(<SessionControls runner={runner} turnMode="auto" audio={fakeAudio()} />);
    fireEvent.click(screen.getByLabelText('Meeting hears the translation'));
    expect(useRoutingStore.getState().meeting).toBe(false);
  });

  it('shows the clips it heard and the loudest sample the tap heard', () => {
    vi.useFakeTimers();
    try {
      const { runner } = fakeRunner();
      const audio = fakeAudio();
      const playing = { position: () => ({ key: 'speaker:2:0', t: 10 }), pending: 1, subscribe: () => () => {} };
      Object.assign(audio.playback.queues, { speaker: playing });
      Object.assign(audio.playback, { ttsTap: { read: () => Float32Array.of(0.25, -0.5) } });
      render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
      act(() => { vi.advanceTimersByTime(100); });
      expect(document.querySelector('[data-probe="playback"]')?.textContent).toBe('heard: speaker:2:0 · tap peak: 0.500');
    } finally {
      vi.useRealTimers();
    }
  });
});

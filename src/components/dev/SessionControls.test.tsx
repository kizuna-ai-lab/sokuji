import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createStore } from 'zustand/vanilla';
import { ConversationSet } from '../../lib/session/conversationSet';
import type { Runner } from '../../lib/session/runner';
import type { RunState } from '../../lib/session/types';
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

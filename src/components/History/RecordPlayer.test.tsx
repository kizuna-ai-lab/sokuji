// The record's player: play, pause, seek, speed; each track placed at its own offset.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import '../../locales';
import type { HistoryTrack } from '../../lib/history/types';
import RecordPlayer, { type SeekFn } from './RecordPlayer';

const track = (source: string, offsetMs: number, durationMs: number): HistoryTrack =>
  ({ source, file: `${source}.opus`, format: 'ogg-opus', durationMs, bytes: 100, offsetMs, goneAt: null });
const times = new WeakMap<HTMLMediaElement, number>();
let playing: Set<HTMLMediaElement>;
let assigned: HTMLMediaElement[];

beforeEach(() => {
  vi.useFakeTimers();
  playing = new Set();
  assigned = [];
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return times.get(this) ?? 0; },
    set(v: number) { assigned.push(this); times.set(this, v); },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { playing.add(this); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { playing.delete(this); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const audios = () => Array.from(document.querySelectorAll('audio'));

describe('the record player', () => {
  it('reads each kept track from the recordings address', () => {
    render(<RecordPlayer recordId="run-0001-aaaa" tracks={[track('speaker', 0, 10_000), track('participant', 2000, 8000)]} onPosition={() => {}} seekRef={createRef<SeekFn>()} />);
    expect(audios().map((a) => a.getAttribute('src'))).toEqual(['sokuji-history://track/run-0001-aaaa/speaker', 'sokuji-history://track/run-0001-aaaa/participant']);
    expect(screen.getByText('0:00 / 0:10')).toBeInTheDocument();
  });

  // B-07: in development, StrictMode detaches and re-attaches each element once on mount; the detach unloads the
  // element, and the re-attach must give it its file back, or the player runs on an element with nothing to play.
  it('keeps each track\'s address through StrictMode\'s rehearsal', () => {
    render(
      <StrictMode>
        <RecordPlayer recordId="run-0001-aaaa" tracks={[track('speaker', 0, 10_000), track('participant', 2000, 8000)]} onPosition={() => {}} seekRef={createRef<SeekFn>()} />
      </StrictMode>,
    );
    expect(audios().map((a) => a.getAttribute('src'))).toEqual(['sokuji-history://track/run-0001-aaaa/speaker', 'sokuji-history://track/run-0001-aaaa/participant']);
  });

  it("unloads a track's element when the track goes, so its file can be deleted", () => {
    const props = { recordId: 'r', onPosition: () => {}, seekRef: createRef<SeekFn>() };
    const { rerender } = render(<StrictMode><RecordPlayer {...props} tracks={[track('speaker', 0, 10_000), track('participant', 0, 10_000)]} /></StrictMode>);
    const participant = audios()[1];
    rerender(<StrictMode><RecordPlayer {...props} tracks={[track('speaker', 0, 10_000)]} /></StrictMode>);
    expect(participant.getAttribute('src')).toBeNull();
    expect(audios().map((a) => a.getAttribute('src'))).toEqual(['sokuji-history://track/r/speaker']);
  });

  it('places each track at its own offset', () => {
    const seekRef = createRef<SeekFn>();
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 10_000), track('participant', 2000, 8000)]} onPosition={() => {}} seekRef={seekRef} />);
    act(() => seekRef.current!(5000, false));
    const [speaker, participant] = audios();
    expect(speaker.currentTime).toBe(5);
    expect(participant.currentTime).toBe(3);
    expect(screen.getByText('0:05 / 0:10')).toBeInTheDocument();
  });

  it('plays a track only once the position reaches its start, and reports the position', () => {
    const seekRef = createRef<SeekFn>();
    const positions: Array<number | null> = [];
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 10_000), track('participant', 2000, 8000)]} onPosition={(ms) => positions.push(ms)} seekRef={seekRef} />);
    act(() => seekRef.current!(1000, true));
    const [speaker, participant] = audios();
    expect(playing.has(speaker)).toBe(true);
    expect(playing.has(participant)).toBe(false);
    act(() => { vi.advanceTimersByTime(1200); });
    expect(playing.has(participant)).toBe(true);
    expect(positions[positions.length - 1]).toBeGreaterThanOrEqual(2000);
  });

  it('pauses, plays at another speed, and stops at the end', () => {
    const seekRef = createRef<SeekFn>();
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 2000)]} onPosition={() => {}} seekRef={seekRef} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playing.size).toBe(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '2' } });
    expect(audios()[0].playbackRate).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(playing.size).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => { vi.advanceTimersByTime(1500); });
    expect(playing.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('keeps the speed chosen on this computer: the next record opened plays at it', () => {
    localStorage.clear();
    const seekRef = createRef<SeekFn>();
    const { unmount } = render(<RecordPlayer recordId="a" tracks={[track('speaker', 0, 2000)]} onPosition={() => {}} seekRef={seekRef} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '1.5' } });
    unmount();

    const positions: number[] = [];
    render(<RecordPlayer recordId="b" tracks={[track('speaker', 0, 4000)]} onPosition={(ms) => positions.push(ms)} seekRef={seekRef} />);
    expect(screen.getByRole('combobox', { name: 'Speed' })).toHaveValue('1.5');
    expect(audios()[0].playbackRate).toBe(1.5);
    // An element's own load puts its rate back to the default one: that is the chosen speed too.
    expect(audios()[0].defaultPlaybackRate).toBe(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => { vi.advanceTimersByTime(1000); });
    const last = positions[positions.length - 1];
    expect(last).toBeGreaterThanOrEqual(1400);
    expect(last).toBeLessThanOrEqual(1600);
  });

  it('plays at 1× when no speed was kept, or what was kept is not one of its speeds', () => {
    const seekRef = createRef<SeekFn>();
    for (const kept of [null, '3', 'fast']) {
      localStorage.clear();
      if (kept !== null) localStorage.setItem('history.playbackSpeed', kept);
      render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 2000)]} onPosition={() => {}} seekRef={seekRef} />);
      expect(screen.getByRole('combobox', { name: 'Speed' })).toHaveValue('1');
      expect(audios()[0].playbackRate).toBe(1);
      cleanup();
    }
  });

  it('follows the playing track instead of seeking it, at 2× as at 1×', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    const seekRef = createRef<SeekFn>();
    const positions: number[] = [];
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 60_000)]} onPosition={(ms) => positions.push(ms)} seekRef={seekRef} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '2' } });
    act(() => seekRef.current!(0, true));
    const [speaker] = audios();
    assigned = [];
    // The element starts late and runs 180 ms of audio behind a wall clock at 2×.
    for (let i = 1; i <= 10; i++) {
      times.set(speaker, Math.max(0, i * 0.2 - 0.18));
      act(() => { vi.advanceTimersByTime(100); });
    }
    expect(assigned.filter((el) => el === speaker)).toEqual([]);
    expect(positions[positions.length - 1]).toBeCloseTo(1820, -1);
    if (original) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', original);
  });

  it('stops and says so when no track can be played, instead of running the clock on silence', () => {
    const seekRef = createRef<SeekFn>();
    const positions: number[] = [];
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 60_000)]} onPosition={(ms) => positions.push(ms)} seekRef={seekRef} />);
    act(() => seekRef.current!(0, true));
    act(() => { audios()[0].dispatchEvent(new Event('error')); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This recording cannot be played');
    const stoppedAt = positions[positions.length - 1];
    act(() => { vi.advanceTimersByTime(1000); });
    expect(positions[positions.length - 1]).toBe(stoppedAt);
  });

  it('does not start a recording none of whose tracks loaded', () => {
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 60_000)]} onPosition={() => {}} seekRef={createRef<SeekFn>()} />);
    act(() => { audios()[0].dispatchEvent(new Event('error')); });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(playing.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This recording cannot be played');
  });

  it('keeps playing the tracks that load when another cannot', () => {
    const seekRef = createRef<SeekFn>();
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 10_000), track('participant', 0, 10_000)]} onPosition={() => {}} seekRef={seekRef} />);
    act(() => seekRef.current!(0, true));
    const [speaker, participant] = audios();
    act(() => { participant.dispatchEvent(new Event('error')); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(playing.has(speaker)).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('seeks from the slider', () => {
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 10_000)]} onPosition={() => {}} seekRef={createRef<SeekFn>()} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Position' }), { target: { value: '7000' } });
    expect(audios()[0].currentTime).toBe(7);
  });
});

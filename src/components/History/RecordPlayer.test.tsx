// The record's player: play, pause, seek, speed; each track placed at its own offset.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createRef } from 'react';
import '../../locales';
import type { HistoryTrack } from '../../lib/history/types';
import RecordPlayer, { type SeekFn } from './RecordPlayer';

const track = (source: string, offsetMs: number, durationMs: number): HistoryTrack =>
  ({ source, file: `${source}.opus`, format: 'ogg-opus', durationMs, bytes: 100, offsetMs, goneAt: null });
const times = new WeakMap<HTMLMediaElement, number>();
let playing: Set<HTMLMediaElement>;

beforeEach(() => {
  vi.useFakeTimers();
  playing = new Set();
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return times.get(this) ?? 0; },
    set(v: number) { times.set(this, v); },
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

  it('seeks from the slider', () => {
    render(<RecordPlayer recordId="r" tracks={[track('speaker', 0, 10_000)]} onPosition={() => {}} seekRef={createRef<SeekFn>()} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Position' }), { target: { value: '7000' } });
    expect(audios()[0].currentTime).toBe(7);
  });
});

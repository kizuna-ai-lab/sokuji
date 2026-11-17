// src/components/History/RecordPlayer.tsx
//
// The record's player along the bottom of its page: play, pause, seek, speed. The tracks play together on the
// record's clock: each starts once the position reaches its offset. While a track is playing with data in hand, the
// position is read from it (the first such track leads) and the others are kept within 150 ms of it; before that, a
// wall clock at the chosen speed carries the position. The page is told the position and highlights the row.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { playable, recordLength, trackUrl } from '../../lib/history/playback';
import type { HistoryTrack } from '../../lib/history/types';
import { formatLength } from './format';

export type SeekFn = (ms: number, play: boolean) => void;

export interface RecordPlayerProps {
  recordId: string;
  tracks: readonly HistoryTrack[];
  onPosition(ms: number): void;
  /** The page's way to play from a sentence. */
  seekRef: RefObject<SeekFn | null>;
}

/** The position moves this often while playing. */
const TICK_MS = 100;
/** A track further than this from the position is put back on it. */
const DRIFT_S = 0.15;
/** `HAVE_FUTURE_DATA`: an element playing with data in hand. */
const READY = 3;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
/** The speed last chosen, kept on this computer: the next record opened plays at it too. */
const SPEED_KEY = 'history.playbackSpeed';
const readSpeed = (): number => {
  try {
    const kept = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(kept) ? kept : 1;
  } catch { return 1; }
};
const writeSpeed = (speed: number): void => { try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* 1× next time */ } };
/** An element at `speed`; its default rate too, which its own load goes back to. */
const applySpeed = (el: HTMLAudioElement, speed: number): void => { el.defaultPlaybackRate = speed; el.playbackRate = speed; };

export const RecordPlayer: React.FC<RecordPlayerProps> = ({ recordId, tracks, onPosition, seekRef }) => {
  const { t } = useTranslation();
  const kept = useMemo(() => playable(tracks), [tracks]);
  const length = useMemo(() => recordLength(tracks), [tracks]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(readSpeed);
  /** The tracks whose file could not be loaded or decoded: when every kept track is one, nothing can be heard. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const unplayable = kept.length > 0 && kept.every((track) => failed.has(track.source));
  const unplayableRef = useRef(unplayable);
  unplayableRef.current = unplayable;
  useEffect(() => { setFailed(new Set()); }, [recordId]);
  const markFailed = (source: string) => setFailed((prev) => (prev.has(source) ? prev : new Set(prev).add(source)));
  const audio = useRef(new Map<string, HTMLAudioElement>());
  const started = useRef(new Set<HTMLAudioElement>());
  /** The position at `at` (Date.now()); it moves at `speed` while playing. */
  const clock = useRef({ base: 0, at: 0, playing: false, speed });
  const report = useRef(onPosition);
  report.current = onPosition;

  const now = () => {
    const c = clock.current;
    return c.playing ? c.base + (Date.now() - c.at) * c.speed : c.base;
  };

  /** The first track playing with data in hand: the position is read from it. */
  const lead = (): { el: HTMLAudioElement; offsetMs: number } | null => {
    for (const track of kept) {
      const el = audio.current.get(track.source);
      if (el && started.current.has(el) && !el.seeking && !el.ended && el.readyState >= READY) return { el, offsetMs: track.offsetMs };
    }
    return null;
  };

  /**
   * Every track to `pos`: playing where it covers it (when `play`), paused elsewhere. `exact` (a seek, play or pause)
   * puts each on the position; otherwise only a ready track that drifted, never the one leading.
   */
  const align = (pos: number, play: boolean, exact: boolean, leading: HTMLAudioElement | null = null) => {
    for (const track of kept) {
      const el = audio.current.get(track.source);
      if (!el) continue;
      const inside = pos >= track.offsetMs && pos < track.offsetMs + track.durationMs;
      const local = Math.max(0, (pos - track.offsetMs) / 1000);
      if (!inside || !play) {
        if (started.current.has(el)) { el.pause(); started.current.delete(el); }
        if (exact || !inside) el.currentTime = inside ? local : 0;
        continue;
      }
      const settled = !el.seeking && el.readyState >= READY;
      if (exact || !started.current.has(el)) {
        if (Math.abs(el.currentTime - local) > (exact ? 0 : DRIFT_S) || !started.current.has(el)) el.currentTime = local;
      } else if (el !== leading && settled && Math.abs(el.currentTime - local) > DRIFT_S) {
        el.currentTime = local;
      }
      if (!started.current.has(el)) {
        started.current.add(el);
        void el.play()?.catch?.(() => started.current.delete(el));
      }
    }
  };

  const move = (pos: number, play: boolean) => {
    const at = Math.min(Math.max(0, pos), length);
    // A recording none of whose tracks loaded does not play: the clock would run on silence.
    clock.current = { ...clock.current, base: at, at: Date.now(), playing: play && at < length && !unplayableRef.current };
    setPosition(at);
    setPlaying(clock.current.playing);
    report.current(at);
    align(at, clock.current.playing, true);
  };

  const seek: SeekFn = (ms, play) => move(ms, play);
  useLayoutEffect(() => {
    (seekRef as { current: SeekFn | null }).current = seek;
    return () => { (seekRef as { current: SeekFn | null }).current = null; };
  });

  // Every track failed while playing: stop where it is.
  useEffect(() => {
    if (unplayable && playing) move(now(), false);
    // `move` and `now` read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unplayable, playing]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      const leader = lead();
      const pos = leader ? leader.offsetMs + leader.el.currentTime * 1000 : now();
      // The wall clock picks up from the leader, so a track that stops leading (buffering) hands over smoothly.
      if (leader) clock.current = { ...clock.current, base: pos, at: Date.now() };
      if (pos >= length) {
        move(length, false);
        return;
      }
      setPosition(pos);
      report.current(pos);
      align(pos, true, false, leader?.el ?? null);
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // `align` and `move` read refs and the current tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, length, kept]);

  /**
   * One ref callback per track, kept across renders: it is called with null when the element goes, and in development
   * also once on mount, StrictMode detaching and re-attaching the same element.
   */
  const refs = useRef(new Map<string, (el: HTMLAudioElement | null) => void>());
  /** The address each released element had, for when the same element is given back. */
  const released = useRef(new WeakMap<HTMLAudioElement, string>());
  const refFor = (source: string) => {
    let ref = refs.current.get(source);
    if (!ref) {
      ref = (el) => {
        if (el) {
          // Given back after a release (StrictMode's rehearsal in development): React does not set an unchanged
          // `src` again, so the element gets its file back here, or it would play nothing.
          const address = released.current.get(el);
          if (address && !el.getAttribute('src')) el.setAttribute('src', address);
          released.current.delete(el);
          applySpeed(el, clock.current.speed);
          audio.current.set(source, el);
          return;
        }
        const gone = audio.current.get(source);
        if (gone) release(gone);
        audio.current.delete(source);
      };
      refs.current.set(source, ref);
    }
    return ref;
  };

  /** A track's element as it goes: paused and unloaded, so the main process can delete the file (Windows refuses an open one). */
  const release = (el: HTMLAudioElement) => {
    el.pause();
    started.current.delete(el);
    const address = el.getAttribute('src');
    if (address) released.current.set(el, address);
    el.removeAttribute('src');
    try { el.load(); } catch { /* nothing to unload */ }
  };

  const changeSpeed = (next: number) => {
    const pos = now();
    clock.current = { ...clock.current, base: pos, at: Date.now(), speed: next };
    setSpeed(next);
    writeSpeed(next);
    for (const el of audio.current.values()) applySpeed(el, next);
  };

  return (
    <div className="record-player" role="group" aria-label={t('history.player', 'Recording')}>
      {kept.map((track) => (
        <audio
          key={track.source}
          ref={refFor(track.source)}
          src={trackUrl(recordId, track.source)}
          preload="metadata"
          onError={() => markFailed(track.source)}
        />
      ))}
      <button
        type="button"
        className="history-button history-button--icon record-player__play"
        aria-label={playing ? t('history.pause', 'Pause') : t('history.play', 'Play')}
        onClick={() => move(playing ? now() : position >= length ? 0 : position, !playing)}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="record-player__time">{`${formatLength(position)} / ${formatLength(length)}`}</span>
      {unplayable && <span className="record-player__error" role="status">{t('history.cannotPlay', 'This recording cannot be played')}</span>}
      <input
        type="range"
        className="slider record-player__seek"
        aria-label={t('history.position', 'Position')}
        min={0}
        max={length}
        step={100}
        value={Math.round(position)}
        onChange={(e) => move(Number(e.target.value), playing)}
      />
      <select
        className="select-dropdown record-player__speed"
        aria-label={t('history.speed', 'Speed')}
        value={String(speed)}
        onChange={(e) => changeSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((s) => <option key={s} value={String(s)}>{`${s}×`}</option>)}
      </select>
    </div>
  );
};

export default RecordPlayer;

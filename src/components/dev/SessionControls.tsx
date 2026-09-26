import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import type { Runner } from '../../lib/session/runner';
import type { TurnMode } from '../../lib/session/types';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { createGapCounter, type GapCount } from './gapCounter';

interface SessionControlsProps {
  runner: Runner;
  turnMode: TurnMode;
  /** The page's playback, once it has loaded. */
  audio?: AppAudio | null;
  /** What the page's capture delivered (the preview's `&capture=device`), for the probe line. */
  capture?: () => { chunks: number; peak: number };
}

/**
 * What the playback played, for a listener and for a headless check (which
 * cannot use requestAnimationFrame): every clip key heard, and the loudest
 * sample the tts tap heard, and the gaps inside the translated speech the
 * tap heard (G3). Reading the tap drains it: under `&capture=device` the app
 * capture's own echo watch also drains the tap, every 250 ms, so the peak and
 * the gaps shown here are partial — `spine-audio-probe.mjs` refuses
 * `--max-gaps` there. When `capture` is given, also reports what it
 * delivered.
 */
function usePlaybackProbe(
  playback: Playback | undefined,
  capture?: () => { chunks: number; peak: number },
): { heard: string[]; peak: number; busPeak: number; gaps: GapCount; captured: { chunks: number; peak: number } | null } {
  const [probe, setProbe] = useState<{ heard: string[]; peak: number; busPeak: number; gaps: GapCount; captured: { chunks: number; peak: number } | null }>({
    heard: [],
    peak: 0,
    busPeak: 0,
    gaps: { gaps: 0, gapMs: 0, at: [] },
    captured: capture ? { chunks: 0, peak: 0 } : null,
  });
  // A new arrow function on every render must not tear down the interval below
  // (that would reset the heard keys and peaks); keep the latest reader in a ref.
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    if (!playback) return;
    const heard = new Set<string>();
    let peak = 0;
    let busPeak = 0;
    let last = { chunks: 0, peak: 0 };
    const gapCounter = createGapCounter();
    const id = setInterval(() => {
      const before = heard.size;
      const beforePeak = peak;
      const beforeBusPeak = busPeak;
      const beforeGaps = gapCounter.read().gaps;
      for (const queue of Object.values(playback.queues)) {
        const playing = queue.position();
        if (playing) heard.add(playing.key);
      }
      const tapped = playback.ttsTap.read();
      for (const sample of tapped) peak = Math.max(peak, Math.abs(sample));
      gapCounter.push(tapped);
      for (const sample of playback.meter('real')?.read() ?? []) busPeak = Math.max(busPeak, sample);
      const seen = captureRef.current?.();
      const captureChanged = seen && (seen.chunks !== last.chunks || seen.peak !== last.peak);
      const gaps = gapCounter.read();
      if (heard.size !== before || peak !== beforePeak || busPeak !== beforeBusPeak || captureChanged || gaps.gaps !== beforeGaps) {
        if (seen) last = seen;
        setProbe({ heard: [...heard], peak, busPeak, gaps, captured: seen ?? null });
      }
    }, 100);
    return () => clearInterval(id);
  }, [playback]);
  return probe;
}

/**
 * Development builds only: drive a runner by hand and check the playback by
 * ear; the conversation is drawn by the list beside it (plan 1d-1). Its copy
 * is not localized.
 */
export function SessionControls({ runner, turnMode, audio, capture }: SessionControlsProps) {
  const state = useStore(runner.state);
  const [text, setText] = useState('');
  const running = state.phase === 'running';
  const meeting = useRoutingStore((s) => s.meeting);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const monitorMuted = useAudioStore((s) => s.isMonitorMuted);
  // Applies at once — the kept conversation and a live run alike — not from the next Start.
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const probe = usePlaybackProbe(audio?.playback, capture);

  return (
    <div className="settings-section">
      <h2>Session (dev)</h2>
      <div className="setting-item">
        {state.phase === 'idle' ? (
          <button type="button" className="validate-button" onClick={() => void runner.start()}>Start</button>
        ) : (
          <button type="button" className="validate-button" disabled={state.phase === 'stopping'} onClick={() => void runner.stop()}>Stop</button>
        )}
        <span> {state.phase}{state.phase === 'starting' ? ` (${state.step}${state.loading ? `: ${state.loading.leg} ${state.loading.stage} ${state.loading.done}/${state.loading.total}` : ''})` : ''}</span>
        {state.phase === 'idle' && state.lastEnd && (
          <div className="validation-message error">
            {state.lastEnd.reason}{state.lastEnd.notice ? `: ${state.lastEnd.notice.message}` : ''}
          </div>
        )}
      </div>
      {running && turnMode !== 'auto' && (
        <div className="setting-item">
          <button
            type="button"
            className="validate-button"
            onPointerDown={() => runner.press()}
            onPointerUp={() => runner.release()}
            onPointerLeave={() => runner.release()}
            onPointerCancel={() => runner.release()}
          >
            Hold to talk
          </button>
        </div>
      )}
      <div className="setting-item">
        <label className="setting-label" htmlFor="dev-type"><span>Type</span></label>
        <input id="dev-type" className="settings-input" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="validate-button" disabled={!running || !text} onClick={() => { runner.sendText(text); setText(''); }}>Send</button>
        <button type="button" className="validate-button" onClick={() => runner.clear()}>Clear</button>
      </div>
      {audio && (
        <div className="setting-item">
          <label>
            <input type="checkbox" checked={meeting} onChange={(e) => useRoutingStore.getState().setMeeting(e.target.checked)} />
            Meeting hears the translation
          </label>
          <label>
            <input type="checkbox" checked={!monitorMuted} onChange={(e) => useAudioStore.getState().setMonitorMuted(!e.target.checked)} />
            Monitor
          </label>
          <label>
            <input type="checkbox" checked={participantSpeech} onChange={(e) => useRoutingStore.getState().setParticipantSpeech(e.target.checked)} />
            Participant speech
          </label>
          <label>
            <input type="checkbox" checked={keepReplayAudio} onChange={(e) => void useSettingsStore.getState().setKeepReplayAudio(e.target.checked)} />
            Keep audio for replay
          </label>
          <button
            type="button"
            className="validate-button"
            onClick={() => {
              audio.testTone().catch((error: unknown) => {
                reportError('SessionControls', `The test tone did not play: ${describeCause(error)}`, { cause: error });
              });
            }}
          >
            Test tone
          </button>
          <p data-probe="playback">
            {`heard: ${probe.heard.join(',') || '-'} · tap peak: ${probe.peak.toFixed(3)} · bus peak: ${probe.busPeak.toFixed(3)}`
              + ` · gaps: ${probe.gaps.gaps} (${Math.round(probe.gaps.gapMs)} ms) at ${probe.gaps.at.map((s) => s.toFixed(1)).join(',') || '-'}`
              + (probe.captured ? ` · captured: ${probe.captured.chunks} · mic peak: ${probe.captured.peak.toFixed(3)}` : '')}
          </p>
        </div>
      )}
    </div>
  );
}

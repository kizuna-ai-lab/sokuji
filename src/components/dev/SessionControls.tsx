import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import type { Segment } from '../../lib/conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import type { Runner } from '../../lib/session/runner';
import type { TurnMode } from '../../lib/session/types';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface SessionControlsProps {
  runner: Runner;
  turnMode: TurnMode;
  /** The page's playback, once it has loaded. */
  audio?: AppAudio | null;
}

/**
 * What the playback played, for a listener and for a headless check (which
 * cannot use requestAnimationFrame): every clip key heard, and the loudest
 * sample the tts tap heard. Reading the tap drains it — this page runs no
 * echo monitor.
 */
function usePlaybackProbe(playback: Playback | undefined): { heard: string[]; peak: number } {
  const [probe, setProbe] = useState<{ heard: string[]; peak: number }>({ heard: [], peak: 0 });
  useEffect(() => {
    if (!playback) return;
    const heard = new Set<string>();
    let peak = 0;
    const id = setInterval(() => {
      const before = heard.size;
      const beforePeak = peak;
      for (const queue of Object.values(playback.queues)) {
        const playing = queue.position();
        if (playing) heard.add(playing.key);
      }
      for (const sample of playback.ttsTap.read()) peak = Math.max(peak, Math.abs(sample));
      if (heard.size !== before || peak !== beforePeak) setProbe({ heard: [...heard], peak });
    }, 100);
    return () => clearInterval(id);
  }, [playback]);
  return probe;
}

/**
 * Development builds only: drive a runner by hand, read its conversation
 * raw, and check the playback by ear. The real surfaces (plan 1d) replace
 * this; its copy is not localized.
 */
export function SessionControls({ runner, turnMode, audio }: SessionControlsProps) {
  const state = useStore(runner.state);
  const legs = useSyncExternalStore((l) => runner.conversation.subscribe(l), () => runner.conversation.snapshot());
  const projector = useMemo(() => createProjector(), []);
  const entries = projector.project(legs, DEFAULT_PROJECTION);
  const [text, setText] = useState('');
  const running = state.phase === 'running';
  const segments = new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const)));
  const meeting = useRoutingStore((s) => s.meeting);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const monitorMuted = useAudioStore((s) => s.isMonitorMuted);
  // Read when a run starts (its shape), so it applies from the next Start.
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const probe = usePlaybackProbe(audio?.playback);

  return (
    <div className="settings-section">
      <h2>Session (dev)</h2>
      <div className="setting-item">
        {state.phase === 'idle' ? (
          <button type="button" className="validate-button" onClick={() => void runner.start()}>Start</button>
        ) : (
          <button type="button" className="validate-button" disabled={state.phase === 'stopping'} onClick={() => void runner.stop()}>Stop</button>
        )}
        <span> {state.phase}{state.phase === 'starting' ? ` (${state.step})` : ''}</span>
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
          <button type="button" className="validate-button" onClick={() => void audio.testTone()}>Test tone</button>
          <p data-probe="playback">{`heard: ${probe.heard.join(',') || '-'} · tap peak: ${probe.peak.toFixed(3)}`}</p>
        </div>
      )}
      <ol className="setting-item">
        {entries.map((entry) => {
          if (entry.kind === 'notice') return <li key={entry.id}>{`[${entry.severity}] ${entry.message}`}</li>;
          const spoken = entry.translation
            .map((row) => segments.get(row.segmentId))
            .find((segment): segment is Segment => !!segment && segment.speech.some((s) => s.pcm.length > 0));
          return (
            <li key={entry.id}>
              {`${entry.leg}: ${[...entry.source, ...entry.translation].map((row) => segments.get(row.segmentId)?.text.slice(row.start, row.end) ?? '').join(' | ')}`}
              {audio && spoken && (
                <button type="button" className="validate-button" onClick={() => audio.playback.replay(entry.leg, spoken)}>Replay</button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

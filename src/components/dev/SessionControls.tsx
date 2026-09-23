import { useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import type { Runner } from '../../lib/session/runner';
import type { TurnMode } from '../../lib/session/types';

interface SessionControlsProps {
  runner: Runner;
  turnMode: TurnMode;
}

/**
 * Development builds only: drive a runner by hand and read its conversation
 * raw. The real surfaces (plan 1d) replace this; its copy is not localized.
 */
export function SessionControls({ runner, turnMode }: SessionControlsProps) {
  const state = useStore(runner.state);
  const legs = useSyncExternalStore((l) => runner.conversation.subscribe(l), () => runner.conversation.snapshot());
  const projector = useMemo(() => createProjector(), []);
  const entries = projector.project(legs, DEFAULT_PROJECTION);
  const [text, setText] = useState('');
  const running = state.phase === 'running';
  const segments = new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const)));

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
      <ol className="setting-item">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.kind === 'notice'
              ? `[${entry.severity}] ${entry.message}`
              : `${entry.leg}: ${[...entry.source, ...entry.translation].map((row) => segments.get(row.segmentId)?.text.slice(row.start, row.end) ?? '').join(' | ')}`}
          </li>
        ))}
      </ol>
    </div>
  );
}

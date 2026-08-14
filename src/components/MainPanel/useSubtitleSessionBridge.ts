// src/components/MainPanel/useSubtitleSessionBridge.ts
//
// Two-way bridge between MainPanel and any surface that is outside its React
// tree (today: the Electron subtitle window). Outbound, it publishes the start
// gate and initialization state into sessionStore. Inbound, it watches the
// start/stop request counters and calls back into MainPanel's own
// connect/disconnect functions.
//
// This lives in a hook rather than inline in MainPanel purely so it can be
// tested — MainPanel does not render in a unit test.
import { useEffect, useRef } from 'react';
import useSessionStore from '../../stores/sessionStore';
import type { StartGate } from './sessionStartGate';
import type { InitPhase } from '../../services/providers/ProviderDescriptor';

interface Args {
  startGate: StartGate;
  isInitializing: boolean;
  // MainPanel's own progress indicator is the generic InitPhase (S4); the
  // subtitle window's store still only understands loading-models' counted
  // form, so only that phase is translated below — other phases (e.g.
  // loading-native-asr) mirror as null, same as before that phase existed.
  initPhase: InitPhase | null;
  onStart: () => void;
  onStop: () => void;
}

export function useSubtitleSessionBridge({
  startGate,
  isInitializing,
  initPhase,
  onStart,
  onStop,
}: Args): void {
  const setStartGate = useSessionStore((s) => s.setStartGate);
  const setIsInitializing = useSessionStore((s) => s.setIsInitializing);
  const setInitProgress = useSessionStore((s) => s.setInitProgress);
  const startSessionVersion = useSessionStore((s) => s.startSessionVersion);
  const stopSessionVersion = useSessionStore((s) => s.stopSessionVersion);

  // Outbound mirrors. Dependencies are primitives only: depending on the
  // `startGate` object identity would re-run on every MainPanel render and
  // write a fresh object into the store each time, waking every subscriber.
  const { canStart, reason, balance, deviceScope } = startGate;
  useEffect(() => {
    setStartGate({ canStart, reason, balance, deviceScope });
  }, [canStart, reason, balance, deviceScope, setStartGate]);

  useEffect(() => {
    setIsInitializing(isInitializing);
  }, [isInitializing, setIsInitializing]);

  const completed = initPhase?.phase === 'loading-models' ? initPhase.completed : undefined;
  const total = initPhase?.phase === 'loading-models' ? initPhase.total : undefined;
  useEffect(() => {
    setInitProgress(
      completed === undefined || total === undefined ? null : { completed, total },
    );
  }, [completed, total, setInitProgress]);

  // Inbound requests. The callbacks close over MainPanel state and get a new
  // identity every render, so they are held in refs — an effect that depended
  // on them would re-run constantly and replay the last request.
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  // Seeded with the mount-time value so mounting never looks like a request.
  // Same convention as MainPanel's lastClearVersionRef.
  const lastStartVersion = useRef(startSessionVersion);
  const lastStopVersion = useRef(stopSessionVersion);

  useEffect(() => {
    if (startSessionVersion === lastStartVersion.current) return;
    lastStartVersion.current = startSessionVersion;
    onStartRef.current();
  }, [startSessionVersion]);

  useEffect(() => {
    if (stopSessionVersion === lastStopVersion.current) return;
    lastStopVersion.current = stopSessionVersion;
    onStopRef.current();
  }, [stopSessionVersion]);
}

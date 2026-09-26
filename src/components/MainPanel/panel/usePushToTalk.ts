import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The footer's push-to-talk hold: today's Space handler (`MainPanel.tsx:4094-4149`),
 * ported over the runner's `press`/`release` instead of `startRecording`/`stopRecording`.
 * The held state is the panel's own — `RunState` carries no such field (1e-3
 * ruling 16) — and is released whenever holding no longer makes sense: a
 * key-up, the window losing focus mid-hold, or `enabled` turning false
 * (the mode changed, or the run ended) while held.
 */
export function usePushToTalk({ enabled, press, release }: { enabled: boolean; press(): void; release(): void }) {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const doPress = useCallback(() => {
    if (!enabled || heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    press();
  }, [enabled, press]);
  const doRelease = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    release();
  }, [release]);
  // The run ended, or the mode changed, while the key was down.
  useEffect(() => { if (!enabled) doRelease(); }, [enabled, doRelease]);
  useEffect(() => {
    if (!enabled) return;
    const typing = () => {
      const el = document.activeElement;
      return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.getAttribute('contenteditable') === 'true';
    };
    const down = (e: KeyboardEvent) => {
      if (typing() || e.code !== 'Space' || e.repeat) return;
      e.preventDefault(); // no page scroll
      doPress();
    };
    const up = (e: KeyboardEvent) => {
      if (typing() || e.code !== 'Space') return;
      e.preventDefault();
      doRelease();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', doRelease);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', doRelease);
    };
  }, [enabled, doPress, doRelease]);
  return { held, press: doPress, release: doRelease };
}

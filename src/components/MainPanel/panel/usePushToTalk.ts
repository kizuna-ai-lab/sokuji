import { useCallback, useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '../../../stores/layoutStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { isModifierKey } from '../../../lib/turn/pushKey';
import { isExtension } from '../../../utils/environment';

/**
 * The footer's push-to-talk hold, on the push key the user picked (Space unless changed), over the runner's
 * `press`/`release`. The held state is the panel's own (`RunState` carries no such field) and is released whenever
 * holding no longer makes sense: a key-up, the window losing focus mid-hold, the key changing, or `enabled` turning
 * false (the mode changed, or the run ended) while held. Nothing is held while the History page or the desktop
 * settings page covers the panel: the key there belongs to the page's own buttons and switches. A key that is not a
 * modifier holds only on its own: with Ctrl, Alt, Cmd or Shift down it is someone else's shortcut.
 */
export function usePushToTalk({ enabled: wanted, press, release }: { enabled: boolean; press(): void; release(): void }) {
  // The extension's settings sit beside the conversation; the desktop's take its place, as History does.
  const covered = useLayoutStore((s) => s.historyOpen || (s.showSettings && !isExtension()));
  const enabled = wanted && !covered;
  const pushKey = useTurnModeStore((s) => s.pushKey);
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
  // The key changed while held: its key-up would never come. Only a change of key lets go, not a new `release`.
  const keyRef = useRef(pushKey);
  useEffect(() => {
    if (keyRef.current === pushKey) return;
    keyRef.current = pushKey;
    doRelease();
  }, [pushKey, doRelease]);
  useEffect(() => {
    if (!enabled) return;
    const typing = () => {
      const el = document.activeElement;
      return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.getAttribute('contenteditable') === 'true';
    };
    // A Ctrl, Alt or Shift push key is itself a modifier; any other push key pressed with Ctrl, Alt, Shift or Cmd held
    // is a shortcut, not a hold.
    const modifierKey = isModifierKey(pushKey);
    const down = (e: KeyboardEvent) => {
      if (typing() || e.code !== pushKey || e.repeat) return;
      if (!modifierKey && (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)) return;
      // Whatever the key, the press holds the turn and does nothing else: Space no longer scrolls, a letter no longer
      // reaches a focused button.
      e.preventDefault();
      doPress();
    };
    // A hold ends on its key-up wherever focus went meanwhile, a text field included.
    const up = (e: KeyboardEvent) => {
      if (e.code !== pushKey || !heldRef.current) return;
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
  }, [enabled, pushKey, doPress, doRelease]);
  return { held, press: doPress, release: doRelease };
}

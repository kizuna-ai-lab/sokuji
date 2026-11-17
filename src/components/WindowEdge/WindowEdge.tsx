// src/components/WindowEdge/WindowEdge.tsx
//
// The desktop window's edge. The main window has no system frame and is transparent (subtitle mode shows the desktop
// through it), so on Linux and Windows nothing outlines it, and a dark window on a dark desktop has no visible edge.
// This draws one: a black line with a faint light one inside it (a grey line in the light theme), like the system's
// own windows. Not on macOS, whose system draws the window a shadow; not in subtitle mode; and not while the window
// is maximized or full screen, where its edges are the screen's. The main process says which (electron/window-state.js).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { isElectron, isMacOS } from '../../utils/environment';
import { useSubtitleModeActive } from '../../stores/settingsStore';
import './WindowEdge.scss';

interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

export function WindowEdge() {
  const subtitle = useSubtitleModeActive();
  const drawn = isElectron() && !isMacOS();
  const [state, setState] = useState<WindowState | null>(null);

  useEffect(() => {
    const api = window.electron;
    if (!drawn || typeof api?.invoke !== 'function' || typeof api.receive !== 'function') return undefined;
    let live = true;
    const onState = (next: WindowState) => { if (live) setState(next); };
    api.receive('window:state', onState);
    // A change pushed while the answer was on its way is newer than the answer.
    api.invoke('window:get-state').then(
      (now: WindowState | null) => { if (live && now) setState((pushed) => pushed ?? now); },
      () => {},
    );
    return () => {
      live = false;
      api.removeListener('window:state', onState);
    };
  }, [drawn]);

  if (!drawn || subtitle || !state || state.maximized || state.fullScreen) return null;
  // On the body, like the overlays the tour and the dialogs portal there, so it is drawn above all of them.
  return createPortal(<div className="window-edge" aria-hidden="true" />, document.body);
}

export default WindowEdge;

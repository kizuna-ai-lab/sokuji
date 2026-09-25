/**
 * The overlay's end of the extension wire (plan 1e-4). The port opens and
 * its receiver listens in one synchronous step, so nothing the side panel
 * sends first can arrive before it. When the side panel goes — closed,
 * reloaded, the extension reloaded, or never listening (Chrome disconnects a
 * port no page accepts) — the receiver keeps its last model, which would
 * freeze a running bar on the meeting page (roadmap 1d-2 → 1e): so the
 * receiver is disposed and the content script asked to unmount the overlay.
 */
import { describeCause, reportError } from '../diagnostics/report';
import { chromePortWire, receiveSubtitles, SUBTITLE_PORT, type ChromePortLike, type OverlayReceiver } from './wire';

/** What the overlay asks of the content script when its side panel has gone, or the user exits (`extension/content/subtitle-overlay-content.js:61-65`). */
export const SIDEPANEL_GONE = { type: 'sokuji-subtitle:sidepanel-gone' } as const;

/** The meeting page's window, from the overlay's iframe: `window.parent`. */
export interface OverlayParent {
  postMessage(message: unknown, targetOrigin: string): void;
}

function tellGone(parent: OverlayParent): void {
  try {
    parent.postMessage(SIDEPANEL_GONE, '*');
  } catch {
    // The iframe may already be detached from the meeting page: nothing is left to unmount.
  }
}

export function connectOverlay(connect: (info: { name: string }) => ChromePortLike, parent: OverlayParent): OverlayReceiver | null {
  let port: ChromePortLike;
  try {
    port = connect({ name: SUBTITLE_PORT });
  } catch (error) {
    reportError('SubtitleOverlay', `The overlay could not open its port to the side panel: ${describeCause(error)}`, { cause: error });
    tellGone(parent);
    return null;
  }
  const wire = chromePortWire(port);
  const receiver = receiveSubtitles(wire);
  wire.onDisconnect(() => {
    receiver.dispose();
    tellGone(parent);
  });
  return {
    ...receiver,
    send(message) {
      receiver.send(message);
      // An exit also unmounts the overlay itself, whether or not a side panel
      // answers it. A side panel that went while another side panel in
      // subtitle mode lives leaves this port open — the other one heard it
      // connect and holds its end with no listener — so no disconnect comes,
      // and an exit sent only down the port would reach no one. A live side
      // panel's own `subtitle:exit` then finds the host already gone.
      if (message.type === 'subtitle:user-exit') tellGone(parent);
    },
  };
}

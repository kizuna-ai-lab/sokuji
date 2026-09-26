import { useEffect, useRef, useState } from 'react';
import { messagePortWire, receiveSubtitles, type OverlayReceiver } from '../../lib/subtitle/wire';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { ConnectedOverlay } from '../Subtitle/ConnectedOverlay';

/**
 * Development builds only (`?preview=overlay`): the extension overlay's
 * stand-in, drawn inside the preview's iframe. Its parent hands it one end of
 * a `MessageChannel` — the wire the extension carries over `chrome.runtime`
 * (plan 1e-4) — and it draws what arrives.
 */
export function OverlayPreview() {
  const [receiver, setReceiver] = useState<OverlayReceiver | null>(null);
  // The current receiver, alongside the state: disposing the old one and
  // building the new one happens here, in the message handler — not inside
  // the `setReceiver` updater, which StrictMode may invoke twice.
  const receiverRef = useRef<OverlayReceiver | null>(null);
  useEffect(() => {
    // `&compact=1`: this page has its own subtitle store, like the real overlay's iframe.
    if (new URLSearchParams(window.location.search).get('compact') === '1') void useSubtitleStore.getState().setCompactMode(true);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'sokuji-subtitle:connect' || !event.ports[0]) return;
      receiverRef.current?.dispose();
      const next = receiveSubtitles(messagePortWire(event.ports[0]));
      receiverRef.current = next;
      setReceiver(next);
    };
    window.addEventListener('message', onMessage);
    // Announces readiness once the listener above is actually live, rather
    // than making the parent guess how long that takes (this page mounts
    // asynchronously after `load` fires, behind an awaited style import).
    window.parent.postMessage({ type: 'sokuji-subtitle:ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  if (!receiver) return null;
  return <ConnectedOverlay receiver={receiver} />;
}

import { useEffect, useMemo, useState } from 'react';
import { messagePortWire, receiveSubtitles, type OverlayModel } from '../../lib/subtitle/wire';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useReadable } from '../Conversation/useReadable';
import { SubtitleView, type SubtitleControls } from '../Subtitle/SubtitleView';

type Receiver = ReturnType<typeof receiveSubtitles>;

/**
 * Development builds only (`?preview=overlay`): the extension overlay's
 * stand-in, drawn inside the preview's iframe. Its parent hands it one end of
 * a `MessageChannel` — the wire the extension carries over `chrome.runtime`
 * (plan 1e) — and it draws what arrives.
 */
export function OverlayPreview() {
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  useEffect(() => {
    // `&compact=1`: this page has its own subtitle store, like the real overlay's iframe.
    if (new URLSearchParams(window.location.search).get('compact') === '1') void useSubtitleStore.getState().setCompactMode(true);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'sokuji-subtitle:connect' || !event.ports[0]) return;
      setReceiver((previous) => {
        previous?.dispose();
        return receiveSubtitles(messagePortWire(event.ports[0]));
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  if (!receiver) return null;
  return <ConnectedOverlay receiver={receiver} />;
}

function ConnectedOverlay({ receiver }: { receiver: Receiver }) {
  const model: OverlayModel = useReadable(receiver);
  const controls: SubtitleControls = useMemo(() => ({
    exit: () => receiver.send({ type: 'subtitle:user-exit' }),
    clear: () => receiver.send({ type: 'subtitle:request-clear' }),
    press: () => receiver.send({ type: 'subtitle:turn-press' }),
    release: () => receiver.send({ type: 'subtitle:turn-release' }),
  }), [receiver]);
  return <SubtitleView surface="extension-overlay" model={model} controls={controls} />;
}

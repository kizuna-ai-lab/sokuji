import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useAnalytics } from '../../lib/analytics';
import { getAppAudio, type AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import { useAuth } from '../../lib/auth/hooks';
import { realClock } from '../../lib/contract/clock';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import type { AuthContext } from '../../lib/provider/types';
import { persistIfUnchanged, readShapeFromStores } from '../../lib/session/appShape';
import type { AnalyticsPort, PlaybackPort } from '../../lib/session/ports';
import { createRunner, type Runner } from '../../lib/session/runner';
import { createFakeSource } from '../../providers/fake/source';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { getEnvironment } from '../../utils/environment';
import { ProviderPanel } from '../providers/ProviderPanel';
import { SessionControls } from './SessionControls';
import '../Settings/Settings.scss';
import './SpinePreview.scss';

let previewRunner: Runner | null = null;
const bridge: { auth: AuthContext; track: AnalyticsPort['track']; playback: Playback | null } = {
  auth: { signedIn: false, getToken: async () => null },
  track: () => {},
  playback: null,
};

/**
 * Forwards to the page's playback once it has loaded, so the runner can be
 * created synchronously; audio before then is dropped (autostart waits for it).
 */
const playbackBridge: PlaybackPort = {
  audio: (leg, ref, pcm) => bridge.playback?.audio(leg, ref, pcm),
  held: (held) => bridge.playback?.held(held),
  clear: () => bridge.playback?.clear(),
};

/** One runner per page: the preview's stand-in for the app's, on the fake source until plan 1c-3 supplies real capture. */
function getPreviewRunner(): Runner {
  previewRunner ??= createRunner({
    clock: realClock,
    platform: getEnvironment(),
    readShape: () => readShapeFromStores(bridge.auth),
    ensureReady: (p, auth) => useProviderStore.getState().refreshReadiness(p, auth),
    persistIfUnchanged,
    openSource: async () => createFakeSource(realClock),
    playback: playbackBridge,
    analytics: { track: (event, properties) => bridge.track(event, properties) },
    newSessionId: () => crypto.randomUUID(),
  });
  return previewRunner;
}

/**
 * Development builds only: the new provider layer and a live fake session on
 * a page of their own (plans 1b–1d), heard through the new playback. Open the
 * dev server at `/?preview=spine`; add `&autostart=1` to start a session on
 * load, for headless rendering.
 */
export function SpinePreview() {
  const { isSignedIn, getToken } = useAuth();
  const { trackEvent } = useAnalytics();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  bridge.auth = auth;
  bridge.track = trackEvent as AnalyticsPort['track'];
  const providers = useMemo(() => presentProviders(), []);
  const runner = getPreviewRunner();
  const phase = useStore(runner.state, (s) => s.phase);
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const entry = useProviderStore((s) => (s.selected ? s.entries[s.selected] : undefined));
  const [audio, setAudio] = useState<AppAudio | null>(null);
  const autostarted = useRef(false);

  useEffect(() => {
    void useTurnModeStore.getState().load();
    void useRoutingStore.getState().load();
    let live = true;
    getAppAudio().then(
      (loaded) => {
        bridge.playback = loaded.playback;
        if (live) setAudio(loaded);
      },
      (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
    );
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (autostarted.current || !entry || !audio || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    void runner.start();
  }, [entry, audio, runner]);

  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} disabled={phase !== 'idle'} />
        <SessionControls runner={runner} turnMode={turnMode} audio={audio} />
      </div>
    </div>
  );
}

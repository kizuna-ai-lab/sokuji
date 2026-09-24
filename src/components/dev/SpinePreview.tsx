import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useAnalytics } from '../../lib/analytics';
import { getAppAudio, type AppAudio } from '../../lib/audio/appAudio';
import { createAppCapture } from '../../lib/audio/appCapture';
import type { Playback } from '../../lib/audio/playback';
import { useAuth } from '../../lib/auth/hooks';
import { realClock } from '../../lib/contract/clock';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import type { AuthContext } from '../../lib/provider/types';
import { persistIfUnchanged, readShapeFromStores } from '../../lib/session/appShape';
import type { AnalyticsPort, PlaybackPort } from '../../lib/session/ports';
import { createRunner, type Runner } from '../../lib/session/runner';
import type { OpenSource } from '../../lib/session/source';
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
const bridge: { auth: AuthContext; track: AnalyticsPort['track']; playback: Playback | null; openSource: OpenSource } = {
  auth: { signedIn: false, getToken: async () => null },
  track: () => {},
  playback: null,
  openSource: async () => createFakeSource(realClock),
};

/** What the page's capture delivered, for the probe (`&capture=device`). */
const captured = { chunks: 0, peak: 0 };

/** Counts every chunk a source delivers, and the loudest sample. */
function counting(open: OpenSource): OpenSource {
  return async (leg, signal) => {
    const source = await open(leg, signal);
    source.onPcm((pcm) => {
      captured.chunks += 1;
      for (let i = 0; i < pcm.length; i++) captured.peak = Math.max(captured.peak, Math.abs(pcm[i]) / 32768);
    });
    return source;
  };
}

/**
 * Forwards to the page's playback once it has loaded, so the runner can be
 * created synchronously; audio before then is dropped (autostart waits for it).
 */
const playbackBridge: PlaybackPort = {
  audio: (leg, ref, pcm) => bridge.playback?.audio(leg, ref, pcm),
  held: (held) => bridge.playback?.held(held),
  clear: () => bridge.playback?.clear(),
};

/** One runner per page: the preview's stand-in for the app's, on the fake source unless the page asks for `&capture=device`. */
function getPreviewRunner(): Runner {
  previewRunner ??= createRunner({
    clock: realClock,
    platform: getEnvironment(),
    readShape: () => readShapeFromStores(bridge.auth),
    ensureReady: (p, auth) => useProviderStore.getState().refreshReadiness(p, auth),
    persistIfUnchanged,
    openSource: (leg, signal) => bridge.openSource(leg, signal),
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
 * load, for headless rendering, and `&capture=device` to run the session on
 * the page's real capture (the microphone for the speaker leg) instead of the
 * fake source.
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
  const deviceCapture = useMemo(() => new URLSearchParams(window.location.search).get('capture') === 'device', []);

  useEffect(() => {
    void useTurnModeStore.getState().load();
    void useRoutingStore.getState().load();
    let live = true;
    getAppAudio().then(
      (loaded) => {
        bridge.playback = loaded.playback;
        if (deviceCapture) bridge.openSource = counting(createAppCapture(loaded.playback).openSource);
        if (live) setAudio(loaded);
      },
      (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
    );
    return () => { live = false; };
  }, [deviceCapture]);
  useEffect(() => {
    if (autostarted.current || !entry || !audio || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    void runner.start();
  }, [entry, audio, runner]);

  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} disabled={phase !== 'idle'} />
        <SessionControls
          runner={runner}
          turnMode={turnMode}
          audio={audio}
          capture={deviceCapture ? () => ({ ...captured }) : undefined}
        />
      </div>
    </div>
  );
}

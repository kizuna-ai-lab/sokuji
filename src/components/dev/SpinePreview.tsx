import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import { useAnalytics } from '../../lib/analytics';
import { getAppAudio, type AppAudio } from '../../lib/audio/appAudio';
import { createAppCapture } from '../../lib/audio/appCapture';
import type { Playback } from '../../lib/audio/playback';
import { useAuth } from '../../lib/auth/hooks';
import { realClock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import type { AuthContext } from '../../lib/provider/types';
import { persistIfUnchanged, readShapeFromStores } from '../../lib/session/appShape';
import type { AnalyticsPort, PlaybackPort } from '../../lib/session/ports';
import { createRunner, type Runner } from '../../lib/session/runner';
import type { OpenSource } from '../../lib/session/source';
import { createConversationView, type ConversationViewState, type Readable } from '../../lib/view/conversationView';
import { appProjectionSettings } from '../../lib/view/appViewSettings';
import { displayItems } from '../../lib/view/filter';
import { createKaraoke, type KaraokeState } from '../../lib/view/karaoke';
import { FAKE_SCRIPT_NAMES } from '../../providers/fake/scripts';
import { createFakeSource } from '../../providers/fake/source';
import { presentProviders } from '../../providers/registry';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { getEnvironment } from '../../utils/environment';
import { ConversationList } from '../Conversation/ConversationList';
import { useReadable } from '../Conversation/useReadable';
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

let previewView: (Readable<ConversationViewState> & { dispose(): void }) | null = null;

/** One view per page, over the preview runner's conversation and the stored cut. */
function getPreviewView(runner: Runner) {
  previewView ??= createConversationView(runner.conversation, appProjectionSettings(), realClock);
  return previewView;
}

// Hoisted so `get()` returns the same object every call — `useSyncExternalStore` requires it.
const IDLE: KaraokeState = { lit: new Map(), replaying: null };
const NO_KARAOKE: Readable<KaraokeState> = { get: () => IDLE, subscribe: () => () => {} };

/** The new conversation list over the preview's view (plan 1d-1). Its copy is not localized. */
function PreviewConversation({ view, karaoke, playback }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  playback: Playback | null;
}) {
  const { legs, entries } = useReadable(view);
  const { lit, replaying } = useReadable(karaoke);
  const speaker = useSettingsStore((s) => s.speakerDisplayMode);
  const participant = useSettingsStore((s) => s.participantDisplayMode);
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const display = useConversationDisplayStore();
  const items = useMemo(() => displayItems(entries, { speaker, participant }), [entries, speaker, participant]);
  const segments = useMemo(() => new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const))), [legs]);
  const replayLegs = useMemo(
    () => new Set<LegName>(keepReplayAudio ? (participantSpeech ? ['speaker', 'participant'] : ['speaker']) : []),
    [keepReplayAudio, participantSpeech],
  );
  return (
    <div
      className="spine-conversation"
      style={{
        '--conversation-bg-color': display.bgColor,
        '--conversation-source-color': display.sourceTextColor,
        '--conversation-translation-color': display.translationTextColor,
      } as CSSProperties}
    >
      <ConversationList
        items={items}
        lit={lit}
        replaying={replaying}
        replayLegs={replayLegs}
        // Retention may have dropped a segment's pcm: then there is nothing to replay.
        canReplay={(id) => segments.get(id)?.speech.some((s) => s.pcm.length > 0) ?? false}
        onReplay={(leg, id) => {
          const segment = segments.get(id);
          if (playback && segment) playback.replay(leg, segment);
        }}
        compact={display.compactMode}
        fontSize={display.fontSize}
        empty={<p>Start a session to see the conversation.</p>}
      />
    </div>
  );
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
  const [karaoke, setKaraoke] = useState<(Readable<KaraokeState> & { dispose(): void }) | null>(null);
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
        if (live) {
          setAudio(loaded);
          setKaraoke(createKaraoke(loaded.playback.queues, getPreviewView(runner), realClock));
        }
      },
      (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
    );
    return () => { live = false; };
  }, [deviceCapture, runner]);
  useEffect(() => {
    if (autostarted.current || !entry || !audio || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    const params = new URLSearchParams(window.location.search);
    // `&script=<name>`: which script the fake plays (the headless checks pick theirs).
    const script = params.get('script');
    const fake = providers.find((p) => p.id === 'fake');
    if (fake && script && (FAKE_SCRIPT_NAMES as readonly string[]).includes(script)) {
      useProviderStore.getState().updateSettings(fake, { script });
    }
    // `&cut=off|pause|sentences:<n>`: the stored segmentation choice.
    const cut = params.get('cut');
    if (cut) {
      const [mode, size] = cut.split(':');
      if (mode === 'off' || mode === 'pause' || mode === 'sentences') void useSettingsStore.getState().setSegmentationMode(mode);
      if (mode === 'sentences' && size) void useSettingsStore.getState().setSentenceSegmentationChunkSentences(Number(size));
    }
    void runner.start();
  }, [entry, audio, runner, providers]);

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
        <PreviewConversation view={getPreviewView(runner)} karaoke={karaoke ?? NO_KARAOKE} playback={audio?.playback ?? null} />
      </div>
    </div>
  );
}

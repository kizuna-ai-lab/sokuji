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
import { autoSaveConversation } from '../../lib/export/appAutoSave';
import type { AuthContext } from '../../lib/provider/types';
import { appReplayAudio, ensureReadyFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from '../../lib/session/appShape';
import type { AnalyticsPort, PlaybackPort } from '../../lib/session/ports';
import { createRunner, type Runner } from '../../lib/session/runner';
import type { OpenSource } from '../../lib/session/source';
import { appSubtitleSession } from '../../lib/subtitle/appSession';
import type { SubtitleSession } from '../../lib/subtitle/session';
import { messagePortWire, publishSubtitles } from '../../lib/subtitle/wire';
import type { AutoSaveNotifier } from '../../lib/transcript/autoSave';
import type { Entry } from '../../lib/projection/types';
import { createConversationView, type ConversationViewState, type Readable } from '../../lib/view/conversationView';
import { appProjectionSettings } from '../../lib/view/appViewSettings';
import { displayItems } from '../../lib/view/filter';
import { createKaraoke, type KaraokeState } from '../../lib/view/karaoke';
import { lastEndItem } from '../../lib/view/lastEnd';
import { FAKE_SCRIPT_NAMES } from '../../providers/fake/scripts';
import { createFakeSource } from '../../providers/fake/source';
import { presentProviders } from '../../providers/registry';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { getEnvironment } from '../../utils/environment';
import { ConversationList } from '../Conversation/ConversationList';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import { ExportMenuButton } from '../MainPanel/ExportButton';
import { ProviderPanel } from '../providers/ProviderPanel';
import { SubtitleView, type SubtitleControls, type SubtitleModel } from '../Subtitle/SubtitleView';
import { useToast } from '../Toast';
import { SessionControls } from './SessionControls';
import '../Settings/Settings.scss';
import './SpinePreview.scss';

/** `&turn=push-to-talk|push-to-translate`: this page's session uses a manual turn. */
function manualTurnFromUrl(): boolean {
  const turn = new URLSearchParams(window.location.search).get('turn');
  return turn === 'push-to-talk' || turn === 'push-to-translate';
}

let previewRunner: Runner | null = null;
const bridge: { auth: AuthContext; track: AnalyticsPort['track']; playback: Playback | null; openSource: OpenSource; notify: AutoSaveNotifier } = {
  auth: { signedIn: false, getToken: async () => null },
  track: () => {},
  playback: null,
  // Under a manual turn, a held press needs voice to end (not cancel) the
  // turn (`MIN_VOICED_MS`) — the fake source stays voiced throughout.
  openSource: async () => createFakeSource(realClock, { voiced: manualTurnFromUrl() }),
  notify: { showToast: () => {} },
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
  live: (on) => bridge.playback?.live(on),
};

/** One runner per page: the preview's stand-in for the app's, on the fake source unless the page asks for `&capture=device`. */
function getPreviewRunner(): Runner {
  previewRunner ??= createRunner({
    clock: realClock,
    platform: getEnvironment(),
    // `&refuse=1`: no shape, so every start is refused — the idle line's check.
    readShape: () => (new URLSearchParams(window.location.search).get('refuse') === '1' ? null : readShapeFromStores(bridge.auth)),
    ensureReady: ensureReadyFromStores,
    persistIfUnchanged,
    replayAudio: appReplayAudio,
    openSource: (leg, signal) => bridge.openSource(leg, signal),
    playback: playbackBridge,
    analytics: { track: (event, properties) => bridge.track(event, properties) },
    newSessionId: () => crypto.randomUUID(),
    onRunEnded: async (legs) => { await autoSaveConversation(legs, getPreviewRunner().conversation.info, bridge.notify); },
  });
  return previewRunner;
}

let previewView: (Readable<ConversationViewState> & { dispose(): void }) | null = null;

/** One view per page, over the preview runner's conversation and the stored cut. */
function getPreviewView(runner: Runner) {
  previewView ??= createConversationView(runner.conversation, appProjectionSettings(), realClock);
  return previewView;
}

let previewSession: (Readable<SubtitleSession> & { dispose(): void }) | null = null;

/** One subtitle session per page, beside `previewView` (plan 1d-2). */
function getPreviewSession(runner: Runner) {
  previewSession ??= appSubtitleSession(runner, getPreviewView(runner));
  return previewSession;
}

// Hoisted so `get()` returns the same object every call — `useSyncExternalStore` requires it.
const IDLE: KaraokeState = { lit: new Map(), replaying: null };
const NO_KARAOKE: Readable<KaraokeState> = { get: () => IDLE, subscribe: () => () => {} };

/** The new conversation list over the preview's view (plan 1d-1). Its copy is not localized. */
function PreviewConversation({ view, karaoke, playback, runner }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  playback: Playback | null;
  runner: Runner;
}) {
  const viewState = useReadable(view);
  const { legs, entries } = viewState;
  const { lit, replaying } = useReadable(karaoke);
  const speaker = useSettingsStore((s) => s.speakerDisplayMode);
  const participant = useSettingsStore((s) => s.participantDisplayMode);
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const display = useConversationDisplayStore();
  const runState = useStore(runner.state);
  const exporter = useConversationExporter(viewState);
  const items = useMemo(() => {
    const drawn = displayItems(entries, { speaker, participant });
    const last = lastEndItem(runState);
    return last ? [...drawn, last] : drawn;
  }, [entries, speaker, participant, runState]);
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
      <div className="conversation-toolbar">
        <ExportMenuButton exporter={exporter} speakerMode={speaker} participantMode={participant} />
      </div>
      <ConversationList
        items={items}
        lit={lit}
        replaying={replaying}
        replayLegs={replayLegs}
        // Retention may have dropped a segment's pcm: then there is nothing
        // to replay. An open segment's speech is still streaming, so it is
        // not final yet either (today's `canReplay` also requires it).
        canReplay={(id) => {
          const segment = segments.get(id);
          return !!segment?.final && segment.speech.some((s) => s.pcm.length > 0);
        }}
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

/** The Electron-style subtitle surface, on the page itself (`&subtitle=1`, plan 1d-2). */
function PreviewSubtitle({ view, karaoke, session, controls }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  session: Readable<SubtitleSession>;
  controls: SubtitleControls;
}) {
  const viewState = useReadable(view);
  const { entries } = viewState;
  const { lit } = useReadable(karaoke);
  const sessionState = useReadable(session);
  const exporter = useConversationExporter(viewState);
  const model: SubtitleModel = { entries, lit, session: sessionState };
  return (
    <div className="spine-subtitle">
      <SubtitleView surface="electron" model={model} controls={controls} exporter={exporter} />
    </div>
  );
}

/**
 * The extension overlay's stand-in, in an iframe fed over a real
 * `MessageChannel` (`&overlay=1`, plan 1d-2): the overlay announces itself
 * ready (once its own listener is live — `OverlayPreview`), this page hands
 * it one end of a fresh `MessageChannel` on each such announcement, and
 * `publishSubtitles` starts sending down the other. Reconnects on every
 * reload (a reload re-mounts the overlay, which announces itself again), and
 * stops on unmount. Nothing here is timed: there is no `load`/mount race to
 * guess at, since the overlay itself says when it is listening.
 *
 * The port's own lifecycle is kept in a separate effect from what gets
 * published on it: `karaoke` starts as the hoisted empty placeholder and is
 * swapped for a real one once the page's playback loads (a page-level,
 * one-time identity change) — re-running the connection effect over that
 * would tear down and reopen the port for no reason. Restarting only the
 * publisher leaves the port, and anything in flight on it, alone.
 */
function PreviewOverlayFrame({ view, karaoke, session, controls, compact }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  session: Readable<SubtitleSession>;
  controls: SubtitleControls;
  compact: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [port, setPort] = useState<MessagePort | null>(null);

  useEffect(() => {
    let current: MessagePort | null = null;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      // A ready before the iframe's ref is set cannot happen (its document
      // loads only after the element exists), but the guard costs nothing.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'sokuji-subtitle:ready') return;
      current?.close();
      const channel = new MessageChannel();
      current = channel.port1;
      iframeRef.current?.contentWindow?.postMessage({ type: 'sokuji-subtitle:connect' }, window.location.origin, [channel.port2]);
      setPort(channel.port1);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      current?.close();
      setPort(null);
    };
  }, []);

  useEffect(() => {
    if (!port) return;
    const entries: Readable<readonly Entry[]> = { get: () => view.get().entries, subscribe: view.subscribe };
    return publishSubtitles(messagePortWire(port), { entries, session, karaoke }, {
      clear: controls.clear,
      exit: controls.exit,
      press: controls.press,
      release: controls.release,
    });
  }, [port, view, karaoke, session, controls]);

  return (
    <iframe
      ref={iframeRef}
      className="spine-overlay-frame"
      src={`?preview=overlay${compact ? '&compact=1' : ''}`}
      title="Overlay preview"
    />
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
  const { showToast } = useToast();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  bridge.auth = auth;
  bridge.track = trackEvent as AnalyticsPort['track'];
  bridge.notify = { showToast };
  const providers = useMemo(() => presentProviders(), []);
  // This page's probes run on the fake unless a parameter asks for another
  // provider (plan 1e-2 ruling 10). ProviderPanel is a child, so its own
  // mount effect — defaulting to `providers[0]`, LocalInference now that
  // it's registered first — runs before this one; covering the
  // `localInference` case too (not just "nothing selected yet") undoes that.
  useEffect(() => {
    const selected = useProviderStore.getState().selected;
    if (selected === null || selected === 'localInference') {
      useProviderStore.getState().select('fake');
    }
  }, [providers]);
  const runner = getPreviewRunner();
  const phase = useStore(runner.state, (s) => s.phase);
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const entry = useProviderStore((s) => (s.selected ? s.entries[s.selected] : undefined));
  const [audio, setAudio] = useState<AppAudio | null>(null);
  const [karaoke, setKaraoke] = useState<(Readable<KaraokeState> & { dispose(): void }) | null>(null);
  const autostarted = useRef(false);
  const deviceCapture = useMemo(() => new URLSearchParams(window.location.search).get('capture') === 'device', []);
  // `&subtitle=1`, `&overlay=1`, `&compact=1`: which subtitle surfaces this page draws (plan 1d-2).
  const previewParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { subtitle: params.get('subtitle') === '1', overlay: params.get('overlay') === '1', compact: params.get('compact') === '1' };
  }, []);
  const session = getPreviewSession(runner);
  const subtitleControls: SubtitleControls = useMemo(() => ({
    start: () => void runner.start(),
    stop: () => void runner.stop(),
    press: () => runner.press(),
    release: () => runner.release(),
    clear: () => runner.clear(),
    // The preview has no subtitle mode to leave.
    exit: () => {},
  }), [runner]);

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
    // `&turn=push-to-talk|push-to-translate`: the stored turn mode this session runs under.
    const turn = params.get('turn');
    if (turn === 'push-to-talk' || turn === 'push-to-translate') useTurnModeStore.getState().setTurnMode(turn);
    // `&compact=1`: the subtitle surfaces' bands (not the panel's own compact mode).
    if (params.get('compact') === '1') void useSubtitleStore.getState().setCompactMode(true);
    // `&autosave=1`: the stored auto-save switch, on — the run's end saves the conversation.
    if (params.get('autosave') === '1') void useSettingsStore.getState().setAutoSaveOnStop(true);
    void runner.start();
  }, [entry, audio, runner, providers]);

  // The panel's readiness is about the legs a start would open: the audio mode's.
  useEffect(() => watchLegsFromStores(), []);

  // `pagehide` (a reload, the tab closing): close every leg and capture now; nothing is saved, as in the app.
  useEffect(() => {
    const onPageHide = () => runner.abandon();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [runner]);

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
        <PreviewConversation view={getPreviewView(runner)} karaoke={karaoke ?? NO_KARAOKE} playback={audio?.playback ?? null} runner={runner} />
        {previewParams.subtitle && (
          <PreviewSubtitle
            view={getPreviewView(runner)}
            karaoke={karaoke ?? NO_KARAOKE}
            session={session}
            controls={subtitleControls}
          />
        )}
        {previewParams.overlay && (
          <PreviewOverlayFrame
            view={getPreviewView(runner)}
            karaoke={karaoke ?? NO_KARAOKE}
            session={session}
            controls={subtitleControls}
            compact={previewParams.compact}
          />
        )}
      </div>
    </div>
  );
}

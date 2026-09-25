import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Playback } from '../../lib/audio/playback';
import { realClock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, emptyDirection, type DirectionSelection } from '../../lib/local-inference/selection/types';
import type { FramePort } from '../../lib/session/ports';
import type { OpenSource } from '../../lib/session/source';
import type { SubtitleSession } from '../../lib/subtitle/session';
import { messagePortWire, publishSubtitles } from '../../lib/subtitle/wire';
import type { Entry } from '../../lib/projection/types';
import type { ConversationViewState, Readable } from '../../lib/view/conversationView';
import { displayItems } from '../../lib/view/filter';
import type { KaraokeState } from '../../lib/view/karaoke';
import { lastEndItem } from '../../lib/view/lastEnd';
import { FAKE_SCRIPT_NAMES } from '../../providers/fake/scripts';
import { createFakeSource } from '../../providers/fake/source';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { ConversationList } from '../Conversation/ConversationList';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import { ExportMenuButton } from '../MainPanel/ExportButton';
import SessionPanel from '../MainPanel/SessionPanel';
import { ProviderPanel } from '../providers/ProviderPanel';
import { SubtitleTakeover } from '../Subtitle/SubtitleTakeover';
import type { SubtitleControls } from '../Subtitle/SubtitleView';
import { configureAppSession, getAppSession, type LoadedAudio } from '../../app/session';
import { useAppSessionBridges, useRunPhase, useRunState } from '../../app/useAppSession';
import { loadSessionStores } from '../../app/loadStores';
import { SessionControls } from './SessionControls';
import '../Settings/Settings.scss';
import './SpinePreview.scss';

/** `&turn=push-to-talk|push-to-translate`: this page's session uses a manual turn. */
function manualTurnFromUrl(): boolean {
  const turn = new URLSearchParams(window.location.search).get('turn');
  return turn === 'push-to-talk' || turn === 'push-to-translate';
}

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

/** Seal frames the runner hands the preview, by reason (plan 1e-2b ruling 11):
 *  `local.segmentation.seal` only, mutated directly the way `captured` above
 *  is for the capture-device probe — `useSealProbe` below polls it into the
 *  DOM for `--sentences` (the seal count, not the rows, is what proves the
 *  cut made them). It counts for the page's lifetime, not per run. */
const sealCounts: Record<string, number> = {};

const framesBridge: FramePort = {
  frame: (_leg, frame) => {
    if (frame.type !== 'local.segmentation.seal') return;
    const payload = frame.payload as { reason?: unknown } | undefined;
    const reason = typeof payload?.reason === 'string' ? payload.reason : 'unknown';
    sealCounts[reason] = (sealCounts[reason] ?? 0) + 1;
  },
};

/**
 * Live view of `sealCounts`, for the probe's `--sentences` check: `FramePort`
 * has no subscribe of its own, so this polls it into the DOM the way
 * `usePlaybackProbe` (SessionControls.tsx) reads `captured` for
 * `&capture=device`. `reason:count` pairs, `-` when nothing has sealed yet.
 */
function useSealProbe(): string {
  const [text, setText] = useState('-');
  useEffect(() => {
    const id = setInterval(() => {
      const next = Object.entries(sealCounts).map(([reason, count]) => `${reason}:${count}`).join(',') || '-';
      setText((prev) => (prev === next ? prev : next));
    }, 200);
    return () => clearInterval(id);
  }, []);
  return text;
}

/** A URL parameter of this page, read when asked — the tests change the URL between renders. */
const param = (name: string) => new URLSearchParams(window.location.search).get(name);

// `&ui=advanced`: the panel's advanced footer, for its probe — set in memory
// before the first render and never persisted, so the running app's stored
// UI mode is untouched.
if (param('ui') === 'advanced') useSettingsStore.setState({ uiMode: 'advanced' });

/** `&capture=device`: the session runs on the app's own capture (the microphone for the speaker leg) instead of the fake source. */
const deviceCapture = () => param('capture') === 'device';

// The page's session is the app's (plan 1e-3a): the same runner, view,
// karaoke, subtitle session, punctuator, frames, analytics and auto-save the
// app runs, with this page's stand-ins, each read per call as before.
configureAppSession({
  capture: (app) => (leg, signal) => (deviceCapture()
    ? counting(app)(leg, signal)
    // Under a manual turn, a held press needs voice to end (not cancel) the
    // turn (`MIN_VOICED_MS`) — the fake source stays voiced throughout.
    : Promise.resolve(createFakeSource(realClock, { voiced: manualTurnFromUrl() }))),
  // The fake source needs no microphone; the app's capture does (1e-3 ruling 5).
  microphoneRequired: deviceCapture,
  // `&refuse=1`: no shape, so every start is refused — the idle line's check.
  refuse: () => param('refuse') === '1',
  observeFrames: framesBridge,
});

/** The new conversation list over the preview's view (plan 1d-1). Its copy is not localized. */
function PreviewConversation({ view, karaoke, playback }: {
  view: Readable<ConversationViewState>;
  karaoke: Readable<KaraokeState>;
  playback: Playback | null;
}) {
  const viewState = useReadable(view);
  const { legs, entries } = viewState;
  const { lit, replaying } = useReadable(karaoke);
  const speaker = useSettingsStore((s) => s.speakerDisplayMode);
  const participant = useSettingsStore((s) => s.participantDisplayMode);
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const display = useConversationDisplayStore();
  const runState = useRunState();
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

/**
 * The extension overlay's stand-in, in an iframe fed over a real
 * `MessageChannel` (`&overlay=1`, plan 1d-2): the overlay announces itself
 * ready (once its own listener is live — `OverlayPreview`), this page hands
 * it one end of a fresh `MessageChannel` on each such announcement, and
 * `publishSubtitles` starts sending down the other. Reconnects on every
 * reload (a reload re-mounts the overlay, which announces itself again), and
 * stops on unmount. Nothing here is timed: there is no `load`/mount race to
 * guess at, since the overlay itself says when it is listening.
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
 * a page of their own (plans 1b–1d), heard through the new playback. This
 * page runs the app's own session (`src/app/session.ts`, plan 1e-3a) with two
 * stand-ins: the fake source unless `&capture=device` asks for the page's
 * real capture (the microphone for the speaker leg), and `&refuse=1` to
 * refuse every start with no shape. Open the dev server at `/?preview=spine`;
 * add `&autostart=1` to start a session on load, for headless rendering.
 * `&punctuation=1` downloads the punctuation pack before autostart, so the
 * session's punctuator is on disk for a `sentences` cut — a dry run of plan
 * 1e-3's own wiring.
 */
export function SpinePreview() {
  const auth = useAppSessionBridges();
  const providers = useMemo(() => presentProviders(), []);
  // This page's probes run on the fake unless a parameter asks for another
  // provider (plan 1e-2 ruling 10, `&provider=<id>`). ProviderPanel is a
  // child, so its own mount effect — defaulting to `providers[0]`,
  // LocalInference now that it's registered first — runs before this one;
  // covering the `localInference` case too (not just "nothing selected
  // yet") undoes that default, and `&provider=` overrides it the other way.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('provider');
    // Both calls below are loads: the preview never writes the app's stored provider.
    if (wanted && providers.some((p) => p.id === wanted)) {
      useProviderStore.getState().select(wanted);
      return;
    }
    const selected = useProviderStore.getState().selected;
    if (selected === null || selected === 'localInference') {
      useProviderStore.getState().select('fake');
    }
  }, [providers]);
  const session = getAppSession();
  const { runner } = session;
  const phase = useRunPhase();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const entry = useProviderStore((s) => (s.selected ? s.entries[s.selected] : undefined));
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const autostarted = useRef(false);
  // `&subtitle=1`, `&overlay=1`, `&compact=1`: which subtitle surfaces this page draws (plan 1d-2);
  // `&panel=1`: the new main panel on the app's session (plan 1e-3b-1).
  const previewParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      subtitle: params.get('subtitle') === '1',
      overlay: params.get('overlay') === '1',
      compact: params.get('compact') === '1',
      panel: params.get('panel') === '1',
    };
  }, []);
  const subtitleControls: SubtitleControls = useMemo(() => ({
    start: () => void runner.start(),
    stop: () => void runner.stop(),
    press: () => runner.press(),
    release: () => runner.release(),
    clear: () => runner.clear(),
    // The preview has no subtitle mode to leave.
    exit: () => {},
  }), [runner]);

  const [storesLoaded, setStoresLoaded] = useState(false);
  // What a run reads, loaded the way the app loads it (Home.tsx): the turn
  // mode, the routing switches, the punctuation pack's phase — without which
  // the punctuator would see `unknown`, never `ready` — and the provider; and
  // the audio store's devices (`initializeAudioService`, fire-and-forget as
  // Home does it too) — without this no input device is ever selected, and
  // the advanced footer's start gate reads "Configure devices for this mode
  // to start.".
  useEffect(() => {
    void loadSessionStores().finally(() => setStoresLoaded(true));
    void useAudioStore.getState().initializeAudioService();
  }, []);
  // The page's wiring, as the app's will be (plan 1e-3b): pagehide → abandon,
  // the provider store's legs, a local provider checking itself.
  useEffect(() => session.attach(), [session]);
  useEffect(() => {
    let live = true;
    session.audio().then(
      (loaded) => { if (live) setAudio(loaded); },
      (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
    );
    return () => { live = false; };
  }, [session]);

  const [urlApplied, setUrlApplied] = useState(false);
  // The page's stored settings from the URL, applied once — with or without
  // `&autostart=1`, since the panel's probe starts by clicking (plan 1e-3b-1
  // Task 13). After the stores' load, so the load cannot overwrite them (the
  // turn mode's migration writes too), and once the selected provider's entry
  // is there (`&script=` is the fake's own setting).
  useEffect(() => {
    if (urlApplied || !storesLoaded || !entry) return;
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
    // &monitor=1: the speaker's translation reaches the real bus (the monitor is off by default), for the probe's tap on a bus.
    if (params.get('monitor') === '1') useAudioStore.getState().setMonitorMuted(false);
    setUrlApplied(true);
  }, [urlApplied, storesLoaded, entry, providers]);

  useEffect(() => {
    if (autostarted.current || !entry || !audio || !urlApplied || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    const params = new URLSearchParams(window.location.search);
    // `&models=<id>,<id>…` (LocalInference's live probe, task 9): download
    // each one not already downloaded, then `&pair=<source>:<target>`
    // through the provider store. A downloaded model alone is not enough to
    // make LocalInference actually use it: `byRank` ranks a `recommended`
    // candidate first regardless of download state, and the always-ready
    // cloud fallbacks (Bing Translator, Edge TTS) are both `recommended` —
    // so auto-resolution would translate over the network instead of
    // exercising the WASM model the probe just downloaded. Pinning each
    // downloaded model as the explicit pick for its own stage, on the
    // `&pair=` direction, is what makes the download meaningful.
    const modelsParam = params.get('models');
    const pairParam = params.get('pair');
    const ids = modelsParam ? modelsParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
    void (async () => {
      if (ids.length > 0) {
        // `ModelManagementSection` (this provider's own `Engine`) calls this
        // too on its own mount, racing this effect; `initialize()` is
        // idempotent (a no-op once `initialized`), and awaiting it here is
        // what lets "already downloaded" (IndexedDB, from a previous run
        // against the same profile directory) be trusted below instead of
        // re-downloading into a `modelStatuses` that just hasn't loaded yet.
        await useModelStore.getState().initialize();
        await Promise.all(ids.map(async (id) => {
          if (useModelStore.getState().modelStatuses[id] === 'downloaded') return;
          try {
            await useModelStore.getState().downloadModel(id);
          } catch (error) {
            reportError('SpinePreview', `The preview could not download "${id}": ${describeCause(error)}`, { cause: error });
          }
        }));
      }
      if (pairParam) {
        const [source, target] = pairParam.split(':');
        const localInference = providers.find((p) => p.id === 'localInference');
        // `setPair` throws on an unloaded entry — only reachable once
        // `ProviderPanel` has loaded it, i.e. `&provider=localInference` was
        // also given (the probe's own usage).
        const loaded = localInference && useProviderStore.getState().entries[localInference.id];
        if (source && target && localInference && loaded) {
          useProviderStore.getState().setPair(localInference, { source, target });
          if (ids.length > 0) {
            const liEntry = useProviderStore.getState().entries[localInference.id];
            const selections = (liEntry?.settings as { selections?: Record<string, DirectionSelection> } | undefined)?.selections;
            if (selections) {
              const dir = directionKey(source, target);
              const patch: DirectionSelection = { ...(selections[dir] ?? emptyDirection()) };
              for (const id of ids) {
                if (useModelStore.getState().modelStatuses[id] !== 'downloaded') continue;
                const manifestType = getManifestEntry(id)?.type;
                if (manifestType === 'asr' || manifestType === 'asr-stream') patch.asr = { modelId: id };
                else if (manifestType === 'translation') patch.translation = { modelId: id };
                else if (manifestType === 'tts') patch.tts = { modelId: id };
              }
              useProviderStore.getState().updateSettings(localInference, { selections: { ...selections, [dir]: patch } });
            }
          }
        }
      }
      // `&punctuation=1`: download the punctuation pack before autostart
      // (plan 1e-2b ruling 12), beside the `&models=` downloads above — a
      // `sentences` cut with no punctuator on disk would just fall back to
      // cutting by length, and this page's whole point is a live check of the
      // real sentence cut. `refresh()` is called again here (the mount
      // effect's own call is fire-and-forget) so "phase is not ready" is read
      // only once it has actually settled; a download failure is reported the
      // same way a failed `&models=` download is above, and the run starts
      // either way.
      if (params.get('punctuation') === '1') {
        await useSegmentationStore.getState().refresh();
        if (useSegmentationStore.getState().phase !== 'ready') {
          try {
            await useSegmentationStore.getState().download();
          } catch (error) {
            reportError('SpinePreview', `The preview could not download the punctuation pack: ${describeCause(error)}`, { cause: error });
          }
        }
      }
      void runner.start();
    })();
  }, [entry, audio, runner, providers, urlApplied]);

  const sealProbe = useSealProbe();

  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} disabled={phase !== 'idle'} />
        <SessionControls
          runner={runner}
          turnMode={turnMode}
          audio={audio}
          capture={deviceCapture() ? () => ({ ...captured }) : undefined}
        />
        {/* Not before `urlApplied`: the panel's own Start enables as soon as the stores and the provider's entry have loaded, ahead of the URL's `&script=`/`&turn=` — a probe that clicks at once would otherwise race the fake's default script. */}
        {previewParams.panel && urlApplied && (
          <div className="spine-panel">
            <SessionPanel />
          </div>
        )}
        <p data-probe="seals">{sealProbe}</p>
        <PreviewConversation view={session.view} karaoke={session.karaoke} playback={audio?.playback ?? null} />
        {previewParams.subtitle && (
          <div className="spine-subtitle">
            <SubtitleTakeover />
          </div>
        )}
        {previewParams.overlay && (
          <PreviewOverlayFrame
            view={session.view}
            karaoke={session.karaoke}
            session={session.subtitle}
            controls={subtitleControls}
            compact={previewParams.compact}
          />
        )}
      </div>
    </div>
  );
}

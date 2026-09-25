/**
 * The app's session (plan 1e-3a): the one composition root every surface
 * reaches — MainPanel, the Electron takeover, the settings lock, the close
 * handshake — without a React tree. Nothing is built at import;
 * `getAppSession()` builds on its first call, and the playback loads on the
 * first `audio()` or leg.
 */
import { getAppAudio, type AppAudio } from '../lib/audio/appAudio';
import { createAppCapture, type AppCapture } from '../lib/audio/appCapture';
import type { Playback } from '../lib/audio/playback';
import { realClock, type Clock } from '../lib/contract/clock';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import { autoSaveConversation } from '../lib/export/appAutoSave';
import type { AuthContext } from '../lib/provider/types';
import { appReplayAudio, ensureReadyFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from '../lib/session/appShape';
import type { AnalyticsPort, FramePort } from '../lib/session/ports';
import { createRunner, type Runner } from '../lib/session/runner';
import type { OpenSource } from '../lib/session/source';
import { appSubtitleSession } from '../lib/subtitle/appSession';
import type { SubtitleSession } from '../lib/subtitle/session';
import type { AutoSaveNotifier } from '../lib/transcript/autoSave';
import { appProjectionSettings } from '../lib/view/appViewSettings';
import { createConversationView, type ConversationViewState, type Readable } from '../lib/view/conversationView';
import { createKaraoke, type KaraokeState } from '../lib/view/karaoke';
import { presentProviders } from '../providers/registry';
import { getEnvironment, isElectron } from '../utils/environment';
import { trackBusy } from './busy';
import { createAppPunctuation, type AppPunctuation } from './punctuation';
import { driveLocalReadiness } from './readiness';
import { appStartInputs, createFrameLog, decorateSessionAnalytics, teeFrames, type FrameLog } from './telemetry';

/** What only React can reach, handed in by `useAppSessionBridges`. */
export interface AppBridges {
  auth: AuthContext;
  track: AnalyticsPort['track'];
  notify: AutoSaveNotifier;
  /** The account's balance, refetched after a run; absent where there is none (the preview). */
  refetchQuota?(): Promise<void>;
}

export interface AppSessionOptions {
  /** The preview's stand-in for the legs' capture, given the app's own: the fake source, or the app's wrapped to count what it delivers. Absent: the app's. */
  capture?(app: OpenSource): OpenSource;
  /** Whether a start needs a chosen microphone (1e-3 ruling 5). Absent: it does; the preview's fake source does not. */
  microphoneRequired?(): boolean;
  /** The preview's `&refuse=1`: true, and every start is refused with no shape. */
  refuse?(): boolean;
  /** Also sees every frame the Logs panel does: the preview's page-lifetime seal line. */
  observeFrames?: FramePort;
  /** Tests: the clock every timer reads. Absent: the real one. */
  clock?: Clock;
  /** Tests: each run's session id. Absent: a random UUID. */
  newSessionId?(): string;
  /** Electron's IPC, for the busy flag; default `window.electron` in Electron, none elsewhere; `null` for none. */
  ipc?: { invoke(channel: string, data?: unknown): Promise<unknown> } | null;
}

/** The page's playback with the legs' capture over it. */
export interface LoadedAudio extends AppAudio {
  capture: AppCapture;
}

export interface AppSession {
  readonly runner: Runner;
  readonly view: Readable<ConversationViewState>;
  readonly karaoke: Readable<KaraokeState>;
  readonly subtitle: Readable<SubtitleSession>;
  readonly punctuation: AppPunctuation;
  readonly frames: FrameLog;
  /** The page's playback and capture, loaded on the first call; a failed load is retried on the next. */
  audio(): Promise<LoadedAudio>;
  setBridges(next: Partial<AppBridges>): void;
  /** Wires the page's lifetime into the session: legs on the audio mode, local readiness, `pagehide`, and Electron's busy flag. Returns the detach. */
  attach(): () => void;
}

// Hoisted so `get()` returns the same object every call — `useSyncExternalStore` requires it.
const IDLE: KaraokeState = { lit: new Map(), replaying: null };

export function createAppSession(options: AppSessionOptions = {}): AppSession {
  const clock = options.clock ?? realClock;
  const bridges: AppBridges = {
    auth: { signedIn: false, getToken: async () => null },
    track: () => {},
    notify: { showToast: () => {} },
  };
  const frames = createFrameLog();
  const punctuation = createAppPunctuation({ track: () => bridges.track, onModelCall: () => frames.countModelCall() });

  // Until the playback loads, a clip has nowhere to go; a leg never opens before it.
  let playback: Playback | null = null;
  let openLeg: OpenSource | null = null;
  let loading: Promise<LoadedAudio> | null = null;

  const refetchQuota = () => {
    const refetch = bridges.refetchQuota;
    if (!refetch) return;
    // Not awaited: the ending is bounded, a network call is not.
    void refetch().catch((error: unknown) => reportWarning('AppSession', `Refreshing the account after the session failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:refetch' }));
  };

  const runner: Runner = createRunner({
    clock,
    platform: getEnvironment(),
    readShape: () => (options.refuse?.() ? null : readShapeFromStores(bridges.auth)),
    ensureReady: ensureReadyFromStores,
    persistIfUnchanged,
    replayAudio: appReplayAudio,
    openSource: async (leg, signal) => {
      await audio();
      return openLeg!(leg, signal);
    },
    playback: {
      audio: (leg, ref, pcm) => playback?.audio(leg, ref, pcm),
      held: (held) => playback?.held(held),
      clear: () => playback?.clear(),
      live: (on) => playback?.live(on),
    },
    analytics: decorateSessionAnalytics(() => bridges.track, { frames, startInputs: () => appStartInputs(punctuation.lastReady) }),
    frames: teeFrames(frames.port, options.observeFrames),
    punctuate: punctuation.punctuate,
    punctuationReady: () => punctuation.ready(),
    newSessionId: options.newSessionId ?? (() => crypto.randomUUID()),
    onRunEnded: async (legs) => {
      try {
        // The one auto-save per run (roadmap, plan 1d-3).
        await autoSaveConversation(legs, runner.conversation.info, bridges.notify);
      } finally {
        refetchQuota();
      }
    },
  });

  const view = createConversationView(runner.conversation, appProjectionSettings(), clock);
  const subtitle = appSubtitleSession(runner, view, { microphoneRequired: options.microphoneRequired ?? (() => true) });

  // Karaoke over the playback's queues, behind one identity: nothing lit until the playback loads.
  let karaokeReal: Readable<KaraokeState> | null = null;
  const karaokeListeners = new Set<() => void>();
  const notifyKaraoke = () => { for (const listener of [...karaokeListeners]) listener(); };
  const karaoke: Readable<KaraokeState> = {
    get: () => karaokeReal?.get() ?? IDLE,
    subscribe(listener) {
      karaokeListeners.add(listener);
      return () => { karaokeListeners.delete(listener); };
    },
  };

  function audio(): Promise<LoadedAudio> {
    loading ??= getAppAudio().then(
      (app) => {
        const capture = createAppCapture(app.playback);
        playback = app.playback;
        openLeg = options.capture ? options.capture(capture.openSource) : capture.openSource;
        if (!karaokeReal) {
          const real = createKaraoke(app.playback.queues, view, clock);
          karaokeReal = real;
          real.subscribe(notifyKaraoke);
          notifyKaraoke();
        }
        return { ...app, capture };
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
    return loading;
  }

  return {
    runner, view, karaoke, subtitle, punctuation, frames,
    audio,
    setBridges(next) { Object.assign(bridges, next); },
    attach() {
      const offs: Array<() => void> = [
        // The panel's readiness is about the legs a start would open: the audio mode's.
        watchLegsFromStores(),
        driveLocalReadiness({ runner, providers: () => presentProviders(), auth: () => bridges.auth, clock }),
      ];
      // A reload, the window or side panel closing, a page frozen into the
      // back/forward cache: close every leg and capture now; nothing is saved
      // (spec: "Stopping, and closing the window"; ruling 14).
      const onPageHide = () => runner.abandon();
      window.addEventListener('pagehide', onPageHide);
      offs.push(() => window.removeEventListener('pagehide', onPageHide));
      const ipc = options.ipc === undefined ? (isElectron() ? window.electron : null) : options.ipc;
      if (ipc) {
        offs.push(trackBusy(runner, (busy) => {
          void ipc.invoke('app:session-busy', busy).catch((error: unknown) =>
            reportWarning('AppSession', `Telling the app the session is ${busy ? 'busy' : 'idle'} failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:busy' }));
        }));
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        for (const off of offs.reverse()) off();
      };
    },
  };
}

let configured: AppSessionOptions = {};
let session: AppSession | null = null;

/** The preview's stand-ins, before the page's session is built. Once built, a later call changes nothing — a hot reload re-runs the preview's module. */
export function configureAppSession(options: AppSessionOptions): void {
  if (session) return;
  configured = options;
}

/** The page's one session, built on the first call. */
export function getAppSession(): AppSession {
  session ??= createAppSession(configured);
  return session;
}

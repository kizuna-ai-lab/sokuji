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
import { redact } from '../lib/diagnostics/redact';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import { autoSaveConversation } from '../lib/export/appAutoSave';
import type { AuthContext } from '../lib/provider/types';
import { appReplayAudio, ensureReadyFromStores, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from '../lib/session/appShape';
import type { AnalyticsPort, ControlMethod, FramePort } from '../lib/session/ports';
import { createRunner, type Runner } from '../lib/session/runner';
import type { OpenSource } from '../lib/session/source';
import { appSubtitleSession } from '../lib/subtitle/appSession';
import type { SubtitleSession } from '../lib/subtitle/session';
import type { AutoSaveNotifier } from '../lib/transcript/autoSave';
import { appProjectionSettings } from '../lib/view/appViewSettings';
import { createConversationView, type ConversationViewState, type Readable } from '../lib/view/conversationView';
import { createKaraoke, type KaraokeState } from '../lib/view/karaoke';
import { presentProviders } from '../providers/registry';
import { useProviderStore } from '../stores/providerStore';
import { getEnvironment, isElectron } from '../utils/environment';
import { trackBusy } from './busy';
import { createAppPunctuation, type AppPunctuation } from './punctuation';
import { driveLocalReadiness } from './readiness';
import { registerRunPhase } from './runPhase';
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
  /** Electron's IPC, for the busy flag and the close request; default `window.electron` in Electron, none elsewhere; `null` for none. */
  ipc?: {
    invoke(channel: string, data?: unknown): Promise<unknown>;
    receive?(channel: string, fn: (...args: unknown[]) => void): void;
    removeListener?(channel: string, fn: (...args: unknown[]) => void): void;
  } | null;
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
  /**
   * The one start every surface calls (ruling 11): resolves without starting
   * unless `subtitle.get().canStart` — the provider's entry loaded, the
   * microphone rule — neither of which the runner itself checks. Otherwise
   * forwards to `runner.start(method)`.
   */
  start(method?: ControlMethod): Promise<void>;
  setBridges(next: Partial<AppBridges>): void;
  /** Wires the page's lifetime into the session: legs on the audio mode, local readiness, the provider held during a run, a source's end as an `audio_error`, `pagehide`, and Electron's busy flag and close request. Returns the detach. */
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
  /** One live `attach()` at a time (final review M6). */
  let attached = false;

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

  // Karaoke over the playback's queues, behind one identity: nothing lit until
  // the playback loads. The root bridges into the real karaoke only while the
  // proxy itself has at least one listener (final review, parked item 8):
  // `createKaraoke` only samples at its interval while *something* is
  // subscribed to it, so an unconditional bridging subscription here would
  // keep it sampling at 10 Hz even with nobody watching the proxy.
  let karaokeReal: Readable<KaraokeState> | null = null;
  let karaokeUnsubscribeReal: (() => void) | null = null;
  const karaokeListeners = new Set<() => void>();
  const notifyKaraoke = () => { for (const listener of [...karaokeListeners]) listener(); };
  const karaoke: Readable<KaraokeState> = {
    get: () => karaokeReal?.get() ?? IDLE,
    subscribe(listener) {
      karaokeListeners.add(listener);
      if (karaokeListeners.size === 1 && karaokeReal && !karaokeUnsubscribeReal) {
        karaokeUnsubscribeReal = karaokeReal.subscribe(notifyKaraoke);
      }
      return () => {
        karaokeListeners.delete(listener);
        if (karaokeListeners.size === 0 && karaokeUnsubscribeReal) {
          karaokeUnsubscribeReal();
          karaokeUnsubscribeReal = null;
        }
      };
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
          if (karaokeListeners.size > 0) karaokeUnsubscribeReal = real.subscribe(notifyKaraoke);
          // Notifies the proxy's own listeners (if any — a no-op otherwise):
          // the real karaoke exists now, behind the same identity.
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
    start(method) {
      if (!subtitle.get().canStart) return Promise.resolve();
      return runner.start(method);
    },
    setBridges(next) {
      // Never `Object.assign`: a caller that omits a key (rather than naming
      // it `undefined`) must not erase what an earlier caller set (M2) — a
      // second `useAppSessionBridges()` bare of `refetchQuota` would
      // otherwise switch the balance refetch off.
      for (const key of Object.keys(next) as (keyof AppBridges)[]) {
        const value = next[key];
        if (value !== undefined) (bridges as Record<keyof AppBridges, unknown>)[key] = value;
      }
    },
    attach() {
      // One live attach at a time (final review M6): a second one while the
      // first is still live would double the pagehide listener, the local
      // readiness driver and the busy tracker. 1e-3b picks the owner; until
      // then this makes a wrong second caller visible instead of silent.
      if (attached) {
        reportWarning('AppSession', 'A second attach() while one is already live did nothing.', { dedupeKey: 'session:attach' });
        return () => {};
      }
      attached = true;
      const offs: Array<() => void> = [
        // The panel's readiness is about the legs a start would open: the audio mode's.
        watchLegsFromStores(),
        driveLocalReadiness({ runner, providers: () => presentProviders(), auth: () => bridges.auth, clock }),
      ];
      // The store's own guard on the provider (plan 1e-3b-1 ruling 7).
      const lock = () => useProviderStore.getState().setSelectionLocked(runner.state.getState().phase !== 'idle');
      lock();
      offs.push(runner.state.subscribe(lock), () => useProviderStore.getState().setSelectionLocked(false));
      // A source that ended the run (a device unplugged, a switch that failed): today's `audio_error` (ruling 10).
      offs.push(runner.state.subscribe((now, before) => {
        if (now.phase !== 'idle' || before.phase === 'idle' || now.lastEnd?.reason !== 'source-ended' || !now.lastEnd.notice) return;
        bridges.track('audio_error', { error_type: 'device_access', error_message: redact(now.lastEnd.notice.message), device_info: now.lastEnd.notice.leg });
      }));
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
        if (ipc.receive) {
          // Electron's window close and update install (one channel): end the run,
          // wait out what outlives its bound, then let the close through. Never
          // `abandon()` here — `settled()` no longer waits for an abandoned unwind
          // (roadmap 1e-1). The main process waits the runner's bound + 1 s.
          const onCloseRequested = async () => {
            try {
              await runner.stop('window');
              await runner.settled();
            } finally {
              void ipc.invoke('app:close-ready').catch((error: unknown) =>
                reportWarning('AppSession', `Answering the close request failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:close-ready' }));
            }
          };
          ipc.receive('app:close-requested', onCloseRequested);
          offs.push(() => ipc.removeListener?.('app:close-requested', onCloseRequested));
        }
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        attached = false;
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
  if (!session) {
    session = createAppSession(configured);
    // The building call only: code outside React reads this session's phase from now on (ruling 5).
    registerRunPhase(() => session!.runner.state.getState().phase);
  }
  return session;
}

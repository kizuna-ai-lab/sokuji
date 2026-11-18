/**
 * The app's session (plan 1e-3a): the one composition root every surface
 * reaches — MainPanel, the Electron takeover, the settings lock, the close
 * handshake — without a React tree. Nothing is built at import;
 * `getAppSession()` builds on its first call, and the playback loads on the
 * first `audio()` or leg.
 */
import { useWordList } from '../lib/words/list';
import { getAppAudio, type AppAudio } from '../lib/audio/appAudio';
import { createAppCapture, type AppCapture } from '../lib/audio/appCapture';
import type { Playback } from '../lib/audio/playback';
import { realClock, type Clock } from '../lib/contract/clock';
import { redact } from '../lib/diagnostics/redact';
import { describeCause, reportError, reportWarning } from '../lib/diagnostics/report';
import { historyPort, type HistoryPort } from '../lib/history/port';
import { createHistoryWriter, myLanguageOf } from '../lib/history/capture/writer';
import { captureFactsFromStores } from '../lib/history/capture/facts';
import { createHistoryRecorder, type HistoryRecorder } from '../lib/history/recording/recorder';
import { opusRecordingSupported, webCodecsOpusEncoder } from '../lib/history/recording/opusEncoder';
import type { OpusEncoderFactory } from '../lib/history/recording/track';
import { autoSaveConversation } from '../lib/export/appAutoSave';
import { appNotesRunner, notesChatFromStores, notesLanguageOf } from '../lib/notes/appNotes';
import { createLiveNotes, type LiveNotes, type LiveNotesDeps } from '../lib/notes/live/loop';
import { useLiveNotes } from '../lib/notes/live/liveStore';
import { emptyLive, type LiveSentence } from '../lib/notes/live/state';
import { notesSpeakerLabel } from '../lib/notes/runner';
import type { HistorySentence } from '../lib/history/types';
import { askQuitWhileNotes, type QuitAnswer, type QuitRecord } from '../lib/notes/quitQuestion';
import type { NotesRunner } from '../lib/notes/runner';
import type { AuthContext } from '../lib/provider/types';
import { openDesktopCapture } from '../lib/screen/desktopFrames';
import { openTabCapture } from '../lib/screen/tabFrames';
import { appMicMuted, appParticipantSpeech, appReplayAudio, ensureReadyFromStores, faceToFaceFromStores, persistIfUnchanged, readShapeFromStores, turnScreenContextOff, watchLegsFromStores, watchSpeechFromStores } from '../lib/session/appShape';
import type { LegName } from '../lib/conversation/types';
import type { AnalyticsPort, ControlMethod, FramePort } from '../lib/session/ports';
import { createRunner, type Runner } from '../lib/session/runner';
import type { OpenSource } from '../lib/session/source';
import { appSubtitleSession } from '../lib/subtitle/appSession';
import type { SubtitleSession } from '../lib/subtitle/session';
import type { AutoSaveNotifier } from '../lib/transcript/autoSave';
import { PANEL_NOTE_CODES, panelNoteWriter, usePanelNotesStore } from '../stores/panelNotesStore';
import { historyNote, shownRecordOf } from './historyNotes';
import { appProjectionSettings } from '../lib/view/appViewSettings';
import { createConversationView, type ConversationViewState, type Readable } from '../lib/view/conversationView';
import { createKaraoke, type KaraokeState } from '../lib/view/karaoke';
import { presentProviders } from '../providers/registry';
import { useProviderStore } from '../stores/providerStore';
import useSettingsStore from '../stores/settingsStore';
import { getEnvironment, isElectron } from '../utils/environment';
import { trackBusy } from './busy';
import { createAppPunctuation, type AppPunctuation } from './punctuation';
import { createBrowserNetwork } from './network';
import { driveReadiness } from './readiness';
import { registerAuth } from './currentAuth';
import { registerRunPhase } from './runPhase';
import { prepareScreenContext, releaseScreenContext, screenContextWanted, type PickedSource, type PickReason } from './screenContext';
import { watchSonioxVoiceAccount } from './sonioxVoiceAccount';
import { registerSubtitleFeed } from './subtitleFeed';
import { appStartInputs, createFrameLog, decorateSessionAnalytics, teeFrames, type FrameLog } from './telemetry';
import { ORG_REFUSAL_CODES } from '../lib/session/orgNotice';

/** What only React can reach, handed in by `useAppSessionBridges`. */
export interface AppBridges {
  auth: AuthContext;
  track: AnalyticsPort['track'];
  /** The account's balance, refetched after a run and after a start the service refused on the wallet; absent where there is none (the preview). */
  refetchQuota?(): Promise<void>;
  /**
   * The screen-context picker (MainPanel's modal): a source, the portal's button, or null for Start without. Absent — the
   * extension, tests — no modal, which only the desktop asks for. `null` takes it away (the panel unmounting): `setBridges`
   * never erases with `undefined`.
   */
  pickScreenSource?: ((reason?: PickReason) => Promise<PickedSource | null>) | null;
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
  /** Where each run is written as a History record; default the desktop's port in Electron, none elsewhere; `null` for none. */
  history?: HistoryPort | null;
  /** Tests: the recording's Opus encoder. Absent: the browser's, when the page can encode Opus; `null`: no recording. */
  historyEncoder?: OpusEncoderFactory | null;
  /** Who writes a closed record's notes; default the app's notes runner on the desktop; `null` for none. */
  notes?: Pick<NotesRunner, 'start' | 'cancel' | 'running' | 'subscribe'> | null;
  /** Asks whether to quit while notes are written (their records, to be named); default the page's dialog. */
  askQuit?(records: readonly QuitRecord[]): Promise<QuitAnswer>;
  /** Makes the live notes' loop; default the app's on the desktop; `null` for none. */
  liveNotes?: ((deps: LiveNotesDeps) => Pick<LiveNotes, 'sentences' | 'stop' | 'dispose'>) | null;
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
   * unless `subtitle.get().canStart`, and otherwise forwards to
   * `runner.start(method)`. The runner re-checks at start what it can — the
   * start gate's refusal, the provider's entry, its readiness — and ends a
   * start it refuses with a notice; the microphone rule is the surfaces'
   * alone.
   */
  start(method?: ControlMethod): Promise<void>;
  setBridges(next: Partial<AppBridges>): void;
  /** The live sign-in the surfaces last handed `setBridges`. */
  auth(): AuthContext;
  /** Wires the page's lifetime into the session: legs on the audio mode, readiness for every kind, and the sign-in's flips (loading finished included), the provider held during a run, a source's end as an `audio_error`, a start the service refused on the wallet as a balance refetch, `pagehide`, the subtitle feed the extension overlay's publisher reads, and Electron's busy flag and close request. Returns the detach. */
  attach(): () => void;
}

// Hoisted so `get()` returns the same object every call — `useSyncExternalStore` requires it.
const IDLE: KaraokeState = { lit: new Map(), replaying: null };
/** At a window close, History's last writes are waited for at most this long. */
const HISTORY_CLOSE_WAIT_MS = 2000;
/** At a quit, how long the cancelled notes versions may take to be saved. */
const NOTES_CANCEL_WAIT_MS = 5000;

export function createAppSession(options: AppSessionOptions = {}): AppSession {
  const clock = options.clock ?? realClock;
  const bridges: AppBridges = {
    auth: { signedIn: false, getToken: async () => null },
    track: () => {},
  };
  /** Heard when the sign-in or the account flips (F1): the readiness driver forgets managed providers' answers. */
  const signInWatchers = new Set<() => void>();
  const frames = createFrameLog();
  const punctuation = createAppPunctuation({ track: () => bridges.track, onModelCall: () => frames.countModelCall() });

  // Until the playback loads, a clip has nowhere to go; a leg never opens before it.
  let playback: Playback | null = null;
  let openLeg: OpenSource | null = null;
  let loading: Promise<LoadedAudio> | null = null;
  /** The runs' voice-idle listeners; the playback, once loaded, is subscribed once and forwards here. */
  const voiceIdleListeners = new Set<(voice: LegName) => void>();
  /** One live `attach()` at a time. */
  let attached = false;

  const refetchQuota = () => {
    const refetch = bridges.refetchQuota;
    if (!refetch) return;
    // Not awaited: the ending is bounded, a network call is not.
    void refetch().catch((error: unknown) => reportWarning('AppSession', `Refreshing the account after the session failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:refetch' }));
  };

  // The recording hears what goes to recognition; the recorder takes it once History can encode it.
  const recordingTap: { recorder: HistoryRecorder | null } = { recorder: null };

  const runner: Runner = createRunner({
    clock,
    audioTap: { pcm: (leg, pcm) => recordingTap.recorder?.pcm(leg, pcm) },
    platform: getEnvironment(),
    network: createBrowserNetwork(),
    readShape: () => (options.refuse?.() ? null : readShapeFromStores(bridges.auth)),
    ensureReady: ensureReadyFromStores,
    persistIfUnchanged,
    replayAudio: appReplayAudio,
    micMuted: appMicMuted,
    participantSpeech: appParticipantSpeech,
    openSource: async (leg, signal) => {
      await audio();
      return openLeg!(leg, signal);
    },
    playback: {
      audio: (leg, ref, pcm, voice) => playback?.audio(leg, ref, pcm, voice) ?? [],
      held: (held) => playback?.held(held),
      clear: () => playback?.clear(),
      live: (on) => playback?.live(on),
      onVoiceIdle: (listener) => {
        voiceIdleListeners.add(listener);
        return () => { voiceIdleListeners.delete(listener); };
      },
    },
    analytics: decorateSessionAnalytics(() => bridges.track, { frames, startInputs: () => appStartInputs(punctuation.lastReady) }),
    frames: teeFrames(frames.port, options.observeFrames),
    punctuate: punctuation.punctuate,
    punctuationReady: () => punctuation.ready(),
    newSessionId: options.newSessionId ?? (() => crypto.randomUUID()),
    onRunEnded: async (legs) => {
      // The results of the auto-save are panel notes (spec 2026-10-05 §5): drawn
      // after the conversation, cleared by Clear and by the next start. The
      // writer is this run's: a save that outlives the runner's bound answers
      // after the next run may have started, and that answer is dropped.
      const notes: AutoSaveNotifier = { note: panelNoteWriter() };
      try {
        // The one auto-save per run (roadmap, plan 1d-3).
        await autoSaveConversation(legs, runner.conversation.info, notes);
      } finally {
        refetchQuota();
      }
    },
  });

  // History (desktop): every run becomes a record while it runs, written by an observer of the runner.
  /** The record whose conversation is on screen: the run's session, until Clear after the run. */
  const shownRecord = shownRecordOf(runner.conversation, runner.state);
  const historyPortOrNull = options.history === undefined ? (isElectron() ? historyPort() : null) : options.history;
  const historyRecorder = historyPortOrNull && options.historyEncoder !== null
    ? createHistoryRecorder({
      port: historyPortOrNull,
      clock,
      encoder: options.historyEncoder ?? webCodecsOpusEncoder,
      report: (message, cause) => reportError('History', message, { cause }),
      // Shown on the record's own conversation only: a record can fail after the next session started.
      tell: historyNote({
        code: PANEL_NOTE_CODES.historyRecordingStopped,
        message: 'The recording of this session stopped: it could not be written to disk.',
      }, shownRecord),
    })
    : null;
  if (historyRecorder) {
    if (options.historyEncoder) recordingTap.recorder = historyRecorder;
    else {
      void opusRecordingSupported().then((ok) => {
        if (ok) recordingTap.recorder = historyRecorder;
        else reportWarning('History', 'This page cannot encode Opus: sessions are kept without their recording.', { dedupeKey: 'history:no-opus' });
      });
    }
  }
  /** Records whose run the app's own closing ended: no notes are written for them (spec §5.1). */
  const closedByApp = new Set<string>();

  // Live notes (stage 4): a loop per record while its session runs, fed the sentences as the record numbers them.
  const liveFactory = options.liveNotes === undefined ? (isElectron() ? createLiveNotes : null) : options.liveNotes;
  type LiveLoop = Pick<LiveNotes, 'sentences' | 'stop' | 'dispose'> & Partial<Pick<LiveNotes, 'quiet'>>;
  /**
   * A record's live notes: its loop once the notes service is read (`loading` until then); `stopped` at Stop, `gone`
   * once let go.
   */
  type LiveRun = {
    recordId: string; loop: LiveLoop | null; pending: LiveSentence[]; seen: LiveSentence[]; loading: boolean; stopped: boolean; gone: boolean;
    /** The notes on screen it goes on from, when turned on again in the same session. */
    resumed: { recordId: string; seen: LiveSentence[] } | null;
    /** Reading the notes service failed: the next sentence tries again (review). */
    failed: boolean;
  };
  let live: LiveRun | null = null;
  /** Runs stopped whose last update has not come yet (their service may still be loading). */
  const finishing = new Set<LiveRun>();
  /** Live notes turned off during this record's session: what they go on from when turned on again in it. */
  let paused: { recordId: string; seen: LiveSentence[] } | null = null;
  /**
   * Clear came once the session was stopping or over: the live notes are gone for it, and a sentence that comes
   * after (a last final the service sends while the run stops) does not start them again. A new run lets them go.
   */
  let clearedAfterRun = false;
  /** The switch is watched only while a loop runs or gives its last update. */
  let unwatchSwitch: (() => void) | null = null;
  const unwatch = () => { unwatchSwitch?.(); unwatchSwitch = null; };
  const unwatchIfIdle = () => { if (!live && finishing.size === 0) unwatch(); };
  /** A stopped run's last update is done (or will not come): the panel shows it ended. */
  const finished = (run: LiveRun) => {
    finishing.delete(run);
    unwatchIfIdle();
    useLiveNotes.getState().end(run.recordId);
  };
  // Turned off during a session: the loop goes at once, and the panel says so. Turned on again in the same session,
  // live notes start with the next sentence and go on from the notes on screen. Turned off while a stopped session's
  // last update is on its way, that loop goes at once too: nothing more is sent.
  const watchSwitch = () => {
    unwatch();
    unwatchSwitch = useSettingsStore.subscribe((now, before) => {
      if (!before.liveNotes || now.liveNotes) return;
      for (const run of [...finishing]) {
        run.gone = true;
        // A loop's Stop returns once it is let go (and `finished` follows it); one not made yet has nothing to wait for.
        if (run.loop) run.loop.dispose();
        else finished(run);
      }
      if (live) {
        live.gone = true;
        live.loop?.dispose();
        useLiveNotes.getState().turnedOff(live.recordId);
        paused = { recordId: live.recordId, seen: live.seen };
        live = null;
      }
      unwatchIfIdle();
    });
  };
  // The switch alone: the line-up always names a notes service (owner, 2026-11-17: no "None").
  const liveWanted = () => useSettingsStore.getState().liveNotes;
  const asHistory = (s: LiveSentence): HistorySentence => ({
    ...s, segmentId: s.segmentId ?? null, speakerByUser: null, speakerName: null, language: s.language ?? null, translation: null,
  });
  /** The speaker labels for a loop, built again only when sentences were added (an update asks for each it sends). */
  const labelsFor = (seen: readonly LiveSentence[]) => {
    let label: ((s: HistorySentence) => string) | null = null;
    let builtFor = -1;
    return (s: LiveSentence): string => {
      if (!label || builtFor !== seen.length) {
        label = notesSpeakerLabel(seen.map(asHistory));
        builtFor = seen.length;
      }
      return label(asHistory(s));
    };
  };
  /** A run's loop, once the notes service is read; a Stop before it answers keeps the sentences for the last update. */
  const setUpLoop = (begun: LiveRun) => {
    const factory = liveFactory;
    if (!factory) return;
    const recordId = begun.recordId;
    const resumed = begun.resumed;
    begun.loading = true;
    begun.failed = false;
    void notesChatFromStores(recordId, { onBalance: (microUsd) => useLiveNotes.getState().balanceAfter(recordId, microUsd) }).then((service) => {
      begun.loading = false;
      if (begun.gone) return;
      if (!service) {
        if (begun.stopped) { finished(begun); return; }
        live = null;
        unwatchIfIdle();
        useLiveNotes.getState().turnedOff(recordId);
        return;
      }
      const shown = useLiveNotes.getState();
      begun.loop = factory({
        ...(resumed ? { from: { state: (shown.recordId === recordId ? shown.state : null) ?? emptyLive(), seen: resumed.seen } } : {}),
        // The record's own "my language", as the notes after the session use (spec §6.5).
        chat: service.chat, clock, language: notesLanguageOf({ myLanguage: myLanguageOf(runner.conversation.snapshot()) }),
        speakerLabel: labelsFor(begun.seen),
        // The word list as it stands at the session's start, like what the services were sent (stage 5).
        names: useWordList.getState().entries,
        // Keyed by the record: the last update after Stop still lands, and nothing lands once another session shows.
        onState: (state) => useLiveNotes.getState().update(recordId, state),
        onHint: (shown) => useLiveNotes.getState().setHint(recordId, shown),
        // Kizuna AI refused for the account (the balance ran out…): the loop has stopped; the panel says why.
        onStopped: (why) => useLiveNotes.getState().stoppedFor(recordId, why),
        onUsage: (usage) => useLiveNotes.getState().addUsage(recordId, usage),
        log: (line) => console.info('[Sokuji] [LiveNotes]', JSON.stringify(line)),
      });
      begun.loop.sentences(begun.pending);
      begun.pending = [];
      if (begun.stopped) { void begun.loop.stop().finally(() => finished(begun)); return; }
      if (runner.state.getState().phase === 'stopping') begun.loop.quiet?.();
    }, (error: unknown) => {
      begun.loading = false;
      reportError('LiveNotes', 'Live notes could not start', { cause: error });
      if (begun.stopped && !begun.gone) finished(begun);
      // Still going: the run stays (its panel, its sentences); the next sentence tries again (review).
      else begun.failed = true;
    });
  };
  const onLiveSentences = (recordId: string, list: LiveSentence[]) => {
    if (!liveFactory) return;
    if (!live || live.recordId !== recordId) {
      // Another record's loop still here (its run's end was not seen): it has its last update now.
      if (live) endLive(live.recordId, false);
      if (!liveWanted() || clearedAfterRun) return;
      const resumed = paused?.recordId === recordId && useLiveNotes.getState().recordId === recordId ? paused : null;
      paused = null;
      const begun: LiveRun = {
        recordId, loop: null, pending: [], seen: resumed ? [...resumed.seen] : [], loading: true, stopped: false, gone: false, resumed, failed: false,
      };
      live = begun;
      watchSwitch();
      if (resumed) useLiveNotes.getState().resume(recordId);
      else useLiveNotes.getState().begin(recordId);
      setUpLoop(begun);
    }
    else if (live.failed && !live.loading && !live.loop && !live.stopped) setUpLoop(live);
    live.seen.push(...list);
    if (live.loop) live.loop.sentences(list);
    else live.pending.push(...list);
  };
  /** The record's session ended: its last update, unless the app's closing ended it. */
  const endLive = (recordId: string, closing: boolean) => {
    if (paused?.recordId === recordId) paused = null;
    if (!live || live.recordId !== recordId) return;
    const ending = live;
    live = null;
    if (closing) {
      ending.gone = true;
      ending.loop?.dispose();
      unwatchIfIdle();
      useLiveNotes.getState().end(recordId);
      return;
    }
    ending.stopped = true;
    finishing.add(ending);
    // Its loop not made yet (the notes service still loading): it is made, and stops, when the service answers.
    if (ending.loop) void ending.loop.stop().finally(() => finished(ending));
    else if (!ending.loading) finished(ending);
  };
  // A new run: the last session's live notes leave the screen, and its late answers no longer land there.
  // Stopping: the loop sends nothing more on its own; its last update comes when the run has ended.
  runner.state.subscribe((now, before) => {
    if (now.phase === 'starting' && before.phase === 'idle') { paused = null; clearedAfterRun = false; useLiveNotes.getState().reset(); }
    if (now.phase === 'stopping' && before.phase !== 'stopping') live?.loop?.quiet?.();
  });
  /** The notes runner: the app's on the desktop unless one is given. */
  const notesRunner = () => (options.notes === undefined ? (isElectron() ? appNotesRunner() : null) : options.notes);
  /** The records whose notes are being written, as far as History can tell, for the question to name: a record nobody
   *  titled is named by its start. */
  const recordsOf = async (ids: readonly string[]): Promise<QuitRecord[]> => {
    if (!historyPortOrNull) return [];
    const records = await Promise.all(ids.map((id) => historyPortOrNull.getRecord(id)
      .then((r) => (r ? { title: r.title || null, startedAt: r.startedAt } : null), () => null)));
    return records.filter((r): r is QuitRecord => r !== null);
  };
  /** The versions cancelled at a quit have been saved, or 5 s have passed. */
  const notesCancelled = (notes: NonNullable<ReturnType<typeof notesRunner>>, ids: readonly string[]): Promise<void> =>
    new Promise<void>((resolve) => {
      const done = () => { off(); cancel(); resolve(); };
      const check = () => { if (!notes.running().some((id) => ids.includes(id))) done(); };
      const off = notes.subscribe(check);
      const cancel = clock.setTimeout(done, NOTES_CANCEL_WAIT_MS);
      check();
    });

  const historyWriter = historyPortOrNull
    ? createHistoryWriter({
      state: runner.state,
      conversation: runner.conversation,
      port: historyPortOrNull,
      clock,
      facts: () => {
        const phase = runner.state.getState();
        return captureFactsFromStores({ info: runner.conversation.info, participantSpeech: 'participantSpeech' in phase ? phase.participantSpeech : false });
      },
      report: (message, cause) => reportError('History', message, { cause }),
      tell: historyNote({
        code: PANEL_NOTE_CODES.historyTranscriptStopped,
        message: 'Part of this session’s transcript could not be saved: it could not be written to disk.',
      }, shownRecord),
      ...(historyRecorder ? { recorder: historyRecorder } : {}),
      // Notes after the session: when the switch is on and the line-up names a notes service.
      onSentences: onLiveSentences,
      // The live notes end with the run, whether or not History keeps the record.
      onEnded: (recordId) => endLive(recordId, closedByApp.has(recordId)),
      // The live notes panel is told what became of the record, and whether its full notes are being written.
      onNotKept: (recordId) => useLiveNotes.getState().closed(recordId, { kept: false, fullNotes: false }),
      onCloseFailed: (recordId) => useLiveNotes.getState().closed(recordId, { kept: true, fullNotes: false }),
      onCloseSkipped: (recordId) => useLiveNotes.getState().closed(recordId, { kept: null, fullNotes: false }),
      onClosed: (recordId) => {
        const notes = notesRunner();
        const writing = !closedByApp.has(recordId) && Boolean(notes)
          && useSettingsStore.getState().notesAfterSession;
        if (writing) notes!.start(recordId);
        useLiveNotes.getState().closed(recordId, { kept: true, fullNotes: writing });
      },
    })
    : null;
  /** The writer's last writes, or 2 s, whichever is first: the close waits for History, never longer than that. */
  const historySettled = (): Promise<void> => {
    if (!historyWriter) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const cancel = clock.setTimeout(resolve, HISTORY_CLOSE_WAIT_MS);
      void historyWriter.settled().then(() => { cancel(); resolve(); });
    });
  };

  // The screen context lives as long as its run (spec 2026-10-22 §3.1): every way back to idle lets it go — a stop, a
  // leg's end, a start refused or failed, `abandon()` — not only the runs that went live, which alone reach `onRunEnded`.
  runner.state.subscribe((now, before) => {
    if (now.phase === 'idle' && before.phase !== 'idle') releaseScreenContext();
  });

  /** The picker, through the bridge MainPanel sets; without one there is no modal, and the run starts without. */
  const pickScreenSource = (reason?: PickReason): Promise<PickedSource | null> => {
    if (bridges.pickScreenSource) return bridges.pickScreenSource(reason);
    reportWarning('ScreenContext', 'No screen picker is mounted; the session starts without screen context.', { dedupeKey: 'screen-context:no-picker' });
    return Promise.resolve(null);
  };
  /** A start choosing its screen, until its run has started: a second Start meanwhile is the same start, not a second picker. */
  let choosing: Promise<void> | null = null;

  const view = createConversationView(runner.conversation, appProjectionSettings(), clock);
  const subtitle = appSubtitleSession(runner, view, { microphoneRequired: options.microphoneRequired ?? (() => true) });

  // Karaoke over the playback's queues, behind one identity: nothing lit until
  // the playback loads. The root bridges into the real karaoke only while the
  // proxy itself has at least one listener:
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
        const capture = createAppCapture(app.playback, getEnvironment(), {
          // The mic strip shows whether the voice is fed into processing
          // (the owner's rule, 2026-09-26): flat under push-to-talk until a
          // turn is held; the participant's strip shows what it captures.
          meterGate: (leg) => leg !== 'speaker' || runner.speakerAudioInUse(),
          participantBeside: faceToFaceFromStores,
        });
        playback = app.playback;
        playback.onVoiceIdle((voice) => { for (const listener of [...voiceIdleListeners]) listener(voice); });
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
      if (choosing) return choosing;
      if (!subtitle.get().canStart) return Promise.resolve();
      if (!screenContextWanted()) return runner.start(method);
      // The screen before the runner (spec 2026-10-22 §3.1): the area held, or the picker's; the run's shape reads the source it leaves in the store.
      const starting = (async () => {
        try {
          await prepareScreenContext(getEnvironment(), { legs: readShapeFromStores(bridges.auth)?.legs ?? ['speaker'] }, {
            pick: pickScreenSource,
            // The user's Start without, in the picker: the switch goes off. A null from no picker (none mounted, or one
            // taken away by an unmount, which answers the open pick first) is nobody's choice, and leaves it on.
            turnOff: () => { if (bridges.pickScreenSource) turnScreenContextOff(); },
            clock,
            invoke: (channel, data) => window.electron.invoke(channel, data),
            openDesktop: openDesktopCapture,
            openTab: openTabCapture,
          });
          await runner.start(method);
        } finally {
          choosing = null;
          // A start the runner refused without leaving idle (no provider, the last run still stopping) has no end to
          // release on; one that went anywhere is released by its own way back to idle.
          if (runner.state.getState().phase === 'idle') releaseScreenContext();
        }
      })();
      choosing = starting;
      return starting;
    },
    auth: () => bridges.auth,
    setBridges(next) {
      // Never `Object.assign`: a caller that omits a key (rather than naming
      // it `undefined`) must not erase what an earlier caller set — a
      // second `useAppSessionBridges()` bare of `refetchQuota` would
      // otherwise switch the balance refetch off.
      const signedIn = bridges.auth.signedIn;
      const userId = bridges.auth.userId ?? null;
      const loaded = bridges.auth.loaded !== false;
      for (const key of Object.keys(next) as (keyof AppBridges)[]) {
        const value = next[key];
        if (value !== undefined) (bridges as Record<keyof AppBridges, unknown>)[key] = value;
      }
      // A microtask later: `useAppSessionBridges` calls this while React renders, and a store write there would update other components mid-render.
      if (bridges.auth.signedIn !== signedIn || (bridges.auth.userId ?? null) !== userId || (bridges.auth.loaded !== false) !== loaded) {
        queueMicrotask(() => { for (const watcher of [...signInWatchers]) watcher(); });
      }
    },
    attach() {
      // One live attach at a time: a second one while the
      // first is still live would double the pagehide listener, the
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
        // The languages on offer follow whether a start would speak (Stage 2 Volcengine AST2, choice 1).
        watchSpeechFromStores(),
        driveReadiness({
          runner, providers: () => presentProviders(), auth: () => bridges.auth, clock,
          watchSignIn: (fn) => { signInWatchers.add(fn); return () => { signInWatchers.delete(fn); }; },
        }),
        // A custom voice filed under the previous account is checked against the new one (voice reconcile).
        watchSonioxVoiceAccount({
          auth: () => bridges.auth, providers: () => presentProviders(),
          watchSignIn: (fn) => { signInWatchers.add(fn); return () => { signInWatchers.delete(fn); }; },
        }),
      ];
      // The store's own guard on the provider (plan 1e-3b-1 ruling 7).
      const lock = () => useProviderStore.getState().setSelectionLocked(runner.state.getState().phase !== 'idle');
      lock();
      offs.push(runner.state.subscribe(lock), () => useProviderStore.getState().setSelectionLocked(false));
      // The extension overlay's publisher reaches the session through this
      // leaf, for as long as the page is attached: the side panel's surface
      // class cannot import the root (plan 1e-4 ruling 1).
      offs.push(registerSubtitleFeed({
        sources: { entries: { get: () => view.get().entries, subscribe: view.subscribe }, session: subtitle, karaoke },
        clear: () => runner.clear(),
        press: () => runner.press(),
        release: () => runner.release(),
      }));
      // A new run starts a new record: the previous run's panel notes go with the
      // conversation they belonged to (spec 2026-10-05 §5). On every start, a
      // refused one too: the conversation is replaced only once a start gets past
      // its refusals, so the reset below misses those.
      offs.push(runner.state.subscribe((now, before) => {
        if (now.phase === 'starting' && before.phase === 'idle') usePanelNotesStore.getState().clear();
      }));
      // The conversation emptied — Clear from any surface (the subtitle bar's
      // reaches the runner, not MainPanel's handler) — and the notes go with it
      // (the live notes only once the session is over: liveStore's clear).
      offs.push(runner.conversation.onReset(() => {
        usePanelNotesStore.getState().clear();
        const { phase } = runner.state.getState();
        const sessionRunning = phase === 'starting' || phase === 'running';
        useLiveNotes.getState().clear(sessionRunning);
        if (!sessionRunning) clearedAfterRun = true;
      }));
      // A source that ended the run (a device unplugged, a switch that failed): today's `audio_error` (ruling 10).
      offs.push(runner.state.subscribe((now, before) => {
        if (now.phase !== 'idle' || before.phase === 'idle' || now.lastEnd?.reason !== 'source-ended' || !now.lastEnd.notice) return;
        bridges.track('audio_error', { error_type: 'device_access', error_message: redact(now.lastEnd.notice.message), device_info: now.lastEnd.notice.leg });
      }));
      // A start the service refused on the wallet (a balance spent elsewhere,
      // a wallet frozen since the last fetch): the wallet the gate and the
      // account button read is stale, so fetch it now — as the old app's
      // failed-start teardown did — rather than let every press meet the same
      // refusal until the idle poll. A run that went live also refetches in
      // `onRunEnded`.
      offs.push(runner.state.subscribe((now, before) => {
        if (now.phase !== 'idle' || before.phase === 'idle') return;
        const reason = now.lastEnd?.reason;
        const code = now.lastEnd?.notice?.code;
        if (code === undefined) return;
        if (reason === 'start-failed' && (code === 'insufficient_balance' || code === 'wallet_frozen' || ORG_REFUSAL_CODES.has(code))) refetchQuota();
        // A run the organization's wallet ended mid-session (frozen, removed, held, spent): its status is stale too.
        else if (reason === 'leg-failed' && ORG_REFUSAL_CODES.has(code)) refetchQuota();
      }));
      // A reload, the window or side panel closing, a page frozen into the
      // back/forward cache: close every leg and capture now; nothing is saved
      // (spec: "Stopping, and closing the window"; ruling 14).
      const onPageHide = () => runner.abandon();
      window.addEventListener('pagehide', onPageHide);
      offs.push(() => window.removeEventListener('pagehide', onPageHide));
      const ipc = options.ipc === undefined ? (isElectron() ? window.electron : null) : options.ipc;
      if (ipc) {
        // Busy while a run is live or notes are being written: either holds a close for the page to answer.
        const notes = notesRunner();
        let runBusy = false;
        const sendBusy = () => {
          const busy = runBusy || (notes?.running().length ?? 0) > 0;
          void ipc.invoke('app:session-busy', busy).catch((error: unknown) =>
            reportWarning('AppSession', `Telling the app the session is ${busy ? 'busy' : 'idle'} failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:busy' }));
        };
        offs.push(trackBusy(runner, (busy) => { runBusy = busy; sendBusy(); }));
        if (notes) offs.push(notes.subscribe(sendBusy));
        if (ipc.receive) {
          // Electron's window close and update install (one channel): end the run,
          // wait out what outlives its bound, then let the close through. Never
          // `abandon()` here — `settled()` no longer waits for an abandoned unwind
          // (roadmap 1e-1). The main process waits the runner's bound + 1 s.
          // Notes being written then: the user is asked (ruling 7). Quit stores them as cancelled; Stay keeps the app.
          // Asked before anything stops, so Stay leaves a live session as it was.
          const onCloseRequested = async () => {
            let close = true;
            try {
              const writing = notes?.running() ?? [];
              if (notes && writing.length > 0) {
                await ipc.invoke('app:close-asking');
                const answer = await (options.askQuit ?? askQuitWhileNotes)(await recordsOf(writing));
                if (answer === 'stay') {
                  close = false;
                  await ipc.invoke('app:close-cancelled');
                  return;
                }
              }
              // A session the app's closing ends gets no notes, now or later (spec §5.1).
              const live = runner.conversation.snapshot()[0]?.session;
              if (live) closedByApp.add(live);
              await runner.stop('window');
              await runner.settled();
              await historySettled();
              const still = notes?.running() ?? [];
              if (notes && still.length > 0) {
                for (const id of still) notes.cancel(id);
                await notesCancelled(notes, still);
              }
            } finally {
              if (close) {
                void ipc.invoke('app:close-ready').catch((error: unknown) =>
                  reportWarning('AppSession', `Answering the close request failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:close-ready' }));
              }
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
    registerAuth(() => session!.auth());
  }
  return session;
}

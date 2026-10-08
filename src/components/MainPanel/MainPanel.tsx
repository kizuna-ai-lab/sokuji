/**
 * MainPanel on the app session, since plan 1e-3b-2's switch (built by plan
 * 1e-3b-1): the conversation from the root's view and karaoke, the run's
 * controls, the toolbar with the export menu, the footers over the run's
 * state.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Captions, MessageSquare } from 'lucide-react';
import { getAppSession, type AppSession, type LoadedAudio } from '../../app/session';
import { useRunState } from '../../app/useRun';
import { isDevelopment } from '../../config/analytics';
import { useAnalytics } from '../../lib/analytics';
import type { LegName } from '../../lib/conversation/types';
import { describeCause, reportError, reportWarning } from '../../lib/diagnostics/report';
import { participantSpeechHeard } from '../../lib/modern-audio/participantSource';
import { isFaceToFace } from '../../lib/session/appShape';
import { NO_MICROPHONE } from '../../lib/session/shape';
import type { RunEnd, RunState } from '../../lib/session/types';
import { displayItems, type DisplayItem, type NoticeEntry } from '../../lib/view/filter';
import { actionLabel, type NoticeActionSpec } from '../../lib/view/noticeActions';
import { isPanelNoteId, noticeActionSpec, panelNoteEntries } from '../../lib/view/panelNotes';
import { getProvider } from '../../providers/registry';
import {
  default as useAudioStore,
  useIsMicMuted,
  useMode,
  useParticipantSources,
  useSelectedParticipantSource,
  useSetMode,
  type AudioMode,
} from '../../stores/audioStore';
import { useCleanupAudioSystemListeners, useInitAudioSystemListeners } from '../../stores/audioSystemStore';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { usePanelNotes, usePanelNotesStore } from '../../stores/panelNotesStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import {
  useKeepReplayAudio,
  useNavigateToSettings,
  useParticipantDisplayMode,
  useSetAccountPopoverRequested,
  useSetAuthOverlay,
  useSpeakerDisplayMode,
  useSubtitleModeActive,
  useUIMode,
} from '../../stores/settingsStore';
import { useSetSubtitleEntryHint } from '../../stores/subtitleStore';
import { useCleanupUpdateListeners, useInitUpdateListeners } from '../../stores/updateStore';
import { getEnvironment, isElectron, isExtension } from '../../utils/environment';
import { ConversationList, type NoticeAction } from '../Conversation/ConversationList';
import { SystemRow } from '../Conversation/SystemRow';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import { useVisibleEntries } from '../Conversation/useVisibleEntries';
import { echoSource, useEchoNotice } from '../EchoNotice/useEchoNotice';
import WarningModal from '../Settings/shared/WarningModal';
import { Banners } from '../Banner/useBanners';
import UpdateDialog from '../UpdateDialog/UpdateDialog';
import ModeDevicePopover from './ModeDevicePopover';
import { PanelFooter } from './panel/PanelFooter';
import PanelToolbar from './panel/PanelToolbar';
import { replayBlocked } from './panel/replayGate';
import { useSessionClock } from './panel/sessionClock';
import TypedText from './panel/TypedText';
import { usePermissionWarning } from './panel/usePermissionWarning';
import { usePushToTalk } from './panel/usePushToTalk';
import { InputWaveforms, OutputWaveform } from './panel/Waveforms';
import { StatusLine } from './StatusLine';
import { useStatusLine } from './useStatusLine';
import './MainPanel.scss';

/**
 * The page's playback and capture, once loaded (as the preview's own effect
 * did). A failed load is asked for again on each phase change until one
 * lands: a start retries the load itself (`session.audio()`), and the panel
 * picks up what it loaded.
 */
function useLoadedAudio(session: AppSession, phase: RunState['phase']): LoadedAudio | null {
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const loaded = audio !== null;
  useEffect(() => {
    if (loaded) return;
    let live = true;
    session.audio().then(
      (next) => { if (live) setAudio(next); },
      (error: unknown) => reportError('MainPanel', `The playback did not load: ${describeCause(error)}`, { cause: error, dedupeKey: 'panel:audio' }),
    );
    return () => { live = false; };
  }, [session, phase, loaded]);
  return audio;
}

/**
 * The development test tone (1e-3 ruling 16): a press plays it, a second
 * press stops it — a playing tone ends (`stopPreview`), and one still
 * decoding never plays (its press's signal aborts). Development builds only.
 */
function useTestTone(audio: LoadedAudio | null): { playing: boolean; toggle(): void } | undefined {
  const [playing, setPlaying] = useState(false);
  // The press in flight; a second press aborts it.
  const press = useRef<AbortController | null>(null);
  const toggle = useCallback(() => {
    if (!audio) return;
    const current = press.current;
    if (current) {
      current.abort();
      press.current = null;
      audio.playback.stopPreview();
      setPlaying(false);
      return;
    }
    const mine = new AbortController();
    press.current = mine;
    setPlaying(true);
    audio.testTone(mine.signal)
      .catch((error: unknown) => reportError('MainPanel', `The test tone did not play: ${describeCause(error)}`, { cause: error }))
      .finally(() => {
        if (press.current !== mine) return;
        press.current = null;
        setPlaying(false);
      });
  }, [audio]);
  return isDevelopment() ? { playing, toggle } : undefined;
}

/** Today's update and audio-system listener inits (pre-switch MainPanel.tsx:1111-1125), verbatim. */
function useUpdateAndAudioSystemListeners(): void {
  // Initialize auto-update listeners
  const initUpdateListeners = useInitUpdateListeners();
  const cleanupUpdateListeners = useCleanupUpdateListeners();
  useEffect(() => {
    initUpdateListeners();
    return () => cleanupUpdateListeners();
  }, [initUpdateListeners, cleanupUpdateListeners]);

  // Initialize virtual audio device status listeners (e.g. missing pactl on Linux)
  const initAudioSystemListeners = useInitAudioSystemListeners();
  const cleanupAudioSystemListeners = useCleanupAudioSystemListeners();
  useEffect(() => {
    initAudioSystemListeners();
    return () => cleanupAudioSystemListeners();
  }, [initAudioSystemListeners, cleanupAudioSystemListeners]);
}

export default function MainPanel() {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const session = getAppSession();
  const { runner } = session;
  const run = useRunState();
  const viewState = useReadable(session.view);
  const { lit, replaying } = useReadable(session.karaoke);
  const subtitle = useReadable(session.subtitle);
  const exporter = useConversationExporter(viewState);
  const audio = useLoadedAudio(session, run.phase);

  const uiMode = useUIMode();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const keepReplayAudio = useKeepReplayAudio();
  const navigateToSettings = useNavigateToSettings();
  const setAccountPopoverRequested = useSetAccountPopoverRequested();
  const setAuthOverlay = useSetAuthOverlay();
  const notes = usePanelNotes();
  const subtitleModeActive = useSubtitleModeActive();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const mode = useMode();
  const setMode = useSetMode();
  const micMuted = useIsMicMuted();
  const participantSources = useParticipantSources();
  const participantSource = useSelectedParticipantSource();
  const provider = useProviderStore((s) => (s.selected ? getProvider(s.selected) : undefined));
  const otherSide = useAudioStore((s) => s.otherSide);
  const faceToFace = isFaceToFace(provider, mode, otherSide);
  const providerSettings = useProviderStore((s) => (s.selected ? s.entries[s.selected]?.settings : undefined));
  const display = useConversationDisplayStore();

  // The conversation, then the panel notes after it (spec 2026-10-05 §5), through the display filter,
  // reusing unchanged lines (ruling 14).
  // A transient notice or note leaves the panel once its time is up; the export keeps the notices.
  const entries = useMemo(() => (notes.length === 0 ? viewState.entries : [...viewState.entries, ...panelNoteEntries(notes)]), [viewState.entries, notes]);
  const shown = useVisibleEntries(entries);
  const takeover = subtitleModeActive && isExtension();
  const previous = useRef<readonly DisplayItem[]>([]);
  const drawn = useMemo(() => {
    const next = displayItems(shown, { speaker: speakerMode, participant: participantMode }, previous.current);
    previous.current = next;
    return next;
  }, [shown, speakerMode, participantMode]);
  // Clear dismisses the status line's last-end entry too. The end stays on the runner, which the
  // subtitle surfaces read, so the panel keeps the end it cleared, by
  // reference: a later end is another object and draws again.
  const [dismissedEnd, setDismissedEnd] = useState<RunEnd | null>(null);
  const segments = useMemo(() => new Map(viewState.legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const))), [viewState.legs]);
  // No participant replay slot while the whole-system rule mutes it (ruling
  // 7, completed): the switch, the run's shape and the route all agree.
  const heardParticipantSpeech = participantSpeech && participantSpeechHeard(getEnvironment(), participantSource?.deviceId, faceToFace);
  const replayLegs = useMemo(() => new Set<LegName>(keepReplayAudio ? (heardParticipantSpeech ? ['speaker', 'participant'] : ['speaker']) : []), [keepReplayAudio, heardParticipantSpeech]);
  const participantNoticeCodes = useMemo(
    () => viewState.legs.find((leg) => leg.leg === 'participant')?.notices.flatMap((n) => (n.code ? [n.code] : [])) ?? [],
    [viewState.legs],
  );
  const blocked = replayBlocked({ run, platform: getEnvironment(), participantSourceId: participantSource?.deviceId, participantNoticeCodes, faceToFace })
    ? t('mainPanel.replayBlockedWholeSystem', "Replay is off while Other's audio captures all system sound: it would be translated again.")
    : null;

  const permission = usePermissionWarning(run, viewState.legs);
  const openWarning = permission.open;
  // One table of actions (spec 2026-10-05 §6); the panel owns the handlers.
  const runNoticeAction = useCallback((spec: NoticeActionSpec) => {
    switch (spec.kind) {
      case 'settings': navigateToSettings(spec.target); return;
      case 'top-up': setAccountPopoverRequested(true); return;
      case 'sign-in': setAuthOverlay('sign-in'); return;
      case 'system-settings': openWarning(spec.pane === 'screen-recording' ? 'screen-recording-denied' : 'audio-capture-denied'); return;
      case 'show-in-folder': if (isElectron()) void window.electron.invoke('open-directory', spec.dir); return;
      default: { const _exhaustive: never = spec; return _exhaustive; }
    }
  }, [navigateToSettings, setAccountPopoverRequested, setAuthOverlay, openWarning]);
  // The store actions and `open` are stable for the panel's life; `t` and the notes are not — a
  // language bundle arriving swaps `t` (`i18n`'s `bindI18nStore: 'added'`), and a note added or
  // cleared swaps `notes`. ConversationList's per-notice cache keys off this callback's identity,
  // so either change invalidates and rebuilds it rather than serving stale text (ruling 14).
  // Between rebuilds the cache is never pruned: one entry per notice drawn — a page's worth. An id
  // always names the same action: a leg's notice ids are unique per run, a note's per page.
  // A panel note carries its own action; an L1 notice's follows its code.
  const noticeAction = useCallback((notice: NoticeEntry): NoticeAction | null => {
    const spec = noticeActionSpec(notice, notes);
    if (!spec) return null;
    const { key, fallback } = actionLabel(spec);
    return { label: t(key, fallback), run: () => runNoticeAction(spec) };
  }, [t, notes, runNoticeAction]);

  // The start gate both surfaces read (the subtitle session), in words.
  const idle = subtitle.idle;
  const missingDevice = idle.kind === 'unready' && idle.code === NO_MICROPHONE ? 'speaker' as const : null;

  const speakerLive = run.phase === 'running' && run.legs.speaker === 'live';
  const ptt = usePushToTalk({ enabled: speakerLive && subtitle.holdToTalk, press: runner.press, release: runner.release });
  const duration = useSessionClock(run);
  // The stored settings are the run's: they are locked while it is live.
  const canSendText = speakerLive && !!provider && providerSettings !== undefined && provider.textInput(providerSettings);

  // Mode picker: the active segment toggles its device popover; another segment switches the mode while idle.
  const [popover, setPopover] = useState<HTMLElement | null>(null);
  const onModeSegment = useCallback((target: AudioMode, el: HTMLElement) => {
    if (target === mode) { setPopover((open) => (open ? null : el)); return; }
    if (run.phase === 'idle') setMode(target);
    setPopover(null);
  }, [mode, run.phase, setMode]);

  const { notice: echo, dismiss: dismissEcho } = useEchoNotice(
    useMemo(() => (audio ? echoSource(audio.capture.echo) : null), [audio]),
    (state) => {
      reportWarning('MainPanel', `Echo detected: ${state.cause} (lag ${Math.round(state.lagMs)}ms, rho ${state.rho.toFixed(2)})`, { dedupeKey: 'echo' });
      trackEvent('echo_detected', { cause: state.cause, lag_ms: Math.round(state.lagMs) });
    },
  );
  const setEntryHint = useSetSubtitleEntryHint();
  const status = useStatusLine({ run, idle, canStart: subtitle.canStart, dismissedEnd, echo });
  const onDismissStatus = useCallback((what: 'echo' | 'subtitle-entry') => {
    if (what === 'echo') dismissEcho(); else setEntryHint(null);
  }, [dismissEcho, setEntryHint]);
  const testTone = useTestTone(audio);   // dev only: { playing, toggle } | undefined
  useUpdateAndAudioSystemListeners();    // today's two listener inits, pre-switch MainPanel.tsx:1111-1125

  // What the list draws counts (`shown`: the conversation and the notes after the transient rule, before a side filter, which can hide rows the user brings back), so an expired note never leaves Clear on over an empty list; a failed start's line counts too: after one it is all there is, and Clear takes it away.
  const hasConversation = shown.length > 0 || (status?.key.startsWith('last-end:') ?? false);
  // The extension overlay draws L1 only: while it runs, the notes show under the panel's placeholder (Ruling 8).
  const overlayNotes = useMemo(
    () => (takeover ? shown.filter((e): e is NoticeEntry => e.kind === 'notice' && isPanelNoteId(e.id)) : []),
    [takeover, shown],
  );
  const onClear = useCallback(() => {
    runner.clear();
    usePanelNotesStore.getState().clear();
    const now = runner.state.getState();
    if (now.phase === 'idle' && now.lastEnd) setDismissedEnd(now.lastEnd);
  }, [runner]);
  // Out of render (review Minor 8): the first call wires an AnalyserNode into the graph.
  const outputMeter = useMemo(() => audio?.playback.meter('virtual') ?? null, [audio]);
  const footer = (site: 'basic' | 'advanced') => (
    <PanelFooter
      site={site} run={run} mode={mode} missingDevice={missingDevice}
      canStart={subtitle.canStart}
      holdToTalk={speakerLive && subtitle.holdToTalk} held={ptt.held} micMuted={micMuted}
      pair={subtitle.pair} duration={duration}
      // Ruling 11: `session.start` is the one start every surface calls — never a start while the gate is shut, the button is off then; this also holds for a click that beat its render (as the takeover's Start).
      onStart={() => void session.start('button')}
      onStop={() => void runner.stop('button')}
      onPress={ptt.press} onRelease={ptt.release}
      onModeSegment={onModeSegment} onLanguages={() => navigateToSettings('languages')}
      testTone={site === 'advanced' ? testTone : undefined}
      waveforms={site === 'advanced' ? { input: <InputWaveforms mode={mode} levels={audio?.capture.levels ?? null} />, output: <OutputWaveform meter={outputMeter} /> } : undefined}
    />
  );

  return (
    <div className="main-panel-wrapper" style={{ '--conversation-bg-color': display.bgColor, '--conversation-source-color': display.sourceTextColor, '--conversation-translation-color': display.translationTextColor } as CSSProperties}>
      <Banners />
      <UpdateDialog />
      <div className="main-panel">
        {(!takeover || run.phase !== 'idle' || hasConversation) && (
          <PanelToolbar legs={subtitle.legs} exporter={exporter} hasConversation={hasConversation} onClear={onClear} />
        )}
        {takeover ? (
          <div className="conversation-display">
            <div className="empty-state">
              <Captions size={32} /><p>{t('mainPanel.subtitleTakeover', 'Translations are showing in the subtitle overlay')}</p>
              {overlayNotes.length > 0 && (
                <div className="conversation-list">
                  {overlayNotes.map((note) => <SystemRow key={note.id} notice={note} action={noticeAction(note)} />)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <ConversationList
            items={drawn} lit={lit} replaying={replaying} replayLegs={replayLegs}
            canReplay={(id) => { const s = segments.get(id); return !!s?.final && s.speech.some((e) => e.pcm.length > 0); }}
            onReplay={(leg, id) => {
              if (!audio) return;
              // The replay that is playing: its button stops it (today's toggle, pre-switch MainPanel.tsx:3543-3551).
              if (replaying === id) { audio.playback.stopReplay(); return; }
              const s = segments.get(id);
              if (s) audio.playback.replay(leg, s);
            }}
            replayBlocked={blocked} noticeAction={noticeAction}
            compact={display.compactMode} fontSize={display.fontSize}
            empty={<><MessageSquare size={32} /><p>{t('simplePanel.startToBegin', 'Click Start to begin real-time translation')}</p></>}
          />
        )}
        {canSendText && <TypedText onSend={(text) => runner.sendText(text)} />}
        {status && <StatusLine entry={status} onAction={runNoticeAction} onDismiss={onDismissStatus} />}
        {footer(uiMode === 'advanced' ? 'advanced' : 'basic')}
      </div>
      <WarningModal
        isOpen={permission.warning !== null}
        onClose={permission.close}
        type={permission.warning}
        note={permission.warning === 'screen-recording-denied' && participantSources.length > 1
          ? t('audioPanel.screenRecordingHasAlternative', 'You can avoid this permission entirely: pick a specific application as the participant source instead. Applications only appear in that list while they are playing audio.')
          : null}
      />
      {popover && <ModeDevicePopover mode={mode} open anchorEl={popover} onClose={() => setPopover(null)} />}
    </div>
  );
}

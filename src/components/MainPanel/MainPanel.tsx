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
import { LOOPBACK_DENIED } from '../../lib/audio/capture/systemAudio';
import type { LegName } from '../../lib/conversation/types';
import { describeCause, reportError, reportWarning } from '../../lib/diagnostics/report';
import { NO_MICROPHONE } from '../../lib/session/shape';
import type { RunEnd, RunState } from '../../lib/session/types';
import { displayItems, type DisplayItem, type NoticeEntry } from '../../lib/view/filter';
import { lastEndItem } from '../../lib/view/lastEnd';
import { noticeText } from '../../lib/view/noticeText';
import { settingsTargetForCode } from '../../lib/view/noticeTargets';
import { getProvider } from '../../providers/registry';
import {
  useIsMicMuted,
  useMode,
  useParticipantSources,
  useSelectedParticipantSource,
  useSetMode,
  type AudioMode,
} from '../../stores/audioStore';
import { useCleanupAudioSystemListeners, useInitAudioSystemListeners } from '../../stores/audioSystemStore';
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import {
  useKeepReplayAudio,
  useNavigateToSettings,
  useParticipantDisplayMode,
  useSpeakerDisplayMode,
  useSubtitleModeActive,
  useUIMode,
} from '../../stores/settingsStore';
import { useCleanupUpdateListeners, useInitUpdateListeners } from '../../stores/updateStore';
import { getEnvironment, isExtension } from '../../utils/environment';
import AudioSystemBanner from '../AudioSystemBanner/AudioSystemBanner';
import { ConversationList, type NoticeAction } from '../Conversation/ConversationList';
import { useConversationExporter } from '../Conversation/useConversationExporter';
import { useReadable } from '../Conversation/useReadable';
import EchoNotice from '../EchoNotice/EchoNotice';
import { echoSource, useEchoNotice } from '../EchoNotice/useEchoNotice';
import WarningModal from '../Settings/shared/WarningModal';
import UpdateBanner from '../UpdateBanner/UpdateBanner';
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

/** Today's update and audio-system listener inits (`MainPanel.tsx:1111-1125`), verbatim. */
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
  const subtitleModeActive = useSubtitleModeActive();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const mode = useMode();
  const setMode = useSetMode();
  const micMuted = useIsMicMuted();
  const participantSources = useParticipantSources();
  const participantSource = useSelectedParticipantSource();
  const provider = useProviderStore((s) => (s.selected ? getProvider(s.selected) : undefined));
  const display = useConversationDisplayStore();

  // The conversation: the view's entries through the display filter, reusing unchanged lines (ruling 14), then why the last start did not happen.
  const previous = useRef<readonly DisplayItem[]>([]);
  const drawn = useMemo(() => {
    const next = displayItems(viewState.entries, { speaker: speakerMode, participant: participantMode }, previous.current);
    previous.current = next;
    return next;
  }, [viewState.entries, speakerMode, participantMode]);
  // Clear dismisses the idle line too. The end stays on the runner, which the
  // subtitle surfaces read, so the panel keeps the end it cleared, by
  // reference: a later end is another object and draws again.
  const [dismissedEnd, setDismissedEnd] = useState<RunEnd | null>(null);
  const lastEnd = useMemo(
    () => (run.phase === 'idle' && run.lastEnd !== undefined && run.lastEnd === dismissedEnd ? null : lastEndItem(run)),
    [run, dismissedEnd],
  );
  const items = useMemo(() => (lastEnd ? [...drawn, lastEnd] : drawn), [drawn, lastEnd]);
  const segments = useMemo(() => new Map(viewState.legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const))), [viewState.legs]);
  const replayLegs = useMemo(() => new Set<LegName>(keepReplayAudio ? (participantSpeech ? ['speaker', 'participant'] : ['speaker']) : []), [keepReplayAudio, participantSpeech]);
  const participantNoticeCodes = useMemo(
    () => viewState.legs.find((leg) => leg.leg === 'participant')?.notices.flatMap((n) => (n.code ? [n.code] : [])) ?? [],
    [viewState.legs],
  );
  const blocked = replayBlocked({ run, platform: getEnvironment(), participantSourceId: participantSource?.deviceId, participantNoticeCodes })
    ? t('mainPanel.replayBlockedWholeSystem', "Replay is off while Other's audio captures all system sound: it would be translated again.")
    : null;

  const permission = usePermissionWarning(run, viewState.legs);
  const openWarning = permission.open;
  // Stable for the panel's life (`t`, the store action and `open` are), so the list's per-notice cache holds (ruling 14).
  // That cache is never pruned: one entry per notice drawn, for the panel's life — a page's worth. An id always names
  // the same action: a leg's notice ids are unique per run, and an end's names its code (`lastEndItem`).
  const noticeAction = useCallback((notice: NoticeEntry): NoticeAction | null => {
    if (notice.code === LOOPBACK_DENIED) return { label: t('audioPanel.openSystemSettings', 'Open System Settings'), run: () => openWarning('screen-recording-denied') };
    const target = settingsTargetForCode(notice.code);
    return target ? { label: t('settings.title', 'Settings'), run: () => navigateToSettings(target) } : null;
  }, [t, navigateToSettings, openWarning]);

  // The start gate both surfaces read (the subtitle session), in words.
  const idle = subtitle.idle;
  const startBlockMessage = run.phase === 'idle' && !subtitle.canStart && idle.kind === 'unready'
    ? noticeText(t, { code: idle.code, params: idle.params, message: idle.message })
    : undefined;
  const missingDevice = idle.kind === 'unready' && idle.code === NO_MICROPHONE ? 'speaker' as const : null;

  const speakerLive = run.phase === 'running' && run.legs.speaker === 'live';
  const ptt = usePushToTalk({ enabled: speakerLive && subtitle.holdToTalk, press: runner.press, release: runner.release });
  const duration = useSessionClock(run);
  const canSendText = speakerLive && !!provider?.textInput;

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
  const testTone = useTestTone(audio);   // dev only: { playing, toggle } | undefined
  useUpdateAndAudioSystemListeners();    // today's two listener inits, MainPanel.tsx:1111-1125

  const takeover = subtitleModeActive && isExtension();
  // The idle line counts: after a failed start it is all there is, and Clear takes it away.
  const hasConversation = viewState.entries.length > 0 || lastEnd !== null;
  const onClear = useCallback(() => {
    runner.clear();
    const now = runner.state.getState();
    if (now.phase === 'idle' && now.lastEnd) setDismissedEnd(now.lastEnd);
  }, [runner]);
  // Out of render (review Minor 8): the first call wires an AnalyserNode into the graph.
  const outputMeter = useMemo(() => audio?.playback.meter('virtual') ?? null, [audio]);
  const footer = (site: 'basic' | 'advanced') => (
    <PanelFooter
      site={site} run={run} mode={mode} missingDevice={missingDevice}
      canStart={subtitle.canStart} startBlockMessage={startBlockMessage}
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
      <UpdateBanner />
      <AudioSystemBanner />
      <UpdateDialog />
      <div className="main-panel">
        {(!takeover || run.phase !== 'idle' || hasConversation) && (
          <PanelToolbar legs={subtitle.legs} exporter={exporter} hasConversation={hasConversation} onClear={onClear} />
        )}
        {takeover ? (
          <div className="conversation-display">
            <div className="empty-state"><Captions size={32} /><p>{t('mainPanel.subtitleTakeover', 'Translations are showing in the subtitle overlay')}</p></div>
          </div>
        ) : (
          <ConversationList
            items={items} lit={lit} replaying={replaying} replayLegs={replayLegs}
            canReplay={(id) => { const s = segments.get(id); return !!s?.final && s.speech.some((e) => e.pcm.length > 0); }}
            onReplay={(leg, id) => {
              if (!audio) return;
              // The replay that is playing: its button stops it (today's toggle, `MainPanel.tsx:3543-3551`).
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
        {footer(uiMode === 'advanced' ? 'advanced' : 'basic')}
        <EchoNotice state={echo} onDismiss={dismissEcho} />
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

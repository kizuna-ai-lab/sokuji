import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {X, Zap, Mic, Loader, Wrench, Send, AlertCircle, MessageSquare, Trash2, AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown, Captions, Settings} from 'lucide-react';
import './MainPanel.scss';
import '../../styles/karaoke.scss';
import {
  useProvider,
  useUIMode,
  useLocalInferenceSettings,
  useIsApiKeyValid,
  useAvailableModels,
  useLoadingModels,
  useGetCurrentProviderSettings,
  useGetProcessedSystemInstructions,
  useGetProcessedLocalPrompt,
  useCreateSessionConfig,
  useTransportType,
  useNavigateToSettings,
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
  useSetSpeakerDisplayMode,
  useSetParticipantDisplayMode,
  useCurrentTurnDetectionMode,
  useSubtitleModeActive,
  useKeepReplayAudio,
  useTextOnly,
} from '../../stores/settingsStore';
import useSettingsStore, { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from '../../stores/settingsStore';
import type { SettingsStore } from '../../stores/settingsStore';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { isPushGatedMode } from '../../services/providers/speechMode';
import { SonioxProviderConfig, defaultSonioxSettings } from '../../services/providers/SonioxProviderConfig';
import { sonioxBothModePlan, type SonioxBothModePlan } from '../../services/providers/sonioxBothMode';
import { reverseTranscriptionDirection } from '../../services/providers/openaiTranscriptionContext';
import { reverseGeminiTranslationDirection } from '../../services/providers/geminiTranslateModel';
import { reversesDirectionViaSourceLanguage } from '../../services/providers/autoSourceReversal';
import {
  useConversationDisplayFontSize,
  useSetConversationDisplayFontSize,
  useConversationDisplayCompactMode,
  useSetConversationDisplayCompactMode,
  useConversationDisplayBgColor,
  useConversationDisplaySourceTextColor,
  useConversationDisplayTranslationTextColor,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../stores/conversationDisplayStore';
import useSessionStore, { useSession, useIsReconnecting, useSetIsReconnecting, useSetItems as useSetStoreItems, useSetParticipantItems as useSetStoreParticipantItems, useLockedMode, useSetLockedMode, useClearConversationVersion, useRequestClearConversation } from '../../stores/sessionStore';
import useAudioStore, { useAudioContext, useNoiseSuppressionMode, useMode, useSetMode, useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted, useSelectedParticipantSource, useParticipantSources } from '../../stores/audioStore';
import { resolveParticipantSourceId, needsLoopbackStream } from '../../lib/modern-audio/participantSource';
import { useLogActions } from '../../stores/logStore';
import { useNativeAsrLoading } from '../../stores/nativeModelStore';
import type { RealtimeEvent, EventData } from '../../stores/logStore';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ClientFactory, ResponseConfig } from '../../services/clients';
import type { VolcengineAST2SessionConfig, VolcengineSTSessionConfig, LocalInferenceSessionConfig, LocalNativeSessionConfig, OpenAITranslateSessionConfig, OpenAISessionConfig, TranslateTargetLanguage, ZoomAISessionConfig, SonioxSessionConfig, PalabraAISessionConfig, GeminiSessionConfig } from '../../services/interfaces/IClient';
import { WavRenderer } from '../../utils/wav_renderer';
import { ServiceFactory } from '../../services/ServiceFactory'; // Import the ServiceFactory
import { IAudioService } from '../../services/interfaces/IAudioService';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { clientErrorMessage } from '../../lib/apiErrorProps';
import { isDevelopment } from '../../config/analytics';
import { v4 as uuidv4 } from 'uuid';
import { Provider, isOpenAICompatible, kizunaBaseProvider, isKizunaManagedProvider } from '../../types/Provider';
import { computeStartGate, noChannelCameUp, reasonToI18n } from './sessionStartGate';
import { prepareManagedVoice, resolveVoicePrepOutcome } from './prepareManagedVoice';
import { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';
import { loadVoiceClip } from '../../lib/soniox/voiceClipStorage';
import { useSubtitleSessionBridge } from './useSubtitleSessionBridge';
import AudioFeedbackWarning from '../AudioFeedbackWarning/AudioFeedbackWarning';
import { getSafeAudioConfiguration, isPassthroughActive } from '../../utils/audioUtils';
import { useAuth } from '../../lib/auth/hooks';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { isExtension, isElectron, isLoopbackPlatform, getEnvironment } from '../../utils/environment';
import { formatRemainingTime } from '../../utils/formatters';
import { computeSonioxRemainingMs, computeSonioxBudgetTotalMs, SonioxBudgetSnapshot } from '../../services/clients/SonioxCostMeter';
import { ManagedSonioxSession } from '../../services/clients/ManagedSonioxSession';
import type { ClientOptions } from '../../services/providers/ProviderDescriptor';
import {
  managedLegOptions,
  resolveManagedSonioxWiring,
  resolveParticipantSlot,
  teardownSessionLegs,
} from './managedSonioxSplit';
import { KIZUNA_SIGN_IN_REQUIRED } from '../../services/providers/KizunaAISonioxProviderConfig';
import UpdateBanner from '../UpdateBanner/UpdateBanner';
import UpdateDialog from '../UpdateDialog/UpdateDialog';
import { useInitUpdateListeners, useCleanupUpdateListeners } from '../../stores/updateStore';
import AudioSystemBanner from '../AudioSystemBanner/AudioSystemBanner';
import { useInitAudioSystemListeners, useCleanupAudioSystemListeners } from '../../stores/audioSystemStore';
import DisplayModeButton from './DisplayModeButton';
import ConversationRow from './ConversationRow';
import { shouldShowItem } from './conversationFilter';
import ExportButton from './ExportButton';
import {
  useFloating, useClick, useDismiss, useRole, useInteractions, offset, flip, FloatingPortal,
} from '@floating-ui/react';
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
import { usePlaybackStore, usePlaybackHighlight } from '../../stores/playbackStore';
import ModePicker from './ModePicker';
import SplitDegradedChip from './SplitDegradedChip';
import { resolveSplitDegraded, type SplitDegradedReason } from './splitDegraded';
import { buildChannelTelemetryHandlers, type ChannelTelemetryPorts } from './participantTelemetry';
import { NO_CHANNELS_RECONNECTING, type ReconnectingState } from './reconnectingChannels';
import ModeDevicePopover from './ModeDevicePopover';
import WaveformStrip from './WaveformStrip';
import { isVirtualDevice, type WarningType } from '../Settings/shared/hooks';
import WarningModal from '../Settings/shared/WarningModal';


/** Local providers driven by a Silero VAD that PTT release finalizes the same way
 *  (trailing silence frames + createResponse → flush). */
function usesLocalSileroVad(provider: string): boolean {
  return provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE;
}

/** Soniox's built-in voice names. A `settings.voice` outside this set is a
 *  cloned-voice UUID, which is the only case that needs preparing. */
const SONIOX_BUILTIN_VOICES = new Set(
  new SonioxProviderConfig().getConfig().voices.map((v) => v.value)
);
const SONIOX_DEFAULT_VOICE = defaultSonioxSettings.voice;

// ---------------------------------------------------------------------------
// ConversationBubble – row renderer extracted from MainPanel.renderConversationItem
// so that Task 11 can call hooks (usePlaybackHighlight) per row without
// violating the rules-of-hooks (hooks cannot be called inside non-component
// functions / plain map callbacks).
// ---------------------------------------------------------------------------

interface ConversationBubbleProps {
  item: ConversationItem & { source?: string };
  index: number;
  /** Previous item that was rendered as a message row (used for header collapsing). */
  prevItem: (ConversationItem & { source?: string }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  canPlay: boolean;
  onPlay?: () => void;
  /** True when some other item (not this one) is playing; disables the play button. */
  someItemPlaying: boolean;
  uiMode: string;
  compact: boolean;
  replayEnabled: boolean;
}

const ConversationBubble: React.FC<ConversationBubbleProps> = ({
  item,
  index,
  prevItem,
  sourceLanguage,
  targetLanguage,
  canPlay,
  onPlay,
  someItemPlaying,
  uiMode,
  compact,
  replayEnabled,
}) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  const playDisabled = someItemPlaying && !isPlaying;
  const { t } = useTranslation();

  // Error bubble
  if (item.type === 'error') {
    return (
      <div key={`${(item as any).source || 'speaker'}_${item.id || index}`} className="message-bubble error">
        <div className="message-header">
          <AlertCircle size={12} />
          {t('mainPanel.error', 'Error')}
        </div>
        <div className="message-content error-content">
          {item.formatted?.text || t('mainPanel.unknownError', 'Unknown error')}
        </div>
      </div>
    );
  }

  const text = item.formatted?.transcript || item.formatted?.text || '';

  // Text / transcript bubble (common for both modes)
  if (text) {
    return (
      <ConversationRow
        key={`${(item as any).source || 'speaker'}_${item.id || index}`}
        item={item}
        prevItem={prevItem as (ConversationItem & { source?: 'speaker' | 'participant' }) | null}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        isPlaying={isPlaying}
        highlightedChars={highlightedChars}
        canPlay={canPlay}
        onPlay={onPlay}
        playDisabled={playDisabled}
        replayEnabled={replayEnabled}
        compact={compact}
      />
    );
  }

  // Advanced-only content types
  if (uiMode === 'advanced') {
    // Audio without transcript: audio still plays through the audio
    // service; we deliberately render no bubble. This used to render an
    // "Audio content" placeholder, but that fallback had no production
    // utility (no info beyond an icon, play button only in dev) and
    // produced ghost bubbles for translate sessions when the auto-create
    // recovery path kicked in (e.g. when output_transcript wasn't sent).

    // Tool calls
    if (item.formatted?.tool) {
      const toolArgs = item.formatted.tool.arguments;
      let formattedArgs = toolArgs;
      try {
        formattedArgs = JSON.stringify(JSON.parse(toolArgs), null, 2);
      } catch (e) { /* keep original */ }

      return (
        <div key={`${(item as any).source || 'speaker'}_${item.id || index}`} className={`message-bubble system`}>
          <div className="message-content">
            <div className="content-item tool-call">
              <div className="tool-name">{t('mainPanel.function')}: {item.formatted.tool.name}</div>
              <div className="tool-args"><pre>{formattedArgs}</pre></div>
            </div>
          </div>
        </div>
      );
    }

    // Tool outputs
    if (item.formatted?.output) {
      let formattedOutput = item.formatted.output;
      try {
        formattedOutput = JSON.stringify(JSON.parse(item.formatted.output), null, 2);
      } catch (e) { /* keep original */ }

      return (
        <div key={`${(item as any).source || 'speaker'}_${item.id || index}`} className={`message-bubble system`}>
          <div className="message-content">
            <div className="content-item tool-output">
              <div className="output-content"><pre>{formattedOutput}</pre></div>
            </div>
          </div>
        </div>
      );
    }
  }

  return null;
};

interface MainPanelProps {}

const MainPanel: React.FC<MainPanelProps> = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  
  // Get authentication state for Kizuna AI dynamic token fetching.
  // `userId` is read for the managed-voice prep block below: the reference
  // clip on this device belongs to an ACCOUNT, not to the device, so the
  // Start path has to name whose clip it is asking for. Without it, a clip
  // recorded by whoever signed in previously would be uploaded under the
  // account signed in now.
  const { getToken, isSignedIn, isLoaded, userId } = useAuth();
  
  // Get user profile and quota information
  const { quota, refetchAll } = useUserProfile();
  
  // State for session management
  const [isRecording, setIsRecording] = useState(false);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initProgress, setInitProgress] = useState<{ completed: number; total: number } | null>(null);
  // Distinct from initProgress: preparing a cloned voice can take ~10s of
  // uploading and building, and "Loading (1/3)…" would be a lie about what
  // the user is waiting for. Mirrors the nativeAsrLoading label swap.
  const [voicePreparing, setVoicePreparing] = useState(false);

  // Get settings from store
  const provider = useProvider();
  const uiMode = useUIMode();
  const subtitleModeActive = useSubtitleModeActive();
  const replayEnabled = useKeepReplayAudio();
  const subtitleTakeover = subtitleModeActive && isExtension();
  const conversationFontSize = useConversationDisplayFontSize();
  const setConversationFontSize = useSetConversationDisplayFontSize();
  const conversationCompactMode = useConversationDisplayCompactMode();
  const setConversationCompactMode = useSetConversationDisplayCompactMode();
  const conversationBgColor = useConversationDisplayBgColor();
  const conversationSourceTextColor = useConversationDisplaySourceTextColor();
  const conversationTranslationTextColor = useConversationDisplayTranslationTextColor();
  const speakerDisplayMode = useSpeakerDisplayMode();
  const participantDisplayMode = useParticipantDisplayMode();
  const setSpeakerDisplayMode = useSetSpeakerDisplayMode();
  const setParticipantDisplayMode = useSetParticipantDisplayMode();
  const localInferenceSettings = useLocalInferenceSettings();
  const transportType = useTransportType();
  const isApiKeyValid = useIsApiKeyValid();
  const availableModels = useAvailableModels();
  const loadingModels = useLoadingModels();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
  const getProcessedSystemInstructions = useGetProcessedSystemInstructions();
  const getProcessedLocalPrompt = useGetProcessedLocalPrompt();
  const createSessionConfig = useCreateSessionConfig();
  const navigateToSettings = useNavigateToSettings();

  // Get session state from context
  const {
    isSessionActive,
    setIsSessionActive,
    sessionId,
    setSessionId,
    sessionStartTime,
    setSessionStartTime,
    translationCount,
    setTranslationCount
  } = useSession();

  const isReconnecting = useIsReconnecting();
  const nativeAsrLoading = useNativeAsrLoading();
  const setIsReconnecting = useSetIsReconnecting();

  // Store setters for mirroring local items state into sessionStore
  const setStoreItems = useSetStoreItems();
  const setStoreParticipantItems = useSetStoreParticipantItems();
  const clearConversationVersion = useClearConversationVersion();
  const requestClearConversation = useRequestClearConversation();

  // Get log functions from store
  const { addRealtimeEvent } = useLogActions();

  // Get audio context from context
  const {
    // Mic
    selectedInputDevice,
    // Monitor
    selectedMonitorDevice,
    selectMonitorDevice,
    // Ancillary
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
  } = useAudioContext();

  // Noise suppression
  const noiseSuppressionMode = useNoiseSuppressionMode();

  // Track if current session is using WebRTC transport
  const [isUsingWebRTC, setIsUsingWebRTC] = useState(false);

  // Per-channel active flags. Distinct from `isSessionActive` (which is true
  // when at least one channel is up) so the UI can render channel-specific
  // affordances (PTT button for speaker only, etc.).
  const [speakerChannelActive, setSpeakerChannelActive] = useState(false);
  const [participantChannelActive, setParticipantChannelActive] = useState(false);

  // "Split did not take effect": a managed split Both session whose
  // participant leg never came up. The session is fine and continues one-way
  // (decision 4), but nothing else on screen says so — the mode picker still
  // reads Both and the countdown still runs, and that countdown was budgeted
  // at the SPLIT aggregate rate, so it burns down about twice as fast as a
  // one-way session's would. What the user LOSES here is session time, not
  // money: charging is provider cost × K per usage log, and a leg that never
  // opened a socket produces no usage log and no charge. Held as plain React
  // state, NOT as a conversation item: it must persist for the whole session
  // rather than scroll away, and it must be visible in basic UI mode where
  // there is no participant waveform to be missing.
  const [splitDegraded, setSplitDegraded] = useState<SplitDegradedReason | null>(null);

  // supportsTextInput is true for providers that support text input
  const supportsTextInput = useMemo(() => {
    return provider === Provider.OPENAI ||
           provider === Provider.GEMINI ||
           provider === Provider.OPENAI_COMPATIBLE ||
           provider === Provider.LOCAL_INFERENCE ||
           provider === Provider.LOCAL_NATIVE;
  }, [provider]);

  // Current provider's Speech Mode (turnDetectionMode), or 'Auto' for providers without one
  const currentTurnDetectionMode = useCurrentTurnDetectionMode();

  // True when the active mode uses space-hold to send audio (PTT, OpenAI's 'Disabled',
  // or Push-to-Translate). Derives directly from currentTurnDetectionMode so the
  // keyboard handler stays in sync with mode changes without imperative setters.
  const canHoldToSpeak = useMemo(
    () => isPushGatedMode(provider, currentTurnDetectionMode),
    [provider, currentTurnDetectionMode]
  );

  // Advanced mode text input state
  const [advancedTextInput, setAdvancedTextInput] = useState('');
  const [isAdvancedSending, setIsAdvancedSending] = useState(false);

  // Session duration for footer display
  const [sessionDuration, setSessionDuration] = useState<string>('00:00');

  // Text-only mode (no spoken translation). Fed to computeStartGate, which
  // uses it to pick the managed-Soniox balance floor: that provider's backend
  // refuses to issue a session key below what its shortest session (60s) would
  // consume at the CONSERVATIVE AGGREGATE rate of the stream set that session
  // opens — not at any SKU list price — and text-only opens one fewer stream
  // than speech-to-speech. The balance gate itself lives in sessionStartGate.ts
  // so the subtitle window applies the identical rule.
  const textOnly = useTextOnly();

  // Footer-level mode reflects user INTENT (which channels are toggled on).
  // Reads directly from audioStore — setMode is the single source of truth.
  const currentMode = useMode();
  const setMode = useSetMode();

  // Mute flags — canonical new state that mid-session effects and the
  // participant waveform render gate read from.
  const isMicMuted = useIsMicMuted();
  const isMonitorMuted = useIsMonitorMuted();
  const isParticipantMuted = useIsParticipantMuted();

  // Flipped once audioServiceRef.current is populated, so effects that attach
  // handlers to the service run again after it exists.
  const [audioServiceReady, setAudioServiceReady] = useState(false);

  // A capture helper that reports unbroken silence almost always means the OS
  // denied audio access - macOS TCC zeroes every sample instead of failing, so
  // the session would otherwise look healthy and translate nothing.
  useEffect(() => {
    const service = audioServiceRef.current;
    if (!service) return;
    service.onParticipantWarning = (code: string) => {
      if (code === 'app_capture_lost_using_system_audio') {
        addRealtimeEvent(
          {
            type: 'participant.warning',
            data: {
              message: t(
                'audioPanel.participantFellBackToSystemAudio',
                'Capture of the selected application stopped, so all system audio is being translated instead. Pick the application again to narrow it back.'
              ),
            },
          },
          'client', 'participant.warning'
        );
        return;
      }
      if (code !== 'silent_no_permission') return;
      addRealtimeEvent(
        {
          type: 'participant.warning',
          data: {
            message: t(
              'audioPanel.participantSilentNoPermission',
              'The selected application is sending no audio. If you are on macOS, allow Sokuji under System Settings > Privacy & Security > System Audio Recording Only, then restart the session.'
            ),
          },
        },
        'client', 'participant.warning'
      );
      setPermissionWarning('audio-capture-denied');
    };
    return () => { service.onParticipantWarning = null; };
  }, [audioServiceReady, addRealtimeEvent, t]);

  // A capture permission the OS denied. Rendered as a modal with a button that
  // deep-links to the exact System Settings pane, because both denials are
  // otherwise invisible: screen recording aborts the session with only a log
  // line, and a denied audio tap produces silence rather than an error.
  const [permissionWarning, setPermissionWarning] = useState<WarningType | null>(null);
  const participantSources = useParticipantSources();

  // Which application (or the whole system) participant audio is captured from.
  const selectedParticipantSource = useSelectedParticipantSource();
  // Tracks what capture is actually running, so the switch effect below fires
  // on a real change rather than on every re-render or list refresh.
  const activeParticipantSourceRef = useRef<string | null>(null);
  // Read through a ref: session start awaits several times, and a re-render in
  // between must not switch the source mid-acquisition.
  const participantSourceRef = useRef(selectedParticipantSource);
  useEffect(() => {
    participantSourceRef.current = selectedParticipantSource;
  }, [selectedParticipantSource]);

  // Switching the participant source mid-session, mirroring the microphone.
  // The picker is deliberately live during a session (it is gated on mode, not
  // on the session), so without this the selection changed and nothing acted on
  // it - capture stayed on whatever was chosen at start.
  useEffect(() => {
    if (!isSessionActive) {
      activeParticipantSourceRef.current = null;
      return;
    }
    const audioService = audioServiceRef.current;
    if (!audioService?.switchParticipantSource) return;

    const nextId = resolveParticipantSourceId(selectedParticipantSource);
    // First run after start records what the session began with; there is
    // nothing to switch to yet.
    if (activeParticipantSourceRef.current === null) {
      activeParticipantSourceRef.current = nextId;
      return;
    }
    if (activeParticipantSourceRef.current === nextId) return;

    const previousId = activeParticipantSourceRef.current;
    activeParticipantSourceRef.current = nextId;

    void (async () => {
      try {
        await audioService.switchParticipantSource!(nextId);
        trackEvent('audio_device_changed', {
          device_type: 'participant',
          device_name: selectedParticipantSource?.label,
          change_type: 'selected',
          during_session: true,
        });
      } catch (error: any) {
        console.error('[Sokuji] [MainPanel] Failed to switch participant source:', error);
        // The service puts the previous source back, so the ref has to follow
        // it; leaving it on the failed id would make re-selecting the source
        // that is actually running look like a no-op.
        activeParticipantSourceRef.current = previousId;
        addRealtimeEvent(
          {
            type: 'participant.warning',
            data: {
              message: t(
                'audioPanel.participantSourceSwitchFailed',
                'Could not switch the participant audio source. Stop and start the session to change it.'
              ),
            },
          },
          'client', 'participant.warning'
        );
      }
    })();
    // Depend on the id string, not the device object: device-enumeration
    // refreshes hand back a new object for an unchanged selection.
  }, [selectedParticipantSource?.deviceId, isSessionActive, addRealtimeEvent, t, trackEvent]);

  // Channel start predicates — evaluated pre-start. Used by canStartSession
  // and by connectConversation to decide which clients to create. Locked
  // after Start (settings disable on isSessionActive).
  //
  // Intent question: drives CLIENT CREATION on scope (mode), not mute state.
  // Mute is independent and only affects whether the recorder actually runs —
  // handled inside the session-start block (lines ~1497 mic, ~1510 monitor)
  // and via the mid-session mute effects. This matches spec: "connect client
  // … if muted at start, recorder is record() then immediately pause() so
  // unmute mid-session works trivially."
  const speakerWillStart = useMemo(
    () => (currentMode === 'speaker' || currentMode === 'both') && !!selectedInputDevice,
    // Depend on deviceId, not the device object — device-enumeration refreshes
    // recreate the object identity even when the selection hasn't changed.
    [currentMode, selectedInputDevice?.deviceId]
  );

  const participantWillStart = useMemo(
    () => currentMode === 'participant' || currentMode === 'both',
    [currentMode]
  );

  // Mode snapshot captured at session start. While non-null the picker
  // and any consumer of "effective mode" reads from this so mid-session
  // mute toggles don't visually change the locked mode. Stored in
  // sessionStore so the settings panel (a sibling render tree) can read
  // it too. Cleared on disconnect.
  const lockedMode = useLockedMode();
  const setLockedMode = useSetLockedMode();
  const effectiveMode = lockedMode ?? currentMode;

  // Which segment should show an amber warning (mode targeted but the
  // required device isn't actually selected/ready). Mirrors what the
  // existing canStartSession gate checks but at per-segment granularity.
  // Per spec: "canStartSession: True iff every in-scope channel has a device
  // selected. Mute state does not block start." Scope comes from mode, not
  // from mute flags.
  const missingDeviceForMode = useMemo<'speaker' | 'participant' | 'both' | null>(() => {
    const speakerInScope = currentMode === 'speaker' || currentMode === 'both';
    const participantInScope = currentMode === 'participant' || currentMode === 'both';
    const hasSpeaker = speakerInScope && !!selectedInputDevice;
    // Under the on/off pipeline-gate model, participant has no pre-session
    // device requirement. Electron acquires the single hardcoded loopback
    // source at session start; Extension uses tab capture (implicit).
    const hasParticipant = participantInScope;
    if (speakerInScope && !hasSpeaker) return participantInScope && !hasParticipant ? 'both' : 'speaker';
    if (participantInScope && !hasParticipant) return 'participant';
    return null;
  }, [currentMode, selectedInputDevice?.deviceId]);

  // Soniox reverses source/target for the participant client, and Gemini Live
  // Translate reverses `translationConfig.targetLanguageCode` — see
  // reversesDirectionViaSourceLanguage. An 'auto' source can't be reversed for
  // either: the participant's translate target would become the literal
  // 'auto', which Soniox one_way rejects and which is not a language code for
  // Gemini. So Others/Both with an 'auto' source can't start. Matches the
  // LanguageSection warning (`showAutoSourceParticipantWarning`); the user must
  // pick a concrete source first. `participantWillStart` ===
  // isParticipantChannelInScope.
  //
  // Resolves the EFFECTIVE provider (kizunaBaseProvider) and reads the
  // ACTIVE provider's settings slice via its descriptor's settingsSliceKey —
  // mirrors LanguageSection.showAutoSourceParticipantWarning exactly. A raw
  // `provider === Provider.SONIOX` check against the hardcoded `soniox` slice
  // (as this used to be) is always false for the KIZUNA_AI_SONIOX managed
  // twin, so this gate silently no-op'd for it: LanguageSection still showed
  // the warning (it already resolved the effective provider correctly), but
  // Start stayed enabled — clicking it left the participant channel's
  // connect() to fail non-fatally and silently (see the catch block around
  // participant client startup below, which now surfaces that failure).
  const activeProviderSourceLanguage = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { sourceLanguage?: string } | undefined)?.sourceLanguage
  );
  const activeProviderModel = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { model?: string } | undefined)?.model
  );
  const autoSourceParticipantBlocked =
    reversesDirectionViaSourceLanguage(provider, activeProviderModel) &&
    participantWillStart && activeProviderSourceLanguage === 'auto';

  // The stored shared/split preference, subscribed REACTIVELY through the same
  // descriptor-driven slice read as activeProviderSourceLanguage above. It has
  // to be a subscription rather than a getState() snapshot because the Start
  // gate's balance floor depends on it: flipping the toggle in the settings
  // panel must re-render the button, and a one-shot read would leave it
  // showing the other shape's floor until something unrelated re-rendered.
  // Selected as a PRIMITIVE, not as the slice object — a new object every
  // render would defeat Zustand's reference equality and re-render this panel
  // on every unrelated settings write.
  const activeProviderBothModeShared = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { bothModeSharedSession?: boolean } | undefined)?.bothModeSharedSession
  );

  // THE shared-vs-split answer for this render. One derived value, from the
  // same pure helper connectConversation calls below (with a getState()
  // snapshot instead of these selectors), so the Start-gate floor, the managed
  // session-key request and the client wiring cannot disagree about what this
  // session is. `effectiveMode` rather than `currentMode`: lockedMode is null
  // until a session starts, so the two are equal here, and using the same
  // input as connectConversation keeps the call sites literally identical.
  const sonioxBothSplit = useMemo(
    () => sonioxBothModePlan({
      provider,
      mode: effectiveMode,
      settings: {
        bothModeSharedSession: activeProviderBothModeShared,
        sourceLanguage: activeProviderSourceLanguage,
      },
    }).split,
    [provider, effectiveMode, activeProviderBothModeShared, activeProviderSourceLanguage],
  );

  // canStartSession requires the *intended* mode to have all its devices
  // ready (missingDeviceForMode === null). Mode is always one of the three
  // values: 'speaker', 'participant', or 'both'.
  //
  // The gate also carries WHY it is closed, so the tooltip below and the
  // subtitle window (via useSubtitleSessionBridge) explain the blocker with
  // one shared implementation. See sessionStartGate.ts.
  const startGate = useMemo(
    () => computeStartGate({
      isApiKeyValid,
      availableModelCount: availableModels.length,
      loadingModels,
      isInitializing,
      provider,
      quota,
      missingDeviceForMode,
      autoSourceParticipantBlocked,
      textOnly,
      // Split Both opens a second transcription stream, so managed Soniox's
      // balance floor roughly doubles. Same derived value the session wiring
      // uses, so the button and the session cannot disagree.
      sonioxBothSplit,
    }),
    [isApiKeyValid, availableModels.length, loadingModels, isInitializing, provider, quota, missingDeviceForMode, autoSourceParticipantBlocked, textOnly, sonioxBothSplit],
  );
  const canStartSession = startGate.canStart;

  // The blocker rendered as a sentence, resolved once. Both Start surfaces
  // below (the basic-mode button's title and the advanced-mode tooltip) read
  // this, so they cannot drift apart, and the balance interpolation arrives
  // already formatted as USD from reasonToI18n.
  const startBlockMessage = useMemo(() => {
    if (!startGate.reason) return undefined;
    const { key, defaultValue, values } = reasonToI18n(startGate.reason, startGate.balance);
    return t(key, defaultValue, values);
  }, [startGate.reason, startGate.balance, t]);

  // Footer mode picker — pre-session, click a segment to:
  //   1. Write the channel toggles to match the target mode (auto-mutes
  //      irrelevant channels via the per-channel setters).
  //   2. Auto-pick the first available device for any newly-enabled
  //      channel that has no device yet. So switching to Others/Both
  //      "just works" if devices have been enumerated, instead of
  //      landing in a half-configured state the user has to dig out of.
  //   3. Monitor is NOT touched — it's optional in You/Both modes and
  //      auto-mutex'd off when participant turns on.
  const handleModeSwitch = useCallback((target: 'speaker' | 'participant' | 'both') => {
    if (isSessionActive) return;
    setMode(target);
  }, [isSessionActive, setMode]);

  // Popover (re-click active segment) — anchored to the active segment ref
  // supplied by ModePicker via callback.
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [modePopoverAnchor, setModePopoverAnchor] = useState<HTMLElement | null>(null);

  // Reference for conversation container to enable auto-scrolling
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);

  // Mirror of `items` accessible from the player status callback, which is
  // registered in a []-dep effect and would otherwise see a stale snapshot.
  const itemsRef = useRef<ConversationItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Add state variables to track if test tone is playing and currently playing audio item
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);

  // Playback state is now managed by playbackStore
  const setPlayingItem = usePlaybackStore((s) => s.setPlayingItem);
  const setProgress = usePlaybackStore((s) => s.setProgress);
  const playingItemId = usePlaybackStore((s) => s.playingItemId);
  
  // Audio feedback warning state
  const [showFeedbackWarning, setShowFeedbackWarning] = useState(false);
  const [feedbackWarningDismissed, setFeedbackWarningDismissed] = useState(false);

  // AI response state for text input queueing (OpenAI only)
  const [isAIResponding, setIsAIResponding] = useState(false);
  const pendingTextRef = useRef<string | null>(null);

  // Display settings popover (conversation-toolbar ⚙)
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);
  const displayPopoverFloating = useFloating({
    open: displayPopoverOpen,
    onOpenChange: setDisplayPopoverOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip()],
  });
  // useRole wires aria-haspopup / aria-expanded / aria-controls on the
  // trigger button and role="dialog" / aria-modal on the floating wrapper.
  const displayPopoverInteractions = useInteractions([
    useClick(displayPopoverFloating.context),
    useDismiss(displayPopoverFloating.context),
    useRole(displayPopoverFloating.context, { role: 'dialog' }),
  ]);

  /**
   * Convert settings to SessionConfig
   */
  const getSessionConfig = useCallback((): SessionConfig => {
    // Get processed system instructions from the context
    const systemInstructions = (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE)
      ? getProcessedLocalPrompt(false)
      : getProcessedSystemInstructions();

    // Use the type-safe createSessionConfig from SettingsContext
    return createSessionConfig(systemInstructions);
  }, [provider, getProcessedLocalPrompt, getProcessedSystemInstructions, createSessionConfig]);

  /**
   * Better Auth session-token accessor for the relay-managed (kizuna) twins.
   * Mirrors the pre-descriptor behavior exactly: fetch a fresh token
   * (skipCache) only when a live, loaded, signed-in session exists; return
   * null otherwise so the descriptor's extractCredentials reports "sign in
   * required" instead of connecting with an empty token.
   */
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (getToken && isLoaded && isSignedIn === true) {
      try {
        return (await getToken({ skipCache: true })) || null;
      } catch (error) {
        console.error('[MainPanel] Failed to get fresh auth session for Kizuna AI:', error);
        return null;
      }
    }
    return null;
  }, [getToken, isLoaded, isSignedIn]);

  /**
   * Create the AI client for the current provider via its descriptor.
   * Credential shapes live in each provider's descriptor — MainPanel no longer
   * names provider-specific fields (apiKey / clientSecret / endpoint).
   */
  const createAIClient = useCallback(async (
    useWebRTC: boolean = false,
    // Managed Soniox only: the per-role credential bundle this client's ONE
    // stream runs on, plus the session it belongs to. Undefined for BYOK and
    // for every other provider, whose descriptors build credentials from
    // settings and ignore it.
    // Stated BY REFERENCE, never restated. A hand-written copy of this shape
    // lived here and drifted: it never gained `role`, so the argument was
    // checked against a type that did not want the field and the only signal
    // was a tsc error where it reached the descriptor. See managedLegOptions.
    sonioxManaged?: ClientOptions['sonioxManaged'],
  ): Promise<IClient> => {
    const descriptor = ProviderConfigFactory.getDescriptor(provider);
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
    // The managed Soniox twin's "credential" IS the better-auth session token,
    // and connectConversation has already spent it: acquire() exchanged it for
    // the temporary Soniox keys now sitting in sonioxManaged.credentials.
    // Re-running extractCredentials would fire a second
    // getToken({ skipCache: true }) round trip per Start for a value this path
    // no longer reads. The sign-in gate it used to provide is not lost — the
    // acquire path throws KIZUNA_SIGN_IN_REQUIRED when no token is available.
    const creds = sonioxManaged
      ? ({ ok: true, primary: '' } as const)
      : await descriptor.extractCredentials(slice, { getAuthToken });
    if (!creds.ok) throw new Error(creds.missing);

    // Determine transport type based on provider and useWebRTC flag.
    // For PalabraAI (LiveKit), treat as 'webrtc' mode for unified handling.
    const effectiveTransportType = (useWebRTC || provider === Provider.PALABRA_AI) ? 'webrtc' : 'websocket';

    // Native audio capture (MediaStreamTrack) applies only to descriptors that
    // truly run over WebRTC. PalabraAI is 'webrtc' transport but uses
    // appendInputAudio (not in supportsWebRTC), so it is NOT native capture —
    // this reproduces ClientFactory.usesNativeAudioCapture exactly.
    const usesNativeCapture = effectiveTransportType === 'webrtc' && descriptor.supportsWebRTC;

    // WebRTC options for native audio capture (OpenAI WebRTC).
    // The outputDeviceId enables direct audio playback through HTMLAudioElement, allowing
    // the browser's AEC to see the remote audio and cancel it from microphone input.
    // When mic is muted (input device "off"), don't pass inputDeviceId to prevent audio capture.
    const webrtcOptions = usesNativeCapture ? {
      inputDeviceId: !isMicMuted ? selectedInputDevice?.deviceId : undefined,
      outputDeviceId: selectedMonitorDevice?.deviceId
    } : undefined;

    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions, sonioxManaged });
  }, [provider, getAuthToken, selectedInputDevice?.deviceId, selectedMonitorDevice?.deviceId, isMicMuted]);

  // Which legs are reconnecting right now. A ref rather than state: these
  // transitions arrive from socket callbacks that can land several times in one
  // frame, and each needs the value the previous one wrote. The single rendered
  // `isReconnecting` boolean is derived from it inside the telemetry handlers.
  const reconnectingChannelsRef = useRef<ReconnectingState>(NO_CHANNELS_RECONNECTING);

  // Declared HERE, above createParticipantEventHandlers, and not next to the
  // countdown state further down: this value appears in that useCallback's
  // dependency array, which is evaluated during render at its own line. A
  // `const` declared later would be in its temporal dead zone at that moment
  // and throw on every render.
  const telemetryPortsFor = useCallback((): ChannelTelemetryPorts => ({
    addRealtimeEvent,
    trackApiError: (props) => trackEvent('api_error', props),
    provider: provider || Provider.OPENAI,
    readReconnecting: () => reconnectingChannelsRef.current,
    writeReconnecting: (next) => { reconnectingChannelsRef.current = next; },
    setIsReconnecting,
  }), [addRealtimeEvent, trackEvent, provider, setIsReconnecting]);

  /**
   * Helper to create event handlers for participant audio client
   */
  const createParticipantEventHandlers = useCallback((
    client: IClient
  ): ClientEventHandlers => ({
    // The participant leg is an independently failing provider stream in split
    // Both mode, so it reports its own errors and reconnects, tagged
    // 'participant'. Deliberately NO conversation bubble here, unlike the
    // speaker: `onConversationUpdated` below replaces the whole participant
    // list with `client.getConversationItems()`, which would wipe a manually
    // appended error item — the exact hazard participantErrorOrdering.test.ts
    // documents. Either leg dying already tears the session down via onClose
    // and the user sees that; what was missing was telemetry.
    ...buildChannelTelemetryHandlers('participant', telemetryPortsFor()),
    onRealtimeEvent: (realtimeEvent: RealtimeEvent) => {
      addRealtimeEvent(
        realtimeEvent.event,
        realtimeEvent.source,
        realtimeEvent.event?.type || 'unknown',
        'participant'
      );
    },
    onConversationUpdated: async ({ item, delta }: { item: ConversationItem; delta?: any }) => {
      // Tag item with source for display
      item.source = 'participant';

      // Skip audio delta - participant client is text-only
      if (delta?.audio) {
        return;
      }

      // Update participant items state
      setParticipantItems(client.getConversationItems());
    },
    onClose: async () => {
      // Recorded BEFORE the guard below, and unconditionally: this leg's
      // stream has ended, and that is true in every session phase. The guard
      // decides whether to TEAR DOWN, not whether the fact happened.
      //
      // It is load-bearing precisely where the guard returns early. Soniox
      // validates `api_key` only after the socket is open (connect() resolves
      // inside ws.onopen), so a refused participant key — a lapsed start
      // window is the reachable case, that key waits out the OS
      // screen-recording dialog — arrives as an error frame and a close in the
      // window between connect() resolving and setIsSessionActive(true).
      // Nothing tore down, `participantChannelStarted` was already true, and a
      // split session ran one-way at split rates saying nothing at all.
      participantStreamEndedRef.current = true;
      // Bail out if the session is already inactive. This handler can be invoked
      // by some clients (e.g. OpenAIClient) synchronously from disconnect() during
      // a user-initiated stop — disconnectConversation() has already cleared
      // isSessionActive at that point, so doing the teardown again would just
      // emit a duplicate analytics event and trip the re-entry guard.
      if (!useSessionStore.getState().isSessionActive) return;

      console.info('[Sokuji] [MainPanel] Participant client closed, tearing down session');

      // Track disconnection (analytics distinguishes unexpected client-side close from user stop)
      trackEvent('connection_status', {
        status: 'disconnected',
        provider: provider || Provider.OPENAI
      });

      // Symmetric teardown: participant death also tears down the speaker.
      // The re-entry guard inside disconnectConversation handles the case where
      // the speaker's own onClose is fired by speaker.disconnect() inside this
      // same call chain.
      await disconnectConversationRef.current?.();
    }
  }), [addRealtimeEvent, trackEvent, provider, telemetryPortsFor]);

  /**
   * Helper to create session config for participant mode (swapped languages, text-only, semantic VAD)
   */
  const createParticipantSessionConfig = useCallback((): SessionConfig | null => {
    const swappedSystemInstructions = (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE)
      ? getProcessedLocalPrompt(true)
      : getProcessedSystemInstructions(true);
    const baseConfig = createSessionConfig(swappedSystemInstructions);
    const config = {
      ...baseConfig,
      textOnly: true,
      // Override turn detection to use semantic VAD for participant audio (OpenAI-compatible)
      turnDetection: {
        type: 'semantic_vad' as const,
        createResponse: true,
        interruptResponse: false,
        eagerness: 'high',
      },
      // Force Auto mode for Gemini participant (no PTT for participant)
      ...(baseConfig.provider === 'gemini' ? { turnDetectionMode: 'Auto' as const } : {}),
    };

    // Gemini's dialogue models need nothing here: their direction rides in the
    // system instruction, which was already swapped above. A Live Translate
    // session does, because its `translationConfig.targetLanguageCode`
    // overrules that instruction — left alone, the participant session would
    // translate the other party's speech into the language they are already
    // speaking. No-op when no translationConfig is present.
    if (config.provider === 'gemini') {
      reverseGeminiTranslationDirection(config as GeminiSessionConfig);
    }

    // OpenAI Translate carries language direction only in `audio.output.language`
    // (not system instructions — translate doesn't accept instructions). Swap
    // targetLanguage to settings.sourceLanguage so the participant client
    // translates "their speech → user's language" instead of mirroring the
    // speaker's direction. If the user picked a sourceLanguage outside the
    // 13 supported targets, the swap may produce an invalid target — the UI
    // already warns about this combination, and the API will surface a clear
    // error if the user proceeds anyway.
    if (config.provider === 'openai_translate') {
      const tConfig = config as OpenAITranslateSessionConfig;
      const oldTarget: TranslateTargetLanguage = tConfig.targetLanguage;
      const oldSource: string | undefined = tConfig.sourceLanguage;
      // Cast: type-system can't validate at this layer; runtime gating is
      // the UI warning + API error message.
      tConfig.targetLanguage = (oldSource ?? oldTarget) as TranslateTargetLanguage;
      tConfig.sourceLanguage = oldTarget;
    }

    // OpenAI (and its compatible/Kizuna twins) carry the direction in
    // `instructions`, already reversed above — except for the transcription
    // hint, which is built from the user's source language. The participant
    // speaks the configured *target* language, so leaving the hint alone would
    // point their ASR at the wrong language, i.e. actively worse than sending
    // no hint at all. Rebuild it around the reversed direction; the glossary
    // carries over, since proper nouns are the same either way.
    if (config.provider === 'openai' || config.provider === 'cometapi') {
      reverseTranscriptionDirection(config as OpenAISessionConfig);
    }

    // Volcengine providers carry language direction in explicit config fields
    // (not system instructions), so we must swap sourceLanguage/targetLanguage
    // for the participant session to reverse the translation direction.
    if (config.provider === 'volcengine_ast2') {
      const ast2 = config as VolcengineAST2SessionConfig;
      [ast2.sourceLanguage, ast2.targetLanguage] = [ast2.targetLanguage, ast2.sourceLanguage];
    } else if (config.provider === 'soniox') {
      // Soniox carries direction in sourceLanguage/targetLanguage; reverse it so the
      // participant translates the other party's speech into the user's language.
      const sx = config as SonioxSessionConfig;
      [sx.sourceLanguage, sx.targetLanguage] = [sx.targetLanguage, sx.sourceLanguage];
    } else if (config.provider === 'palabraai') {
      // PalabraAI ignores `instructions` entirely — set_task carries the direction
      // in pipeline.transcription.source_language and
      // pipeline.translations[0].target_language, built from these two fields. Without
      // this swap the participant session transcribes the other party's speech under
      // the *user's* language and "translates" it back to the other party's language,
      // so the other party's own language comes out on both lines.
      //
      // The two fields use different code spaces (targets carry region suffixes like
      // en-us, sources don't), but the API strips the suffix before validating a
      // source, so a plain swap holds for every target we offer. In the other
      // direction five source languages aren't valid targets (eu, ga, mn, mt, ug);
      // picking one of those makes the reversed task fail with the API's
      // VALIDATION_ERROR, which arrives as a data message and surfaces through
      // handleError rather than throwing out of connect().
      const pa = config as PalabraAISessionConfig;
      [pa.sourceLanguage, pa.targetLanguage] = [pa.targetLanguage, pa.sourceLanguage];
    } else if (config.provider === 'local_native') {
      // Native ASR/translate carry the translation direction in
      // sourceLanguage/targetLanguage AND in the chosen model ids (a directional
      // Opus model bakes the direction in; a source-specific ASR only handles one
      // language). Reverse the direction and re-resolve both models for the
      // reversed pair — see createParticipantLocalNativeConfig.
      const result = createParticipantLocalNativeConfig(config as LocalNativeSessionConfig);

      if (!result.success) {
        addRealtimeEvent(
          { type: 'participant.error', data: { message: result.detail } },
          'client', 'participant.error'
        );
        return null;
      }

      if (!result.translationAvailable) {
        addRealtimeEvent(
          { type: 'participant.warning', data: { message: `No translation model for ${result.config.sourceLanguage} → ${result.config.targetLanguage} — transcription only` } },
          'client', 'participant.warning'
        );
      }

      return result.config;
    } else if (config.provider === 'volcengine_st') {
      const st = config as VolcengineSTSessionConfig;
      const oldSource = st.sourceLanguage;
      st.sourceLanguage = st.targetLanguages[0] || oldSource;
      st.targetLanguages = [oldSource];
    } else if (config.provider === 'zoom_ai') {
      const z = config as ZoomAISessionConfig;
      const oldSource = z.sourceLanguage;
      z.sourceLanguage = z.targetLanguages[0] || oldSource;
      z.targetLanguages = [oldSource];
    } else if (config.provider === 'local_inference') {
      const localConfig = config as LocalInferenceSessionConfig;
      const result = createParticipantLocalInferenceConfig(localConfig);

      if (!result.success) {
        const eventType = result.reason === 'memory_exceeded' ? 'participant.warning' : 'participant.error';
        addRealtimeEvent(
          { type: eventType, data: { message: result.detail } },
          'client', eventType
        );
        return null;
      }

      if (!result.status.translationAvailable) {
        addRealtimeEvent(
          { type: 'participant.warning', data: { message: `No translation model for ${localConfig.targetLanguage} → ${localConfig.sourceLanguage} — transcription only` } },
          'client', 'participant.warning'
        );
      }

      if (result.status.asrFallback) {
        addRealtimeEvent(
          { type: 'participant.info', data: { message: `Using ${result.status.asrModelId} instead of ${result.status.asrOriginalModelId} for ASR` } },
          'client', 'participant.info'
        );
      }

      return result.config;
    }

    return config;
  }, [provider, getProcessedLocalPrompt, getProcessedSystemInstructions, createSessionConfig, addRealtimeEvent]);

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

  /**
   * Initialize the audio service and set up the virtual audio output
   */
  useEffect(() => {
    // Initialize the audio service when the component mounts
    const initAudioService = async () => {
      try {
        // Get the audio service from the ServiceFactory
        const audioService = ServiceFactory.getAudioService();
        
        // Store the audio service in the ref for later use
        audioServiceRef.current = audioService;
        // Effects that need the service key off this rather than the ref: a ref
        // assignment does not re-run anything, so an effect that read the ref
        // before this point would never get a second chance.
        setAudioServiceReady(true);

        // Initialize the audio service
        await audioService.initialize();
      } catch (error) {
        console.error('[Sokuji] [MainPanel] Failed to initialize audio service:', error);
      }
    };
    
    initAudioService();

    // Release the microphone the instant the window/page is going away, so the
    // OS capture endpoint is freed cleanly rather than on abrupt process
    // teardown. Without this, closing and quickly reopening can leave the mic
    // stranded and the next launch's getUserMedia fails with
    // "NotReadableError: Could not start audio source" (Windows especially).
    // `pagehide` fires on window close / navigation / reload — but NOT on
    // minimize/hide (that's `visibilitychange`), so this never releases the mic
    // while the app is merely hidden. Guard against the bfcache case
    // (event.persisted) where the page is frozen and may be restored via
    // `pageshow` rather than torn down.
    const releaseMic = (event?: PageTransitionEvent) => {
      if (event?.persisted) return;
      audioServiceRef.current?.releaseMicrophone?.();
    };
    window.addEventListener('pagehide', releaseMic);

    // Cleanup only detaches the listener. Do NOT release the mic on unmount:
    // real teardown already goes through the non-persisted `pagehide` above,
    // and releasing here would stop capture during a StrictMode remount or any
    // future transition that unmounts MainPanel while a session is live.
    return () => {
      window.removeEventListener('pagehide', releaseMic);
    };
  }, []);

  // Whether raw-mic passthrough is currently audible to the outputs. Shared by
  // the passthrough setup, the feedback-warning effect, and the warning UI so
  // they never drift (mute always wins; see isPassthroughActive).
  const passthroughActive = useMemo(
    () =>
      isPassthroughActive({
        mode: currentTurnDetectionMode,
        isRecording,
        isMicMuted,
        legacyPassthroughEnabled: isRealVoicePassthroughEnabled,
      }),
    [currentTurnDetectionMode, isRecording, isMicMuted, isRealVoicePassthroughEnabled]
  );

  /**
   * Update passthrough settings when they change.
   * Push-to-translate mode hijacks passthrough: on @ 100% during idle,
   * off while user holds Space. Other modes use the legacy user setting.
   */
  useEffect(() => {
    const audioService = audioServiceRef.current;
    if (!audioService) return;

    const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

    const enabled = passthroughActive;

    const volume = isPushToTranslate
      ? 1.0                             // self-contained, ignore 0-60% cap
      : realVoicePassthroughVolume;

    audioService.setupPassthrough(enabled, volume);

    if (enabled) {
      console.debug('[Sokuji] [MainPanel] Updated passthrough settings: enabled=', enabled, 'volume=', volume, 'mode=', currentTurnDetectionMode);
    }
  }, [
    currentTurnDetectionMode,
    passthroughActive,
    realVoicePassthroughVolume,
    selectedInputDevice?.deviceId,
    selectedMonitorDevice?.deviceId,
    isMonitorMuted,
  ]);

  /**
   * Handle noise suppression toggle during active session.
   * Gated on speakerChannelActive: when only participant is active, the
   * speaker recorder isn't started, so calling setNoiseSuppressionMode on
   * it is at best a no-op and at worst an error.
   */
  useEffect(() => {
    if (!isSessionActive || !speakerChannelActive || !audioServiceRef.current) return;
    void audioServiceRef.current
      .getRecorder()
      .setNoiseSuppressionMode(noiseSuppressionMode)
      .catch((error: unknown) => {
        console.error('[Sokuji] [MainPanel] Failed to set noise suppression mode:', error);
      });
  }, [noiseSuppressionMode, isSessionActive, speakerChannelActive]);

  /**
   * Check for potential audio feedback and show warning.
   * Considers Push-to-translate's effective passthrough (always on @ 100% during idle)
   * in addition to the user-controlled isRealVoicePassthroughEnabled.
   */
  useEffect(() => {
    const effectivePassthroughEnabled = passthroughActive;

    if (feedbackWarningDismissed || !effectivePassthroughEnabled || isMonitorMuted) {
      setShowFeedbackWarning(false);
      return;
    }

    const safeConfig = getSafeAudioConfiguration(
      selectedInputDevice,
      selectedMonitorDevice,
      effectivePassthroughEnabled
    );

    if (!safeConfig.safePassthroughEnabled && safeConfig.recommendedAction) {
      setShowFeedbackWarning(true);
    } else {
      setShowFeedbackWarning(false);
    }
  }, [
    passthroughActive,
    selectedInputDevice,
    selectedMonitorDevice,
    feedbackWarningDismissed,
    isMonitorMuted,
  ]);

  /**
   * Instantiate:
   * - AI Client (API client)
   * - Audio service reference (handles recording)
   */

  const speakerClientRef = useRef<IClient | null>(null);

  // Participant client ref (for translating other participants)
  const participantClientRef = useRef<IClient | null>(null);

  // Has THIS session's participant leg lost its stream? Written by the leg's
  // own onClose (below) and read once, at connectConversation's
  // resolveSplitDegraded call. A ref rather than state because that read
  // happens in the same synchronous pass as the writes it must see, exactly
  // like `participantChannelStarted` — and because the fact has to be
  // recorded from an event handler that fires while the session is not yet
  // active, which is the one window where nothing else in this file reacts to
  // a dead participant leg. See splitDegraded.ts's `participantStreamEnded`.
  const participantStreamEndedRef = useRef<boolean>(false);

  // Ref to disconnectConversation — used by client onClose handlers, which are
  // captured inside setupClientListeners (a useCallback that runs before
  // disconnectConversation is defined). This avoids a forward reference cycle.
  const disconnectConversationRef = useRef<(() => Promise<void>) | null>(null);

  // Re-entry guard for disconnectConversation. We can NOT use isSessionActive
  // for this purpose because connectConversation() calls disconnectConversation
  // from its catch block during initialization failures BEFORE isSessionActive
  // has been set to true — a session-state-based guard would silently skip the
  // cleanup of a partially-opened recorder/client. The dedicated ref is set at
  // the start of disconnectConversation and cleared in finally regardless of
  // whether the cleanup succeeded or threw.
  const disconnectInProgressRef = useRef<boolean>(false);

  const [participantItems, setParticipantItems] = useState<ConversationItem[]>([]);

  // Mirror items into sessionStore so SubtitleApp can read them
  // after MainPanel unmounts (e.g. when entering subtitle mode).
  useEffect(() => {
    setStoreItems(items);
  }, [items, setStoreItems]);

  useEffect(() => {
    setStoreParticipantItems(participantItems);
  }, [participantItems, setStoreParticipantItems]);

  const clearConversation = useCallback(() => {
    // Cancel pending throttled update that would re-populate items
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    // Clear client internal conversation data (if session active)
    speakerClientRef.current?.clearConversationItems();
    participantClientRef.current?.clearConversationItems();
    // Clear React state
    setItems([]);
    setParticipantItems([]);
  }, []);

  // Watch for clear-conversation requests from anywhere in the app
  // (e.g. the SubtitleBar's clear button) — sessionStore.requestClearConversation
  // bumps a version counter and we run the local clearConversation logic
  // when that counter changes. The initial value is recorded once so the
  // first mount does not trigger a spurious clear.
  const lastClearVersionRef = useRef(clearConversationVersion);
  useEffect(() => {
    if (clearConversationVersion !== lastClearVersionRef.current) {
      lastClearVersionRef.current = clearConversationVersion;
      clearConversation();
    }
  }, [clearConversationVersion, clearConversation]);

  // Snapshots the source/target language pair at the moment each conversation
  // item is first seen, keyed by item id. Without this, badges in the history
  // would re-render against current settings — so ending a session and
  // switching languages would retroactively relabel previous rows.
  const itemLanguagesRef = useRef<Map<string, { sourceLanguage: string; targetLanguage: string }>>(new Map());

  // Combine speaker and participant items for display with source tagging
  const combinedItems = useMemo(() => {
    const liveSettings = getCurrentProviderSettings();
    const liveSourceLanguage = liveSettings.sourceLanguage ?? 'EN';
    const liveTargetLanguage = liveSettings.targetLanguage ?? 'EN';

    const tag = (item: ConversationItem, fallbackSource: 'speaker' | 'participant') => {
      let langs = itemLanguagesRef.current.get(item.id);
      if (!langs) {
        langs = { sourceLanguage: liveSourceLanguage, targetLanguage: liveTargetLanguage };
        itemLanguagesRef.current.set(item.id, langs);
      }
      return {
        ...item,
        source: item.source ?? fallbackSource,
        sourceLanguage: langs.sourceLanguage,
        targetLanguage: langs.targetLanguage,
      } as ConversationItem & { source: string; sourceLanguage: string; targetLanguage: string };
    };

    const speakerItems = items.map(item => tag(item, 'speaker'));
    const participantTagged = participantItems.map(item => tag(item, 'participant'));

    // Prune snapshots for items that no longer exist (handles clearConversation
    // and session restart, which empty both arrays).
    const liveIds = new Set<string>();
    for (const it of speakerItems) liveIds.add(it.id);
    for (const it of participantTagged) liveIds.add(it.id);
    for (const id of Array.from(itemLanguagesRef.current.keys())) {
      if (!liveIds.has(id)) itemLanguagesRef.current.delete(id);
    }

    // Merge and sort by createdAt timestamp for accurate ordering
    return [...speakerItems, ...participantTagged].sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [items, participantItems, getCurrentProviderSettings]);

  // Filter items based on UI mode and display mode
  const filteredItems = useMemo(() => {
    return combinedItems.filter(item => {
      const hasText = item.formatted?.transcript || item.formatted?.text;
      const audioSize =
        (item.formatted?.audio as any)?.length ?? (item.formatted?.audio as any)?.byteLength ?? 0;
      const isBasic =
        (item.type === 'error' ||
         item.role === 'user' ||
         item.role === 'assistant' ||
         item.role === 'system') && hasText;
      const passesUiMode = uiMode === 'basic'
        ? isBasic
        : (isBasic || item.formatted?.tool || item.formatted?.output ||
           (audioSize > 0 && !item.formatted?.transcript && !item.formatted?.text));
      if (!passesUiMode) return false;
      return shouldShowItem(item, speakerDisplayMode, participantDisplayMode);
    });
  }, [combinedItems, uiMode, speakerDisplayMode, participantDisplayMode]);

  // Session duration timer
  useEffect(() => {
    if (!isSessionActive || !sessionStartTime) {
      setSessionDuration('00:00');
      return;
    }
    const updateDuration = () => {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const h = Math.floor(elapsed / 3600);
      const m = Math.floor((elapsed % 3600) / 60);
      const s = elapsed % 60;
      setSessionDuration(
        h > 0
          ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      );
    };
    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [isSessionActive, sessionStartTime]);

  // Managed Soniox remaining-time countdown for the status footer. The
  // session's budget/rate/start-time are fixed for the whole session (see
  // SonioxCostMeter.getBudgetSnapshot), so this captures them once and then
  // re-evaluates the same pure wall-clock formula against Date.now() every
  // second — a smooth per-second countdown without polling the cost meter
  // itself, which only advances on the STT stream's ~5s keepalive tick.
  // Only the KIZUNA_AI_SONIOX managed twin has a budget to count down; BYOK
  // Soniox leases nothing, so no session is ever acquired for it.
  const sonioxBudgetInfoRef = useRef<SonioxBudgetSnapshot | null>(null);
  // The managed Soniox lease for the CURRENT session. Lives here, not in a
  // client, because it outlives any one client and because acquiring it is an
  // awaited round trip that ProviderDescriptor.createClient cannot make.
  const managedSonioxSessionRef = useRef<ManagedSonioxSession | null>(null);
  const [sonioxCountdown, setSonioxCountdown] = useState<{ remainingMs: number; totalMs: number } | null>(null);
  useEffect(() => {
    if (!isSessionActive || provider !== Provider.KIZUNA_AI_SONIOX) {
      sonioxBudgetInfoRef.current = null;
      setSonioxCountdown(null);
      return;
    }
    const update = () => {
      if (!sonioxBudgetInfoRef.current) {
        // The allowance belongs to the SESSION, not to a stream. Reading it off
        // a client would be ambiguous under split — two real clients, one
        // lease — and the ref is populated before any client is constructed,
        // for every managed row of the matrix including split, so the countdown
        // is non-null whenever a managed session is running.
        sonioxBudgetInfoRef.current =
          managedSonioxSessionRef.current?.getBudgetSnapshot() ?? null;
      }
      const info = sonioxBudgetInfoRef.current;
      setSonioxCountdown(info ? {
        remainingMs: computeSonioxRemainingMs(Date.now(), info),
        totalMs: computeSonioxBudgetTotalMs(info),
      } : null);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isSessionActive, provider]);
  // Below 20% of the session's granted budget, the countdown switches to a
  // stronger visual emphasis (see the `.low` class in MainPanel.scss).
  const sonioxRemainingLow = !!sonioxCountdown && sonioxCountdown.totalMs > 0
    && sonioxCountdown.remainingMs / sonioxCountdown.totalMs < 0.2;

  // Reference to audio service for accessing ModernAudioPlayer
  const audioServiceRef = useRef<IAudioService | null>(null);

  // Tracks whether connectSystemAudioSource succeeded in the current session.
  // Guards the session-end disconnectSystemAudioSource call so it only fires
  // when a source was actually acquired (avoids spurious calls on speaker-only
  // sessions or when loopback permission was denied).
  const systemAudioAcquiredRef = useRef<boolean>(false);

  // Reference to track push-to-talk duration
  const pushToTalkStartTimeRef = useRef<number | null>(null);

  // Reference to track non-silent audio chunks during push-to-talk
  const pttVoiceChunkCountRef = useRef<number>(0);

  // Detect if audio data is silent (threshold-based detection)
  const isSilentAudio = useCallback((audioData: Int16Array, threshold = 0.01): boolean => {
    if (!audioData?.length) return true;
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += Math.abs(audioData[i] / 32768);
    }
    return sum / audioData.length < threshold;
  }, []);
  
  // Reference to track audio quality metrics
  const audioQualityIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Simple throttling for UI updates to prevent freezing
  const lastUpdateTimeRef = useRef<number>(0);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const UPDATE_THROTTLE_MS = 50; // Throttle UI updates to max 20Hz
  
  // Debounce timer for clearing playingItemId on the player's 'ended' callback.
  // The player fires 'ended' on every itemQueue entry eviction (chunk
  // boundary), not just on true item end. Without debouncing, playingItemId
  // flaps null↔itemX between translate chunks, which (a) flickers the karaoke
  // highlight off/on and (b) wipes the cumulative-time tracker via the
  // playingItemId-change reset effect. (issue #216)
  const itemEndDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Constants for karaoke progress tracking
  const PROGRESS_UPDATE_INTERVAL = 100; // ms
  // Fallback wait for the 'in_progress' case: the player can't distinguish a
  // true item end from a mid-stream chunk gap (translate streams 200-400ms
  // chunks with up to ~2s silence between them), so we wait long enough for
  // a follow-up chunk to arrive before clearing the karaoke layer.
  const ITEM_END_DEBOUNCE_MS = 2500;
  // Fast path for the 'completed' case: once the producing client has
  // flipped item.status to 'completed', no more chunks are coming for this
  // item, so the chunk-gap ambiguity is gone and we clear immediately.
  // Paired with the worklet's starving-transition readPosition flush
  // (playback-ring-processor.js), which lets _checkAudibleItemChange fire
  // 'ended' the instant the buffer empties instead of after a 2s fallback.
  const ITEM_END_DEBOUNCE_COMPLETED_MS = 0;

  /**
   * References for rendering audio visualization (canvas)
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const systemCanvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Set up event listeners for the AI Client
   */
  const setupClientListeners = useCallback(async () => {
    const client = speakerClientRef.current;
    const audioService = audioServiceRef.current;

    if (!client || !audioService) return;

    const speakerTelemetry = buildChannelTelemetryHandlers('speaker', telemetryPortsFor());

    const eventHandlers: ClientEventHandlers = {
      onRealtimeEvent: (realtimeEvent: RealtimeEvent) => {
        addRealtimeEvent(
          realtimeEvent.event,
          realtimeEvent.source,
          realtimeEvent.event?.type || 'unknown',
          'speaker'
        );

        // Note: Error ConversationItems are now created in OpenAIClient.ts
        // to maintain consistent architecture with other clients

        // Track local inference init progress
        const eventType = realtimeEvent.event?.type;
        if (eventType === 'local.init.start') {
          const total = realtimeEvent.event?.data?.engines?.length ?? 3;
          setInitProgress({ completed: 0, total });
        } else if (eventType === 'local.init.asr.ready' || eventType === 'local.init.translation.ready' || eventType === 'local.init.tts.ready') {
          setInitProgress(prev => prev ? { ...prev, completed: prev.completed + 1 } : prev);
        }

        // Track AI response state for text input queueing (OpenAI only)
        if (eventType === 'response.created') {
          setIsAIResponding(true);
        } else if (eventType === 'response.done') {
          setIsAIResponding(false);
          // Send queued text if any
          if (pendingTextRef.current) {
            const text = pendingTextRef.current;
            pendingTextRef.current = null;
            // Small delay to ensure response is fully processed
            setTimeout(() => {
              speakerClientRef.current?.appendInputText(text);
            }, 100);
          }
        }
      },
      // Logging, api_error and the reconnect flag are identical for both legs
      // and now come from one place, tagged per channel — see
      // participantTelemetry.ts. The speaker keeps one extra behaviour the
      // participant deliberately does not have: a visible conversation bubble.
      onError: (event: any) => {
        speakerTelemetry.onError(event);
        // Speaker-only: the participant's list is replaced wholesale by its
        // onConversationUpdated, which would wipe an appended item.
        setItems(prevItems => [...prevItems, {
          id: `error-${Date.now()}`,
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: clientErrorMessage(event) },
        }]);
      },
      onReconnecting: speakerTelemetry.onReconnecting,
      onReconnected: speakerTelemetry.onReconnected,
      onClose: async (event: any) => {
        // Bail out if the session is already inactive. Some clients (e.g. OpenAIClient)
        // synchronously fire onClose from inside disconnect() during a user-initiated
        // stop — by then disconnectConversation() has already cleared isSessionActive,
        // so doing the teardown again would just emit a duplicate analytics event and
        // trip the re-entry guard. We only want this handler to fire on unexpected /
        // permanent failures.
        if (!useSessionStore.getState().isSessionActive) return;

        console.info('[Sokuji] [MainPanel] Speaker client closed, tearing down session', event);

        // Track disconnection (analytics distinguishes unexpected client-side close from user stop)
        trackEvent('connection_status', {
          status: 'disconnected',
          provider: provider || Provider.OPENAI
        });

        // Route through disconnectConversation — handles both clients, audio,
        // streaming tracks, profile refresh, and the re-entry guard.
        await disconnectConversationRef.current?.();
      },
      onConversationInterrupted: async () => {
        // Handle conversation interruption
        // const trackSampleOffset = await audioService.interruptAudio();
        // if (trackSampleOffset?.trackId) {
          // CRITICAL: Do not modify this section or cancel the response
          // This would break the simultaneous interpretation flow which is the core behavior of this application
          // Canceling the response would interrupt the AI's ongoing translation, going against the intended functionality
          // const { trackId, offset } = trackSampleOffset;
          // client.cancelResponse(trackId, offset);
        // }
      },
      onConversationUpdated: async ({ item, delta }: { item: ConversationItem; delta?: any }) => {
        // Handle error items specially - they are not stored in client's internal list
        if (item.type === 'error') {
          setItems(prevItems => [...prevItems, item]);
          return;
        }

        // Handle audio delta separately - send to player but skip UI update
        if (delta?.audio) {
          // Always stream assistant audio - monitor on/off is handled by global volume
          // Note: WebRTC's HTMLAudioElement is muted, so ModernAudioPlayer handles all playback
          // User audio should NOT be played back to avoid echo
          const shouldPlayAudio = item.role === 'assistant';

          // Use a consistent trackId for all AI assistant audio to ensure proper queuing
          // Pass item.id and sequence info as metadata for ordering and tracking
          audioService.addAudioData(delta.audio, 'ai-assistant', shouldPlayAudio, {
            itemId: item.id,
            sequenceNumber: delta.sequenceNumber,
            timestamp: delta.timestamp
          });

          // IMPORTANT: Skip UI update for audio-only deltas to prevent freezing
          // Audio will play smoothly without updating the React state
          return;
        }
        
        // Simple throttling: skip updates that are too frequent
        // Uses trailing timeout to ensure the last update always renders
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
        if (timeSinceLastUpdate < UPDATE_THROTTLE_MS) {
          // Schedule a trailing update so the last message always renders
          if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = setTimeout(() => {
            lastUpdateTimeRef.current = Date.now();
            setItems(client.getConversationItems());
          }, UPDATE_THROTTLE_MS);
          return;
        }
        lastUpdateTimeRef.current = now;

        // Increment translation count when assistant item is completed
        if (item.status === 'completed' && item.role === 'assistant' && 
            (item.formatted?.text || item.formatted?.transcript)) {
          setTranslationCount(prevCount => prevCount + 1);
          
          // Track translation completion with latency
          if (item.createdAt) {
            const translationLatency = Date.now() - new Date(item.createdAt).getTime();
            trackEvent('translation_completed', {
              session_id: sessionId || '',
              source_language: getCurrentProviderSettings().sourceLanguage,
              target_language: getCurrentProviderSettings().targetLanguage,
              latency_ms: translationLatency,
              provider: provider || Provider.OPENAI
            });
            
            trackEvent('latency_measurement', {
              operation: 'translation',
              latency_ms: translationLatency,
              provider: provider
            });
          }
        }
        
        // Update UI state
        setItems(client.getConversationItems());
      }
    };

    client.setEventHandlers(eventHandlers);
    setItems(client.getConversationItems());
  }, [
    isMonitorMuted,
    provider,
    sessionId,
    getCurrentProviderSettings,
    setTranslationCount,
    trackEvent,
    addRealtimeEvent,
    setIsSessionActive,
    setIsReconnecting,
    telemetryPortsFor
  ]); // addRealtimeEvent from Zustand is stable

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    // Re-entry guard: when one client's onClose calls this and we then disconnect
    // the OTHER client, that client's onClose also calls this. We track the
    // in-progress state in a dedicated ref (NOT isSessionActive) so the guard
    // also works when connectConversation()'s catch block calls us during an
    // initialization failure — at that point isSessionActive has not yet been
    // set to true, so a session-state-based guard would silently skip the
    // cleanup of the partially-opened recorder/client.
    if (disconnectInProgressRef.current) {
      console.info('[Sokuji] [MainPanel] disconnectConversation re-entry blocked (already in progress)');
      return;
    }
    disconnectInProgressRef.current = true;

    try {
      // Both the derived boolean and the set it is derived from: a leg still
      // listed as reconnecting here would survive into the next session and
      // pin its banner on.
      reconnectingChannelsRef.current = NO_CHANNELS_RECONNECTING;
      setIsReconnecting(false);
      setIsSessionActive(false);
      setIsAIResponding(false);
      setIsUsingWebRTC(false);
      setSpeakerChannelActive(false);
      setParticipantChannelActive(false);
      // The indicator describes the RUNNING session; it goes when it does.
      setSplitDegraded(null);
      setLockedMode(null);
      pendingTextRef.current = null;

      // Clear audio quality tracking interval
      if (audioQualityIntervalRef.current) {
        clearInterval(audioQualityIntervalRef.current);
        audioQualityIntervalRef.current = null;
      }

      // setItems([]);

      const audioService = audioServiceRef.current;
      if (audioService) {
        // First pause the recorder to stop sending audio chunks
        try {
          await audioService.pauseRecording();
        } catch (error: any) {
          // Silently ignore if recording was never started (expected in push-to-talk mode)
          if (!error?.message?.includes('begin()')) {
            console.warn('[Sokuji] [MainPanel] Error pausing recorder during disconnect:', error);
          }
        }

        // Stop system audio recording and release the loopback stream on Electron.
        if (audioService.isSystemAudioRecordingActive()) {
          try {
            await audioService.stopSystemAudioRecording();
            console.info('[Sokuji] [MainPanel] Stopped system audio recording');
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error stopping system audio recording:', error);
          }
        }
        if (isElectron() && !isExtension() && systemAudioAcquiredRef.current) {
          try {
            await audioService.disconnectSystemAudioSource();
            systemAudioAcquiredRef.current = false;
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Failed to disconnect system audio source:', error);
          }
        }

        // Stop tab audio recording (extension environment)
        if (audioService.isTabAudioRecordingActive?.()) {
          try {
            await audioService.stopTabAudioRecording();
            console.info('[Sokuji] [MainPanel] Stopped tab audio recording');
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error stopping tab audio recording:', error);
          }
        }
      }

      // Small delay to ensure any in-flight audio processing completes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Both legs come down here, and the managed session's end is signalled
      // exactly once AFTER both of them — see teardownSessionLegs for why the
      // ordering is load-bearing, and why its two nested `finally`s are what
      // make a throw in either leg unable to strand the other leg's socket or
      // the lease. In split Both the participant ref is a REAL second
      // SonioxClient, not the inert secondary port of the shared path.
      await teardownSessionLegs({
        speaker: async () => {
          const client = speakerClientRef.current;
          if (!client) return;
          // disconnect() emits final completion deltas via the throttle path,
          // which schedules a trailing setItems(client.getConversationItems())
          // via setTimeout. If we then call client.reset() (which empties the
          // client's internal items), the trailing timer fires *after* reset
          // and pushes [] to React, blanking the conversation. This is most
          // visible with high-delta-rate providers like OpenAI Translate where
          // a throttle timer is almost always pending when the user hits stop
          // mid-utterance.
          //
          // Fix: after disconnect() finalizes any in-flight pair, cancel the
          // pending throttle timer and synchronously capture the final state
          // into React, then reset.
          //
          // Guarded because the managed Soniox lease release now depends on
          // reaching the steps after it: SonioxClient.disconnect() used to POST
          // session-end early inside itself, so a throw later in teardown could
          // not strand the lease. It posts nothing now. The steps after it must
          // run too: they are what stop the trailing throttle timer from
          // blanking the transcript.
          try {
            await client.disconnect();
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting speaker client:', error);
          }
          if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }
          setItems(client.getConversationItems());
          client.reset();
        },
        participant: async () => {
          const participantClient = participantClientRef.current;
          if (!participantClient) return;
          try {
            await participantClient.disconnect();
            participantClient.reset();
            participantClientRef.current = null;
            console.info('[Sokuji] [MainPanel] Disconnected participant client');
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
          }
        },
        afterBothLegs: () => {
          // ONE session-end per session, after every client is down.
          // SonioxClient.disconnect() used to post it unconditionally, and this
          // function disconnects the speaker first — so with two legs the first
          // teardown would signal the end (and unpin the voice slot) while the
          // other was still streaming. A no-op when no lease was acquired, and
          // idempotent, so the connect-failure path through here is safe. The
          // ref is cleared BEFORE end() so no re-entry can produce a second POST.
          const managedSoniox = managedSonioxSessionRef.current;
          managedSonioxSessionRef.current = null;
          managedSoniox?.end();
        },
      });

      // Now fully end the recorder after client is reset
      if (audioService) {
        try {
          await audioService.stopRecording();
        } catch (error: any) {
          // Silently ignore if recording was never started (expected in push-to-talk mode)
          if (!error?.message?.includes('begin()')) {
            console.warn('[Sokuji] [MainPanel] Error ending recorder:', error);
          }
        }

        // Interrupt any playing audio
        await audioService.interruptAudio();
        // Clear the unified AI assistant streaming track
        audioService.clearStreamingTrack('ai-assistant');
        // Clear system audio assistant streaming track
        audioService.clearStreamingTrack('system-audio-assistant');
      }

      // Refresh user profile and quota after session ends
      // This ensures the wallet balance is updated after usage
      if (refetchAll) {
        refetchAll().catch(error => {
          console.warn('[Sokuji] [MainPanel] Error refreshing user profile:', error);
        });
      }
    } finally {
      disconnectInProgressRef.current = false;
    }
  }, [refetchAll, setIsReconnecting]);

  // Keep the ref in sync so client onClose handlers can call disconnectConversation
  // without creating a useCallback dep cycle. The ref is read inside async event
  // handlers, so a one-render lag is acceptable.
  useEffect(() => {
    disconnectConversationRef.current = disconnectConversation;
  }, [disconnectConversation]);

  /**
   * Connect to conversation:
   * ModernAudioRecorder takes speech input, audio service provides output, client is API client
   */
  const connectConversation = useCallback(async () => {
    try {
      setIsInitializing(true);
      setInitProgress(null);
      // Clear last session's indicator before anything can set this one's.
      // Not redundant with the disconnectConversation reset: the post-init
      // "both channels failed" guard below returns early WITHOUT routing
      // through disconnectConversation, so that path relies on this one.
      setSplitDegraded(null);
      // And the late fact that feeds it. Every session's teardown ends the
      // participant leg's stream, so without this reset the FIRST session's
      // ordinary Stop would condemn every session after it. Here rather than
      // in disconnectConversation because the write it has to undo happens
      // DURING that teardown (SonioxClient.disconnect() delivers the close
      // itself, synchronously); a straggling close from an already-torn-down
      // socket cannot arrive later and re-set it, since handleSttClose drops
      // stale closes before reaching onClose.
      participantStreamEndedRef.current = false;

      // Re-validate before starting session to catch stale button state.
      // validateApiKey is the single authority for session readiness — it handles
      // auto-select, model readiness, and API key validation for all providers.
      if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) {
        const result = await useSettingsStore.getState().validateApiKey();
        if (!result.valid) {
          setIsInitializing(false);
          const errorMessage = result.message || t('settings.localInferenceModelsRequired', 'Required models not available for selected language pair.');
          addRealtimeEvent(
            { type: 'session.init_error', data: { message: errorMessage } },
            'client', 'session.init_error'
          );
          // Also surface this in the conversation items, not just the realtime
          // event log, which is unreachable from the subtitle bar — see the
          // equivalent append in the outer catch block below.
          //
          // The subtitle window will actually render this as `blocked`, not
          // `failed`: validateApiKey has just set isApiKeyValid false, so the
          // start gate is closed by the time the idle body re-derives, and
          // blocked wins over failed (subtitleIdleState.ts). That is the more
          // actionable of the two — it routes to the right settings section.
          // The item still earns its keep in the main window's conversation.
          setItems(prevItems => [...prevItems, {
            id: `error-${Date.now()}`,
            role: 'system',
            type: 'error',
            status: 'completed',
            createdAt: Date.now(),
            formatted: { text: errorMessage },
          }]);
          return;
        }
      }

      // No-channel guard: Start requires at least one channel configured.
      // Without this, we'd silently proceed past speaker/participant blocks
      // (both skipped) and end up in a half-initialized state with no clients.
      if (!speakerWillStart && !participantWillStart) {
        setIsInitializing(false);
        addRealtimeEvent(
          { type: 'session.init_error', data: { message: t('mainPanel.noChannelConfigured', 'Enable microphone or participant audio before starting.') } },
          'client', 'session.init_error'
        );
        return;
      }

      // Managed cloned voices are cache entries, not registrations: the one
      // selected days ago may have been evicted since. Claim (and if needed
      // rebuild) it now, before any client exists — the backend pins the slot
      // for a short start window, which session-started then extends to the
      // session's own expiry.
      //
      // Only the speaker channel speaks: createParticipantSessionConfig is
      // text-only, so a participant-only session has no voice to prepare.
      // Voice this session should force onto sessionConfig — the freshly
      // prepared id on success, or the built-in fallback on failure. null
      // means: never attempted (wrong provider, no clip, built-in voice
      // already selected), so leave whatever getSessionConfig() already put
      // there alone.
      let sessionVoiceOverride: string | null = null;
      let voicePrepMessage: string | null = null;
      // What the stored voice is EXPECTED to be once the prep block has
      // applied its outcome. Re-read again just before the override below,
      // because the settings dropdown stays live throughout: see
      // `readStoredSonioxVoice`.
      let sonioxVoiceExpected: string | null = null;
      // Reading the slice generically (through the active descriptor) while
      // writing it through the hardcoded `updateKizunaSoniox` is deliberate,
      // not an oversight: the guard below pins `provider` to the managed
      // Soniox twin, so `settingsSliceKey` is exactly `kizunaSoniox` and
      // `updateKizunaSoniox` is that slice's own updater. The asymmetry
      // exists because the store exposes no generic per-slice update action —
      // every slice has its own named one (settingsStore.ts) — so the write
      // simply cannot be expressed through the descriptor the way the read
      // can. The read stays descriptor-driven anyway because it is the shape
      // every other slice read in this callback already uses.
      const readStoredSonioxVoice = (): string | undefined =>
        (useSettingsStore.getState()[
          ProviderConfigFactory.getDescriptor(provider).settingsSliceKey as keyof SettingsStore
        ] as { voice?: string })?.voice;
      // Provider identity checked FIRST, before touching any settings slice:
      // `voice` is a field name that means something different per provider
      // (OpenAI's is e.g. 'alloy'), so reading it before confirming we're
      // looking at the Soniox-managed twin would read as if that field were
      // provider-agnostic. It is not — it's only meaningful once we already
      // know which slice we're in.
      if (
        speakerWillStart &&
        !textOnly &&
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
        isKizunaManagedProvider(provider)
      ) {
        const sonioxVoiceSetting = readStoredSonioxVoice();
        if (sonioxVoiceSetting && !SONIOX_BUILTIN_VOICES.has(sonioxVoiceSetting)) {
          setVoicePreparing(true);
          try {
            const result = await prepareManagedVoice({
              client: new ManagedVoicesClient(getAuthToken),
              // Scoped to the signed-in account: the clip is one record on a
              // device several people may share, and handing this account
              // somebody else's recording would upload their voice under this
              // account. A mismatch (or nobody signed in) reads as "no clip
              // here", which the routine already degrades to a built-in voice.
              loadClip: () => loadVoiceClip(userId),
            });
            // Preparation takes seconds — up to ~10 s for a cold rebuild —
            // and the voice dropdown is NOT locked during it: Settings is
            // mounted beside this panel and VoiceLibrarySection only disables
            // selection on `isSessionActive`, which flips after connect()
            // resolves. So the user may have picked a different voice while
            // this ran, and theirs must win over anything resolved from the
            // snapshot we started with. Same hazard, same rule, as
            // SonioxVoiceSection's finishCreate: "a choice the user made
            // meanwhile must not be silently overwritten."
            if (readStoredSonioxVoice() !== sonioxVoiceSetting) {
              console.info(
                '[Sokuji] [MainPanel] Managed voice preparation finished after the voice selection changed — leaving the newer choice alone.'
              );
            } else {
              // The decision (what this session uses, whether to persist a
              // changed id, what to tell the user) lives in
              // resolveVoicePrepOutcome — a pure function so it can be tested
              // without a React harness (see voicePrepWiring.test.ts). Only
              // the actual side effects (the store write, the sessionConfig
              // mutation below, the t() translation) stay here.
              const outcome = resolveVoicePrepOutcome(result, sonioxVoiceSetting, SONIOX_DEFAULT_VOICE);
              sessionVoiceOverride = outcome.sessionVoice;
              if (outcome.settingsPatch) {
                // A rebuilt voice comes back with a DIFFERENT Soniox UUID, so
                // every ensure response is authoritative. Writing it through
                // here is what keeps the settings dropdown pointing at a voice
                // that actually exists.
                useSettingsStore.getState().updateKizunaSoniox(outcome.settingsPatch);
              }
              sonioxVoiceExpected = outcome.settingsPatch?.voice ?? sonioxVoiceSetting;
              if (outcome.notice) {
                voicePrepMessage = t(outcome.notice.key, outcome.notice.defaultValue);
              }
            }
          } finally {
            setVoicePreparing(false);
          }
        }
      }

      // Read mode once at session start. Mode can't change mid-session
      // (the picker is locked), so a one-shot read avoids re-subscribing
      // the entire callback to mode changes.
      const sessionMode = useAudioStore.getState().mode;

      // Clear previous session's conversation items
      setItems([]);
      setParticipantItems([]);

      // Initialize the audio service if not already done
      if (!audioServiceRef.current) {
        audioServiceRef.current = ServiceFactory.getAudioService();
        await audioServiceRef.current.initialize();
      }

      // Credentials (apiKey / clientSecret / relay token) are now resolved
      // inside createAIClient via the active provider's descriptor, so the old
      // per-provider apiKey switch and modelName lookup that lived here are gone.

      // Both mode uses ONE shared Soniox two_way session (mic+system mixed) when the
      // shared-session toggle is on and the source language is concrete; else 2 clients.
      //
      // Resolves the EFFECTIVE provider and reads the ACTIVE provider's settings
      // slice (soniox for BYOK, kizunaSoniox for the KIZUNA_AI_SONIOX managed
      // twin) — mirrors the autoSourceParticipantBlocked gate above. A raw
      // `provider === Provider.SONIOX` check against the hardcoded `soniox` slice
      // (as this used to be) is always false for the twin, so it opened TWO
      // independent managed sessions instead of one shared one; the backend's
      // per-account lease is single-session, so the second connect() was refused
      // with 409 and Both mode simply didn't work for the twin.
      const sonioxActiveSettings = useSettingsStore.getState()[
        ProviderConfigFactory.getDescriptor(provider).settingsSliceKey as keyof SettingsStore
      ] as { bothModeSharedSession?: boolean; sourceLanguage?: string };
      // THE shared-vs-split answer, from the same pure helper the Start gate
      // called at render time above — including the `sourceLanguage !== 'auto'`
      // clause, which shared mode needs because it tells the two sides apart by
      // LANGUAGE and cannot do that with an auto source. Calling
      // sonioxUsesSharedBothSession alone here would silently drop that clause
      // plus the provider and mode ones.
      //
      // `.shared` drives the bidirectional flip and the secondary-port
      // participant below; `.split` is what the managed session-key request
      // declares as `bothSplit`, and is the same boolean that chose the Start
      // gate's balance floor.
      const sonioxBothPlan: SonioxBothModePlan = sonioxBothModePlan({
        provider,
        mode: effectiveMode,
        settings: sonioxActiveSettings,
      });
      const sonioxSharedBoth = sonioxBothPlan.shared;
      const sonioxSplitBoth = sonioxBothPlan.split;

      // The managed Soniox lease belongs to the SESSION, not to a stream
      // (design decision 7). Everything the client used to do inside connect()
      // — the session-key exchange, its 409 retry, the cost meter, and the
      // session-started/session-end notifications — happens here and in
      // ManagedSonioxSession now.
      //
      // Deliberately NOT inside createAIClient: acquire() is an awaited network
      // round trip and ProviderDescriptor.createClient is synchronous and
      // returns exactly one client, so the descriptor cannot own it without
      // going async for all eleven providers.
      const isManagedSoniox =
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
        isKizunaManagedProvider(provider);
      // The whole wiring decision, in one pure value: the matrix body to buy,
      // and the STT role each leg runs. Null for BYOK Soniox and for every
      // other provider — those clients carry their own key and lease nothing.
      //
      // Both roles are derived from the body, so they mirror the server's own
      // expansion. That is not cosmetic: `credentialsFor` throws for a role
      // that was never issued, and `session-started` answers 400
      // `role_not_issued`, which leaves the lease at its start window while
      // both Soniox keys stay valid for the full grant.
      const managedWiring = isManagedSoniox
        ? resolveManagedSonioxWiring({
            speakerWillStart,
            participantWillStart,
            // Must match the config of the leg that will actually run, because
            // it decides whether a TTS key is minted at all and at what rate
            // the allowance is spent.
            //
            // Speaker: the same one-shot snapshot getSessionConfig() reads below
            // (settingsStore: `config.textOnly = state.textOnly`). It stays the
            // speaker's answer in split Both too — the participant leg is
            // text-only either way, so only the speaker can want synthesis.
            //
            // No speaker leg: NOT that snapshot.
            // createParticipantSessionConfig() hard-codes `textOnly: true`
            // whatever the user's setting says, so reading the store here would
            // buy a speech-to-speech lease for a session that never opens a TTS
            // socket, and burn the countdown at that rate. (The backend also
            // ignores `textOnly` for mode 'participant'; this keeps the client
            // honest rather than relying on that.)
            textOnly: speakerWillStart ? useSettingsStore.getState().textOnly : true,
            sonioxSharedBoth,
            // FE2's derived value, on the wire for the first time here.
            sonioxSplitBoth,
          })
        : null;
      let managedSonioxSession: ManagedSonioxSession | null = null;
      if (managedWiring) {
        const token = await getAuthToken();
        if (!token) throw new Error(KIZUNA_SIGN_IN_REQUIRED);
        const session = new ManagedSonioxSession({
          sessionToken: token,
          // The session's sink is typed `(type: string, ...)` because it must
          // not depend on the store's event union. 'session.retry' — the one
          // type it emits — is not in that union, exactly as when SonioxClient
          // emitted it (emitRealtime casts the whole event `as any`); this is
          // the same escape, narrowed to the one field that needs it.
          onEvent: (type, data) => addRealtimeEvent({ type: type as EventData['type'], data }, 'client', type),
        });
        // Stored BEFORE acquire() so a failed acquire still leaves something
        // for disconnectConversation to clear; end() no-ops without a lease.
        managedSonioxSessionRef.current = session;
        await session.acquire(managedWiring.acquire);
        managedSonioxSession = session;
      }
      // What ONE leg is handed — key, session, role, and the primacy bit — is
      // decided by `managedLegOptions`, which reads the role and the key from
      // the same wiring so they cannot disagree. It lives in
      // managedSonioxSplit.ts rather than here because a plain function is the
      // only thing this repo can test: there is no React harness for
      // connectConversation, and the inline version silently lost `role`.

      // Whether the speaker channel came up END TO END, as a local the post-init
      // guard below can read back in this same pass — the participant side's
      // `participantChannelStarted` exists for exactly that reason, and
      // `speakerChannelActive`, being state, cannot be read back here either.
      // Starts false and stays false when the whole block is skipped, which is
      // correct: a participant-only session has no speaker channel.
      let speakerChannelStarted = false;

      // Speaker channel: only initialize when mic is selected + enabled.
      // When this whole block is skipped (participant-only session), no speaker
      // client is created — saves a WebSocket and, for Kizuna AI, wallet cost.
      if (speakerWillStart) {
        // Determine if WebRTC transport should be used
        let useWebRTC = transportType === 'webrtc' && ClientFactory.supportsWebRTC(provider);

        // Create speaker client using helper. `mix_stt` in shared Both (one
        // stream carrying mic and system audio mixed), `spk_stt` whenever the
        // microphone has a stream of its own.
        speakerClientRef.current = await createAIClient(
          useWebRTC,
          managedLegOptions('speaker', managedSonioxSession, managedWiring),
        );

        // Setup listeners for the new client instance
        await setupClientListeners();

        const client = speakerClientRef.current;

        // Note: canHoldToSpeak is now derived via useMemo from currentTurnDetectionMode
        // at component scope — no imperative setter needed here.

        if (selectedInputDevice) {
          // Note: Don't start recording yet, just prepare the device
          // Recording will be started below based on turn detection mode
          // Passthrough is already configured via the useEffect hook
        } else {
          console.warn('[Sokuji] [MainPanel] No input device selected, cannot connect to microphone');
        }

        // If monitor is in scope (pure speaker mode) and not muted, ensure the
        // monitor device is connected immediately. The monitor <-> participant
        // mutex means the monitor is never audible outside speaker mode, so we
        // skip the reconnect in participant/both even if isMonitorMuted is false
        // (a preserved opt-in preference).
        if (currentMode === 'speaker' && !isMonitorMuted && selectedMonitorDevice && !isVirtualDevice(selectedMonitorDevice as any)) {
          console.debug('[Sokuji] [MainPanel] Setting up monitor device to:', selectedMonitorDevice.label);

          // Trigger the selectMonitorDevice function to reconnect the monitor
          // This will use the audio service properly through the AudioContext
          selectMonitorDevice(selectedMonitorDevice);
        }

        // Get session configuration
        const sessionConfig = getSessionConfig();
        // Same shape as the `bidirectional` override below: sessionConfig is a
        // plain object built for this connect() alone, so this override never
        // touches settings — see resolveVoicePrepOutcome's own doc comment for
        // why the write-through decision is asymmetric (success-and-changed
        // only, never a fallback).
        if (sessionVoiceOverride) {
          // Re-checked here, not only at prep time: everything in between is
          // awaited (audio service init, client construction, listener
          // wiring) and the voice dropdown stays live the whole way, so the
          // user may have picked a different voice since. Theirs wins —
          // including over the built-in fallback and its notice, which would
          // otherwise explain a substitution that did not happen. Standing
          // down leaves whatever getSessionConfig() already read from the
          // (now current) settings in place, which is exactly their choice.
          if (readStoredSonioxVoice() === sonioxVoiceExpected) {
            (sessionConfig as SonioxSessionConfig).voice = sessionVoiceOverride;
          } else {
            console.info(
              '[Sokuji] [MainPanel] Voice selection changed after preparation — using the newly selected voice for this session.'
            );
            // The override is simply not applied. The notice IS cleared,
            // because it is read further down (after connect()) and would
            // otherwise announce a fallback this session did not take.
            voicePrepMessage = null;
          }
        }
        // Both single-session (Soniox): flip the speaker config to a bidirectional
        // two_way session so one core handles both directions. sonioxSharedBoth
        // already guarantees provider === 'soniox', shared toggle on, and a
        // concrete source language; otherwise fall through to the normal
        // two-client path.
        if (sonioxSharedBoth) {
          (sessionConfig as SonioxSessionConfig).bidirectional = true;
        }

        // Track connection attempt and measure latency
        const connectionStartTime = Date.now();

        try {
          // Connect to the AI service. For managed Soniox this does NOT set the
          // leg's started bit: a resolved connect only means the socket opened,
          // which for Soniox happens before the key is validated at all. The bit
          // is set from the first frame the stream actually receives — see
          // managedSonioxSplit.ts's note where connectLegAndMarkStarted used to
          // be, and SonioxClient.handleSttMessage.
          await client.connect(sessionConfig);

          // Track successful connection with latency
          const connectionLatency = Date.now() - connectionStartTime;
          trackEvent('latency_measurement', {
            operation: useWebRTC ? 'webrtc' : 'websocket',
            latency_ms: connectionLatency,
            provider: provider
          });

          trackEvent('connection_status', {
            status: 'connected',
            provider: provider || Provider.OPENAI,
            duration_ms: connectionLatency,
            transport: useWebRTC ? 'webrtc' : 'websocket'
          });
        } catch (connectError: any) {
          // If WebRTC connection failed, try fallback to WebSocket
          if (useWebRTC) {
            console.warn('[Sokuji] [MainPanel] WebRTC connection failed, falling back to WebSocket:', connectError);

            // Create a new client with WebSocket transport
            useWebRTC = false;
            speakerClientRef.current = await createAIClient(false);

            // Re-setup listeners for the new client instance
            await setupClientListeners();

            const fallbackClient = speakerClientRef.current;

            try {
              await fallbackClient.connect(sessionConfig);

              // Track successful fallback connection
              const connectionLatency = Date.now() - connectionStartTime;
              trackEvent('latency_measurement', {
                operation: 'websocket_fallback',
                latency_ms: connectionLatency,
                provider: provider
              });

              trackEvent('connection_status', {
                status: 'connected',
                provider: provider || Provider.OPENAI,
                duration_ms: connectionLatency,
                transport: 'websocket_fallback'
              });

              // Notify user about the fallback
              addRealtimeEvent(
                { type: 'session.webrtc_fallback', data: { message: t('logs.webrtcFallback', 'WebRTC connection failed, using WebSocket instead') } },
                'client', 'session.webrtc_fallback'
              );

              console.info('[Sokuji] [MainPanel] WebSocket fallback connection established');
            } catch (fallbackError: any) {
              // Track fallback connection failure
              trackEvent('api_error', {
                provider: provider || Provider.OPENAI,
                error_message: fallbackError.message || 'Fallback connection failed',
                error_type: 'network'
              });
              throw fallbackError;
            }
          } else {
            // Track connection failure (no fallback available)
            trackEvent('api_error', {
              provider: provider || Provider.OPENAI,
              error_message: connectError.message || 'Connection failed',
              error_type: 'network'
            });
            throw connectError;
          }
        }

        // Mode-derived flags for recorder lifecycle.
        // Both 'Disabled' (OpenAI) and 'Push-to-Talk' (others) mean "key-hold-only mode";
        // 'Push-to-Translate' is its own gated-callback mode (handled separately below).
        const isPushToTranslateMode = currentTurnDetectionMode === 'Push-to-Translate';
        // Push-gated minus Push-to-Translate = key-hold-only ("pure manual").
        // 'Disabled' (OpenAI) and 'Push-to-Talk' (others) both land here, via
        // each provider's declared vocabulary instead of a hardcoded pair.
        const isPureManualMode =
          isPushGatedMode(provider, currentTurnDetectionMode) && !isPushToTranslateMode;

        // Check if provider uses native audio capture (OpenAI WebRTC or PalabraAI/LiveKit)
        // In native capture mode, audio is automatically captured via MediaStreamTrack
        // No need to manually record and send audio chunks
        const usesNativeCapture = ClientFactory.usesNativeAudioCapture(provider, useWebRTC ? 'webrtc' : 'websocket');

        // Sync noise suppression state for the new session (ensures RNNoise is
        // removed when disabled, not just added when enabled)
        if (audioServiceRef.current) {
          await audioServiceRef.current.getRecorder().setNoiseSuppressionMode(noiseSuppressionMode);
        }

        // Recorder lifecycle (skip entirely for native MediaStreamTrack capture):
        //  - Push-to-Translate: start now, gated callback (skip AI forwarding when isPassthrough or mic off)
        //  - Pure PTT (Disabled/Push-to-Talk): defer recorder start to space keydown
        //  - Otherwise (VAD modes — Auto/Normal/Semantic): start now, pipeline-gated callback
        // Recorder always starts when in scope + device selected, regardless of mute state.
        // Per-frame callback gates on isMicMuted to implement mute without stopping the recorder.
        if (!usesNativeCapture && audioServiceRef.current) {
          if (isPushToTranslateMode) {
            let p2tCallbackCount = 0;
            await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
              if (!speakerClientRef.current) return;
              // Pipeline gate: skip sending to AI client when mic is off.
              if (useAudioStore.getState().isMicMuted) return;
              if (data.isPassthrough) {
                return;  // IDLE: route to passthrough only, don't send to AI
              }
              if (p2tCallbackCount % 100 === 0) {
                console.debug(`[Sokuji] [MainPanel] P2T: Sending audio to client: chunk ${p2tCallbackCount}, PCM length: ${data.mono.length}`);
              }
              p2tCallbackCount++;

              // Track non-silent audio chunks for empty-request detection (mirrors pure PTT)
              if (!isSilentAudio(data.mono)) {
                pttVoiceChunkCountRef.current++;
              }

              speakerClientRef.current.appendInputAudio(data.mono);
            });
          } else if (!isPureManualMode) {
            // VAD: pipeline-gated callback
            let audioCallbackCount = 0;
            await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
              if (!speakerClientRef.current) return;
              // Pipeline gate: skip sending to AI client when mic is off.
              if (useAudioStore.getState().isMicMuted) return;
              // Debug logging every 100 calls to verify AI client receives data
              if (audioCallbackCount % 100 === 0) {
                console.debug(`[Sokuji] [MainPanel] Sending audio to client: chunk ${audioCallbackCount}, PCM length: ${data.mono.length}`);
              }
              audioCallbackCount++;
              speakerClientRef.current.appendInputAudio(data.mono);
            });
          }
          // else: pure PTT — recorder stays idle until space keydown.
        } else if (usesNativeCapture) {
          console.info('[Sokuji] [MainPanel] Native MediaStreamTrack mode - audio flows automatically');

          // Apply initial mute state based on isMonitorMuted (WebRTC only, not PalabraAI)
          if (useWebRTC && typeof speakerClientRef.current?.setOutputMuted === 'function') {
            speakerClientRef.current.setOutputMuted(isMonitorMuted);
            console.debug('[Sokuji] [MainPanel] WebRTC initial mute state:', isMonitorMuted);
          }
        }

        // Track if using WebRTC (after fallback logic is complete)
        // Note: PalabraAI uses appendInputAudio pattern, not native WebRTC audio
        setIsUsingWebRTC(useWebRTC);

        // Mark speaker channel as fully active. Placed at the end of the
        // speaker block so it only fires once connect + audio capture wiring
        // have completed successfully (the catch block above re-throws on
        // unrecoverable failures, which skips this).
        setSpeakerChannelActive(true);
        // Same end-to-end contract, as a local — mirrors participantChannelStarted.
        speakerChannelStarted = true;
      }

      // Start participant audio client (unified for both Electron system audio and Extension tab audio)
      // Both capture "other participant" audio and send to AI for translation
      const participantInScope = sessionMode === 'participant' || sessionMode === 'both';
      const shouldCaptureParticipantAudio = participantInScope && audioServiceRef.current !== null;

      // Set (not appended) by the participant catch block below when the
      // channel fails non-fatally. Deferred rather than appended immediately
      // because setItems(speakerClientRef.current?.getConversationItems() ||
      // []) further down unconditionally overwrites state — appending before
      // that point would get wiped (participant-only: overwritten with [];
      // Both mode: overwritten with the speaker's just-started list).
      let participantErrorMessage: string | null = null;

      // Why the participant leg failed, if it did, and whether it ever came up
      // end to end. Locals rather than state because connectConversation reads
      // them back in the same pass — a setState here would not be visible to
      // the resolve call below.
      //
      // `participantChannelStarted` starts false and stays false when the
      // whole block is skipped (no audio service), which is correct: under
      // split that is still a one-way session.
      let splitParticipantFailure: SplitDegradedReason | null = null;
      let participantChannelStarted = false;

      if (shouldCaptureParticipantAudio) {
        try {
          const captureMode = isExtension() ? 'tab' : 'system';
          console.info(`[Sokuji] [MainPanel] Starting participant audio client (${captureMode} capture)...`);

          // Electron: lazy-acquire the loopback stream at session start.
          // (Extension uses tab capture via the existing tabAudioRecorder path.)
          let electronAcquireOk = true;
          if (isElectron() && !isExtension()) {
            try {
              const participantSourceId = resolveParticipantSourceId(participantSourceRef.current);
              // Whether a whole-system getDisplayMedia stream is actually
              // needed. Per-application capture never needs one, and on macOS
              // neither does whole-system capture any more - a global Core
              // Audio tap serves it under the permission the app already has.
              if (needsLoopbackStream(participantSourceId)) {
                const granted = await audioServiceRef.current!.requestLoopbackAudioStream();
                if (!granted) {
                  console.warn('[Sokuji] [MainPanel] Loopback permission denied; skipping participant');
                  setPermissionWarning('screen-recording-denied');
                  addRealtimeEvent(
                    {
                      type: 'participant.warning',
                      data: {
                        message: t('audioPanel.screenRecordingDeniedText1', 'Participant Audio requires Screen Recording permission to capture system audio.')
                      }
                    },
                    'client', 'participant.warning'
                  );
                  // Non-fatal failure path #1. Under split the par_stt leg
                  // never connects: its started bit is never set, so the lease
                  // releases on the speaker alone and the session continues
                  // one-way. The minted par_stt key is abandoned unused.
                  electronAcquireOk = false;
                  splitParticipantFailure = 'loopback-denied';
                } else {
                  await audioServiceRef.current!.connectSystemAudioSource(participantSourceId);
                  systemAudioAcquiredRef.current = true;
                }
              } else {
                await audioServiceRef.current!.connectSystemAudioSource(participantSourceId);
                systemAudioAcquiredRef.current = true;
              }
            } catch (error) {
              console.error('[Sokuji] [MainPanel] Failed to acquire participant audio:', error);
              electronAcquireOk = false;
              // Previously console-only: this branch produced NO user-visible
              // signal of any kind.
              splitParticipantFailure = 'participant-connect-failed';
            }
          }

          if (electronAcquireOk) {
            // Create participant client. In Both SINGLE-session (Soniox, shared
            // toggle on, concrete source language) reuse the speaker core as
            // channel B via its inert secondary port. In managed SPLIT Both the
            // participant leg is a REAL second SonioxClient running on the
            // session's own par_stt key — see resolveParticipantSlot for why the
            // secondary port has to be unreachable there.
            const speakerCore = speakerClientRef.current;
            const participantSlot = resolveParticipantSlot({
              speakerWillStart,
              sonioxSharedBoth,
              sonioxSplitBoth,
              speakerSupportsSecondaryPort:
                !!speakerCore && typeof speakerCore.createSecondaryPort === 'function',
            });
            if (participantSlot === 'secondary-port') {
              participantClientRef.current = speakerCore!.createSecondaryPort!();
            } else {
              // Only ever `par_stt`: createParticipantSessionConfig forces
              // textOnly, so the participant leg never holds a TTS credential.
              // Undefined for a managed session whose wiring gives the slot no
              // role of its own — credentialsFor would throw for an unissued
              // role, and the managed descriptor refuses to build a client with
              // no bundle. Both land in the non-fatal catch below, so the
              // speaker survives, which is the settled degradation.
              participantClientRef.current = await createAIClient(
                false,
                managedLegOptions('participant', managedSonioxSession, managedWiring),
              );
            }

            // Setup event handlers using helper
            const participantClient = participantClientRef.current;
            participantClient.setEventHandlers(createParticipantEventHandlers(participantClient));

            // Create and connect with participant session config
            const participantSessionConfig = createParticipantSessionConfig();
            if (!participantSessionConfig) {
              // Non-fatal failure path #2. Under split this is a par_stt leg
              // that never connects: no started bit is ever set for it, so the
              // lease is never waiting on it and releases on the speaker alone.
              // Its minted key is simply abandoned — single_use with a short
              // start window, so it lapses on its own.
              console.info('[Sokuji] [MainPanel] Participant skipped — no suitable models');
              participantClientRef.current = null;
              // Also previously console-only.
              splitParticipantFailure = 'no-participant-config';
            } else {
              // No started bit here either: this leg's key is the one most
              // likely to have lapsed (its 180 s start window is spent behind
              // the OS loopback-permission dialog), and a lapsed key still opens
              // its socket. Only a frame proves the stream ran.
              await participantClient.connect(participantSessionConfig);
              console.info(`[Sokuji] [MainPanel] Participant audio client connected (${captureMode}, text-only, swapped languages, semantic VAD)`);

              // Start recording from appropriate source based on environment
              let participantAudioCallbackCount = 0;
              const createAudioDataCallback = (client: IClient) => (data: { mono: Int16Array; raw: Int16Array }) => {
                if (!client) return;
                // Pipeline gate: skip sending to AI client when participant is off.
                // Read state per invocation to avoid stale closures. Extension passthrough
                // continues — handlePassthroughAudio fires inside the recorder before this.
                if (useAudioStore.getState().isParticipantMuted) return;
                if (participantAudioCallbackCount % 100 === 0) {
                  console.debug(`[Sokuji] [MainPanel] Sending ${captureMode} audio to client: chunk ${participantAudioCallbackCount}, PCM length: ${data.mono.length}`);
                }
                participantAudioCallbackCount++;
                client.appendInputAudio(data.mono);
              };

              if (isExtension()) {
                // Extension: start tab audio recording. Passthrough always uses
                // the system default output device (selectedParticipantOutput removed
                // per on/off pipeline-gate spec — D-Task 6).
                console.info('[Sokuji] [MainPanel] Starting tab audio recording');
                await audioServiceRef.current!.startTabAudioRecording(
                  createAudioDataCallback(participantClient)
                );
              } else {
                // Electron: start system audio recording from virtual mic
                await audioServiceRef.current!.startSystemAudioRecording(
                  createAudioDataCallback(participantClient)
                );
              }

              console.info(`[Sokuji] [MainPanel] Participant audio recording started (${captureMode})`);
              // Set the active flag only after recording wiring succeeds — mirrors
              // the speaker block, where the flag means "channel is end-to-end
              // active" not "connect resolved". If startTab/SystemAudioRecording
              // throws (non-OOM, caught below as non-fatal), the flag stays false.
              setParticipantChannelActive(true);
              // Same end-to-end contract, as a local the resolve below can
              // read — setParticipantChannelActive's own value cannot be read
              // back within this pass.
              participantChannelStarted = true;
            }
          }
        } catch (error: any) {
          console.error('[Sokuji] [MainPanel] Failed to start participant audio client:', error);
          // GPU OOM is fatal — propagate so the session doesn't start
          if (error?.isGpuOom) {
            throw error;
          }
          // Other participant errors are non-fatal — the session continues on
          // whichever channel(s) did come up (the post-init guard below bails
          // if none did). But the failure must still reach the user, not just
          // the console — previously console-only, so e.g. a managed Soniox
          // connect failure (402/403/409/...) on this channel left the
          // participant channel silently dead with no visible explanation.
          // Surface it the same way onError does elsewhere in this file: a
          // log entry plus a conversation bubble.
          // The bubble itself is appended later (after the setItems overwrite
          // below) — see the comment on the `participantErrorMessage`
          // declaration above.
          //
          // Non-fatal failure path #3, unchanged: the session continues on
          // whichever channel(s) did come up, and the speaker is NOT torn down.
          // Under split, a participant leg that fails here never reached a
          // frame, so no par_stt bit was ever set and the lease is not waiting
          // on it.
          participantErrorMessage = error?.message || t('mainPanel.participantChannelFailed', 'Failed to start the participant audio channel.');
          addRealtimeEvent(
            { type: 'participant.error', data: { message: participantErrorMessage } },
            'client', 'participant.error'
          );
          splitParticipantFailure = 'participant-connect-failed';
        }
      }

      // Post-init guard: if NEITHER channel came up, bail instead of entering a
      // fake "active" UI state with no translation happening. Errors above were
      // caught non-fatally and continued; this is where we detect total failure.
      //
      // Asks whether a channel WORKS, not whether a client object exists. The
      // refs cannot answer that: the participant catch is non-fatal by design
      // and leaves `participantClientRef.current` set, and
      // `speakerClientRef.current` is never assigned null anywhere in this file
      // (not even on Stop), so the old ref-based condition also went permanently
      // false after the first session that built a speaker client. See
      // noChannelCameUp.
      if (noChannelCameUp({ speakerChannelStarted, participantChannelStarted })) {
        console.error('[Sokuji] [MainPanel] Neither the speaker nor the participant channel came up; aborting session start');
        // The ONLY early return between acquire() and the end of this function,
        // and it does not route through disconnectConversation — so whatever was
        // built here has to be taken down here.
        //
        // A participant client can now be holding a LIVE socket at this point:
        // the guard reads outcomes, so it fires for a leg that connected and
        // then failed to wire its recorder. There is never a speaker client to
        // take down — one that came up would have set speakerChannelStarted, and
        // one that failed re-threw past this point — so a non-null
        // speakerClientRef here belongs to a PREVIOUS session (this file never
        // clears it) and must not be touched.
        //
        // Ordered through teardownSessionLegs for its one invariant: every leg
        // is down before `session-end` is signalled. Releasing the lease while a
        // stream is still open burns the reconciler's fast-retry ladder on a
        // usage log that cannot exist yet; and not releasing it at all leaves it
        // held until expiry, 409-ing the next Start for up to an hour.
        await teardownSessionLegs({
          participant: async () => {
            const abortedParticipant = participantClientRef.current;
            if (!abortedParticipant) return;
            participantClientRef.current = null;
            try {
              await abortedParticipant.disconnect();
              abortedParticipant.reset();
            } catch (error) {
              console.warn('[Sokuji] [MainPanel] Error disconnecting the participant client during abort:', error);
            }
          },
          // Idempotent, and a no-op when nothing was acquired. The ref is
          // cleared BEFORE end() so no re-entry can produce a second POST.
          afterBothLegs: () => {
            const abortedSoniox = managedSonioxSessionRef.current;
            managedSonioxSessionRef.current = null;
            abortedSoniox?.end();
          },
        });
        setIsInitializing(false);
        const errorMessage = t('mainPanel.allChannelsFailed', 'Failed to start any audio channel. Check device permissions and try again.');
        addRealtimeEvent(
          { type: 'session.init_error', data: { message: errorMessage } },
          'client', 'session.init_error'
        );
        // Same reasoning as the local-model revalidation guard above and the
        // outer catch block below: append to items (not just the realtime
        // event log) so subtitleIdleState can derive `failed` and the
        // subtitle window shows why start didn't happen. Nothing here calls
        // setItems(getConversationItems()) afterward, so there's no overwrite
        // risk and no "append after disconnect" ordering is needed.
        setItems(prevItems => [...prevItems, {
          id: `error-${Date.now()}`,
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: errorMessage },
        }]);
        return;
      }

      // Set state variables after successful initialization
      // Note: Use speakerClientRef.current instead of client variable to handle WebRTC fallback scenario
      setLockedMode(sessionMode);
      setIsSessionActive(true);
      setItems(speakerClientRef.current?.getConversationItems() || []);

      // Appended AFTER the setItems overwrite above: it would otherwise
      // wipe this entry (participant-only: overwritten with []; Both mode:
      // overwritten with the speaker's just-started list). See the
      // `participantErrorMessage` declaration near the participant block
      // for why this is deferred instead of appended in the catch itself.
      if (participantErrorMessage) {
        setItems(prevItems => [...prevItems, {
          id: `error-${Date.now()}`,
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: participantErrorMessage },
        }]);
      }

      // Appended after the setItems overwrite above for the same reason as
      // participantErrorMessage: setItems(getConversationItems()) would wipe
      // anything appended earlier in this function.
      if (voicePrepMessage) {
        setItems(prevItems => [...prevItems, {
          id: `voice-prep-${Date.now()}`,
          role: 'system',
          // `error` is what every system notice in this codebase uses,
          // including SonioxClient's own emitSystemNotice — it is the only
          // system-item type the bubble renderer and subtitleIdleState both
          // understand. A friendlier-sounding type nobody renders would be a
          // notice the user never sees.
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: voicePrepMessage },
        }]);
      }

      // One decision, three inputs, computed once the participant block has
      // finished. Deliberately NOT a conversation item: the setItems overwrite
      // a few lines up replaces that array wholesale, which is why
      // participantErrorMessage and voicePrepMessage have to be appended after
      // it. This lives in its own state and is untouched by that call.
      //
      // Placed after the "both channels failed" guard on purpose — that path
      // returns early because no session starts at all, and a session that
      // never started is not a degraded one.
      //
      // Reading the stream-ended ref HERE is what closes the gap between
      // "wired" and "working": every close that lands before the line above
      // has already written it, and every close that lands after it finds
      // isSessionActive true and tears the session down instead, which the
      // user cannot miss. There is no third case, and therefore no timer and
      // no waiting — a far side that has simply not spoken is never accused.
      setSplitDegraded(resolveSplitDegraded({
        splitRequested: sonioxSplitBoth,
        participantChannelStarted,
        failure: splitParticipantFailure,
        participantStreamEnded: participantStreamEndedRef.current,
      }));

      // Start tracking audio quality metrics during session
      audioQualityIntervalRef.current = setInterval(() => {
        if (audioServiceRef.current) {
          const recorder = audioServiceRef.current.getRecorder();
          if (recorder && recorder.isRecording()) {
            // Track audio quality metrics
            trackEvent('audio_quality_metric', {
              quality_score: 100, // Placeholder - in production this would be calculated
              latency: 0, // Placeholder - would measure actual latency
              echo_cancellation_enabled: true,
              noise_suppression_enabled: true
            });
          }
        }
      }, 30000); // Every 30 seconds
    } catch (error: any) {
      console.error('[Sokuji] [MainPanel] Failed to initialize session:', error);

      const errorMessage = error.message || 'Network connection error';
      addRealtimeEvent(
        { type: 'session.init_error', data: { message: errorMessage, error: String(error) } },
        'client', 'session.init_error'
      );

      trackEvent('error_occurred', {
        error_type: 'session_initialization',
        error_message: error.message || 'Failed to initialize session',
        component: 'MainPanel',
        severity: 'high',
        provider: provider,
        recoverable: true
      });

      await disconnectConversation();

      // Append after disconnect: disconnectConversation calls
      // setItems(client.getConversationItems()) which would otherwise
      // overwrite this entry (client has no items on init failure).
      setItems(prevItems => [...prevItems, {
        id: `error-${Date.now()}`,
        role: 'system',
        type: 'error',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { text: errorMessage },
      }]);
    } finally {
      setIsInitializing(false);
    }
  }, [
    // getCurrentProviderSettings itself is no longer read here — createAIClient
    // resolves credentials via the active provider's descriptor. Per-provider
    // settings SLICES are still read directly, though: both the pre-existing
    // `sonioxActiveSettings` snapshot below and the managed-voice prep block's
    // `sonioxVoiceSetting` snapshot go through useSettingsStore.getState(), a
    // one-shot read that intentionally is NOT a dependency here (only a
    // reactive hook value would need to be). getAuthToken IS listed below,
    // though: the managed-voice prep block calls it directly to construct a
    // ManagedVoicesClient, and a stale closure would mint that request with a
    // token from a previous sign-in — a 401 that looks like an outage.
    noiseSuppressionMode,
    provider,
    transportType,
    getSessionConfig,
    setupClientListeners,
    createAIClient,
    selectedInputDevice,
    isMicMuted,
    isMonitorMuted,
    selectedMonitorDevice,
    selectMonitorDevice,
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    // Channel-start predicates control which clients are created
    speakerWillStart,
    participantWillStart,
    // Managed-voice prep block additions (see the comment above it).
    getAuthToken,
    // The reference clip is filed under an ACCOUNT, so a stale closure here
    // would ask storage for the previously signed-in user's recording and
    // upload it under the current one.
    userId,
    textOnly,
    t,
  ]);

  // Bridge to surfaces outside this React tree (the Electron subtitle window):
  // publishes the start gate + init state, and turns their start/stop requests
  // into calls on this component's own session functions.
  useSubtitleSessionBridge({
    startGate,
    isInitializing,
    initProgress,
    onStart: connectConversation,
    onStop: disconnectConversation,
  });

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = useCallback(async () => {
    // Don't start recording if mic is muted
    if (isMicMuted) {
      console.info('[Sokuji] [MainPanel] Mic is muted, not starting recording');
      return;
    }

    // If already recording, don't do anything (this is important for push-to-talk)
    if (isRecording) {
      return;
    }

    setIsRecording(true);
    
    // Track push-to-talk start time
    pushToTalkStartTimeRef.current = Date.now();
    
    const client = speakerClientRef.current;
    const audioService = audioServiceRef.current;

    if (!audioService) {
      console.error('[Sokuji] [MainPanel] Audio service not available');
      setIsRecording(false);
      return;
    }

    try {
      const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

      if (isPushToTranslate) {
        // Push-to-translate: recorder is already running continuously.
        // Just reset chunk counter; the unified passthrough useEffect will mute passthrough
        // (because isRecording is now true), and the gated recording callback (set up at
        // session start) will start forwarding audio to the AI client.
        pttVoiceChunkCountRef.current = 0;
        return;
      }

      // Pure PTT modes (Push-to-Talk / Disabled): start the recorder fresh on each hold.
      // Note: We no longer interrupt playing audio when recording starts
      // This allows for simultaneous recording and playback

      // Check if the recorder is in a valid state
      const recorder = audioService.getRecorder();
      if (recorder.isRecording()) {
        // If somehow we're already recording, pause first
        console.warn('[Sokuji] [MainPanel] ModernAudioRecorder was already recording, pausing first');
        await audioService.pauseRecording();
      }

      // Start recording
      pttVoiceChunkCountRef.current = 0;  // Reset non-silent chunk counter
      let pttAudioCallbackCount = 0;
      await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
        if (client) {
          // Debug logging for push-to-talk (every 50 chunks)
          if (pttAudioCallbackCount % 50 === 0) {
            console.debug(`[Sokuji] [MainPanel] PTT: Sending audio to client: chunk ${pttAudioCallbackCount}, PCM length: ${data.mono.length}`);
          }
          pttAudioCallbackCount++;

          // Track non-silent audio chunks for empty request detection
          if (!isSilentAudio(data.mono)) {
            pttVoiceChunkCountRef.current++;
          }

          client.appendInputAudio(data.mono);
        }
      });
    } catch (error) {
      console.error('[Sokuji] [MainPanel] Error starting recording:', error);
      setIsRecording(false);
    }
  }, [isMicMuted, isRecording, selectedInputDevice, currentTurnDetectionMode]);

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = useCallback(async () => {
    // Only try to stop recording if we're actually recording
    if (!isRecording) {
      return;
    }

    setIsRecording(false);
    
    // Track push-to-talk usage
    if (pushToTalkStartTimeRef.current && sessionId) {
      const holdDuration = Date.now() - pushToTalkStartTimeRef.current;
      trackEvent('push_to_talk_used', {
        session_id: sessionId,
        hold_duration_ms: holdDuration,
        mode: currentTurnDetectionMode === 'Push-to-Translate' ? 'push-to-translate' : 'push-to-talk',
      });
      pushToTalkStartTimeRef.current = null;
    }
    
    const client = speakerClientRef.current;
    const audioService = audioServiceRef.current;

    if (!audioService) {
      return;
    }

    try {
      const recorder = audioService.getRecorder();
      const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

      // A relay-managed twin behaves exactly like its base provider here, so resolve
      // to the base provider before any provider-specific PTT branching. Without this,
      // the KIZUNA_AI_VOLCENGINE_AST2 twin would skip AST2's silence-frame flush and
      // wrongly fall into the createResponse() path, leaving the turn unfinalized.
      const effectiveProvider = kizunaBaseProvider(provider) ?? provider;

      // For Push-to-translate, recorder.isRecording() is always true (continuous capture).
      // For pure PTT, only proceed if the recorder was actually started by startRecording.
      if (recorder.isRecording()) {
        // For Volcengine AST2 and LocalOffline PTT: send silence frames before stopping
        // This helps the VAD detect end of speech
        if ((effectiveProvider === Provider.VOLCENGINE_AST2 || usesLocalSileroVad(effectiveProvider)) && client) {
          const silenceFrameSize = 2400; // 24kHz * 0.1s = 2400 samples per 100ms frame (client downsamples to 16kHz internally)
          // LOCAL_INFERENCE / LOCAL_NATIVE both use Silero VAD → 700ms tail; AST2 → 500ms
          const silenceFrames = usesLocalSileroVad(effectiveProvider) ? 7 : 5;
          for (let i = 0; i < silenceFrames; i++) {
            // New buffer each iteration — worker postMessage transfers (detaches) the ArrayBuffer
            client.appendInputAudio(new Int16Array(silenceFrameSize));
          }
          console.debug(`[Sokuji] [MainPanel] PTT: Sent ${silenceFrames * 100}ms silence frames for VAD end detection`);
        }

        // Stop recording — but only for pure PTT. Push-to-translate keeps the recorder
        // running; the unified passthrough useEffect will re-enable passthrough now that
        // isRecording is false (because of setIsRecording(false) earlier in stopRecording).
        if (!isPushToTranslate) {
          await audioService.pauseRecording();
        }

        // Only create response if we detected enough voice audio (prevents empty requests)
        // Note: AST2 handles response creation server-side via VAD, so skip client.createResponse() for it
        // Note: LOCAL_INFERENCE always calls createResponse() — for streaming ASR it flushes the
        //       pending utterance; for offline ASR (VAD-based) it's harmless (silence frames handle it)
        const MIN_VOICE_CHUNKS = 5; // At least 5 non-silent chunks (~0.5 seconds of speech)
        if (client && usesLocalSileroVad(effectiveProvider)) {
          client.createResponse();
        } else if (client && effectiveProvider === Provider.GEMINI) {
          if (pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
            client.createResponse();
          } else {
            // No meaningful speech detected — reset speaking state without sending
            // activityEnd so Gemini doesn't generate a response for silence
            client.cancelPttTurn?.();
            console.debug(`[Sokuji] [MainPanel] PTT: Gemini turn cancelled - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
          }
        } else if (client && effectiveProvider !== Provider.VOLCENGINE_AST2 && pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
          // Model drift prevention is handled by the silent anchor mechanism (useEffect)
          client.createResponse();
        } else if (client && effectiveProvider !== Provider.VOLCENGINE_AST2) {
          console.debug(`[Sokuji] [MainPanel] PTT: Skipping response - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
        }
      }
    } catch (error) {
      // If there's an error during pause (e.g., already paused), log it but don't crash
      console.error('[Sokuji] [MainPanel] Error stopping recording:', error);

      // Reset the recording state to ensure UI is consistent
      setIsRecording(false);
    }
  }, [isRecording, provider, currentTurnDetectionMode]);

  /**
   * Send text input for translation
   */
  const handleSendText = useCallback((text: string) => {
    const client = speakerClientRef.current;
    if (!client || !isSessionActive) {
      console.warn('[MainPanel] Cannot send text: no active session');
      return;
    }

    // If AI is responding (OpenAI), queue the message for later
    if (isAIResponding && (provider === Provider.OPENAI || provider === Provider.OPENAI_COMPATIBLE)) {
      console.log('[MainPanel] AI is responding, queuing text message');
      pendingTextRef.current = text;
      return;
    }

    try {
      client.appendInputText(text);

      // Update items to reflect the sent message
      setItems(client.getConversationItems());

      // Track text input usage
      if (sessionId) {
        trackEvent('text_input_sent', {
          session_id: sessionId,
          provider: provider,
          text_length: text.length
        });
      }
    } catch (error: any) {
      console.error('[MainPanel] Error sending text:', error);

      trackEvent('error_occurred', {
        error_type: 'text_input',
        error_message: error.message || 'Failed to send text',
        component: 'MainPanel',
        severity: 'medium',
        provider: provider,
        recoverable: true
      });
    }
  }, [isSessionActive, isAIResponding, sessionId, provider, trackEvent]);

  /**
   * Submit text input in advanced mode
   */
  const handleAdvancedTextSubmit = useCallback(() => {
    if (!advancedTextInput.trim() || !isSessionActive || isAdvancedSending) return;

    setIsAdvancedSending(true);
    handleSendText(advancedTextInput.trim());
    setAdvancedTextInput('');

    // Brief delay before allowing next submission
    setTimeout(() => setIsAdvancedSending(false), 300);
  }, [advancedTextInput, isSessionActive, isAdvancedSending, handleSendText]);

  /**
   * Handle Enter key for text input in advanced mode
   */
  const handleAdvancedTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdvancedTextSubmit();
    }
  }, [handleAdvancedTextSubmit]);

  /**
   * Play audio from a conversation item
   */
  const handlePlayAudio = useCallback(async (item: ConversationItem) => {
    try {
      const audioService = audioServiceRef.current;
      if (!audioService) {
        console.error('[Sokuji] [MainPanel] Audio service not available');
        return;
      }

      // If already playing something, interrupt it first
      if (playingItemId) {
        await audioService.interruptAudio();
        setPlayingItem(null);
      }

      // If this is the same item that was playing, just stop it
      if (playingItemId === item.id) {
        return;
      }

      // Clear any interrupted tracks
      audioService.clearInterruptedTracks();
      
      // Check if the item has audio data
      if (!item.formatted?.audio) {
        console.error('[Sokuji] [MainPanel] No audio data found in the item');
        return;
      }

      // The clearInterruptedTracks above should have cleared all interrupted tracks
      // No need for additional manual clearing

      // If monitor is not muted, ensure monitor device is connected
      if (!isMonitorMuted && selectedMonitorDevice && !isVirtualDevice(selectedMonitorDevice as any)) {
        selectMonitorDevice(selectedMonitorDevice);
      }

      // Play the audio using the audio service
      // For manual playback (inline-play-button), always play regardless of monitor device state
      // This is user's explicit action and should always work
      const shouldPlayAudio = true; // Always play for manual playback (user's explicit action)
      const itemAudioData = item.formatted.audio;
      if (itemAudioData instanceof Int16Array) {
        audioService.addAudioData(itemAudioData, item.id, shouldPlayAudio, { itemId: item.id });
      } else if (itemAudioData instanceof ArrayBuffer) {
        audioService.addAudioData(new Int16Array(itemAudioData), item.id, shouldPlayAudio, { itemId: item.id });
      } else {
        console.error('[Sokuji] [MainPanel] Unsupported audio data type');
        return;
      }
      
      // Store the current item ID to use in the timeout
      const currentItemId = item.id;
      setPlayingItem(currentItemId);
      
      // Calculate audio duration based on the audio data
      let audioLength = 0;
      
      // Type assertion to access properties safely
      const audioData = item.formatted.audio as any;
      
      if (audioData instanceof Int16Array) {
        // If it's a proper Int16Array, use its length
        audioLength = audioData.length;
        console.debug('[Sokuji] [MainPanel] Audio is Int16Array with length: ' + audioLength);
      } else if (audioData && typeof audioData === 'object') {
        if ('byteLength' in audioData && typeof audioData.byteLength === 'number') {
          // If it has byteLength property
          audioLength = audioData.byteLength / 2; // 2 bytes per Int16 sample
          console.debug('[Sokuji] [MainPanel] Audio has byteLength: ' + audioData.byteLength + ', calculated length: ' + audioLength);
        } else if ('length' in audioData && typeof audioData.length === 'number') {
          // If it has a numeric length property
          audioLength = audioData.length;
          console.debug('[Sokuji] [MainPanel] Audio has length property: ' + audioLength);
        } else {
          // Last resort: count the keys in the object
          audioLength = Object.keys(audioData).length;
          console.debug('[Sokuji] [MainPanel] Audio length calculated from object keys: ' + audioLength);
        }
      }
      
      // Calculate duration in milliseconds (24kHz sample rate)
      const durationMs = (audioLength / 24000) * 1000;
      console.debug('[Sokuji] [MainPanel] Audio duration: ' + durationMs + 'ms');
      
      // Use a minimum duration if calculated duration is too short
      const actualDurationMs = Math.max(durationMs, 1000);
      
      // Set a timeout to clear the playing state
      setTimeout(() => {
        // Use getState() for a fresh read inside the async timeout callback
        if (usePlaybackStore.getState().playingItemId === currentItemId) {
          setPlayingItem(null);
        }
      }, actualDurationMs + 50); // Add 50ms buffer

      console.info('[Sokuji] [MainPanel] Playing audio from item ' + item.id);
    } catch (error) {
      console.error('[Sokuji] [MainPanel] Error playing audio:', error);
      setPlayingItem(null);
    }
  }, [isMonitorMuted, selectedMonitorDevice, selectMonitorDevice, playingItemId, setPlayingItem]);

  /**
   * Play or stop test tone for debugging
   */
  const playTestTone = useCallback(async () => {
    try {
      const audioService = audioServiceRef.current;
      if (!audioService) {
        console.error('[Sokuji] [MainPanel] Audio service not available');
        return;
      }

      // If test tone is already playing, stop it
      if (isTestTonePlaying) {
        await audioService.interruptAudio();
        setIsTestTonePlaying(false);
        console.info('[Sokuji] [MainPanel] Stopped test tone');
        return;
      }

      // Clear the interrupted status for the test-tone track
      // This is necessary because ModernAudioPlayer keeps track of interrupted tracks
      // and won't play them again unless cleared
      audioService.clearInterruptedTracks();
      
      // Add debug logging to check ModernAudioPlayer's interruptedTracks
      const modernAudioPlayer = audioService.getWavStreamPlayer();
      console.debug('[Sokuji] [MainPanel] ModernAudioPlayer before playing test tone');
      
      // Check if test-tone is in interrupted tracks
      const interruptedTracks = (modernAudioPlayer as any).interruptedTracks;
      if (interruptedTracks instanceof Set && interruptedTracks.has('test-tone')) {
        console.debug('[Sokuji] [MainPanel] test-tone is in interrupted tracks, will be cleared by clearInterruptedTracks');
      }
      
      console.debug('[Sokuji] [MainPanel] Cleared interrupted tracks before playing test tone');

      // Fetch the test tone file
      let testToneUrl = '/assets/test-tone.mp3';

      // Check if we're in a Chrome extension environment
      if (typeof window !== 'undefined') {
        const chromeRuntime = (window as any).chrome?.runtime;
        if (chromeRuntime?.getURL) {
          // Use the extension's assets path
          testToneUrl = chromeRuntime.getURL('assets/test-tone.mp3');
        }
      }

      const response = await fetch(testToneUrl);
      const arrayBuffer = await response.arrayBuffer();

      // Create a temporary audio context for decoding with the same sample rate as ModernAudioPlayer
      const targetSampleRate = 24000; // Match the sample rate used in ModernAudioPlayer
      const tempContext = new AudioContext({ sampleRate: targetSampleRate });
      const audioBuffer = await tempContext.decodeAudioData(arrayBuffer);

      console.debug(`[Sokuji] [MainPanel] Test tone audio info - Sample rate: ${audioBuffer.sampleRate}Hz, Duration: ${audioBuffer.duration}s, Channels: ${audioBuffer.numberOfChannels}`);

      // Check if we need to resample
      let processedBuffer = audioBuffer;
      if (audioBuffer.sampleRate !== targetSampleRate) {
        console.debug(`[Sokuji] [MainPanel] Resampling from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
        // Create an offline context for resampling
        const offlineContext = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          audioBuffer.duration * targetSampleRate,
          targetSampleRate
        );

        const bufferSource = offlineContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(offlineContext.destination);
        bufferSource.start(0);

        // Render the resampled buffer
        processedBuffer = await offlineContext.startRendering();
      }

      // Mix down to mono if stereo by averaging channels
      let monoData;
      if (processedBuffer.numberOfChannels > 1) {
        console.debug('[Sokuji] [MainPanel] Converting stereo to mono');
        monoData = new Float32Array(processedBuffer.length);
        // Get the data from both channels
        const leftChannel = new Float32Array(processedBuffer.length);
        const rightChannel = new Float32Array(processedBuffer.length);
        processedBuffer.copyFromChannel(leftChannel, 0);
        processedBuffer.copyFromChannel(rightChannel, 1);

        // Average the channels
        for (let i = 0; i < processedBuffer.length; i++) {
          monoData[i] = (leftChannel[i] + rightChannel[i]) / 2;
        }
      } else {
        // Already mono
        monoData = new Float32Array(processedBuffer.length);
        processedBuffer.copyFromChannel(monoData, 0);
      }

      // Convert to 16-bit PCM (format expected by wavStreamPlayer)
      const pcm16bit = new Int16Array(monoData.length);
      for (let i = 0; i < monoData.length; i++) {
        // Convert float (-1.0 to 1.0) to int16 (-32768 to 32767)
        // Apply a slight volume reduction to prevent clipping
        const sample = monoData[i] * 0.9; // Reduce volume by 10% to prevent clipping
        pcm16bit[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      }

      // Play the test tone using the audio service (always play, volume is controlled by monitor state)
      audioService.addAudioData(pcm16bit, 'test-tone', true);

      // Set the state to indicate test tone is playing
      setIsTestTonePlaying(true);

      // If monitor is not muted, ensure monitor device is connected immediately
      if (!isMonitorMuted && selectedMonitorDevice && !isVirtualDevice(selectedMonitorDevice as any)) {
        console.info('[Sokuji] [MainPanel] Test tone: Ensuring monitor device is connected:', selectedMonitorDevice.label);

        // Trigger the selectMonitorDevice function to reconnect the monitor
        // This will use the audio service properly through the AudioContext
        selectMonitorDevice(selectedMonitorDevice);
      }

      console.info('[Sokuji] [MainPanel] Playing test tone');
    } catch (error) {
      console.error('[Sokuji] [MainPanel] Error playing test tone:', error);
      setIsTestTonePlaying(false);
    }
  }, [isMonitorMuted, selectedMonitorDevice, selectMonitorDevice, isTestTonePlaying]);

  /**
   * Set up playback status tracking
   */
  useEffect(() => {
    if (!audioServiceRef.current) return;
    
    const player = audioServiceRef.current.getWavStreamPlayer();
    if (!player) return;
    
    // Set up status callback
    player.setPlaybackStatusCallback((status: any) => {
      if (!status) return;

      if (status.status === 'playing' && status.itemId) {
        // A new entry is now audible — cancel any pending end-of-item clear.
        if (itemEndDebounceRef.current) {
          clearTimeout(itemEndDebounceRef.current);
          itemEndDebounceRef.current = null;
        }
        setPlayingItem(status.itemId);
        return;
      }

      if (status.status !== 'ended') return;

      const currentStatus = player.getCurrentPlaybackStatus();
      if (currentStatus && currentStatus.itemId !== status.itemId) {
        // A different item is now audible — clear immediately.
        if (itemEndDebounceRef.current) {
          clearTimeout(itemEndDebounceRef.current);
          itemEndDebounceRef.current = null;
        }
        setPlayingItem(null);
        setProgress(null);
        return;
      }

      if (!currentStatus) {
        // 'ended' fired with no follow-up entry audible. Two cases:
        //  - true item end → clear the karaoke layer
        //  - mid-stream chunk gap → wait for the next chunk, don't clear
        // The player itself can't tell them apart (it sees one entry get
        // evicted in both cases). The producing client can: it flips
        // item.status to 'completed' only when no more audio is coming.
        const endedItem = itemsRef.current.find((i) => i.id === status.itemId);
        const isItemCompleted = endedItem?.status === 'completed';
        const delay = isItemCompleted
          ? ITEM_END_DEBOUNCE_COMPLETED_MS
          : ITEM_END_DEBOUNCE_MS;
        if (itemEndDebounceRef.current) clearTimeout(itemEndDebounceRef.current);
        itemEndDebounceRef.current = setTimeout(() => {
          setPlayingItem(null);
          setProgress(null);
          itemEndDebounceRef.current = null;
        }, delay);
      }
      // currentStatus.itemId === status.itemId means another entry for the
      // same item is already audible (rare); leave state alone.
    });

    // Set up progress tracking
    const progressInterval = setInterval(() => {
      const status = player.getCurrentPlaybackStatus();

      if (status && status.isPlaying) {
        setProgress({
          currentTime: status.currentTime,
          duration: status.duration,
          bufferedTime: status.bufferedTime,
        });
      } else {
        // Clear progress when nothing is playing to prevent stale data
        setProgress(null);
      }
    }, PROGRESS_UPDATE_INTERVAL);
    
    return () => {
      clearInterval(progressInterval);
      if (itemEndDebounceRef.current) {
        clearTimeout(itemEndDebounceRef.current);
        itemEndDebounceRef.current = null;
      }
    };
  }, []);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    // Initialize audio service if not already done
    if (!audioServiceRef.current) {
      audioServiceRef.current = ServiceFactory.getAudioService();
    }
    const audioService = audioServiceRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;
    const systemCanvas = systemCanvasRef.current;
    let systemCtx: CanvasRenderingContext2D | null = null;
    // Pre-allocate the byte buffer once — the analyser node's frequencyBinCount
    // doesn't change across frames, so we reuse the same array.
    let systemByteBuffer: Uint8Array | null = null;
    let systemFloatBuffer: Float32Array | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas && audioService) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const recorder = audioService.getRecorder();
            // Under callback-level pipeline gating, the recorder runs continuously
            // while the session is active — so the mute flag must gate the waveform
            // independently. Without this, mic waveform would animate even when
            // muted, contradicting the spec's "muted = flat waveform" rule.
            const result = recorder.isRecording() && !isMicMuted
              ? recorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        
        // Participant audio waveform (system audio capture) — gated on mode.
        // In-session: draw when participant channel is actually active.
        // Pre-session: draw an empty visualization for layout stability when mode
        // includes participant (the canvas is only rendered then anyway).
        const showSystemWaveform = isSessionActive
          ? participantChannelActive
          : effectiveMode === 'participant' || effectiveMode === 'both';

        if (showSystemWaveform && systemCanvas && audioService) {
          if (!systemCanvas.width || !systemCanvas.height) {
            systemCanvas.width = systemCanvas.offsetWidth;
            systemCanvas.height = systemCanvas.offsetHeight;
          }
          systemCtx = systemCtx || systemCanvas.getContext('2d');
          if (systemCtx) {
            systemCtx.clearRect(0, 0, systemCanvas.width, systemCanvas.height);
            const participantAnalyser = audioService.getParticipantAnalyser?.() ?? null;
            let values: Float32Array;
            if (participantAnalyser && !isParticipantMuted) {
              const bins = participantAnalyser.frequencyBinCount;
              if (!systemByteBuffer || systemByteBuffer.length !== bins) {
                systemByteBuffer = new Uint8Array(bins);
                systemFloatBuffer = new Float32Array(bins);
              }
              // Cast: TypeScript 5.7+ narrows TypedArray generic to ArrayBuffer
              // exactly; `new Uint8Array(n)` produces Uint8Array<ArrayBufferLike>.
              // Both shapes are safe for getByteFrequencyData at runtime.
              participantAnalyser.getByteFrequencyData(systemByteBuffer as Uint8Array<ArrayBuffer>);
              for (let i = 0; i < bins; i++) {
                systemFloatBuffer![i] = systemByteBuffer[i] / 255;
              }
              values = systemFloatBuffer!;
            } else {
              values = new Float32Array([0]);
            }
            WavRenderer.drawBars(
              systemCanvas,
              systemCtx,
              values,
              '#f59e0b',
              10,
              0,
              8
            );
          }
        }

        if (serverCanvas && audioService) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            
            try {
              // Output waveform = the signal sent to the virtual microphone
              // (AI translation + passthrough). The player's analyser is
              // pre-gain, so this reflects what the meeting receives regardless
              // of the monitor volume.
              const wavStreamPlayer = audioService.getWavStreamPlayer();
              
              // Check if the WavStreamPlayer is properly connected before calling getFrequencies
              if (wavStreamPlayer && wavStreamPlayer.context && wavStreamPlayer.context.state === 'running' && wavStreamPlayer.analyser) {
                const result = wavStreamPlayer.getFrequencies();
                WavRenderer.drawBars(
                  serverCanvas,
                  serverCtx,
                  result.values,
                  '#ff9900',
                  10,
                  0,
                  8
                );
              } else {
                // If not connected, just draw an empty visualization
                WavRenderer.drawBars(
                  serverCanvas,
                  serverCtx,
                  new Float32Array([0]),
                  '#ff9900',
                  10,
                  0,
                  8
                );
              }
            } catch (error) {
              // If there's any error, just draw an empty visualization
              WavRenderer.drawBars(
                serverCanvas,
                serverCtx,
                new Float32Array([0]),
                '#ff9900',
                10,
                0,
                8
              );
              console.warn('[Sokuji] [MainPanel] Error getting frequencies from WavStreamPlayer:', error);
            }
          }
        }
        
        requestAnimationFrame(render);
      }
    };
    
    render();
    
    return () => {
      isLoaded = false;
    };
    // isMicMuted / isParticipantMuted in deps so the render-loop closure
    // re-initializes when mute toggles — without them, the rAF callback
    // captures a stale mute value and the waveform gate never updates.
  }, [uiMode, effectiveMode, isSessionActive, participantChannelActive, isMicMuted, isParticipantMuted]);

  /**
   * Auto-scroll to the bottom of the conversation when new content is added
   * Watches both speaker items and participant items for changes
   */
  useEffect(() => {
    if (conversationContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        // Add a small delay to ensure content is fully rendered
        setTimeout(() => {
          if (conversationContainerRef.current) {
            const element = conversationContainerRef.current;
            element.scrollTop = element.scrollHeight;
          }
        }, 100);
      });
    }
  }, [items, participantItems]);

  /**
   * Watch for changes to selectedMonitorDevice or isMonitorMuted
   * and update the audio monitoring accordingly
   */
  useEffect(() => {
    // Get the audio service
    const audioService = audioServiceRef.current;
    if (!audioService) {
      return;
    }

    // Function to connect the monitor output
    const updateMonitorDevice = async () => {
      try {
        // Check if the selectedMonitorDevice is a virtual device (which shouldn't be used as monitor)
        if (selectedMonitorDevice && isVirtualDevice(selectedMonitorDevice as any)) {
          console.info('[Sokuji] [MainPanel] Selected monitor device is a virtual device - not using as monitor');
          return;
        }

        // If monitor is not muted, connect the monitor
        if (!isMonitorMuted && selectedMonitorDevice) {
          console.info(`[Sokuji] [MainPanel] Setting up monitor output to: ${selectedMonitorDevice.label}`);

          // Trigger the selectMonitorDevice function to reconnect the monitor
          // This will use the audio service properly through the AudioContext
          selectMonitorDevice(selectedMonitorDevice);
        }
      } catch (error) {
        console.error('[Sokuji] [MainPanel] Error setting up monitor device:', error);
      }
    };

    updateMonitorDevice();
  }, [selectedMonitorDevice, isMonitorMuted, isSessionActive, selectMonitorDevice]);

  /**
   * Set up push-to-talk keyboard shortcut
   */
  useEffect(() => {
    // Enable space hold-to-speak when session is active and we're in a PTT-like mode
    // (Push-to-Talk, Push-to-Translate, or OpenAI's Disabled mode)
    const isHoldToSpeakEnabled = isSessionActive && speakerChannelActive && canHoldToSpeak;

    // Handle key down (start recording)
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is on an input element (e.g., text input field)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      if (!isHoldToSpeakEnabled || e.repeat || e.code !== 'Space') return;
      e.preventDefault(); // Prevent page scrolling
      startRecording();
    };

    // Handle key up (stop recording)
    const handleKeyUp = (e: KeyboardEvent) => {
      // Skip if focus is on an input element (e.g., text input field)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      if (!isHoldToSpeakEnabled || e.code !== 'Space') return;
      e.preventDefault(); // Prevent page scrolling
      stopRecording();
    };

    // Handle window blur event to stop recording if the window loses focus
    // while recording is active
    const handleBlur = () => {
      if (isHoldToSpeakEnabled && isRecording) {
        stopRecording();
      }
    };

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    // Clean up event listeners
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isSessionActive, speakerChannelActive, canHoldToSpeak, startRecording, stopRecording, isRecording]);

  // Session tracking for analytics
  useEffect(() => {
    if (isSessionActive) {
      // Only run on session start transition
      if (sessionId === null) { 
        const newSessionId = uuidv4();
        const startTime = Date.now();
        setSessionId(newSessionId);
        setSessionStartTime(startTime);
        setTranslationCount(0);
  
        const currentSettings = getCurrentProviderSettings();
        const sessionConfig = getSessionConfig();
        const localConfig = sessionConfig.provider === 'local_inference' ? sessionConfig : null;
        // Symmetric channel composition — which clients actually started.
        // ['speaker'] = scenario 1, ['participant'] = scenario 2, both = scenario 3.
        const channels: string[] = [];
        if (speakerChannelActive) channels.push('speaker');
        if (participantChannelActive) channels.push('participant');
        trackEvent('translation_session_start', {
          source_language: currentSettings.sourceLanguage,
          target_language: currentSettings.targetLanguage,
          session_id: newSessionId,
          provider: provider,
          model: sessionConfig.model,
          ...(localConfig && {
            asr_model: localConfig.asrModelId,
            translation_model: localConfig.translationModelId || 'unknown',
            tts_model: localConfig.ttsModelId || 'none',
          }),
          noise_suppression_enabled: noiseSuppressionMode !== 'off',
          noise_suppression_mode: noiseSuppressionMode,
          real_voice_passthrough_enabled: isRealVoicePassthroughEnabled,
          transport: transportType,
          platform: getEnvironment(),
          input_device_on: !isMicMuted,
          monitor_device_on: !isMonitorMuted,
          channels,
        });
      }
    } else {
      // Only run on session end transition
      if (sessionId !== null) {
        const duration = Date.now() - (sessionStartTime || Date.now());
        trackEvent('translation_session_end', {
          session_id: sessionId,
          duration,
          translation_count: translationCount,
          provider: provider
        });
        // Reset session state
        setSessionId(null);
        setSessionStartTime(null);
        setTranslationCount(0);
      }
    }
  }, [isSessionActive, sessionId, sessionStartTime, translationCount, getCurrentProviderSettings, setSessionId, setSessionStartTime, setTranslationCount, trackEvent, speakerChannelActive, participantChannelActive]);

  /**
   * Send anchor message if needed to prevent model drift
   * Sends out-of-band responses periodically to reinforce translator role
   * - Sends once at session start (when lastAnchorCount is -1)
   * - Then sends every N translations (configurable interval)
   * Uses conversation: 'none' so it doesn't affect conversation history
   * Uses modalities: ['text'] so it doesn't produce audio output
   */
  const sendAnchorIfNeeded = useCallback((
    client: IClient | null,
    anchorItems: ConversationItem[],
    isActive: boolean,
    sessionType: 'speaker' | 'participant',
    getSystemInstructions: () => string,
    lastAnchorCountRef: React.MutableRefObject<number>,
    interval: number = 5
  ) => {
    // Only active during sessions with OpenAI-compatible providers
    if (!isActive || !isOpenAICompatible(provider)) {
      // Reset anchor count when session ends (use -1 to trigger initial anchor on next session)
      if (!isActive) {
        lastAnchorCountRef.current = -1;
      }
      return;
    }

    // Count completed assistant items
    const completedTranslations = anchorItems.filter(
      item => item.role === 'assistant' && item.status === 'completed'
    ).length;

    // Send anchor at session start (when lastAnchorCount is -1)
    // and every N translations after that
    const shouldSendAnchorAtStart = lastAnchorCountRef.current === -1;
    const shouldSendAnchorAfterInterval = completedTranslations > 0 &&
      completedTranslations % interval === 0 &&
      completedTranslations !== lastAnchorCountRef.current;
    const shouldSendAnchor = shouldSendAnchorAtStart || shouldSendAnchorAfterInterval;

    if (shouldSendAnchor && client) {
      // Mark this count as processed before sending
      lastAnchorCountRef.current = completedTranslations;

      // Get system instructions for this session type
      const systemInstructions = getSystemInstructions();

      // Send silent out-of-band anchor response
      client.createResponse({
        conversation: 'none',
        modalities: ['text'],
        instructions: systemInstructions,
        metadata: { purpose: 'anchor', sessionType }
      });
    }
  }, [provider]);

  // Track anchor counts separately for speaker and participant sessions
  const speakerAnchorCountRef = useRef<number>(-1);
  const participantAnchorCountRef = useRef<number>(-1);

  // Speaker session anchor mechanism
  useEffect(() => {
    sendAnchorIfNeeded(
      speakerClientRef.current,
      items,
      isSessionActive,
      'speaker',
      () => getProcessedSystemInstructions(false),
      speakerAnchorCountRef,
      5
    );
  }, [items, isSessionActive, sendAnchorIfNeeded, getProcessedSystemInstructions]);

  // Participant session anchor mechanism
  useEffect(() => {
    // Only activate when participant session exists (participantClientRef is set)
    const participantClient = participantClientRef.current;
    const isParticipantActive = isSessionActive && participantClient !== null;

    sendAnchorIfNeeded(
      participantClient,
      participantItems,
      isParticipantActive,
      'participant',
      () => getProcessedSystemInstructions(true), // Swapped languages for participant
      participantAnchorCountRef,
      5
    );
  }, [participantItems, isSessionActive, sendAnchorIfNeeded, getProcessedSystemInstructions]);

  /**
   * Handle input device changes during active session
   */
  useEffect(() => {
    // Only handle device changes if session is active.
    // Under callback-level pipeline gating the recorder runs continuously (even when
    // mic is muted), so device switches should be applied immediately regardless of
    // mute state — the gated callback already prevents sending audio to the AI client.
    if (!isSessionActive) {
      // Reset initialized flag when session ends
      isInitializedRef.current = false;
      return;
    }

    const audioService = audioServiceRef.current;
    if (!audioService || !audioService.switchRecordingDevice) {
      return;
    }

    // Don't switch on initial mount
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }

    // Handle device switching
    const handleDeviceSwitch = async () => {
      try {
        console.info(`[Sokuji] [MainPanel] Switching recording device during active session to: ${selectedInputDevice?.label}`);
        await audioService.switchRecordingDevice!(selectedInputDevice?.deviceId);
        
        // Track successful device change during active session
        trackEvent('audio_device_changed', {
          device_type: 'input',
          device_name: selectedInputDevice?.label,
          change_type: 'selected',
          during_session: true
        });
      } catch (error: any) {
        console.error('[Sokuji] [MainPanel] Failed to switch recording device:', error);
        
        // Track failed device change
        trackEvent('audio_error', {
          error_type: 'device_access',
          error_message: error.message || 'Failed to switch recording device',
          device_info: selectedInputDevice?.label
        });
        
        addRealtimeEvent(
          { 
            type: 'error', 
            data: {
              message: `Failed to switch recording device: ${error?.message || 'Unknown error'}`
            }
          },
          'client',
          'error'
        );
      }
    };

    handleDeviceSwitch();
  }, [selectedInputDevice?.deviceId, isSessionActive]);

  /**
   * Handle monitor mute state for WebRTC clients
   */
  useEffect(() => {
    const client = speakerClientRef.current;
    if (!isSessionActive || !isUsingWebRTC || !client) return;

    // Check if client supports muting
    if (typeof client.setOutputMuted === 'function') {
      client.setOutputMuted(isMonitorMuted);
      console.debug('[Sokuji] [MainPanel] WebRTC output muted:', isMonitorMuted);
    }
  }, [isMonitorMuted, isSessionActive, isUsingWebRTC]);

  /**
   * Handle input device switching for WebRTC clients
   */
  useEffect(() => {
    const client = speakerClientRef.current;
    if (!isSessionActive || !isUsingWebRTC || !client) return;

    // Don't switch on initial mount (already set during connect)
    if (!isInitializedRef.current) return;

    // Switch input device if supported
    if (selectedInputDevice?.deviceId && typeof client.switchInputDevice === 'function') {
      client.switchInputDevice(selectedInputDevice.deviceId)
        .then(() => {
          console.debug('[Sokuji] [MainPanel] WebRTC input device switched to:', selectedInputDevice.deviceId);
        })
        .catch(err => console.error('[Sokuji] [MainPanel] Failed to switch WebRTC input device:', err));
    }
  }, [selectedInputDevice?.deviceId, isSessionActive, isUsingWebRTC]);

  /**
   * Handle output device switching for WebRTC clients
   */
  useEffect(() => {
    const client = speakerClientRef.current;
    if (!isSessionActive || !isUsingWebRTC || !client) return;

    // Switch output device if supported
    if (selectedMonitorDevice?.deviceId && typeof client.switchOutputDevice === 'function') {
      client.switchOutputDevice(selectedMonitorDevice.deviceId)
        .then(() => {
          console.debug('[Sokuji] [MainPanel] WebRTC output device switched to:', selectedMonitorDevice.deviceId);
        })
        .catch(err => console.error('[Sokuji] [MainPanel] Failed to switch WebRTC output device:', err));
    }
  }, [selectedMonitorDevice?.deviceId, isSessionActive, isUsingWebRTC]);

  // Get current provider settings for language pair display
  const currentSettings = getCurrentProviderSettings();

  // Active source/target languages for badge labels (provider-agnostic).
  const sourceLanguage = currentSettings.sourceLanguage ?? 'EN';
  const targetLanguage = currentSettings.targetLanguage ?? 'EN';

  // (renderConversationItem has been extracted to ConversationBubble above the component.)

  // Unified render for both modes
  return (
    <div
      className="main-panel-wrapper"
      style={{
        '--conversation-bg-color': conversationBgColor,
        '--conversation-source-color': conversationSourceTextColor,
        '--conversation-translation-color': conversationTranslationTextColor,
      } as React.CSSProperties}
    >
      <UpdateBanner />
      <AudioSystemBanner />
      <UpdateDialog />
      <div className="main-panel">
        {/* Conversation toolbar */}
        {(isSessionActive || combinedItems.length > 0) && (
          <>
          <div className="conversation-toolbar">
            {/*
              Show each display-mode button when its channel is intent-active for
              the (current or locked) session, OR when items already exist for that
              channel — the items fallback keeps the buttons available after the
              session ends so users can still reconfigure display of historical
              conversation. Previously: speaker button always showed (wrong in
              participant-only mode) and participant button was late-binding on
              items (no preconfig before the first translation arrived).
            */}
            {(effectiveMode === 'speaker' || effectiveMode === 'both' || items.length > 0) && (
              <DisplayModeButton
                scope="speaker"
                value={speakerDisplayMode}
                onChange={setSpeakerDisplayMode}
              />
            )}
            {(effectiveMode === 'participant' || effectiveMode === 'both' || participantItems.length > 0) && (
              <DisplayModeButton
                scope="participant"
                value={participantDisplayMode}
                onChange={setParticipantDisplayMode}
              />
            )}
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.max(CONVERSATION_FONT_SIZE_MIN, conversationFontSize - 2))}
              disabled={conversationFontSize <= CONVERSATION_FONT_SIZE_MIN}
              title={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              aria-label={t('mainPanel.decreaseFontSize', 'Decrease font size')}
              type="button"
            >
              <AArrowDown size={14} />
            </button>
            <button
              className="font-size-btn"
              onClick={() => setConversationFontSize(Math.min(CONVERSATION_FONT_SIZE_MAX, conversationFontSize + 2))}
              disabled={conversationFontSize >= CONVERSATION_FONT_SIZE_MAX}
              title={t('mainPanel.increaseFontSize', 'Increase font size')}
              aria-label={t('mainPanel.increaseFontSize', 'Increase font size')}
              type="button"
            >
              <AArrowUp size={14} />
            </button>
            <button
              className="font-size-btn"
              onClick={() => setConversationCompactMode(!conversationCompactMode)}
              aria-pressed={conversationCompactMode}
              title={
                conversationCompactMode
                  ? t('mainPanel.expandedView', 'Expanded view')
                  : t('mainPanel.compactView', 'Compact view')
              }
              aria-label={
                conversationCompactMode
                  ? t('mainPanel.expandedView', 'Expanded view')
                  : t('mainPanel.compactView', 'Compact view')
              }
              type="button"
            >
              {conversationCompactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
            {/* Export */}
            <ExportButton
              combinedItems={combinedItems}
              provider={provider}
              currentProviderSettings={currentSettings}
              localInferenceSettings={localInferenceSettings}
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
            />
            <button
              className="font-size-btn"
              ref={displayPopoverFloating.refs.setReference}
              {...displayPopoverInteractions.getReferenceProps()}
              title={t('mainPanel.displaySettings', 'Display settings')}
              aria-label={t('mainPanel.displaySettings', 'Display settings')}
              type="button"
            >
              <Settings size={14} />
            </button>
            <button
              className="clear-conversation-btn"
              onClick={requestClearConversation}
              title={t('mainPanel.clearConversation', 'Clear conversation')}
              aria-label={t('mainPanel.clearConversation', 'Clear conversation')}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
          {displayPopoverOpen && (
            <FloatingPortal>
              <div
                ref={displayPopoverFloating.refs.setFloating}
                style={displayPopoverFloating.floatingStyles}
                aria-label={t('mainPanel.displaySettings', 'Display settings')}
                {...displayPopoverInteractions.getFloatingProps()}
              >
                <DisplaySettingsPopover source="conversation" />
              </div>
            </FloatingPortal>
          )}
          </>
        )}
        {/* Conversation Display */}
        <div
          className="conversation-display"
          ref={conversationContainerRef}
          style={{ '--conversation-font-size': `${conversationFontSize}px` } as React.CSSProperties}
        >
          {subtitleTakeover ? (
            <div className="empty-state">
              <Captions size={32} />
              <p>{t('mainPanel.subtitleTakeover', 'Translations are showing in the subtitle overlay')}</p>
            </div>
          ) : combinedItems.length === 0 ? (
            <div className="empty-state">
              <MessageSquare size={32} />
              <p>{t('simplePanel.startToBegin', 'Click Start to begin real-time translation')}</p>
            </div>
          ) : (
            <div className="conversation-list">
              {(() => {
                // prevItem must be the previous *rendered-as-row* item (other
                // types — tool calls, audio-only, errors — would incorrectly
                // collapse the header because they default source='speaker').
                // Single forward pass tracking the last text-bearing message
                // avoids an O(N²) backward scan per render.
                let lastTextMsg: (ConversationItem & { source?: string }) | null = null;
                return filteredItems.map((item, i) => {
                  const prevItem = lastTextMsg;
                  const hasText = !!(item.formatted?.transcript || item.formatted?.text);
                  if (item.type === 'message' && hasText) {
                    lastTextMsg = item as ConversationItem & { source?: string };
                  }

                  const audio = item.formatted?.audio as any;
                  const audioSize = audio?.length ?? audio?.byteLength ?? 0;
                  const canPlay =
                    ((item as any).status === 'completed' || (item as any).status === 'incomplete') &&
                    audioSize > 0;

                  return (
                    <ConversationBubble
                      key={`${(item as any).source || 'speaker'}_${item.id || i}`}
                      item={item}
                      index={i}
                      prevItem={prevItem}
                      sourceLanguage={sourceLanguage}
                      targetLanguage={targetLanguage}
                      canPlay={canPlay}
                      onPlay={() => handlePlayAudio(item)}
                      someItemPlaying={playingItemId !== null}
                      uiMode={uiMode}
                      compact={conversationCompactMode}
                      replayEnabled={replayEnabled}
                    />
                  );
                });
              })()}
            </div>
          )}
        </div>

        {/* Text Input Section */}
        {isSessionActive && supportsTextInput && (
          <div className="text-input-section">
            <div className="text-input-container">
              <input
                type="text"
                className="text-input"
                placeholder={t('mainPanel.typeMessage', 'Text to translate...')}
                value={advancedTextInput}
                onChange={(e) => setAdvancedTextInput(e.target.value)}
                onKeyDown={handleAdvancedTextKeyDown}
                maxLength={1000}
              />
              <button
                className={`send-btn ${!advancedTextInput.trim() ? 'disabled' : ''}`}
                onClick={handleAdvancedTextSubmit}
                onMouseDown={(e) => e.preventDefault()}
                disabled={!advancedTextInput.trim() || isAdvancedSending}
                title={t('mainPanel.send', 'Send')}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Control Footer — Basic Mode */}
        {uiMode === 'basic' && (
          <div className="control-footer basic">
            <span className={`status-dot ${isReconnecting ? 'reconnecting' : isSessionActive ? 'active' : ''}`} />
            {isReconnecting && (
              <span className="reconnecting-label">
                {t('connectionStatus.reconnecting', 'Reconnecting...')}
              </span>
            )}
            <ModePicker
              mode={effectiveMode}
              locked={isSessionActive || isInitializing}
              missingDeviceForMode={missingDeviceForMode}
              onSegmentClick={(target, el) => {
                if (target === effectiveMode) {
                  // Toggle: clicking the active segment again closes the popover.
                  if (modePopoverOpen) {
                    setModePopoverOpen(false);
                  } else {
                    setModePopoverAnchor(el);
                    setModePopoverOpen(true);
                  }
                } else {
                  handleModeSwitch(target);
                  setModePopoverOpen(false);
                }
              }}
            />

            {/* Directly beside the "Both" segment it contradicts. Renders
                nothing unless the split actually failed to take effect. */}
            <SplitDegradedChip reason={splitDegraded} />

            <span className="footer-spacer" />

            <div className="action-cluster">
              {isSessionActive && speakerChannelActive && canHoldToSpeak && (
                <button
                  className={`push-to-talk-btn ${isRecording ? 'recording' : ''}`}
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                >
                  <Mic size={12} />
                  <span className="btn-text">{isRecording ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
                </button>
              )}
              <button
                className={`main-action-btn ${isSessionActive ? 'stop' : 'start'}`}
                onClick={isSessionActive ? disconnectConversation : connectConversation}
                disabled={!canStartSession && !isSessionActive}
                title={!isSessionActive ? startBlockMessage : undefined}
              >
                {isInitializing ? (
                  <>
                    <Loader className="spinning" size={16} />
                    <span className="btn-text">
                      {voicePreparing
                        ? t('simplePanel.preparingVoice', 'Preparing your voice…')
                        : initProgress
                          ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                          : nativeAsrLoading
                            ? t('simplePanel.loadingModel', 'Loading model…')
                            : t('simplePanel.connecting', 'Connecting...')}
                    </span>
                  </>
                ) : isSessionActive ? (
                  <>
                    <span className="stop-icon">■</span>
                    <span className="btn-text">{t('simplePanel.stop', 'Stop')}</span>
                  </>
                ) : (
                  <>
                    <span className="play-icon">▶</span>
                    <span className="btn-text">{t('simplePanel.start', 'Start')}</span>
                  </>
                )}
              </button>
            </div>

            <span className="footer-spacer" />

            <div className="footer-metadata">
              <span
                className="language-pair clickable"
                onClick={() => navigateToSettings('languages')}
                title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
              >
                {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
              </span>
              {isSessionActive && (
                <span className="session-duration">{sessionDuration}</span>
              )}
              {isSessionActive && sonioxCountdown && (
                <span className={`session-remaining-time${sonioxRemainingLow ? ' low' : ''}`}>
                  {formatRemainingTime(sonioxCountdown.remainingMs)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Control Footer — Advanced Mode */}
        {uiMode === 'advanced' && (
          <div className="control-footer advanced">
            <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />

            <ModePicker
              mode={effectiveMode}
              locked={isSessionActive || isInitializing}
              missingDeviceForMode={missingDeviceForMode}
              onSegmentClick={(target, el) => {
                if (target === effectiveMode) {
                  // Toggle: clicking the active segment again closes the popover.
                  if (modePopoverOpen) {
                    setModePopoverOpen(false);
                  } else {
                    setModePopoverAnchor(el);
                    setModePopoverOpen(true);
                  }
                } else {
                  handleModeSwitch(target);
                  setModePopoverOpen(false);
                }
              }}
            />

            {/* Same chip, same placement, in the advanced footer too. The
                missing participant waveform below is only a hint, and only
                here — basic mode has no waveforms at all. */}
            <SplitDegradedChip reason={splitDegraded} />

            {/* Input waveforms (mic + system) grouped with a tight gap so
                they read as a pair, distinct from the wider footer rhythm. */}
            {(effectiveMode === 'speaker' || effectiveMode === 'participant' || effectiveMode === 'both') && (
              <div className="waveform-input-group">
                {(effectiveMode === 'speaker' || effectiveMode === 'both') && (
                  <WaveformStrip
                    kind="mic"
                    canvasRef={clientCanvasRef}
                    width={effectiveMode === 'both' ? 'half' : 'full'}
                    title={t('mainPanel.waveformMicTooltip', 'Your microphone — your voice being captured for translation')}
                  />
                )}
                {(effectiveMode === 'participant' || effectiveMode === 'both') && (
                  <WaveformStrip
                    kind="system"
                    canvasRef={systemCanvasRef}
                    width={effectiveMode === 'both' ? 'half' : 'full'}
                    title={t('mainPanel.waveformSystemTooltip', 'Participant audio captured for translation (browser tab / system audio)')}
                  />
                )}
              </div>
            )}

            <span className="footer-spacer" />

            <div className="action-cluster">
              {isSessionActive && speakerChannelActive && canHoldToSpeak && (
                <button
                  className={`push-to-talk-button ${isRecording ? 'recording' : ''}`}
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  disabled={isMicMuted}
                >
                  <Mic size={14} />
                  <span>
                    {isRecording ? t('mainPanel.release') : !isMicMuted ? t('mainPanel.pushToTalk') : t('mainPanel.inputDeviceOff')}
                  </span>
                </button>
              )}
              <button
                className={`session-button ${isSessionActive ? 'active' : ''}`}
                onClick={() => {
                  trackEvent('session_control_clicked', {
                    action: isSessionActive ? 'stop' : 'start',
                    method: 'button'
                  });
                  if (isSessionActive) {
                    disconnectConversation();
                  } else {
                    connectConversation();
                  }
                }}
                disabled={(!isSessionActive && !canStartSession) || isInitializing}
              >
                {isInitializing ? (
                  <>
                    <Loader size={14} className="spinner" />
                    <span>
                      {voicePreparing
                        ? t('mainPanel.preparingVoice', 'Preparing your voice…')
                        : initProgress
                          ? t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                          : t('mainPanel.initializing')}
                    </span>
                  </>
                ) : isSessionActive ? (
                  <>
                    <X size={14} />
                    <span>{t('mainPanel.endSession')}</span>
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    <span>{t('mainPanel.startSession')}</span>
                    {startGate.reason && (
                      <span className="tooltip">{startBlockMessage}</span>
                    )}
                  </>
                )}
              </button>

              {isDevelopment() && (
                <button
                  className={`debug-button ${isTestTonePlaying ? 'active' : ''}`}
                  onClick={playTestTone}
                >
                  <Wrench size={14} />
                  <span>{isTestTonePlaying ? t('mainPanel.stopDebug') : t('mainPanel.debug')}</span>
                </button>
              )}
            </div>

            <span className="footer-spacer" />

            <WaveformStrip kind="output" canvasRef={serverCanvasRef} width="full" title={t('mainPanel.waveformOutputTooltip', 'Audio sent to the virtual microphone (translation + passthrough)')} />

            <div className="footer-metadata">
              <span
                className="language-pair clickable"
                onClick={() => navigateToSettings('languages')}
                title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
              >
                {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
              </span>
              {isSessionActive && (
                <span className="session-duration">{sessionDuration}</span>
              )}
              {isSessionActive && sonioxCountdown && (
                <span className={`session-remaining-time${sonioxRemainingLow ? ' low' : ''}`}>
                  {formatRemainingTime(sonioxCountdown.remainingMs)}
                </span>
              )}
            </div>
          </div>
        )}

        <AudioFeedbackWarning
          isVisible={showFeedbackWarning}
          inputDeviceLabel={selectedInputDevice?.label}
          outputDeviceLabel={selectedMonitorDevice?.label}
          recommendedAction={
            getSafeAudioConfiguration(
              selectedInputDevice,
              selectedMonitorDevice,
              passthroughActive
            ).recommendedAction
          }
          feedbackRisk={
            getSafeAudioConfiguration(
              selectedInputDevice,
              selectedMonitorDevice,
              passthroughActive
            ).feedbackRisk
          }
          onDismiss={() => {
            setShowFeedbackWarning(false);
            setFeedbackWarningDismissed(true);
          }}
        />
      </div>
      <WarningModal
        isOpen={permissionWarning !== null}
        onClose={() => setPermissionWarning(null)}
        type={permissionWarning}
        note={
          // Whole-system capture is the only path needing Screen Recording.
          // Saying so turns a dead end into a one-click alternative, as long as
          // an application is actually available to pick.
          permissionWarning === 'screen-recording-denied' && participantSources.length > 1
            ? t(
                'audioPanel.screenRecordingHasAlternative',
                'You can avoid this permission entirely: pick a specific application as the participant source instead. Applications only appear in that list while they are playing audio.'
              )
            : null
        }
      />
      {modePopoverOpen && (
        <ModeDevicePopover
          mode={effectiveMode}
          open={modePopoverOpen}
          anchorEl={modePopoverAnchor}
          onClose={() => setModePopoverOpen(false)}
        />
      )}
    </div>
  );
};

export default MainPanel;

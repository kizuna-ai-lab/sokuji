import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {X, Zap, Users, Mic, Loader, Play, Volume2, Wrench, Send, AlertCircle} from 'lucide-react';
import './MainPanel.scss';
import {
  useProvider,
  useUIMode,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useIsApiKeyValid,
  useAvailableModels,
  useLoadingModels,
  useGetCurrentProviderSettings,
  useGetProcessedSystemInstructions,
  useCreateSessionConfig,
  useTransportType
} from '../../stores/settingsStore';
import { useSession } from '../../stores/sessionStore';
import { useAudioContext } from '../../stores/audioStore';
import { useLogActions } from '../../stores/logStore';
import type { RealtimeEvent } from '../../stores/logStore';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ClientFactory, ResponseConfig } from '../../services/clients';
import { WavRenderer } from '../../utils/wav_renderer';
import { ServiceFactory } from '../../services/ServiceFactory'; // Import the ServiceFactory
import { IAudioService } from '../../services/interfaces/IAudioService';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { isDevelopment } from '../../config/analytics';
import { v4 as uuidv4 } from 'uuid';
import { Provider, isOpenAICompatible } from '../../types/Provider';
import AudioFeedbackWarning from '../AudioFeedbackWarning/AudioFeedbackWarning';
import { getSafeAudioConfiguration, decodeAudioToWav } from '../../utils/audioUtils';
import SimpleMainPanel from '../SimpleMainPanel/SimpleMainPanel';
import { useAuth } from '../../lib/auth/hooks';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { isExtension } from '../../utils/environment';

interface MainPanelProps {}

const MainPanel: React.FC<MainPanelProps> = () => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  
  // Get authentication state for Kizuna AI dynamic token fetching
  const { getToken, isSignedIn, isLoaded } = useAuth();
  
  // Get user profile and quota information
  const { quota, refetchAll } = useUserProfile();
  
  // State for session management
  const [isRecording, setIsRecording] = useState(false);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Get settings from store
  const provider = useProvider();
  const uiMode = useUIMode();
  const openAISettings = useOpenAISettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const geminiSettings = useGeminiSettings();
  const palabraAISettings = usePalabraAISettings();
  const kizunaAISettings = useKizunaAISettings();
  const transportType = useTransportType();
  const isApiKeyValid = useIsApiKeyValid();
  const availableModels = useAvailableModels();
  const loadingModels = useLoadingModels();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
  const getProcessedSystemInstructions = useGetProcessedSystemInstructions();
  const createSessionConfig = useCreateSessionConfig();
  
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

  // Get log functions from store
  const { addRealtimeEvent } = useLogActions();

  // Get audio context from context
  const {
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    selectMonitorDevice, // Import the selectMonitorDevice function from context
    // System audio capture
    selectedSystemAudioSource,
    systemAudioLoopbackSourceId,
    isSystemAudioCaptureEnabled,
    participantAudioOutputDevice
  } = useAudioContext();

  // canPushToTalk is true only when turnDetectionMode is 'Disabled'
  const [canPushToTalk, setCanPushToTalk] = useState(false);

  // Track if current session is using WebRTC transport
  const [isUsingWebRTC, setIsUsingWebRTC] = useState(false);

  // supportsTextInput is true for providers that support text input
  const supportsTextInput = useMemo(() => {
    return provider === Provider.OPENAI ||
           provider === Provider.GEMINI ||
           provider === Provider.OPENAI_COMPATIBLE ||
           provider === Provider.KIZUNA_AI;
  }, [provider]);

  // Advanced mode text input state
  const [advancedTextInput, setAdvancedTextInput] = useState('');
  const [isAdvancedSending, setIsAdvancedSending] = useState(false);

  // Reference for conversation container to enable auto-scrolling
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  const isInitializedRef = useRef(false);

  // Add state variables to track if test tone is playing and currently playing audio item
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<{
    currentTime: number;
    duration: number;
    bufferedTime: number;
  } | null>(null);
  
  // Audio feedback warning state
  const [showFeedbackWarning, setShowFeedbackWarning] = useState(false);
  const [feedbackWarningDismissed, setFeedbackWarningDismissed] = useState(false);

  // AI response state for text input queueing (OpenAI only)
  const [isAIResponding, setIsAIResponding] = useState(false);
  const pendingTextRef = useRef<string | null>(null);

  /**
   * Convert settings to SessionConfig
   */
  const getSessionConfig = useCallback((): SessionConfig => {
    // Get processed system instructions from the context
    const systemInstructions = getProcessedSystemInstructions();
    
    // Use the type-safe createSessionConfig from SettingsContext
    return createSessionConfig(systemInstructions);
  }, [getProcessedSystemInstructions, createSessionConfig]);

  /**
   * Helper to create AI client with appropriate parameters based on provider
   */
  const createAIClient = useCallback((modelName: string, apiKey: string, useWebRTC: boolean = false): IClient => {
    const customEndpoint = provider === Provider.OPENAI_COMPATIBLE
      ? openAICompatibleSettings.customEndpoint
      : undefined;

    // Determine transport type based on provider and useWebRTC flag
    // For PalabraAI (LiveKit), treat as 'webrtc' mode for unified handling
    const effectiveTransportType = (useWebRTC || provider === Provider.PALABRA_AI) ? 'webrtc' : 'websocket';

    // Check if this provider uses native audio capture (WebRTC or PalabraAI/LiveKit)
    // Both need device IDs for MediaStreamTrack configuration
    const usesNativeCapture = ClientFactory.usesNativeAudioCapture(provider, effectiveTransportType);

    // WebRTC options for native audio capture (OpenAI WebRTC and PalabraAI/LiveKit)
    // The outputDeviceId enables direct audio playback through HTMLAudioElement, allowing
    // the browser's AEC to see the remote audio and cancel it from microphone input
    // When isInputDeviceOn is false (input device "off"), don't pass inputDeviceId to prevent audio capture
    const webrtcOptions = usesNativeCapture ? {
      inputDeviceId: isInputDeviceOn ? selectedInputDevice?.deviceId : undefined,
      outputDeviceId: selectedMonitorDevice?.deviceId
    } : undefined;

    return ClientFactory.createClient(
      modelName,
      provider,
      apiKey,
      provider === Provider.PALABRA_AI ? palabraAISettings.clientSecret : undefined,
      customEndpoint,
      effectiveTransportType,
      webrtcOptions
    );
  }, [provider, openAICompatibleSettings.customEndpoint, palabraAISettings.clientSecret, selectedInputDevice?.deviceId, selectedMonitorDevice?.deviceId, isInputDeviceOn]);

  /**
   * Helper to create event handlers for participant audio client
   */
  const createParticipantEventHandlers = useCallback((
    client: IClient
  ): ClientEventHandlers => ({
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
      setSystemAudioItems(client.getConversationItems());
    },
    onClose: async () => {
      console.info('[Sokuji] [MainPanel] Participant audio client closed (triggered by speaker disconnect or manual stop)');
    }
  }), [addRealtimeEvent]);

  /**
   * Helper to create session config for participant mode (swapped languages, text-only, semantic VAD)
   */
  const createParticipantSessionConfig = useCallback(() => {
    const swappedSystemInstructions = getProcessedSystemInstructions(true);
    return {
      ...createSessionConfig(swappedSystemInstructions),
      textOnly: true,
      // Override turn detection to use semantic VAD for participant audio
      turnDetection: {
        type: 'semantic_vad' as const,
        createResponse: true,
        interruptResponse: false,
        eagerness: 'high',
      }
    };
  }, [getProcessedSystemInstructions, createSessionConfig]);

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

        // Initialize the audio service
        await audioService.initialize();
      } catch (error) {
        console.error('[Sokuji] [MainPanel] Failed to initialize audio service:', error);
      }
    };
    
    initAudioService();
    
    // Clean up function
    return () => {
      // Any cleanup needed for the audio service
    };
  }, []);

  /**
   * Update passthrough settings when they change
   */
  useEffect(() => {
    const audioService = audioServiceRef.current;
    if (audioService) {
      audioService.setupPassthrough(
        isRealVoicePassthroughEnabled,
        realVoicePassthroughVolume
      );
      
      if (isRealVoicePassthroughEnabled) {
        console.debug('[Sokuji] [MainPanel] Updated passthrough settings: enabled=', isRealVoicePassthroughEnabled, 'volume=', realVoicePassthroughVolume);
      }
    }
  }, [isRealVoicePassthroughEnabled, realVoicePassthroughVolume, selectedInputDevice, selectedMonitorDevice, isMonitorDeviceOn]);

  /**
   * Check for potential audio feedback and show warning
   */
  useEffect(() => {
    if (feedbackWarningDismissed || !isRealVoicePassthroughEnabled || !isMonitorDeviceOn) {
      setShowFeedbackWarning(false);
      return;
    }

    const safeConfig = getSafeAudioConfiguration(
      selectedInputDevice,
      selectedMonitorDevice,
      isRealVoicePassthroughEnabled
    );

    if (!safeConfig.safePassthroughEnabled && safeConfig.recommendedAction) {
      setShowFeedbackWarning(true);
    } else {
      setShowFeedbackWarning(false);
    }
  }, [
    isRealVoicePassthroughEnabled,
    selectedInputDevice,
    selectedMonitorDevice,
    feedbackWarningDismissed,
    isMonitorDeviceOn
  ]);

  /**
   * Instantiate:
   * - AI Client (API client)
   * - Audio service reference (handles recording)
   */

  const clientRef = useRef<IClient | null>(null);

  // System audio client ref (for translating other participants)
  const systemAudioClientRef = useRef<IClient | null>(null);
  const [systemAudioItems, setSystemAudioItems] = useState<ConversationItem[]>([]);

  // Combine speaker and participant items for display with source tagging
  const combinedItems = useMemo(() => {
    // Tag speaker items
    const speakerItems = items.map(item => {
      if (!item.source) {
        return { ...item, source: 'speaker' } as ConversationItem & { source: string };
      }
      return item as ConversationItem & { source: string };
    });

    // Tag participant items (they should already be tagged, but ensure it)
    const participantItems = systemAudioItems.map(item => {
      if (!item.source) {
        return { ...item, source: 'participant' } as ConversationItem & { source: string };
      }
      return item as ConversationItem & { source: string };
    });

    // Merge and sort by createdAt timestamp for accurate ordering
    return [...speakerItems, ...participantItems].sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [items, systemAudioItems]);

  // Reference to audio service for accessing ModernAudioPlayer
  const audioServiceRef = useRef<IAudioService | null>(null);
  
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
  const UPDATE_THROTTLE_MS = 50; // Throttle UI updates to max 20Hz
  
  // Reference to track the maximum progress ratio to prevent backwards movement
  const lastMaxProgressRef = useRef<number>(0);
  
  // References for intelligent progress tracking
  const lastProgressUpdateTime = useRef<number>(0);
  const lastPlayingState = useRef<boolean>(false);
  
  // Constants for karaoke progress tracking
  const PROGRESS_UPDATE_INTERVAL = 100; // ms
  const BACKWARD_TIMEOUT = 2000; // Prevent going back within 2 seconds; reset allowed after timeout.

  /**
   * References for rendering audio visualization (canvas)
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Set up event listeners for the AI Client
   */
  const setupClientListeners = useCallback(async () => {
    const client = clientRef.current;
    const audioService = audioServiceRef.current;

    if (!client || !audioService) return;

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

        // Track AI response state for text input queueing (OpenAI only)
        const eventType = realtimeEvent.event?.type;
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
              clientRef.current?.appendInputText(text);
            }, 100);
          }
        }
      },
      onError: (event: any) => {
        console.error('[Sokuji] [MainPanel]', event);
        
        // Track API errors
        trackEvent('api_error', {
          provider: provider || Provider.OPENAI,
          error_message: event.message || event.error || 'Unknown error',
          error_type: event.type === 'error' ? 'client' : 'server'
        });
      },
      onClose: async (event: any) => {
        console.info('[Sokuji] [MainPanel] Connection closed, cleaning up session', event);

        // Track disconnection
        trackEvent('connection_status', {
          status: 'disconnected',
          provider: provider || Provider.OPENAI
        });

        // When connection closes, clean up the session state
        setIsSessionActive(false);
        setIsAIResponding(false);
        pendingTextRef.current = null;

        // Disconnect participant client when speaker disconnects
        const systemClient = systemAudioClientRef.current;
        if (systemClient) {
          try {
            console.info('[Sokuji] [MainPanel] Speaker disconnected, also disconnecting participant client');
            await systemClient.disconnect();
            systemClient.reset();
            systemAudioClientRef.current = null;

            // Stop participant audio recording
            const audioService = audioServiceRef.current;
            if (audioService) {
              if (audioService.isSystemAudioRecordingActive()) {
                await audioService.stopSystemAudioRecording();
              }
              if (audioService.isTabAudioRecordingActive?.()) {
                await audioService.stopTabAudioRecording();
              }
              // Clear participant streaming track
              audioService.clearStreamingTrack('system-audio-assistant');
            }
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
          }
        }

        // Clean up audio recording
        const audioService = audioServiceRef.current;
        if (audioService) {
          try {
            const recorder = audioService.getRecorder();
            if (recorder.isRecording()) {
              await audioService.pauseRecording();
              await audioService.stopRecording();
            }
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error cleaning up recorder on close:', error);
          }

          // Interrupt any playing audio
          await audioService.interruptAudio();
        }
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
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
        if (timeSinceLastUpdate < UPDATE_THROTTLE_MS) {
          // Skip this update if it's too soon after the last one
          // This prevents UI freezing from rapid updates
          return;
        }
        lastUpdateTimeRef.current = now;
        
        // Handle completed audio items
        if (item.status === 'completed' && item.formatted?.audio) {
          const wavFile = await decodeAudioToWav(
            item.formatted.audio as Int16Array,
            24000,
            24000
          );
          if (item.formatted) {
            item.formatted.file = wavFile;
          }
        }
        
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
    isMonitorDeviceOn,
    provider,
    sessionId,
    getCurrentProviderSettings,
    setTranslationCount,
    trackEvent,
    addRealtimeEvent,
    setIsSessionActive
  ]); // addRealtimeEvent from Zustand is stable

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsSessionActive(false);
    setIsAIResponding(false);
    setIsUsingWebRTC(false);
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

      // Stop system audio recording (but keep loopback for next session)
      if (audioService.isSystemAudioRecordingActive()) {
        try {
          await audioService.stopSystemAudioRecording();
          console.info('[Sokuji] [MainPanel] Stopped system audio recording');
        } catch (error) {
          console.warn('[Sokuji] [MainPanel] Error stopping system audio recording:', error);
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

    const client = clientRef.current;
    if (client) {
      await client.disconnect();
      client.reset();
    }

    // Disconnect system audio client
    const systemClient = systemAudioClientRef.current;
    if (systemClient) {
      try {
        await systemClient.disconnect();
        systemClient.reset();
        systemAudioClientRef.current = null;
        console.info('[Sokuji] [MainPanel] Disconnected system audio client');
      } catch (error) {
        console.warn('[Sokuji] [MainPanel] Error disconnecting system audio client:', error);
      }
    }

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
    // This ensures the token balance is updated after usage
    if (refetchAll) {
      refetchAll().catch(error => {
        console.warn('[Sokuji] [MainPanel] Error refreshing user profile:', error);
      });
    }
  }, [refetchAll]);

  /**
   * Connect to conversation:
   * ModernAudioRecorder takes speech input, audio service provides output, client is API client
   */
  const connectConversation = useCallback(async () => {
    try {
      setIsInitializing(true);

      // Initialize the audio service if not already done
      if (!audioServiceRef.current) {
        audioServiceRef.current = ServiceFactory.getAudioService();
        await audioServiceRef.current.initialize();
      }

      // Create a new AI client instance
      const currentProviderSettings = getCurrentProviderSettings();
      
      // Get the appropriate API key/credentials based on the current provider
      let apiKey: string;
      switch (provider) {
        case Provider.OPENAI:
          apiKey = openAISettings.apiKey;
          break;
        case Provider.OPENAI_COMPATIBLE:
          apiKey = openAICompatibleSettings.apiKey;
          break;
        case Provider.KIZUNA_AI:
          // For Kizuna AI, fetch a fresh session token from Better Auth
          if (getToken && isLoaded && isSignedIn === true) {
            console.log('[MainPanel] Fetching fresh auth session for Kizuna AI...');
            try {
              const freshToken = await getToken({ skipCache: true });
              apiKey = freshToken || '';
              console.log('[MainPanel] Successfully got fresh auth session for Kizuna AI');
            } catch (error) {
              console.error('[MainPanel] Failed to get fresh auth session:', error);
              apiKey = kizunaAISettings.apiKey || '';
            }
          } else {
            // Fallback to stored token if getToken is not available or user not signed in
            apiKey = kizunaAISettings.apiKey || '';
          }
          break;
        case Provider.GEMINI:
          apiKey = geminiSettings.apiKey;
          break;
        case Provider.PALABRA_AI:
          // PalabraAI uses clientId as the "apiKey" parameter for ClientFactory
          apiKey = palabraAISettings.clientId;
          break;
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Get model name based on provider
      const modelName = provider === Provider.PALABRA_AI
        ? 'realtime-translation'
        : (currentProviderSettings as any).model;

      // Determine if WebRTC transport should be used
      let useWebRTC = transportType === 'webrtc' && ClientFactory.supportsWebRTC(provider);

      // Create speaker client using helper
      clientRef.current = createAIClient(modelName, apiKey, useWebRTC);

      // Setup listeners for the new client instance
      await setupClientListeners();

      const client = clientRef.current;

      // Set canPushToTalk based on current turnDetectionMode
      if (isOpenAICompatible(provider)) {
        const settings =
          provider === Provider.OPENAI ? openAISettings :
          provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
          provider === Provider.KIZUNA_AI ? kizunaAISettings :
          null;
        setCanPushToTalk(settings ? settings.turnDetectionMode === 'Disabled' : false);
      } else {
        setCanPushToTalk(false); // Not supported by Gemini and PalabraAI
      }

      // Connect to microphone only if input device is turned on
      if (isInputDeviceOn) {
        if (selectedInputDevice) {
          // Note: Don't start recording yet, just prepare the device
          // Recording will be started below based on turn detection mode
          // Passthrough is already configured via the useEffect hook
        } else {
          console.warn('[Sokuji] [MainPanel] No input device selected, cannot connect to microphone');
        }
      } else {
        console.debug('[Sokuji] [MainPanel] Input device is turned off, not connecting to microphone');
      }

      // If output device is ON, ensure monitor device is connected immediately
      if (isMonitorDeviceOn && selectedMonitorDevice &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_virtual') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_system_audio') &&
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokujivirtualaudio')) {
        console.debug('[Sokuji] [MainPanel] Setting up monitor device to:', selectedMonitorDevice.label);

        // Trigger the selectMonitorDevice function to reconnect the monitor
        // This will use the audio service properly through the AudioContext
        selectMonitorDevice(selectedMonitorDevice);
      }

      // Get session configuration
      const sessionConfig = getSessionConfig();

      // Track connection attempt and measure latency
      const connectionStartTime = Date.now();

      try {
        // Connect to the AI service
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
          clientRef.current = createAIClient(modelName, apiKey, false);

          // Re-setup listeners for the new client instance
          await setupClientListeners();

          const fallbackClient = clientRef.current;

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
            addLog({
              type: 'warning',
              message: t('logs.webrtcFallback', 'WebRTC connection failed, using WebSocket instead')
            });

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

      // Start recording if using server VAD and input device is turned on
      // Note: Skip manual recording for WebRTC mode - audio flows via MediaStreamTrack
      let turnDetectionDisabled = false;
      if (isOpenAICompatible(provider)) {
        const settings =
          provider === Provider.OPENAI ? openAISettings :
          provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
          provider === Provider.KIZUNA_AI ? kizunaAISettings :
          null;
        turnDetectionDisabled = settings ? settings.turnDetectionMode === 'Disabled' : false;
      }

      // Check if provider uses native audio capture (OpenAI WebRTC or PalabraAI/LiveKit)
      // In native capture mode, audio is automatically captured via MediaStreamTrack
      // No need to manually record and send audio chunks
      const usesNativeCapture = ClientFactory.usesNativeAudioCapture(provider, useWebRTC ? 'webrtc' : 'websocket');

      // Note: Use clientRef.current instead of client variable to handle WebRTC fallback scenario
      if (!usesNativeCapture && !turnDetectionDisabled && isInputDeviceOn && audioServiceRef.current) {
        let audioCallbackCount = 0;
        await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
          if (clientRef.current) {
            // Debug logging every 100 calls to verify AI client receives data
            if (audioCallbackCount % 100 === 0) {
              console.debug(`[Sokuji] [MainPanel] Sending audio to client: chunk ${audioCallbackCount}, PCM length: ${data.mono.length}`);
            }
            audioCallbackCount++;
            clientRef.current.appendInputAudio(data.mono);
          }
        });
      } else if (usesNativeCapture) {
        console.info('[Sokuji] [MainPanel] Native MediaStreamTrack mode - audio flows automatically');

        // Apply initial mute state based on isMonitorDeviceOn (WebRTC only, not PalabraAI)
        if (useWebRTC && typeof clientRef.current?.setOutputMuted === 'function') {
          clientRef.current.setOutputMuted(!isMonitorDeviceOn);
          console.debug('[Sokuji] [MainPanel] WebRTC initial mute state:', !isMonitorDeviceOn);
        }
      }

      // Track if using WebRTC (after fallback logic is complete)
      // Note: PalabraAI uses appendInputAudio pattern, not native WebRTC audio
      setIsUsingWebRTC(useWebRTC);

      // Start participant audio client (unified for both Electron system audio and Extension tab audio)
      // Both capture "other participant" audio and send to AI for translation
      const shouldCaptureParticipantAudio = isSystemAudioCaptureEnabled && audioServiceRef.current && (
        isExtension() || // Extension: use tab capture
        (selectedSystemAudioSource && systemAudioLoopbackSourceId) // Electron: use system audio loopback
      );

      if (shouldCaptureParticipantAudio) {
        try {
          const captureMode = isExtension() ? 'tab' : 'system';
          console.info(`[Sokuji] [MainPanel] Starting participant audio client (${captureMode} capture)...`);

          // Create participant client using helper
          systemAudioClientRef.current = createAIClient(modelName, apiKey);

          // Setup event handlers using helper
          const participantClient = systemAudioClientRef.current;
          participantClient.setEventHandlers(createParticipantEventHandlers(participantClient));

          // Create and connect with participant session config
          const participantSessionConfig = createParticipantSessionConfig();
          await participantClient.connect(participantSessionConfig);
          console.info(`[Sokuji] [MainPanel] Participant audio client connected (${captureMode}, text-only, swapped languages, semantic VAD)`);

          // Start recording from appropriate source based on environment
          let participantAudioCallbackCount = 0;
          const createAudioDataCallback = (client: IClient) => (data: { mono: Int16Array; raw: Int16Array }) => {
            if (client) {
              if (participantAudioCallbackCount % 100 === 0) {
                console.debug(`[Sokuji] [MainPanel] Sending ${captureMode} audio to client: chunk ${participantAudioCallbackCount}, PCM length: ${data.mono.length}`);
              }
              participantAudioCallbackCount++;
              client.appendInputAudio(data.mono);
            }
          };

          if (isExtension()) {
            // Extension: start tab audio recording with optional output device for passthrough
            const outputDeviceId = participantAudioOutputDevice?.deviceId;
            console.info('[Sokuji] [MainPanel] Starting tab audio recording with output device:', outputDeviceId || 'default');
            await audioServiceRef.current.startTabAudioRecording(
              createAudioDataCallback(participantClient),
              outputDeviceId
            );
          } else {
            // Electron: start system audio recording from virtual mic
            await audioServiceRef.current.startSystemAudioRecording(
              createAudioDataCallback(participantClient)
            );
          }

          console.info(`[Sokuji] [MainPanel] Participant audio recording started (${captureMode})`);
        } catch (error) {
          console.error('[Sokuji] [MainPanel] Failed to start participant audio client:', error);
          // Don't fail the whole session, just log the error
        }
      }

      // Set state variables after successful initialization
      // Note: Use clientRef.current instead of client variable to handle WebRTC fallback scenario
      setIsSessionActive(true);
      setItems(clientRef.current?.getConversationItems() || []);
      setSystemAudioItems([]); // Clear participant conversation from previous session

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
      
      // Track session initialization failure
      trackEvent('error_occurred', {
        error_type: 'session_initialization',
        error_message: error.message || 'Failed to initialize session',
        component: 'MainPanel',
        severity: 'high',
        provider: provider,
        recoverable: true
      });
      
      // Reset state in case of error
      await disconnectConversation();
    } finally {
      setIsInitializing(false);
    }
  }, [
    openAISettings,
    geminiSettings,
    openAICompatibleSettings,
    palabraAISettings,
    kizunaAISettings,
    provider,
    transportType,
    isLoaded,
    isSignedIn,
    getToken,
    getCurrentProviderSettings,
    getSessionConfig,
    setupClientListeners,
    createAIClient,
    selectedInputDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    selectedMonitorDevice,
    selectMonitorDevice,
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume,
    // System audio capture
    isSystemAudioCaptureEnabled,
    selectedSystemAudioSource,
    systemAudioLoopbackSourceId
  ]);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = useCallback(async () => {
    // Don't start recording if input device is turned off
    if (!isInputDeviceOn) {
      console.info('[Sokuji] [MainPanel] Input device is turned off, not starting recording');
      return;
    }

    // If already recording, don't do anything (this is important for push-to-talk)
    if (isRecording) {
      return;
    }

    setIsRecording(true);
    
    // Track push-to-talk start time
    pushToTalkStartTimeRef.current = Date.now();
    
    const client = clientRef.current;
    const audioService = audioServiceRef.current;

    if (!audioService) {
      console.error('[Sokuji] [MainPanel] Audio service not available');
      setIsRecording(false);
      return;
    }

    try {
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
  }, [isInputDeviceOn, isRecording, selectedInputDevice]);

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
        hold_duration_ms: holdDuration
      });
      pushToTalkStartTimeRef.current = null;
    }
    
    const client = clientRef.current;
    const audioService = audioServiceRef.current;

    if (!audioService) {
      return;
    }

    try {
      // Only try to pause if we're actually recording
      const recorder = audioService.getRecorder();
      if (recorder.isRecording()) {
        // Stop recording
        await audioService.pauseRecording();

        // Only create response if we detected enough voice audio (prevents empty requests)
        const MIN_VOICE_CHUNKS = 5; // At least 5 non-silent chunks (~0.5 seconds of speech)
        if (client && pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
          // Model drift prevention is handled by the silent anchor mechanism (useEffect)
          client.createResponse();
        } else if (client) {
          console.debug(`[Sokuji] [MainPanel] PTT: Skipping response - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
        }
      }
    } catch (error) {
      // If there's an error during pause (e.g., already paused), log it but don't crash
      console.error('[Sokuji] [MainPanel] Error stopping recording:', error);
      
      // Reset the recording state to ensure UI is consistent
      setIsRecording(false);
    }
  }, [isRecording]);

  /**
   * Send text input for translation
   */
  const handleSendText = useCallback((text: string) => {
    const client = clientRef.current;
    if (!client || !isSessionActive) {
      console.warn('[MainPanel] Cannot send text: no active session');
      return;
    }

    // If AI is responding (OpenAI), queue the message for later
    if (isAIResponding && (provider === Provider.OPENAI || provider === Provider.OPENAI_COMPATIBLE || provider === Provider.KIZUNA_AI)) {
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
        setPlayingItemId(null);
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

      // If output device is ON, ensure monitor device is connected
      if (isMonitorDeviceOn && selectedMonitorDevice &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_virtual') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_system_audio') &&
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokujivirtualaudio')) {
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
      setPlayingItemId(currentItemId);
      
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
        setPlayingItemId(prevId => prevId === currentItemId ? null : prevId);
      }, actualDurationMs + 50); // Add 50ms buffer
      
      console.info('[Sokuji] [MainPanel] Playing audio from item ' + item.id);
    } catch (error) {
      console.error('[Sokuji] [MainPanel] Error playing audio:', error);
      setPlayingItemId(null);
    }
  }, [isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice, playingItemId]);

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

      // If output device is ON, ensure monitor device is connected immediately
      if (isMonitorDeviceOn && selectedMonitorDevice &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_virtual') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_system_audio') &&
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output') &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokujivirtualaudio')) {
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
  }, [isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice, isTestTonePlaying]);

  // Memoize progress calculation to reduce re-renders
  const progressRatio = useMemo(() => {
    if (!playbackProgress) {
      return 0;
    }
    
    let calculatedRatio = 0;
    
    // For streaming audio, bufferedTime is more accurate than duration
    // Prioritize bufferedTime when available as it represents the total accumulated audio
    const divisor = playbackProgress.bufferedTime || playbackProgress.duration || 1;
    calculatedRatio = Math.min(playbackProgress.currentTime / divisor, 1);
    
    // Intelligent progress protection: prevent short-term backwards movement
    // but allow reset after timeout or when audio ends
    if (calculatedRatio < lastMaxProgressRef.current) {
      const timeSinceUpdate = Date.now() - lastProgressUpdateTime.current;
      const diff = lastMaxProgressRef.current - calculatedRatio;
      
      // Allow reset if:
      // 1. Long time since last update (audio likely ended)
      // 2. Very large difference (likely new audio or major change)
      if (timeSinceUpdate > BACKWARD_TIMEOUT || diff > 0.5) {
        lastMaxProgressRef.current = calculatedRatio;
        lastProgressUpdateTime.current = Date.now();
        return calculatedRatio;
      }
      
      // Short-term protection: prevent backwards movement
      return lastMaxProgressRef.current;
    }
    
    // Update timestamp when progress moves forward
    lastProgressUpdateTime.current = Date.now();
    
    return calculatedRatio;
  }, [playbackProgress?.currentTime, playbackProgress?.duration, playbackProgress?.bufferedTime]);

  /**
   * Reset max progress when playing a new item
   */
  useEffect(() => {
    // Reset the maximum progress when we start playing a new item
    lastMaxProgressRef.current = 0;
    lastProgressUpdateTime.current = Date.now();
  }, [playingItemId]);
  
  /**
   * Update max progress ref after calculation
   */
  useEffect(() => {
    // Update the ref after the render to avoid side effects in useMemo
    if (progressRatio > lastMaxProgressRef.current) {
      lastMaxProgressRef.current = progressRatio;
    }
  }, [progressRatio]);
  
  /**
   * Reset progress when playback state changes from playing to stopped
   */
  useEffect(() => {
    const currentlyPlaying = playbackProgress !== null;
    
    // When playback stops, reset max progress to allow accurate display next time
    if (lastPlayingState.current && !currentlyPlaying) {
      lastMaxProgressRef.current = 0;
      lastProgressUpdateTime.current = 0;
    }
    
    lastPlayingState.current = currentlyPlaying;
  }, [playbackProgress]);

  /**
   * Set up playback status tracking
   */
  useEffect(() => {
    if (!audioServiceRef.current) return;
    
    const player = audioServiceRef.current.getWavStreamPlayer();
    if (!player) return;
    
    // Set up status callback
    player.setPlaybackStatusCallback((status: any) => {
      if (status) {
        if (status.status === 'playing' && status.itemId) {
          setPlayingItemId(status.itemId);
        } else if (status.status === 'ended') {
          // Check if this is really the end or just one chunk ending
          const currentStatus = player.getCurrentPlaybackStatus();
          if (!currentStatus || currentStatus.itemId !== status.itemId) {
            setPlayingItemId(null);
            setPlaybackProgress(null);
          }
        }
      }
    });
    
    // Set up progress tracking
    const progressInterval = setInterval(() => {
      const status = player.getCurrentPlaybackStatus();
      
      if (status && status.isPlaying) {
        setPlaybackProgress({
          currentTime: status.currentTime,
          duration: status.duration,
          bufferedTime: status.bufferedTime
        });
      } else {
        // Clear progress when nothing is playing to prevent stale data
        setPlaybackProgress(null);
      }
    }, PROGRESS_UPDATE_INTERVAL);
    
    return () => {
      clearInterval(progressInterval);
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
            const result = recorder.isRecording()
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
        
        if (serverCanvas && audioService) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            
            try {
              // Always show visualization regardless of Monitor state
              // Get the WavStreamPlayer from the audio service to access its frequencies
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
  }, [uiMode]);

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
  }, [items, systemAudioItems]);

  /**
   * Watch for changes to isInputDeviceOn and update recording state accordingly
   */
  useEffect(() => {
    // Only take action if session is active
    if (!isSessionActive) return;

    const audioService = audioServiceRef.current;
    const client = clientRef.current;

    if (!audioService) {
      return;
    }

    const updateRecordingState = async () => {
      try {
        const recorder = audioService.getRecorder();
        
        // If input device is turned off, pause recording
        if (!isInputDeviceOn) {
          console.info('[Sokuji] [MainPanel] Input device turned off - pausing recording');
          if (recorder.isRecording()) {
            await audioService.pauseRecording();
            setIsRecording(false);
          }
        }
        // If input device is turned on
        else {
          // If we're in automatic mode, start/resume recording
          let turnDetectionDisabled = false;
          if (isOpenAICompatible(provider)) {
            const settings =
              provider === Provider.OPENAI ? openAISettings :
              provider === Provider.OPENAI_COMPATIBLE ? openAICompatibleSettings :
              provider === Provider.KIZUNA_AI ? kizunaAISettings :
              null;
            turnDetectionDisabled = settings ? settings.turnDetectionMode === 'Disabled' : false;
          }
          if (!turnDetectionDisabled) {
            console.info('[Sokuji] [MainPanel] Input device turned on - starting recording in automatic mode');
            if (!recorder.isRecording()) {
              let autoAudioCallbackCount = 0;
              await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
                if (client) {
                  // Debug logging for automatic mode (every 100 chunks)
                  if (autoAudioCallbackCount % 100 === 0) {
                    console.debug(`[Sokuji] [MainPanel] Auto: Sending audio to client: chunk ${autoAudioCallbackCount}, PCM length: ${data.mono.length}`);
                  }
                  autoAudioCallbackCount++;
                  client.appendInputAudio(data.mono);
                }
              });
            }
          }
          // For push-to-talk mode, we don't automatically resume recording
          // The user needs to press the button or Space key
        }
      } catch (error) {
        console.error('[Sokuji] [MainPanel] Error updating recording state:', error);
      }
    };

    updateRecordingState();
  }, [isInputDeviceOn, isSessionActive, provider, openAISettings.turnDetectionMode, openAICompatibleSettings.turnDetectionMode, kizunaAISettings.turnDetectionMode, selectedInputDevice]);

  /**
   * Watch for changes to selectedMonitorDevice or isMonitorDeviceOn 
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
        const isVirtualDevice = selectedMonitorDevice?.label.toLowerCase().includes('sokuji_virtual') ||
          selectedMonitorDevice?.label.toLowerCase().includes('sokuji_system_audio') ||
          selectedMonitorDevice?.label.includes('Sokuji Virtual Output') ||
          selectedMonitorDevice?.label.toLowerCase().includes('sokujivirtualaudio');

        if (isVirtualDevice) {
          console.info('[Sokuji] [MainPanel] Selected monitor device is a virtual device - not using as monitor');
          return;
        }

        // If monitor device is turned on, connect the monitor
        if (isMonitorDeviceOn && selectedMonitorDevice) {
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
  }, [selectedMonitorDevice, isMonitorDeviceOn, isSessionActive, selectMonitorDevice]);

  /**
   * Set up push-to-talk keyboard shortcut
   */
  useEffect(() => {
    // Only enable push-to-talk when session is active and turnDetectionMode is 'Disabled'
    const isPushToTalkEnabled = isSessionActive && canPushToTalk;

    // Handle key down (start recording)
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is on an input element (e.g., text input field)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      if (!isPushToTalkEnabled || e.repeat || e.code !== 'Space') return;
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

      if (!isPushToTalkEnabled || e.code !== 'Space') return;
      e.preventDefault(); // Prevent page scrolling
      stopRecording();
    };
    
    // Handle window blur event to stop recording if the window loses focus
    // while recording is active
    const handleBlur = () => {
      if (isPushToTalkEnabled && isRecording) {
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
  }, [isSessionActive, canPushToTalk, startRecording, stopRecording, isRecording]);

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
        trackEvent('translation_session_start', {
          source_language: currentSettings.sourceLanguage,
          target_language: currentSettings.targetLanguage,
          session_id: newSessionId,
          provider: provider,
          model: (currentSettings as any).model
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
  }, [isSessionActive, sessionId, sessionStartTime, translationCount, getCurrentProviderSettings, setSessionId, setSessionStartTime, setTranslationCount, trackEvent]);

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
      clientRef.current,
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
    // Only activate when participant session exists (systemAudioClientRef is set)
    const participantClient = systemAudioClientRef.current;
    const isParticipantActive = isSessionActive && participantClient !== null;

    sendAnchorIfNeeded(
      participantClient,
      systemAudioItems,
      isParticipantActive,
      'participant',
      () => getProcessedSystemInstructions(true), // Swapped languages for participant
      participantAnchorCountRef,
      5
    );
  }, [systemAudioItems, isSessionActive, sendAnchorIfNeeded, getProcessedSystemInstructions]);

  /**
   * Handle input device changes during active session
   */
  useEffect(() => {
    // Only handle device changes if session is active and recording
    if (!isSessionActive || !isInputDeviceOn) {
      // Reset initialized flag when session ends
      if (!isSessionActive) {
        isInitializedRef.current = false;
      }
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
  }, [selectedInputDevice?.deviceId, isSessionActive, isInputDeviceOn]);

  /**
   * Handle monitor device on/off state for WebRTC clients
   */
  useEffect(() => {
    const client = clientRef.current;
    if (!isSessionActive || !isUsingWebRTC || !client) return;

    // Check if client supports muting
    if (typeof client.setOutputMuted === 'function') {
      client.setOutputMuted(!isMonitorDeviceOn);
      console.debug('[Sokuji] [MainPanel] WebRTC output muted:', !isMonitorDeviceOn);
    }
  }, [isMonitorDeviceOn, isSessionActive, isUsingWebRTC]);

  /**
   * Handle input device switching for WebRTC clients
   */
  useEffect(() => {
    const client = clientRef.current;
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
    const client = clientRef.current;
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

  // If in basic mode, render the simplified interface
  if (uiMode === 'basic') {
    return (
      <div className="main-panel-wrapper">
        <SimpleMainPanel
          items={combinedItems}
          isSessionActive={isSessionActive}
          isInitializing={isInitializing}
          onStartSession={connectConversation}
          onEndSession={disconnectConversation}
          canPushToTalk={canPushToTalk}
          isRecording={isRecording}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          playingItemId={playingItemId}
          playbackProgress={playbackProgress}
          supportsTextInput={supportsTextInput}
          onSendText={handleSendText}
        />
      </div>
    );
  }

  // Render the advanced interface
  return (
    <div className="main-panel-wrapper">
      <div className="main-panel">
      <div className="conversation-container" ref={conversationContainerRef}>
        <div className="conversation-content" data-conversation-content>
          {combinedItems.length > 0 ? (
            combinedItems.map((item) => (
              <div key={item.id} className={`conversation-item ${item.role} ${item.source === 'participant' ? 'participant-source' : 'speaker-source'} ${item.type === 'error' ? 'error' : ''} ${playingItemId === item.id ? 'playing' : ''}`} style={{ position: 'relative' }}>
                <div className="conversation-item-role">
                  {item.type === 'error' ? (
                    <>
                      <AlertCircle size={12} />
                      {t('mainPanel.error', 'Error')}
                    </>
                  ) : item.source === 'participant' && item.role === 'user' ? (
                    t('simplePanel.participant', 'Participant')
                  ) : (
                    item.role
                  )}
                  {/* TODO: OpenAI Realtime API sometimes returns status="incomplete" even when audio is complete
                      This happens when response.output_item.done event has item.status="incomplete"
                      We should investigate why this occurs and handle it properly in the future
                      For now, we allow both 'completed' and 'incomplete' status to show play button if audio exists */}
                  {isDevelopment() && ((item as any).status === 'completed' || (item as any).status === 'incomplete') && item.formatted?.audio && (
                    <button 
                      className={`inline-play-button ${playingItemId === item.id ? 'playing' : ''}`}
                      onClick={() => handlePlayAudio(item)}
                      disabled={playingItemId !== null}
                    >
                      <Play size={10} />
                    </button>
                  )}
                </div>
                <div className="conversation-item-content">
                  {(() => {
                    // Handle error messages - use formatted.text which contains "[errorType] errorMessage"
                    if (item.type === 'error') {
                      return (
                        <div className="content-item error-message">
                          <div className="error-content">{item.formatted?.text || t('mainPanel.unknownError', 'Unknown error')}</div>
                        </div>
                      );
                    }

                    // Handle different item types based on the ItemType structure
                    // from openai-realtime-api

                    // For items with formatted property containing transcript (priority)
                    if (item.formatted && item.formatted.transcript) {
                      const isPlaying = playingItemId === item.id;
                      const transcript = item.formatted.transcript;

                      // Calculate highlighted characters based on playback progress
                      const highlightedChars = isPlaying ? Math.floor(transcript.length * progressRatio) : 0;

                      return (
                        <div className="content-item transcript">
                          <div className={`transcript-content ${isPlaying ? 'karaoke-active' : ''}`}>
                            {isPlaying ? (
                              <>
                                <span className="karaoke-played">
                                  {transcript.slice(0, highlightedChars)}
                                </span>
                                <span className="karaoke-unplayed">
                                  {transcript.slice(highlightedChars)}
                                </span>
                              </>
                            ) : (
                              transcript
                            )}
                          </div>
                        </div>
                      );
                    }

                    // For items with formatted property containing text (fallback)
                    if (item.formatted && item.formatted.text) {
                      const isPlaying = playingItemId === item.id;
                      const text = item.formatted.text;

                      // Calculate highlighted characters based on playback progress
                      const highlightedChars = isPlaying ? Math.floor(text.length * progressRatio) : 0;

                      return (
                        <div className="content-item text">
                          <div className={`text-content ${isPlaying ? 'karaoke-active' : ''}`}>
                            {isPlaying ? (
                              <>
                                <span className="karaoke-played">
                                  {text.slice(0, highlightedChars)}
                                </span>
                                <span className="karaoke-unplayed">
                                  {text.slice(highlightedChars)}
                                </span>
                              </>
                            ) : (
                              text
                            )}
                          </div>
                        </div>
                      );
                    }

                    // For items with formatted property containing audio
                    if (item.formatted && item.formatted.audio) {
                      return (
                        <div className="content-item audio">
                          <div className="audio-indicator">
                            <span className="audio-icon"><Volume2 size={16} /></span>
                            <span className="audio-text">{t('mainPanel.audioContent')}</span>
                          </div>
                        </div>
                      );
                    }

                    // For user or assistant messages with content array
                    if ((item.role === 'user' || item.role === 'assistant' || item.role === 'system') &&
                      'content' in item) {
                      const typedItem = item; // Type assertion for accessing content
                      if (Array.isArray(typedItem.content)) {
                        return typedItem.content.map((contentItem, i) => (
                          <div key={i} className={`content-item ${contentItem.type}`}>
                            {contentItem.type === 'text' && contentItem.text}
                            {contentItem.type === 'input_text' && contentItem.text}
                            {contentItem.type === 'audio' && (() => {
                              const audioText = t('mainPanel.audioContent');
                              const highlightedChars = isPlaying ? Math.floor(audioText.length * progressRatio) : 0;
                              
                              return (
                                <div className="audio-indicator">
                                  <span className="audio-icon"><Volume2 size={16} /></span>
                                  <span className="audio-text">
                                    {isPlaying ? (
                                      <>
                                        <span className="karaoke-played">
                                          {audioText.slice(0, highlightedChars)}
                                        </span>
                                        <span className="karaoke-unplayed">
                                          {audioText.slice(highlightedChars)}
                                        </span>
                                      </>
                                    ) : (
                                      audioText
                                    )}
                                  </span>
                                  {/* Play button moved to role label */}
                                </div>
                              );
                            })()}
                            {contentItem.type === 'input_audio' && contentItem.transcript && (
                              <span className="transcript">{contentItem.transcript}</span>
                            )}
                          </div>
                        ));
                      }
                    }

                    // For tool calls
                    if (item.formatted && item.formatted.tool) {
                      const toolArgs = item.formatted.tool.arguments;
                      let formattedArgs = toolArgs;

                      // Try to parse and format JSON arguments
                      try {
                        const parsedArgs = JSON.parse(toolArgs);
                        formattedArgs = JSON.stringify(parsedArgs, null, 2);
                      } catch (e) {
                        // Keep original format if parsing fails
                      }

                      return (
                        <div className="content-item tool-call">
                          <div className="tool-name">{t('mainPanel.function')}: {item.formatted.tool.name}</div>
                          <div className="tool-args">
                            <pre>{formattedArgs}</pre>
                          </div>
                        </div>
                      );
                    }

                    // For tool outputs
                    if (item.formatted && item.formatted.output) {
                      let formattedOutput = item.formatted.output;

                      // Try to parse and format JSON output
                      try {
                        const parsedOutput = JSON.parse(item.formatted.output);
                        formattedOutput = JSON.stringify(parsedOutput, null, 2);
                      } catch (e) {
                        // Keep original format if parsing fails
                      }

                      return (
                        <div className="content-item tool-output">
                          <div className="output-content">
                            <pre>{formattedOutput}</pre>
                          </div>
                        </div>
                      );
                    }

                    // Fallback for other content types
                    return (
                      <div className="content-item">
                        <pre>{JSON.stringify(item, null, 2)}</pre>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))
          ) : (
            <div className="conversation-placeholder">
              <div className="placeholder-content">
                <div className="icon-container">
                  <Users size={24} />
                </div>
                <span>{t('mainPanel.conversationPlaceholder')}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Text Input Section - Advanced Mode */}
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

      <div className="audio-visualization">
        <div className="visualization-container">
          <div className="visualization-label">{t('mainPanel.input')}</div>
          <canvas ref={clientCanvasRef} className="visualization-canvas client-canvas" />
        </div>

        <div className="controls-container">
          {isSessionActive && canPushToTalk && (
            <button
              className={`push-to-talk-button ${isRecording ? 'recording' : ''} ${!isInputDeviceOn ? 'disabled' : ''}`}
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              disabled={!isSessionActive || !canPushToTalk || !isInputDeviceOn}
            >
              <>
                <Mic size={14} />
                <span>
                  {isRecording ? t('mainPanel.release') : isInputDeviceOn ? t('mainPanel.pushToTalk') : t('mainPanel.inputDeviceOff')}
                </span>
              </>
            </button>
          )}
          <button
            className={`session-button ${isSessionActive ? 'active' : ''}`}
            onClick={() => {
              const action = isSessionActive ? 'stop' : 'start';
              trackEvent('session_control_clicked', {
                action: action,
                method: 'button'
              });
              
              if (isSessionActive) {
                disconnectConversation();
              } else {
                connectConversation();
              }
            }}
            disabled={(!isSessionActive && (!isApiKeyValid || availableModels.length === 0 || loadingModels || (provider === Provider.KIZUNA_AI && quota && (quota.balance === undefined || quota.balance < 0 || quota.frozen)))) || isInitializing}
          >
            {isInitializing ? (
              <>
                <Loader size={14} className="spinner" />
                <span>{t('mainPanel.initializing')}</span>
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
                {!isApiKeyValid && (
                  <span className="tooltip">{t('mainPanel.apiKeyRequired')}</span>
                )}
                {isApiKeyValid && availableModels.length === 0 && !loadingModels && (
                  <span className="tooltip">{t('mainPanel.modelsRequired')}</span>
                )}
                {isApiKeyValid && loadingModels && (
                  <span className="tooltip">{t('mainPanel.modelsLoading')}</span>
                )}
                {isApiKeyValid && provider === Provider.KIZUNA_AI && quota && quota.frozen && (
                  <span className="tooltip">{t('mainPanel.walletFrozen', 'Wallet is frozen. Please contact support.')}</span>
                )}
                {isApiKeyValid && provider === Provider.KIZUNA_AI && quota && quota.balance !== undefined && quota.balance < 0 && (
                  <span className="tooltip">{t('mainPanel.insufficientBalance', 'Insufficient token balance: {{balance}} tokens', { balance: quota.balance })}</span>
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

        <div className="visualization-container">
          <div className="visualization-label">{t('mainPanel.output')}</div>
          <canvas ref={serverCanvasRef} className="visualization-canvas server-canvas" />
        </div>
      </div>
      <AudioFeedbackWarning
        isVisible={showFeedbackWarning}
        inputDeviceLabel={selectedInputDevice?.label}
        outputDeviceLabel={selectedMonitorDevice?.label}
        recommendedAction={
          getSafeAudioConfiguration(
            selectedInputDevice,
            selectedMonitorDevice,
            isRealVoicePassthroughEnabled
          ).recommendedAction
        }
        feedbackRisk={
          getSafeAudioConfiguration(
            selectedInputDevice,
            selectedMonitorDevice,
            isRealVoicePassthroughEnabled
          ).feedbackRisk
        }
        onDismiss={() => {
          setShowFeedbackWarning(false);
          setFeedbackWarningDismissed(true);
        }}
      />
      </div>
    </div>
  );
};

export default MainPanel;

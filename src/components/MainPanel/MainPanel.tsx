import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {X, Zap, Users, Mic, Loader, Play, Volume2, Wrench} from 'lucide-react';
import './MainPanel.scss';
import {
  useProvider,
  useUIMode,
  useOpenAISettings,
  useGeminiSettings,
  useCometAPISettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useIsApiKeyValid,
  useAvailableModels,
  useLoadingModels,
  useGetCurrentProviderSettings,
  useGetProcessedSystemInstructions,
  useCreateSessionConfig
} from '../../stores/settingsStore';
import { useSession } from '../../stores/sessionStore';
import { useAudioContext } from '../../stores/audioStore';
import { useLogActions } from '../../stores/logStore';
import type { RealtimeEvent } from '../../stores/logStore';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ClientFactory } from '../../services/clients';
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
import { useAuth } from '../../lib/clerk/ClerkProvider';
import { useUserProfile } from '../../contexts/UserProfileContext';

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
  const cometAPISettings = useCometAPISettings();
  const geminiSettings = useGeminiSettings();
  const palabraAISettings = usePalabraAISettings();
  const kizunaAISettings = useKizunaAISettings();
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
    selectMonitorDevice // Import the selectMonitorDevice function from context
  } = useAudioContext();

  // canPushToTalk is true only when turnDetectionMode is 'Disabled'
  const [canPushToTalk, setCanPushToTalk] = useState(false);

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
  
  // Reference to audio service for accessing ModernAudioPlayer
  const audioServiceRef = useRef<IAudioService | null>(null);
  
  // Reference to track push-to-talk duration
  const pushToTalkStartTimeRef = useRef<number | null>(null);
  
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
  const DEBUG_KARAOKE = isDevelopment() && false; // Set to true to enable debug logs
  const PROGRESS_UPDATE_INTERVAL = 100; // ms
  const BACKWARD_TIMEOUT = 2000; // 2秒内防止后退，超时后允许重置

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
          realtimeEvent.event?.type || 'unknown'
        );
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
        
        // Clean up audio recording
        const audioService = audioServiceRef.current;
        if (audioService) {
          try {
            const recorder = audioService.getRecorder();
            if (recorder.recording) {
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
        // Handle audio delta separately - send to player but skip UI update
        if (delta?.audio) {
          // Always stream assistant audio - monitor on/off is handled by global volume
          // User audio should NOT be played back to avoid echo
          const shouldPlayAudio = item.role === 'assistant';
          
          // Use a consistent trackId for all AI assistant audio to ensure proper queuing
          // Pass item.id as metadata so we can track which message is playing
          audioService.addAudioData(delta.audio, 'ai-assistant', shouldPlayAudio, { itemId: item.id });
          
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
      } catch (error) {
        console.warn('[Sokuji] [MainPanel] Error pausing recorder during disconnect:', error);
      }
    }

    // Small delay to ensure any in-flight audio processing completes
    await new Promise(resolve => setTimeout(resolve, 100));

    const client = clientRef.current;
    if (client) {
      await client.disconnect();
      client.reset();
    }

    // Now fully end the recorder after client is reset
    if (audioService) {
      try {
        await audioService.stopRecording();
      } catch (error) {
        console.warn('[Sokuji] [MainPanel] Error ending recorder:', error);
      }

      // Interrupt any playing audio
      await audioService.interruptAudio();
      // Clear the unified AI assistant streaming track
      audioService.clearStreamingTrack('ai-assistant');
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
        case Provider.COMET_API:
          apiKey = cometAPISettings.apiKey;
          break;
        case Provider.KIZUNA_AI:
          // For Kizuna AI, fetch a fresh token from Clerk to avoid 401 errors
          if (getToken && isLoaded && isSignedIn === true) {
            console.log('[MainPanel] Fetching fresh Clerk token for Kizuna AI...');
            try {
              const freshToken = await getToken({ skipCache: true });
              apiKey = freshToken || '';
              console.log('[MainPanel] Successfully got fresh Clerk token for Kizuna AI');
            } catch (error) {
              console.error('[MainPanel] Failed to get fresh Clerk token:', error);
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
      
      // Create client with appropriate parameters
      if (provider === Provider.PALABRA_AI) {
        clientRef.current = ClientFactory.createClient(
          modelName,
          provider,
          apiKey, // clientId
          palabraAISettings.clientSecret // clientSecret
        );
      } else {
        clientRef.current = ClientFactory.createClient(
          modelName,
          provider,
          apiKey
        );
      }

      // Setup listeners for the new client instance
      await setupClientListeners();

      const client = clientRef.current;

      // Set canPushToTalk based on current turnDetectionMode
      if (isOpenAICompatible(provider)) {
        const settings = 
          provider === Provider.OPENAI ? openAISettings :
          provider === Provider.COMET_API ? cometAPISettings :
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
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output')) {
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
          operation: 'websocket',
          latency_ms: connectionLatency,
          provider: provider
        });
        
        trackEvent('connection_status', {
          status: 'connected',
          provider: provider || Provider.OPENAI,
          duration_ms: connectionLatency
        });
      } catch (connectError: any) {
        // Track connection failure
        trackEvent('api_error', {
          provider: provider || Provider.OPENAI,
          error_message: connectError.message || 'Connection failed',
          error_type: 'network'
        });
        throw connectError;
      }

      // Start recording if using server VAD and input device is turned on
      let turnDetectionDisabled = false;
      if (isOpenAICompatible(provider)) {
        const settings = 
          provider === Provider.OPENAI ? openAISettings :
          provider === Provider.COMET_API ? cometAPISettings :
          provider === Provider.KIZUNA_AI ? kizunaAISettings :
          null;
        turnDetectionDisabled = settings ? settings.turnDetectionMode === 'Disabled' : false;
      }
      
      if (!turnDetectionDisabled && isInputDeviceOn && audioServiceRef.current) {
        let audioCallbackCount = 0;
        await audioServiceRef.current.startRecording(selectedInputDevice?.deviceId, (data) => {
          if (client) {
            // Debug logging every 100 calls to verify AI client receives data
            if (audioCallbackCount % 100 === 0) {
              console.debug(`[Sokuji] [MainPanel] Sending audio to client: chunk ${audioCallbackCount}, PCM length: ${data.mono.length}`);
            }
            audioCallbackCount++;
            client.appendInputAudio(data.mono);
          }
        });
      }

      // Set state variables after successful initialization
      setIsSessionActive(true);
      setItems(client.getConversationItems());
      
      // Start tracking audio quality metrics during session
      audioQualityIntervalRef.current = setInterval(() => {
        if (audioServiceRef.current) {
          const recorder = audioServiceRef.current.getRecorder();
          if (recorder && recorder.recording) {
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
    cometAPISettings, 
    palabraAISettings,
    kizunaAISettings,
    provider,
    isLoaded,
    isSignedIn,
    getToken,
    getCurrentProviderSettings, 
    getSessionConfig, 
    setupClientListeners, 
    selectedInputDevice, 
    isInputDeviceOn, 
    isMonitorDeviceOn, 
    selectedMonitorDevice, 
    selectMonitorDevice,
    isRealVoicePassthroughEnabled,
    realVoicePassthroughVolume
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
      if (recorder.recording) {
        // If somehow we're already recording, pause first
        console.warn('[Sokuji] [MainPanel] ModernAudioRecorder was already recording, pausing first');
        await audioService.pauseRecording();
      }

      // Start recording
      let pttAudioCallbackCount = 0;
      await audioService.startRecording(selectedInputDevice?.deviceId, (data) => {
        if (client) {
          // Debug logging for push-to-talk (every 50 chunks)
          if (pttAudioCallbackCount % 50 === 0) {
            console.debug(`[Sokuji] [MainPanel] PTT: Sending audio to client: chunk ${pttAudioCallbackCount}, PCM length: ${data.mono.length}`);
          }
          pttAudioCallbackCount++;
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
      if (recorder.recording) {
        // Stop recording
        await audioService.pauseRecording();

        // Create response
        if (client) {
          client.createResponse();
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
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output')) {
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
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output')) {
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
        if (DEBUG_KARAOKE) {
          console.log('[Karaoke Debug] Allowing progress reset:', {
            timeSinceUpdate,
            diff: diff.toFixed(3),
            reason: timeSinceUpdate > BACKWARD_TIMEOUT ? 'timeout' : 'large_diff'
          });
        }
        
        lastMaxProgressRef.current = calculatedRatio;
        lastProgressUpdateTime.current = Date.now();
        return calculatedRatio;
      }
      
      // Short-term protection: prevent backwards movement
      if (DEBUG_KARAOKE) {
        console.log('[Karaoke Debug] Progress prevented from going backwards:', {
          attempted: calculatedRatio.toFixed(3),
          using: lastMaxProgressRef.current.toFixed(3),
          timeSinceUpdate
        });
      }
      
      return lastMaxProgressRef.current;
    }
    
    // Update timestamp when progress moves forward
    lastProgressUpdateTime.current = Date.now();
    
    // Debug logging only when enabled
    if (DEBUG_KARAOKE) {
      console.log('[Karaoke Debug] Progress calculation:', {
        currentTime: playbackProgress.currentTime.toFixed(3),
        duration: playbackProgress.duration.toFixed(3),
        bufferedTime: playbackProgress.bufferedTime.toFixed(3),
        calculatedRatio: calculatedRatio.toFixed(3),
        maxProgress: lastMaxProgressRef.current.toFixed(3),
        timestamp: Date.now()
      });
    }
    
    return calculatedRatio;
  }, [playbackProgress?.currentTime, playbackProgress?.duration, playbackProgress?.bufferedTime]);

  /**
   * Reset max progress when playing a new item
   */
  useEffect(() => {
    // Reset the maximum progress when we start playing a new item
    lastMaxProgressRef.current = 0;
    lastProgressUpdateTime.current = Date.now();
    
    if (DEBUG_KARAOKE) {
      console.log('[Karaoke Debug] Reset max progress for new item:', playingItemId);
    }
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
      
      if (DEBUG_KARAOKE) {
        console.log('[Karaoke Debug] Reset max progress due to playback stop');
      }
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
      
      // Debug logging only when enabled
      if (DEBUG_KARAOKE && status) {
        console.log('[Karaoke Debug] Status update:', {
          itemId: status.itemId,
          currentTime: status.currentTime.toFixed(3),
          duration: status.duration.toFixed(3),
          bufferedTime: status.bufferedTime.toFixed(3),
          isPlaying: status.isPlaying,
          timestamp: Date.now()
        });
      }
      
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
            const result = recorder.recording
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
  }, [items]);

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
          if (recorder.recording) {
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
              provider === Provider.COMET_API ? cometAPISettings :
              provider === Provider.KIZUNA_AI ? kizunaAISettings :
              null;
            turnDetectionDisabled = settings ? settings.turnDetectionMode === 'Disabled' : false;
          }
          if (!turnDetectionDisabled) {
            console.info('[Sokuji] [MainPanel] Input device turned on - starting recording in automatic mode');
            if (!recorder.recording) {
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
  }, [isInputDeviceOn, isSessionActive, provider, openAISettings.turnDetectionMode, cometAPISettings.turnDetectionMode, selectedInputDevice]);

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
          selectedMonitorDevice?.label.includes('Sokuji Virtual Output');

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
      if (!isPushToTalkEnabled || e.repeat || e.code !== 'Space') return;
      e.preventDefault(); // Prevent page scrolling
      startRecording();
    };

    // Handle key up (stop recording)
    const handleKeyUp = (e: KeyboardEvent) => {
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

  // If in basic mode, render the simplified interface
  if (uiMode === 'basic') {
    return (
      <div className="main-panel-wrapper">
        <SimpleMainPanel
          items={items}
          isSessionActive={isSessionActive}
          isInitializing={isInitializing}
          onStartSession={connectConversation}
          onEndSession={disconnectConversation}
          canPushToTalk={canPushToTalk}
          isRecording={isRecording}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
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
          {items.length > 0 ? (
            items.map((item) => (
              <div key={item.id} className={`conversation-item ${item.role} ${playingItemId === item.id ? 'playing' : ''}`} style={{ position: 'relative' }}>
                <div className="conversation-item-role">
                  {item.role}
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
                    // Handle different item types based on the ItemType structure
                    // from openai-realtime-api

                    // For items with formatted property containing text
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

                    // For items with formatted property containing transcript
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

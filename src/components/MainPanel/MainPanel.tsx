import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Zap, Users, Mic, Tool, Loader } from 'react-feather';
import './MainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useLog } from '../../contexts/LogContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder } from '../../lib/wavtools/index.js';
import { WavRenderer } from '../../utils/wav_renderer';
import { ServiceFactory } from '../../services/ServiceFactory'; // Import the ServiceFactory
import { IAudioService } from '../../services/interfaces/IAudioService';

interface MainPanelProps {}

const MainPanel: React.FC<MainPanelProps> = () => {
  // State for session management
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [items, setItems] = useState<ItemType[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);

  // Get settings from context
  const { settings, isApiKeyValid } = useSettings();

  // Get log functions from context
  const { addRealtimeEvent } = useLog();

  // Get audio context from context
  const {
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    selectMonitorDevice // Import the selectMonitorDevice function from context
  } = useAudioContext();

  // canPushToTalk is true only when turnDetectionMode is 'Disabled'
  const [canPushToTalk, setCanPushToTalk] = useState(false);

  // Reference for conversation container to enable auto-scrolling
  const conversationContainerRef = useRef<HTMLDivElement>(null);

  // Add a state variable to track if test tone is playing
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);

  /**
   * Convert settings to updateSession parameters
   */
  const getUpdateSessionParams = useCallback((settings: any) => {
    const updateSessionParams: any = {
      model: settings.model || 'gpt-4o-mini-realtime-preview',
      voice: settings.voice || 'alloy',
      instructions: settings.systemInstructions || '',
      temperature: settings.temperature ?? 0.8,
      max_response_output_tokens: settings.maxTokens ?? 'inf',
    };

    // Configure turn detection
    if (settings.turnDetectionMode === 'Disabled') {
      // No turn detection
    } else if (settings.turnDetectionMode === 'Normal') {
      updateSessionParams.turn_detection = {
        create_response: true,
        type: 'server_vad',
        interrupt_response: false,
        prefix_padding_ms: settings.prefixPadding !== undefined ? Math.round(settings.prefixPadding * 1000) : undefined,
        silence_duration_ms: settings.silenceDuration !== undefined ? Math.round(settings.silenceDuration * 1000) : undefined,
        threshold: settings.threshold
      };
      // Remove undefined fields
      Object.keys(updateSessionParams.turn_detection).forEach(key =>
        updateSessionParams.turn_detection[key] === undefined && delete updateSessionParams.turn_detection[key]
      );
    } else if (settings.turnDetectionMode === 'Semantic') {
      updateSessionParams.turn_detection = {
        create_response: true,
        type: 'semantic_vad',
        interrupt_response: false,
        eagerness: settings.semanticEagerness?.toLowerCase(),
      };
      // Remove undefined fields
      Object.keys(updateSessionParams.turn_detection).forEach(key =>
        updateSessionParams.turn_detection[key] === undefined && delete updateSessionParams.turn_detection[key]
      );
    }

    // Configure noise reduction
    if (settings.noiseReduction && settings.noiseReduction !== 'None') {
      updateSessionParams.input_audio_noise_reduction = {
        type: settings.noiseReduction === 'Near field' ? 'near_field' :
              settings.noiseReduction === 'Far field' ? 'far_field' : undefined
      };
      if (!updateSessionParams.input_audio_noise_reduction.type) {
        delete updateSessionParams.input_audio_noise_reduction;
      }
    }

    // Configure transcription
    if (settings.transcriptModel) {
      updateSessionParams.input_audio_transcription = {
        model: settings.transcriptModel
      };
    }

    return updateSessionParams;
  }, []);

  /**
   * Setup virtual audio output device
   * This function uses the audio service to configure the appropriate virtual output device
   * without environment-specific implementation details
   */
  const setupVirtualAudioOutput = useCallback(async (): Promise<boolean> => {
    try {
      // Get the audio service from the ServiceFactory
      const audioService = ServiceFactory.getAudioService();

      // Use the audio service to set up the virtual audio output
      const result = await audioService.setupVirtualAudioOutput();

      return result;
    } catch (e) {
      console.error('Failed to set up virtual audio output:', e);
      return false;
    }
  }, []);

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
        
        // Set up the virtual audio output
        await setupVirtualAudioOutput();
      } catch (error) {
        console.error('Failed to initialize audio service:', error);
      }
    };
    
    initAudioService();
    
    // Clean up function
    return () => {
      // Any cleanup needed for the audio service
    };
  }, [setupVirtualAudioOutput]);

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - RealtimeClient (API client)
   * - Audio service reference
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );

  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({
      apiKey: settings.openAIApiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );
  
  // Reference to audio service for accessing WavStreamPlayer
  const audioServiceRef = useRef<IAudioService | null>(null);

  /**
   * References for rendering audio visualization (canvas)
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Set up event listeners for the RealtimeClient
   */
  const setupClientListeners = useCallback(async () => {
    const client = clientRef.current;
    const audioService = audioServiceRef.current;

    if (!client || !audioService) return;

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: { [key: string]: any }) => {
      // console.log(realtimeEvent);
      addRealtimeEvent(realtimeEvent, realtimeEvent.source, realtimeEvent.event.type);
    });
    client.on('error', (event: any) => console.error(event));
    // client.on('conversation.interrupted', () => {
    //   const trackSampleOffset = audioService.interruptAudio();
    //   if (trackSampleOffset?.trackId) {
    //     const { trackId, offset } = trackSampleOffset;
    //     client.cancelResponse(trackId, offset);
    //   }
    // });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        audioService.addAudioData(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());
  }, [addRealtimeEvent]);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsSessionActive(false);
    // setItems([]);

    const wavRecorder = wavRecorderRef.current;
    // First pause the recorder to stop sending audio chunks
    if (wavRecorder.recording) {
      try {
        await wavRecorder.pause();
      } catch (error) {
        console.warn('Error pausing recorder during disconnect:', error);
      }
    }

    // Small delay to ensure any in-flight audio processing completes
    await new Promise(resolve => setTimeout(resolve, 100));

    const client = clientRef.current;
    client.reset();

    // Now fully end the recorder after client is reset
    try {
      await wavRecorder.end();
    } catch (error) {
      console.warn('Error ending recorder:', error);
    }

    // Interrupt any playing audio using the audio service
    const audioService = audioServiceRef.current;
    if (audioService) {
      await audioService.interruptAudio();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, audio service provides output, client is API client
   */
  const connectConversation = useCallback(async () => {
    try {
      setIsInitializing(true);

      // Initialize the audio service if not already done
      if (!audioServiceRef.current) {
        audioServiceRef.current = ServiceFactory.getAudioService();
        await audioServiceRef.current.initialize();
      }

      // clear current clientRef before create new client
      clientRef.current.reset();
      // Create a new RealtimeClient instance with the API key right before connecting
      clientRef.current = new RealtimeClient({
        apiKey: settings.openAIApiKey,
        dangerouslyAllowAPIKeyInBrowser: true,
      });

      // Setup listeners for the new client instance
      await setupClientListeners();

      const client = clientRef.current;
      const wavRecorder = wavRecorderRef.current;

      // Set canPushToTalk based on current turnDetectionMode
      setCanPushToTalk(settings.turnDetectionMode === 'Disabled');

      // Connect to microphone only if input device is turned on
      if (isInputDeviceOn) {
        if (selectedInputDevice) {
          await wavRecorder.begin(selectedInputDevice.deviceId);
        } else {
          console.log('No input device selected, cannot connect to microphone');
        }
      } else {
        console.log('Input device is turned off, not connecting to microphone');
      }

      // // Connect to audio output using the audio service
      // if (audioService) {
      //   await audioService.connectWavStreamPlayer();
      // }

      // If output device is ON, ensure monitor device is connected immediately
      if (isMonitorDeviceOn && selectedMonitorDevice &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_virtual') &&
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output')) {
        console.log('Setting up monitor device to:', selectedMonitorDevice.label);

        // Trigger the selectMonitorDevice function to reconnect the monitor
        // This will use the audio service properly through the AudioContext
        selectMonitorDevice(selectedMonitorDevice);
      }

      // Update session with all parameters from settings
      const updateSessionParams = getUpdateSessionParams(settings);

      // First set the model and other parameters
      client.updateSession({
        ...updateSessionParams
      });

      // Then connect to realtime API
      if (client.isConnected()) {
        throw new Error(`Already connected, use .disconnect() first`);
      }
      await client.realtime.connect({ model: settings.model });
      client.updateSession();

      // Start recording if using server VAD and input device is turned on
      if (settings.turnDetectionMode !== 'Disabled' && isInputDeviceOn) {
        await wavRecorder.record((data) => client.appendInputAudio(data.mono));
      }

      // Set state variables after successful initialization
      setIsSessionActive(true);
      setItems(client.conversation.getItems() as ItemType[]);
    } catch (error) {
      console.error('Failed to initialize session:', error);
      // Reset state in case of error
      await disconnectConversation();
    } finally {
      setIsInitializing(false);
    }
  }, [settings, getUpdateSessionParams, setupClientListeners, selectedInputDevice, isInputDeviceOn, disconnectConversation, isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice]);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = useCallback(async () => {
    // Don't start recording if input device is turned off
    if (!isInputDeviceOn) {
      console.log('Input device is turned off, not starting recording');
      return;
    }

    // If already recording, don't do anything (this is important for push-to-talk)
    if (isRecording) {
      return;
    }

    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    try {
      // Note: We no longer interrupt playing audio when recording starts
      // This allows for simultaneous recording and playback

      // Check if the recorder is in a valid state
      if (wavRecorder.recording) {
        // If somehow we're already recording, pause first
        console.warn('WavRecorder was already recording, pausing first');
        await wavRecorder.pause();
      }

      // Start recording
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsRecording(false);
    }
  }, [isInputDeviceOn, isRecording]);

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = useCallback(async () => {
    // Only try to stop recording if we're actually recording
    if (!isRecording) {
      return;
    }

    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    try {
      // Only try to pause if we're actually recording
      if (wavRecorder.recording) {
        // Stop recording
        await wavRecorder.pause();

        // Create response
        client.createResponse();
      }
    } catch (error) {
      // If there's an error during pause (e.g., already paused), log it but don't crash
      console.error('Error stopping recording:', error);
      
      // Reset the recording state to ensure UI is consistent
      setIsRecording(false);
    }
  }, [isRecording]);

  /**
   * Play or stop test tone for debugging
   */
  const playTestTone = useCallback(async () => {
    try {
      const audioService = audioServiceRef.current;
      if (!audioService) {
        console.error('Audio service not available');
        return;
      }

      // If test tone is already playing, stop it
      if (isTestTonePlaying) {
        await audioService.interruptAudio();
        setIsTestTonePlaying(false);
        console.log('Stopped test tone');
        return;
      }

      // Clear the interrupted status for the test-tone track
      // This is necessary because WavStreamPlayer keeps track of interrupted tracks
      // and won't play them again unless cleared
      audioService.clearInterruptedTracks();
      
      // Add debug logging to check WavStreamPlayer's interruptedTrackIds
      const wavStreamPlayer = audioService.getWavStreamPlayer();
      console.log('WavStreamPlayer before playing test tone:', wavStreamPlayer);
      
      // Access and log the interruptedTrackIds with proper type checking
      const interruptedTrackIds = (wavStreamPlayer as any).interruptedTrackIds || {};
      console.log('WavStreamPlayer interruptedTrackIds:', interruptedTrackIds);
      
      // Manually clear the WavStreamPlayer's interruptedTrackIds for the test-tone
      if (typeof interruptedTrackIds === 'object' && interruptedTrackIds['test-tone']) {
        console.log('Manually clearing test-tone from WavStreamPlayer.interruptedTrackIds');
        delete interruptedTrackIds['test-tone'];
      }
      
      console.log('Cleared interrupted tracks before playing test tone');

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

      // Create a temporary audio context for decoding with the same sample rate as WavStreamPlayer
      const targetSampleRate = 24000; // Match the sample rate used in WavStreamPlayer
      const tempContext = new AudioContext({ sampleRate: targetSampleRate });
      const audioBuffer = await tempContext.decodeAudioData(arrayBuffer);

      console.log(`Test tone audio info - Sample rate: ${audioBuffer.sampleRate}Hz, Duration: ${audioBuffer.duration}s, Channels: ${audioBuffer.numberOfChannels}`);

      // Check if we need to resample
      let processedBuffer = audioBuffer;
      if (audioBuffer.sampleRate !== targetSampleRate) {
        console.log(`Resampling from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
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
        console.log('Converting stereo to mono');
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
      //
      // //
      // // // Clear the interruptedTrackIds for 'test-tone' to allow replaying
      // // // This is necessary because WavStreamPlayer keeps track of interrupted tracks
      // // // and won't play them again unless cleared
      // // if (wavStreamPlayer.interruptedTrackIds && typeof wavStreamPlayer.interruptedTrackIds === 'object') {
      // //   delete wavStreamPlayer.interruptedTrackIds['test-tone'];
      // // }
      //
      // await audioService.connectWavStreamPlayer();
      // // audioService.clearInterruptedTracks();

      // Play the test tone using the audio service
      audioService.addAudioData(pcm16bit, 'test-tone');

      // Set the state to indicate test tone is playing
      setIsTestTonePlaying(true);

      // If output device is ON, ensure monitor device is connected immediately
      if (isMonitorDeviceOn && selectedMonitorDevice &&
        !selectedMonitorDevice.label.toLowerCase().includes('sokuji_virtual') &&
        !selectedMonitorDevice.label.includes('Sokuji Virtual Output')) {
        console.log('Test tone: Ensuring monitor device is connected:', selectedMonitorDevice.label);

        // Trigger the selectMonitorDevice function to reconnect the monitor
        // This will use the audio service properly through the AudioContext
        selectMonitorDevice(selectedMonitorDevice);
      }

      console.log('Playing test tone');
    } catch (error) {
      console.error('Error playing test tone:', error);
      setIsTestTonePlaying(false);
    }
  }, [isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice, isTestTonePlaying]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
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
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
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
              // Get the WavStreamPlayer from the audio service to access its frequencies
              const wavStreamPlayer = audioService.getWavStreamPlayer();
              
              // Check if the WavStreamPlayer is properly connected before calling getFrequencies
              if (wavStreamPlayer && wavStreamPlayer.context && wavStreamPlayer.context.state === 'running') {
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
              console.warn('Error getting frequencies from WavStreamPlayer:', error);
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
  }, []);

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

    const wavRecorder = wavRecorderRef.current;
    const client = clientRef.current;

    const updateRecordingState = async () => {
      try {
        // If input device is turned off, pause recording
        if (!isInputDeviceOn) {
          console.log('Input device turned off - pausing recording');
          if (wavRecorder.recording) {
            await wavRecorder.pause();
            setIsRecording(false);
          }
        }
        // If input device is turned on
        else {
          // First, check if the recorder is initialized by checking the processor property
          if (!wavRecorder.processor) {
            console.log('Input device turned on - initializing recorder with selected device');
            try {
              await wavRecorder.begin(selectedInputDevice?.deviceId);
            } catch (error) {
              console.error('Error initializing recorder:', error);
              return;
            }
          }

          // If we're in automatic mode, resume recording
          if (settings.turnDetectionMode !== 'Disabled') {
            console.log('Input device turned on - resuming recording in automatic mode');
            if (!wavRecorder.recording) {
              await wavRecorder.record((data) => client.appendInputAudio(data.mono));
            }
          }
          // For push-to-talk mode, we don't automatically resume recording
          // The user needs to press the button or Space key
        }
      } catch (error) {
        console.error('Error updating recording state:', error);
      }
    };

    updateRecordingState();
  }, [isInputDeviceOn, isSessionActive, settings.turnDetectionMode, selectedInputDevice]);

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
          console.log('Selected monitor device is a virtual device - not using as monitor');
          return;
        }

        // If monitor device is turned on, connect the monitor
        if (isMonitorDeviceOn && selectedMonitorDevice) {
          console.log(`Setting up monitor output to: ${selectedMonitorDevice.label}`);

          // Trigger the selectMonitorDevice function to reconnect the monitor
          // This will use the audio service properly through the AudioContext
          selectMonitorDevice(selectedMonitorDevice);
        }
      } catch (error) {
        console.error('Error setting up monitor device:', error);
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

  /**
   * Initialize audio on component mount
   */
  useEffect(() => {
    const initAudio = async () => {
      try {
        // Set up the virtual audio output
        await setupVirtualAudioOutput();
      } catch (error) {
        console.error('Failed to initialize audio:', error);
      }
    };
    
    initAudio();
  }, [setupVirtualAudioOutput]);

  return (
    <div className="main-panel">
      <div className="conversation-container" ref={conversationContainerRef}>
        <div className="conversation-content" data-conversation-content>
          {items.length > 0 ? (
            items.map((item, index) => (
              <div key={index} className={`conversation-item ${item.role}`}>
                <div className="conversation-item-role">{item.role}</div>
                <div className="conversation-item-content">
                  {(() => {
                    // Handle different item types based on the ItemType structure
                    // from @openai/realtime-api-beta

                    // For items with formatted property containing text
                    if (item.formatted && item.formatted.text) {
                      return (
                        <div className="content-item text">
                          {item.formatted.text}
                        </div>
                      );
                    }

                    // For items with formatted property containing transcript
                    if (item.formatted && item.formatted.transcript) {
                      return (
                        <div className="content-item transcript">
                          {item.formatted.transcript}
                        </div>
                      );
                    }

                    // For items with formatted property containing audio
                    if (item.formatted && item.formatted.audio) {
                      return (
                        <div className="content-item audio">
                          <div className="audio-indicator">
                            <span className="audio-icon">🔊</span>
                            <span className="audio-text">Audio content</span>
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
                            {contentItem.type === 'audio' && (
                              <div className="audio-indicator">
                                <span className="audio-icon">🔊</span>
                                <span className="audio-text">Audio content</span>
                              </div>
                            )}
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
                          <div className="tool-name">Function: {item.formatted.tool.name}</div>
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
                <span>Conversation will appear here</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="audio-visualization">
        <div className="visualization-container">
          <div className="visualization-label">Input</div>
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
                  {isRecording ? 'release' : isInputDeviceOn ? 'push to talk (Space)' : 'input device off'}
                </span>
              </>
            </button>
          )}
          <button
            className={`session-button ${isSessionActive ? 'active' : ''}`}
            onClick={isSessionActive ? disconnectConversation : connectConversation}
            disabled={(!isSessionActive && !isApiKeyValid) || isInitializing}
          >
            {isInitializing ? (
              <>
                <Loader size={14} className="spinner" />
                <span>Initializing...</span>
              </>
            ) : isSessionActive ? (
              <>
                <X size={14} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Zap size={14} />
                <span>Start Session</span>
                {!isApiKeyValid && (
                  <span className="tooltip">Please add a valid OpenAI API Key in settings first</span>
                )}
              </>
            )}
          </button>
          {process.env.NODE_ENV === 'development' && (
            <button
              className="debug-button"
              onClick={playTestTone}
            >
              <Tool size={14} />
              <span>{isTestTonePlaying ? 'Stop Debug' : 'Debug'}</span>
            </button>
          )}
        </div>

        <div className="visualization-container">
          <div className="visualization-label">Output</div>
          <canvas ref={serverCanvasRef} className="visualization-canvas server-canvas" />
        </div>
      </div>
    </div>
  );
};

export default MainPanel;

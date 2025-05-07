import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Zap, Users, Mic, Tool, Loader } from 'react-feather';
import './MainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useLog } from '../../contexts/LogContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../../lib/wavtools/index.js';
import { WavRenderer } from '../../utils/wav_renderer';
import { ServiceFactory } from '../../services/ServiceFactory'; // Import the ServiceFactory

interface MainPanelProps {}

interface WavStreamPlayerWithInterruptedTrackIds extends WavStreamPlayer {
  interruptedTrackIds: { [key: string]: boolean };
}

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
  const setupVirtualAudioOutput = useCallback(async (audioContext: AudioContext | null): Promise<boolean> => {
    if (!audioContext) {
      console.error('Cannot setup virtual audio output: AudioContext is null');
      return false;
    }

    try {
      // Get the audio service from the ServiceFactory
      const audioService = ServiceFactory.getAudioService();

      // Use the audio service to set up the virtual audio output
      const result = await audioService.setupVirtualAudioOutput(audioContext);

      return result;
    } catch (e) {
      console.error('Failed to set up virtual audio output:', e);
      return false;
    }
  }, []);

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayerWithInterruptedTrackIds>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );

  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({
      apiKey: settings.openAIApiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );

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
    const wavStreamPlayer = wavStreamPlayerRef.current;

    if (!client) return;

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: { [key: string]: any }) => {
      // console.log(realtimeEvent);
      addRealtimeEvent(realtimeEvent, realtimeEvent.source, realtimeEvent.event.type);
    });
    client.on('error', (event: any) => console.error(event));
    // client.on('conversation.interrupted', () => {
    //   const trackSampleOffset = wavStreamPlayer.interrupt();
    //   if (trackSampleOffset?.trackId) {
    //     const { trackId, offset } = trackSampleOffset;
    //     client.cancelResponse(trackId, offset);
    //   }
    // });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
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

    const wavStreamPlayer = wavStreamPlayerRef.current;
    wavStreamPlayer.interrupt();
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    try {
      setIsInitializing(true);

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
      const wavStreamPlayer = wavStreamPlayerRef.current;

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

      // Connect to audio output
      await wavStreamPlayer.connect();

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
  }, [settings, getUpdateSessionParams, setupClientListeners, selectedInputDevice, isInputDeviceOn, disconnectConversation, setupVirtualAudioOutput, isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice]);

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

    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Interrupt any playing audio
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      client.cancelResponse(trackId, offset);
    }

    // Start recording
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  }, [isInputDeviceOn]);

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

    // Only try to pause if we're actually recording
    if (wavRecorder.recording) {
      // Stop recording
      await wavRecorder.pause();

      // Create response
      client.createResponse();
    }
  }, [isRecording]);

  /**
   * Play or stop test tone for debugging
   */
  const playTestTone = useCallback(async () => {
    try {
      const wavStreamPlayer = wavStreamPlayerRef.current;

      // If test tone is already playing, stop it
      if (isTestTonePlaying) {
        await wavStreamPlayer.interrupt();
        setIsTestTonePlaying(false);
        console.log('Stopped test tone');
        return;
      }

      // Ensure the player is connected before playing
      if (!wavStreamPlayer.context || wavStreamPlayer.context.state === 'closed') {
        await wavStreamPlayer.connect();
      } else if (wavStreamPlayer.context.state === 'suspended') {
        await wavStreamPlayer.context.resume();
      }

      // Make sure we have a valid context after connecting
      if (!wavStreamPlayer.context) {
        throw new Error('Failed to initialize audio context');
      }

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

      // Use the wavStreamPlayer's context for decoding to ensure consistent sample rate
      const audioBuffer = await wavStreamPlayer.context.decodeAudioData(arrayBuffer);

      // Get the sample rate from the player
      const targetSampleRate = wavStreamPlayer.sampleRate;

      // Create an offline context for resampling if needed
      let processedBuffer = audioBuffer;
      if (audioBuffer.sampleRate !== targetSampleRate) {
        const offlineCtx = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          audioBuffer.duration * targetSampleRate,
          targetSampleRate
        );

        const bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(offlineCtx.destination);
        bufferSource.start();

        // Render the audio at the target sample rate
        processedBuffer = await offlineCtx.startRendering();
      }

      // Extract PCM data from the first channel
      const pcmData = new Float32Array(processedBuffer.length);
      processedBuffer.copyFromChannel(pcmData, 0, 0);

      // Convert to 16-bit PCM (format expected by wavStreamPlayer)
      const pcm16bit = new Int16Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        // Convert float (-1.0 to 1.0) to int16 (-32768 to 32767)
        // Apply a slight volume reduction to prevent clipping
        const sample = pcmData[i] * 0.8;
        pcm16bit[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      }

      // Interrupt any currently playing audio
      await wavStreamPlayer.interrupt();

      // Clear the interruptedTrackIds for 'test-tone' to allow replaying
      // This is necessary because WavStreamPlayer keeps track of interrupted tracks
      // and won't play them again unless cleared
      if (wavStreamPlayer.interruptedTrackIds && typeof wavStreamPlayer.interruptedTrackIds === 'object') {
        delete wavStreamPlayer.interruptedTrackIds['test-tone'];
      }

      // Play the test tone using wavStreamPlayer
      wavStreamPlayer.add16BitPCM(pcm16bit, 'test-tone');

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
  }, [setupVirtualAudioOutput, isMonitorDeviceOn, selectedMonitorDevice, selectMonitorDevice, isTestTonePlaying]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
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
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
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
    // Check if there's an active wavStreamPlayer context
    const wavStreamPlayer = wavStreamPlayerRef.current;
    if (!wavStreamPlayer.context || wavStreamPlayer.context.state === 'closed') {
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
   * Add keyboard shortcut for push-to-talk functionality
   */
  useEffect(() => {
    // Only add event listeners if session is active and push-to-talk is enabled
    if (!isSessionActive || !canPushToTalk) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Use Space key as the shortcut for push-to-talk
      if (e.code === 'Space' && !e.repeat && !isRecording) {
        // Prevent default space behavior (scrolling)
        e.preventDefault();
        startRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Release push-to-talk when Space key is released
      if (e.code === 'Space' && isRecording) {
        e.preventDefault();
        stopRecording();
      }
    };

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Clean up event listeners on unmount or when dependencies change
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSessionActive, canPushToTalk, isRecording, startRecording, stopRecording]);

  /**
   * Initialize wavStreamPlayer and setup virtual audio output as soon as component mounts
   */
  useEffect(() => {
    const initAudio = async () => {
      const wavStreamPlayer = wavStreamPlayerRef.current;
      
      try {
        // Connect wavStreamPlayer early
        console.log('Initializing wavStreamPlayer and AudioContext early');
        await wavStreamPlayer.connect();
        console.log('wavStreamPlayer connected');
        
        // Setup virtual audio output immediately after connecting
        if (wavStreamPlayer.context) {
          console.log('Setting up virtual audio output early, maybe failed because of autoplay policy');
          await setupVirtualAudioOutput(wavStreamPlayer.context);
        } else {
          console.warn('Could not set up virtual audio output: wavStreamPlayer.context is null');
        }
      } catch (error) {
        console.error('Failed to initialize audio early:', error);
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

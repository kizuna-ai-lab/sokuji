import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Zap, Users } from 'react-feather';
import './MainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useLog } from '../../contexts/LogContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../../lib/wavtools/index.js';
import { WavRenderer } from '../../utils/wav_renderer';

interface MainPanelProps {}

const MainPanel: React.FC<MainPanelProps> = () => {
  // State for session management
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [items, setItems] = useState<ItemType[]>([]);
  
  // Get settings from context
  const { settings } = useSettings();
  
  // Get log functions from context
  const { addRealtimeEvent } = useLog();
  
  // Get audio context from context
  const { selectedInputDevice } = useAudioContext();
  
  // canPushToTalk is true only when turnDetectionMode is 'Disabled'
  const [canPushToTalk, setCanPushToTalk] = useState(false);
  
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
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
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
    client.on('realtime.event', (realtimeEvent: {[key:string]: any}) => {
      // console.log(realtimeEvent);
      addRealtimeEvent(realtimeEvent, realtimeEvent.source, realtimeEvent.event.type);
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', () => {
      const trackSampleOffset = wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        client.cancelResponse(trackId, offset);
      }
    });
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
      console.log('items', items);
      setItems(items);
    });

    setItems(client.conversation.getItems());
  }, [addRealtimeEvent]);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
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

    // Set state variables
    setIsSessionActive(true);
    setItems(client.conversation.getItems() as ItemType[]);
    
    // Set canPushToTalk based on current turnDetectionMode
    setCanPushToTalk(settings.turnDetectionMode === 'Disabled');
    
    // Connect to microphone
    await wavRecorder.begin(selectedInputDevice.deviceId);

    // Connect to audio output
    await wavStreamPlayer.connect();
    
    // Find and use sokuji_virtual_speaker as the output device
    try {
      // Get all audio output devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Find sokuji_virtual_speaker
      const virtualSpeaker = devices.find(device => 
        device.kind === 'audiooutput' && 
        device.label.toLowerCase().includes('sokuji_virtual_speaker')
      );
      
      // If virtual speaker is found, set it as the output device
      if (virtualSpeaker && virtualSpeaker.deviceId) {
        const ctxWithSink = wavStreamPlayer.context as AudioContext & { setSinkId?: (options: string | { type: string } | { deviceId: string }) => Promise<void> };
        if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
          try {
            // According to MDN documentation, the correct way is to pass an object containing deviceId
            await ctxWithSink.setSinkId({ deviceId: virtualSpeaker.deviceId });
            console.log('AudioContext output device set to Sokuji_Virtual_Speaker:', virtualSpeaker.deviceId);
          } catch (err) {
            // If the new format fails, try the old format (directly passing the string)
            console.log('Trying alternative setSinkId format...');
            await ctxWithSink.setSinkId(virtualSpeaker.deviceId);
            console.log('AudioContext output device set using alternative format');
          }
        }
      } else {
        console.log('Sokuji_Virtual_Speaker not found among output devices');
      }
    } catch (e) {
      console.warn('Failed to set AudioContext to Sokuji_Virtual_Speaker:', e);
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
    await client.realtime.connect({model: settings.model});
    client.updateSession();
    
    // Start recording if using server VAD
    if (settings.turnDetectionMode !== 'Disabled') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, [settings, getUpdateSessionParams, setupClientListeners, selectedInputDevice]);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsSessionActive(false);
    // setItems([]);

    const client = clientRef.current;
    client.reset();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    wavStreamPlayer.interrupt();
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = useCallback(async () => {
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
  }, []);

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    
    // Stop recording
    await wavRecorder.pause();
    
    // Create response
    client.createResponse();
  }, []);

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

  return (
    <div className="main-panel">
      <div className="conversation-container">
        <div className="conversation-content" data-conversation-content>
          {items.length > 0 ? (
            items.map((item) => (
              <div key={item.id} className={`conversation-item ${item.role}`}>
                <div className="conversation-item-role">{item.role}</div>
                <div className="conversation-item-content">
                  {(() => {
                    // Use type assertion to access potentially undefined properties
                    const item_any = item as any;
                    
                    // For items with content array property
                    if (item_any.content && Array.isArray(item_any.content)) {
                      return item_any.content.map((contentItem: any, i: number) => (
                        <div key={i} className="content-item">
                          {contentItem.type === 'text' && contentItem.text}
                        </div>
                      ));
                    }
                    
                    // For items with formatted_content array
                    if (item_any.formatted_content && Array.isArray(item_any.formatted_content)) {
                      return item_any.formatted_content.map((contentItem: any, i: number) => (
                        <div key={i} className="content-item">
                          {contentItem.text}
                        </div>
                      ));
                    }
                    
                    // For items with text property
                    if (item_any.text) {
                      return (
                        <div className="content-item">
                          {item_any.text}
                        </div>
                      );
                    }
                    
                    // Fallback for other content types
                    return (
                      <div className="content-item">
                        {JSON.stringify(item)}
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
        <div className="visualization-container">
          <div className="visualization-label">Output</div>
          <canvas ref={serverCanvasRef} className="visualization-canvas server-canvas" />
        </div>
      </div>
      
      <div className="floating-controls">
        {isSessionActive && canPushToTalk && (
          <button
            className={`push-to-talk-button ${isRecording ? 'recording' : ''}`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            disabled={!isSessionActive || !canPushToTalk}
          >
            <span>{isRecording ? 'release to send' : 'push to talk'}</span>
          </button>
        )}
        <button 
          className={`session-button ${isSessionActive ? 'active' : ''}`} 
          onClick={isSessionActive ? disconnectConversation : connectConversation}
        >
          {isSessionActive ? (
            <>
              <X size={16} />
              <span>disconnect</span>
            </>
          ) : (
            <>
              <Zap size={16} />
              <span>connect</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default MainPanel;

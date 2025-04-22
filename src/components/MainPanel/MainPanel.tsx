import React, { useState, useCallback, useEffect } from 'react';
import { X, Zap, Users } from 'react-feather';
import './MainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';

interface MainPanelProps {}

const MainPanel: React.FC<MainPanelProps> = () => {
  // State for session management
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  // Get settings from context
  const { settings } = useSettings();
  
  // canPushToTalk is true only when turnDetectionMode is 'Disabled'
  const [canPushToTalk, setCanPushToTalk] = useState(settings.turnDetectionMode === 'Disabled');
  
  // Update canPushToTalk whenever turnDetectionMode changes
  useEffect(() => {
    setCanPushToTalk(settings.turnDetectionMode === 'Disabled');
  }, [settings.turnDetectionMode]);

  /**
   * Connect to conversation:
   * Similar to ConsolePage's connectConversation
   */
  const connectConversation = useCallback(async () => {
    // This would be implemented with actual client, wavRecorder, and wavStreamPlayer
    console.log('Connecting to conversation...');
    console.log(`Turn detection mode: ${settings.turnDetectionMode}`);
    
    // Set state variables
    setIsSessionActive(true);
    
    // In a real implementation, you would:
    // 1. Connect to microphone
    // 2. Connect to audio output
    // 3. Connect to API
    // 4. Send initial message
  }, [settings.turnDetectionMode]);

  /**
   * Disconnect and reset conversation state
   * Similar to ConsolePage's disconnectConversation
   */
  const disconnectConversation = useCallback(async () => {
    console.log('Disconnecting conversation...');
    
    // Set state variables
    setIsSessionActive(false);
    
    // In a real implementation, you would:
    // 1. Disconnect client
    // 2. End recording
    // 3. Interrupt playback
  }, []);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    // Additional implementation needed to start audio recording
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    // Additional implementation needed to stop audio recording and send data
  }, []);

  return (
    <div className="main-panel">
      <div className="conversation-container">
        <div className="conversation-content">
          <div className="conversation-placeholder">
            <div className="placeholder-content">
              <div className="icon-container">
                <Users size={24} />
              </div>
              <span>Conversation will appear here</span>
            </div>
          </div>
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

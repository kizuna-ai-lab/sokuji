import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader, Volume2, VolumeX, Wifi, WifiOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import './SimpleMainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useSession } from '../../contexts/SessionContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { useLog } from '../../contexts/LogContext';
import { ConversationItem } from '../../services/clients';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { Provider } from '../../types/Provider';

interface SimpleMainPanelProps {
  items: ConversationItem[];
  isSessionActive: boolean;
  isInitializing: boolean;
  onStartSession: () => void;
  onEndSession: () => void;
  canPushToTalk: boolean;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

const SimpleMainPanel: React.FC<SimpleMainPanelProps> = ({
  items,
  isSessionActive,
  isInitializing,
  onStartSession,
  onEndSession,
  canPushToTalk,
  isRecording,
  onStartRecording,
  onStopRecording
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  
  const {
    isApiKeyValid,
    getCurrentProviderSettings,
    commonSettings
  } = useSettings();
  
  const {
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
  } = useAudioContext();

  // Determine connection status
  const getConnectionStatus = () => {
    if (!isApiKeyValid) return 'no-api-key';
    if (!selectedInputDevice) return 'no-mic';
    if (isInitializing) return 'connecting';
    if (isSessionActive) return 'connected';
    return 'disconnected';
  };

  const connectionStatus = getConnectionStatus();
  const currentSettings = getCurrentProviderSettings();

  // Get user-friendly status message
  const getStatusMessage = () => {
    switch (connectionStatus) {
      case 'no-api-key':
        return t('simplePanel.statusNoApiKey', 'Please configure your API key in settings');
      case 'no-mic':
        return t('simplePanel.statusNoMic', 'Please select a microphone in audio settings');
      case 'connecting':
        return t('simplePanel.statusConnecting', 'Connecting to translation service...');
      case 'connected':
        return t('simplePanel.statusConnected', 'Ready to translate');
      case 'disconnected':
        return t('simplePanel.statusDisconnected', 'Click start to begin translation');
      default:
        return '';
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'no-api-key':
      case 'no-mic':
        return <AlertCircle className="status-icon error" size={24} />;
      case 'connecting':
        return <Loader className="status-icon loading" size={24} />;
      case 'connected':
        return <CheckCircle2 className="status-icon success" size={24} />;
      case 'disconnected':
        return <WifiOff className="status-icon disconnected" size={24} />;
      default:
        return null;
    }
  };

  // Filter conversation items to show only user messages and assistant responses
  const filteredItems = items.filter(item => 
    (item.role === 'user' || item.role === 'assistant') &&
    (item.formatted?.transcript || item.formatted?.text)
  );

  // Auto-scroll to bottom when new items are added
  useEffect(() => {
    if (conversationContainerRef.current) {
      conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
    }
  }, [filteredItems]);

  // Push-to-talk keyboard handler
  useEffect(() => {
    if (!isSessionActive || !canPushToTalk || !isInputDeviceOn) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        onStartRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        onStopRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSessionActive, canPushToTalk, isInputDeviceOn, onStartRecording, onStopRecording]);

  const canStartSession = isApiKeyValid && selectedInputDevice && !isInitializing;

  return (
    <div className="simple-main-panel">
      {/* Status Header */}
      <div className="status-header">
        <div className="status-indicator">
          {getStatusIcon()}
          <div className="status-text">
            <h2>{isSessionActive ? t('simplePanel.translationActive', 'Translation Active') : t('simplePanel.translationInactive', 'Translation Inactive')}</h2>
            <p>{getStatusMessage()}</p>
          </div>
        </div>
        
        <div className="quick-info">
          <div className="info-item">
            <span className="label">{t('simplePanel.languages', 'Languages')}:</span>
            <span className="value">
              {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
            </span>
          </div>
          <div className="info-item">
            <span className="label">{t('simplePanel.provider', 'Service')}:</span>
            <span className="value">{commonSettings.provider}</span>
          </div>
        </div>
      </div>

      {/* Conversation Display */}
      <div className="conversation-display" ref={conversationContainerRef}>
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Volume2 size={48} />
            </div>
            <h3>{t('simplePanel.noConversation', 'No conversation yet')}</h3>
            <p>{t('simplePanel.startToBegin', 'Click Start to begin real-time translation')}</p>
          </div>
        ) : (
          <div className="conversation-list">
            {filteredItems.map((item, index) => (
              <div key={index} className={`message-bubble ${item.role}`}>
                <div className="message-header">
                  <span className="role">
                    {item.role === 'user' ? t('simplePanel.you', 'You') : t('simplePanel.translation', 'Translation')}
                  </span>
                </div>
                <div className="message-content">
                  {item.formatted?.transcript || item.formatted?.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Control Footer */}
      <div className="control-footer">
        <div className="device-indicators">
          <div className={`device-indicator ${isInputDeviceOn ? 'active' : 'inactive'}`}>
            {isInputDeviceOn ? <Mic size={16} /> : <MicOff size={16} />}
            <span>{selectedInputDevice?.label || t('simplePanel.noMicSelected', 'No mic selected')}</span>
          </div>
          <div className={`device-indicator ${isMonitorDeviceOn ? 'active' : 'inactive'}`}>
            {isMonitorDeviceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{selectedMonitorDevice?.label || t('simplePanel.noSpeakerSelected', 'No speaker selected')}</span>
          </div>
        </div>

        <div className="main-controls">
          {isSessionActive && canPushToTalk && (
            <button
              className={`push-to-talk-btn ${isRecording ? 'recording' : ''}`}
              onMouseDown={onStartRecording}
              onMouseUp={onStopRecording}
              onTouchStart={onStartRecording}
              onTouchEnd={onStopRecording}
            >
              <Mic size={20} />
              <span>{isRecording ? t('simplePanel.release', 'Release to stop') : t('simplePanel.holdToSpeak', 'Hold to speak')}</span>
            </button>
          )}
          
          <button
            className={`main-action-btn ${isSessionActive ? 'stop' : 'start'}`}
            onClick={isSessionActive ? onEndSession : onStartSession}
            disabled={!canStartSession && !isSessionActive}
          >
            {isInitializing ? (
              <>
                <Loader className="spinning" size={20} />
                <span>{t('simplePanel.connecting', 'Connecting...')}</span>
              </>
            ) : isSessionActive ? (
              <>
                <span className="stop-icon">■</span>
                <span>{t('simplePanel.stop', 'Stop')}</span>
              </>
            ) : (
              <>
                <span className="play-icon">▶</span>
                <span>{t('simplePanel.start', 'Start')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimpleMainPanel;
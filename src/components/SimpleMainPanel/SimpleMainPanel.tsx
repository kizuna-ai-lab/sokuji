import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Loader, MessageSquare } from 'lucide-react';
import './SimpleMainPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useSession } from '../../contexts/SessionContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { useUserProfile } from '../../contexts/UserProfileContext';
import { ConversationItem } from '../../services/clients';
import { Provider } from '../../types/Provider';
import { useTranslation } from 'react-i18next';

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
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  const [sessionDuration, setSessionDuration] = useState<string>('00:00');
  
  const {
    isApiKeyValid,
    getCurrentProviderSettings,
    commonSettings,
    navigateToSettings,
    availableModels,
    loadingModels
  } = useSettings();
  
  const {
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
  } = useAudioContext();

  const { sessionStartTime } = useSession();
  const { quota } = useUserProfile();

  const currentSettings = getCurrentProviderSettings();
  
  // Check if wallet has sufficient balance for Kizuna AI provider
  const hasValidBalance = (commonSettings.provider !== Provider.KIZUNA_AI) ||
    (quota && quota.balance !== undefined && quota.balance >= 0 && !quota.frozen);
  
  const canStartSession = isApiKeyValid && availableModels.length > 0 && 
    !loadingModels && !isInitializing && hasValidBalance;

  // Determine the reason why start is disabled
  let startDisabledReason = '';
  if (!isApiKeyValid) {
    startDisabledReason = t('simplePanel.invalidApiKey', 'Invalid API key');
  } else if (loadingModels) {
    startDisabledReason = t('simplePanel.loadingModels', 'Loading models...');
  } else if (availableModels.length === 0) {
    startDisabledReason = t('simplePanel.noModelsAvailable', 'No models available');
  } else if (commonSettings.provider === Provider.KIZUNA_AI && quota) {
    if (quota.frozen) {
      startDisabledReason = t('simplePanel.walletFrozen', 'Wallet is frozen. Please contact support.');
    } else if (quota.balance !== undefined && quota.balance < 0) {
      startDisabledReason = t('simplePanel.insufficientBalance', 'Insufficient token balance: {{balance}} tokens', { balance: quota.balance });
    }
  }

  // Filter conversation items to show only user messages and assistant responses
  const filteredItems = items.filter(item => 
    (item.role === 'user' || item.role === 'assistant') &&
    (item.formatted?.transcript || item.formatted?.text)
  );

  // Auto-scroll to bottom when new items are added
  useEffect(() => {
    if (conversationContainerRef.current) {
      const container = conversationContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [filteredItems]);
  

  // Update session duration
  useEffect(() => {
    if (!isSessionActive || !sessionStartTime) {
      setSessionDuration('00:00');
      return;
    }

    const updateDuration = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - sessionStartTime) / 1000);
      
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      
      if (hours > 0) {
        setSessionDuration(
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
      } else {
        setSessionDuration(
          `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
      }
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);

    return () => clearInterval(interval);
  }, [isSessionActive, sessionStartTime]);

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
  

  return (
    <div className="simple-main-panel">

      {/* Conversation Display */}
      <div className="conversation-display" ref={conversationContainerRef}>
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <MessageSquare size={32} />
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
        <div className="status-info">
          <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />
          <span 
            className="language-pair clickable" 
            onClick={() => navigateToSettings('languages')}
            title={t('simplePanel.clickToConfigLanguages', 'Click to configure languages')}
          >
            {currentSettings.sourceLanguage} → {currentSettings.targetLanguage}
          </span>
          {isSessionActive && (
            <span className="session-duration">
              {t('simplePanel.sessionDuration', 'Duration')}: {sessionDuration}
            </span>
          )}
          <span className="device-status">
            <span 
              className={`device-icon ${isInputDeviceOn ? 'active' : ''} clickable`}
              onClick={() => navigateToSettings('microphone')}
              title={t('simplePanel.clickToConfigMicrophone', 'Click to configure microphone')}
            >
              {isInputDeviceOn ? <Mic size={14} /> : <MicOff size={14} />}
            </span>
            <span 
              className={`device-icon ${isMonitorDeviceOn ? 'active' : ''} clickable`}
              onClick={() => navigateToSettings('speaker')}
              title={t('simplePanel.clickToConfigSpeaker', 'Click to configure speaker')}
            >
              {isMonitorDeviceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </span>
          </span>
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
              <Mic size={12} />
              <span className="btn-text">{isRecording ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
            </button>
          )}
          
          <button
            className={`main-action-btn ${isSessionActive ? 'stop' : 'start'}`}
            onClick={isSessionActive ? onEndSession : onStartSession}
            disabled={!canStartSession && !isSessionActive}
            title={startDisabledReason ? startDisabledReason : ''}
          >
            {isInitializing ? (
              <>
                <Loader className="spinning" size={16} />
                <span className="btn-text">{t('simplePanel.connecting', 'Connecting...')}</span>
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
      </div>
    </div>
  );
};

export default SimpleMainPanel;
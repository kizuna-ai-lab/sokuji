import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Loader, MessageSquare, Send, AlertCircle } from 'lucide-react';
import './SimpleMainPanel.scss';
import {
  useProvider,
  useIsApiKeyValid,
  useAvailableModels,
  useLoadingModels,
  useGetCurrentProviderSettings,
  useNavigateToSettings
} from '../../stores/settingsStore';
import { useSessionStartTime } from '../../stores/sessionStore';
import { useAudioContext } from '../../stores/audioStore';
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
  playingItemId?: string | null;
  playbackProgress?: {
    currentTime: number;
    duration: number;
    bufferedTime: number;
  } | null;
  // Text input props
  supportsTextInput: boolean;
  onSendText: (text: string) => void;
}

const SimpleMainPanel: React.FC<SimpleMainPanelProps> = React.memo(({
  items,
  isSessionActive,
  isInitializing,
  onStartSession,
  onEndSession,
  canPushToTalk,
  isRecording,
  onStartRecording,
  onStopRecording,
  playingItemId,
  playbackProgress,
  supportsTextInput,
  onSendText
}) => {
  const { t } = useTranslation();
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  const [sessionDuration, setSessionDuration] = useState<string>('00:00');

  // Text input state
  const [textInput, setTextInput] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);

  // Text input handlers
  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim() || !isSessionActive || isSendingText) return;

    setIsSendingText(true);
    onSendText(textInput.trim());
    setTextInput('');

    // Brief delay before allowing next submission
    setTimeout(() => setIsSendingText(false), 300);
  }, [textInput, isSessionActive, isSendingText, onSendText]);

  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  }, [handleTextSubmit]);

  // Settings from store
  const provider = useProvider();
  const isApiKeyValid = useIsApiKeyValid();
  const availableModels = useAvailableModels();
  const loadingModels = useLoadingModels();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
  const navigateToSettings = useNavigateToSettings();
  
  const {
    selectedInputDevice,
    selectedMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
  } = useAudioContext();

  const sessionStartTime = useSessionStartTime();
  const { quota } = useUserProfile();

  const currentSettings = getCurrentProviderSettings();
  
  // Check if wallet has sufficient balance for Kizuna AI provider
  const hasValidBalance = (provider !== Provider.KIZUNA_AI) ||
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
  } else if (provider === Provider.KIZUNA_AI && quota) {
    if (quota.frozen) {
      startDisabledReason = t('simplePanel.walletFrozen', 'Wallet is frozen. Please contact support.');
    } else if (quota.balance !== undefined && quota.balance < 0) {
      startDisabledReason = t('simplePanel.insufficientBalance', 'Insufficient token balance: {{balance}} tokens', { balance: quota.balance });
    }
  }

  // Filter conversation items to show only user messages, assistant responses, and errors
  const filteredItems = useMemo(
    () => items.filter(item =>
      (item.type === 'error' || item.role === 'user' || item.role === 'assistant') &&
      (item.formatted?.transcript || item.formatted?.text)
    ),
    [items]
  );

  // Calculate progress ratio for karaoke effect
  const progressRatio = useMemo(() => {
    if (!playbackProgress) {
      return 0;
    }
    
    // For streaming audio, bufferedTime is more accurate than duration
    const divisor = playbackProgress.bufferedTime || playbackProgress.duration || 1;
    return Math.min(playbackProgress.currentTime / divisor, 1);
  }, [playbackProgress?.currentTime, playbackProgress?.duration, playbackProgress?.bufferedTime]);

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
      // Skip if focus is on an input element (e.g., text input field)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        onStartRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Skip if focus is on an input element (e.g., text input field)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' ||
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

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
            {filteredItems.map((item, index) => {
              const isPlaying = playingItemId === item.id;
              const text = item.formatted?.transcript || item.formatted?.text || '';
              
              // Calculate highlighted characters for karaoke effect
              const highlightedChars = isPlaying ? Math.floor(text.length * progressRatio) : 0;

              const isParticipant = item.source === 'participant';

              // Handle error messages - use formatted.text which contains "[errorType] errorMessage"
              if (item.type === 'error') {
                return (
                  <div key={index} className={`message-bubble ${item.role} error`}>
                    <div className="message-header">
                      <span className="role">
                        <AlertCircle size={12} style={{ marginRight: '4px' }} />
                        {t('mainPanel.error', 'Error')}
                      </span>
                    </div>
                    <div className="message-content error-content">
                      <div className="error-message-text">{item.formatted?.text || t('mainPanel.unknownError', 'Unknown error')}</div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={index} className={`message-bubble ${item.role} ${isParticipant ? 'participant-source' : 'speaker-source'} ${isPlaying ? 'playing' : ''}`}>
                  <div className="message-header">
                    <span className="role">
                      {item.role === 'user'
                        ? (isParticipant ? t('simplePanel.participant', 'Participant') : t('simplePanel.you', 'You'))
                        : t('simplePanel.translation', 'Translation')}
                    </span>
                  </div>
                  <div className={`message-content ${isPlaying ? 'karaoke-active' : ''}`}>
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
            })}
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
              placeholder={t('simplePanel.typeMessage', 'Text to translate...')}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextKeyDown}
              maxLength={1000}
            />
            <button
              className={`send-btn ${!textInput.trim() ? 'disabled' : ''}`}
              onClick={handleTextSubmit}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!textInput.trim() || isSendingText}
              title={t('simplePanel.send', 'Send')}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

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
});

SimpleMainPanel.displayName = 'SimpleMainPanel';

export default SimpleMainPanel;
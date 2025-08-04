import React, { useState, useCallback } from 'react';
import { ArrowRight, Settings, Volume2, Key, Globe, CheckCircle, AlertCircle, HelpCircle, Bot, Sparkles, Zap, AudioLines, Mic, Languages } from 'lucide-react';
import './SimpleConfigPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { useSession } from '../../contexts/SessionContext';
import { useTranslation } from 'react-i18next';
import { Provider } from '../../types/Provider';
import { useAnalytics } from '../../lib/analytics';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import Tooltip from '../Tooltip/Tooltip';

interface SimpleConfigPanelProps {
  toggleSettings?: () => void;
}


const SimpleConfigPanel: React.FC<SimpleConfigPanelProps> = ({ toggleSettings }) => {
  const { t, i18n } = useTranslation();
  const { trackEvent } = useAnalytics();
  const { isSessionActive } = useSession();
  
  // Settings context
  const {
    commonSettings,
    openAISettings,
    geminiSettings,
    cometAPISettings,
    palabraAISettings,
    updateCommonSettings,
    updateOpenAISettings,
    updateGeminiSettings,
    updateCometAPISettings,
    updatePalabraAISettings,
    validateApiKey,
    isApiKeyValid,
    availableModels,
    loadingModels
  } = useSettings();
  
  // Audio context
  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    selectInputDevice,
    selectMonitorDevice,
    isInputDeviceOn,
    isMonitorDeviceOn,
    toggleInputDeviceState,
    toggleMonitorDeviceState
  } = useAudioContext();

  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false);

  // Filter out virtual devices
  const isVirtualDevice = (device: {label: string}) => {
    const label = device.label.toLowerCase();
    return label.includes('sokuji_virtual_mic') || label.includes('sokuji_virtual_speaker');
  };

  const filteredInputDevices = (audioInputDevices || []).filter(device => !isVirtualDevice(device));
  const filteredMonitorDevices = (audioMonitorDevices || []).filter(device => !isVirtualDevice(device));

  // Get provider configuration
  const providerConfig = ProviderConfigFactory.getConfig(commonSettings.provider);
  const currentProviderSettings = (() => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return openAISettings;
      case Provider.GEMINI:
        return geminiSettings;
      case Provider.COMET_API:
        return cometAPISettings;
      case Provider.PALABRA_AI:
        return palabraAISettings;
      default:
        return openAISettings;
    }
  })();

  // Get current API key based on provider
  const getCurrentApiKey = () => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return openAISettings.apiKey;
      case Provider.GEMINI:
        return geminiSettings.apiKey;
      case Provider.COMET_API:
        return cometAPISettings.apiKey;
      case Provider.PALABRA_AI:
        return palabraAISettings.clientId; // Show client ID as "API key" for simplicity
      default:
        return '';
    }
  };

  // Update API key based on provider
  const updateApiKey = (value: string) => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ apiKey: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ apiKey: value });
        break;
      case Provider.COMET_API:
        updateCometAPISettings({ apiKey: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ clientId: value });
        break;
    }
  };

  // Update source language
  const updateSourceLanguage = (value: string) => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ sourceLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ sourceLanguage: value });
        break;
      case Provider.COMET_API:
        updateCometAPISettings({ sourceLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ sourceLanguage: value });
        break;
    }
  };

  // Update target language
  const updateTargetLanguage = (value: string) => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ targetLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ targetLanguage: value });
        break;
      case Provider.COMET_API:
        updateCometAPISettings({ targetLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ targetLanguage: value });
        break;
    }
  };


  // Validate API key
  const handleValidateApiKey = async () => {
    setIsValidating(true);
    setValidationMessage('');
    
    const result = await validateApiKey();
    
    setIsValidating(false);
    setValidationMessage(result.message);
    
    trackEvent('api_key_validated', {
      provider: commonSettings.provider,
      success: result.valid === true
    });
  };

  // Get provider display info
  const getProviderInfo = () => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return {
          name: 'OpenAI',
          icon: Bot,
          helpUrl: 'https://platform.openai.com/api-keys',
          description: 'Powered by GPT models'
        };
      case Provider.GEMINI:
        return {
          name: 'Google Gemini',
          icon: Sparkles,
          helpUrl: 'https://makersuite.google.com/app/apikey',
          description: 'Google\'s AI technology'
        };
      case Provider.COMET_API:
        return {
          name: 'Comet API',
          icon: Zap,
          helpUrl: 'https://cometapi.com',
          description: 'Alternative AI provider'
        };
      case Provider.PALABRA_AI:
        return {
          name: 'Palabra AI',
          icon: AudioLines,
          helpUrl: 'https://palabra.ai',
          description: 'Specialized translation AI'
        };
      default:
        return {
          name: 'Unknown',
          icon: HelpCircle,
          helpUrl: '#',
          description: 'Unknown provider'
        };
    }
  };

  const providerInfo = getProviderInfo();
  const currentApiKey = getCurrentApiKey();

  return (
    <div className="simple-config-panel">
      <div className="config-header">
        <h2>{t('settings.title')}</h2>
        <button className="close-button" onClick={toggleSettings}>
          <ArrowRight size={16} />
          <span>{t('common.close')}</span>
        </button>
      </div>


      {/* Tab Content */}
      <div className="config-content">
        {isSessionActive && (
          <div className="session-warning">
            <AlertCircle size={16} />
            <span>{t('settings.sessionActiveNotice')}</span>
          </div>
        )}

        {/* Interface Language Section */}
        <div className="config-section">
          <h3>
            <Globe size={18} />
            {t('simpleConfig.interfaceLanguage', 'Interface Language')}
          </h3>
          <p className="section-description">
            {t('simpleConfig.interfaceLanguageDesc', 'Choose your preferred interface language')}
          </p>
          
          <div className="setting-row">
            <select
              value={i18n.language}
              onChange={(e) => {
                i18n.changeLanguage(e.target.value);
                updateCommonSettings({ uiLanguage: e.target.value });
              }}
              disabled={isSessionActive}
              className="language-select"
            >
              <option value="en">English</option>
              <option value="zh_CN">中文 (简体)</option>
              <option value="ja">日本語</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="ko">한국어</option>
            </select>
          </div>
        </div>

        {/* Translation Languages Section */}
        <div className="config-section">
          <h3>
            <Languages size={18} />
            {t('simpleConfig.translationLanguages', 'Translation Languages')}
          </h3>
          <p className="section-description">
            {t('simpleConfig.translationLanguagesDesc', 'Set the languages for translation')}
          </p>
          
          <div className="language-pair-row">
            <div className="language-select-group">
              <label>{t('simpleConfig.yourLanguage', 'Your Language')}</label>
              <select
                value={currentProviderSettings.sourceLanguage || 'auto'}
                onChange={(e) => updateSourceLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                <option value="auto">{t('common.autoDetect', 'Auto Detect')}</option>
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="language-select-group">
              <label>{t('simpleConfig.targetLanguage', 'Target Language')}</label>
              <select
                value={currentProviderSettings.targetLanguage || 'en'}
                onChange={(e) => updateTargetLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

            {/* API Key Section */}
            <div className="config-section">
              <h3>
                <Key size={18} />
                {t('simpleSettings.apiKey', 'API Key')}
              </h3>
              
              <div className="provider-info">
                <div className="provider-icon">{React.createElement(providerInfo.icon, { size: 24 })}</div>
                <div className="provider-details">
                  <div className="provider-name">{providerInfo.name}</div>
                  <div className="provider-description">{providerInfo.description}</div>
                </div>
              </div>

              <div className="api-key-input-group">
                <input
                  type="password"
                  value={currentApiKey}
                  onChange={(e) => updateApiKey(e.target.value)}
                  placeholder={t('simpleSettings.apiKeyPlaceholder', 'Enter your API key')}
                  className={`api-key-input ${isApiKeyValid ? 'valid' : ''}`}
                  disabled={isSessionActive}
                />
                <button
                  className="validate-button"
                  onClick={handleValidateApiKey}
                  disabled={!currentApiKey || isValidating || isSessionActive}
                >
                  {isValidating ? (
                    <span className="spinner" />
                  ) : isApiKeyValid ? (
                    <CheckCircle size={16} />
                  ) : (
                    t('simpleSettings.validate', 'Validate')
                  )}
                </button>
              </div>

              {validationMessage && (
                <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
                  {validationMessage}
                </div>
              )}

              <button
                className="help-link"
                onClick={() => setShowApiKeyHelp(!showApiKeyHelp)}
              >
                <HelpCircle size={14} />
                {t('simpleSettings.howToGetApiKey', 'How to get an API key?')}
              </button>

              {showApiKeyHelp && (
                <div className="help-content">
                  <p>{t('simpleSettings.apiKeyHelp1', '1. Visit the provider\'s website')}</p>
                  <a href={providerInfo.helpUrl} target="_blank" rel="noopener noreferrer">
                    {providerInfo.helpUrl}
                  </a>
                  <p>{t('simpleSettings.apiKeyHelp2', '2. Sign up or log in to your account')}</p>
                  <p>{t('simpleSettings.apiKeyHelp3', '3. Navigate to API keys section')}</p>
                  <p>{t('simpleSettings.apiKeyHelp4', '4. Create a new API key and copy it here')}</p>
                </div>
              )}
            </div>


        {/* Microphone Section */}
        <div className="config-section">
          <h3>
            <Mic size={18} />
            {t('simpleConfig.microphone', 'Microphone')}
          </h3>
          <p className="section-description">
            {t('simpleConfig.microphoneDesc', 'Select your microphone device for voice input')}
          </p>
          
          <div className="device-list">
            <div 
              className={`device-option ${!isInputDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isInputDeviceOn) {
                  toggleInputDeviceState();
                }
              }}
            >
              <span>{t('common.off', 'Off')}</span>
              {!isInputDeviceOn && <div className="selected-indicator" />}
            </div>
            {filteredInputDevices.map((device) => (
              <div
                key={device.deviceId}
                className={`device-option ${isInputDeviceOn && selectedInputDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => {
                  if (!isInputDeviceOn) {
                    toggleInputDeviceState();
                  }
                  selectInputDevice(device);
                }}
              >
                <span>{device.label || t('audioPanel.unknownDevice', 'Unknown Device')}</span>
                {isInputDeviceOn && selectedInputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Speaker Section */}
        <div className="config-section">
          <h3>
            <Volume2 size={18} />
            {t('simpleConfig.speaker', 'Speaker')}
          </h3>
          <p className="section-description">
            {t('simpleConfig.speakerDesc', 'Select your speaker device for audio output')}
          </p>
          
          <div className="device-list">
            <div 
              className={`device-option ${!isMonitorDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isMonitorDeviceOn) {
                  toggleMonitorDeviceState();
                }
              }}
            >
              <span>{t('common.off', 'Off')}</span>
              {!isMonitorDeviceOn && <div className="selected-indicator" />}
            </div>
            {filteredMonitorDevices.map((device) => (
              <div
                key={device.deviceId}
                className={`device-option ${isMonitorDeviceOn && selectedMonitorDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => {
                  if (!isMonitorDeviceOn) {
                    toggleMonitorDeviceState();
                  }
                  selectMonitorDevice(device);
                }}
              >
                <span>{device.label || t('audioPanel.unknownDevice', 'Unknown Device')}</span>
                {isMonitorDeviceOn && selectedMonitorDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimpleConfigPanel;
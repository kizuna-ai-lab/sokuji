import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Volume2, Key, Globe, CheckCircle, AlertCircle, HelpCircle, CircleHelp, Bot, Sparkles, Zap, AudioLines, Mic, Languages, User, ChevronDown, ChevronUp } from 'lucide-react';
import './SimpleConfigPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useAudioContext } from '../../contexts/AudioContext';
import { useSession } from '../../contexts/SessionContext';
import { useTranslation } from 'react-i18next';
import { Provider, ProviderType } from '../../types/Provider';
import { useAnalytics } from '../../lib/analytics';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../../services/providers/ProviderConfig';
import Tooltip from '../Tooltip/Tooltip';
import { useAuth } from '../../lib/clerk/ClerkProvider';
import { UserAccountInfo } from '../Auth/UserAccountInfo';
import { SignedIn, SignedOut } from '../Auth/AuthGuard';
import { isKizunaAIEnabled } from '../../utils/environment';

interface SimpleConfigPanelProps {
  toggleSettings?: () => void;
  highlightSection?: string | null;
}


const SimpleConfigPanel: React.FC<SimpleConfigPanelProps> = ({ toggleSettings, highlightSection }) => {
  const { t, i18n } = useTranslation();
  const { trackEvent } = useAnalytics();
  const navigate = useNavigate();
  const { isSessionActive } = useSession();
  const { getToken, isSignedIn } = useAuth();
  
  // Settings context
  const {
    commonSettings,
    openAISettings,
    geminiSettings,
    cometAPISettings,
    palabraAISettings,
    kizunaAISettings,
    updateCommonSettings,
    updateOpenAISettings,
    updateGeminiSettings,
    updateCometAPISettings,
    updatePalabraAISettings,
    updateKizunaAISettings,
    validateApiKey,
    isApiKeyValid,
    availableModels,
    loadingModels,
    navigateToSettings
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
  const [isProviderExpanded, setIsProviderExpanded] = useState(false);

  // Get all available providers for the dropdown
  const availableProviders = useMemo(() => {
    return ProviderConfigFactory.getAllConfigs();
  }, []);

  // Filter out virtual devices
  const isVirtualDevice = (device: {label: string}) => {
    const label = device.label.toLowerCase();
    return label.includes('sokuji_virtual_mic') || label.includes('sokuji_virtual_speaker');
  };

  const filteredInputDevices = (audioInputDevices || []).filter(device => !isVirtualDevice(device));
  const filteredMonitorDevices = (audioMonitorDevices || []).filter(device => !isVirtualDevice(device));

  // Get provider configuration with fallback
  let providerConfig: ProviderConfig;
  try {
    providerConfig = ProviderConfigFactory.getConfig(commonSettings.provider);
  } catch (error) {
    // If the current provider is not available (e.g., Kizuna AI when disabled),
    // fallback to OpenAI
    console.warn(`Provider ${commonSettings.provider} not available, using OpenAI as fallback`);
    providerConfig = ProviderConfigFactory.getConfig(Provider.OPENAI);
    // Update the settings to reflect the fallback
    updateCommonSettings({ provider: Provider.OPENAI });
  }
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
      case Provider.KIZUNA_AI:
        return kizunaAISettings;
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
      case Provider.KIZUNA_AI:
        return kizunaAISettings.apiKey || ''; // Use non-persistent API key from settings
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
      case Provider.KIZUNA_AI:
        // KizunaAI API key is managed by backend, so we don't allow updates here
        console.warn('KizunaAI API key is managed automatically');
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
      case Provider.KIZUNA_AI:
        updateKizunaAISettings({ sourceLanguage: value });
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
      case Provider.KIZUNA_AI:
        updateKizunaAISettings({ targetLanguage: value });
        break;
    }
  };


  // Validate API key
  const handleValidateApiKey = async () => {
    setIsValidating(true);
    setValidationMessage('');
    
    // Pass getAuthToken for Kizuna AI provider
    const getAuthToken = commonSettings.provider === Provider.KIZUNA_AI && isSignedIn && getToken ? 
      () => getToken() : undefined;
    
    const result = await validateApiKey(getAuthToken);
    
    setIsValidating(false);
    setValidationMessage(result.message);
    
    trackEvent('api_key_validated', {
      provider: commonSettings.provider,
      success: result.valid === true
    });
  };

  // Handle provider switching
  const handleProviderChange = (newProvider: ProviderType) => {
    const oldProvider = commonSettings.provider;
    updateCommonSettings({ provider: newProvider });
    
    // Track provider switch
    trackEvent('provider_switched', {
      from_provider: oldProvider || 'default',
      to_provider: newProvider,
      during_session: isSessionActive
    });
    
    // Reset validation status when provider changes
    setValidationMessage('');
    // Close the expanded state
    setIsProviderExpanded(false);
  };

  // Handle clicking outside the provider selector
  const handleClickOutside = useCallback((event: MouseEvent) => {
    const target = event.target as Element;
    if (!target.closest('.provider-selection-area')) {
      setIsProviderExpanded(false);
    }
  }, []);

  // Add click outside listener
  useEffect(() => {
    if (isProviderExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isProviderExpanded, handleClickOutside]);

  // Utility function to get provider info by ID
  const getProviderInfoById = (providerId: ProviderType) => {
    switch (providerId) {
      case Provider.OPENAI:
        return {
          name: t('providers.openai.name'),
          icon: Bot,
          helpUrl: 'https://platform.openai.com/api-keys',
          description: t('providers.openai.description')
        };
      case Provider.GEMINI:
        return {
          name: t('providers.gemini.name'),
          icon: Sparkles,
          helpUrl: 'https://makersuite.google.com/app/apikey',
          description: t('providers.gemini.description')
        };
      case Provider.COMET_API:
        return {
          name: t('providers.cometapi.name'),
          icon: Zap,
          helpUrl: 'https://cometapi.com',
          description: t('providers.cometapi.description')
        };
      case Provider.PALABRA_AI:
        return {
          name: t('providers.palabraai.name'),
          icon: AudioLines,
          helpUrl: 'https://palabra.ai',
          description: t('providers.palabraai.description')
        };
      case Provider.KIZUNA_AI:
        return {
          name: t('providers.kizunaai.name'),
          icon: User,
          helpUrl: 'https://kizuna.ai',
          description: t('providers.kizunaai.description')
        };
      default:
        return {
          name: t('providers.unknown.name'),
          icon: HelpCircle,
          helpUrl: '#',
          description: t('providers.unknown.description')
        };
    }
  };

  // Get provider display info for current provider
  const getProviderInfo = () => {
    return getProviderInfoById(commonSettings.provider);
  };

  const providerInfo = getProviderInfo();
  const currentApiKey = getCurrentApiKey();
  
  // Check if API key should be readonly (for backend-managed providers)
  const isReadOnlyApiKey = commonSettings.provider === Provider.KIZUNA_AI;

  // Handle scrolling and highlighting when highlightSection changes
  useEffect(() => {
    if (highlightSection) {
      // Small delay to ensure the panel is fully rendered
      setTimeout(() => {
        const sectionId = `${highlightSection}-section`;
        const element = document.getElementById(sectionId);
        if (element) {
          // Scroll to the element
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Add highlight class
          element.classList.add('highlight');
          
          // Remove highlight after 3 seconds and clear navigation target
          setTimeout(() => {
            element.classList.remove('highlight');
            navigateToSettings(null);
          }, 3000);
        }
      }, 100);
    }
  }, [highlightSection, navigateToSettings]);

  // Note: Auto-fetching of Kizuna AI API key is now handled centrally in SettingsContext
  // This prevents duplicate API calls and ensures consistent state management

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

        {/* User Account Section - Only show if Kizuna AI is enabled */}
        {isKizunaAIEnabled() && (
          <div className="config-section" id="user-account-section">
            <h3>
              <User size={18} />
              <span>{t('simpleConfig.userAccount', 'User Account')}</span>
              <Tooltip
                content={t('simpleConfig.userAccountTooltip', 'For users with technical knowledge and their own API keys, you can use your own API key whether logged in or not. User Account is designed for new users who prefer a simplified setup without complex configuration.')}
                position="top"
              >
                <CircleHelp className="lucide lucide-circle-help tooltip-trigger" size={14} />
              </Tooltip>
            </h3>
            
            <SignedIn>
              <UserAccountInfo />
            </SignedIn>
            
            <SignedOut>
              <div className="sign-in-prompt">
                <p>{t('simpleConfig.signInRequired', 'You can use your own AI provider and API key without logging in, or sign up to purchase and use kizuna.ai\'s API service.')}</p>
                <div className="auth-buttons">
                  <button 
                    className="sign-in-button"
                    onClick={() => {
                      navigate('/sign-in');
                    }}
                  >
                    {t('common.signIn', 'Sign In')}
                  </button>
                  <button 
                    className="sign-up-button"
                    onClick={() => {
                      navigate('/sign-up');
                    }}
                  >
                    {t('common.signUp', 'Sign Up')}
                  </button>
                </div>
              </div>
            </SignedOut>
          </div>
        )}

        {/* Interface Language Section */}
        <div className="config-section">
          <h3>
            <Globe size={18} />
            <span>{t('simpleConfig.interfaceLanguage')}</span>
            <Tooltip
              content={t('simpleConfig.interfaceLanguageDesc')}
              position="top"
              icon="help"
            />
          </h3>
          
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
              <option value="zh_TW">中文 (繁體)</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="pt_BR">Português (Brasil)</option>
              <option value="pt_PT">Português (Portugal)</option>
              <option value="vi">Tiếng Việt</option>
              <option value="hi">हिन्दी</option>
            </select>
          </div>
        </div>

        {/* Translation Languages Section */}
        <div className="config-section" id="languages-section">
          <h3>
            <Languages size={18} />
            <span>{t('simpleConfig.translationLanguages')}</span>
            <Tooltip
              content={t('simpleConfig.translationLanguagesDesc')}
              position="top"
              icon="help"
            />
          </h3>
          
          <div className="language-pair-row">
            <div className="language-select-group">
              <label>{t('simpleConfig.yourLanguage')}</label>
              <select
                value={currentProviderSettings.sourceLanguage || 'auto'}
                onChange={(e) => updateSourceLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                <option value="auto">{t('common.autoDetect')}</option>
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="language-arrow">
              <ArrowRight size={20} />
            </div>
            
            <div className="language-select-group">
              <label>{t('simpleConfig.targetLanguage')}</label>
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
            <div className="config-section" id="api-key-section">
              <h3>
                <Key size={18} />
                <span>{t('simpleSettings.apiKey')}</span>
                <Tooltip
                  content={
                    <div>
                      <p>{t('simpleSettings.apiKeyHelpTooltip')}</p>
                      <p style={{ marginTop: '8px' }}>{t('simpleSettings.apiKeyHelpTooltip2')}</p>
                      <a 
                        href="https://kizuna-ai-lab.github.io/sokuji/tutorials/openai-setup.html" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ color: '#10a37f', textDecoration: 'underline' }}
                      >
                        https://kizuna-ai-lab.github.io/sokuji/tutorials/openai-setup.html
                      </a>
                    </div>
                  }
                  position="top"
                  icon="help"
                  maxWidth={350}
                />
              </h3>
              
              <div className="provider-selection-area">
                <div 
                  className={`provider-info ${isProviderExpanded ? 'expanded' : ''} ${isSessionActive ? 'disabled' : ''}`}
                  onClick={() => !isSessionActive && setIsProviderExpanded(!isProviderExpanded)}
                >
                  <div className="provider-icon">{React.createElement(providerInfo.icon, { size: 24 })}</div>
                  <div className="provider-details">
                    <div className="provider-main-info">
                      <div className="provider-name">{providerInfo.name}</div>
                      <div className="provider-description">{providerInfo.description}</div>
                    </div>
                    {!isSessionActive && (
                      <div className="provider-toggle">
                        {isProviderExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    )}
                  </div>
                </div>
                
                {isProviderExpanded && !isSessionActive && (
                  <div className="provider-options">
                    {availableProviders
                      .filter(provider => provider.id !== commonSettings.provider)
                      .map((provider) => {
                        const optionInfo = getProviderInfoById(provider.id as ProviderType);
                        
                        return (
                          <div
                            key={provider.id}
                            className="provider-option"
                            onClick={() => handleProviderChange(provider.id as ProviderType)}
                          >
                            <div className="provider-option-icon">
                              {React.createElement(optionInfo.icon, { size: 20 })}
                            </div>
                            <div className="provider-option-details">
                              <div className="provider-option-name">{optionInfo.name}</div>
                              <div className="provider-option-description">{optionInfo.description}</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {commonSettings.provider !== Provider.KIZUNA_AI ? (
                <div className="api-key-input-group">
                  <input
                    type="password"
                    value={currentApiKey}
                    onChange={(e) => updateApiKey(e.target.value)}
                    placeholder={t('simpleSettings.apiKeyPlaceholder')}
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
                      t('simpleSettings.validate')
                    )}
                  </button>
                </div>
              ) : (
                isSignedIn ? (
                  <div className="api-key-info">
                    <CheckCircle size={16} className="success-icon" />
                    <span>{t('simpleSettings.autoAuthenticated', 'Automatically authenticated via your account')}</span>
                  </div>
                ) : (
                  <div className="api-key-warning">
                    <AlertCircle size={16} className="warning-icon" />
                    <span>{t('common.signInRequired', 'Please sign in to use Kizuna AI as your provider')}</span>
                  </div>
                )
              )}

              {validationMessage && (
                <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
                  {validationMessage}
                </div>
              )}
            </div>


        {/* Microphone Section */}
        <div className="config-section" id="microphone-section">
          <h3>
            <Mic size={18} />
            <span>{t('simpleConfig.microphone')}</span>
            <Tooltip
              content={t('simpleConfig.microphoneDesc')}
              position="top"
              icon="help"
              maxWidth={300}
            />
          </h3>
          
          <div className="device-list">
            <div 
              className={`device-option ${!isInputDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isInputDeviceOn) {
                  toggleInputDeviceState();
                }
              }}
            >
              <span>{t('common.off')}</span>
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
                <span>{device.label || t('audioPanel.unknownDevice')}</span>
                {isInputDeviceOn && selectedInputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Speaker Section */}
        <div className="config-section" id="speaker-section">
          <h3>
            <Volume2 size={18} />
            <span>{t('simpleConfig.speaker')}</span>
            <Tooltip
              content={t('simpleConfig.speakerDesc')}
              position="top"
              icon="help"
              maxWidth={300}
            />
          </h3>
          
          <div className="device-list">
            <div 
              className={`device-option ${!isMonitorDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isMonitorDeviceOn) {
                  toggleMonitorDeviceState();
                }
              }}
            >
              <span>{t('common.off')}</span>
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
                <span>{device.label || t('audioPanel.unknownDevice')}</span>
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
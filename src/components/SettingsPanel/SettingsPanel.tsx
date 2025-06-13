import React, { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Save, Check, AlertCircle, AlertTriangle, Info, Key, HelpCircle } from 'react-feather';
import './SettingsPanel.scss';
import { useSettings } from '../../contexts/SettingsContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../contexts/SessionContext';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import ProviderSpecificSettings from './ProviderSpecificSettings';

interface SettingsPanelProps {
  toggleSettings?: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ toggleSettings }) => {
  const { 
    settings, 
    updateSettings, 
    validateApiKey: contextValidateApiKey, 
    getProcessedSystemInstructions,
    availableModels,
    loadingModels,
    fetchAvailableModels
  } = useSettings();
  const { startOnboarding } = useOnboarding();
  const { t, i18n } = useTranslation();
  const { isSessionActive } = useSession();

  // Get current provider configuration
  const currentProviderConfig = useMemo(() => {
    try {
      return ProviderConfigFactory.getConfig(settings.provider || 'openai');
    } catch (error) {
      console.warn(`[SettingsPanel] Unknown provider: ${settings.provider}, falling back to OpenAI`);
      return ProviderConfigFactory.getConfig('openai');
    }
  }, [settings.provider]);

  // Get all available providers for the dropdown
  const availableProviders = useMemo(() => {
    return ProviderConfigFactory.getAllConfigs();
  }, []);

  const [apiKeyStatus, setApiKeyStatus] = useState<{
    valid: boolean | null;
    validating: boolean;
    message: string
  }>({ valid: null, validating: false, message: '' });
  
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: 'success' | 'error' | 'info' | 'warning' | null,
    message: string
  }>({ type: null, message: '' });
  const [isPreviewExpanded, setIsPreviewExpanded] = useState<boolean>(false);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus({ type: null, message: '' });
    let failCount = 0, successCount = 0;
    try {
      updateSettings({ openAIApiKey: settings.openAIApiKey });
      successCount++;
    } catch (error) {
      failCount++;
    }
    try {
      updateSettings({
        turnDetectionMode: settings.turnDetectionMode,
        threshold: settings.threshold,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        semanticEagerness: settings.semanticEagerness,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        transcriptModel: settings.transcriptModel,
        noiseReduction: settings.noiseReduction,
        voice: settings.voice,
        systemInstructions: settings.systemInstructions,
      });
      successCount++;
    } catch (error) {
      failCount++;
    }
    if (failCount === 0) {
      setSaveStatus({ type: 'success', message: t('settings.settingsSavedSuccessfully') });
    } else if (successCount > 0) {
      setSaveStatus({ type: 'warning', message: `${t('common.save')} ${successCount} settings, ${failCount} failed` });
    } else {
      setSaveStatus({ type: 'error', message: t('settings.failedToSaveSettings') });
    }
    setIsSaving(false);
  };

  const renderStatusIcon = () => {
    if (!saveStatus.type) return null;
    
    switch (saveStatus.type) {
      case 'success':
        return (
          <span className="status-icon-wrapper success" title={saveStatus.message}>
            <Check size={16} className="status-icon" />
          </span>
        );
      case 'error':
        return (
          <span className="status-icon-wrapper error" title={saveStatus.message}>
            <AlertCircle size={16} className="status-icon" />
          </span>
        );
      case 'warning':
        return (
          <span className="status-icon-wrapper warning" title={saveStatus.message}>
            <AlertTriangle size={16} className="status-icon" />
          </span>
        );
      case 'info':
        return (
          <span className="status-icon-wrapper info" title={saveStatus.message}>
            <Info size={16} className="status-icon" />
          </span>
        );
      default:
        return null;
    }
  };

  const handleValidateApiKey = async () => {
    setApiKeyStatus({
      valid: null,
      message: t('settings.validatingApiKey'),
      validating: true
    });
    
    const result = await contextValidateApiKey();
    setApiKeyStatus({
      valid: result.valid === true,
      message: result.message,
      validating: false
    });
    
    // If validation is successful, fetch available models
    if (result.valid === true) {
      await fetchAvailableModels();
    }
    
    return result.valid === true;
  };



  // Auto-fetch models when API key is available and valid (only for OpenAI)
  useEffect(() => {
    if (settings.provider === 'openai' && settings.openAIApiKey && settings.openAIApiKey.trim() !== '' && availableModels.length === 0 && !loadingModels) {
      fetchAvailableModels().catch(error => 
        console.error('[Sokuji] [SettingsPanel] Error auto-fetching models:', error)
      );
    }
  }, [settings.provider, settings.openAIApiKey, availableModels.length, loadingModels, fetchAvailableModels]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2>{t('settings.title')}</h2>
        <div className="header-actions">
          <button 
            className="save-all-button"
            onClick={handleSave}
            disabled={isSaving || isSessionActive}
          >
            <Save size={16} />
            <span>{isSaving ? t('settings.saving') : t('common.save')}</span>
          </button>
          
          {renderStatusIcon()}
          
          <button className="close-settings-button" onClick={toggleSettings}>
            <ArrowRight size={16} />
            <span>{t('common.close')}</span>
          </button>
        </div>
      </div>
      <div className="settings-content">
        {isSessionActive && (
          <div className="session-active-notice">
            <Info size={16} />
            <span>{t('settings.isSessionActiveNotice', 'Settings are locked while session is active. Please end the session to modify settings.')}</span>
          </div>
        )}
        <div className="settings-section api-key-section">
          <h2>{t('settings.provider', 'Service Provider')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.providerType', 'Provider')}</span>
            </div>
            <select
              className="select-dropdown"
              value={settings.provider || 'openai'}
              onChange={(e) => updateSettings({ provider: e.target.value as 'openai' | 'gemini' })}
              disabled={isSessionActive}
            >
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.apiKey', 'API Key')}</span>
            </div>
            <div className="api-key-container">
              <input
                value={settings.provider === 'openai' ? settings.openAIApiKey : settings.geminiApiKey}
                onChange={(e) => {
                  if (settings.provider === 'openai') {
                    updateSettings({ openAIApiKey: e.target.value });
                  } else {
                    updateSettings({ geminiApiKey: e.target.value });
                  }
                  // Reset validation status when key changes
                  setApiKeyStatus({ valid: null, message: '', validating: false });
                }}
                placeholder={currentProviderConfig.apiKeyPlaceholder}
                className={`text-input api-key-input ${
                  apiKeyStatus.valid === true ? 'valid' : 
                  apiKeyStatus.valid === false ? 'invalid' : ''
                }`}
                disabled={isSessionActive}
              />
              <button 
                className="validate-key-button"
                onClick={handleValidateApiKey}
                disabled={apiKeyStatus.validating || 
                  (settings.provider === 'openai' ? !settings.openAIApiKey : !settings.geminiApiKey) || 
                  isSessionActive}
              >
                <Key size={16} />
                <span>{apiKeyStatus.validating ? t('settings.validating') : t('settings.validate')}</span>
              </button>
            </div>
            {apiKeyStatus.message && (
              <div className={`api-key-status ${
                apiKeyStatus.valid === true ? 'success' : 
                apiKeyStatus.valid === false ? 'error' : 'info'
              }`}>
                {apiKeyStatus.message}
              </div>
            )}
          </div>
        </div>
        <div className="settings-section">
          <h2>{t('settings.language')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.uiLanguage')}</span>
            </div>
            <select
              className="select-dropdown"
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              disabled={isSessionActive}
            >
              <option value="en">🇺🇸 English</option>
              <option value="zh_CN">🇨🇳 中文 (简体)</option>
              <option value="hi">🇮🇳 हिन्दी</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="ar">🇸🇦 العربية</option>
              <option value="bn">🇧🇩 বাংলা</option>
              <option value="pt_BR">🇧🇷 Português (Brasil)</option>
              <option value="ru">🇷🇺 Русский</option>
              <option value="ja">🇯🇵 日本語</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="ko">🇰🇷 한국어</option>
              <option value="fa">🇮🇷 فارسی</option>
              <option value="tr">🇹🇷 Türkçe</option>
              <option value="vi">🇻🇳 Tiếng Việt</option>
              <option value="it">🇮🇹 Italiano</option>
              <option value="th">🇹🇭 ไทย</option>
              <option value="pl">🇵🇱 Polski</option>
              <option value="id">🇮🇩 Bahasa Indonesia</option>
              <option value="ms">🇲🇾 Bahasa Melayu</option>
              <option value="nl">🇳🇱 Nederlands</option>
              <option value="zh_TW">🇹🇼 中文 (繁體)</option>
              <option value="pt_PT">🇵🇹 Português (Portugal)</option>
              <option value="uk">🇺🇦 Українська</option>
              <option value="ta">🇮🇳 தமிழ்</option>
              <option value="te">🇮🇳 తెలుగు</option>
              <option value="he">🇮🇱 עברית</option>
              <option value="fil">🇵🇭 Filipino</option>
              <option value="sv">🇸🇪 Svenska</option>
              <option value="fi">🇫🇮 Suomi</option>
            </select>
          </div>
        </div>
                <ProviderSpecificSettings
          config={currentProviderConfig}
          isSessionActive={isSessionActive}
          isPreviewExpanded={isPreviewExpanded}
          setIsPreviewExpanded={setIsPreviewExpanded}
          getProcessedSystemInstructions={getProcessedSystemInstructions}
        />
        
        <div className="settings-section">
          <h2>{t('settings.help', 'Help')}</h2>
          <div className="setting-item">
            <button 
              className="restart-onboarding-button"
              onClick={() => {
                startOnboarding();
                if (toggleSettings) {
                  toggleSettings();
                }
              }}
            >
              <HelpCircle size={16} />
              <span>{t('onboarding.restartTour', 'Restart Setup Guide')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

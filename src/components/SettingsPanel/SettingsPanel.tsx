import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Check, AlertCircle, AlertTriangle, Info, Key, HelpCircle } from 'react-feather';
import './SettingsPanel.scss';
import { useSettings, VoiceOption, TurnDetectionMode, SemanticEagerness, NoiseReductionMode, TranscriptModel, Model } from '../../contexts/SettingsContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../contexts/SessionContext';

// Language options with native names and language codes
const languageOptions = [
  { name: 'العربية', value: 'ar' },
  { name: 'አማርኛ', value: 'am' },
  { name: 'Български', value: 'bg' },
  { name: 'বাংলা', value: 'bn' },
  { name: 'Català', value: 'ca' },
  { name: 'Čeština', value: 'cs' },
  { name: 'Dansk', value: 'da' },
  { name: 'Deutsch', value: 'de' },
  { name: 'Ελληνικά', value: 'el' },
  { name: 'English', value: 'en' },
  { name: 'English (Australia)', value: 'en_AU' },
  { name: 'English (Great Britain)', value: 'en_GB' },
  { name: 'English (USA)', value: 'en_US' },
  { name: 'Español', value: 'es' },
  { name: 'Español (Latinoamérica)', value: 'es_419' },
  { name: 'Eesti', value: 'et' },
  { name: 'فارسی', value: 'fa' },
  { name: 'Suomi', value: 'fi' },
  { name: 'Filipino', value: 'fil' },
  { name: 'Français', value: 'fr' },
  { name: 'ગુજરાતી', value: 'gu' },
  { name: 'עברית', value: 'he' },
  { name: 'हिन्दी', value: 'hi' },
  { name: 'Hrvatski', value: 'hr' },
  { name: 'Magyar', value: 'hu' },
  { name: 'Bahasa Indonesia', value: 'id' },
  { name: 'Italiano', value: 'it' },
  { name: '日本語', value: 'ja' },
  { name: 'ಕನ್ನಡ', value: 'kn' },
  { name: '한국어', value: 'ko' },
  { name: 'Lietuvių', value: 'lt' },
  { name: 'Latviešu', value: 'lv' },
  { name: 'മലയാളം', value: 'ml' },
  { name: 'मराठी', value: 'mr' },
  { name: 'Bahasa Melayu', value: 'ms' },
  { name: 'Nederlands', value: 'nl' },
  { name: 'Norsk', value: 'no' },
  { name: 'Polski', value: 'pl' },
  { name: 'Português (Brasil)', value: 'pt_BR' },
  { name: 'Português (Portugal)', value: 'pt_PT' },
  { name: 'Română', value: 'ro' },
  { name: 'Русский', value: 'ru' },
  { name: 'Slovenčina', value: 'sk' },
  { name: 'Slovenščina', value: 'sl' },
  { name: 'Српски', value: 'sr' },
  { name: 'Svenska', value: 'sv' },
  { name: 'Kiswahili', value: 'sw' },
  { name: 'தமிழ்', value: 'ta' },
  { name: 'తెలుగు', value: 'te' },
  { name: 'ไทย', value: 'th' },
  { name: 'Türkçe', value: 'tr' },
  { name: 'Українська', value: 'uk' },
  { name: 'Tiếng Việt', value: 'vi' },
  { name: '中文 (中国)', value: 'zh_CN' },
  { name: '中文 (台灣)', value: 'zh_TW' },
];

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

  // Runtime array of voice options
  const voiceOptions: VoiceOption[] = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'
  ];

  // Auto-fetch models when API key is available and valid
  useEffect(() => {
    if (settings.openAIApiKey && settings.openAIApiKey.trim() !== '' && availableModels.length === 0 && !loadingModels) {
      fetchAvailableModels().catch(error => 
        console.error('[Sokuji] [SettingsPanel] Error auto-fetching models:', error)
      );
    }
  }, [settings.openAIApiKey, availableModels.length, loadingModels, fetchAvailableModels]);

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
        <div className="settings-section api-key-section">
          <h2>{t('settings.openaiApiKey')}</h2>
          <div className="setting-item">
            <div className="api-key-container">
              <input
                value={settings.openAIApiKey}
                onChange={(e) => {
                  updateSettings({ openAIApiKey: e.target.value });
                  // Reset validation status when key changes
                  setApiKeyStatus({ valid: null, message: '', validating: false });
                }}
                placeholder={t('settings.enterApiKey')}
                className={`text-input api-key-input ${
                  apiKeyStatus.valid === true ? 'valid' : 
                  apiKeyStatus.valid === false ? 'invalid' : ''
                }`}
                disabled={isSessionActive}
              />
              <button 
                className="validate-key-button"
                onClick={handleValidateApiKey}
                disabled={apiKeyStatus.validating || !settings.openAIApiKey || isSessionActive}
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
        <div className="settings-section system-instructions-section">
          <h2>{t('settings.systemInstructions')}</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${settings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateSettings({ useTemplateMode: true })}
                disabled={isSessionActive}
              >
                {t('settings.simple')}
              </button>
              <button 
                className={`option-button ${!settings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateSettings({ useTemplateMode: false })}
                disabled={isSessionActive}
              >
                {t('settings.advanced')}
              </button>
            </div>
          </div>
          
          {settings.useTemplateMode ? (
            <>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.sourceLanguage')}</span>
                </div>
                <select
                  className="select-dropdown"
                  value={settings.sourceLanguage}
                  onChange={(e) => {
                    const newSourceLang = e.target.value;
                    // If new source language is the same as current target language,
                    // we need to update target language to avoid conflict
                    if (newSourceLang === settings.targetLanguage) {
                      // Find the first available language that's not the new source language
                      const newTargetLang = languageOptions.find(lang => 
                        lang.value !== newSourceLang
                      )?.value || '';
                      
                      updateSettings({
                        sourceLanguage: newSourceLang,
                        targetLanguage: newTargetLang
                      });
                    } else {
                      updateSettings({ sourceLanguage: newSourceLang });
                    }
                  }}
                  disabled={isSessionActive}
                >
                  {languageOptions
                    .map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.name}</option>
                    ))}
                </select>
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.targetLanguage')}</span>
                </div>
                <select
                  className="select-dropdown"
                  value={settings.targetLanguage}
                  onChange={(e) => updateSettings({ targetLanguage: e.target.value })}
                  disabled={isSessionActive}
                >
                  {languageOptions
                    .filter(lang => lang.value !== settings.sourceLanguage)
                    .map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.name}</option>
                    ))}
                </select>
              </div>
              <div className="setting-item">
                <div className="system-instructions-preview">
                  <h4>{t('settings.preview')}:</h4>
                  <div className="preview-content">
                    {getProcessedSystemInstructions()}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="setting-item">
              <textarea 
                className="system-instructions" 
                placeholder={t('settings.enterCustomInstructions')}
                value={settings.systemInstructions}
                onChange={(e) => updateSettings({ systemInstructions: e.target.value })}
                disabled={isSessionActive}
              />
            </div>
          )}
        </div>
        <div className="settings-section voice-settings-section">
          <h2>{t('settings.voice')}</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.voice}
              onChange={(e) => updateSettings({ voice: e.target.value as VoiceOption })}
              disabled={isSessionActive}
            >
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-section turn-detection-section">
          <h2>{t('settings.automaticTurnDetection')}</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Normal' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Normal' as TurnDetectionMode })}
                disabled={isSessionActive}
              >
                {t('settings.normal')}
              </button>
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Semantic' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Semantic' as TurnDetectionMode })}
                disabled={isSessionActive}
              >
                {t('settings.semantic')}
              </button>
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Disabled' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Disabled' as TurnDetectionMode })}
                disabled={isSessionActive}
              >
                {t('settings.disabled')}
              </button>
            </div>
          </div>

          {settings.turnDetectionMode === 'Normal' && (
            <>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.threshold')}</span>
                  <span className="setting-value">{settings.threshold.toFixed(2)}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={settings.threshold}
                  onChange={(e) => updateSettings({ threshold: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.prefixPadding')}</span>
                  <span className="setting-value">{settings.prefixPadding.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={settings.prefixPadding}
                  onChange={(e) => updateSettings({ prefixPadding: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.silenceDuration')}</span>
                  <span className="setting-value">{settings.silenceDuration.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={settings.silenceDuration}
                  onChange={(e) => updateSettings({ silenceDuration: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
            </>
          )}

          {settings.turnDetectionMode === 'Semantic' && (
            <div className="setting-item">
              <div className="setting-label">
                <span>{t('settings.eagerness')}</span>
              </div>
              <select 
                className="select-dropdown"
                value={settings.semanticEagerness}
                onChange={(e) => updateSettings({ semanticEagerness: e.target.value as SemanticEagerness })}
                disabled={isSessionActive}
              >
                <option value="Auto">Auto</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
          )}
        </div>
        <div className="settings-section">
          <h2>{t('settings.model')}</h2>
          <div className="setting-item">
            <div className="model-selection-container">
              <select
                className="select-dropdown"
                value={settings.model}
                onChange={(e) => updateSettings({ model: e.target.value as Model })}
                disabled={loadingModels || isSessionActive}
              >
                {availableModels.length > 0 ? (
                  availableModels
                    .filter(model => model.type === 'realtime')
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))
                ) : (
                  <>
                    <option value="gpt-4o-realtime-preview">gpt-4o-realtime-preview</option>
                    <option value="gpt-4o-mini-realtime-preview">gpt-4o-mini-realtime-preview</option>
                  </>
                )}
              </select>
              <button 
                className="refresh-models-button"
                onClick={() => fetchAvailableModels()}
                disabled={loadingModels || !settings.openAIApiKey || isSessionActive}
                title={t('settings.refreshModels')}
              >
                <span className={loadingModels ? 'loading' : ''}>
                  {loadingModels ? '⟳' : '↻'}
                </span>
              </button>
            </div>
            {loadingModels && (
              <div className="loading-status">
                {t('settings.loadingModels')}
              </div>
            )}
            {availableModels.filter(model => model.type === 'realtime').length > 0 && !loadingModels && (
              <div className="models-info">
                {t('settings.modelsFound', { count: availableModels.filter(model => model.type === 'realtime').length })}
              </div>
            )}
          </div>
        </div>
        <div className="settings-section">
          <h2>{t('settings.userTranscriptModel')}</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.transcriptModel}
              onChange={(e) => updateSettings({ transcriptModel: e.target.value as TranscriptModel })}
              disabled={isSessionActive}
            >
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
              <option value="whisper-1">whisper-1</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>{t('settings.noiseReduction')}</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.noiseReduction}
              onChange={(e) => updateSettings({ noiseReduction: e.target.value as NoiseReductionMode })}
              disabled={isSessionActive}
            >
              <option value="None">None</option>
              <option value="Near field">Near field</option>
              <option value="Far field">Far field</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>{t('settings.modelConfiguration')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.temperature')}</span>
              <span className="setting-value">{settings.temperature.toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="0.6" 
              max="1.2" 
              step="0.01" 
              value={settings.temperature}
              onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.maxTokens')}</span>
              <span className="setting-value">{settings.maxTokens}</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="4096" 
              step="1" 
              value={typeof settings.maxTokens === 'number' ? settings.maxTokens : 4096}
              onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
        </div>
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

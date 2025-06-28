import React, { Fragment } from 'react';
import { ProviderConfig } from '../../services/providers/ProviderConfig';
import { useSettings } from '../../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RotateCw } from 'lucide-react';
import { FilteredModel } from '../../services/interfaces/IClient';
import { Provider, isOpenAICompatible } from '../../types/Provider';

interface ProviderSpecificSettingsProps {
  config: ProviderConfig;
  isSessionActive: boolean;
  isPreviewExpanded: boolean;
  setIsPreviewExpanded: (expanded: boolean) => void;
  getProcessedSystemInstructions: () => string;
  availableModels: FilteredModel[];
  loadingModels: boolean;
  fetchAvailableModels: () => Promise<void>;
}

const ProviderSpecificSettings: React.FC<ProviderSpecificSettingsProps> = ({
  config,
  isSessionActive,
  isPreviewExpanded,
  setIsPreviewExpanded,
  getProcessedSystemInstructions,
  availableModels,
  loadingModels,
  fetchAvailableModels
}) => {
  const { 
    commonSettings, 
    updateCommonSettings,
    openAISettings,
    cometAPISettings,
    geminiSettings,
    updateOpenAISettings,
    updateCometAPISettings,
    updateGeminiSettings,
    getCurrentProviderSettings
  } = useSettings();
  const { t } = useTranslation();

  // Get current provider's settings
  const currentProviderSettings = getCurrentProviderSettings();

  // Helper functions to update current provider's settings
  const updateCurrentProviderSetting = (key: string, value: any) => {
    if (commonSettings.provider === Provider.OPENAI) {
      updateOpenAISettings({ [key]: value });
    } else if (commonSettings.provider === Provider.COMET_API) {
      updateCometAPISettings({ [key]: value });
    } else if (commonSettings.provider === Provider.GEMINI) {
      updateGeminiSettings({ [key]: value });
    } else {
      console.warn('[Sokuji][ProviderSpecificSettings] Unsupported provider:', commonSettings.provider);
    }
  };

  // Helper function to check if current provider is OpenAI-compatible
  const isCurrentProviderOpenAICompatible = () => {
    return isOpenAICompatible(commonSettings.provider);
  };

  // Helper function to get OpenAI-compatible settings
  const getOpenAICompatibleSettings = () => {
    if (commonSettings.provider === Provider.OPENAI) {
      return openAISettings;
    } else if (commonSettings.provider === Provider.COMET_API) {
      return cometAPISettings;
    }
    return null;
  };

  // Helper function to update OpenAI-compatible settings
  const updateOpenAICompatibleSettings = (updates: any) => {
    if (commonSettings.provider === Provider.OPENAI) {
      updateOpenAISettings(updates);
    } else if (commonSettings.provider === Provider.COMET_API) {
      updateCometAPISettings(updates);
    }
  };

  const renderLanguageSelections = () => {
    if (!config.capabilities.hasTemplateMode || !commonSettings.useTemplateMode) {
      return null;
    }

    const currentSettings = currentProviderSettings as any; // Cast to access sourceLanguage/targetLanguage
    
    return (
      <>
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.sourceLanguage')}</span>
          </div>
          <select
            className="select-dropdown"
            value={currentSettings.sourceLanguage}
            onChange={(e) => {
              const newSourceLang = e.target.value;
              // If new source language is the same as current target language,
              // we need to update target language to avoid conflict
              if (newSourceLang === currentSettings.targetLanguage) {
                // Find the first available language that's not the new source language
                const newTargetLang = config.languages.find(lang => 
                  lang.value !== newSourceLang
                )?.value || config.defaults.targetLanguage;
                
                updateCurrentProviderSetting('sourceLanguage', newSourceLang);
                updateCurrentProviderSetting('targetLanguage', newTargetLang);
              } else {
                updateCurrentProviderSetting('sourceLanguage', newSourceLang);
              }
            }}
            disabled={isSessionActive}
          >
            {config.languages.map((lang) => (
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
            value={currentSettings.targetLanguage}
            onChange={(e) => updateCurrentProviderSetting('targetLanguage', e.target.value)}
            disabled={isSessionActive}
          >
            {config.languages
              .filter(lang => lang.value !== currentSettings.sourceLanguage)
              .map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
          </select>
        </div>
      </>
    );
  };

  const renderVoiceSettings = () => {
    if (!config.capabilities.hasVoiceSettings) {
      return null;
    }

    return (
      <div className="settings-section voice-settings-section">
        <h2>{t('settings.voice')}</h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={currentProviderSettings.voice}
            onChange={(e) => updateCurrentProviderSetting('voice', e.target.value)}
            disabled={isSessionActive}
          >
            {config.voices.map((voice) => (
              <option key={voice.value} value={voice.value}>{voice.name}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const renderTurnDetectionSettings = () => {
    if (!config.capabilities.hasTurnDetection) {
      return null;
    }

    const { turnDetection } = config.capabilities;
    
    // Turn detection is OpenAI-compatible (OpenAI and CometAPI)
    if (!isCurrentProviderOpenAICompatible()) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleSettings();

    return (
      <div className="settings-section turn-detection-section">
        <h2>{t('settings.automaticTurnDetection')}</h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            {turnDetection.modes.map((mode) => (
              <button 
                key={mode}
                className={`option-button ${compatibleSettings?.turnDetectionMode === mode ? 'active' : ''}`}
                onClick={() => updateOpenAICompatibleSettings({ turnDetectionMode: mode as 'Normal' | 'Semantic' | 'Disabled' })}
                disabled={isSessionActive}
              >
                {t(`settings.${mode.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {compatibleSettings?.turnDetectionMode === 'Normal' && turnDetection.hasThreshold && (
          <>
            <div className="setting-item">
              <div className="setting-label">
                <span>{t('settings.threshold')}</span>
                <span className="setting-value">{compatibleSettings?.threshold.toFixed(2)}</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01" 
                value={compatibleSettings?.threshold || 0}
                onChange={(e) => updateOpenAICompatibleSettings({ threshold: parseFloat(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>
            {turnDetection.hasPrefixPadding && (
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.prefixPadding')}</span>
                  <span className="setting-value">{compatibleSettings?.prefixPadding.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={compatibleSettings?.prefixPadding || 0}
                  onChange={(e) => updateOpenAICompatibleSettings({ prefixPadding: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
            )}
            {turnDetection.hasSilenceDuration && (
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.silenceDuration')}</span>
                  <span className="setting-value">{compatibleSettings?.silenceDuration.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={compatibleSettings?.silenceDuration || 0}
                  onChange={(e) => updateOpenAICompatibleSettings({ silenceDuration: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
            )}
          </>
        )}

        {compatibleSettings?.turnDetectionMode === 'Semantic' && turnDetection.hasSemanticEagerness && (
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.eagerness')}</span>
            </div>
            <select 
              className="select-dropdown"
              value={compatibleSettings?.semanticEagerness}
              onChange={(e) => updateOpenAICompatibleSettings({ semanticEagerness: e.target.value as 'Auto' | 'Low' | 'Medium' | 'High' })}
              disabled={isSessionActive}
            >
              <option value="Auto">{t('settings.auto')}</option>
              <option value="Low">{t('settings.low')}</option>
              <option value="Medium">{t('settings.medium')}</option>
              <option value="High">{t('settings.high')}</option>
            </select>
          </div>
        )}
      </div>
    );
  };

  const renderModelSettings = () => {
    // Use available models from API if available, fallback to config models
    const modelsToUse = availableModels.length > 0 ? 
      availableModels.filter(model => model.type === 'realtime') : 
      config.models.filter(model => model.type === 'realtime');

    const handleRefreshModels = async () => {
      try {
        await fetchAvailableModels();
      } catch (error) {
        console.error('[Sokuji][ProviderSpecificSettings] Error refreshing models:', error);
      }
    };

    return (
      <div className="settings-section">
        <h2>{t('settings.model')}</h2>
        <div className="setting-item">
          <div className="model-selection-container">
            <select
              className="select-dropdown"
              value={currentProviderSettings.model}
              onChange={(e) => updateCurrentProviderSetting('model', e.target.value)}
              disabled={isSessionActive}
            >
              {modelsToUse.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
            <button
              className="refresh-models-button"
              onClick={handleRefreshModels}
              disabled={isSessionActive || loadingModels}
              title={t('settings.refreshModels', 'Refresh available models')}
            >
              <span className={loadingModels ? 'loading' : ''}>
                <RotateCw size={16} />
              </span>
            </button>
          </div>
          {loadingModels && (
            <div className="loading-status">
              {t('settings.loadingModels', 'Loading available models...')}
            </div>
          )}
          {availableModels.length > 0 && !loadingModels && (
            <div className="models-info">
              {t('settings.modelsFound', 'Found {{count}} available models', { count: modelsToUse.length })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNoiseReductionSettings = () => {
    if (!config.capabilities.hasNoiseReduction || config.noiseReductionModes.length === 0) {
      return null;
    }

    // Noise reduction is OpenAI-compatible (OpenAI and CometAPI)
    if (!isCurrentProviderOpenAICompatible()) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleSettings();

    return (
      <div className="settings-section">
        <h2>{t('settings.noiseReduction')}</h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={compatibleSettings?.noiseReduction}
            onChange={(e) => updateOpenAICompatibleSettings({ noiseReduction: e.target.value as 'None' | 'Near field' | 'Far field' })}
            disabled={isSessionActive}
          >
            {config.noiseReductionModes.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const renderTranscriptSettings = () => {
    if (config.transcriptModels.length === 0) {
      return null;
    }

    // Transcript model is OpenAI-compatible (OpenAI and CometAPI)
    if (!isCurrentProviderOpenAICompatible()) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleSettings();

    return (
      <div className="settings-section">
        <h2>{t('settings.userTranscriptModel')}</h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={compatibleSettings?.transcriptModel}
            onChange={(e) => updateOpenAICompatibleSettings({ transcriptModel: e.target.value as 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1' })}
            disabled={isSessionActive}
          >
            {config.transcriptModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const renderModelConfigurationSettings = () => {
    if (!config.capabilities.hasModelConfiguration) {
      return null;
    }

    const { temperatureRange, maxTokensRange } = config.capabilities;

    return (
      <div className="settings-section">
        <h2>{t('settings.modelConfiguration')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.temperature')}</span>
            <span className="setting-value">{currentProviderSettings.temperature.toFixed(2)}</span>
          </div>
          <input 
            type="range" 
            min={temperatureRange.min} 
            max={temperatureRange.max} 
            step={temperatureRange.step} 
            value={currentProviderSettings.temperature}
            onChange={(e) => updateCurrentProviderSetting('temperature', parseFloat(e.target.value))}
            className="slider"
            disabled={isSessionActive}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.maxTokens')}</span>
            <span className="setting-value">{currentProviderSettings.maxTokens}</span>
          </div>
          <input 
            type="range" 
            min={maxTokensRange.min} 
            max={maxTokensRange.max} 
            step={maxTokensRange.step} 
            value={typeof currentProviderSettings.maxTokens === 'number' ? currentProviderSettings.maxTokens : maxTokensRange.max}
            onChange={(e) => updateCurrentProviderSetting('maxTokens', parseInt(e.target.value))}
            className="slider"
            disabled={isSessionActive}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      {/* System Instructions */}
      {config.capabilities.hasTemplateMode && (
        <div className="settings-section system-instructions-section">
          <h2>{t('settings.systemInstructions')}</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${commonSettings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateCommonSettings({ useTemplateMode: true })}
                disabled={isSessionActive}
              >
                {t('settings.simple')}
              </button>
              <button 
                className={`option-button ${!commonSettings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateCommonSettings({ useTemplateMode: false })}
                disabled={isSessionActive}
              >
                {t('settings.advanced')}
              </button>
            </div>
          </div>
          
          {commonSettings.useTemplateMode ? (
            <>
              {renderLanguageSelections()}
              <div className="setting-item">
                <div className="setting-label">
                  <span>{t('settings.preview')}</span>
                  <div className="preview-toggle" onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}>
                    {isPreviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </div>
                {isPreviewExpanded && (
                  <div className="system-instructions-preview">
                    <div className="preview-content">
                      {getProcessedSystemInstructions()}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="setting-item">
              <textarea 
                className="system-instructions" 
                placeholder={t('settings.enterCustomInstructions')}
                value={commonSettings.systemInstructions}
                onChange={(e) => updateCommonSettings({ systemInstructions: e.target.value })}
                disabled={isSessionActive}
              />
            </div>
          )}
        </div>
      )}

      {/* Provider-specific settings */}
      {renderVoiceSettings()}
      {renderTurnDetectionSettings()}
      {renderModelSettings()}
      {renderTranscriptSettings()}
      {renderNoiseReductionSettings()}
      {renderModelConfigurationSettings()}
    </Fragment>
  );
};

export default ProviderSpecificSettings; 
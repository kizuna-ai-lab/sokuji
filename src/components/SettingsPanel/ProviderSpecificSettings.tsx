import React, { Fragment } from 'react';
import { ProviderConfig } from '../../services/providers/ProviderConfig';
import { useSettings, VoiceOption, TurnDetectionMode, SemanticEagerness, NoiseReductionMode, TranscriptModel, Model } from '../../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'react-feather';

interface ProviderSpecificSettingsProps {
  config: ProviderConfig;
  isSessionActive: boolean;
  isPreviewExpanded: boolean;
  setIsPreviewExpanded: (expanded: boolean) => void;
  getProcessedSystemInstructions: () => string;
}

const ProviderSpecificSettings: React.FC<ProviderSpecificSettingsProps> = ({
  config,
  isSessionActive,
  isPreviewExpanded,
  setIsPreviewExpanded,
  getProcessedSystemInstructions
}) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation();

  const renderLanguageSelections = () => {
    if (!config.capabilities.hasTemplateMode || !settings.useTemplateMode) {
      return null;
    }

    return (
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
                const newTargetLang = config.languages.find(lang => 
                  lang.value !== newSourceLang
                )?.value || config.defaults.targetLanguage;
                
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
            value={settings.targetLanguage}
            onChange={(e) => updateSettings({ targetLanguage: e.target.value })}
            disabled={isSessionActive}
          >
            {config.languages
              .filter(lang => lang.value !== settings.sourceLanguage)
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
            value={settings.voice}
            onChange={(e) => updateSettings({ voice: e.target.value as VoiceOption })}
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

    return (
      <div className="settings-section turn-detection-section">
        <h2>{t('settings.automaticTurnDetection')}</h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            {turnDetection.modes.map((mode) => (
              <button 
                key={mode}
                className={`option-button ${settings.turnDetectionMode === mode ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: mode as TurnDetectionMode })}
                disabled={isSessionActive}
              >
                {t(`settings.${mode.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        {settings.turnDetectionMode === 'Normal' && turnDetection.hasThreshold && (
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
            {turnDetection.hasPrefixPadding && (
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
            )}
            {turnDetection.hasSilenceDuration && (
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
            )}
          </>
        )}

        {settings.turnDetectionMode === 'Semantic' && turnDetection.hasSemanticEagerness && (
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
    );
  };

  const renderModelSettings = () => {
    return (
      <div className="settings-section">
        <h2>{t('settings.model')}</h2>
        <div className="setting-item">
          <select
            className="select-dropdown"
            value={settings.model}
            onChange={(e) => updateSettings({ model: e.target.value as Model })}
            disabled={isSessionActive}
          >
            {config.models
              .filter(model => model.type === 'realtime')
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
          </select>
        </div>
      </div>
    );
  };

  const renderNoiseReductionSettings = () => {
    if (!config.capabilities.hasNoiseReduction || config.noiseReductionModes.length === 0) {
      return null;
    }

    return (
      <div className="settings-section">
        <h2>{t('settings.noiseReduction')}</h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={settings.noiseReduction}
            onChange={(e) => updateSettings({ noiseReduction: e.target.value as NoiseReductionMode })}
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

    return (
      <div className="settings-section">
        <h2>{t('settings.userTranscriptModel')}</h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={settings.transcriptModel}
            onChange={(e) => updateSettings({ transcriptModel: e.target.value as TranscriptModel })}
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
            <span className="setting-value">{settings.temperature.toFixed(2)}</span>
          </div>
          <input 
            type="range" 
            min={temperatureRange.min} 
            max={temperatureRange.max} 
            step={temperatureRange.step} 
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
            min={maxTokensRange.min} 
            max={maxTokensRange.max} 
            step={maxTokensRange.step} 
            value={typeof settings.maxTokens === 'number' ? settings.maxTokens : maxTokensRange.max}
            onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })}
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
                value={settings.systemInstructions}
                onChange={(e) => updateSettings({ systemInstructions: e.target.value })}
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
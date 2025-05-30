import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Check, AlertCircle, AlertTriangle, Info, Key } from 'react-feather';
import './SettingsPanel.scss';
import { useSettings, VoiceOption, TurnDetectionMode, SemanticEagerness, NoiseReductionMode, TranscriptModel, Model } from '../../contexts/SettingsContext';

// Language options with native names and English values
const languageOptions = [
  { name: 'English', value: 'English' },
  { name: '中文', value: 'Chinese' },
  { name: '日本語', value: 'Japanese' },
  { name: '한국어', value: 'Korean' },
  { name: 'Español', value: 'Spanish' },
  { name: 'Français', value: 'French' },
  { name: 'Deutsch', value: 'German' },
  { name: 'Italiano', value: 'Italian' },
  { name: 'Português', value: 'Portuguese' },
  { name: 'Русский', value: 'Russian' },
  { name: 'العربية', value: 'Arabic' },
  { name: 'हिन्दी', value: 'Hindi' },
  { name: 'Tiếng Việt', value: 'Vietnamese' },
  { name: 'ไทย', value: 'Thai' },
  { name: 'Nederlands', value: 'Dutch' },
  { name: 'Svenska', value: 'Swedish' },
  { name: 'Polski', value: 'Polish' },
  { name: 'Türkçe', value: 'Turkish' },
];

interface SettingsPanelProps {
  toggleSettings?: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ toggleSettings }) => {
  const { settings, updateSettings, validateApiKey: contextValidateApiKey, getProcessedSystemInstructions } = useSettings();

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
      setSaveStatus({ type: 'success', message: 'Settings saved successfully' });
    } else if (successCount > 0) {
      setSaveStatus({ type: 'warning', message: `Saved ${successCount} settings, ${failCount} failed` });
    } else {
      setSaveStatus({ type: 'error', message: 'Failed to save settings' });
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
      message: 'Validating API key...',
      validating: true
    });
    
    const result = await contextValidateApiKey();
    setApiKeyStatus({
      valid: result.valid === true,
      message: result.message,
      validating: false
    });
    
    return result.valid === true;
  };

  // Runtime array of voice options
  const voiceOptions: VoiceOption[] = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'
  ];

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2>Settings</h2>
        <div className="header-actions">
          <button 
            className="save-all-button"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save size={16} />
            <span>{isSaving ? 'Saving...' : 'Save'}</span>
          </button>
          
          {renderStatusIcon()}
          
          <button className="close-settings-button" onClick={toggleSettings}>
            <ArrowRight size={16} />
            <span>Close</span>
          </button>
        </div>
      </div>
      <div className="settings-content">
        <div className="settings-section">
          <h2>OpenAI API Key</h2>
          <div className="setting-item">
            <div className="api-key-container">
              <input
                value={settings.openAIApiKey}
                onChange={(e) => {
                  updateSettings({ openAIApiKey: e.target.value });
                  // Reset validation status when key changes
                  setApiKeyStatus({ valid: null, message: '', validating: false });
                }}
                placeholder="Enter your OpenAI API key"
                className={`text-input api-key-input ${
                  apiKeyStatus.valid === true ? 'valid' : 
                  apiKeyStatus.valid === false ? 'invalid' : ''
                }`}
              />
              <button 
                className="validate-key-button"
                onClick={handleValidateApiKey}
                disabled={apiKeyStatus.validating || !settings.openAIApiKey}
              >
                <Key size={16} />
                <span>{apiKeyStatus.validating ? 'Validating...' : 'Validate'}</span>
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
          <h2>System Instructions</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${settings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateSettings({ useTemplateMode: true })}
              >
                Simple
              </button>
              <button 
                className={`option-button ${!settings.useTemplateMode ? 'active' : ''}`}
                onClick={() => updateSettings({ useTemplateMode: false })}
              >
                Advanced
              </button>
            </div>
          </div>
          
          {settings.useTemplateMode ? (
            <>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Source Language</span>
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
                >
                  {languageOptions
                    .map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.name}</option>
                    ))}
                </select>
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Target Language</span>
                </div>
                <select
                  className="select-dropdown"
                  value={settings.targetLanguage}
                  onChange={(e) => updateSettings({ targetLanguage: e.target.value })}
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
                  <h4>Preview:</h4>
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
                placeholder="Enter custom system instructions here..."
                value={settings.systemInstructions}
                onChange={(e) => updateSettings({ systemInstructions: e.target.value })}
              />
            </div>
          )}
        </div>
        <div className="settings-section">
          <h2>Voice</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.voice}
              onChange={(e) => updateSettings({ voice: e.target.value as VoiceOption })}
            >
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>Automatic turn detection</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Normal' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Normal' as TurnDetectionMode })}
              >
                Normal
              </button>
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Semantic' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Semantic' as TurnDetectionMode })}
              >
                Semantic
              </button>
              <button 
                className={`option-button ${settings.turnDetectionMode === 'Disabled' ? 'active' : ''}`}
                onClick={() => updateSettings({ turnDetectionMode: 'Disabled' as TurnDetectionMode })}
              >
                Disabled
              </button>
            </div>
          </div>

          {settings.turnDetectionMode === 'Normal' && (
            <>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Threshold</span>
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
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Prefix padding</span>
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
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Silence duration</span>
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
                />
              </div>
            </>
          )}

          {settings.turnDetectionMode === 'Semantic' && (
            <div className="setting-item">
              <div className="setting-label">
                <span>Eagerness</span>
              </div>
              <select 
                className="select-dropdown"
                value={settings.semanticEagerness}
                onChange={(e) => updateSettings({ semanticEagerness: e.target.value as SemanticEagerness })}
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
          <h2>Model</h2>
          <div className="setting-item">
            <select
              className="select-dropdown"
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value as Model })}
            >
              <option value="gpt-4o-realtime-preview">gpt-4o-realtime-preview</option>
              <option value="gpt-4o-mini-realtime-preview">gpt-4o-mini-realtime-preview</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>User transcript model</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.transcriptModel}
              onChange={(e) => updateSettings({ transcriptModel: e.target.value as TranscriptModel })}
            >
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
              <option value="whisper-1">whisper-1</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>Noise reduction</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={settings.noiseReduction}
              onChange={(e) => updateSettings({ noiseReduction: e.target.value as NoiseReductionMode })}
            >
              <option value="None">None</option>
              <option value="Near field">Near field</option>
              <option value="Far field">Far field</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>Model configuration</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>Temperature</span>
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
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>Max tokens</span>
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
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

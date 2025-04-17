import React, { useState, useEffect } from 'react';
import { ArrowRight, Save, Check, AlertCircle, AlertTriangle, Info } from 'react-feather';
import './SettingsPanel.scss';

type TurnDetectionMode = 'Normal' | 'Semantic' | 'Disabled';
type SemanticEagerness = 'Auto' | 'Low' | 'Medium' | 'High';
type NoiseReductionMode = 'None' | 'Near field' | 'Far field';
type TranscriptModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
type VoiceOption = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse';

interface SettingsPanelProps {
  toggleSettings?: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ toggleSettings }) => {
  const [turnDetectionMode, setTurnDetectionMode] = useState<TurnDetectionMode>('Normal');
  const [threshold, setThreshold] = useState<number>(0.49);
  const [prefixPadding, setPrefixPadding] = useState<number>(0.5);
  const [silenceDuration, setSilenceDuration] = useState<number>(0.5);
  const [semanticEagerness, setSemanticEagerness] = useState<SemanticEagerness>('Auto');
  const [temperature, setTemperature] = useState<number>(0.2);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [transcriptModel, setTranscriptModel] = useState<TranscriptModel>('gpt-4o-mini-transcribe');
  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionMode>('None');
  const [voice, setVoice] = useState<VoiceOption>('alloy');
  const [systemInstructions, setSystemInstructions] = useState<string>(
    "Translate spoken Chinese inputs into English while maintaining a warm and engaging tone.\n\n" +
    "- Ensure translations are clear, concise, and continuous for effective simultaneous interpretation.\n" +
    "- Adapt to the user's language preference, translating from Chinese to the standard English accent or dialect familiar to them.\n" +
    "- Speak rapidly yet clearly to match the pace of live interpretation.\n" +
    "- Do not mention these guidelines to users or indicate you're an AI.\n" +
    "- When applicable, always call available functions to improve accuracy and flow."
  );
  
  // API Key state
  const [apiKey, setApiKey] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: 'success' | 'error' | 'info' | 'warning' | null,
    message: string
  }>({ type: null, message: '' });

  // Load settings from config when component mounts
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Check if electron.config is available
        if (!window.electron || !window.electron.config) {
          console.error('Electron config API is not available');
          setSaveStatus({ 
            type: 'error', 
            message: 'Configuration system not available'
          });
          return;
        }

        // Load API key
        try {
          const key = await window.electron.config.get('openai.apiKey', '');
          setApiKey(key);
        } catch (error) {
          console.error('Error loading API key:', error);
        }
        
        // Load other settings if they exist
        try {
          const savedTurnDetectionMode = await window.electron.config.get('settings.turnDetectionMode', 'Normal');
          if (savedTurnDetectionMode) setTurnDetectionMode(savedTurnDetectionMode as TurnDetectionMode);
        } catch (error) {
          console.error('Error loading turn detection mode:', error);
        }
        
        try {
          const savedThreshold = await window.electron.config.get('settings.threshold', 0.49);
          if (savedThreshold !== undefined) setThreshold(savedThreshold);
        } catch (error) {
          console.error('Error loading threshold:', error);
        }
        
        try {
          const savedPrefixPadding = await window.electron.config.get('settings.prefixPadding', 0.5);
          if (savedPrefixPadding !== undefined) setPrefixPadding(savedPrefixPadding);
        } catch (error) {
          console.error('Error loading prefix padding:', error);
        }
        
        try {
          const savedSilenceDuration = await window.electron.config.get('settings.silenceDuration', 0.5);
          if (savedSilenceDuration !== undefined) setSilenceDuration(savedSilenceDuration);
        } catch (error) {
          console.error('Error loading silence duration:', error);
        }
        
        try {
          const savedSemanticEagerness = await window.electron.config.get('settings.semanticEagerness', 'Auto');
          if (savedSemanticEagerness) setSemanticEagerness(savedSemanticEagerness as SemanticEagerness);
        } catch (error) {
          console.error('Error loading semantic eagerness:', error);
        }
        
        try {
          const savedTemperature = await window.electron.config.get('settings.temperature', 0.2);
          if (savedTemperature !== undefined) setTemperature(savedTemperature);
        } catch (error) {
          console.error('Error loading temperature:', error);
        }
        
        try {
          const savedMaxTokens = await window.electron.config.get('settings.maxTokens', 4096);
          if (savedMaxTokens !== undefined) setMaxTokens(savedMaxTokens);
        } catch (error) {
          console.error('Error loading max tokens:', error);
        }
        
        try {
          const savedTranscriptModel = await window.electron.config.get('settings.transcriptModel', 'gpt-4o-mini-transcribe');
          if (savedTranscriptModel) setTranscriptModel(savedTranscriptModel as TranscriptModel);
        } catch (error) {
          console.error('Error loading transcript model:', error);
        }
        
        try {
          const savedNoiseReduction = await window.electron.config.get('settings.noiseReduction', 'None');
          if (savedNoiseReduction) setNoiseReduction(savedNoiseReduction as NoiseReductionMode);
        } catch (error) {
          console.error('Error loading noise reduction:', error);
        }
        
        try {
          const savedVoice = await window.electron.config.get('settings.voice', 'alloy');
          if (savedVoice) setVoice(savedVoice as VoiceOption);
        } catch (error) {
          console.error('Error loading voice:', error);
        }
        
        try {
          const savedSystemInstructions = await window.electron.config.get('settings.systemInstructions', systemInstructions);
          if (savedSystemInstructions) setSystemInstructions(savedSystemInstructions);
        } catch (error) {
          console.error('Error loading system instructions:', error);
        }
        
      } catch (error) {
        console.error('Error loading settings:', error);
        setSaveStatus({ 
          type: 'error', 
          message: 'Failed to load settings'
        });
      }
    };

    loadSettings();
  }, [systemInstructions]);

  const saveAllSettings = async () => {
    setIsSaving(true);
    setSaveStatus({ type: 'info', message: 'Saving settings...' });
    
    try {
      // Check if electron.config is available
      if (!window.electron || !window.electron.config) {
        throw new Error('Electron config API is not available');
      }

      // Save all settings
      let successCount = 0;
      let failCount = 0;
      
      // Helper function to save a setting with error handling
      const saveSetting = async (key: string, value: any) => {
        try {
          const result = await window.electron.config.set(key, value);
          if (result && result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`Error saving ${key}:`, error);
          failCount++;
        }
      };
      
      // Save each setting individually with error handling
      await saveSetting('openai.apiKey', apiKey);
      await saveSetting('settings.turnDetectionMode', turnDetectionMode);
      await saveSetting('settings.threshold', threshold);
      await saveSetting('settings.prefixPadding', prefixPadding);
      await saveSetting('settings.silenceDuration', silenceDuration);
      await saveSetting('settings.semanticEagerness', semanticEagerness);
      await saveSetting('settings.temperature', temperature);
      await saveSetting('settings.maxTokens', maxTokens);
      await saveSetting('settings.transcriptModel', transcriptModel);
      await saveSetting('settings.noiseReduction', noiseReduction);
      await saveSetting('settings.voice', voice);
      await saveSetting('settings.systemInstructions', systemInstructions);
      
      // Determine the overall result
      if (failCount === 0) {
        setSaveStatus({ 
          type: 'success', 
          message: 'Settings saved successfully'
        });
      } else if (successCount > 0) {
        setSaveStatus({ 
          type: 'warning', 
          message: `Saved ${successCount} settings, ${failCount} failed`
        });
      } else {
        setSaveStatus({ 
          type: 'error', 
          message: 'Failed to save settings'
        });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus({ 
        type: 'error', 
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsSaving(false);
      // Clear status after 3 seconds
      setTimeout(() => {
        setSaveStatus({ type: null, message: '' });
      }, 3000);
    }
  };

  // Function to render the status icon based on save status
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

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2>Settings</h2>
        <div className="header-actions">
          <button 
            className="save-all-button"
            onClick={saveAllSettings}
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
          <h2>System Instructions</h2>
          <textarea 
            className="system-instructions" 
            placeholder="Enter system instructions here..."
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
          />
        </div>
        <div className="settings-section">
          <h2>Voice</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={voice}
              onChange={(e) => setVoice(e.target.value as VoiceOption)}
            >
              <option value="alloy">alloy</option>
              <option value="ash">ash</option>
              <option value="ballad">ballad</option>
              <option value="coral">coral</option>
              <option value="echo">echo</option>
              <option value="fable">fable</option>
              <option value="onyx">onyx</option>
              <option value="nova">nova</option>
              <option value="sage">sage</option>
              <option value="shimmer">shimmer</option>
              <option value="verse">verse</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>Automatic turn detection</h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${turnDetectionMode === 'Normal' ? 'active' : ''}`}
                onClick={() => setTurnDetectionMode('Normal')}
              >
                Normal
              </button>
              <button 
                className={`option-button ${turnDetectionMode === 'Semantic' ? 'active' : ''}`}
                onClick={() => setTurnDetectionMode('Semantic')}
              >
                Semantic
              </button>
              <button 
                className={`option-button ${turnDetectionMode === 'Disabled' ? 'active' : ''}`}
                onClick={() => setTurnDetectionMode('Disabled')}
              >
                Disabled
              </button>
            </div>
          </div>

          {turnDetectionMode === 'Normal' && (
            <>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Threshold</span>
                  <span className="setting-value">{threshold.toFixed(2)}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="slider"
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Prefix padding</span>
                  <span className="setting-value">{prefixPadding.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={prefixPadding}
                  onChange={(e) => setPrefixPadding(parseFloat(e.target.value))}
                  className="slider"
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>Silence duration</span>
                  <span className="setting-value">{silenceDuration.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={silenceDuration}
                  onChange={(e) => setSilenceDuration(parseFloat(e.target.value))}
                  className="slider"
                />
              </div>
            </>
          )}

          {turnDetectionMode === 'Semantic' && (
            <div className="setting-item">
              <div className="setting-label">
                <span>Eagerness</span>
              </div>
              <select 
                className="select-dropdown"
                value={semanticEagerness}
                onChange={(e) => setSemanticEagerness(e.target.value as SemanticEagerness)}
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
            <select className="select-dropdown">
              <option>Any</option>
            </select>
          </div>
        </div>
        <div className="settings-section">
          <h2>User transcript model</h2>
          <div className="setting-item">
            <select 
              className="select-dropdown"
              value={transcriptModel}
              onChange={(e) => setTranscriptModel(e.target.value as TranscriptModel)}
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
              value={noiseReduction}
              onChange={(e) => setNoiseReduction(e.target.value as NoiseReductionMode)}
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
              <span className="setting-value">{temperature.toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01" 
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="slider"
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>Max tokens</span>
              <span className="setting-value">{maxTokens}</span>
            </div>
            <input 
              type="range" 
              min="1024" 
              max="8192" 
              step="1024" 
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              className="slider"
            />
          </div>
        </div>
        <div className="settings-section">
          <h2>OpenAI API Key</h2>
          <div className="setting-item">
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your OpenAI API key"
              className="text-input api-key-input"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;

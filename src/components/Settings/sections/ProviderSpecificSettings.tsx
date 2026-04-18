import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { VolcengineSTProviderConfig } from '../../../services/providers/VolcengineSTProviderConfig';
import { VolcengineAST2ProviderConfig } from '../../../services/providers/VolcengineAST2ProviderConfig';
import {
  useProvider,
  useSystemInstructions,
  useTemplateSystemInstructions,
  useUseTemplateMode,
  useParticipantSystemInstructions,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useLocalInferenceSettings,
  useSetSystemInstructions,
  useSetTemplateSystemInstructions,
  useSetUseTemplateMode,
  useSetParticipantSystemInstructions,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateKizunaAI,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useUpdateLocalInference,
  useGetCurrentProviderSettings,
  TransportType
} from '../../../stores/settingsStore';
import { ClientFactory } from '../../../services/clients';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RotateCw, Info, CircleHelp, ExternalLink } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { FilteredModel } from '../../../services/interfaces/IClient';
import { Provider, isOpenAICompatible } from '../../../types/Provider';
import { getManifestByType, getManifestEntry, isTranslationModelCompatible, isAstCompatible, pickBestModel } from '../../../lib/local-inference/modelManifest';
import { useModelStatuses } from '../../../stores/modelStore';
import useLogStore from '../../../stores/logStore';
import { isElectron } from '../../../utils/environment';
import { ModelManagementSection } from './ModelManagementSection';
import { useAnalytics } from '../../../lib/analytics';
import { useAuth } from '../../../lib/auth/hooks';
import { getEdgeTtsVoices, filterVoicesByLanguage, getVoiceDisplayName } from '../../../lib/edge-tts/voiceList';
import type { Voice } from '../../../lib/edge-tts/edgeTts';

interface ProviderSpecificSettingsProps {
  config: ProviderConfig;
  isSessionActive: boolean;
  isPreviewExpanded: boolean;
  setIsPreviewExpanded: (expanded: boolean) => void;
  getProcessedSystemInstructions: () => string;
  availableModels: FilteredModel[];
  loadingModels: boolean;
  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
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
  const { getToken } = useAuth();
  // Settings from store
  const provider = useProvider();
  const systemInstructions = useSystemInstructions();
  const templateSystemInstructions = useTemplateSystemInstructions();
  const useTemplateMode = useUseTemplateMode();
  const participantSystemInstructions = useParticipantSystemInstructions();
  const openAISettings = useOpenAISettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const geminiSettings = useGeminiSettings();
  const palabraAISettings = usePalabraAISettings();
  const kizunaAISettings = useKizunaAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  const localInferenceSettings = useLocalInferenceSettings();
  const modelStatuses = useModelStatuses();

  // Actions from store
  const setSystemInstructions = useSetSystemInstructions();
  const setTemplateSystemInstructions = useSetTemplateSystemInstructions();
  const setUseTemplateMode = useSetUseTemplateMode();
  const setParticipantSystemInstructions = useSetParticipantSystemInstructions();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updateGeminiSettings = useUpdateGemini();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateKizunaAISettings = useUpdateKizunaAI();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const updateLocalInferenceSettings = useUpdateLocalInference();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  // Auto-select compatible models when LOCAL_INFERENCE languages change
  useEffect(() => {
    if (provider !== Provider.LOCAL_INFERENCE) return;

    const sourceLang = localInferenceSettings.sourceLanguage;
    const targetLang = localInferenceSettings.targetLanguage;
    const updates: Record<string, any> = {};

    // Auto-select ASR model (includes streaming models)
    const allAsr = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    const currentAsr = allAsr.find(m => m.id === localInferenceSettings.asrModel);
    if (!currentAsr || !(currentAsr.multilingual || currentAsr.languages.includes(sourceLang))) {
      const firstMatch = pickBestModel(allAsr.filter(m =>
        (m.multilingual || m.languages.includes(sourceLang)) && modelStatuses[m.id] === 'downloaded'
      ));
      updates.asrModel = firstMatch?.id || '';
    }

    // Auto-select TTS model
    const allTts = getManifestByType('tts');
    const currentTtsEntry = allTts.find(m => m.id === localInferenceSettings.ttsModel);
    if (!currentTtsEntry || (!currentTtsEntry.multilingual && !currentTtsEntry.languages.includes(targetLang))) {
      const firstMatch = pickBestModel(allTts.filter(m =>
        (m.multilingual || m.languages.includes(targetLang)) && (m.isCloudModel || modelStatuses[m.id] === 'downloaded')
      ));
      updates.ttsModel = firstMatch?.id || '';
      updates.ttsSpeakerId = 0;
    }

    // Auto-select translation model
    // AST short-circuit: if translation model === ASR model and it has astLanguages, it's valid
    const transModelId = localInferenceSettings.translationModel;
    const effectiveAsrId = updates.asrModel ?? localInferenceSettings.asrModel;
    const asrEntryForAst = transModelId && transModelId === effectiveAsrId
      ? getManifestEntry(transModelId) : null;
    const isAstValid = asrEntryForAst
      && isAstCompatible(asrEntryForAst, sourceLang, targetLang)
      && modelStatuses[transModelId] === 'downloaded';

    if (!isAstValid) {
      const allTranslation = getManifestByType('translation');
      const currentTransEntry = allTranslation.find(m => m.id === transModelId);
      const isCurrentTransCompatible = currentTransEntry && isTranslationModelCompatible(currentTransEntry, sourceLang, targetLang);
      if (!isCurrentTransCompatible) {
        const firstMatch = pickBestModel(allTranslation.filter(m =>
          isTranslationModelCompatible(m, sourceLang, targetLang) && modelStatuses[m.id] === 'downloaded'
        ));
        updates.translationModel = firstMatch?.id || '';
      }
    }

    if (Object.keys(updates).length > 0) {
      updateLocalInferenceSettings(updates);
    }
  }, [provider, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage, modelStatuses]);

  // Edge TTS voice picker state
  const [edgeTtsVoices, setEdgeTtsVoices] = useState<Voice[]>([]);
  const [edgeTtsVoiceStatus, setEdgeTtsVoiceStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [edgeTtsVoiceError, setEdgeTtsVoiceError] = useState<string | null>(null);
  const isEdgeTtsSelected = localInferenceSettings.ttsModel === 'edge-tts';

  useEffect(() => {
    if (!isEdgeTtsSelected) return;
    let cancelled = false;
    setEdgeTtsVoiceStatus('loading');
    setEdgeTtsVoiceError(null);
    getEdgeTtsVoices()
      .then(voices => {
        if (cancelled) return;
        setEdgeTtsVoices(voices);
        setEdgeTtsVoiceStatus('loaded');
      })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[EdgeTTS] Failed to fetch voice list:', err);
        useLogStore.getState().addLog(
          `Failed to fetch Edge TTS voice list: ${message}`,
          'error',
        );
        setEdgeTtsVoiceError(message);
        setEdgeTtsVoiceStatus('error');
      });
    return () => { cancelled = true; };
  }, [isEdgeTtsSelected]);

  const filteredVoices = useMemo(
    () => filterVoicesByLanguage(edgeTtsVoices, localInferenceSettings.targetLanguage),
    [edgeTtsVoices, localInferenceSettings.targetLanguage],
  );

  // Auto-select first voice when target language changes or no voice selected
  useEffect(() => {
    if (!isEdgeTtsSelected || filteredVoices.length === 0) return;
    const currentVoice = localInferenceSettings.edgeTtsVoice;
    const isCurrentValid = filteredVoices.some(v => v.ShortName === currentVoice);
    if (!isCurrentValid) {
      updateLocalInferenceSettings({ edgeTtsVoice: filteredVoices[0].ShortName });
    }
  }, [isEdgeTtsSelected, filteredVoices, localInferenceSettings.edgeTtsVoice, updateLocalInferenceSettings]);

  // Get current provider's settings
  const currentProviderSettings = getCurrentProviderSettings();

  // Helper functions to update current provider's settings
  const updateCurrentProviderSetting = (key: string, value: any) => {
    if (provider === Provider.OPENAI) {
      updateOpenAISettings({ [key]: value });
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      updateOpenAICompatibleSettings({ [key]: value });
    } else if (provider === Provider.KIZUNA_AI) {
      updateKizunaAISettings({ [key]: value });
    } else if (provider === Provider.GEMINI) {
      updateGeminiSettings({ [key]: value });
    } else if (provider === Provider.PALABRA_AI) {
      updatePalabraAISettings({ [key]: value });
    } else if (provider === Provider.VOLCENGINE_ST) {
      updateVolcengineSTSettings({ [key]: value });
    } else if (provider === Provider.VOLCENGINE_AST2) {
      updateVolcengineAST2Settings({ [key]: value });
    } else if (provider === Provider.LOCAL_INFERENCE) {
      updateLocalInferenceSettings({ [key]: value });
    } else {
      console.warn('[Sokuji][ProviderSpecificSettings] Unsupported provider:', provider);
    }
  };

  // Helper function to check if current provider is OpenAI-compatible
  const isCurrentProviderOpenAICompatible = () => {
    return isOpenAICompatible(provider);
  };

  // Helper function to get OpenAI-compatible settings
  const getOpenAICompatibleSettings = () => {
    if (provider === Provider.OPENAI) {
      return openAISettings;
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      return openAICompatibleSettings;
    } else if (provider === Provider.KIZUNA_AI) {
      return kizunaAISettings;
    }
    return null;
  };

  // Helper function to update OpenAI-compatible settings
  const updateOpenAICompatibleSettingsHelper = (updates: any) => {
    if (provider === Provider.OPENAI) {
      updateOpenAISettings(updates);
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      updateOpenAICompatibleSettings(updates);
    } else if (provider === Provider.KIZUNA_AI) {
      updateKizunaAISettings(updates);
    }
  };

  const renderVoiceSettings = () => {
    if (!config.capabilities.hasVoiceSettings || provider === Provider.PALABRA_AI) {
      return null;
    }

    return (
      <div className="settings-section voice-settings-section" id="voice-settings-section">
        <h2>
          {t('settings.voice')}
          <Tooltip
            content={t('settings.voiceTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <select 
            className="select-dropdown"
            value={(currentProviderSettings as any).voice}
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

    // Check if WebRTC mode is active - server VAD causes audio truncation in WebRTC
    const isWebRTCMode = compatibleSettings?.transportType === 'webrtc';

    return (
      <div className="settings-section turn-detection-section" id="turn-detection-section">
        <h2>
          {t('settings.automaticTurnDetection')}
          <Tooltip
            content={t('settings.turnDetectionTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            {turnDetection.modes.map((mode) => {
              // In WebRTC mode, Normal and Semantic VAD modes cause audio truncation
              const isVADMode = mode === 'Normal' || mode === 'Semantic';
              const isDisabled = isSessionActive || (isWebRTCMode && isVADMode);

              return (
                <button
                  key={mode}
                  className={`option-button ${compatibleSettings?.turnDetectionMode === mode ? 'active' : ''}`}
                  onClick={() => updateOpenAICompatibleSettingsHelper({ turnDetectionMode: mode as 'Normal' | 'Semantic' | 'Disabled' })}
                  disabled={isDisabled}
                  title={isWebRTCMode && isVADMode ? t('settings.webrtcVadDisabledTitle', 'Server VAD is not available in WebRTC mode') : undefined}
                >
                  {t(`settings.${mode.toLowerCase()}`)}
                </button>
              );
            })}
          </div>
          {isWebRTCMode && (
            <div className="webrtc-vad-notice" style={{
              marginTop: '8px',
              padding: '8px 12px',
              backgroundColor: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.3)',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#ffc107'
            }}>
              <Info size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
              {t('settings.webrtcVadNotice', 'Server VAD is disabled in WebRTC mode. The server automatically truncates audio when it detects speech, which interrupts translations.')}
            </div>
          )}
        </div>

        {compatibleSettings?.turnDetectionMode === 'Normal' && turnDetection.hasThreshold && (
          <>
            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.threshold')}
                  <Tooltip
                    content={t('settings.thresholdTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
                <span className="setting-value">{compatibleSettings?.threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={compatibleSettings?.threshold || 0}
                onChange={(e) => updateOpenAICompatibleSettingsHelper({ threshold: parseFloat(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>
            {turnDetection.hasPrefixPadding && (
              <div className="setting-item">
                <div className="setting-label">
                  <span>
                    {t('settings.prefixPadding')}
                    <Tooltip
                      content={t('settings.prefixPaddingTooltip')}
                      position="top"
                    >
                      <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                    </Tooltip>
                  </span>
                  <span className="setting-value">{compatibleSettings?.prefixPadding.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={compatibleSettings?.prefixPadding || 0}
                  onChange={(e) => updateOpenAICompatibleSettingsHelper({ prefixPadding: parseFloat(e.target.value) })}
                  className="slider"
                  disabled={isSessionActive}
                />
              </div>
            )}
            {turnDetection.hasSilenceDuration && (
              <div className="setting-item">
                <div className="setting-label">
                  <span>
                    {t('settings.silenceDuration')}
                    <Tooltip
                      content={t('settings.silenceDurationTooltip')}
                      position="top"
                    >
                      <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                    </Tooltip>
                  </span>
                  <span className="setting-value">{compatibleSettings?.silenceDuration.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={compatibleSettings?.silenceDuration || 0}
                  onChange={(e) => updateOpenAICompatibleSettingsHelper({ silenceDuration: parseFloat(e.target.value) })}
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
              <span>
                {t('settings.eagerness')}
                <Tooltip
                  content={t('settings.semanticEagernessTooltip')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
            </div>
            <select
              className="select-dropdown"
              value={compatibleSettings?.semanticEagerness}
              onChange={(e) => updateOpenAICompatibleSettingsHelper({ semanticEagerness: e.target.value as 'Auto' | 'Low' | 'Medium' | 'High' })}
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
    // PalabraAI and Local Inference don't have model selection
    if (provider === Provider.PALABRA_AI || provider === Provider.LOCAL_INFERENCE) {
      return null;
    }

    // Use available models from API if available, fallback to config models
    const modelsToUse = availableModels.length > 0 ? 
      availableModels.filter(model => model.type === 'realtime') : 
      config.models.filter(model => model.type === 'realtime');

    const handleRefreshModels = async () => {
      try {
        // Pass getAuthToken for Kizuna AI provider
        const getAuthToken = provider === Provider.KIZUNA_AI && getToken ? 
          () => getToken() : undefined;
        
        await fetchAvailableModels(getAuthToken);
      } catch (error) {
        console.error('[Sokuji][ProviderSpecificSettings] Error refreshing models:', error);
      }
    };

    return (
      <div className="settings-section">
        <h2>
          {t('settings.model')}
          <Tooltip
            content={t('settings.modelTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="model-selection-container">
            <select
              className="select-dropdown"
              value={(currentProviderSettings as any).model}
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
        <h2>
          {t('settings.noiseReduction')}
          <Tooltip
            content={t('settings.noiseReductionTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <select
            className="select-dropdown"
            value={compatibleSettings?.noiseReduction}
            onChange={(e) => updateOpenAICompatibleSettingsHelper({ noiseReduction: e.target.value as 'None' | 'Near field' | 'Far field' })}
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

  const renderTransportTypeSettings = () => {
    // Only show for providers that support WebRTC
    if (!ClientFactory.supportsWebRTC(provider)) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleSettings();
    if (!compatibleSettings) {
      return null;
    }

    return (
      <div className="settings-section">
        <h2>
          {t('settings.transportType')}
          <Tooltip
            content={t('settings.transportTypeTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            <button
              className={`option-button ${compatibleSettings.transportType === 'websocket' ? 'active' : ''}`}
              onClick={() => updateOpenAICompatibleSettingsHelper({ transportType: 'websocket' as TransportType })}
              disabled={isSessionActive}
            >
              {t('settings.websocket')}
            </button>
            <button
              className={`option-button ${compatibleSettings.transportType === 'webrtc' ? 'active' : ''}`}
              onClick={() => updateOpenAICompatibleSettingsHelper({ transportType: 'webrtc' as TransportType })}
              disabled={isSessionActive}
            >
              {t('settings.webrtc')}
            </button>
          </div>
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
        <h2>
          {t('settings.userTranscriptModel')}
          <Tooltip
            content={t('settings.transcriptModelTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <select
            className="select-dropdown"
            value={compatibleSettings?.transcriptModel}
            onChange={(e) => updateOpenAICompatibleSettingsHelper({ transcriptModel: e.target.value as 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1' })}
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
    if (!config.capabilities.hasModelConfiguration || provider === Provider.PALABRA_AI) {
      return null;
    }

    const { temperatureRange, maxTokensRange } = config.capabilities;

    return (
      <div className="settings-section">
        <h2>{t('settings.modelConfiguration')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>
              {t('settings.temperature')}
              <Tooltip
                content={t('settings.temperatureTooltip')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
              </Tooltip>
            </span>
            <span className="setting-value">{(currentProviderSettings as any).temperature.toFixed(2)}</span>
          </div>
          <input 
            type="range" 
            min={temperatureRange.min} 
            max={temperatureRange.max} 
            step={temperatureRange.step} 
            value={(currentProviderSettings as any).temperature}
            onChange={(e) => updateCurrentProviderSetting('temperature', parseFloat(e.target.value))}
            className="slider"
            disabled={isSessionActive}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span className="label-with-checkbox">
              {t('settings.maxTokens')}
              <Tooltip
                content={t('settings.maxTokensTooltip')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
              </Tooltip>
              <label className="unlimited-checkbox">
                <input
                  type="checkbox"
                  checked={(currentProviderSettings as any).maxTokens === 'inf'}
                  onChange={(e) => {
                    if (e.target.checked) {
                      updateCurrentProviderSetting('maxTokens', 'inf');
                    } else {
                      updateCurrentProviderSetting('maxTokens', maxTokensRange.max);
                    }
                  }}
                  disabled={isSessionActive}
                />
                <span>{t('settings.unlimited', 'Unlimited')}</span>
              </label>
            </span>
            <span className="setting-value">
              {(currentProviderSettings as any).maxTokens === 'inf' 
                ? t('settings.unlimited', 'Unlimited') 
                : (currentProviderSettings as any).maxTokens}
            </span>
          </div>
          {(currentProviderSettings as any).maxTokens !== 'inf' && (
            <input 
              type="range" 
              min={maxTokensRange.min} 
              max={maxTokensRange.max} 
              step={maxTokensRange.step} 
              value={(currentProviderSettings as any).maxTokens}
              onChange={(e) => updateCurrentProviderSetting('maxTokens', parseInt(e.target.value))}
              className="slider"
              disabled={isSessionActive}
            />
          )}
        </div>
      </div>
    );
  };

  const renderGeminiVadSettings = () => {
    if (provider !== Provider.GEMINI) {
      return null;
    }

    return (
      <div className="settings-section" id="gemini-vad-section">
        <h2>
          {t('settings.geminiVad')}
          <Tooltip
            content={t('settings.geminiVadTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            <button
              className={`option-button ${geminiSettings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
              onClick={() => updateGeminiSettings({ turnDetectionMode: 'Auto' })}
              disabled={isSessionActive}
            >
              {t('settings.auto')}
            </button>
            <button
              className={`option-button ${geminiSettings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
              onClick={() => updateGeminiSettings({ turnDetectionMode: 'Push-to-Talk' })}
              disabled={isSessionActive}
            >
              {t('settings.pushToTalk')}
            </button>
          </div>
        </div>

        {geminiSettings.turnDetectionMode === 'Auto' && (
          <>
            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.startOfSpeechSensitivity')}
                  <Tooltip
                    content={t('settings.startOfSpeechSensitivityTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
              </div>
              <div className="turn-detection-options">
                <button
                  className={`option-button ${geminiSettings.vadStartSensitivity === 'high' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadStartSensitivity: 'high' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityHigh')}
                </button>
                <button
                  className={`option-button ${geminiSettings.vadStartSensitivity === 'low' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadStartSensitivity: 'low' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityLow')}
                </button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.endOfSpeechSensitivity')}
                  <Tooltip
                    content={t('settings.endOfSpeechSensitivityTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
              </div>
              <div className="turn-detection-options">
                <button
                  className={`option-button ${geminiSettings.vadEndSensitivity === 'high' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadEndSensitivity: 'high' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityHigh')}
                </button>
                <button
                  className={`option-button ${geminiSettings.vadEndSensitivity === 'low' ? 'active' : ''}`}
                  onClick={() => updateGeminiSettings({ vadEndSensitivity: 'low' })}
                  disabled={isSessionActive}
                >
                  {t('settings.sensitivityLow')}
                </button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.vadSilenceDuration')}
                  <Tooltip
                    content={t('settings.vadSilenceDurationTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
                <span className="setting-value">{geminiSettings.vadSilenceDurationMs}ms</span>
              </div>
              <input
                type="range"
                min="50"
                max="3000"
                step="50"
                value={geminiSettings.vadSilenceDurationMs}
                onChange={(e) => updateGeminiSettings({ vadSilenceDurationMs: parseInt(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>

            <div className="setting-item">
              <div className="setting-label">
                <span>
                  {t('settings.vadPrefixPadding')}
                  <Tooltip
                    content={t('settings.vadPrefixPaddingTooltip')}
                    position="top"
                  >
                    <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </Tooltip>
                </span>
                <span className="setting-value">{geminiSettings.vadPrefixPaddingMs}ms</span>
              </div>
              <input
                type="range"
                min="0"
                max="2000"
                step="50"
                value={geminiSettings.vadPrefixPaddingMs}
                onChange={(e) => updateGeminiSettings({ vadPrefixPaddingMs: parseInt(e.target.value) })}
                className="slider"
                disabled={isSessionActive}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPalabraAISettings = () => {
    if (provider !== Provider.PALABRA_AI) {
      return null;
    }

    return (
      <>
        <div className="settings-section">
          <h2>{t('settings.languageSettings', 'Language Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sourceLanguage')}</span>
            </div>
            <select
              className="select-dropdown"
              value={palabraAISettings.sourceLanguage}
              onChange={(e) => {
                const oldSourceLang = palabraAISettings.sourceLanguage;
                const newSourceLang = e.target.value;
                // For PalabraAI, source and target languages use different codes,
                // so conflicts are less likely, but we still handle them
                updatePalabraAISettings({ sourceLanguage: newSourceLang });
                
                // Track language change
                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: newSourceLang,
                  language_type: 'source'
                });
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
              value={palabraAISettings.targetLanguage}
              onChange={(e) => {
                const oldTargetLang = palabraAISettings.targetLanguage;
                const newTargetLang = e.target.value;
                updatePalabraAISettings({ targetLanguage: newTargetLang });
                
                // Track language change
                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: newTargetLang,
                  language_type: 'target'
                });
              }}
              disabled={isSessionActive}
            >
              {/* PalabraAI target language options */}
              <option value="ar-sa">العربية (السعودية)</option>
              <option value="ar-ae">العربية (الإمارات)</option>
              <option value="az">Azərbaycan</option>
              <option value="bg">Български</option>
              <option value="zh">中文 (简体)</option>
              <option value="zh-hant">中文 (繁體)</option>
              <option value="cs">Čeština</option>
              <option value="da">Dansk</option>
              <option value="de">Deutsch</option>
              <option value="el">Ελληνικά</option>
              <option value="en-us">English (US)</option>
              <option value="en-au">English (Australia)</option>
              <option value="en-ca">English (Canada)</option>
              <option value="es">Español</option>
              <option value="es-mx">Español (México)</option>
              <option value="fil">Filipino</option>
              <option value="fi">Suomi</option>
              <option value="fr">Français</option>
              <option value="fr-ca">Français (Canada)</option>
              <option value="he">עברית</option>
              <option value="hi">हिन्दी</option>
              <option value="hr">Hrvatski</option>
              <option value="hu">Magyar</option>
              <option value="id">Bahasa Indonesia</option>
              <option value="it">Italiano</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="ms">Bahasa Melayu</option>
              <option value="nl">Nederlands</option>
              <option value="no">Norsk</option>
              <option value="pl">Polski</option>
              <option value="pt">Português</option>
              <option value="pt-br">Português (Brasil)</option>
              <option value="ro">Română</option>
              <option value="ru">Русский</option>
              <option value="sk">Slovenčina</option>
              <option value="sv">Svenska</option>
              <option value="ta">தமிழ்</option>
              <option value="tr">Türkçe</option>
              <option value="uk">Українська</option>
              <option value="vn">Tiếng Việt</option>
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.voice')}
                <Tooltip
                  content={t('settings.voiceTooltip')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
            </div>
            <select
              className="select-dropdown"
              value={palabraAISettings.voiceId}
              onChange={(e) => updatePalabraAISettings({ voiceId: e.target.value })}
              disabled={isSessionActive}
            >
              {config.voices.map((voice) => (
                <option key={voice.value} value={voice.value}>{voice.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.speechProcessing', 'Speech Processing')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.silenceThreshold', 'Silence Threshold')}</span>
              <span className="setting-value">{palabraAISettings.segmentConfirmationSilenceThreshold.toFixed(2)}s</span>
            </div>
            <input 
              type="range" 
              min="0.1" 
              max="2.0" 
              step="0.01" 
              value={palabraAISettings.segmentConfirmationSilenceThreshold}
              onChange={(e) => updatePalabraAISettings({ segmentConfirmationSilenceThreshold: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sentenceSplitter', 'Sentence Splitter')}</span>
            </div>
            <div className="turn-detection-options">
              <button 
                className={`option-button ${palabraAISettings.sentenceSplitterEnabled ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ sentenceSplitterEnabled: true })}
                disabled={isSessionActive}
              >
                {t('settings.enabled', 'Enabled')}
              </button>
              <button 
                className={`option-button ${!palabraAISettings.sentenceSplitterEnabled ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ sentenceSplitterEnabled: false })}
                disabled={isSessionActive}
              >
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.translatePartialTranscriptions', 'Translate Partial Transcriptions')}</span>
            </div>
            <div className="turn-detection-options">
              <button 
                className={`option-button ${palabraAISettings.translatePartialTranscriptions ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ translatePartialTranscriptions: true })}
                disabled={isSessionActive}
              >
                {t('settings.enabled', 'Enabled')}
              </button>
              <button 
                className={`option-button ${!palabraAISettings.translatePartialTranscriptions ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ translatePartialTranscriptions: false })}
                disabled={isSessionActive}
              >
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.queueConfiguration', 'Audio Buffer Configuration')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {t('settings.desiredQueueLevel', 'Target Audio Buffer')}
                <span 
                  title="Desired average TTS buffer size. The system will try to maintain this amount of translated audio ready for playback. Recommended: 6-8 seconds for optimal performance."
                  style={{ display: 'flex', alignItems: 'center', cursor: 'help' }}
                >
                  <Info size={14} style={{ color: '#aaa' }} />
                </span>
              </span>
              <span className="setting-value">{(palabraAISettings.desiredQueueLevelMs / 1000).toFixed(1)}s</span>
            </div>
            <input 
              type="range" 
              min="3000" 
              max="15000" 
              step="1000" 
              value={palabraAISettings.desiredQueueLevelMs}
              onChange={(e) => updatePalabraAISettings({ desiredQueueLevelMs: parseInt(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {t('settings.maxQueueLevel', 'Max Audio Buffer')}
                <span 
                  title="Maximum TTS queue size. If the buffer grows beyond this limit, older audio will be dropped to prevent excessive delay. Should be 2-3x larger than the target buffer size."
                  style={{ display: 'flex', alignItems: 'center', cursor: 'help' }}
                >
                  <Info size={14} style={{ color: '#aaa' }} />
                </span>
              </span>
              <span className="setting-value">{(palabraAISettings.maxQueueLevelMs / 1000).toFixed(1)}s</span>
            </div>
            <input 
              type="range" 
              min="12000" 
              max="60000" 
              step="3000" 
              value={palabraAISettings.maxQueueLevelMs}
              onChange={(e) => updatePalabraAISettings({ maxQueueLevelMs: parseInt(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {t('settings.autoTempo', 'Adaptive Speech Speed')}
                <span 
                  title="Automatically adjust speech tempo based on the audio buffer state. When enabled, the system will speed up or slow down speech to maintain optimal buffer levels."
                  style={{ display: 'flex', alignItems: 'center', cursor: 'help' }}
                >
                  <Info size={14} style={{ color: '#aaa' }} />
                </span>
              </span>
            </div>
            <div className="turn-detection-options">
              <button 
                className={`option-button ${palabraAISettings.autoTempo ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ autoTempo: true })}
                disabled={isSessionActive}
              >
                {t('settings.enabled', 'Enabled')}
              </button>
              <button 
                className={`option-button ${!palabraAISettings.autoTempo ? 'active' : ''}`}
                onClick={() => updatePalabraAISettings({ autoTempo: false })}
                disabled={isSessionActive}
              >
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
        </div>


      </>
    );
  };

  const renderVolcengineAST2Settings = () => {
    if (provider !== Provider.VOLCENGINE_AST2) {
      return null;
    }

    const sourceLanguages = VolcengineAST2ProviderConfig.getSourceLanguages();
    const targetLanguages = VolcengineAST2ProviderConfig.getTargetLanguages();

    // Electron: delegate to main-process shell.openExternal (launches system browser).
    // Extension/web: window.open opens a new tab in the current browser.
    const openExternalUrl = (url: string) => {
      if (isElectron() && (window as any).electron?.invoke) {
        (window as any).electron.invoke('open-external', url);
      } else {
        window.open(url, '_blank');
      }
    };

    return (
      <>
        <div className="settings-section">
          <h2>{t('settings.languageSettings', 'Language Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sourceLanguage')}</span>
            </div>
            <select
              className="select-dropdown"
              value={volcengineAST2Settings.sourceLanguage}
              onChange={(e) => {
                const oldSourceLang = volcengineAST2Settings.sourceLanguage;
                const newSourceLang = e.target.value;
                updateVolcengineAST2Settings({ sourceLanguage: newSourceLang });

                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: newSourceLang,
                  language_type: 'source'
                });
              }}
              disabled={isSessionActive}
            >
              {sourceLanguages.map((lang: any) => (
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
              value={volcengineAST2Settings.targetLanguage}
              onChange={(e) => {
                const oldTargetLang = volcengineAST2Settings.targetLanguage;
                const newTargetLang = e.target.value;
                updateVolcengineAST2Settings({ targetLanguage: newTargetLang });

                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: newTargetLang,
                  language_type: 'target'
                });
              }}
              disabled={isSessionActive}
            >
              {targetLanguages.map((lang: any) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-section turn-detection-section" id="turn-detection-section">
          <h2>
            {t('settings.automaticTurnDetection')}
            <Tooltip
              content={t('settings.volcengineAST2TurnDetectionTooltip', 'Auto mode uses server-side voice activity detection. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button
                className={`option-button ${volcengineAST2Settings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
                onClick={() => updateVolcengineAST2Settings({ turnDetectionMode: 'Auto' })}
                disabled={isSessionActive}
              >
                {t('settings.auto')}
              </button>
              <button
                className={`option-button ${volcengineAST2Settings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
                onClick={() => updateVolcengineAST2Settings({ turnDetectionMode: 'Push-to-Talk' })}
                disabled={isSessionActive}
              >
                {t('settings.pushToTalk')}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.volcengineAST2CustomVocabulary', 'Custom Vocabulary (自学习平台)')}</h2>

          {/* Hot Words */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2HotWordLibraryId', 'Hot Words Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2HotWordLibraryTooltip', 'Boost recognition of specific terms.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <div className="tutorial-link" style={{ margin: 0, marginLeft: 'auto' }}>
                <a
                  href="https://console.volcengine.com/speech/hotword"
                  onClick={(e) => { e.preventDefault(); openExternalUrl('https://console.volcengine.com/speech/hotword'); }}
                >
                  <ExternalLink size={12} />
                  {t('settings.volcengineAST2HotWordManage', 'Manage hot words')}
                </a>
              </div>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.hotWordTableId}
              onChange={(e) => updateVolcengineAST2Settings({ hotWordTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          {/* Replacement */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2ReplacementLibraryId', 'Replacement Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2ReplacementLibraryTooltip', 'Post-transcription text substitution.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <div className="tutorial-link" style={{ margin: 0, marginLeft: 'auto' }}>
                <a
                  href="https://console.volcengine.com/speech/correctword"
                  onClick={(e) => { e.preventDefault(); openExternalUrl('https://console.volcengine.com/speech/correctword'); }}
                >
                  <ExternalLink size={12} />
                  {t('settings.volcengineAST2ReplacementManage', 'Manage replacement')}
                </a>
              </div>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.replacementTableId}
              onChange={(e) => updateVolcengineAST2Settings({ replacementTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          {/* Glossary */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2GlossaryLibraryId', 'Glossary Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2GlossaryLibraryTooltip', 'Source→target bilingual term pairs.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
              <div className="tutorial-link" style={{ margin: 0, marginLeft: 'auto' }}>
                <a
                  href="https://console.volcengine.com/speech/glossary"
                  onClick={(e) => { e.preventDefault(); openExternalUrl('https://console.volcengine.com/speech/glossary'); }}
                >
                  <ExternalLink size={12} />
                  {t('settings.volcengineAST2GlossaryManage', 'Manage glossary')}
                </a>
              </div>
            </div>
            <input
              type="text"
              className="text-input"
              value={volcengineAST2Settings.glossaryTableId}
              onChange={(e) => updateVolcengineAST2Settings({ glossaryTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          <div className="setting-item" style={{ fontSize: '12px', color: '#888' }}>
            {t('settings.volcengineAST2CustomVocabularyFooter', 'Leave any field empty to disable it.')}
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.volcengineAST2Info', 'Doubao AST 2.0 Info')}</h2>
          <div className="setting-item">
            <div className="volcengine-st-info-notice" style={{
              padding: '12px',
              backgroundColor: 'rgba(16, 163, 127, 0.1)',
              border: '1px solid rgba(16, 163, 127, 0.3)',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#aaa'
            }}>
              <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
              {t('settings.volcengineAST2InfoText', 'Doubao AST 2.0 provides speech-to-speech translation with automatic voice cloning. The translated audio preserves the original speaker\'s voice characteristics.')}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderVolcengineSTSettings = () => {
    if (provider !== Provider.VOLCENGINE_ST) {
      return null;
    }

    // Get target and source languages from the provider config
    const targetLanguages = VolcengineSTProviderConfig.getTargetLanguages();
    const sourceLanguages = VolcengineSTProviderConfig.getSourceLanguages();

    return (
      <>
        <div className="settings-section">
          <h2>{t('settings.languageSettings', 'Language Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sourceLanguage')}</span>
            </div>
            <select
              className="select-dropdown"
              value={volcengineSTSettings.sourceLanguage}
              onChange={(e) => {
                const oldSourceLang = volcengineSTSettings.sourceLanguage;
                const newSourceLang = e.target.value;
                updateVolcengineSTSettings({ sourceLanguage: newSourceLang });

                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: newSourceLang,
                  language_type: 'source'
                });
              }}
              disabled={isSessionActive}
            >
              {sourceLanguages.map((lang: any) => (
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
              value={volcengineSTSettings.targetLanguage}
              onChange={(e) => {
                const oldTargetLang = volcengineSTSettings.targetLanguage;
                const newTargetLang = e.target.value;
                updateVolcengineSTSettings({ targetLanguage: newTargetLang });

                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: newTargetLang,
                  language_type: 'target'
                });
              }}
              disabled={isSessionActive}
            >
              {targetLanguages.map((lang: any) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.volcengineSTInfo', 'Volcengine Speech Translate Info')}</h2>
          <div className="setting-item">
            <div className="volcengine-st-info-notice" style={{
              padding: '12px',
              backgroundColor: 'rgba(16, 163, 127, 0.1)',
              border: '1px solid rgba(16, 163, 127, 0.3)',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#aaa'
            }}>
              <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
              {t('settings.volcengineSTInfoText', 'Volcengine Real-time Speech Translation provides text-only translation output. Audio synthesis is not supported in this mode.')}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderLocalInferenceSettings = () => {
    if (provider !== Provider.LOCAL_INFERENCE) {
      return null;
    }

    return (
      <>
        <ModelManagementSection
          isSessionActive={isSessionActive}
          localInferenceSettings={localInferenceSettings}
          onUpdateSettings={updateLocalInferenceSettings}
        />

        <div className="settings-section">
          <h2>{t('settings.ttsSettings', 'TTS Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.ttsSpeed', 'Speech Speed')}</span>
              <span className="setting-value">{localInferenceSettings.ttsSpeed.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={localInferenceSettings.ttsSpeed}
              onChange={(e) => updateLocalInferenceSettings({ ttsSpeed: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          {(() => {
            const ttsEntry = getManifestEntry(localInferenceSettings.ttsModel);
            if (ttsEntry?.engine === 'edge-tts') {
              // Voice picker for Edge TTS. Distinguish loading / error /
              // no-voices-for-language from the happy path so users get
              // actionable feedback instead of a perpetual "Loading..." label.
              let placeholder: string | null = null;
              if (edgeTtsVoiceStatus === 'loading' || edgeTtsVoiceStatus === 'idle') {
                placeholder = t('settings.loadingVoices', 'Loading voices...');
              } else if (edgeTtsVoiceStatus === 'error') {
                placeholder = t('settings.edgeTtsVoiceLoadError', 'Failed to load voices — check LogsPanel');
              } else if (filteredVoices.length === 0) {
                placeholder = t('settings.edgeTtsNoVoicesForLanguage', 'No voices available for this language');
              }

              return (
                <div className="setting-item">
                  <div className="setting-label">
                    <span>{t('settings.edgeTtsVoice', 'Voice')}</span>
                  </div>
                  <select
                    value={localInferenceSettings.edgeTtsVoice}
                    onChange={(e) => updateLocalInferenceSettings({ edgeTtsVoice: e.target.value })}
                    disabled={isSessionActive || filteredVoices.length === 0}
                    className="select-dropdown"
                    title={edgeTtsVoiceError ?? undefined}
                  >
                    {placeholder && <option value="">{placeholder}</option>}
                    {filteredVoices.map(voice => (
                      <option key={voice.ShortName} value={voice.ShortName}>
                        {getVoiceDisplayName(voice)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            // Speaker ID slider for local models
            const numSpeakers = ttsEntry?.numSpeakers ?? 1;
            return numSpeakers > 1 ? (
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
              <span className="setting-value">{localInferenceSettings.ttsSpeakerId}</span>
            </div>
            <input
              type="range"
              min="0"
              max={numSpeakers - 1}
              step="1"
              value={Math.min(localInferenceSettings.ttsSpeakerId, numSpeakers - 1)}
              onChange={(e) => updateLocalInferenceSettings({ ttsSpeakerId: parseInt(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
            ) : null;
          })()}
        </div>

        <div className="settings-section turn-detection-section" id="turn-detection-section">
          <h2>
            {t('settings.automaticTurnDetection')}
            <Tooltip
              content={t('settings.localInferenceTurnDetectionTooltip', 'Auto mode uses Voice Activity Detection to automatically detect speech. Push-to-Talk lets you manually control when to send audio by holding Space or the mic button.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button
                className={`option-button ${localInferenceSettings.turnDetectionMode === 'Auto' ? 'active' : ''}`}
                onClick={() => updateLocalInferenceSettings({ turnDetectionMode: 'Auto' })}
                disabled={isSessionActive}
              >
                {t('settings.auto')}
              </button>
              <button
                className={`option-button ${localInferenceSettings.turnDetectionMode === 'Push-to-Talk' ? 'active' : ''}`}
                onClick={() => updateLocalInferenceSettings({ turnDetectionMode: 'Push-to-Talk' })}
                disabled={isSessionActive}
              >
                {t('settings.pushToTalk')}
              </button>
            </div>
          </div>
        </div>

        {/* Show VAD settings for all models except sherpa-onnx streaming (which uses endpoint detection, not VAD) */}
        {localInferenceSettings.turnDetectionMode === 'Auto' && !(getManifestEntry(localInferenceSettings.asrModel)?.type === 'asr-stream' && !getManifestEntry(localInferenceSettings.asrModel)?.asrWorkerType) && (
        <div className="settings-section">
          <h2>
            {t('settings.vadSettings', 'VAD Settings')}
            <Tooltip
              content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.vadThreshold', 'Speech Threshold')}
                <Tooltip
                  content={t('settings.vadThresholdTooltip', 'Speech detection sensitivity. Higher values require louder/clearer speech to trigger recognition. Lower values are more sensitive to quiet speech.')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
              <span className="setting-value">{localInferenceSettings.vadThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.95"
              step="0.05"
              value={localInferenceSettings.vadThreshold}
              onChange={(e) => updateLocalInferenceSettings({ vadThreshold: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.vadMinSilenceDuration', 'Min Silence Duration')}
                <Tooltip
                  content={t('settings.vadMinSilenceDurationTooltip', 'Minimum silence duration to split speech segments. Shorter values split sentences faster, longer values wait for more natural pauses.')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
              <span className="setting-value">{localInferenceSettings.vadMinSilenceDuration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={localInferenceSettings.vadMinSilenceDuration}
              onChange={(e) => updateLocalInferenceSettings({ vadMinSilenceDuration: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.vadMinSpeechDuration', 'Min Speech Duration')}
                <Tooltip
                  content={t('settings.vadMinSpeechDurationTooltip', 'Minimum speech duration to consider as valid speech. Filters out very short sounds like clicks or coughs.')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
              <span className="setting-value">{localInferenceSettings.vadMinSpeechDuration.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={localInferenceSettings.vadMinSpeechDuration}
              onChange={(e) => updateLocalInferenceSettings({ vadMinSpeechDuration: parseFloat(e.target.value) })}
              className="slider"
              disabled={isSessionActive}
            />
          </div>
        </div>
        )}

      </>
    );
  };

  return (
    <Fragment>
      {/* System Instructions */}
      {config.capabilities.hasTemplateMode && (
        <div className="settings-section system-instructions-section" id="system-instructions-section">
          <h2>
            {t('settings.systemInstructions')}
            <Tooltip
              content={t('settings.systemInstructionsTooltip')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              <button 
                className={`option-button ${useTemplateMode ? 'active' : ''}`}
                onClick={() => setUseTemplateMode(true)}
                disabled={isSessionActive}
              >
                {t('settings.simple')}
              </button>
              <button 
                className={`option-button ${!useTemplateMode ? 'active' : ''}`}
                onClick={() => setUseTemplateMode(false)}
                disabled={isSessionActive}
              >
                {t('settings.advanced')}
              </button>
            </div>
          </div>
          
          {useTemplateMode ? (
            <>
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
            <>
              <div className="setting-item">
                <textarea
                  className="system-instructions"
                  placeholder={t('settings.enterCustomInstructions')}
                  value={systemInstructions}
                  onChange={(e) => setSystemInstructions(e.target.value)}
                  disabled={isSessionActive}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>
                    {t('settings.participantInstructions', 'Participant Instructions')}
                    <Tooltip
                      content={t('settings.participantInstructionsTooltip', 'System instructions for participant audio translation. Leave empty to use main instructions.')}
                      position="top"
                    >
                      <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                    </Tooltip>
                  </span>
                </div>
                <textarea
                  className="system-instructions"
                  placeholder={t('settings.participantInstructionsTooltip', 'Leave empty to use main instructions...')}
                  value={participantSystemInstructions}
                  onChange={(e) => setParticipantSystemInstructions(e.target.value)}
                  disabled={isSessionActive}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Provider-specific settings */}
      {renderVoiceSettings()}
      {renderTurnDetectionSettings()}
      {renderModelSettings()}
      {renderTranscriptSettings()}
      {renderNoiseReductionSettings()}
      {renderTransportTypeSettings()}
      {renderModelConfigurationSettings()}
      {renderGeminiVadSettings()}
      {renderPalabraAISettings()}
      {renderVolcengineSTSettings()}
      {renderVolcengineAST2Settings()}
      {renderLocalInferenceSettings()}
    </Fragment>
  );
};

export default ProviderSpecificSettings; 
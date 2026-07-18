import React, { Fragment, useEffect, useMemo } from 'react';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { resolveAST2LanguagePair } from '../../../services/providers/volcengineAST2LanguageSync';
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
  useOpenAITranslateSettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useZoomAISettings,
  useSonioxSettings,
  useKizunaOpenaiTranslateSettings,
  useKizunaVolcengineAst2Settings,
  useLocalInferenceSettings,
  useLocalNativeSettings,
  useUpdateLocalNative,
  useSetSystemInstructions,
  useSetTemplateSystemInstructions,
  useSetUseTemplateMode,
  useSetParticipantSystemInstructions,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateOpenAITranslate,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useUpdateZoomAI,
  useUpdateSoniox,
  useUpdateKizunaOpenaiTranslate,
  useUpdateKizunaVolcengineAst2,
  useUpdateLocalInference,
  useGetCurrentProviderSettings,
  TransportType,
  useLocalSystemPrompt,
  useLocalParticipantSystemPrompt,
  useLocalUseTemplateMode,
  useGetProcessedLocalPrompt,
  resolveTranslationWorkerType,
  resolveTranslationWorkerTypeForModelId,
} from '../../../stores/settingsStore';
import type { OpenAICompatibleSettingsBase } from '../../../stores/settingsStore';
import { ClientFactory } from '../../../services/clients';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RotateCw, Info, CircleHelp, ExternalLink } from 'lucide-react';
import Tooltip from '../../Tooltip/Tooltip';
import { FilteredModel } from '../../../services/interfaces/IClient';
import { Provider, isOpenAICompatible, kizunaBaseProvider, isKizunaManagedProvider } from '../../../types/Provider';
import { getManifestByType, getManifestEntry, isTranslationModelCompatible, isAstCompatible, pickBestModel } from '../../../lib/local-inference/modelManifest';
import { useModelStatuses, useModelStore } from '../../../stores/modelStore';
import { isElectron } from '../../../utils/environment';
import { ModelManagementSection } from './ModelManagementSection';
import { NativeModelManagementSection } from './NativeModelManagementSection';
import { EngineSection } from './EngineSection';
import { TtsSpeedControl, SpeechModeControl, VadControl, TranslationPromptControl, type SpeechMode } from './LocalSettingsControls';  // TranslationPromptControl shared by both local providers
import { hasNativeTts } from '../../../lib/local-inference/native/nativeCatalog';
import { useNativeCatalog, useNativeModelStore } from '../../../stores/nativeModelStore';
import { useAnalytics } from '../../../lib/analytics';
import { useAuth } from '../../../lib/auth/hooks';

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

/**
 * OpenAI's internal `'Disabled'` mode is surfaced in the UI as "Push-to-Talk"
 * (matches the equivalent button on other providers). For analytics we want
 * the same normalization so cross-provider mode stats are consistent.
 */
function normalizeSpeechModeForAnalytics(mode: string): string {
  return mode === 'Disabled' ? 'Push-to-Talk' : mode;
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
  const openAITranslateSettings = useOpenAITranslateSettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  const zoomAISettings = useZoomAISettings();
  const sonioxSettings = useSonioxSettings();
  const kizunaOpenaiTranslateSettings = useKizunaOpenaiTranslateSettings();
  const kizunaVolcengineAst2Settings = useKizunaVolcengineAst2Settings();
  const localInferenceSettings = useLocalInferenceSettings();
  const localNativeSettings = useLocalNativeSettings();
  const updateLocalNativeSettings = useUpdateLocalNative();
  const nativeCatalog = useNativeCatalog();
  const modelStatuses = useModelStatuses();
  // Engine gate (spec S10): the native model list only renders once the engine
  // is usable (installed bundle at the right version, or a dev venv checkout).
  const engineBundleStatus = useNativeModelStore((s) => s.bundleStatus);
  const engineDevVenv = useNativeModelStore((s) => s.bundleDevVenv);
  const engineUsable = engineBundleStatus === 'ready' || engineDevVenv;

  // Actions from store
  const setSystemInstructions = useSetSystemInstructions();
  const setTemplateSystemInstructions = useSetTemplateSystemInstructions();
  const setUseTemplateMode = useSetUseTemplateMode();
  const setParticipantSystemInstructions = useSetParticipantSystemInstructions();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updateGeminiSettings = useUpdateGemini();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateOpenAITranslateSettings = useUpdateOpenAITranslate();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const updateZoomAISettings = useUpdateZoomAI();
  const updateSonioxSettings = useUpdateSoniox();
  const updateKizunaOpenaiTranslateSettings = useUpdateKizunaOpenaiTranslate();
  const updateKizunaVolcengineAst2Settings = useUpdateKizunaVolcengineAst2();
  const updateLocalInferenceSettings = useUpdateLocalInference();
  const getCurrentProviderSettings = useGetCurrentProviderSettings();
  const localSystemPrompt = useLocalSystemPrompt();
  const localParticipantSystemPrompt = useLocalParticipantSystemPrompt();
  const localUseTemplateMode = useLocalUseTemplateMode();
  const getProcessedLocalPrompt = useGetProcessedLocalPrompt();
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();

  // Kizuna-managed relay twins reuse their base provider's controls. The
  // sections below gate on `effectiveProvider` so the OPENAI_TRANSLATE /
  // VOLCENGINE_AST2 UI renders for the twins, but read/write the kizuna slices
  // (selected just below) so the user-managed slices stay untouched.
  const effectiveProvider = kizunaBaseProvider(provider) ?? provider;

  // Active translate slice + updater: kizuna slice when managed, else the
  // user-managed openaiTranslate slice. Used by the translate-section helpers.
  const activeOpenAITranslateSettings =
    provider === Provider.KIZUNA_AI_OPENAI_TRANSLATE
      ? kizunaOpenaiTranslateSettings
      : openAITranslateSettings;
  const updateActiveOpenAITranslateSettings =
    provider === Provider.KIZUNA_AI_OPENAI_TRANSLATE
      ? updateKizunaOpenaiTranslateSettings
      : updateOpenAITranslateSettings;

  // Active AST2 slice + updater: kizuna slice when managed, else user-managed.
  const activeVolcengineAST2Settings =
    provider === Provider.KIZUNA_AI_VOLCENGINE_AST2
      ? kizunaVolcengineAst2Settings
      : volcengineAST2Settings;
  const updateActiveVolcengineAST2Settings =
    provider === Provider.KIZUNA_AI_VOLCENGINE_AST2
      ? updateKizunaVolcengineAst2Settings
      : updateVolcengineAST2Settings;

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

  // Custom prompt is supported when EITHER the speaker's or the participant's
  // translation worker is Qwen-family. Participant's worker type is derived via
  // modelStore.getParticipantModelStatus, which consults modelPreferences recall
  // for the reversed language pair (so user's prior choice for tgt→src is honored).
  const speakerWorkerType = useMemo(
    () => resolveTranslationWorkerType(localInferenceSettings),
    [localInferenceSettings.translationModel, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage],
  );
  // Subscribe via selectors so the memo recomputes when the user changes their
  // remembered model preferences (e.g. after picking a model for the reversed
  // language pair via the temporary-swap workflow) or after WebGPU availability
  // flips.
  const modelPreferences = useModelStore(s => s.modelPreferences);
  const participantWorkerType = useMemo(() => {
    const status = useModelStore.getState().getParticipantModelStatus(
      localInferenceSettings.sourceLanguage,
      localInferenceSettings.targetLanguage,
      localInferenceSettings.asrModel,
      localInferenceSettings.translationModel || undefined,
    );
    return resolveTranslationWorkerTypeForModelId(status.translationModelId);
  }, [
    localInferenceSettings.sourceLanguage,
    localInferenceSettings.targetLanguage,
    localInferenceSettings.asrModel,
    localInferenceSettings.translationModel,
    modelStatuses,
    modelPreferences,
  ]);
  const isQwenFamily = (t: string) => t === 'qwen' || t === 'qwen35';
  const localPromptSupported = isQwenFamily(speakerWorkerType) || isQwenFamily(participantWorkerType);

  // Get current provider's settings
  const currentProviderSettings = getCurrentProviderSettings();

  // Helper functions to update current provider's settings
  const updateCurrentProviderSetting = (key: string, value: any) => {
    if (provider === Provider.OPENAI) {
      updateOpenAISettings({ [key]: value });
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      updateOpenAICompatibleSettings({ [key]: value });
    } else if (provider === Provider.GEMINI) {
      updateGeminiSettings({ [key]: value });
    } else if (provider === Provider.PALABRA_AI) {
      updatePalabraAISettings({ [key]: value });
    } else if (provider === Provider.VOLCENGINE_ST) {
      updateVolcengineSTSettings({ [key]: value });
    } else if (provider === Provider.VOLCENGINE_AST2) {
      updateVolcengineAST2Settings({ [key]: value });
    } else if (provider === Provider.ZOOM_AI) {
      updateZoomAISettings({ [key]: value });
    } else if (provider === Provider.SONIOX) {
      updateSonioxSettings({ [key]: value });
    } else if (provider === Provider.KIZUNA_AI_OPENAI_TRANSLATE) {
      updateKizunaOpenaiTranslateSettings({ [key]: value });
    } else if (provider === Provider.KIZUNA_AI_VOLCENGINE_AST2) {
      updateKizunaVolcengineAst2Settings({ [key]: value });
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

  // Helper function to get settings for any provider that exposes the
  // shared transport/transcript/noise-reduction fields. OPENAI_TRANSLATE is
  // included here because — although its settings shape diverges in other
  // places (no voice/turn-detection/temperature) — it carries the same
  // `transportType`, `transcriptModel`, and `noiseReduction` fields that the
  // sections below need. Render-level capability flags handle the rest.
  const getOpenAICompatibleSettings = () => {
    if (provider === Provider.OPENAI) {
      return openAISettings;
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      return openAICompatibleSettings;
    } else if (effectiveProvider === Provider.OPENAI_TRANSLATE) {
      // Covers OPENAI_TRANSLATE and its kizuna twin; activeOpenAITranslateSettings
      // resolves to the kizuna slice when managed.
      return activeOpenAITranslateSettings;
    }
    return null;
  };

  const updateOpenAICompatibleSettingsHelper = (updates: any) => {
    if (provider === Provider.OPENAI) {
      updateOpenAISettings(updates);
    } else if (provider === Provider.OPENAI_COMPATIBLE) {
      updateOpenAICompatibleSettings(updates);
    } else if (effectiveProvider === Provider.OPENAI_TRANSLATE) {
      updateActiveOpenAITranslateSettings(updates);
    }
  };

  // Narrow accessor for renderers that need fields only present on the
  // full OpenAI-compatible settings shape (turn detection, temperature,
  // max tokens, reasoning effort) — these don't exist on OpenAITranslate.
  // The explicit return type narrows out `OpenAITranslateSettings` so
  // callers can read turnDetectionMode/threshold/etc. directly.
  const getOpenAICompatibleOnlySettings = (): OpenAICompatibleSettingsBase | null => {
    if (effectiveProvider === Provider.OPENAI_TRANSLATE) return null;
    const settings = getOpenAICompatibleSettings();
    if (!settings || 'targetLanguage' in settings && !('voice' in settings)) {
      // Defensive: shouldn't happen given the gate above
      return null;
    }
    return settings as OpenAICompatibleSettingsBase;
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

    // Turn detection is OpenAI-compatible (OpenAI and CometAPI) only — not Translate
    if (!isCurrentProviderOpenAICompatible()) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleOnlySettings();

    // Check if WebRTC mode is active - server VAD causes audio truncation in WebRTC
    const isWebRTCMode = compatibleSettings?.transportType === 'webrtc';

    return (
      <div className="settings-section turn-detection-section" id="turn-detection-section">
        <h2>
          {t('settings.speechMode')}
          <Tooltip
            content={`${t('settings.turnDetectionTooltip')}\n\n${t('settings.speechModeAppliesTo', 'Applies to your voice. Participant audio always uses semantic VAD.')}`}
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
                  onClick={() => {
                    const fromMode = compatibleSettings?.turnDetectionMode ?? 'Normal';
                    const toMode = mode as 'Normal' | 'Semantic' | 'Disabled' | 'Push-to-Translate';
                    if (fromMode !== toMode) {
                      trackEvent('speech_mode_changed', {
                        provider: provider,
                        from_mode: normalizeSpeechModeForAnalytics(fromMode),
                        to_mode: normalizeSpeechModeForAnalytics(toMode),
                      });
                      updateOpenAICompatibleSettingsHelper({ turnDetectionMode: toMode });
                    }
                  }}
                  disabled={isDisabled}
                  title={isWebRTCMode && isVADMode ? t('settings.webrtcVadDisabledTitle', 'Server VAD is not available in WebRTC mode') : undefined}
                >
                  {/* OpenAI's internal 'Disabled' value semantically IS push-to-talk
                      (no server VAD, manual hold-to-send). Surface it as Push-to-Talk
                      under the new "Speech Mode" label, matching the other providers'
                      equivalent button. The internal enum value stays 'Disabled' for
                      backward compat with persisted settings. Volcengine AST2 spells
                      the same mode 'Push-to-Talk', which lowercases to a key that does
                      not exist — both spellings must map to settings.pushToTalk. */}
                  {mode === 'Disabled' || mode === 'Push-to-Talk'
                    ? t('settings.pushToTalk')
                    : t(`settings.${mode.toLowerCase()}`)}
                </button>
              );
            })}
            <button
              key="push-to-translate"
              className={`option-button ${compatibleSettings?.turnDetectionMode === 'Push-to-Translate' ? 'active' : ''}`}
              onClick={() => {
                const fromMode = compatibleSettings?.turnDetectionMode ?? 'Normal';
                if (fromMode !== 'Push-to-Translate') {
                  trackEvent('speech_mode_changed', {
                    provider: provider,
                    from_mode: normalizeSpeechModeForAnalytics(fromMode),
                    to_mode: 'Push-to-Translate',
                  });
                  updateOpenAICompatibleSettingsHelper({ turnDetectionMode: 'Push-to-Translate' });
                }
              }}
              disabled={isSessionActive || isWebRTCMode}
              title={isWebRTCMode ? t('settings.pushToTranslateNotAvailableInWebrtc') : undefined}
            >
              {t('settings.pushToTranslate')}
            </button>
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
    // PalabraAI and Local (Offline/Native) inference don't have model selection
    if (provider === Provider.PALABRA_AI || provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) {
      return null;
    }

    // Use available models from API if available, fallback to config models
    const modelsToUse = availableModels.length > 0 ? 
      availableModels.filter(model => model.type === 'realtime') : 
      config.models.filter(model => model.type === 'realtime');

    const handleRefreshModels = async () => {
      try {
        // Pass getAuthToken for Kizuna-managed (relay) providers
        const getAuthToken = isKizunaManagedProvider(provider) && getToken ?
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

  // Standalone silence-duration sliders for providers (currently only
  // OPENAI_TRANSLATE) that segment user (input) and assistant (output)
  // independently. Translate's API has no server-side turn detection, so
  // these only control UI message splitting. Range 0.1–3.0s.
  const renderSilenceDurationOnlySetting = () => {
    if (!config.capabilities.turnDetection.hasSilenceDuration) return null;
    if (config.capabilities.hasTurnDetection) return null;

    const compatibleSettings = getOpenAICompatibleSettings();
    if (
      !compatibleSettings ||
      !('userSilenceDuration' in compatibleSettings) ||
      !('assistantSilenceDuration' in compatibleSettings)
    ) {
      return null;
    }
    const userValue = (compatibleSettings as { userSilenceDuration: number }).userSilenceDuration;
    const assistantValue = (compatibleSettings as { assistantSilenceDuration: number }).assistantSilenceDuration;

    return (
      <div className="settings-section">
        <h2>
          {t('settings.silenceDuration')}
          <Tooltip
            content={t('settings.silenceDurationTranslateTooltip', t('settings.silenceDurationTooltip'))}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.userSilenceDuration', 'Source pause')}</span>
            <span className="setting-value">{userValue.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={userValue}
            onChange={(e) => updateOpenAICompatibleSettingsHelper({ userSilenceDuration: parseFloat(e.target.value) })}
            className="slider"
            disabled={isSessionActive}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{t('settings.assistantSilenceDuration', 'Translation pause')}</span>
            <span className="setting-value">{assistantValue.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={assistantValue}
            onChange={(e) => updateOpenAICompatibleSettingsHelper({ assistantSilenceDuration: parseFloat(e.target.value) })}
            className="slider"
            disabled={isSessionActive}
          />
        </div>
      </div>
    );
  };

  const renderNoiseReductionSettings = () => {
    if (!config.capabilities.hasNoiseReduction || config.noiseReductionModes.length === 0) {
      return null;
    }

    const compatibleSettings = getOpenAICompatibleSettings();
    if (!compatibleSettings) return null;

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

    const compatibleSettings = getOpenAICompatibleSettings();
    if (!compatibleSettings) return null;

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

  const renderReasoningEffortSettings = () => {
    if (!config.capabilities.hasReasoningEffort) return null;
    if (!isCurrentProviderOpenAICompatible()) return null;

    const compatibleSettings = getOpenAICompatibleOnlySettings();
    if (!compatibleSettings) return null;

    // Only `gpt-realtime-2` accepts reasoning.effort; gate UI accordingly.
    if (!compatibleSettings.model?.startsWith('gpt-realtime-2')) return null;

    const efforts = config.reasoningEfforts ?? ['minimal', 'low', 'medium', 'high', 'xhigh'];
    const current = compatibleSettings.reasoningEffort ?? 'low';

    return (
      <div className="settings-section">
        <h2>
          {t('settings.reasoningEffort')}
          <Tooltip
            content={t('settings.reasoningEffortTooltip')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
        <div className="setting-item">
          <select
            className="select-dropdown"
            value={current}
            onChange={(e) => updateOpenAICompatibleSettingsHelper({ reasoningEffort: e.target.value as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' })}
            disabled={isSessionActive}
          >
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {t(`settings.reasoningEffortOptions.${effort}`, effort)}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  const renderGeminiVadSettings = () => {
    if (provider !== Provider.GEMINI) {
      return null;
    }

    return (
      <>
        <SpeechModeControl
          value={geminiSettings.turnDetectionMode}
          onChange={(mode) => {
            trackEvent('speech_mode_changed', {
              provider: provider,
              from_mode: geminiSettings.turnDetectionMode,
              to_mode: mode,
            });
            updateGeminiSettings({ turnDetectionMode: mode });
          }}
          disabled={isSessionActive}
          tooltip={`${t('settings.geminiVadTooltip')}\n\n${t('settings.speechModeAppliesTo', 'Applies to your voice. Participant audio always uses semantic VAD.')}`}
        />

        {geminiSettings.turnDetectionMode === 'Auto' && (
          <div className="settings-section" id="gemini-vad-section">
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
          </div>
        )}
      </>
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
    if (effectiveProvider !== Provider.VOLCENGINE_AST2) {
      return null;
    }

    // Bind to the active slice/updater so the kizuna twin writes its own slice
    // while the user-managed AST2 provider stays on volcengineAST2Settings.
    const ast2Settings = activeVolcengineAST2Settings;
    const updateAst2Settings = updateActiveVolcengineAST2Settings;

    // Look up by `provider` (not `effectiveProvider`): the kizuna twin is
    // registered whenever isKizunaAIEnabled() is true, but the base
    // Provider.VOLCENGINE_AST2 is only registered when the separate AST2
    // build/platform gates also pass. In builds where the twin is available
    // but the base isn't, resolving effectiveProvider would throw here. The
    // twin inherits identical language methods from the AST2 base, so the
    // result is byte-identical either way.
    const ast2Descriptor = ProviderConfigFactory.getDescriptor(provider);
    const sourceLanguages = ast2Descriptor.resolveSourceLanguages();
    const targetLanguages = ast2Descriptor.resolveTargetLanguages(ast2Settings.sourceLanguage);

    // Electron: delegate to main-process shell.openExternal (launches system browser).
    // Extension/web: window.open opens a new tab; noopener/noreferrer prevents
    // reverse-tabnabbing on the new tab.
    const openExternalUrl = (url: string) => {
      if (isElectron() && (window as any).electron?.invoke) {
        (window as any).electron.invoke('open-external', url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
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
              value={ast2Settings.sourceLanguage}
              onChange={(e) => {
                const oldSourceLang = ast2Settings.sourceLanguage;
                const oldTargetLang = ast2Settings.targetLanguage;
                const newSourceLang = e.target.value;
                const next = resolveAST2LanguagePair(
                  { sourceLanguage: oldSourceLang, targetLanguage: oldTargetLang },
                  { side: 'source', value: newSourceLang },
                );
                updateAst2Settings({
                  sourceLanguage: next.sourceLanguage,
                  targetLanguage: next.targetLanguage,
                });

                trackEvent('language_changed', {
                  from_language: oldSourceLang,
                  to_language: next.sourceLanguage,
                  language_type: 'source'
                });
                if (next.targetLanguage !== oldTargetLang) {
                  trackEvent('language_changed', {
                    from_language: oldTargetLang,
                    to_language: next.targetLanguage,
                    language_type: 'target'
                  });
                }
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
              value={ast2Settings.targetLanguage}
              onChange={(e) => {
                const oldSourceLang = ast2Settings.sourceLanguage;
                const oldTargetLang = ast2Settings.targetLanguage;
                const newTargetLang = e.target.value;
                const next = resolveAST2LanguagePair(
                  { sourceLanguage: oldSourceLang, targetLanguage: oldTargetLang },
                  { side: 'target', value: newTargetLang },
                );
                updateAst2Settings({
                  sourceLanguage: next.sourceLanguage,
                  targetLanguage: next.targetLanguage,
                });

                trackEvent('language_changed', {
                  from_language: oldTargetLang,
                  to_language: next.targetLanguage,
                  language_type: 'target'
                });
                if (next.sourceLanguage !== oldSourceLang) {
                  trackEvent('language_changed', {
                    from_language: oldSourceLang,
                    to_language: next.sourceLanguage,
                    language_type: 'source'
                  });
                }
              }}
              disabled={isSessionActive}
            >
              {targetLanguages.map((lang: any) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>

        <SpeechModeControl
          value={ast2Settings.turnDetectionMode}
          onChange={(mode) => {
            trackEvent('speech_mode_changed', {
              provider: provider,
              from_mode: ast2Settings.turnDetectionMode,
              to_mode: mode,
            });
            updateAst2Settings({ turnDetectionMode: mode });
          }}
          disabled={isSessionActive}
          tooltip={`${t('settings.volcengineAST2TurnDetectionTooltip', 'Auto: server-side voice activity detection. \nPush-to-Talk: hold Space or the mic button to send audio manually. \nPush-to-Translate: like Push-to-Talk, but routes your raw mic to the virtual mic when idle so you can speak directly without translation.')}\n\n${t('settings.speechModeAppliesTo', 'Applies to your voice. Participant audio always uses semantic VAD.')}`}
        />

        <div className="settings-section">
          <h2>{t('settings.volcengineAST2CustomVocabulary', 'Custom Vocabulary')}</h2>

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
              value={ast2Settings.hotWordTableId}
              onChange={(e) => updateAst2Settings({ hotWordTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          {/* Replacement */}
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.volcengineAST2ReplacementLibraryId', 'Replacement Library ID')}</span>
              <Tooltip
                content={t('settings.volcengineAST2ReplacementLibraryTooltip', 'Post-transcription regex text substitution. The referenced library must be a regex word list, not a standard replacement list.')}
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
              value={ast2Settings.replacementTableId}
              onChange={(e) => updateAst2Settings({ replacementTableId: e.target.value })}
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
              value={ast2Settings.glossaryTableId}
              onChange={(e) => updateAst2Settings({ glossaryTableId: e.target.value })}
              disabled={isSessionActive}
              placeholder=""
            />
          </div>

          <div className="setting-item" style={{ fontSize: '12px', color: '#888' }}>
            {t('settings.volcengineAST2CustomVocabularyFooter', 'Invalid or empty library IDs are silently ignored — the session runs as if the field weren\'t set. Library changes made in the Volcengine console can take a few minutes to take effect.')}
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
    const stDescriptor = ProviderConfigFactory.getDescriptor(provider);
    const targetLanguages = stDescriptor.resolveTargetLanguages(volcengineSTSettings.sourceLanguage);
    const sourceLanguages = stDescriptor.resolveSourceLanguages();

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

  const renderSonioxSettings = () => {
    if (provider !== Provider.SONIOX) return null;

    // Two-way translation needs a concrete source language to translate back
    // into — with 'auto' there's no fixed source side for the reverse leg, so
    // the toggle is force-disabled (and shown unchecked) whenever auto-detect
    // is selected, mirroring the descriptor's own degrade rule (Task 5).
    const autoSource = sonioxSettings.sourceLanguage === 'auto';

    return (
      <div className="settings-section" id="soniox-settings-section">
        <h2>{t('settings.translationMode', 'Translation Mode')}</h2>
        <div className="setting-item">
          <label
            className="checkbox-label"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: (isSessionActive || autoSource) ? 'not-allowed' : 'pointer' }}
          >
            <input
              type="checkbox"
              checked={sonioxSettings.twoWayTranslation && !autoSource}
              disabled={isSessionActive || autoSource}
              onChange={(e) => updateSonioxSettings({ twoWayTranslation: e.target.checked })}
            />
            <span>{t('settings.sonioxTwoWay', 'Two-way translation')}</span>
          </label>
          <div className="setting-description">
            {autoSource
              ? t('settings.sonioxTwoWayNeedsSource', 'Select a specific source language to enable two-way translation')
              : t('settings.sonioxTwoWayDesc', 'Translate in both directions between the source and target languages')}
          </div>
        </div>
      </div>
    );
  };

  const renderLocalNativeSettings = () => {
    if (provider !== Provider.LOCAL_NATIVE) {
      return null;
    }
    // The speed slider is meaningful only when the target language has a native
    // voice (text-only is the common textOnly toggle, not a per-stage Off option).
    const ttsActive = hasNativeTts(localNativeSettings.targetLanguage, nativeCatalog);
    // Every native translation model is an LLM (Qwen / TranslateGemma / Hunyuan-MT),
    // so all of them honour the custom prompt.
    const promptSupported = true;

    return (
      <>
        {/* Engine gate first (spec S10), then selection + download cards like LOCAL_INFERENCE. */}
        <EngineSection isSessionActive={isSessionActive} />
        {engineUsable ? (
          <NativeModelManagementSection isSessionActive={isSessionActive} />
        ) : (
          <div className="engine-section__models-placeholder">
            {t('engine.installHint', 'Install the engine to browse and download models')}
          </div>
        )}

        {ttsActive && (
          <TtsSpeedControl
            value={localNativeSettings.ttsSpeed}
            onChange={(ttsSpeed) => updateLocalNativeSettings({ ttsSpeed })}
            disabled={isSessionActive}
          />
        )}

        <SpeechModeControl
          value={localNativeSettings.turnDetectionMode}
          onChange={(turnDetectionMode: SpeechMode) => {
            const fromMode = localNativeSettings.turnDetectionMode;
            trackEvent('speech_mode_changed', { provider, from_mode: fromMode, to_mode: turnDetectionMode });
            updateLocalNativeSettings({ turnDetectionMode });
          }}
          disabled={isSessionActive}
        />

        <TranslationPromptControl
          useTemplateMode={localNativeSettings.useTemplateMode}
          systemPrompt={localNativeSettings.systemPrompt}
          /* no participantSystemPrompt: native has no participant audio path */
          preview={getProcessedLocalPrompt(false)}
          supported={promptSupported}
          disabled={isSessionActive}
          previewId="local-native-prompt-preview-content"
          onChange={(patch) => updateLocalNativeSettings(patch)}
        />

        {localNativeSettings.turnDetectionMode === 'Auto' && (
          <VadControl
            values={{
              vadThreshold: localNativeSettings.vadThreshold,
              vadMinSilenceDuration: localNativeSettings.vadMinSilenceDuration,
              vadMinSpeechDuration: localNativeSettings.vadMinSpeechDuration,
            }}
            onChange={(patch) => updateLocalNativeSettings(patch)}
            disabled={isSessionActive}
          />
        )}
      </>
    );
  };

  const renderZoomAISettings = () => {
    if (provider !== Provider.ZOOM_AI) return null;

    const zoomDescriptor = ProviderConfigFactory.getDescriptor(provider);
    const sourceLanguages = zoomDescriptor.resolveSourceLanguages();
    const targetLanguages = zoomDescriptor.resolveTargetLanguages(zoomAISettings.sourceLanguage);

    return (
      <>
        <div className="settings-section">
          <h2>{t('settings.languageSettings', 'Language Settings')}</h2>
          <div className="setting-item">
            <div className="setting-label"><span>{t('settings.sourceLanguage')}</span></div>
            <select
              className="select-dropdown"
              value={zoomAISettings.sourceLanguage}
              onChange={(e) => {
                const newSource = e.target.value;
                updateZoomAISettings({
                  sourceLanguage: newSource,
                  targetLanguage: zoomDescriptor.reconcileTarget(newSource, zoomAISettings.targetLanguage),
                });
              }}
              disabled={isSessionActive}
            >
              {sourceLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
          <div className="setting-item">
            <div className="setting-label"><span>{t('settings.targetLanguage')}</span></div>
            <select
              className="select-dropdown"
              value={zoomAISettings.targetLanguage}
              onChange={(e) => updateZoomAISettings({ targetLanguage: e.target.value })}
              disabled={isSessionActive}
            >
              {targetLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h2>{t('settings.zoomAIInfo', 'Zoom AI Services Info')}</h2>
          <div className="setting-item">
            <div className="volcengine-st-info-notice" style={{ padding: '12px', backgroundColor: 'rgba(16, 163, 127, 0.1)', border: '1px solid rgba(16, 163, 127, 0.3)', borderRadius: '8px', fontSize: '13px', color: '#aaa' }}>
              <Info size={14} style={{ marginRight: '8px', verticalAlign: 'middle', color: '#10a37f' }} />
              {t('settings.zoomAIInfoText', 'Zoom Scribe transcribes each utterance and Zoom Translator translates it to text. Translation pairs must include English on one side.')}
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
        <ModelManagementSection isSessionActive={isSessionActive} />

        {/* Voice / speaker selection now lives inside the selected TTS card
            (see ModelManagementSection → LocalInferenceVoiceSection). */}
        <TtsSpeedControl
          value={localInferenceSettings.ttsSpeed}
          onChange={(ttsSpeed) => updateLocalInferenceSettings({ ttsSpeed })}
          disabled={isSessionActive}
        />

        <SpeechModeControl
          value={localInferenceSettings.turnDetectionMode}
          onChange={(mode) => {
            trackEvent('speech_mode_changed', {
              provider: provider,
              from_mode: localInferenceSettings.turnDetectionMode,
              to_mode: mode,
            });
            updateLocalInferenceSettings({ turnDetectionMode: mode });
          }}
          disabled={isSessionActive}
        />

        <TranslationPromptControl
          useTemplateMode={localUseTemplateMode}
          systemPrompt={localSystemPrompt}
          participantSystemPrompt={localParticipantSystemPrompt}
          preview={getProcessedLocalPrompt(false)}
          supported={localPromptSupported}
          disabled={isSessionActive}
          onChange={(patch) => updateLocalInferenceSettings(patch)}
        />

        {/* Show VAD settings for all models except sherpa-onnx streaming (which uses endpoint detection, not VAD) */}
        {localInferenceSettings.turnDetectionMode === 'Auto' && !(getManifestEntry(localInferenceSettings.asrModel)?.type === 'asr-stream' && !getManifestEntry(localInferenceSettings.asrModel)?.asrWorkerType) && (
          <VadControl
            values={{
              vadThreshold: localInferenceSettings.vadThreshold,
              vadMinSilenceDuration: localInferenceSettings.vadMinSilenceDuration,
              vadMinSpeechDuration: localInferenceSettings.vadMinSpeechDuration,
            }}
            onChange={(patch) => updateLocalInferenceSettings(patch)}
            disabled={isSessionActive}
          />
        )}

      </>
    );
  };

  const renderTranslateInfoBanner = () => {
    if (effectiveProvider !== Provider.OPENAI_TRANSLATE) return null;
    return (
      <div className="settings-section translate-info-banner">
        <div className="info-banner">
          <Info size={14} />
          <span>{t('settings.translateInfoBanner')}</span>
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      {renderTranslateInfoBanner()}
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
      {renderSilenceDurationOnlySetting()}
      {renderModelSettings()}
      {renderTranscriptSettings()}
      {renderNoiseReductionSettings()}
      {renderTransportTypeSettings()}
      {renderModelConfigurationSettings()}
      {renderReasoningEffortSettings()}
      {renderGeminiVadSettings()}
      {renderPalabraAISettings()}
      {renderVolcengineSTSettings()}
      {renderVolcengineAST2Settings()}
      {renderZoomAISettings()}
      {renderSonioxSettings()}
      {renderLocalInferenceSettings()}
      {renderLocalNativeSettings()}
    </Fragment>
  );
};

export default ProviderSpecificSettings; 
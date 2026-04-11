import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Cpu, Zap, HelpCircle, ChevronDown, ChevronUp, CheckCircle, AlertCircle, ExternalLink, X } from 'lucide-react';
import { OpenAIIcon, GeminiIcon, PalabraAIIcon, KizunaAIIcon, VolcengineIcon } from '../../Icons/ProviderIcons';
import { useTranslation, Trans } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import {
  useProvider,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useIsApiKeyValid,
  useSetProvider,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useValidateApiKey,
  useIsValidating,
  useValidationMessage,
  useIsKizunaKeyFetching,
  useKizunaKeyError,
  useSetUIMode,
  useNavigateToSettings,
  useLocalInferenceSettings,
} from '../../../stores/settingsStore';
import { Provider, ProviderType } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../../lib/auth/hooks';
import { isElectron } from '../../../utils/environment';
import { useAnalytics } from '../../../lib/analytics';
import { useModelStore } from '../../../stores/modelStore';
import { useAudioContext } from '../../../stores/audioStore';
import {
  getManifestEntry,
  getTranslationModel,
  getTtsModelsForLanguage,
} from '../../../lib/local-inference/modelManifest';

const TUTORIAL_URLS: Partial<Record<ProviderType, string>> = {
  [Provider.OPENAI]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
  [Provider.GEMINI]: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',
  [Provider.PALABRA_AI]: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',
  [Provider.OPENAI_COMPATIBLE]: 'https://sokuji.kizuna.ai/docs/tutorials/openai-compatible-setup',
  [Provider.VOLCENGINE_AST2]: 'https://sokuji.kizuna.ai/docs/tutorials/volcengine-ast2-setup',
  [Provider.LOCAL_INFERENCE]: 'https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup',
};

const DISMISSED_KEY = 'sokuji-dismissed-tutorials';

interface ProviderSectionProps {
  isSessionActive: boolean;
  /** Additional class name */
  className?: string;
}

const ProviderSection: React.FC<ProviderSectionProps> = ({
  isSessionActive,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const { getToken, isSignedIn } = useAuth();

  // Settings store
  const provider = useProvider();
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const kizunaAISettings = useKizunaAISettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();
  const isApiKeyValid = useIsApiKeyValid();

  const setProvider = useSetProvider();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const validateApiKey = useValidateApiKey();
  const isValidating = useIsValidating();
  const validationMessage = useValidationMessage();
  const isKizunaKeyFetching = useIsKizunaKeyFetching();
  const kizunaKeyError = useKizunaKeyError();
  const setUIMode = useSetUIMode();
  const navigateToSettings = useNavigateToSettings();

  // Local inference model info
  const localInferenceSettings = useLocalInferenceSettings();
  const { isSystemAudioCaptureEnabled } = useAudioContext();
  // Read model download statuses reactively so participant status updates when models are downloaded
  const modelStatuses = useModelStore(state => state.modelStatuses);
  const participantModelStatus = useMemo(() => {
    if (provider !== Provider.LOCAL_INFERENCE) return null;
    return useModelStore.getState().getParticipantModelStatus(
      localInferenceSettings.sourceLanguage,
      localInferenceSettings.targetLanguage,
      localInferenceSettings.asrModel,
      localInferenceSettings.translationModel || undefined,
    );
  }, [provider, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage, localInferenceSettings.asrModel, localInferenceSettings.translationModel, modelStatuses]);

  const [isProviderExpanded, setIsProviderExpanded] = useState(false);

  const [dismissedTutorials, setDismissedTutorials] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      if (!stored) return new Set();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
    } catch { return new Set(); }
  });

  const dismissTutorial = (providerId: string) => {
    const updated = new Set(dismissedTutorials);
    updated.add(providerId);
    setDismissedTutorials(updated);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...updated]));
  };

  const tutorialUrl = TUTORIAL_URLS[provider];

  const openExternalUrl = (url: string) => {
    if (isElectron() && (window as any).electron?.invoke) {
      (window as any).electron.invoke('open-external', url);
    } else {
      window.open(url, '_blank');
    }
  };

  // Get all available providers
  const availableProviders = useMemo(() => {
    return ProviderConfigFactory.getAllConfigs();
  }, []);

  // Get current API key based on provider
  const getCurrentApiKey = () => {
    switch (provider) {
      case Provider.OPENAI:
        return openAISettings.apiKey;
      case Provider.GEMINI:
        return geminiSettings.apiKey;
      case Provider.OPENAI_COMPATIBLE:
        return openAICompatibleSettings.apiKey;
      case Provider.PALABRA_AI:
        return palabraAISettings.clientId;
      case Provider.KIZUNA_AI:
        return kizunaAISettings.apiKey || '';
      case Provider.VOLCENGINE_ST:
        return volcengineSTSettings.accessKeyId;
      case Provider.VOLCENGINE_AST2:
        return volcengineAST2Settings.appId;
      default:
        return '';
    }
  };

  // Update API key based on provider
  const updateApiKey = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ apiKey: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ apiKey: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ apiKey: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ clientId: value });
        break;
      case Provider.KIZUNA_AI:
        console.warn('KizunaAI API key is managed automatically');
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ accessKeyId: value });
        break;
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ appId: value });
        break;
    }
  };

  // Validate API key
  const handleValidateApiKey = async () => {
    const getAuthToken = provider === Provider.KIZUNA_AI && isSignedIn && getToken ?
      () => getToken() : undefined;

    const result = await validateApiKey(getAuthToken);

    trackEvent('api_key_validated', {
      provider: provider,
      success: result.valid === true
    });
  };

  // Handle provider switching
  const handleProviderChange = (newProvider: ProviderType) => {
    const oldProvider = provider;
    setProvider(newProvider);

    trackEvent('provider_switched', {
      from_provider: oldProvider || 'default',
      to_provider: newProvider,
      during_session: isSessionActive
    });

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

  // Get provider info by ID
  const getProviderInfoById = (providerId: ProviderType) => {
    switch (providerId) {
      case Provider.OPENAI:
        return {
          name: t('providers.openai.name'),
          icon: OpenAIIcon,
          description: t('providers.openai.description')
        };
      case Provider.GEMINI:
        return {
          name: t('providers.gemini.name'),
          icon: GeminiIcon,
          description: t('providers.gemini.description')
        };
      case Provider.OPENAI_COMPATIBLE:
        return {
          name: t('providers.openaiCompatible.name', 'OpenAI Compatible API'),
          icon: Zap,
          description: t('providers.openaiCompatible.description', 'Custom OpenAI-compatible endpoint')
        };
      case Provider.PALABRA_AI:
        return {
          name: t('providers.palabraai.name'),
          icon: PalabraAIIcon,
          description: t('providers.palabraai.description')
        };
      case Provider.KIZUNA_AI:
        return {
          name: t('providers.kizunaai.name'),
          icon: KizunaAIIcon,
          description: t('providers.kizunaai.description')
        };
      case Provider.VOLCENGINE_ST:
        return {
          name: t('providers.volcengine_st.name'),
          icon: VolcengineIcon,
          description: t('providers.volcengine_st.description')
        };
      case Provider.VOLCENGINE_AST2:
        return {
          name: t('providers.volcengine_ast2.name'),
          icon: VolcengineIcon,
          description: t('providers.volcengine_ast2.description')
        };
      case Provider.LOCAL_INFERENCE:
        return {
          name: t('providers.local_inference.name', 'Local (Offline)'),
          icon: KizunaAIIcon,
          description: t('providers.local_inference.description', 'Offline ASR + Translation + TTS')
        };
      default:
        return {
          name: t('providers.unknown.name'),
          icon: HelpCircle,
          description: t('providers.unknown.description')
        };
    }
  };

  const providerInfo = getProviderInfoById(provider);
  const currentApiKey = getCurrentApiKey();

  return (
    <div className={`config-section provider-section ${className}`} id="provider-section">
      <h3>
        <Cpu size={18} />
        <span>{t('simpleSettings.provider', 'Provider')}</span>
        <Tooltip
          content={
            <div>
              <p>{t('settings.providerTooltip')}</p>
              <p style={{ marginTop: '8px' }}>{t('simpleSettings.apiKeyHelpTooltip2')}</p>
              <a
                href="https://sokuji.kizuna.ai/docs/ai-providers"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#10a37f', textDecoration: 'underline' }}
              >
                https://sokuji.kizuna.ai/docs/ai-providers
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
          onClick={() => !isSessionActive && availableProviders.length > 1 && setIsProviderExpanded(!isProviderExpanded)}
        >
          <div className="provider-icon">{React.createElement(providerInfo.icon, { size: 24 })}</div>
          <div className="provider-details">
            <div className="provider-main-info">
              <div className="provider-name">{providerInfo.name}</div>
              <div className="provider-description">{providerInfo.description}</div>
            </div>
            {!isSessionActive && availableProviders.length > 1 && (
              <div className="provider-toggle">
                {isProviderExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            )}
          </div>
        </div>

        {isProviderExpanded && !isSessionActive && (
          <div className="provider-options">
            {availableProviders
              .filter(p => p.id !== provider)
              .map((p) => {
                const optionInfo = getProviderInfoById(p.id as ProviderType);

                return (
                  <div
                    key={p.id}
                    className="provider-option"
                    onClick={() => { handleProviderChange(p.id as ProviderType); setIsProviderExpanded(false); }}
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

      {/* API Endpoint Input - Only for OpenAI Compatible */}
      {provider === Provider.OPENAI_COMPATIBLE && (
        <div className="endpoint-input-group">
          <input
            type="text"
            value={openAICompatibleSettings.customEndpoint}
            onChange={(e) => updateOpenAICompatibleSettings({ customEndpoint: e.target.value })}
            placeholder={t('providers.openaiCompatible.customEndpointPlaceholder', 'https://your-api-endpoint.com')}
            className="endpoint-input"
            disabled={isSessionActive}
          />
        </div>
      )}

      {/* API Key Input or Kizuna AI Status or Local Inference (no key needed) */}
      {provider === Provider.LOCAL_INFERENCE ? (
        <div className="local-inference-info">
          <div className="model-info">
            <div className="model-inline">
              {(() => {
                const asrReady = localInferenceSettings.asrModel && modelStatuses[localInferenceSettings.asrModel] === 'downloaded';
                return (
                  <button type="button" className="model-chip" onClick={() => { setUIMode('advanced'); setTimeout(() => navigateToSettings('model-asr'), 100); }}>
                    <span className="model-chip-label">{t('providers.local_inference.modelAsr', 'ASR')}</span>
                    <span className={`model-chip-value ${asrReady ? 'model-ok' : 'model-warn'}`}>
                      {asrReady ? localInferenceSettings.asrModel : t('common.none', 'None')}
                    </span>
                  </button>
                );
              })()}
              {(() => {
                const id = localInferenceSettings.translationModel
                  || getTranslationModel(localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage)?.id;
                const translationReady = id && modelStatuses[id] === 'downloaded';
                return (
                  <button type="button" className="model-chip" onClick={() => { setUIMode('advanced'); setTimeout(() => navigateToSettings('model-translation'), 100); }}>
                    <span className="model-chip-label">{t('providers.local_inference.modelTranslation', 'Translation')}</span>
                    <span className={`model-chip-value ${translationReady ? 'model-ok' : 'model-warn'}`}>
                      {translationReady ? id : t('common.none', 'None')}
                    </span>
                  </button>
                );
              })()}
              {(() => {
                const id = localInferenceSettings.ttsModel
                  || getTtsModelsForLanguage(localInferenceSettings.targetLanguage).find(m => m.isCloudModel || modelStatuses[m.id] === 'downloaded')?.id;
                const ttsEntry = id ? getManifestEntry(id) : undefined;
                const ttsReady = id && (ttsEntry?.isCloudModel || modelStatuses[id] === 'downloaded');
                return (
                  <button type="button" className="model-chip" onClick={() => { setUIMode('advanced'); setTimeout(() => navigateToSettings('model-tts'), 100); }}>
                    <span className="model-chip-label">{t('providers.local_inference.modelTts', 'TTS')}</span>
                    <span className={`model-chip-value ${ttsReady ? 'model-ok' : 'model-warn'}`}>
                      {ttsReady ? (ttsEntry?.name || id) : t('common.none', 'None')}
                    </span>
                  </button>
                );
              })()}
            </div>
            {isSystemAudioCaptureEnabled && participantModelStatus && (
              <div className="participant-inline">
                <div className="participant-header">
                  <span className="participant-label">{t('providers.local_inference.participant', 'Participant')}</span>
                  <span className="participant-hint">
                    {t('settings.participantModelHint', 'Switch to {{source}} → {{target}} to change participant models', {
                      source: localInferenceSettings.targetLanguage,
                      target: localInferenceSettings.sourceLanguage,
                    })}
                  </span>
                </div>
                <div className="model-inline">
                  <button type="button" className="model-chip" onClick={() => { setUIMode('advanced'); setTimeout(() => navigateToSettings('model-asr'), 100); }}>
                    <span className="model-chip-label">{t('providers.local_inference.modelAsr', 'ASR')}</span>
                    {participantModelStatus.asrAvailable ? (
                      <span className="model-chip-value model-ok">
                        {participantModelStatus.asrModelId}
                        {participantModelStatus.asrFallback && ` ↻`}
                      </span>
                    ) : (
                      <span className="model-chip-value model-warn">✗</span>
                    )}
                  </button>
                  <button type="button" className="model-chip" onClick={() => { setUIMode('advanced'); setTimeout(() => navigateToSettings('model-translation'), 100); }}>
                    <span className="model-chip-label">{t('providers.local_inference.modelTranslation', 'Translation')}</span>
                    {participantModelStatus.translationAvailable ? (
                      <span className="model-chip-value model-ok">{participantModelStatus.translationModelId}</span>
                    ) : (
                      <span className="model-chip-value model-warn">✗</span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : provider !== Provider.KIZUNA_AI ? (
        provider === Provider.VOLCENGINE_AST2 ? (
          // Volcengine AST2 requires both APP ID and Access Token
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={volcengineAST2Settings.appId}
                onChange={(e) => updateVolcengineAST2Settings({ appId: e.target.value })}
                placeholder={t('providers.volcengine_ast2.appIdPlaceholder', 'APP ID')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={volcengineAST2Settings.accessToken}
                onChange={(e) => updateVolcengineAST2Settings({ accessToken: e.target.value })}
                placeholder={t('providers.volcengine_ast2.accessTokenPlaceholder', 'Access Token')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!volcengineAST2Settings.appId || !volcengineAST2Settings.accessToken || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
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
          </div>
        ) : provider === Provider.VOLCENGINE_ST ? (
          // Volcengine ST requires both Access Key ID and Secret Access Key
          <div className="volcengine-st-credentials-group">
            <div className="api-key-input-group">
              <input
                type="text"
                value={volcengineSTSettings.accessKeyId}
                onChange={(e) => updateVolcengineSTSettings({ accessKeyId: e.target.value })}
                placeholder={t('providers.volcengine_st.accessKeyIdPlaceholder', 'Access Key ID')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={volcengineSTSettings.secretAccessKey}
                onChange={(e) => updateVolcengineSTSettings({ secretAccessKey: e.target.value })}
                placeholder={t('providers.volcengine_st.secretAccessKeyPlaceholder', 'Secret Access Key')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!volcengineSTSettings.accessKeyId || !volcengineSTSettings.secretAccessKey || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
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
          </div>
        ) : provider === Provider.PALABRA_AI ? (
          // PalabraAI requires both Client ID and Client Secret
          <div className="palabraai-credentials-group">
            <div className="api-key-input-group">
              <input
                type="password"
                value={palabraAISettings.clientId}
                onChange={(e) => updatePalabraAISettings({ clientId: e.target.value })}
                placeholder={t('providers.palabraai.clientIdPlaceholder', 'Client ID')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
            </div>
            <div className="api-key-input-group">
              <input
                type="password"
                value={palabraAISettings.clientSecret}
                onChange={(e) => updatePalabraAISettings({ clientSecret: e.target.value })}
                placeholder={t('providers.palabraai.clientSecretPlaceholder', 'Client Secret')}
                className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
                disabled={isSessionActive}
              />
              <button
                className="validate-button"
                onClick={handleValidateApiKey}
                disabled={!palabraAISettings.clientId || !palabraAISettings.clientSecret || isValidating || isSessionActive}
                title={t('simpleSettings.validate')}
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
          </div>
        ) : (
          // Standard API key input for other providers
          <div className="api-key-input-group">
            <input
              type="password"
              value={currentApiKey}
              onChange={(e) => updateApiKey(e.target.value)}
              placeholder={t('simpleSettings.apiKeyPlaceholder')}
              className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
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
        )
      ) : (
        isSignedIn ? (
          isKizunaKeyFetching ? (
            <div className="api-key-info">
              <span className="spinner" />
              <span>{t('simpleSettings.fetchingApiKey', 'Fetching API key from your account...')}</span>
            </div>
          ) : kizunaKeyError ? (
            <div className="api-key-warning">
              <AlertCircle size={16} className="warning-icon" />
              <span>{kizunaKeyError}</span>
            </div>
          ) : (
            <div className="api-key-info">
              <CheckCircle size={16} className="success-icon" />
              <span>{t('simpleSettings.autoAuthenticated', 'Automatically authenticated via your account')}</span>
            </div>
          )
        ) : (
          <div className="api-key-warning">
            <AlertCircle size={16} className="warning-icon" />
            <span>{t('common.signInRequired', 'Please sign in to use Kizuna AI as your provider')}</span>
          </div>
        )
      )}

      {tutorialUrl && !dismissedTutorials.has(provider) && (
        <div className="tutorial-link">
          <a href={tutorialUrl} onClick={(e) => { e.preventDefault(); openExternalUrl(tutorialUrl); }}>
            <ExternalLink size={12} />
            {t('simpleSettings.setupGuide', 'Setup guide')}
          </a>
          <button className="tutorial-dismiss" onClick={() => dismissTutorial(provider)} title={t('common.dismiss', 'Dismiss')}>
            <X size={12} />
          </button>
        </div>
      )}

      {validationMessage && (
        <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
          {provider === Provider.LOCAL_INFERENCE && !isApiKeyValid ? (
            <Trans
              i18nKey="settings.localInferenceModelsRequired"
              components={{
                settingsLink: <a
                  className="models-link"
                  onClick={(e) => {
                    e.preventDefault();
                    setUIMode('advanced');
                    setTimeout(() => navigateToSettings('model-management'), 100);
                  }}
                />
              }}
            />
          ) : (
            validationMessage
          )}
        </div>
      )}
    </div>
  );
};

export default ProviderSection;

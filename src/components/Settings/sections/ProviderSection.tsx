import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Key, Bot, Sparkles, Zap, AudioLines, User, HelpCircle, CircleHelp, ChevronDown, ChevronUp, CheckCircle, AlertCircle, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import {
  useProvider,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useVolcengineSTSettings,
  useIsApiKeyValid,
  useSetProvider,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateVolcengineST,
  useValidateApiKey,
  useIsValidating,
  useValidationMessage,
  useIsKizunaKeyFetching,
  useKizunaKeyError
} from '../../../stores/settingsStore';
import { Provider, ProviderType } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { useAuth } from '../../../lib/auth/hooks';
import { useAnalytics } from '../../../lib/analytics';

interface ProviderSectionProps {
  isSessionActive: boolean;
  /** Use expandable card style (for simple mode) */
  expandableStyle?: boolean;
  /** Show experimental badge for PalabraAI */
  showExperimentalBadge?: boolean;
  /** Additional class name */
  className?: string;
}

const ProviderSection: React.FC<ProviderSectionProps> = ({
  isSessionActive,
  expandableStyle = false,
  showExperimentalBadge = true,
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
  const isApiKeyValid = useIsApiKeyValid();

  const setProvider = useSetProvider();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const validateApiKey = useValidateApiKey();
  const isValidating = useIsValidating();
  const validationMessage = useValidationMessage();
  const isKizunaKeyFetching = useIsKizunaKeyFetching();
  const kizunaKeyError = useKizunaKeyError();

  const [isProviderExpanded, setIsProviderExpanded] = useState(false);

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
          icon: Bot,
          description: t('providers.openai.description')
        };
      case Provider.GEMINI:
        return {
          name: t('providers.gemini.name'),
          icon: Sparkles,
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
          icon: AudioLines,
          description: t('providers.palabraai.description')
        };
      case Provider.KIZUNA_AI:
        return {
          name: t('providers.kizunaai.name'),
          icon: User,
          description: t('providers.kizunaai.description')
        };
      case Provider.VOLCENGINE_ST:
        return {
          name: t('providers.volcengine_st.name'),
          icon: AudioLines,
          description: t('providers.volcengine_st.description')
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
    <div className={`config-section api-key-section ${className}`} id="api-key-section">
      <h3>
        <Key size={18} />
        <span>{t('simpleSettings.apiKey')}</span>
        <Tooltip
          content={
            <div>
              <p>{t('simpleSettings.apiKeyHelpTooltip')}</p>
              <p style={{ marginTop: '8px' }}>{t('simpleSettings.apiKeyHelpTooltip2')}</p>
              <a
                href="https://kizuna-ai-lab.github.io/sokuji/supported-ai-providers.html"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#10a37f', textDecoration: 'underline' }}
              >
                https://kizuna-ai-lab.github.io/sokuji/supported-ai-providers.html
              </a>
            </div>
          }
          position="top"
          icon="help"
          maxWidth={350}
        />
      </h3>

      {expandableStyle ? (
        // Expandable card style for simple mode
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
                .filter(p => p.id !== provider)
                .map((p) => {
                  const optionInfo = getProviderInfoById(p.id as ProviderType);

                  return (
                    <div
                      key={p.id}
                      className="provider-option"
                      onClick={() => handleProviderChange(p.id as ProviderType)}
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
      ) : (
        // Dropdown style for advanced mode
        <div className="setting-item">
          <div className="setting-label">
            <span>
              {t('settings.providerType', 'Provider')}
              <Tooltip
                content={t('settings.providerTooltip')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
              </Tooltip>
            </span>
          </div>
          <div className="provider-selection-wrapper">
            <select
              className="select-dropdown"
              value={provider || Provider.OPENAI}
              onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
              disabled={isSessionActive}
            >
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
            {showExperimentalBadge && provider === Provider.PALABRA_AI && (
              <div className="experimental-icon-wrapper">
                <FlaskConical size={16} className="experimental-icon" />
                <div className="experimental-tooltip">
                  {t('settings.experimentalFeatureTooltip', 'This is an experimental feature and may be unstable.')}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* API Key Input or Kizuna AI Status */}
      {provider !== Provider.KIZUNA_AI ? (
        provider === Provider.VOLCENGINE_ST ? (
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

      {validationMessage && (
        <div className={`validation-message ${isApiKeyValid ? 'success' : 'error'}`}>
          {validationMessage}
        </div>
      )}
    </div>
  );
};

export default ProviderSection;

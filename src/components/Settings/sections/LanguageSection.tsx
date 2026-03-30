import React, { useMemo, useCallback } from 'react';
import { Globe, Languages, ArrowLeftRight, CircleHelp, AlertTriangle, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import {
  useProvider,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useLocalInferenceSettings,
  useVolcengineSTSettings,
  useVolcengineAST2Settings,
  useSetUILanguage,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateKizunaAI,
  useUpdateLocalInference,
  useUpdateVolcengineST,
  useUpdateVolcengineAST2,
  useNavigateToSettings,
  useSetUIMode,
  useTextOnly,
  useSetTextOnly
} from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { changeLanguageWithLoad } from '../../../locales';
import { useAnalytics } from '../../../lib/analytics';
import { getTranslationTargetLanguages, getManifestByType, isTranslationModelCompatible } from '../../../lib/local-inference/modelManifest';
import { useModelStatuses, useModelInitialized } from '../../../stores/modelStore';

interface LanguageSectionProps {
  isSessionActive: boolean;
  /** Show interface language selector */
  showInterfaceLanguage?: boolean;
  /** Show translation languages selector */
  showTranslationLanguages?: boolean;
  /** Use simplified language list for interface (12 languages) */
  simplifiedInterfaceList?: boolean;
  /** Additional class name */
  className?: string;
}

const LanguageSection: React.FC<LanguageSectionProps> = ({
  isSessionActive,
  showInterfaceLanguage = true,
  showTranslationLanguages = true,
  simplifiedInterfaceList = false,
  className = ''
}) => {
  const { t, i18n } = useTranslation();
  const { trackEvent } = useAnalytics();

  // Settings store
  const provider = useProvider();
  const openAISettings = useOpenAISettings();
  const geminiSettings = useGeminiSettings();
  const openAICompatibleSettings = useOpenAICompatibleSettings();
  const palabraAISettings = usePalabraAISettings();
  const kizunaAISettings = useKizunaAISettings();
  const localInferenceSettings = useLocalInferenceSettings();
  const volcengineSTSettings = useVolcengineSTSettings();
  const volcengineAST2Settings = useVolcengineAST2Settings();

  const modelStatuses = useModelStatuses();
  const modelInitialized = useModelInitialized();
  const navigateToSettings = useNavigateToSettings();
  const setUIMode = useSetUIMode();

  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();

  const setUILanguage = useSetUILanguage();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateKizunaAISettings = useUpdateKizunaAI();
  const updateVolcengineSTSettings = useUpdateVolcengineST();
  const updateVolcengineAST2Settings = useUpdateVolcengineAST2();
  const updateLocalInferenceSettings = useUpdateLocalInference();

  // Get provider configuration with fallback
  const providerConfig: ProviderConfig = useMemo(() => {
    try {
      return ProviderConfigFactory.getConfig(provider);
    } catch {
      return ProviderConfigFactory.getConfig(Provider.OPENAI);
    }
  }, [provider]);

  // Get current provider settings
  const currentProviderSettings = useMemo(() => {
    switch (provider) {
      case Provider.OPENAI:
        return openAISettings;
      case Provider.GEMINI:
        return geminiSettings;
      case Provider.OPENAI_COMPATIBLE:
        return openAICompatibleSettings;
      case Provider.PALABRA_AI:
        return palabraAISettings;
      case Provider.KIZUNA_AI:
        return kizunaAISettings;
      case Provider.VOLCENGINE_ST:
        return volcengineSTSettings;
      case Provider.VOLCENGINE_AST2:
        return volcengineAST2Settings;
      case Provider.LOCAL_INFERENCE:
        return localInferenceSettings;
      default:
        return openAISettings;
    }
  }, [provider, openAISettings, geminiSettings, openAICompatibleSettings, palabraAISettings, kizunaAISettings, volcengineSTSettings, volcengineAST2Settings, localInferenceSettings]);

  // Update source language
  const updateSourceLanguage = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ sourceLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ sourceLanguage: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ sourceLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ sourceLanguage: value });
        break;
      case Provider.KIZUNA_AI:
        updateKizunaAISettings({ sourceLanguage: value });
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ sourceLanguage: value });
        break;
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ sourceLanguage: value });
        break;
      case Provider.LOCAL_INFERENCE: {
        const availableTargets = getTranslationTargetLanguages(value);
        const currentTarget = localInferenceSettings.targetLanguage;
        const updates: Record<string, string> = { sourceLanguage: value };
        if (!availableTargets.some(t => t.value === currentTarget)) {
          updates.targetLanguage = availableTargets[0]?.value || 'en';
        }
        updateLocalInferenceSettings(updates);
        break;
      }
    }
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'source'
    });
  };

  // Update target language
  const updateTargetLanguage = (value: string) => {
    switch (provider) {
      case Provider.OPENAI:
        updateOpenAISettings({ targetLanguage: value });
        break;
      case Provider.GEMINI:
        updateGeminiSettings({ targetLanguage: value });
        break;
      case Provider.OPENAI_COMPATIBLE:
        updateOpenAICompatibleSettings({ targetLanguage: value });
        break;
      case Provider.PALABRA_AI:
        updatePalabraAISettings({ targetLanguage: value });
        break;
      case Provider.KIZUNA_AI:
        updateKizunaAISettings({ targetLanguage: value });
        break;
      case Provider.VOLCENGINE_ST:
        updateVolcengineSTSettings({ targetLanguage: value });
        break;
      case Provider.VOLCENGINE_AST2:
        updateVolcengineAST2Settings({ targetLanguage: value });
        break;
      case Provider.LOCAL_INFERENCE:
        updateLocalInferenceSettings({ targetLanguage: value });
        break;
    }
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'target'
    });
  };

  // Swap source and target languages
  const handleSwapLanguages = useCallback(() => {
    const src = currentProviderSettings?.sourceLanguage;
    const tgt = currentProviderSettings?.targetLanguage;
    if (!src || !tgt || src === 'auto') return;

    if (provider === Provider.LOCAL_INFERENCE) {
      const availableTargets = getTranslationTargetLanguages(tgt);
      const newTarget = availableTargets.some(l => l.value === src) ? src : availableTargets[0]?.value || 'en';
      updateLocalInferenceSettings({ sourceLanguage: tgt, targetLanguage: newTarget });
    } else {
      updateSourceLanguage(tgt);
      updateTargetLanguage(src);
    }
  }, [provider, currentProviderSettings, updateLocalInferenceSettings, updateSourceLanguage, updateTargetLanguage]);

  // Dynamic target languages for LOCAL_INFERENCE, static for others
  const targetLanguages = useMemo(() => {
    if (provider === Provider.LOCAL_INFERENCE) {
      return getTranslationTargetLanguages(currentProviderSettings.sourceLanguage || 'ja');
    }
    return providerConfig.languages;
  }, [provider, providerConfig.languages, currentProviderSettings.sourceLanguage]);

  // Simplified interface language list (12 most common languages)
  const simplifiedLanguages = [
    { value: 'en', label: 'English' },
    { value: 'zh_CN', label: '中文 (简体)' },
    { value: 'zh_TW', label: '中文 (繁體)' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'pt_BR', label: 'Português (Brasil)' },
    { value: 'pt_PT', label: 'Português (Portugal)' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'hi', label: 'हिन्दी' }
  ];

  // Full interface language list (35 languages)
  const fullLanguages = [
    { value: 'en', label: 'English' },
    { value: 'zh_CN', label: '中文 (简体)' },
    { value: 'hi', label: 'हिन्दी' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'ar', label: 'العربية' },
    { value: 'bn', label: 'বাংলা' },
    { value: 'pt_BR', label: 'Português (Brasil)' },
    { value: 'ru', label: 'Русский' },
    { value: 'ja', label: '日本語' },
    { value: 'de', label: 'Deutsch' },
    { value: 'ko', label: '한국어' },
    { value: 'fa', label: 'فارسی' },
    { value: 'tr', label: 'Türkçe' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'it', label: 'Italiano' },
    { value: 'th', label: 'ไทย' },
    { value: 'pl', label: 'Polski' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'ms', label: 'Bahasa Melayu' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'zh_TW', label: '中文 (繁體)' },
    { value: 'pt_PT', label: 'Português (Portugal)' },
    { value: 'uk', label: 'Українська' },
    { value: 'ta', label: 'தமிழ்' },
    { value: 'te', label: 'తెలుగు' },
    { value: 'he', label: 'עברית' },
    { value: 'fil', label: 'Filipino' },
    { value: 'sv', label: 'Svenska' },
    { value: 'fi', label: 'Suomi' }
  ];

  const interfaceLanguages = simplifiedInterfaceList ? simplifiedLanguages : fullLanguages;

  // Check which model types are missing for current LOCAL_INFERENCE language pair
  const missingModelTypes = useMemo(() => {
    if (provider !== Provider.LOCAL_INFERENCE || !modelInitialized) return [];
    const missing: { label: string; navTarget: string }[] = [];
    const src = localInferenceSettings.sourceLanguage;
    const tgt = localInferenceSettings.targetLanguage;

    // Check ASR models (offline + streaming)
    const allAsr = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    const hasAsr = allAsr.some(m =>
      (m.multilingual || m.languages.includes(src)) && modelStatuses[m.id] === 'downloaded'
    );
    if (!hasAsr) missing.push({ label: t('settings.modelTypeAsr', 'ASR'), navTarget: 'model-asr' });

    // Check Translation models
    const allTrans = getManifestByType('translation');
    const hasTrans = allTrans.some(m =>
      isTranslationModelCompatible(m, src, tgt) && modelStatuses[m.id] === 'downloaded'
    );
    if (!hasTrans) missing.push({ label: t('settings.modelTypeTranslation', 'Translation'), navTarget: 'model-translation' });

    // Check TTS models
    const allTts = getManifestByType('tts');
    const hasTts = allTts.some(m =>
      m.languages.includes(tgt) && modelStatuses[m.id] === 'downloaded'
    );
    if (!hasTts) missing.push({ label: t('settings.modelTypeTts', 'TTS'), navTarget: 'model-tts' });

    return missing;
  }, [provider, modelInitialized, modelStatuses, localInferenceSettings.sourceLanguage, localInferenceSettings.targetLanguage, t]);

  return (
    <>
      {/* Interface Language Section */}
      {showInterfaceLanguage && (
        <div className={`config-section ${className}`}>
          <h3>
            <Globe size={18} />
            <span>{t('simpleConfig.interfaceLanguage')}</span>
            <Tooltip
              content={t('simpleConfig.interfaceLanguageDesc')}
              position="top"
              icon="help"
            />
          </h3>

          <div className="setting-row">
            <select
              value={i18n.language}
              onChange={async (e) => {
                const oldLanguage = i18n.language;
                const newLanguage = e.target.value;
                await changeLanguageWithLoad(newLanguage);
                setUILanguage(newLanguage);
                trackEvent('language_changed', {
                  from_language: oldLanguage,
                  to_language: newLanguage,
                  language_type: 'ui'
                });
              }}
              disabled={isSessionActive}
              className="language-select"
            >
              {interfaceLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Translation Languages Section */}
      {showTranslationLanguages && (
        <div className={`config-section ${className}`} id="languages-section">
          <h3>
            <Languages size={18} />
            <span>{t('simpleConfig.translationLanguages')}</span>
            <Tooltip
              content={t('simpleConfig.translationLanguagesDesc')}
              position="top"
              icon="help"
            />
          </h3>

          <div className="language-pair-row">
            <div className="language-select-group">
              <label>{t('simpleConfig.yourLanguage')}</label>
              <select
                value={currentProviderSettings.sourceLanguage || 'auto'}
                onChange={(e) => updateSourceLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {provider !== Provider.LOCAL_INFERENCE && (
                  <option value="auto">{t('common.autoDetect')}</option>
                )}
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="language-arrow">
              <button
                className="language-swap-btn"
                onClick={handleSwapLanguages}
                disabled={isSessionActive || currentProviderSettings.sourceLanguage === 'auto'}
                title={t('simpleConfig.swapLanguages', 'Swap languages')}
                type="button"
              >
                <ArrowLeftRight size={18} />
              </button>
            </div>

            <div className="language-select-group">
              <label>{t('simpleConfig.targetLanguage')}</label>
              <select
                value={currentProviderSettings.targetLanguage || 'en'}
                onChange={(e) => updateTargetLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {targetLanguages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {providerConfig.capabilities.textOnlyCapability === 'optional' && (
            <ToggleSwitch
              checked={textOnly}
              onChange={() => setTextOnly(!textOnly)}
              label={t('simpleConfig.textOnly', 'Text Only')}
              disabled={isSessionActive}
              tooltip={t('simpleConfig.textOnlyDesc', 'Show translation as text only, without generating an audio response')}
            />
          )}

          {provider === Provider.LOCAL_INFERENCE && missingModelTypes.length > 0 && (
            <div className="language-model-warning">
              <AlertTriangle size={14} />
              <span>
                {t('settings.missingModelsWarning', 'Missing {{types}} model(s) for this language pair.', { types: missingModelTypes.map(m => m.label).join(', ') })}
                {' '}
                {missingModelTypes.map((m, i) => (
                  <span key={m.navTarget}>
                    {i > 0 && ', '}
                    <a
                      className="language-model-warning__link"
                      onClick={() => {
                        setUIMode('advanced');
                        setTimeout(() => navigateToSettings(m.navTarget), 100);
                      }}
                    >
                      {t('settings.downloadModelType', 'Download {{type}}', { type: m.label })}
                    </a>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default LanguageSection;

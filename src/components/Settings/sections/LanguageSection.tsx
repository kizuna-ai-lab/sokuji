import React, { useMemo } from 'react';
import { Globe, Languages, ArrowRight, CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import {
  useProvider,
  useOpenAISettings,
  useGeminiSettings,
  useOpenAICompatibleSettings,
  usePalabraAISettings,
  useKizunaAISettings,
  useSetUILanguage,
  useUpdateOpenAI,
  useUpdateGemini,
  useUpdateOpenAICompatible,
  useUpdatePalabraAI,
  useUpdateKizunaAI
} from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../../../services/providers/ProviderConfig';
import { changeLanguageWithLoad } from '../../../locales';
import { useAnalytics } from '../../../lib/analytics';

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

  const setUILanguage = useSetUILanguage();
  const updateOpenAISettings = useUpdateOpenAI();
  const updateGeminiSettings = useUpdateGemini();
  const updateOpenAICompatibleSettings = useUpdateOpenAICompatible();
  const updatePalabraAISettings = useUpdatePalabraAI();
  const updateKizunaAISettings = useUpdateKizunaAI();

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
      default:
        return openAISettings;
    }
  }, [provider, openAISettings, geminiSettings, openAICompatibleSettings, palabraAISettings, kizunaAISettings]);

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
    }
    trackEvent('language_changed', {
      to_language: value,
      language_type: 'target'
    });
  };

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
                <option value="auto">{t('common.autoDetect')}</option>
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="language-arrow">
              <ArrowRight size={20} />
            </div>

            <div className="language-select-group">
              <label>{t('simpleConfig.targetLanguage')}</label>
              <select
                value={currentProviderSettings.targetLanguage || 'en'}
                onChange={(e) => updateTargetLanguage(e.target.value)}
                disabled={isSessionActive}
                className="language-select"
              >
                {providerConfig.languages.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LanguageSection;

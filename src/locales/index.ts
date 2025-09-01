import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Only import English as the fallback language (always needed)
import enTranslation from './en/translation.json';

// Cache for loaded translations
const translationCache: Record<string, any> = {
  en: enTranslation,
};

// Lazy loaders for all other languages
const translationLoaders: Record<string, () => Promise<any>> = {
  ja: () => import('./ja/translation.json'),
  zh_CN: () => import('./zh_CN/translation.json'),
  zh_TW: () => import('./zh_TW/translation.json'),
  fr: () => import('./fr/translation.json'),
  es: () => import('./es/translation.json'),
  de: () => import('./de/translation.json'),
  ko: () => import('./ko/translation.json'),
  pt_BR: () => import('./pt_BR/translation.json'),
  pt_PT: () => import('./pt_PT/translation.json'),
  id: () => import('./id/translation.json'),
  it: () => import('./it/translation.json'),
  hi: () => import('./hi/translation.json'),
  fi: () => import('./fi/translation.json'),
  fil: () => import('./fil/translation.json'),
  sv: () => import('./sv/translation.json'),
  ru: () => import('./ru/translation.json'),
  ta: () => import('./ta/translation.json'),
  te: () => import('./te/translation.json'),
  th: () => import('./th/translation.json'),
  tr: () => import('./tr/translation.json'),
  uk: () => import('./uk/translation.json'),
  vi: () => import('./vi/translation.json'),
  bn: () => import('./bn/translation.json'),
  fa: () => import('./fa/translation.json'),
  nl: () => import('./nl/translation.json'),
  pl: () => import('./pl/translation.json'),
  ms: () => import('./ms/translation.json'),
  he: () => import('./he/translation.json'),
  ar: () => import('./ar/translation.json'),
};

// Only preload English
const resources = {
  en: {
    translation: enTranslation,
  },
};

// Function to load a translation on demand
export async function loadTranslation(languageCode: string): Promise<void> {
  // Skip if already loaded
  if (translationCache[languageCode]) {
    // Re-add the resource bundle to ensure it's available
    // The last two parameters (true, true) mean: deep merge and overwrite
    i18n.addResourceBundle(languageCode, 'translation', translationCache[languageCode], true, true);
    return;
  }

  // Load the translation
  const loader = translationLoaders[languageCode];
  if (loader) {
    try {
      console.log(`[Sokuji] Loading translation for ${languageCode}...`);
      const startTime = performance.now();
      
      const module = await loader();
      const translation = module.default || module;
      
      // Cache the translation
      translationCache[languageCode] = translation;
      
      // Add to i18n resources with deep merge and overwrite
      i18n.addResourceBundle(languageCode, 'translation', translation, true, true);
      
      const endTime = performance.now();
      console.log(`[Sokuji] Loaded ${languageCode} translation in ${Math.round(endTime - startTime)}ms`);
    } catch (error) {
      console.error(`[Sokuji] Failed to load translation for ${languageCode}:`, error);
    }
  }
}

// Wrapper function to change language with translation loading
export async function changeLanguageWithLoad(lng: string): Promise<string> {
  // Load the translation first if it's not English
  if (lng && lng !== 'en') {
    await loadTranslation(lng);
  }
  
  // Now change the language - this will trigger re-renders
  await i18n.changeLanguage(lng);
  
  return lng;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false, // Disable debug mode to reduce startup overhead
    
    interpolation: {
      escapeValue: false, // React already does escaping
    },
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    
    react: {
      useSuspense: false,
    },
    
    // Don't preload any languages except the fallback
    preload: false,
    
    // Support country-specific language codes
    load: 'all', // Allow country-specific variations like zh_CN, pt_BR
    cleanCode: false, // Don't clean country codes from language codes
    
    // Explicitly list all supported languages
    supportedLngs: ['en', 'ja', 'zh_CN', 'zh_TW', 'fr', 'es', 'de', 'ko', 
                    'pt_BR', 'pt_PT', 'id', 'it', 'hi', 'fi', 'fil', 'sv', 
                    'ru', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'bn', 'fa', 
                    'nl', 'pl', 'ms', 'he', 'ar'],
    
    keySeparator: '.', // Use dot notation for nested keys
    
    // Return the key if translation is missing (no network calls)
    missingKeyHandler: false,
  });

// Listen for language changes and load translations on demand
i18n.on('languageChanged', async (lng) => {
  if (lng && lng !== 'en') {
    await loadTranslation(lng);
  }
});

// Load the detected language immediately after init (non-blocking)
const detectedLang = i18n.language;
if (detectedLang && detectedLang !== 'en') {
  // Load in the background without blocking startup
  setTimeout(() => {
    loadTranslation(detectedLang).catch(console.error);
  }, 0);
}

export default i18n;
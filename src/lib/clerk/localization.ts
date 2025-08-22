/**
 * Clerk localization loader
 * Maps i18n language codes to Clerk locale imports
 */

import { enUS } from '@clerk/localizations';

// Type for Clerk localization object
type ClerkLocalization = typeof enUS;

/**
 * Deep merge two objects, using values from source when they are not undefined/null
 * Falls back to fallback values when source values are undefined/null
 * @param fallback - The fallback object (English translations)
 * @param source - The source object (localized translations)
 * @returns Merged object with fallback for undefined values
 */
function deepMergeWithFallback(fallback: any, source: any): any {
  // If source is not an object, return it if defined, otherwise return fallback
  if (typeof source !== 'object' || source === null) {
    return source !== undefined && source !== null ? source : fallback;
  }
  
  // If fallback is not an object, return source
  if (typeof fallback !== 'object' || fallback === null) {
    return source;
  }
  
  // Create a new object with all keys from both objects
  const result: any = {};
  const allKeys = new Set([...Object.keys(fallback), ...Object.keys(source)]);
  
  for (const key of allKeys) {
    const fallbackValue = fallback[key];
    const sourceValue = source[key];
    
    if (sourceValue === undefined || sourceValue === null) {
      // Use fallback value if source is undefined or null
      result[key] = fallbackValue;
    } else if (typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      // Recursively merge nested objects
      result[key] = deepMergeWithFallback(fallbackValue, sourceValue);
    } else {
      // Use source value for all other cases (including arrays and primitives)
      result[key] = sourceValue;
    }
  }
  
  return result;
}

// Map of i18n language codes to Clerk locale import functions
const localeMap: Record<string, () => Promise<{ default: ClerkLocalization }>> = {
  // English (default)
  'en': async () => ({ default: enUS }),
  
  // Chinese
  'zh_CN': () => import('@clerk/localizations/zh-CN').then(m => ({ default: m.zhCN })),
  'zh_TW': () => import('@clerk/localizations/zh-TW').then(m => ({ default: m.zhTW })),
  
  // Japanese
  'ja': () => import('@clerk/localizations/ja-JP').then(m => ({ default: m.jaJP })),
  
  // Korean
  'ko': () => import('@clerk/localizations/ko-KR').then(m => ({ default: m.koKR })),
  
  // French
  'fr': () => import('@clerk/localizations/fr-FR').then(m => ({ default: m.frFR })),
  
  // Spanish
  'es': () => import('@clerk/localizations/es-ES').then(m => ({ default: m.esES })),
  
  // German
  'de': () => import('@clerk/localizations/de-DE').then(m => ({ default: m.deDE })),
  
  // Portuguese
  'pt_BR': () => import('@clerk/localizations/pt-BR').then(m => ({ default: m.ptBR })),
  'pt_PT': () => import('@clerk/localizations/pt-PT').then(m => ({ default: m.ptPT })),
  
  // Indonesian
  'id': () => import('@clerk/localizations/id-ID').then(m => ({ default: m.idID })),
  
  // Italian
  'it': () => import('@clerk/localizations/it-IT').then(m => ({ default: m.itIT })),
  
  // Hindi
  'hi': () => import('@clerk/localizations/hi-IN').then(m => ({ default: m.hiIN })),
  
  // Finnish
  'fi': () => import('@clerk/localizations/fi-FI').then(m => ({ default: m.fiFI })),
  
  // Filipino (using English as fallback since 'fil' is not available)
  'fil': async () => ({ default: enUS }),
  
  // Swedish
  'sv': () => import('@clerk/localizations/sv-SE').then(m => ({ default: m.svSE })),
  
  // Russian
  'ru': () => import('@clerk/localizations/ru-RU').then(m => ({ default: m.ruRU })),
  
  // Bengali
  'bn': () => import('@clerk/localizations/bn-IN').then(m => ({ default: m.bnIN })),
  
  // Tamil
  'ta': () => import('@clerk/localizations/ta-IN').then(m => ({ default: m.taIN })),
  
  // Telugu
  'te': () => import('@clerk/localizations/te-IN').then(m => ({ default: m.teIN })),
  
  // Thai
  'th': () => import('@clerk/localizations/th-TH').then(m => ({ default: m.thTH })),
  
  // Turkish
  'tr': () => import('@clerk/localizations/tr-TR').then(m => ({ default: m.trTR })),
  
  // Ukrainian
  'uk': () => import('@clerk/localizations/uk-UA').then(m => ({ default: m.ukUA })),
  
  // Vietnamese
  'vi': () => import('@clerk/localizations/vi-VN').then(m => ({ default: m.viVN })),
  
  // Persian/Farsi
  'fa': () => import('@clerk/localizations/fa-IR').then(m => ({ default: m.faIR })),
  
  // Dutch
  'nl': () => import('@clerk/localizations/nl-NL').then(m => ({ default: m.nlNL })),
  
  // Polish
  'pl': () => import('@clerk/localizations/pl-PL').then(m => ({ default: m.plPL })),
  
  // Malay
  'ms': () => import('@clerk/localizations/ms-MY').then(m => ({ default: m.msMY })),
  
  // Hebrew
  'he': () => import('@clerk/localizations/he-IL').then(m => ({ default: m.heIL })),
  
  // Arabic
  'ar': () => import('@clerk/localizations/ar-SA').then(m => ({ default: m.arSA })),
};

// Cache for loaded localizations
const localizationCache: Record<string, ClerkLocalization> = {
  'en': enUS, // Pre-cache English as it's already imported
};

/**
 * Load Clerk localization for the given language code
 * @param languageCode - The i18n language code (e.g., 'zh_CN', 'ja', 'fr')
 * @returns The Clerk localization object or English as fallback
 */
export async function loadClerkLocalization(languageCode: string): Promise<ClerkLocalization> {
  console.log(`[Clerk i18n] Loading localization for: ${languageCode}`);
  
  // Return cached localization if available
  if (localizationCache[languageCode]) {
    console.log(`[Clerk i18n] Using cached localization for: ${languageCode}`);
    return localizationCache[languageCode];
  }

  // If requesting English, return it directly (no merge needed)
  if (languageCode === 'en') {
    localizationCache[languageCode] = enUS;
    return enUS;
  }

  // Try to load the localization for the given language
  const loader = localeMap[languageCode];
  if (loader) {
    try {
      console.log(`[Clerk i18n] Dynamically importing localization for: ${languageCode}`);
      const module = await loader();
      const localization = module.default;
      
      // Merge with English to fill in any undefined values
      const mergedLocalization = deepMergeWithFallback(enUS, localization) as ClerkLocalization;
      
      // Cache the merged localization
      localizationCache[languageCode] = mergedLocalization;
      console.log(`[Clerk i18n] Successfully loaded and merged localization for: ${languageCode}`);
      return mergedLocalization;
    } catch (error) {
      console.warn(`[Clerk i18n] Failed to load localization for ${languageCode}, falling back to English`, error);
    }
  } else {
    console.log(`[Clerk i18n] No localization available for ${languageCode}, using English`);
  }

  // Fallback to English
  localizationCache[languageCode] = enUS;
  return enUS;
}

/**
 * Get the currently loaded Clerk localization synchronously
 * Returns English if the requested language is not cached
 * @param languageCode - The i18n language code
 * @returns The cached Clerk localization or English as fallback
 */
export function getClerkLocalization(languageCode: string): ClerkLocalization {
  return localizationCache[languageCode] || enUS;
}

/**
 * Check if a Clerk localization is available for the given language
 * @param languageCode - The i18n language code
 * @returns True if the localization is available
 */
export function hasClerkLocalization(languageCode: string): boolean {
  return languageCode in localeMap;
}

/**
 * Get list of supported Clerk localization language codes
 * @returns Array of supported language codes
 */
export function getSupportedClerkLanguages(): string[] {
  return Object.keys(localeMap);
}
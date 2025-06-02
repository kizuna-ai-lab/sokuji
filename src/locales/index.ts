import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import enTranslation from './en/translation.json';
import jaTranslation from './ja/translation.json';
import zh_CNTranslation from './zh_CN/translation.json';
import zh_TWTranslation from './zh_TW/translation.json';
import frTranslation from './fr/translation.json';
import esTranslation from './es/translation.json';
import deTranslation from './de/translation.json';
import koTranslation from './ko/translation.json';
import pt_BRTranslation from './pt_BR/translation.json';
import pt_PTTranslation from './pt_PT/translation.json';
import idTranslation from './id/translation.json';
import itTranslation from './it/translation.json';
import hiTranslation from './hi/translation.json';
import fiTranslation from './fi/translation.json';
import filTranslation from './fil/translation.json';
import svTranslation from './sv/translation.json';
import ruTranslation from './ru/translation.json';
import taTranslation from './ta/translation.json';
import teTranslation from './te/translation.json';
import thTranslation from './th/translation.json';
import trTranslation from './tr/translation.json';
import ukTranslation from './uk/translation.json';
import viTranslation from './vi/translation.json';
import bnTranslation from './bn/translation.json';
import faTranslation from './fa/translation.json';
import nlTranslation from './nl/translation.json';
import plTranslation from './pl/translation.json';
import msTranslation from './ms/translation.json';
import heTranslation from './he/translation.json';
import arTranslation from './ar/translation.json';

const resources = {
  en: {
    translation: enTranslation,
  },
  ja: {
    translation: jaTranslation,
  },
  zh_CN: {
    translation: zh_CNTranslation,
  },
  zh_TW: {
    translation: zh_TWTranslation,
  },
  fr: {
    translation: frTranslation,
  },
  es: {
    translation: esTranslation,
  },
  de: {
    translation: deTranslation,
  },
  ko: {
    translation: koTranslation,
  },
  pt_BR: {
    translation: pt_BRTranslation,
  },
  pt_PT: {
    translation: pt_PTTranslation,
  },
  id: {
    translation: idTranslation,
  },
  it: {
    translation: itTranslation,
  },
  hi: {
    translation: hiTranslation,
  },
  fi: {
    translation: fiTranslation,
  },
  fil: {
    translation: filTranslation,
  },
  sv: {
    translation: svTranslation,
  },
  ru: {
    translation: ruTranslation,
  },
  ta: {
    translation: taTranslation,
  },
  te: {
    translation: teTranslation,
  },
  th: {
    translation: thTranslation,
  },
  tr: {
    translation: trTranslation,
  },
  uk: {
    translation: ukTranslation,
  },
  vi: {
    translation: viTranslation,
  },
  bn: {
    translation: bnTranslation,
  },
  fa: {
    translation: faTranslation,
  },
  nl: {
    translation: nlTranslation,
  },
  pl: {
    translation: plTranslation,
  },
  ms: {
    translation: msTranslation,
  },
  he: {
    translation: heTranslation,
  },
  ar: {
    translation: arTranslation,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    
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
  });

export default i18n; 
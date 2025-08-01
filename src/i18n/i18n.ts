import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  capitalizeAll,
  capitalizeEachFirstChar,
  capitalizeFirstChar,
  capitalizeFirstWord,
} from './processors';

export const supportedLanguages = {
  ar: { name: 'Arab', flag: '🇦🇪' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  en: { name: 'English', flag: '🇺🇸' },
  es: { name: 'Español', flag: '🇪🇸' },
  et: { name: 'Eesti', flag: '🇪🇪' },
  fr: { name: 'Français', flag: '🇫🇷' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  pt: { name: 'Português', flag: '🇧🇷' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  ja: { name: '日本語', flag: '🇯🇵' },
  zh: { name: '中文', flag: '🇨🇳' },  
};

// Load all JSON files under locales/**/*
const modules = import.meta.glob('./locales/**/*.json', {
  eager: true,
}) as Record<string, any>;

// Construct i18n resources object
const resources: Record<string, Record<string, any>> = {};

for (const path in modules) {
  // Path format: './locales/en/core.json'
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;

  const [, lang, ns] = match;
  resources[lang] = resources[lang] || {};
  resources[lang][ns] = modules[path].default;
}

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .use(LanguageDetector)
  .use(capitalizeAll as any)
  .use(capitalizeEachFirstChar as any)
  .use(capitalizeFirstChar as any)
  .use(capitalizeFirstWord as any)
  .init({
    resources,
    fallbackLng: 'en',
    lng: localStorage.getItem('i18nextLng') || 'en',
    supportedLngs: Object.keys(supportedLanguages),
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    ns: ['auth', 'core', 'group', 'question', 'tutorial'],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnEmptyString: false, // return fallback instead of empty string
    returnNull: false, // return fallback instead of null
    debug: import.meta.env.MODE === 'development',
  });

export default i18n;

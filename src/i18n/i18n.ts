import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  capitalizeAll,
  capitalizeFirstChar,
  capitalizeFirstWord,
} from './processors';

export const supportedLanguages = {
  de: { name: 'Deutsch', flag: '🇩🇪' },
  en: { name: 'English', flag: '🇺🇸' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  ru: { name: 'Русский', flag: '🇷🇺' },
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
  .use(initReactI18next)
  .use(LanguageDetector)
  .use(capitalizeAll as any)
  .use(capitalizeFirstChar as any)
  .use(capitalizeFirstWord as any)
  .init({
    resources,
    fallbackLng: 'en',
    lng: navigator.language,
    supportedLngs: Object.keys(supportedLanguages),
    ns: ['core', 'auth', 'group', 'tutorial'],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    debug: import.meta.env.MODE === 'development',
  });

export default i18n;

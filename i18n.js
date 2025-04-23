import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LocalStorageBackend from 'i18next-localstorage-backend';
import HttpApi from 'i18next-http-backend';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Detect environment
const isDev = process.env.NODE_ENV === 'development';

// Register custom postProcessor: it capitalizes the first letter of a translation-
// Usage:
// t('greeting', { postProcess: 'capitalize' })
const capitalize = {
  type: 'postProcessor',
  name: 'capitalize',
  process: (value) => {
    return value.charAt(0).toUpperCase() + value.slice(1);
  },
};

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .use(capitalize)
  .init({
    backend: {
      backends: [LocalStorageBackend, HttpBackend],
      backendOptions: [
        {
          expirationTime: 7 * 24 * 60 * 60 * 1000, // 7 days
        },
        {
          loadPath: '/locales/{{lng}}/{{ns}}.json',
        },
      ],
    },
    debug: isDev,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    lng: navigator.language,
    ns: ['auth', 'core', 'tutorial'],
    supportedLngs: ['en', 'it', 'es', 'fr', 'de', 'ru'],
  });

export default i18n;

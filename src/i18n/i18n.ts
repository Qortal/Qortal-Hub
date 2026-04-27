import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  capitalizeAll,
  capitalizeEachFirstChar,
  capitalizeFirstChar,
  capitalizeFirstWord,
} from './processors';

export const supportedLanguages = {
  en: { name: 'English', flag: '🇺🇸' },
};

const modules = import.meta.glob('./locales/en/*.json', {
  eager: true,
}) as Record<string, any>;

const resources: Record<string, Record<string, any>> = {
  en: {},
};

for (const path in modules) {
  const match = path.match(/\.\/locales\/en\/([^/]+)\.json$/);
  if (!match) continue;

  const [, ns] = match;
  resources.en[ns] = modules[path].default;
}

try {
  localStorage.setItem('i18nextLng', 'en');
} catch (_error) {
  // Ignore storage failures and continue with English-only resources.
}

i18n
  .use(initReactI18next)
  .use(capitalizeAll as any)
  .use(capitalizeEachFirstChar as any)
  .use(capitalizeFirstChar as any)
  .use(capitalizeFirstWord as any)
  .init({
    resources,
    fallbackLng: 'en',
    lng: 'en',
    supportedLngs: ['en'],
    ns: ['auth', 'core', 'group', 'question', 'tutorial'],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnEmptyString: false,
    returnNull: false,
    debug: import.meta.env.MODE === 'development',
  });

export default i18n;

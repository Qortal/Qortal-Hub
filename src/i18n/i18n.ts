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
  ar: { name: 'العربية', flag: '🇸🇦' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  es: { name: 'Español', flag: '🇪🇸' },
  et: { name: 'Eesti', flag: '🇪🇪' },
  fi: { name: 'Suomi', flag: '🇫🇮' },
  fr: { name: 'Français', flag: '🇫🇷' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  ja: { name: '日本語', flag: '🇯🇵' },
  pt: { name: 'Português', flag: '🇵🇹' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  zh: { name: '中文', flag: '🇨🇳' },
} as const;

const supportedLngs = Object.keys(supportedLanguages);

const modules = import.meta.glob('./locales/*/*.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const resources: Record<string, Record<string, unknown>> = {};

for (const path of Object.keys(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;

  const [, lng, ns] = match;
  if (!supportedLngs.includes(lng)) continue;

  if (!resources[lng]) resources[lng] = {};
  resources[lng][ns] = modules[path].default;
}

function getInitialLanguage(): string {
  try {
    const raw = localStorage.getItem('i18nextLng');
    if (!raw) return 'en';
    const base = raw.split('-')[0];
    return supportedLngs.includes(base) ? base : 'en';
  } catch {
    return 'en';
  }
}

export const namespaces = [
  'auth',
  'core',
  'group',
  'question',
  'tutorial',
  'node',
] as const;

i18n
  .use(initReactI18next)
  .use(capitalizeAll as any)
  .use(capitalizeEachFirstChar as any)
  .use(capitalizeFirstChar as any)
  .use(capitalizeFirstWord as any)
  .init({
    resources,
    fallbackLng: 'en',
    lng: getInitialLanguage(),
    supportedLngs,
    ns: [...namespaces],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnEmptyString: false,
    returnNull: false,
    debug: import.meta.env.MODE === 'development',
  });

export default i18n;

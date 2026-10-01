import { createInstance } from 'i18next';
import enQuestion from '../../i18n/locales/en/question.json';
import enCore from '../../i18n/locales/en/core.json';
import deQuestion from '../../i18n/locales/de/question.json';
import deCore from '../../i18n/locales/de/core.json';
import esQuestion from '../../i18n/locales/es/question.json';
import esCore from '../../i18n/locales/es/core.json';
import frQuestion from '../../i18n/locales/fr/question.json';
import frCore from '../../i18n/locales/fr/core.json';
import itQuestion from '../../i18n/locales/it/question.json';
import itCore from '../../i18n/locales/it/core.json';
import ptQuestion from '../../i18n/locales/pt/question.json';
import ptCore from '../../i18n/locales/pt/core.json';
import ruQuestion from '../../i18n/locales/ru/question.json';
import ruCore from '../../i18n/locales/ru/core.json';
import zhQuestion from '../../i18n/locales/zh/question.json';
import zhCore from '../../i18n/locales/zh/core.json';
import jaQuestion from '../../i18n/locales/ja/question.json';
import jaCore from '../../i18n/locales/ja/core.json';
import arQuestion from '../../i18n/locales/ar/question.json';
import arCore from '../../i18n/locales/ar/core.json';
import fiQuestion from '../../i18n/locales/fi/question.json';
import fiCore from '../../i18n/locales/fi/core.json';
import etQuestion from '../../i18n/locales/et/question.json';
import etCore from '../../i18n/locales/et/core.json';
const resources = {
  en: {
    question: { local_send: enQuestion.local_send },
    core: {
      action: { send: enCore.action.send, cancel: enCore.action.cancel },
    },
  },
  de: {
    question: { local_send: deQuestion.local_send },
    core: {
      action: { send: deCore.action.send, cancel: deCore.action.cancel },
    },
  },
  es: {
    question: { local_send: esQuestion.local_send },
    core: {
      action: { send: esCore.action.send, cancel: esCore.action.cancel },
    },
  },
  fr: {
    question: { local_send: frQuestion.local_send },
    core: {
      action: { send: frCore.action.send, cancel: frCore.action.cancel },
    },
  },
  it: {
    question: { local_send: itQuestion.local_send },
    core: {
      action: { send: itCore.action.send, cancel: itCore.action.cancel },
    },
  },
  pt: {
    question: { local_send: ptQuestion.local_send },
    core: {
      action: { send: ptCore.action.send, cancel: ptCore.action.cancel },
    },
  },
  ru: {
    question: { local_send: ruQuestion.local_send },
    core: {
      action: { send: ruCore.action.send, cancel: ruCore.action.cancel },
    },
  },
  zh: {
    question: { local_send: zhQuestion.local_send },
    core: {
      action: { send: zhCore.action.send, cancel: zhCore.action.cancel },
    },
  },
  ja: {
    question: { local_send: jaQuestion.local_send },
    core: {
      action: { send: jaCore.action.send, cancel: jaCore.action.cancel },
    },
  },
  ar: {
    question: { local_send: arQuestion.local_send },
    core: {
      action: { send: arCore.action.send, cancel: arCore.action.cancel },
    },
  },
  fi: {
    question: { local_send: fiQuestion.local_send },
    core: {
      action: { send: fiCore.action.send, cancel: fiCore.action.cancel },
    },
  },
  et: {
    question: { local_send: etQuestion.local_send },
    core: {
      action: { send: etCore.action.send, cancel: etCore.action.cancel },
    },
  },
};
export function desktopWalletTranslations(language: string) {
  const i18n = createInstance();
  void i18n.init({
    resources,
    lng: typeof language === 'string' ? language.slice(0, 20) : 'en',
    fallbackLng: 'en',
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

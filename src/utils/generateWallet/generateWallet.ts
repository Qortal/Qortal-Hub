// @ts-nocheck

import { crypto, walletVersion } from '../../constants/decryptWallet';
import { doInitWorkers, kdf } from '../../encryption/kdf';
import PhraseWallet from './phrase-wallet';
import * as WORDLISTS from './wordlists';
import FileSaver from 'file-saver';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { mimeToExtensionMap } from '../memeTypes';

export function generateRandomSentence(
  template = 'adverb verb noun adjective noun adverb verb noun adjective noun adjective verbed adjective noun',
  maxWordLength = 0,
  capitalize = true
) {
  const partsOfSpeechMap = {
    noun: 'nouns',
    adverb: 'adverbs',
    adv: 'adverbs',
    verb: 'verbs',
    interjection: 'interjections',
    adjective: 'adjectives',
    adj: 'adjectives',
    verbed: 'verbed',
  };

  let _wordlists = WORDLISTS;

  function _RNG(entropy) {
    if (entropy > 1074) {
      throw new Error('Javascript can not handle that much entropy!');
    }
    let randNum = 0;
    const crypto = window.crypto || window.msCrypto;

    if (crypto) {
      const entropy256 = Math.ceil(entropy / 8);
      let buffer = new Uint8Array(entropy256);
      crypto.getRandomValues(buffer);
      randNum =
        buffer.reduce((num, value) => num * 256 + value, 0) /
        Math.pow(256, entropy256);
    } else {
      console.warn('Secure RNG not found. Using Math.random');
      randNum = Math.random();
    }
    return randNum;
  }

  function _capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getWord(partOfSpeech) {
    let words = _wordlists[partsOfSpeechMap[partOfSpeech]];
    if (maxWordLength) {
      words = words.filter((word) => word.length <= maxWordLength);
    }
    const requiredEntropy = Math.log(words.length) / Math.log(2);
    const index = Math.floor(_RNG(requiredEntropy) * words.length);
    return words[index];
  }

  function parse(template) {
    return template
      .split(/\s+/)
      .map((token) => {
        const match = token.match(/^(\w+)(.*)$/);
        if (!match) return token; // No match, return original token

        const [, partOfSpeech, rest] = match;
        if (partsOfSpeechMap[partOfSpeech]) {
          let word = getWord(partOfSpeech);
          if (
            capitalize &&
            token === token[0].toUpperCase() + token.slice(1).toLowerCase()
          ) {
            word = _capitalize(word);
          }
          return word + rest;
        }

        return token;
      })
      .join(' ');
  }

  return parse(template);
}

export const createAccount = async (generatedSeedPhrase) => {
  if (!generatedSeedPhrase) throw new Error('No generated seed-phrase');
  const threads = doInitWorkers(crypto.kdfThreads);

  const seed = await kdf(generatedSeedPhrase, void 0, threads);
  const wallet = new PhraseWallet(seed, walletVersion);
  return wallet;
};

const hasExtension = (filename) => {
  return filename.includes('.') && filename.split('.').pop().length > 0;
};

export const saveFileToDisk = async (data, qortAddress) => {
  const dataString = JSON.stringify(data);
  const blob = new Blob([dataString], { type: 'application/json' });
  const fileName = 'qortal_backup_' + qortAddress + '.json';

  await FileSaver.saveAs(blob, fileName);
};

export const saveFileToDiskGeneric = async (blob, filename) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-'); // Safe timestamp for filenames

  const fileExtension = mimeToExtensionMap[blob.type];
  let fileName = filename || 'qortal_file_' + timestamp + '.' + fileExtension;
  fileName = hasExtension(fileName) ? fileName : fileName + '.' + fileExtension;

  await FileSaver.saveAs(blob, fileName);
};

export const saveSeedPhraseToDisk = async (data) => {
  const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
  const fileName = 'qortal_seedphrase.txt';

  await FileSaver.saveAs(blob, fileName);
};

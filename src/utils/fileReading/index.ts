// @ts-nocheck
import { isQAppFileReference } from '../../qortal/qapp-file-reference';
import i18n from '../../i18n/i18n';

class Semaphore {
  constructor(count) {
    this.count = count;
    this.waiting = [];
  }
  acquire() {
    return new Promise((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve();
      } else {
        this.waiting.push(resolve);
      }
    });
  }
  release() {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve();
    } else {
      this.count++;
    }
  }
}

const semaphore = new Semaphore(1);
// Both local and native-reference reads share the semaphore. Legacy encryption
// needs a complete string, so concurrent whole-file encodes must stay bounded.
export const fileToBase64 = async (file) => {
  await semaphore.acquire();
  try {
    if (isQAppFileReference(file)) return await file.base64();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      const fail = () =>
        reject(new Error(i18n.t('question:publish_validation.invalid_file')));
      reader.onload = () => {
        if (typeof reader.result === 'string')
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        else fail();
      };
      reader.onerror = reader.onabort = fail;
      reader.readAsDataURL(file);
    });
  } finally {
    semaphore.release();
  }
};

export const base64ToBlobUrl = (base64, mimeType = 'image/png') => {
  const binary = atob(base64);
  const array = [];
  for (let i = 0; i < binary.length; i++) {
    array.push(binary.charCodeAt(i));
  }
  const blob = new Blob([new Uint8Array(array)], { type: mimeType });
  return URL.createObjectURL(blob);
};

export const handleImportClick = async (fileTypes) => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = fileTypes;

  // Create a promise to handle file selection and reading synchronously
  return await new Promise((resolve, reject) => {
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target.result); // Resolve with the file content
      };
      reader.onerror = () => {
        reject(new Error('Error reading file'));
      };

      reader.readAsText(file); // Read the file as text (Base64 string)
    };

    // Trigger the file input dialog
    fileInput.click();
  });
};

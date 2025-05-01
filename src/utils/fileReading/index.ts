// @ts-nocheck

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

let semaphore = new Semaphore(1);
let reader = new FileReader();

export const fileToBase64 = (file) =>
  new Promise(async (resolve, reject) => {
    const reader = new FileReader(); // Create a new instance
    await semaphore.acquire();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const dataUrl = reader.result;
      semaphore.release();
      if (typeof dataUrl === 'string') {
        resolve(dataUrl.split(',')[1]);
      } else {
        reject(new Error('Invalid data URL'));
      }
      reader.onload = null; // Clear the handler
      reader.onerror = null; // Clear the handle
    };
    reader.onerror = (error) => {
      semaphore.release();
      reject(error);
      reader.onload = null; // Clear the handler
      reader.onerror = null; // Clear the handle
    };
  });

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

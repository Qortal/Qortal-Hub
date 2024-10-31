import { SecureStoragePlugin } from '@evva/capacitor-secure-storage-plugin';

let inMemoryKey: CryptoKey | null = null;
let inMemoryIV: Uint8Array | null = null;

const keysToEncrypt = ['keyPair'];

async function initializeKeyAndIV() {
  if (!inMemoryKey) {
    inMemoryKey = await generateKey();  // Generates the key in memory
  }
}

async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data: string, key: CryptoKey): Promise<{ iv: Uint8Array; encryptedData: ArrayBuffer }> {
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);

  // Generate a random IV each time you encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encryptedData = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encodedData
  );

  return { iv, encryptedData };
}

async function decryptData(encryptedData: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<string> {
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

// Encode a JSON payload as Base64
function jsonToBase64(payload) {
  const utf8Array = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  utf8Array.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

// Decode a Base64 string back to JSON
function base64ToJson(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const storeData = async (key: string, payload: any): Promise<string> => {
  await initializeKeyAndIV();

  const base64Data = jsonToBase64(payload);

  if (keysToEncrypt.includes(key) && inMemoryKey) {
    // Encrypt the Base64-encoded payload
    const { iv, encryptedData } = await encryptData(base64Data, inMemoryKey);

    // Combine IV and encrypted data into a single Uint8Array
    const combinedData = new Uint8Array([...iv, ...new Uint8Array(encryptedData)]);
    const encryptedBase64Data = btoa(String.fromCharCode(...combinedData));
    await SecureStoragePlugin.set({ key, value: encryptedBase64Data });
  } else {
    // Store Base64-encoded data in plain text if not in keysToEncrypt
    await SecureStoragePlugin.set({ key, value: base64Data });
  }

  return "Data saved successfully";
};


export const getData = async <T = any>(key: string): Promise<T> => {
  await initializeKeyAndIV();

  const storedDataBase64 = await SecureStoragePlugin.get({ key });
  if (storedDataBase64.value) {
    if (keysToEncrypt.includes(key) && inMemoryKey) {
      // Decode the Base64-encoded encrypted data
      const combinedData = atob(storedDataBase64.value)
        .split("")
        .map((c) => c.charCodeAt(0));

      const iv = new Uint8Array(combinedData.slice(0, 12)); // First 12 bytes are the IV
      const encryptedData = new Uint8Array(combinedData.slice(12)).buffer;

      const decryptedBase64Data = await decryptData(encryptedData, inMemoryKey, iv);
      return base64ToJson(decryptedBase64Data);
    } else {
      // Decode non-encrypted data
      return base64ToJson(storedDataBase64.value);
    }
  } else {
    throw new Error(`No data found for key: ${key}`);
  }
};



// Remove keys from storage and log out
export async function removeKeysAndLogout(keys: string[], event: MessageEvent, request: any) {
  try {
    for (const key of keys) {
      try {
        await SecureStoragePlugin.remove({ key });
        await SecureStoragePlugin.remove({ key: `${key}_iv` });  // Remove associated IV
      } catch (error) {
        console.warn(`Key not found: ${key}`);
      }
    }

    event.source.postMessage(
      {
        requestId: request.requestId,
        action: "logout",
        payload: true,
        type: "backgroundMessageResponse",
      },
      event.origin
    );
  } catch (error) {
    console.error("Error removing keys:", error);
  }
}

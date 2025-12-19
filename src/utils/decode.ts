export function decodeIfEncoded(input) {
  try {
    // Check if input is URI-encoded by encoding and decoding
    const encoded = encodeURIComponent(decodeURIComponent(input));
    if (encoded === input) {
      // Input is URI-encoded, so decode it
      return decodeURIComponent(input);
    }
  } catch (e) {
    // decodeURIComponent throws an error if input is not encoded
    console.error('Error decoding URI:', e);
  }

  // Return input as-is if not URI-encoded
  return input;
}

export const isValidBase64 = (str: string): boolean => {
  if (typeof str !== 'string' || str.length % 4 !== 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
};

export const isValidBase64WithDecode = (str: string): boolean => {
  try {
    return isValidBase64(str) && Boolean(atob(str));
  } catch {
    return false;
  }
};

export const validateAesCtrIvAndKey = (
  iv: string,
  key: string
): {
  isValid: boolean;
  errors: string[];
  details?: {
    ivLength?: number;
    keyLength?: number;
  };
} => {
  const errors: string[] = [];

  // Validate IV
  if (!iv || typeof iv !== 'string') {
    errors.push('IV is required and must be a string');
  } else if (!isValidBase64WithDecode(iv)) {
    errors.push('IV is not a valid base64 string');
  } else {
    try {
      const ivBytes = atob(iv);
      const ivLength = ivBytes.length;
      if (ivLength !== 16) {
        errors.push(
          `IV length is ${ivLength} bytes, expected 16 bytes for AES-CTR`
        );
      }
    } catch (error) {
      errors.push('Failed to decode IV for validation');
    }
  }

  // Validate Key
  if (!key || typeof key !== 'string') {
    errors.push('Key is required and must be a string');
  } else if (!isValidBase64WithDecode(key)) {
    errors.push('Key is not a valid base64 string');
  } else {
    try {
      const keyBytes = atob(key);
      const keyLength = keyBytes.length;
      if (keyLength !== 32) {
        errors.push(
          `Key length is ${keyLength} bytes, expected 32 bytes for AES-256 CTR`
        );
      }
    } catch (error) {
      errors.push('Failed to decode key for validation');
    }
  }

  // Return details if validation passed or partially passed
  let details: { ivLength?: number; keyLength?: number } | undefined;
  if (errors.length === 0 || errors.some((e) => !e.includes('length'))) {
    try {
      const ivLength = iv ? atob(iv).length : undefined;
      const keyLength = key ? atob(key).length : undefined;
      details = { ivLength, keyLength };
    } catch {
      // Ignore errors when getting details
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    details,
  };
};

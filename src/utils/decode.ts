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

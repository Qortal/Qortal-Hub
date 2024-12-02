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
      console.error("Error decoding URI:", e);
    }
  
    // Return input as-is if not URI-encoded
    return input;
  }
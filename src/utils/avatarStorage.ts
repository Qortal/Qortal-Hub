import { Filesystem, Directory } from '@capacitor/filesystem';

const AVATARS_DIR = 'avatars';

/**
 * Resize an image file to a square avatar and return base64 WebP (no prefix).
 * Crops to center square, then scales to target size.
 */
export function resizeImageToAvatar(
  file: File,
  size: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // Center-crop to square
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;

      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      // Export as WebP base64
      const dataUri = canvas.toDataURL('image/webp', 0.85);
      resolve(dataUri.split(',')[1]);
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

/**
 * Save an avatar image for a wallet address.
 * Accepts a base64-encoded WebP string (without data URI prefix).
 */
export async function saveAvatar(
  address: string,
  base64Data: string
): Promise<void> {
  await Filesystem.writeFile({
    path: `${AVATARS_DIR}/${address}.webp`,
    data: base64Data,
    directory: Directory.Data,
    recursive: true,
  });
}

/**
 * Load the avatar for a wallet address.
 * Returns a data URI string or null if no avatar exists.
 */
export async function loadAvatar(address: string): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({
      path: `${AVATARS_DIR}/${address}.webp`,
      directory: Directory.Data,
    });
    return `data:image/webp;base64,${result.data}`;
  } catch {
    return null;
  }
}

/**
 * Delete the avatar for a wallet address.
 */
export async function deleteAvatar(address: string): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path: `${AVATARS_DIR}/${address}.webp`,
      directory: Directory.Data,
    });
  } catch {
    // File may not exist, ignore
  }
}

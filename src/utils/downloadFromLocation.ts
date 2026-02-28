import aesjs from 'aes-js';
import { createEndpoint } from '../background/background.ts';

export function normalizeFilename(
  input: string,
  maxLength: number = 120
): string {
  if (!input) return 'file';

  // Separate extension
  const lastDot = input.lastIndexOf('.');
  const hasExtension = lastDot > 0;
  const namePart = hasExtension ? input.slice(0, lastDot) : input;
  const extension = hasExtension ? input.slice(lastDot).toLowerCase() : '';

  // Normalize unicode (é → e)
  let normalized = namePart.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Replace curly quotes/dashes with ASCII equivalents
  normalized = normalized
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');

  // Remove anything not safe (keep letters, numbers, space, dash, underscore)
  normalized = normalized.replace(/[^a-zA-Z0-9 _-]/g, '');

  // Convert spaces to underscore
  normalized = normalized.replace(/\s+/g, '_');

  // Collapse multiple underscores
  normalized = normalized.replace(/_+/g, '_');

  // Trim leading/trailing underscores or dashes
  normalized = normalized.replace(/^[_-]+|[_-]+$/g, '');

  // Enforce max length (preserve extension)
  const allowedNameLength = maxLength - extension.length;
  if (normalized.length > allowedNameLength) {
    normalized = normalized.slice(0, allowedNameLength);
  }

  return normalized + extension;
}

interface DownloadFromLocationParams {
  filename: string;
  location: {
    service: string;
    name: string;
    identifier?: string;
  };
  encryption?: {
    encryptionType: string;
    iv: string;
    key: string;
  };
  mimeType?: string;
  filePath?: string; // Optional: for Electron only, if not provided will prompt user
}

interface DownloadResult {
  success: boolean;
  filePath?: string;
  bytesWritten?: number;
  error?: string;
}

/**
 * Downloads and optionally decrypts a file from QDN location
 * No permissions, no UI notifications - just pure download logic
 *
 * @param params - Download parameters
 * @returns Promise with download result
 */
export async function downloadFromLocation(
  params: DownloadFromLocationParams
): Promise<DownloadResult> {
  const {
    filename,
    location,
    encryption = undefined,
    mimeType = undefined,
    filePath = undefined,
  } = params;

  try {
    // Validate location
    const requiredFieldsLocation = ['service', 'name'];
    const missingFieldsLocation: string[] = [];
    requiredFieldsLocation.forEach((field) => {
      if (!location[field]) {
        missingFieldsLocation.push(field);
      }
    });
    if (missingFieldsLocation.length > 0) {
      const missingFieldsString = missingFieldsLocation.join(', ');
      throw new Error(`Missing location fields: ${missingFieldsString}`);
    }

    const { service, name, identifier } = location;
    const isEncrypted = encryption?.encryptionType === 'streamed-v1';

    // Validate encryption if present
    let ivBytes: Uint8Array | undefined;
    let keyBytes: Uint8Array | undefined;
    if (isEncrypted) {
      if (!encryption?.iv || !encryption?.key) {
        throw new Error('Missing encryption IV or key');
      }

      ivBytes = base64ToUint8Array(encryption.iv);
      keyBytes = base64ToUint8Array(encryption.key);

      if (ivBytes.length !== 16) {
        throw new Error(
          `Invalid IV length: ${ivBytes.length} bytes, expected 16 bytes`
        );
      }
      if (keyBytes.length !== 32) {
        throw new Error(
          `Invalid key length: ${keyBytes.length} bytes, expected 32 bytes`
        );
      }
    }

    // Build the download URL
    let locationUrl = `/arbitrary/${service}/${name}`;
    if (identifier) {
      locationUrl += `/${identifier}`;
    }

    // Check if we're in Electron
    const isElectron = !!window?.electron?.startStreamSave;

    if (isElectron) {
      // Use Electron streaming approach
      const saveResult = await window?.electron.startStreamSave({
        filename,
        mimeType,
        ...(filePath && { defaultPath: filePath }),
      });

      if (saveResult.canceled) {
        return {
          success: false,
          error: 'User canceled file save',
        };
      }

      const savedFilePath = saveResult.filePath;

      try {
        const endpoint = isEncrypted
          ? await createEndpoint(locationUrl)
          : await createEndpoint(
              locationUrl +
                `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
            );
        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error('Failed to download file');
        }

        if (!response.body) {
          throw new Error('Response body is empty');
        }

        // Get expected file size
        const contentLength = response.headers.get('Content-Length');
        const expectedSize = contentLength ? parseInt(contentLength, 10) : null;

        // Process the response body as a stream
        const reader = response.body.getReader();
        let bytesProcessed = 0;
        let bytesWritten = 0;
        let isFirstChunk = true;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (expectedSize && bytesProcessed !== expectedSize) {
                console.warn(
                  `Size mismatch! Expected ${expectedSize} bytes but got ${bytesProcessed} bytes`
                );
              }
              break;
            }

            if (!value || value.length === 0) {
              console.warn('Received empty chunk, skipping');
              continue;
            }

            let chunkToWrite = value;

            // Decrypt chunk if encrypted
            if (isEncrypted && keyBytes && ivBytes) {
              try {
                const blockOffset = BigInt(bytesProcessed >> 4);
                chunkToWrite = await decryptAesCtrChunk(
                  keyBytes,
                  ivBytes,
                  blockOffset,
                  value
                );
              } catch (decryptError: any) {
                console.error(
                  'Decryption failed for chunk at offset',
                  bytesProcessed,
                  decryptError
                );
                throw new Error(
                  `Decryption failed at byte ${bytesProcessed}: ${decryptError?.message || 'Unknown error'}`
                );
              }
            }

            // Write chunk to disk via Electron IPC
            try {
              await window?.electron.writeChunk(
                savedFilePath,
                chunkToWrite,
                !isFirstChunk
              );
              bytesWritten += chunkToWrite.length;
            } catch (writeError: any) {
              console.error(
                'Failed to write chunk at offset',
                bytesWritten,
                writeError
              );
              throw new Error(
                `Write failed at byte ${bytesWritten}: ${writeError?.message || 'Unknown error'}`
              );
            }

            bytesProcessed += value.length;
            isFirstChunk = false;
          }
        } catch (streamError) {
          console.error('Stream processing error:', streamError);
          throw streamError;
        }

        return {
          success: true,
          filePath: savedFilePath,
          bytesWritten,
        };
      } catch (error) {
        // Clean up partial file on error
        try {
          await window?.electron.deleteFile(savedFilePath);
        } catch (cleanupError) {
          console.error('Failed to cleanup partial file:', cleanupError);
        }
        throw error;
      }
    } else {
      // Fallback for non-Electron (browser)
      // Check if File System Access API is available
      const hasFileSystemAccess = 'showSaveFilePicker' in window;

      if (isEncrypted && keyBytes && ivBytes) {
        // For encrypted files, we need to decrypt while streaming
        if (hasFileSystemAccess) {
          // Use File System Access API with streaming

          let fileHandle;
          try {
            fileHandle = await (window as any).showSaveFilePicker({
              suggestedName: filename,
              types: mimeType
                ? [
                    {
                      description: 'File',
                      accept: {
                        [mimeType]: [`.${filename.split('.').pop() || '*'}`],
                      },
                    },
                  ]
                : undefined,
            });
          } catch (error: any) {
            if (error.name === 'AbortError') {
              return {
                success: false,
                error: 'User canceled file save',
              };
            }
            throw error;
          }

          const writable = await fileHandle.createWritable();

          try {
            const response = await fetch(await createEndpoint(locationUrl));

            if (!response.ok) {
              throw new Error('Failed to download encrypted file');
            }

            if (!response.body) {
              throw new Error('Response body is empty');
            }

            const contentLength = response.headers.get('Content-Length');
            const expectedSize = contentLength
              ? parseInt(contentLength, 10)
              : null;

            const reader = response.body.getReader();
            let bytesProcessed = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              const blockOffset = BigInt(bytesProcessed >> 4);
              const decryptedChunk = await decryptAesCtrChunk(
                keyBytes,
                ivBytes,
                blockOffset,
                value
              );

              await writable.write(decryptedChunk);
              bytesProcessed += value.length;
            }

            await writable.close();

            return {
              success: true,
              bytesWritten: bytesProcessed,
            };
          } catch (error) {
            await writable.abort();
            throw error;
          }
        } else {
          // Fallback to memory-based decryption (not ideal for large files)

          const response = await fetch(await createEndpoint(locationUrl));

          if (!response.ok) {
            throw new Error('Failed to download encrypted file');
          }

          if (!response.body) {
            throw new Error('Response body is empty');
          }

          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let bytesProcessed = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const blockOffset = BigInt(bytesProcessed >> 4);
            const decryptedChunk = await decryptAesCtrChunk(
              keyBytes,
              ivBytes,
              blockOffset,
              value
            );

            chunks.push(decryptedChunk);
            bytesProcessed += value.length;
          }

          const decryptedBlob = new Blob(chunks as BlobPart[]);
          const blobUrl = URL.createObjectURL(decryptedBlob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);

          return {
            success: true,
            bytesWritten: bytesProcessed,
          };
        }
      } else {
        // Non-encrypted files - try streaming first, fallback to direct download
        if (hasFileSystemAccess) {
          let fileHandle;
          try {
            fileHandle = await (window as any).showSaveFilePicker({
              suggestedName: filename,
              types: mimeType
                ? [
                    {
                      description: 'File',
                      accept: {
                        [mimeType]: [`.${filename.split('.').pop() || '*'}`],
                      },
                    },
                  ]
                : undefined,
            });
          } catch (error: any) {
            if (error.name === 'AbortError') {
              return {
                success: false,
                error: 'User canceled file save',
              };
            }
            throw error;
          }

          const writable = await fileHandle.createWritable();

          try {
            const response = await fetch(
              await createEndpoint(
                locationUrl +
                  `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
              )
            );

            if (!response.ok) {
              throw new Error('Failed to download file');
            }

            if (!response.body) {
              throw new Error('Response body is empty');
            }

            // For non-encrypted files, we can pipe directly
            await response.body.pipeTo(writable);

            return {
              success: true,
            };
          } catch (error) {
            await writable.abort();
            throw error;
          }
        } else {
          // Direct download using anchor tag
          const endpoint = await createEndpoint(
            locationUrl +
              `?attachment=true&attachmentFilename=${encodeURIComponent(normalizeFilename(filename))}`
          );
          const a = document.createElement('a');
          a.href = endpoint;
          a.download = encodeURIComponent(filename);
          document.body.appendChild(a);
          a.click();
          a.remove();

          return {
            success: true,
          };
        }
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Unknown error occurred',
    };
  }
}

/**
 * Decrypts a single chunk using AES-CTR
 */
async function decryptAesCtrChunk(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  blockOffset: bigint,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  // Try WebCrypto first
  if (crypto?.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-CTR' },
        false,
        ['decrypt']
      );

      const counter = deriveCtrCounter(ivBytes, blockOffset);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-CTR',
          counter,
          length: 128,
        },
        cryptoKey,
        ciphertext
      );

      return new Uint8Array(decrypted);
    } catch (e) {
      console.warn('WebCrypto AES-CTR decrypt failed, falling back:', e);
    }
  }

  // Fallback using aes-js
  return fallbackDecryptCtr(keyBytes, ivBytes, blockOffset, ciphertext);
}

function deriveCtrCounter(iv: Uint8Array, blockOffset: bigint): Uint8Array {
  const counter = new Uint8Array(iv);
  let carry = blockOffset;

  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

function fallbackDecryptCtr(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  blockOffset: bigint,
  ciphertext: Uint8Array
): Uint8Array {
  const counter = deriveCtrCounter(ivBytes, blockOffset);
  const aesCtr = new aesjs.ModeOfOperation.ctr(
    keyBytes,
    new aesjs.Counter(counter)
  );
  const decrypted = aesCtr.decrypt(ciphertext);
  return new Uint8Array(decrypted);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

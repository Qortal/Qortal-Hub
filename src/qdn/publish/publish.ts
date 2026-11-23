// @ts-nocheck

import { Buffer } from 'buffer';
import Base58 from '../../encryption/Base58';
import nacl from '../../encryption/nacl-fast';
import utils from '../../utils/utils';
import { createEndpoint, getBaseApi } from '../../background/background';
import { getData } from '../../utils/chromeStorage';
import { executeEvent } from '../../utils/events';
import { fileToBase64 } from '../../utils/fileReading';
import aesjs from 'aes-js';
import { checkPublishStorage, requirePublishFile } from './upload-validation';
import { isNodeBuildable } from './nodeBuildable';
import {
  isRetryableStatus,
  isWorthRetrying,
  needsApiKey,
  nodeAnswerError,
  nodeAnswerErrorFromStatus,
} from './nodeAnswer';
import { isQAppFileReference } from '../../qortal/qapp-file-reference';
import { QAppFileUploadError } from '../../../electron/src/qapp-file-protocol';

async function encryptAesCtrChunkWithFallback(
  keyBytes,
  ivBytes,
  blockOffset,
  plaintext
) {
  // Try WebCrypto first
  if (crypto?.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-CTR' },
        false,
        ['encrypt']
      );

      const counter = deriveCtrCounter(ivBytes, blockOffset);

      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-CTR',
          counter,
          length: 128,
        },
        cryptoKey,
        plaintext
      );

      return new Uint8Array(encrypted);
    } catch (e) {
      console.warn('WebCrypto AES-CTR failed, falling back:', e);
    }
  }

  // Fallback using aes-js (make sure you imported aes-js above)
  return fallbackEncryptCtr(keyBytes, ivBytes, blockOffset, plaintext);
}

function deriveCtrCounter(iv, blockOffset) {
  const counter = new Uint8Array(iv);
  let carry = blockOffset;

  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

// fallback using aes-js
function fallbackEncryptCtr(keyBytes, ivBytes, blockOffset, plaintext) {
  const counter = deriveCtrCounter(ivBytes, blockOffset);
  const aesCtr = new aesjs.ModeOfOperation.ctr(
    keyBytes,
    new aesjs.Counter(counter)
  );
  const encrypted = aesCtr.encrypt(plaintext);
  return new Uint8Array(encrypted);
}

export async function reusableGet(endpoint) {
  const validApi = await getBaseApi();

  const response = await fetch(validApi + endpoint);
  const data = await response.json();
  return data;
}

async function reusablePost(endpoint, _body) {
  // const validApi = await findUsableApi();
  const url = await createEndpoint(endpoint);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: _body,
  });
  if (!response.ok) {
    throw await nodeAnswerError(response);
  }
  let data;
  try {
    data = await response.clone().json();
  } catch (e) {
    data = await response.text();
  }
  return data;
}

async function reusablePostStream(endpoint, _body) {
  const url = await createEndpoint(endpoint);

  const headers = {};

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: _body,
  });

  return response; // return the actual response so calling code can use response.ok
}

async function uploadChunkWithRetry(
  endpoint,
  formData,
  index,
  maxRetries = 3,
  remoteUpload?
) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      if (remoteUpload) {
        await remoteUpload(await createEndpoint(endpoint));
        return;
      }
      const response = await reusablePostStream(endpoint, formData);
      if (!response.ok) {
        throw await nodeAnswerError(response);
      }
      return; // Success
    } catch (error) {
      const err =
        error instanceof QAppFileUploadError
          ? nodeAnswerErrorFromStatus(error.status)
          : error;
      // A refusal (401/403/4xx) won't change on a retry.
      if (!isWorthRetrying(err)) throw err;
      attempt++;
      console.warn(
        `Chunk ${index} failed (attempt ${attempt}): ${err.message}`
      );
      if (attempt >= maxRetries) {
        throw new Error(`Chunk ${index} failed after ${maxRetries} attempts`);
      }
      // Wait 25 seconds before next retry
      await new Promise((res) => setTimeout(res, 25_000));
    }
  }
}

async function resuablePostRetry(
  endpoint,
  body,
  maxRetries = 3,
  appInfo,
  resourceInfo
) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await reusablePost(endpoint, body);

      return response;
    } catch (err) {
      // A refusal (401/403/4xx) won't change on a retry.
      if (!isWorthRetrying(err)) throw err;
      attempt++;
      if (attempt >= maxRetries) {
        // The error as it is, with the same message: a caller can still
        // tell a node that couldn't be reached from one that refused.
        if (err instanceof Error && err.message) throw err;
        throw new Error(`Failed to make request`);
      }
      if (appInfo?.tabId && resourceInfo) {
        executeEvent('receiveChunks', {
          tabId: appInfo.tabId,
          publishLocation: {
            name: resourceInfo?.name,
            identifier: resourceInfo?.identifier,
            service: resourceInfo?.service,
          },
          retry: true,
        });
      }
      // Wait 10 seconds before next retry
      await new Promise((res) => setTimeout(res, 25_000));
    }
  }
}

/** The node's copy of a transaction (confirmed or not), else null. */
async function knownTransaction(signature: string): Promise<unknown> {
  try {
    const url = await createEndpoint(
      `/transactions/signature/${encodeURIComponent(signature)}`
    );
    const response = await fetch(url);
    if (!response.ok) return null;
    const transaction = await response.json();
    return transaction?.signature === signature ? transaction : null;
  } catch {
    return null;
  }
}

async function getKeyPair() {
  const res = await getData<any>('keyPair').catch(() => null);
  if (res) {
    return res;
  } else {
    throw new Error('Wallet not authenticated');
  }
}

export const publishData = async ({
  category,
  data,
  description,
  feeAmount,
  filename,
  identifier,
  registeredName,
  service,
  tag1,
  tag2,
  tag3,
  tag4,
  tag5,
  title,
  uploadType,
  withFee,
  appInfo,
  encryption,
  onProgress,
  signal,
}: any) => {
  // A cancel takes effect between chunks and, above all, before the
  // transaction is signed: nothing is paid for after it.
  const throwIfAborted = () => {
    if ((signal as AbortSignal | undefined)?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };

  // A busy node (5xx, 408, 429) is an error worth another try, not an
  // answer: anything else is read as before (an unknown name, its error).
  const getUnlessBusy = async (endpoint: string) => {
    const response = await fetch((await getBaseApi()) + endpoint);
    if (isRetryableStatus(response.status)) {
      throw await nodeAnswerError(response);
    }
    return await response.json();
  };

  const validateName = async (receiverName: string) => {
    return await getUnlessBusy(`/names/${receiverName}`);
  };

  const convertBytesForSigning = async (transactionBytesBase58: string) => {
    return await resuablePostRetry(
      '/transactions/convert',
      transactionBytesBase58,
      3,
      appInfo,
      { identifier, name: registeredName, service }
    );
  };

  const getArbitraryFee = async () => {
    const timestamp = Date.now();

    const fee = await getUnlessBusy(
      `/transactions/unitfee?txType=ARBITRARY&timestamp=${timestamp}`
    );

    return {
      timestamp,
      fee: Number(fee),
      feeToShow: (Number(fee) / 1e8).toFixed(8),
    };
  };

  const signArbitraryWithFee = (
    arbitraryBytesBase58,
    arbitraryBytesForSigningBase58,
    keyPair
  ) => {
    if (!arbitraryBytesBase58) {
      throw new Error('ArbitraryBytesBase58 not defined'); // TODO translate
    }

    if (!keyPair) {
      throw new Error('keyPair not defined');
    }

    const arbitraryBytes = Base58.decode(arbitraryBytesBase58);
    const _arbitraryBytesBuffer = Object.keys(arbitraryBytes).map(
      function (key) {
        return arbitraryBytes[key];
      }
    );
    const arbitraryBytesBuffer = new Uint8Array(_arbitraryBytesBuffer);
    const arbitraryBytesForSigning = Base58.decode(
      arbitraryBytesForSigningBase58
    );
    const _arbitraryBytesForSigningBuffer = Object.keys(
      arbitraryBytesForSigning
    ).map(function (key) {
      return arbitraryBytesForSigning[key];
    });
    const arbitraryBytesForSigningBuffer = new Uint8Array(
      _arbitraryBytesForSigningBuffer
    );
    const signature = nacl.sign.detached(
      arbitraryBytesForSigningBuffer,
      keyPair.privateKey
    );

    return utils.appendBuffer(arbitraryBytesBuffer, signature);
  };

  const processTransactionVersion2 = async (bytes) => {
    try {
      return await resuablePostRetry(
        '/transactions/process?apiVersion=2',
        Base58.encode(bytes),
        3,
        appInfo,
        { identifier, name: registeredName, service }
      );
    } catch (error) {
      // The node may have taken it although its answer was lost: a retry
      // then hears that it already exists, or no answer comes at all. The
      // signature (the last 64 bytes) says whether it did.
      const known = await knownTransaction(
        Base58.encode(bytes.slice(bytes.length - 64))
      );
      if (known) return known;
      // Not known yet, but the node may still take it (it goes on with a
      // request that timed out or was cut off): not a failure a caller should
      // try again by itself (a second transaction pays a second fee).
      if (isWorthRetrying(error)) {
        throw new Error(error?.message || 'Failed to make request');
      }
      throw error;
    }
  };

  const signAndProcessWithFee = async (transactionBytesBase58: string) => {
    const convertedBytesBase58 = await convertBytesForSigning(
      transactionBytesBase58
    );

    if (convertedBytesBase58.error) {
      throw new Error('Error when signing');
    }

    throwIfAborted();
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const signedArbitraryBytes = signArbitraryWithFee(
      transactionBytesBase58,
      convertedBytesBase58,
      keyPair
    );
    const response = await processTransactionVersion2(signedArbitraryBytes);

    let myResponse = { error: '' };

    if (response === false) {
      throw new Error('Error when signing');
    } else {
      myResponse = response;
    }

    return myResponse;
  };

  const validate = async () => {
    const validNameRes = await validateName(registeredName);

    if (validNameRes.error) {
      throw new Error('Name not found');
    }

    let fee = null;

    if (withFee && feeAmount) {
      fee = feeAmount;
    } else if (withFee) {
      const res = await getArbitraryFee();
      if (res.fee) {
        fee = res.fee;
      } else {
        throw new Error('unable to get fee');
      }
    }

    const transactionBytes = await uploadData(registeredName, data, fee);
    throwIfAborted();
    if (!transactionBytes || transactionBytes.error) {
      throw new Error(transactionBytes?.message || 'Error when uploading');
    } else if (transactionBytes.includes('Error 500 Internal Server Error')) {
      throw new Error('Error when uploading');
    }

    let signAndProcessRes;

    if (withFee) {
      signAndProcessRes = await signAndProcessWithFee(transactionBytes);
    }

    if (signAndProcessRes?.error) {
      throw new Error('Error when signing');
    }
    if (appInfo?.tabId) {
      executeEvent('receiveChunks', {
        tabId: appInfo.tabId,
        publishLocation: {
          name: registeredName,
          identifier,
          service,
        },
        processed: true,
      });
    }
    return signAndProcessRes;
  };

  const uploadData = async (registeredName: string, data: any, fee: number) => {
    let postBody = '';
    let urlSuffix = '';

    if (data != null) {
      if (uploadType === 'base64') {
        urlSuffix = '/base64';
      }

      if (uploadType === 'base64') {
        postBody = data;
      }
    } else {
      throw new Error('No data provided');
    }

    let uploadDataUrl = `/arbitrary/${service}/${registeredName}`;
    let paramQueries = '';
    if (identifier?.trim().length > 0) {
      uploadDataUrl = `/arbitrary/${service}/${registeredName}/${identifier}`;
    }

    paramQueries = paramQueries + `?fee=${fee}`;

    if (filename != null && filename != 'undefined') {
      paramQueries = paramQueries + '&filename=' + encodeURIComponent(filename);
    }

    if (title != null && title != 'undefined') {
      paramQueries = paramQueries + '&title=' + encodeURIComponent(title);
    }

    if (description != null && description != 'undefined') {
      paramQueries =
        paramQueries + '&description=' + encodeURIComponent(description);
    }

    if (category != null && category != 'undefined') {
      paramQueries = paramQueries + '&category=' + encodeURIComponent(category);
    }

    if (tag1 != null && tag1 != 'undefined') {
      paramQueries = paramQueries + '&tags=' + encodeURIComponent(tag1);
    }

    if (tag2 != null && tag2 != 'undefined') {
      paramQueries = paramQueries + '&tags=' + encodeURIComponent(tag2);
    }

    if (tag3 != null && tag3 != 'undefined') {
      paramQueries = paramQueries + '&tags=' + encodeURIComponent(tag3);
    }

    if (tag4 != null && tag4 != 'undefined') {
      paramQueries = paramQueries + '&tags=' + encodeURIComponent(tag4);
    }

    if (tag5 != null && tag5 != 'undefined') {
      paramQueries = paramQueries + '&tags=' + encodeURIComponent(tag5);
    }
    if (uploadType === 'zip') {
      paramQueries = paramQueries + '&isZip=' + true;
    }

    if (uploadType === 'base64') {
      if (urlSuffix) {
        uploadDataUrl = uploadDataUrl + urlSuffix;
      }

      uploadDataUrl = uploadDataUrl + paramQueries;
      if (appInfo?.tabId) {
        executeEvent('receiveChunks', {
          tabId: appInfo.tabId,
          publishLocation: {
            name: registeredName,
            identifier,
            service,
          },
          chunksSubmitted: 1,
          totalChunks: 1,
          processed: false,
          filename: filename || title || `${service}-${identifier || ''}`,
        });
      }
      const uploaded = await resuablePostRetry(
        uploadDataUrl,
        postBody,
        3,
        appInfo,
        { identifier, name: registeredName, service }
      );
      onProgress?.(1, 1);
      return uploaded;
    }

    const file = data;
    requirePublishFile(file);

    if (file?.size === 0) {
      postBody = await fileToBase64(file);
      uploadDataUrl = uploadDataUrl + '/base64';

      uploadDataUrl = uploadDataUrl + paramQueries;
      if (appInfo?.tabId) {
        executeEvent('receiveChunks', {
          tabId: appInfo.tabId,
          publishLocation: {
            name: registeredName,
            identifier,
            service,
          },
          chunksSubmitted: 1,
          totalChunks: 1,
          processed: false,
          filename: filename || title || `${service}-${identifier || ''}`,
        });
      }
      const uploaded = await resuablePostRetry(
        uploadDataUrl,
        postBody,
        3,
        appInfo,
        { identifier, name: registeredName, service }
      );
      onProgress?.(1, 1);
      return uploaded;
    }
    await checkPublishStorage(file.size, createEndpoint);

    // A file a node on this PC can read itself: it builds the transaction
    // from the file. No upload, and none of the node's own copies (it joins
    // an upload's chunks in the system's temporary folder, which some Linux
    // systems keep in memory). Null: it can't, so the file is uploaded.
    if (encryption == null && isNodeBuildable(file)) {
      throwIfAborted();
      onProgress?.(0, 1);
      const built = await file.buildOnNode(
        await createEndpoint(uploadDataUrl + paramQueries),
        filename
      );
      if (built) {
        onProgress?.(1, 1);
        return built;
      }
    }

    const chunkUrl = uploadDataUrl + `/chunk`;
    const chunkSize = 5 * 1024 * 1024; // 5MB

    const totalChunks = Math.ceil(file.size / chunkSize);
    if (appInfo?.tabId) {
      executeEvent('receiveChunks', {
        tabId: appInfo.tabId,
        publishLocation: {
          name: registeredName,
          identifier,
          service,
        },
        chunksSubmitted: 0,
        totalChunks,
        processed: false,
        filename:
          file?.name || filename || title || `${service}-${identifier || ''}`,
      });
    }
    onProgress?.(0, totalChunks);
    const keyBytes = encryption?.key || null;
    const ivBytes = encryption?.iv || null;

    let bytesProcessed = 0;

    for (let index = 0; index < totalChunks; index++) {
      throwIfAborted();
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);

      if (isQAppFileReference(file)) {
        await uploadChunkWithRetry(chunkUrl, null, index, 3, (endpoint) =>
          file.upload({
            start,
            end,
            index,
            endpoint,
            ...(encryption == null
              ? {}
              : { encryption: { key: keyBytes, iv: ivBytes } }),
          })
        );
      } else {
        const rawChunkBlob = file.slice(start, end);

        let chunkToUpload;

        if (encryption == null) {
          // NO ENCRYPTION —
          chunkToUpload = rawChunkBlob;
        } else {
          //  ENCRYPTION ENABLED — AES-CTR encrypt this chunk
          const rawBytes = new Uint8Array(await rawChunkBlob.arrayBuffer());

          const blockOffset = BigInt(bytesProcessed) / 16n;

          const encryptedBytes = await encryptAesCtrChunkWithFallback(
            keyBytes,
            ivBytes,
            blockOffset,
            rawBytes
          );

          chunkToUpload = new Blob([encryptedBytes]);
          bytesProcessed += rawBytes.length;
        }

        // Upload the (encrypted or raw) chunk
        const formData = new FormData();
        formData.append('chunk', chunkToUpload, file.name);
        formData.append('index', index);

        await uploadChunkWithRetry(chunkUrl, formData, index);
      }

      if (appInfo?.tabId) {
        executeEvent('receiveChunks', {
          tabId: appInfo.tabId,
          publishLocation: { name: registeredName, identifier, service },
          chunksSubmitted: index + 1,
          totalChunks,
        });
      }
      onProgress?.(index + 1, totalChunks);
    }
    throwIfAborted();
    const finalizeUrl = uploadDataUrl + `/finalize` + paramQueries;

    const finalizeEndpoint = await createEndpoint(finalizeUrl);

    const response = await fetch(finalizeEndpoint, {
      method: 'POST',
      headers: {},
    });

    if (!response?.ok) {
      if (needsApiKey(response.status)) {
        throw await nodeAnswerError(response);
      }
      const errorText = await response.text();
      throw new Error(`Finalize failed: ${errorText}`);
    }

    const result = await response.text(); // Base58-encoded unsigned transaction
    return result;
  };

  try {
    return await validate();
  } catch (error: any) {
    // Keep the error's type (NodeAnswerError's status, a fetch TypeError) so
    // callers can tell a refusal from a network failure.
    // A cancel stays an AbortError (a DOMException).
    throw error instanceof Error || error?.name === 'AbortError'
      ? error
      : new Error(error?.message);
  }
};

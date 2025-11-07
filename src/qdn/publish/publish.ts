// @ts-nocheck

import { Buffer } from 'buffer';
import Base58 from '../../encryption/Base58';
import nacl from '../../encryption/nacl-fast';
import utils from '../../utils/utils';
import { createEndpoint, getBaseApi } from '../../background/background';
import { getData } from '../../utils/chromeStorage';
import { executeEvent } from '../../utils/events';
import { fileToBase64 } from '../../utils/fileReading';

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
    const errorText = await response.text();
    throw new Error(errorText);
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

async function uploadChunkWithRetry(endpoint, formData, index, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await reusablePostStream(endpoint, formData);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }
      return; // Success
    } catch (err) {
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
      attempt++;
      if (attempt >= maxRetries) {
        throw new Error(
          err instanceof Error
            ? err?.message || `Failed to make request`
            : `Failed to make request`
        );
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
}: any) => {
  const validateName = async (receiverName: string) => {
    return await reusableGet(`/names/${receiverName}`);
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

    let fee = await reusableGet(
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
    return await resuablePostRetry(
      '/transactions/process?apiVersion=2',
      Base58.encode(bytes),
      3,
      appInfo,
      { identifier, name: registeredName, service }
    );
  };

  const signAndProcessWithFee = async (transactionBytesBase58: string) => {
    let convertedBytesBase58 = await convertBytesForSigning(
      transactionBytesBase58
    );

    if (convertedBytesBase58.error) {
      throw new Error('Error when signing');
    }

    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    let signedArbitraryBytes = signArbitraryWithFee(
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
    let validNameRes = await validateName(registeredName);

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

    let transactionBytes = await uploadData(registeredName, data, fee);
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
      return await resuablePostRetry(uploadDataUrl, postBody, 3, appInfo, {
        identifier,
        name: registeredName,
        service,
      });
    }

    const file = data;

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
      return await resuablePostRetry(uploadDataUrl, postBody, 3, appInfo, {
        identifier,
        name: registeredName,
        service,
      });
    }
    const urlCheck = `/arbitrary/check/tmp?totalSize=${file.size}`;

    const checkEndpoint = await createEndpoint(urlCheck);
    const checkRes = await fetch(checkEndpoint);
    if (!checkRes.ok) {
      throw new Error('Not enough space on your hard drive');
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
    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('chunk', chunk, file.name); // Optional: include filename
      formData.append('index', index);

      await uploadChunkWithRetry(chunkUrl, formData, index);
      if (appInfo?.tabId) {
        executeEvent('receiveChunks', {
          tabId: appInfo.tabId,
          publishLocation: {
            name: registeredName,
            identifier,
            service,
          },
          chunksSubmitted: index + 1,
          totalChunks,
        });
      }
    }
    const finalizeUrl = uploadDataUrl + `/finalize` + paramQueries;

    const finalizeEndpoint = await createEndpoint(finalizeUrl);

    const response = await fetch(finalizeEndpoint, {
      method: 'POST',
      headers: {},
    });

    if (!response?.ok) {
      const errorText = await response.text();
      throw new Error(`Finalize failed: ${errorText}`);
    }

    const result = await response.text(); // Base58-encoded unsigned transaction
    return result;
  };

  try {
    return await validate();
  } catch (error: any) {
    throw new Error(error?.message);
  }
};

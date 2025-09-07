import { Sha256 } from 'asmcrypto.js';
import {
  createEndpoint,
  getBalanceInfo,
  getFee,
  getKeyPair,
  getLastRef,
  getSaveWallet,
  processTransactionVersion2,
  signChatFunc,
  joinGroup as joinGroupFunc,
  sendQortFee,
  sendCoin as sendCoinFunc,
  createBuyOrderTx,
  performPowTask,
  parseErrorResponse,
  groupSecretkeys,
  registerName,
  updateName,
  leaveGroup,
  inviteToGroup,
  getNameInfoForOthers,
  kickFromGroup,
  banFromGroup,
  cancelBan,
  makeAdmin,
  removeAdmin,
  cancelInvitationToGroup,
  createGroup,
  updateGroup,
  sellName,
  cancelSellName,
  buyName,
  getBaseApi,
  getAssetBalanceInfo,
  getNameOrAddress,
  getAssetInfo,
  getPublicKey,
  transferAsset,
} from '../background/background.ts';
import {
  getAllUserNames,
  getNameInfo,
  uint8ArrayToObject,
} from '../encryption/encryption.ts';
import { showSaveFilePicker } from '../hooks/useQortalMessageListener.tsx';
import { getPublishesFromAdminsAdminSpace } from '../components/Chat/AdminSpaceInner.tsx';
import { extractComponents } from '../components/Chat/MessageDisplay.tsx';
import {
  decryptResource,
  getGroupAdmins,
  getPublishesFromAdmins,
  validateSecretKey,
} from '../components/Group/Group.tsx';
import {
  MAX_SIZE_PUBLIC_NODE,
  MAX_SIZE_PUBLISH,
  MIN_REQUIRED_QORTS,
  QORT_DECIMALS,
  TIME_MINUTES_20_IN_MILLISECONDS,
} from '../constants/constants.ts';
import Base58 from '../encryption/Base58.ts';
import ed2curve from '../encryption/ed2curve.ts';
import nacl from '../encryption/nacl-fast.ts';
import {
  base64ToUint8Array,
  createSymmetricKeyAndNonce,
  decryptDeprecatedSingle,
  decryptGroupDataQortalRequest,
  decryptGroupEncryptionWithSharingKey,
  decryptSingle,
  encryptDataGroup,
  encryptSingle,
  objectToBase64,
  uint8ArrayStartsWith,
  uint8ArrayToBase64,
} from '../qdn/encryption/group-encryption.ts';
import { publishData } from '../qdn/publish/publish.ts';
import {
  getPermission,
  isRunningGateway,
  setPermission,
} from './qortal-requests.ts';
import TradeBotCreateRequest from '../transactions/TradeBotCreateRequest.ts';
import DeleteTradeOffer from '../transactions/TradeBotDeleteRequest.ts';
import signTradeBotTransaction from '../transactions/signTradeBotTransaction.ts';
import { createTransaction } from '../transactions/transactions.ts';
import { executeEvent } from '../utils/events.ts';
import { fileToBase64 } from '../utils/fileReading/index.ts';
import { mimeToExtensionMap } from '../utils/memeTypes.ts';
import { RequestQueueWithPromise } from '../utils/queue/queue.ts';
import utils from '../utils/utils.ts';
import ShortUniqueId from 'short-unique-id';
import { isValidBase64WithDecode } from '../utils/decode.ts';
import i18n from 'i18next';

const uid = new ShortUniqueId({ length: 6 });

export const requestQueueGetAtAddresses = new RequestQueueWithPromise(10);

const sellerForeignFee = {
  LITECOIN: {
    value: '~0.00005',
    ticker: 'LTC',
  },
  DOGECOIN: {
    value: '~0.005',
    ticker: 'DOGE',
  },
  BITCOIN: {
    value: '~0.0001',
    ticker: 'BTC',
  },
  DIGIBYTE: {
    value: '~0.0005',
    ticker: 'DGB',
  },
  RAVENCOIN: {
    value: '~0.006',
    ticker: 'RVN',
  },
  PIRATECHAIN: {
    value: '~0.0002',
    ticker: 'ARRR',
  },
};

const btcFeePerByte = 0.000001;
const ltcFeePerByte = 0.0000003;
const dogeFeePerByte = 0.00001;
const dgbFeePerByte = 0.0000001;
const rvnFeePerByte = 0.00001125;

const MAX_RETRIES = 3; // Set max number of retries

export async function retryTransaction(
  fn,
  args,
  throwError,
  retries = MAX_RETRIES
) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed: ${error.message}`);
      attempt++;
      if (attempt === retries) {
        console.error(
          i18n.t('question:message.generic.max_retry_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        if (throwError) {
          throw new Error(
            error?.message ||
              i18n.t('question:message.error.process_transaction', {
                postProcess: 'capitalizeFirstChar',
              })
          );
        } else {
          throw new Error(
            error?.message ||
              i18n.t('question:message.error.process_transaction', {
                postProcess: 'capitalizeFirstChar',
              })
          );
        }
      }
      await new Promise((res) => setTimeout(res, 10000));
    }
  }
}

function roundUpToDecimals(number, decimals = 8) {
  const factor = Math.pow(10, decimals); // Create a factor based on the number of decimals
  return Math.ceil(+number * factor) / factor;
}

export const _createPoll = async (
  { pollName, pollDescription, options },
  isFromExtension,
  skipPermission
) => {
  const fee = await getFee('CREATE_POLL');
  let resPermission = {};
  if (!skipPermission) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:request_create_poll', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:poll', {
          name: pollName,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:description', {
          description: pollDescription,
          postProcess: 'capitalizeFirstChar',
        }),
        text4: i18n.t('question:options', {
          optionList: options?.join(', '),
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension
    );
  }

  const { accepted = false } = resPermission;

  if (accepted || skipPermission) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(8, keyPair, {
      fee: fee.fee,
      ownerAddress: address,
      rPollName: pollName,
      rPollDesc: pollDescription,
      rOptions: options,
      lastReference: lastRef,
    });
    const signedBytes = Base58.encode(tx.signedBytes);
    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const _deployAt = async (
  { name, description, tags, creationBytes, amount, assetId, atType },
  isFromExtension
) => {
  const fee = await getFee('DEPLOY_AT');

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:deploy_at', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:name', {
        name: name,
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:description', {
        description: description,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );

  const { accepted } = resPermission;

  if (accepted) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const lastReference = await getLastRef();
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const tx = await createTransaction(16, keyPair, {
      fee: fee.fee,
      rName: name,
      rDescription: description,
      rTags: tags,
      rAmount: amount,
      rAssetId: assetId,
      rCreationBytes: creationBytes,
      atType: atType,
      lastReference: lastReference,
    });

    const signedBytes = Base58.encode(tx.signedBytes);

    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const _voteOnPoll = async (
  { pollName, optionIndex, optionName },
  isFromExtension,
  skipPermission
) => {
  const fee = await getFee('VOTE_ON_POLL');
  let resPermission = {};

  if (!skipPermission) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:request_vote_poll', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:poll', {
          name: pollName,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:option', {
          option: optionName,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension
    );
  }

  const { accepted = false } = resPermission;

  if (accepted || skipPermission) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    let lastRef = await getLastRef();

    const tx = await createTransaction(9, keyPair, {
      fee: fee.fee,
      voterAddress: address,
      rPollName: pollName,
      rOptionIndex: optionIndex,
      lastReference: lastRef,
    });
    const signedBytes = Base58.encode(tx.signedBytes);
    const res = await processTransactionVersion2(signedBytes);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

// Map to store resolvers and rejectors by requestId
const fileRequestResolvers = new Map();

const handleFileMessage = (event) => {
  const { action, requestId, result, error } = event.data;

  if (
    action === 'getFileFromIndexedDBResponse' &&
    fileRequestResolvers.has(requestId)
  ) {
    const { resolve, reject } = fileRequestResolvers.get(requestId);
    fileRequestResolvers.delete(requestId); // Clean up after resolving

    if (result) {
      resolve(result);
    } else {
      reject(
        error ||
          i18n.t('question:message.error.retrieve_file', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  }
};

window.addEventListener('message', handleFileMessage);

function getFileFromContentScript(fileId) {
  return new Promise((resolve, reject) => {
    const requestId = `getFile_${fileId}_${Date.now()}`;

    fileRequestResolvers.set(requestId, { resolve, reject }); // Store resolvers by requestId
    const targetOrigin = window.location.origin;

    // Send the request message
    window.postMessage(
      { action: 'getFileFromIndexedDB', fileId, requestId },
      targetOrigin
    );

    // Timeout to handle no response scenario
    setTimeout(() => {
      if (fileRequestResolvers.has(requestId)) {
        fileRequestResolvers.get(requestId).reject(
          i18n.t('question:message.error.timeout_request', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        fileRequestResolvers.delete(requestId); // Clean up on timeout
      }
    }, 10000); // 10-second timeout
  });
}

const responseResolvers = new Map();

const handleMessage = (event) => {
  const { action, requestId, result } = event.data;

  // Check if this is the expected response action and if we have a stored resolver
  if (
    action === 'QORTAL_REQUEST_PERMISSION_RESPONSE' &&
    responseResolvers.has(requestId)
  ) {
    // Resolve the stored promise with the result
    responseResolvers.get(requestId)(result || false);
    responseResolvers.delete(requestId); // Clean up after resolving
  }
};

window.addEventListener('message', handleMessage);

async function getUserPermission(payload, isFromExtension) {
  return new Promise((resolve) => {
    const requestId = `qortalRequest_${Date.now()}`;
    responseResolvers.set(requestId, resolve); // Store resolver by requestId
    const targetOrigin = window.location.origin;

    // Send the request message
    window.postMessage(
      {
        action: 'QORTAL_REQUEST_PERMISSION',
        payload,
        requestId,
        isFromExtension,
      },
      targetOrigin
    );

    // Optional timeout to handle no response scenario
    setTimeout(() => {
      if (responseResolvers.has(requestId)) {
        responseResolvers.get(requestId)(false); // Resolve with `false` if no response
        responseResolvers.delete(requestId);
      }
    }, 60000); // 60-second timeout
  });
}

export const getUserAccount = async ({
  isFromExtension,
  appInfo,
  skipAuth,
}) => {
  try {
    const value =
      (await getPermission(`qAPPAutoAuth-${appInfo?.name}`)) || false;
    let skip = false;
    if (value) {
      skip = true;
    }
    if (skipAuth) {
      skip = true;
    }
    let resPermission;
    if (!skip) {
      resPermission = await getUserPermission(
        {
          text1: i18n.t('question:permission.authenticate', {
            postProcess: 'capitalizeFirstChar',
          }),
          checkbox1: {
            value: false,
            label: i18n.t('question:always_authenticate', {
              postProcess: 'capitalizeFirstChar',
            }),
          },
        },
        isFromExtension
      );
    }

    const { accepted = false, checkbox1 = false } = resPermission || {};
    if (resPermission) {
      setPermission(`qAPPAutoAuth-${appInfo?.name}`, checkbox1);
    }
    if (accepted || skip) {
      const wallet = await getSaveWallet();
      const address = wallet.address0;
      const publicKey = wallet.publicKey;
      return {
        address,
        publicKey,
      };
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      i18n.t('auth:message.error.fetch_user_account', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const encryptData = async (data, sender) => {
  let data64 = data.data64 || data.base64;
  const publicKeys = data.publicKeys || [];
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;

  const encryptDataResponse = encryptDataGroup({
    data64,
    publicKeys: publicKeys,
    privateKey,
    userPublicKey,
  });
  if (encryptDataResponse) {
    return encryptDataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const encryptQortalGroupData = async (data, sender) => {
  let data64 = data?.data64 || data?.base64;
  const groupId = data?.groupId;
  const isAdmins = data?.isAdmins;
  if (!groupId) {
    throw new Error(
      i18n.t('question:message.generic.provide_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let secretKeyObject;
  if (!isAdmins) {
    if (
      groupSecretkeys[groupId] &&
      groupSecretkeys[groupId].secretKeyObject &&
      groupSecretkeys[groupId]?.timestamp &&
      Date.now() - groupSecretkeys[groupId]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[groupId].secretKeyObject;
    }

    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdmins(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const res = await fetch(url);
      const resData = await res.text();

      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[groupId] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  } else {
    if (
      groupSecretkeys[`admins-${groupId}`] &&
      groupSecretkeys[`admins-${groupId}`].secretKeyObject &&
      groupSecretkeys[`admins-${groupId}`]?.timestamp &&
      Date.now() - groupSecretkeys[`admins-${groupId}`]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[`admins-${groupId}`].secretKeyObject;
    }

    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdminsAdminSpace(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const res = await fetch(url);
      const resData = await res.text();
      const decryptedKey: any = await decryptResource(resData, true);
      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[`admins-${groupId}`] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  }

  const resGroupEncryptedResource = encryptSingle({
    data64,
    secretKeyObject: secretKeyObject,
  });

  if (resGroupEncryptedResource) {
    return resGroupEncryptedResource;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptQortalGroupData = async (data, sender) => {
  const data64 = data?.data64 || data?.base64;
  const groupId = data?.groupId;
  const isAdmins = data?.isAdmins;
  if (!groupId) {
    throw new Error(
      i18n.t('question:message.generic.provide_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let secretKeyObject;
  if (!isAdmins) {
    if (
      groupSecretkeys[groupId] &&
      groupSecretkeys[groupId].secretKeyObject &&
      groupSecretkeys[groupId]?.timestamp &&
      Date.now() - groupSecretkeys[groupId]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[groupId].secretKeyObject;
    }
    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdmins(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const res = await fetch(url);
      const resData = await res.text();
      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[groupId] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  } else {
    if (
      groupSecretkeys[`admins-${groupId}`] &&
      groupSecretkeys[`admins-${groupId}`].secretKeyObject &&
      groupSecretkeys[`admins-${groupId}`]?.timestamp &&
      Date.now() - groupSecretkeys[`admins-${groupId}`]?.timestamp <
        TIME_MINUTES_20_IN_MILLISECONDS
    ) {
      secretKeyObject = groupSecretkeys[`admins-${groupId}`].secretKeyObject;
    }
    if (!secretKeyObject) {
      const { names } = await getGroupAdmins(groupId);

      const publish = await getPublishesFromAdminsAdminSpace(names, groupId);
      if (publish === false)
        throw new Error(
          i18n.t('question:message.error.no_group_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const url = await createEndpoint(
        `/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${
          publish.identifier
        }?encoding=base64&rebuild=true`
      );

      const res = await fetch(url);
      const resData = await res.text();
      const decryptedKey: any = await decryptResource(resData, true);

      const dataint8Array = base64ToUint8Array(decryptedKey.data);
      const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
      if (!validateSecretKey(decryptedKeyToObject))
        throw new Error(
          i18n.t('auth:message.error.invalid_secret_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      secretKeyObject = decryptedKeyToObject;
      groupSecretkeys[`admins-${groupId}`] = {
        secretKeyObject,
        timestamp: Date.now(),
      };
    }
  }

  const resGroupDecryptResource = decryptSingle({
    data64,
    secretKeyObject: secretKeyObject,
    skipDecodeBase64: true,
  });
  if (resGroupDecryptResource) {
    return resGroupDecryptResource;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const encryptDataWithSharingKey = async (data, sender) => {
  let data64 = data?.data64 || data?.base64;
  const publicKeys = data.publicKeys || [];
  if (data?.file || data?.blob) {
    data64 = await fileToBase64(data?.file || data?.blob);
  }
  if (!data64) {
    throw new Error(
      i18n.t('question:message.generic.include_data_encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const symmetricKey = createSymmetricKeyAndNonce();
  const dataObject = {
    data: data64,
    key: symmetricKey.messageKey,
  };
  const dataObjectBase64 = await objectToBase64(dataObject);

  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;

  const encryptDataResponse = encryptDataGroup({
    data64: dataObjectBase64,
    publicKeys: publicKeys,
    privateKey,
    userPublicKey,
    customSymmetricKey: symmetricKey.messageKey,
  });
  if (encryptDataResponse) {
    return encryptDataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.error.encrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptDataWithSharingKey = async (data, sender) => {
  const { encryptedData, key } = data;

  if (!encryptedData) {
    throw new Error(
      i18n.t('question:message.generic.include_data_decrypt', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const decryptedData = await decryptGroupEncryptionWithSharingKey({
    data64EncryptedData: encryptedData,
    key,
  });

  const base64ToObject = JSON.parse(atob(decryptedData));

  if (!base64ToObject.data)
    throw new Error(
      i18n.t('question:message.error.no_data_encrypted_resource', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  return base64ToObject.data;
};

export const getHostedData = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:message.error.submit_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );
  const { accepted } = resPermission;

  if (accepted) {
    const limit = data?.limit ? data?.limit : 20;
    const query = data?.query ? data?.query : '';
    const offset = data?.offset ? data?.offset : 0;

    let urlPath = `/arbitrary/hosted/resources/?limit=${limit}&offset=${offset}`;
    if (query) {
      urlPath = urlPath + `&query=${query}`;
    }

    const url = await createEndpoint(urlPath);
    const response = await fetch(url);
    const dataResponse = await response.json();
    return dataResponse;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const deleteHostedData = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['hostedData'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.delete_hosts_resources', {
        size: data?.hostedData?.length,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );
  const { accepted } = resPermission;

  if (accepted) {
    const { hostedData } = data;

    for (const hostedDataItem of hostedData) {
      try {
        const url = await createEndpoint(
          `/arbitrary/resource/${hostedDataItem.service}/${hostedDataItem.name}/${hostedDataItem.identifier}`
        );
        await fetch(url, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        console.log(error);
      }
    }

    return true;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_delete_hosted_resources', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};
export const decryptData = async (data) => {
  const { encryptedData, publicKey } = data;

  if (!encryptedData) {
    throw new Error(`Missing fields: encryptedData`);
  }
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const uint8PrivateKey = Base58.decode(parsedData.privateKey);
  const uint8Array = base64ToUint8Array(encryptedData);
  const startsWithQortalEncryptedData = uint8ArrayStartsWith(
    uint8Array,
    'qortalEncryptedData'
  );
  if (startsWithQortalEncryptedData) {
    if (!publicKey) {
      throw new Error(`Missing fields: publicKey`);
    }

    const decryptedDataToBase64 = decryptDeprecatedSingle(
      uint8Array,
      publicKey,
      uint8PrivateKey
    );
    return decryptedDataToBase64;
  }
  const startsWithQortalGroupEncryptedData = uint8ArrayStartsWith(
    uint8Array,
    'qortalGroupEncryptedData'
  );
  if (startsWithQortalGroupEncryptedData) {
    const decryptedData = decryptGroupDataQortalRequest(
      encryptedData,
      parsedData.privateKey
    );
    const decryptedDataToBase64 = uint8ArrayToBase64(decryptedData);
    return decryptedDataToBase64;
  }
  throw new Error(
    i18n.t('question:message.error.encrypt', {
      postProcess: 'capitalizeFirstChar',
    })
  );
};

export const getListItems = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const value = (await getPermission('qAPPAutoLists')) || false;

  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;
  let acceptedVar;
  let checkbox1Var;
  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.access_list', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: data.list_name,
        checkbox1: {
          value: value,
          label: i18n.t('question:always_retrieve_list', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
    const { accepted, checkbox1 } = resPermission;
    acceptedVar = accepted;
    checkbox1Var = checkbox1;
    setPermission('qAPPAutoLists', checkbox1);
  }

  if (acceptedVar || skip) {
    const url = await createEndpoint(`/lists/${data.list_name}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    const list = await response.json();
    return list;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_share_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const addListItems = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name', 'items'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const items = data.items;
  const list_name = data.list_name;

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.all_item_list', {
        name: list_name,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: items.join(', '),
    },
    isFromExtension
  );
  const { accepted } = resPermission;

  if (accepted) {
    const url = await createEndpoint(`/lists/${list_name}`);
    const body = {
      items: items,
    };
    const bodyToString = JSON.stringify(body);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyToString,
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.add_to_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_add_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const deleteListItems = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['list_name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data?.item && !data?.items) {
    throw new Error(
      i18n.t('question:message.error.missing_fields', {
        fields: 'items',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const item = data?.item;
  const items = data?.items;
  const list_name = data.list_name;

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.remove_from_list', {
        name: list_name,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: items ? JSON.stringify(items) : item,
    },
    isFromExtension
  );
  const { accepted } = resPermission;

  if (accepted) {
    const url = await createEndpoint(`/lists/${list_name}`);
    const body = {
      items: items || [item],
    };
    const bodyToString = JSON.stringify(body);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyToString,
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.add_to_list', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_delete_from_list', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const publishQDNResource = async (
  data: any,
  sender,
  isFromExtension
) => {
  const requiredFields = ['service'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data.file && !data.data64 && !data.base64) {
    throw new Error(
      i18n.t('question:message.error.no_data_file_submitted', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  // Use "default" if user hasn't specified an identifier
  const service = data.service;
  const appFee = data?.appFee ? +data.appFee : undefined;
  const appFeeRecipient = data?.appFeeRecipient;
  let hasAppFee = false;
  if (appFee && appFee > 0 && appFeeRecipient) {
    hasAppFee = true;
  }
  const registeredName = data?.name || (await getNameInfo());
  const name = registeredName;
  if (!name) {
    throw new Error(
      i18n.t('question:message.error.user_qortal_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let identifier = data.identifier;
  let data64 = data.data64 || data.base64;
  const filename = data.filename;
  const title = data.title;
  const description = data.description;
  const category = data.category;
  const file = data?.file || data?.blob;
  const tags = data?.tags || [];
  const result = {};
  const isMultiFileZip = data?.isMultiFileZip === true;

  if (file && file.size > MAX_SIZE_PUBLISH) {
    throw new Error(
      i18n.t('question:message.error.max_size_publish', {
        size: 2,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (file && file.size > MAX_SIZE_PUBLIC_NODE) {
    const isPublicNode = await isRunningGateway();
    if (isPublicNode) {
      throw new Error(
        i18n.t('question:message.error.max_size_publish_public', {
          size: 500,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }

  // Fill tags dynamically while maintaining backward compatibility
  for (let i = 0; i < 5; i++) {
    result[`tag${i + 1}`] = tags[i] || data[`tag${i + 1}`] || undefined;
  }

  // Access tag1 to tag5 from result
  const { tag1, tag2, tag3, tag4, tag5 } = result;

  if (data.identifier == null) {
    identifier = 'default';
  }

  if (
    data.encrypt &&
    (!data.publicKeys ||
      (Array.isArray(data.publicKeys) && data.publicKeys.length === 0))
  ) {
    throw new Error(
      i18n.t('question:message.error.encryption_requires_public_key', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (data.encrypt) {
    try {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const privateKey = parsedData.privateKey;
      const userPublicKey = parsedData.publicKey;
      if (data?.file || data?.blob) {
        data64 = await fileToBase64(data?.file || data?.blob);
      }
      const encryptDataResponse = encryptDataGroup({
        data64,
        publicKeys: data.publicKeys,
        privateKey,
        userPublicKey,
      });
      if (encryptDataResponse) {
        data64 = encryptDataResponse;
      }
    } catch (error) {
      throw new Error(
        error.message ||
          i18n.t('question:message.error.upload_encryption', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  }

  const fee = await getFee('ARBITRARY');

  const handleDynamicValues = {};
  if (hasAppFee) {
    const feePayment = await getFee('PAYMENT');

    (handleDynamicValues['appFee'] = +appFee + +feePayment.fee),
      (handleDynamicValues['checkbox1'] = {
        value: true,
        label: i18n.t('question:accept_app_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
  }
  if (!!data?.encrypt) {
    handleDynamicValues['highlightedText'] = `isEncrypted: ${!!data.encrypt}`;
  }
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.publish_qdn', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: `service: ${service}`,
      text3: `identifier: ${identifier || null}`,
      text4: `name: ${registeredName}`,
      fee: fee.fee,
      ...handleDynamicValues,
    },
    isFromExtension
  );
  const { accepted, checkbox1 = false } = resPermission;
  if (accepted) {
    try {
      const resPublish = await publishData({
        registeredName: encodeURIComponent(name),
        data: data64 ? data64 : file,
        service: service,
        identifier: encodeURIComponent(identifier),
        uploadType: isMultiFileZip ? 'zip' : data64 ? 'base64' : 'file',
        filename: filename,
        title,
        description,
        category,
        tag1,
        tag2,
        tag3,
        tag4,
        tag5,
        apiVersion: 2,
        withFee: true,
      });
      if (resPublish?.signature && hasAppFee && checkbox1) {
        sendCoinFunc(
          {
            amount: appFee,
            receiver: appFeeRecipient,
          },
          true
        );
      }
      return resPublish;
    } catch (error) {
      throw new Error(error?.message || 'Upload failed');
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const checkArrrSyncStatus = async (seed) => {
  const _url = await createEndpoint(`/crosschain/arrr/syncstatus`);
  let tries = 0; // Track the number of attempts

  while (tries < 36) {
    const response = await fetch(_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: seed,
    });

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res.indexOf('<') > -1 || res !== 'Synchronized') {
      // Wait 2 seconds before trying again
      await new Promise((resolve) => setTimeout(resolve, 2000));
      tries += 1;
    } else {
      // If the response doesn't meet the two conditions, exit the function
      return;
    }
  }

  // If we exceed N tries, throw an error
  throw new Error(
    i18n.t('question:message.error.synchronization_attempts', {
      count: 36,
      postProcess: 'capitalizeFirstChar',
    })
  );
};

export const publishMultipleQDNResources = async (
  data: any,
  sender,
  isFromExtension,
  appInfo
) => {
  const requiredFields = ['resources'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const resources = data.resources;
  if (!Array.isArray(resources)) {
    throw new Error(
      i18n.t('group:message.generic.invalid_data', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  if (resources.length === 0) {
    throw new Error(
      i18n.t('question:message.error.no_resources_publish', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const isPublicNode = await isRunningGateway();
  if (isPublicNode) {
    const hasOversizedFilePublicNode = resources.some((resource) => {
      const file = resource?.file;
      return file instanceof File && file.size > MAX_SIZE_PUBLIC_NODE;
    });

    if (hasOversizedFilePublicNode) {
      throw new Error(
        i18n.t('question:message.error.max_size_publish_public', {
          size: 500,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }

  const hasOversizedFile = resources.some((resource) => {
    const file = resource?.file;
    return file instanceof File && file.size > MAX_SIZE_PUBLISH;
  });

  if (hasOversizedFile) {
    throw new Error(
      i18n.t('question:message.error.max_size_publish', {
        size: 2,
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const totalFileSize = resources.reduce((acc, resource) => {
    const file = resource?.file;
    if (file && file?.size && !isNaN(file?.size)) {
      return acc + file.size;
    }
    return acc;
  }, 0);
  if (totalFileSize > 0) {
    const urlCheck = `/arbitrary/check/tmp?totalSize=${totalFileSize}`;

    const checkEndpoint = await createEndpoint(urlCheck);
    const checkRes = await fetch(checkEndpoint);
    if (!checkRes.ok) {
      throw new Error('Not enough space on your hard drive');
    }
  }

  const encrypt = data?.encrypt;

  for (const resource of resources) {
    const resourceEncrypt = encrypt && resource?.disableEncrypt !== true;

    if (!resourceEncrypt && resource?.service.endsWith('_PRIVATE')) {
      const errorMsg = i18n.t('question:message.error.only_encrypted_data', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    } else if (resourceEncrypt && !resource?.service.endsWith('_PRIVATE')) {
      const errorMsg = i18n.t('question:message.error.use_private_service', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
  }

  const fee = await getFee('ARBITRARY');
  const registeredName = await getNameInfo();

  const name = registeredName;

  if (!name) {
    throw new Error(
      i18n.t('question:message.error.registered_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const userNames = await getAllUserNames();
  data.resources?.forEach((item) => {
    if (item?.name && !userNames?.includes(item.name))
      throw new Error(
        `The name ${item.name}, does not belong to the publisher.`
      );
  });

  const appFee = data?.appFee ? +data.appFee : undefined;
  const appFeeRecipient = data?.appFeeRecipient;
  let hasAppFee = false;

  if (appFee && appFee > 0 && appFeeRecipient) {
    hasAppFee = true;
  }

  const handleDynamicValues = {};
  if (hasAppFee) {
    const feePayment = await getFee('PAYMENT');

    (handleDynamicValues['appFee'] = +appFee + +feePayment.fee),
      (handleDynamicValues['checkbox1'] = {
        value: true,
        label: i18n.t('question:accept_app_fee', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
  }
  if (data?.encrypt) {
    handleDynamicValues['highlightedText'] = `isEncrypted: ${!!data.encrypt}`;
  }
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.publish_qdn', {
        postProcess: 'capitalizeFirstChar',
      }),
      html: `
    <div style="max-height: 30vh; overflow-y: auto;">
    <style>
      .resource-container {
        display: flex;
        flex-direction: column;
        border: 1px solid #444;
        padding: 16px;
        margin: 8px 0;
        border-radius: 8px;
        background-color: var(--background-default);
      }
      
      .resource-detail {
        margin-bottom: 8px;
      }
      
      .resource-detail span {
        font-weight: bold;
        color: var(--text-primary);
      }
  
      @media (min-width: 600px) {
        .resource-container {
          flex-direction: row;
          flex-wrap: wrap;
        }
        .resource-detail {
          flex: 1 1 45%;
          margin-bottom: 0;
          padding: 4px 0;
        }
      }
    </style>
  
    ${data.resources
      .map(
        (resource) => `
        <div class="resource-container">
          <div class="resource-detail"><span>Service:</span> ${
            resource.service
          }</div>
          <div class="resource-detail"><span>Name:</span> ${resource?.name || name}</div>
          <div class="resource-detail"><span>Identifier:</span> ${
            resource.identifier
          }</div>
          ${
            resource.filename
              ? `<div class="resource-detail"><span>Filename:</span> ${resource.filename}</div>`
              : ''
          }
        </div>`
      )
      .join('')}
  </div>
  
      `,
      fee: +fee.fee * resources.length,
      ...handleDynamicValues,
    },
    isFromExtension
  );

  const { accepted, checkbox1 = false } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  type FailedPublish = {
    reason: string;
    identifier: any;
    service: any;
  };

  const failedPublishesIdentifiers: FailedPublish[] = [];
  const publishedResponses = [];
  for (const resource of resources) {
    try {
      const requiredFields = ['service'];
      const missingFields: string[] = [];
      requiredFields.forEach((field) => {
        if (!resource[field]) {
          missingFields.push(field);
        }
      });
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ');
        const errorMsg = i18n.t('question:message.error.missing_fields', {
          fields: missingFieldsString,
          postProcess: 'capitalizeFirstChar',
        });
        failedPublishesIdentifiers.push({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      if (!resource.file && !resource.data64 && !resource?.base64) {
        const errorMsg = i18n.t(
          'question:message.error.no_data_file_submitted',
          {
            postProcess: 'capitalizeFirstChar',
          }
        );
        failedPublishesIdentifiers.push({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      const service = resource.service;
      let identifier = resource.identifier;
      let rawData = resource?.data64 || resource?.base64;
      const filename = resource.filename;
      const title = resource.title;
      const description = resource.description;
      const category = resource.category;
      const tags = resource?.tags || [];
      const result = {};
      const isMultiFileZip = resource?.isMultiFileZip === true;

      // Fill tags dynamically while maintaining backward compatibility
      for (let i = 0; i < 5; i++) {
        result[`tag${i + 1}`] = tags[i] || resource[`tag${i + 1}`] || undefined;
      }

      // Access tag1 to tag5 from result
      const { tag1, tag2, tag3, tag4, tag5 } = result;
      const resourceEncrypt = encrypt && resource?.disableEncrypt !== true;
      if (resource.identifier == null) {
        identifier = 'default';
      }
      if (!resourceEncrypt && service.endsWith('_PRIVATE')) {
        const errorMsg = i18n.t('question:message.error.only_encrypted_data', {
          postProcess: 'capitalizeFirstChar',
        });
        failedPublishesIdentifiers.push({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
        continue;
      }
      if (resource.file) {
        rawData = resource.file;
      }

      if (resourceEncrypt) {
        try {
          if (resource?.file) {
            rawData = await fileToBase64(resource.file);
          }
          const resKeyPair = await getKeyPair();
          const parsedData = resKeyPair;
          const privateKey = parsedData.privateKey;
          const userPublicKey = parsedData.publicKey;
          const encryptDataResponse = encryptDataGroup({
            data64: rawData,
            publicKeys: data.publicKeys,
            privateKey,
            userPublicKey,
          });
          if (encryptDataResponse) {
            rawData = encryptDataResponse;
          }
        } catch (error) {
          const errorMsg =
            error?.message ||
            i18n.t('question:message.error.upload_encryption', {
              postProcess: 'capitalizeFirstChar',
            });
          failedPublishesIdentifiers.push({
            reason: errorMsg,
            identifier: resource.identifier,
            service: resource.service,
            name: resource?.name || name,
          });
          continue;
        }
      }

      try {
        const dataType = isMultiFileZip
          ? 'zip'
          : resource?.base64 || resource?.data64 || resourceEncrypt
            ? 'base64'
            : 'file';

        const response = await publishData({
          apiVersion: 2,
          category,
          data: rawData,
          description,
          filename: filename,
          identifier: encodeURIComponent(identifier),
          registeredName: encodeURIComponent(resource?.name || name),
          service: service,
          tag1,
          tag2,
          tag3,
          tag4,
          tag5,
          title,
          uploadType: dataType,
          withFee: true,
          appInfo,
        });
        if (response?.signature) {
          publishedResponses.push(response);
        }
        await new Promise((res) => {
          setTimeout(() => {
            res();
          }, 1000);
        });
      } catch (error) {
        const errorMsg =
          error.message ||
          i18n.t('question:message.error.upload', {
            postProcess: 'capitalizeFirstChar',
          });
        failedPublishesIdentifiers.push({
          reason: errorMsg,
          identifier: resource.identifier,
          service: resource.service,
          name: resource?.name || name,
        });
      }
    } catch (error) {
      failedPublishesIdentifiers.push({
        reason:
          error?.message ||
          i18n.t('question:message.error.unknown_error', {
            postProcess: 'capitalizeFirstChar',
          }),
        identifier: resource.identifier,
        service: resource.service,
        name: resource?.name || name,
      });
    }
  }
  if (failedPublishesIdentifiers.length > 0) {
    const obj = {
      message: i18n.t('question:message.error.resources_publish', {
        postProcess: 'capitalizeFirstChar',
      }),
    };
    obj['error'] = {
      unsuccessfulPublishes: failedPublishesIdentifiers,
    };
    return obj;
  }
  if (hasAppFee && checkbox1) {
    sendCoinFunc(
      {
        amount: appFee,
        receiver: appFeeRecipient,
      },
      true
    );
  }
  return publishedResponses;
};

export const voteOnPoll = async (data, isFromExtension) => {
  const requiredFields = ['pollName', 'optionIndex'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field] && data[field] !== 0) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const pollName = data.pollName;
  const optionIndex = data.optionIndex;
  let pollInfo = null;
  try {
    const url = await createEndpoint(`/polls/${encodeURIComponent(pollName)}`);
    const response = await fetch(url);
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(
        response,
        i18n.t('question:message.error.fetch_poll', {
          postProcess: 'capitalizeFirstChar',
        })
      );
      throw new Error(errorMessage);
    }

    pollInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_poll', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  if (!pollInfo || pollInfo.error) {
    const errorMsg =
      (pollInfo && pollInfo.message) ||
      i18n.t('question:message.error.no_poll', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  try {
    const optionName = pollInfo.pollOptions[optionIndex].optionName;
    const resVoteOnPoll = await _voteOnPoll(
      { pollName, optionIndex, optionName },
      isFromExtension
    );
    return resVoteOnPoll;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.poll_vote', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const createPoll = async (data, isFromExtension) => {
  const requiredFields = [
    'pollName',
    'pollDescription',
    'pollOptions',
    'pollOwnerAddress',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const pollName = data.pollName;
  const pollDescription = data.pollDescription;
  const pollOptions = data.pollOptions;
  try {
    const resCreatePoll = await _createPoll(
      {
        pollName,
        pollDescription,
        options: pollOptions,
      },
      isFromExtension
    );
    return resCreatePoll;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.poll_create', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

function isBase64(str) {
  const base64Regex =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

function checkValue(value) {
  if (typeof value === 'string') {
    if (isBase64(value)) {
      return 'string';
    } else {
      return 'string';
    }
  } else if (typeof value === 'object' && value !== null) {
    return 'object';
  } else {
    throw new Error(
      i18n.t('question:message.error.invalid_fullcontent', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
}

export const sendChatMessage = async (data, isFromExtension, appInfo) => {
  const message = data?.message;
  const fullMessageObject = data?.fullMessageObject || data?.fullContent;
  const recipient = data?.destinationAddress || data.recipient;
  const groupId = data.groupId;
  const isRecipient = groupId === undefined;
  const chatReference = data?.chatReference;
  if (groupId === undefined && recipient === undefined) {
    throw new Error(
      i18n.t('question:provide_recipient_group_id', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  let fullMessageObjectType;
  if (fullMessageObject) {
    fullMessageObjectType = checkValue(fullMessageObject);
  }
  const value =
    (await getPermission(`qAPPSendChatMessage-${appInfo?.name}`)) || false;
  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;
  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_chat_message', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: isRecipient
          ? i18n.t('question:to_recipient', {
              recipient: recipient,
              postProcess: 'capitalizeFirstChar',
            })
          : i18n.t('question:to_group', {
              group_id: groupId,
              postProcess: 'capitalizeFirstChar',
            }),
        text3: fullMessageObject
          ? fullMessageObjectType === 'string'
            ? `${fullMessageObject?.slice(0, 25)}${fullMessageObject?.length > 25 ? '...' : ''}`
            : `${JSON.stringify(fullMessageObject)?.slice(0, 25)}${JSON.stringify(fullMessageObject)?.length > 25 ? '...' : ''}`
          : `${message?.slice(0, 25)}${message?.length > 25 ? '...' : ''}`,
        checkbox1: {
          value: false,
          label: i18n.t('question:always_chat_messages', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};
  if (resPermission && accepted) {
    setPermission(`qAPPSendChatMessage-${appInfo?.name}`, checkbox1);
  }
  if (accepted || skip) {
    const tiptapJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        },
      ],
    };
    const messageObject = fullMessageObject
      ? fullMessageObject
      : {
          messageText: tiptapJson,
          images: [],
          repliedTo: '',
          version: 3,
        };

    let stringifyMessageObject = JSON.stringify(messageObject);
    if (fullMessageObjectType === 'string') {
      stringifyMessageObject = messageObject;
    }

    const balance = await getBalanceInfo();
    const hasEnoughBalance = +balance < MIN_REQUIRED_QORTS ? false : true;
    if (!hasEnoughBalance) {
      throw new Error(
        i18n.t('group:message.error.qortals_required', {
          quantity: MIN_REQUIRED_QORTS,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    if (isRecipient && recipient) {
      const url = await createEndpoint(`/addresses/publickey/${recipient}`);
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_recipient_public_key', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      let key;
      let hasPublicKey;
      let res;
      const contentType = response.headers.get('content-type');

      // If the response is JSON, parse it as JSON
      if (contentType && contentType.includes('application/json')) {
        res = await response.json();
      } else {
        // Otherwise, treat it as plain text
        res = await response.text();
      }
      if (res?.error === 102) {
        key = '';
        hasPublicKey = false;
      } else if (res !== false) {
        key = res;
        hasPublicKey = true;
      } else {
        key = '';
        hasPublicKey = false;
      }

      if (!hasPublicKey && isRecipient) {
        throw new Error(
          'Cannot send an encrypted message to this user since they do not have their publickey on chain.'
        );
      }
      let _reference = new Uint8Array(64);
      self.crypto.getRandomValues(_reference);

      let sendTimestamp = Date.now();

      let reference = Base58.encode(_reference);
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };

      let handleDynamicValues = {};
      if (chatReference) {
        handleDynamicValues['chatReference'] = chatReference;
      }

      const tx = await createTransaction(18, keyPair, {
        timestamp: sendTimestamp,
        recipient: recipient,
        recipientPublicKey: key,
        hasChatReference: chatReference ? 1 : 0,
        message: stringifyMessageObject,
        lastReference: reference,
        proofOfWorkNonce: 0,
        isEncrypted: 1,
        isText: 1,
        ...handleDynamicValues,
      });

      const chatBytes = tx.chatBytes;
      const difficulty = 8;
      const { nonce, chatBytesArray } = await performPowTask(
        chatBytes,
        difficulty
      );

      let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
      if (_response?.error) {
        throw new Error(_response?.message);
      }
      return _response;
    } else if (!isRecipient && groupId) {
      let _reference = new Uint8Array(64);
      self.crypto.getRandomValues(_reference);

      let reference = Base58.encode(_reference);
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };

      let handleDynamicValues = {};
      if (chatReference) {
        handleDynamicValues['chatReference'] = chatReference;
      }

      const txBody = {
        timestamp: Date.now(),
        groupID: Number(groupId),
        hasReceipient: 0,
        hasChatReference: chatReference ? 1 : 0,
        message: stringifyMessageObject,
        lastReference: reference,
        proofOfWorkNonce: 0,
        isEncrypted: 0, // Set default to not encrypted for groups
        isText: 1,
        ...handleDynamicValues,
      };

      const tx = await createTransaction(181, keyPair, txBody);

      // if (!hasEnoughBalance) {
      //   throw new Error("Must have at least 4 QORT to send a chat message");
      // }

      const chatBytes = tx.chatBytes;
      const difficulty = 8;
      const { nonce, chatBytesArray } = await performPowTask(
        chatBytes,
        difficulty
      );

      let _response = await signChatFunc(chatBytesArray, nonce, null, keyPair);
      if (_response?.error) {
        throw new Error(_response?.message);
      }
      return _response;
    } else {
      throw new Error(
        i18n.t('question:provide_recipient_group_id', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_send_message', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const joinGroup = async (data, isFromExtension) => {
  const requiredFields = ['groupId'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${data.groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }
  const fee = await getFee('JOIN_GROUP');

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:message.generic.confirm_join_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: `${groupInfo.groupName}`,
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;

  if (accepted) {
    const groupId = data.groupId;

    if (!groupInfo || groupInfo.error) {
      const errorMsg =
        (groupInfo && groupInfo.message) ||
        i18n.t('question:message.error.no_group_found', {
          postProcess: 'capitalizeFirstChar',
        });
      throw new Error(errorMsg);
    }
    try {
      const resJoinGroup = await joinGroupFunc({ groupId });
      return resJoinGroup;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('group:message.error.group_join', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_join', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const saveFile = async (data, sender, isFromExtension, snackMethods) => {
  try {
    if (!data?.filename) throw new Error('Missing filename');
    if (data?.location) {
      const requiredFieldsLocation = ['service', 'name'];
      const missingFieldsLocation: string[] = [];
      requiredFieldsLocation.forEach((field) => {
        if (!data?.location[field]) {
          missingFieldsLocation.push(field);
        }
      });
      if (missingFieldsLocation.length > 0) {
        const missingFieldsString = missingFieldsLocation.join(', ');
        const errorMsg = `Missing fields: ${missingFieldsString}`;
        throw new Error(errorMsg);
      }
      const resPermission = await getUserPermission(
        {
          text1: 'Would you like to download:',
          highlightedText: `${data?.filename}`,
        },
        isFromExtension
      );
      const { accepted } = resPermission;
      if (!accepted) throw new Error('User declined to save file');
      const a = document.createElement('a');
      let locationUrl = `/arbitrary/${data.location.service}/${data.location.name}`;
      if (data.location.identifier) {
        locationUrl = locationUrl + `/${data.location.identifier}`;
      }
      const endpoint = await createEndpoint(
        locationUrl + `?attachment=true&attachmentFilename=${data?.filename}`
      );
      a.href = endpoint;
      a.download = encodeURIComponent(data.filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    }
    const requiredFields = ['filename', 'blob'];
    const missingFields: string[] = [];
    requiredFields.forEach((field) => {
      if (!data[field]) {
        missingFields.push(field);
      }
    });
    if (missingFields.length > 0) {
      const missingFieldsString = missingFields.join(', ');
      const errorMsg = i18n.t('question:message.error.missing_fields', {
        fields: missingFieldsString,
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const filename = data.filename;
    const blob = data.blob;

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:download_file', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${filename}`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const mimeType = blob.type || data.mimeType;
      let backupExention = filename.split('.').pop();
      if (backupExention) {
        backupExention = '.' + backupExention;
      }
      const fileExtension = mimeToExtensionMap[mimeType] || backupExention;
      let fileHandleOptions = {};
      if (!mimeType) {
        throw new Error(
          i18n.t('question:message.error.mime_type', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (!fileExtension) {
        throw new Error(
          i18n.t('question:message.error.file_extension', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (fileExtension && mimeType) {
        fileHandleOptions = {
          accept: {
            [mimeType]: [fileExtension],
          },
        };
      }

      showSaveFilePicker(
        {
          filename,
          mimeType,
          blob,
        },
        snackMethods
      );
      return true;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_save_file', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('core:message.error.initiate_download', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const deployAt = async (data, isFromExtension) => {
  const requiredFields = [
    'name',
    'description',
    'tags',
    'creationBytes',
    'amount',
    'assetId',
    'type',
  ];

  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field] && data[field] !== 0) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  try {
    const resDeployAt = await _deployAt(
      {
        name: data.name,
        description: data.description,
        tags: data.tags,
        creationBytes: data.creationBytes,
        amount: data.amount,
        assetId: data.assetId,
        atType: data.type,
      },
      isFromExtension
    );
    return resDeployAt;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('group:message.error.group_join', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getUserWallet = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();

  if (data?.coin === 'ARRR' && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_wallet_local_node', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );

  const value =
    (await getPermission(
      `qAPPAutoGetUserWallet-${appInfo?.name}-${data.coin}`
    )) || false;
  let skip = false;
  if (value) {
    skip = true;
  }

  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_info', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: true,
          label: i18n.t('question:always_retrieve_wallet', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(
      `qAPPAutoGetUserWallet-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }

  if (accepted || skip) {
    let coin = data.coin;
    let userWallet = {};
    let arrrAddress = '';
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const arrrSeed58 = parsedData.arrrSeed58;
    if (coin === 'ARRR') {
      const bodyToString = arrrSeed58;
      const url = await createEndpoint(`/crosschain/arrr/walletaddress`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bodyToString,
      });
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }
      arrrAddress = res;
    }
    switch (coin) {
      case 'QORT':
        userWallet['address'] = address;
        userWallet['publickey'] = parsedData.publicKey;
        break;
      case 'BTC':
        userWallet['address'] = parsedData.btcAddress;
        userWallet['publickey'] = parsedData.btcPublicKey;
        break;
      case 'LTC':
        userWallet['address'] = parsedData.ltcAddress;
        userWallet['publickey'] = parsedData.ltcPublicKey;
        break;
      case 'DOGE':
        userWallet['address'] = parsedData.dogeAddress;
        userWallet['publickey'] = parsedData.dogePublicKey;
        break;
      case 'DGB':
        userWallet['address'] = parsedData.dgbAddress;
        userWallet['publickey'] = parsedData.dgbPublicKey;
        break;
      case 'RVN':
        userWallet['address'] = parsedData.rvnAddress;
        userWallet['publickey'] = parsedData.rvnPublicKey;
        break;
      case 'ARRR':
        await checkArrrSyncStatus(parsedData.arrrSeed58);
        userWallet['address'] = arrrAddress;
        break;
      default:
        break;
    }
    return userWallet;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getWalletBalance = async (
  data,
  bypassPermission?: boolean,
  isFromExtension?: boolean,
  appInfo?: any
) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const isGateway = await isRunningGateway();

  if (data?.coin === 'ARRR' && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_balance_local_node', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );

  const value =
    (await getPermission(
      `qAPPAutoWalletBalance-${appInfo?.name}-${data.coin}`
    )) || false;
  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;

  if (!bypassPermission && !skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.fetch_balance', {
          coin: data.coin, // TODO highlight coin in the modal
          postProcess: 'capitalizeFirstChar',
        }),
        checkbox1: {
          value: true,
          label: i18n.t('question:always_retrieve_balance', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};
  if (resPermission) {
    setPermission(
      `qAPPAutoWalletBalance-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }
  if (accepted || bypassPermission || skip) {
    let coin = data.coin;
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    if (coin === 'QORT') {
      let qortAddress = address;
      try {
        const url = await createEndpoint(`/addresses/balance/${qortAddress}`);
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        let res;
        try {
          res = await response.clone().json();
        } catch (e) {
          res = await response.text();
        }
        return res;
      } catch (error) {
        throw new Error(
          error?.message ||
            i18n.t('question:message.error.fetch_wallet', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }
    } else {
      let _url = ``;
      let _body = null;
      switch (coin) {
        case 'BTC':
          _url = await createEndpoint(`/crosschain/btc/walletbalance`);

          _body = parsedData.btcPublicKey;
          break;
        case 'LTC':
          _url = await createEndpoint(`/crosschain/ltc/walletbalance`);
          _body = parsedData.ltcPublicKey;
          break;
        case 'DOGE':
          _url = await createEndpoint(`/crosschain/doge/walletbalance`);
          _body = parsedData.dogePublicKey;
          break;
        case 'DGB':
          _url = await createEndpoint(`/crosschain/dgb/walletbalance`);
          _body = parsedData.dgbPublicKey;
          break;
        case 'RVN':
          _url = await createEndpoint(`/crosschain/rvn/walletbalance`);
          _body = parsedData.rvnPublicKey;
          break;
        case 'ARRR':
          await checkArrrSyncStatus(parsedData.arrrSeed58);
          _url = await createEndpoint(`/crosschain/arrr/walletbalance`);
          _body = parsedData.arrrSeed58;
          break;
        default:
          break;
      }
      try {
        const response = await fetch(_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: _body,
        });
        let res;
        try {
          res = await response.clone().json();
        } catch (e) {
          res = await response.text();
        }
        if (res?.error && res?.message) {
          throw new Error(res.message);
        }
        if (isNaN(Number(res))) {
          throw new Error(
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        } else {
          return (Number(res) / 1e8).toFixed(8);
        }
      } catch (error) {
        throw new Error(
          error?.message ||
            i18n.t('question:message.error.fetch_balance', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const getPirateWallet = async (arrrSeed58) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.error.gateway_retrieve_balance', {
        token: 'PIRATECHAIN',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const bodyToString = arrrSeed58;
  await checkArrrSyncStatus(bodyToString);
  const url = await createEndpoint(`/crosschain/arrr/walletaddress`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });
  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }
  if (res?.error && res?.message) {
    throw new Error(res.message);
  }
  return res;
};

export const getUserWalletFunc = async (coin) => {
  let userWallet = {};
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  switch (coin) {
    case 'QORT':
      userWallet['address'] = address;
      userWallet['publickey'] = parsedData.publicKey;
      break;
    case 'BTC':
    case 'BITCOIN':
      userWallet['address'] = parsedData.btcAddress;
      userWallet['publickey'] = parsedData.btcPublicKey;
      break;
    case 'LTC':
    case 'LITECOIN':
      userWallet['address'] = parsedData.ltcAddress;
      userWallet['publickey'] = parsedData.ltcPublicKey;
      break;
    case 'DOGE':
    case 'DOGECOIN':
      userWallet['address'] = parsedData.dogeAddress;
      userWallet['publickey'] = parsedData.dogePublicKey;
      break;
    case 'DGB':
    case 'DIGIBYTE':
      userWallet['address'] = parsedData.dgbAddress;
      userWallet['publickey'] = parsedData.dgbPublicKey;
      break;
    case 'RVN':
    case 'RAVENCOIN':
      userWallet['address'] = parsedData.rvnAddress;
      userWallet['publickey'] = parsedData.rvnPublicKey;
      break;
    case 'ARRR':
    case 'PIRATECHAIN':
      const arrrAddress = await getPirateWallet(parsedData.arrrSeed58);
      userWallet['address'] = arrrAddress;
      break;
    default:
      break;
  }
  return userWallet;
};

export const getUserWalletInfo = async (data, isFromExtension, appInfo) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (data?.coin === 'ARRR') {
    throw new Error(
      i18n.t('question:message.error.token_not_supported', {
        token: 'ARRR',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const value =
    (await getPermission(`getUserWalletInfo-${appInfo?.name}-${data.coin}`)) ||
    false;
  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_info', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: true,
          label: i18n.t('question:always_retrieve_wallet', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(`getUserWalletInfo-${appInfo?.name}-${data.coin}`, checkbox1);
  }

  if (accepted || skip) {
    let coin = data.coin;
    let walletKeys = await getUserWalletFunc(coin);

    const _url = await createEndpoint(
      `/crosschain/` + data.coin.toLowerCase() + `/addressinfos`
    );
    let _body = { xpub58: walletKeys['publickey'] };
    try {
      const response = await fetch(_url, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(_body),
      });
      if (!response?.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_wallet_info', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }

      return res;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('question:message.error.fetch_wallet', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getUserWalletTransactions = async (
  data,
  isFromExtension,
  appInfo
) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const value =
    (await getPermission(
      `getUserWalletTransactions-${appInfo?.name}-${data.coin}`
    )) || false;
  let skip = false;
  if (value) {
    skip = true;
  }
  let resPermission;

  if (!skip) {
    resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.get_wallet_transactions', {
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `coin: ${data.coin}`,
        checkbox1: {
          value: true,
          label: i18n.t('question:always_retrieve_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          }),
        },
      },
      isFromExtension
    );
  }
  const { accepted = false, checkbox1 = false } = resPermission || {};

  if (resPermission) {
    setPermission(
      `getUserWalletTransactions-${appInfo?.name}-${data.coin}`,
      checkbox1
    );
  }

  if (accepted || skip) {
    const coin = data.coin;
    const walletKeys = await getUserWalletFunc(coin);
    let publicKey;
    if (data?.coin === 'ARRR') {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      publicKey = parsedData.arrrSeed58;
    } else {
      publicKey = walletKeys['publickey'];
    }

    const _url = await createEndpoint(
      `/crosschain/` + data.coin.toLowerCase() + `/wallettransactions`
    );
    const _body = publicKey;
    try {
      const response = await fetch(_url, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        body: _body,
      });
      if (!response?.ok)
        throw new Error(
          i18n.t('question:message.error.fetch_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      if (res?.error && res?.message) {
        throw new Error(res.message);
      }

      return res;
    } catch (error) {
      throw new Error(
        error?.message ||
          i18n.t('question:message.error.fetch_wallet_transactions', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    }
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const getCrossChainServerInfo = async (data) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const _url = `/crosschain/` + data.coin.toLowerCase() + `/serverinfos`;
  try {
    const url = await createEndpoint(_url);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res.servers;
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.server_info', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getTxActivitySummary = async (data) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const coin = data.coin;
  const url = `/crosschain/txactivity?foreignBlockchain=${coin}`; // No apiKey here

  try {
    const endpoint = await createEndpoint(url);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.transaction_activity_summary', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getForeignFee = async (data) => {
  const requiredFields = ['coin', 'type'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, type } = data;
  const url = `/crosschain/${coin.toLowerCase()}/${type}`;

  try {
    const endpoint = await createEndpoint(url);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_generic', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    if (res?.error && res?.message) {
      throw new Error(res.message);
    }
    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.get_foreign_fee', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

function calculateRateFromFee(totalFee, sizeInBytes) {
  const fee = (totalFee / sizeInBytes) * 1000;
  return fee.toFixed(0);
}

export const updateForeignFee = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin', 'type', 'value'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, type, value } = data;

  const text3 =
    type === 'feerequired'
      ? i18n.t('question:sats', {
          amount: value,
          postProcess: 'capitalizeFirstChar',
        })
      : i18n.t('question:sats_per_kb', {
          amount: value,
          postProcess: 'capitalizeFirstChar',
        });
  const text4 =
    type === 'feerequired'
      ? i18n.t('question:message.generic.calculate_fee', {
          amount: value,
          rate: calculateRateFromFee(value, 300),
          postProcess: 'capitalizeFirstChar',
        })
      : '';
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.update_foreign_fee', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: `type: ${type === 'feerequired' ? 'unlocking' : 'locking'}`,
      text3: i18n.t('question:value', {
        value: text3,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:coin', {
        coin: coin,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const url = `/crosschain/${coin.toLowerCase()}/update${type}`;
  const valueStringified = JSON.stringify(+value);

  const endpoint = await createEndpoint(url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: valueStringified,
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.update_foreign_fee', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }
  if (res?.error && res?.message) {
    throw new Error(res.message);
  }
  return res; // Return full response here
};

export const getServerConnectionHistory = async (data) => {
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const coin = data.coin.toLowerCase();
  const url = `/crosschain/${coin.toLowerCase()}/serverconnectionhistory`;

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_connection_history', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return full response here
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.fetch_connection_history', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const setCurrentForeignServer = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.set_current_server', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:server_type', {
        type: type,
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:server_host', {
        host: host,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:coin', {
        coin: coin,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coin.toLowerCase()}/setcurrentserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_current_set', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const addForeignServer = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.server_add', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:server_type', {
        type: type,
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:server_host', {
        host: host,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:coin', {
        coin: coin,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coin.toLowerCase()}/addserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_current_add', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const removeForeignServer = async (data, isFromExtension) => {
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const requiredFields = ['coin'];
  const missingFields: string[] = [];

  // Validate required fields
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const { coin, host, port, type } = data;

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.server_remove', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:server_type', {
        type: type,
        postProcess: 'capitalizeFirstChar',
      }),
      text3: i18n.t('question:server_host', {
        host: host,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:coin', {
        coin: coin,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const body = {
    hostName: host,
    port: port,
    connectionType: type,
  };

  const url = `/crosschain/${coin.toLowerCase()}/removeserver`;

  const endpoint = await createEndpoint(url); // Assuming createEndpoint is available
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.server_remove', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  let res;
  try {
    res = await response.clone().json();
  } catch (e) {
    res = await response.text();
  }

  if (res?.error && res?.message) {
    throw new Error(res.message);
  }

  return res; // Return the full response
};

export const getDaySummary = async () => {
  const url = `/admin/summary`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.retrieve_summary', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.retrieve_summary', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getNodeInfo = async () => {
  const url = `/admin/info`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.node_info', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.node_info', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getNodeStatus = async () => {
  const url = `/admin/status`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.node_status', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    if (res?.error && res?.message) {
      throw new Error(res.message);
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.node_status', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const getArrrSyncStatus = async () => {
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const arrrSeed = parsedData.arrrSeed58;
  const url = `/crosschain/arrr/syncstatus`; // Simplified endpoint URL

  try {
    const endpoint = await createEndpoint(url); // Assuming createEndpoint is available for constructing the full URL
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: '*/*',
      },
      body: arrrSeed,
    });

    let res;

    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }

    return res; // Return the full response
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.retrieve_sync_status', {
          token: 'ARRR',
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const sendCoin = async (data, isFromExtension) => {
  const requiredFields = ['coin', 'amount'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  if (!data?.destinationAddress && !data?.recipient) {
    throw new Error(
      i18n.t('question:message.error.missing_fields', {
        fields: 'recipient',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  let checkCoin = data.coin;
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const isGateway = await isRunningGateway();

  if (checkCoin !== 'QORT' && isGateway)
    throw new Error(
      i18n.t('question:message.error.gateway_non_qort_local_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  if (checkCoin === 'QORT') {
    // Params: data.coin, data.recipient, data.amount, data.fee
    // TODO: prompt user to send. If they confirm, call `POST /crosschain/:coin/send`, or for QORT, broadcast a PAYMENT transaction
    // then set the response string from the core to the `response` variable (defined above)
    // If they decline, send back JSON that includes an `error` key, such as `{"error": "User declined request"}`
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;

    const url = await createEndpoint(`/addresses/balance/${address}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_balance', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    let walletBalance;
    try {
      walletBalance = await response.clone().json();
    } catch (e) {
      walletBalance = await response.text();
    }
    if (isNaN(Number(walletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'QORT',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const transformDecimals = (Number(walletBalance) * QORT_DECIMALS).toFixed(
      0
    );
    const walletBalanceDecimals = Number(transformDecimals);
    const amountDecimals = Number(amount) * QORT_DECIMALS;
    const fee: number = await sendQortFee();
    if (amountDecimals + fee * QORT_DECIMALS > walletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    if (amount <= 0) {
      const errorMsg = i18n.t('core:message.error.invalid_amount', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    if (recipient.length === 0) {
      const errorMsg = i18n.t('question:message.error.empty_receiver', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${amount} ${checkCoin}`,
        fee: fee,
        confirmCheckbox: true,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const makePayment = await sendCoinFunc(
        { amount, password: null, receiver: recipient },
        true
      );
      return makePayment.res?.data;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'BTC') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.btcPrivateKey;
    const feePerByte = data.fee ? data.fee : btcFeePerByte;

    const btcWalletBalance = await getWalletBalance({ coin: checkCoin }, true);

    if (isNaN(Number(btcWalletBalance))) {
      throw new Error(
        i18n.t('question:message.error.fetch_balance_token', {
          token: 'BTC',
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    const btcWalletBalanceDecimals = Number(btcWalletBalance);
    const btcAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00050000
    if (btcAmountDecimals + fee > btcWalletBalanceDecimals) {
      throw new Error(
        i18n.t('question:message.error.insufficient_funds', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} BTC`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        bitcoinAmount: amount,
        feePerByte: feePerByte,
      };
      const url = await createEndpoint(`/crosschain/btc/send`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'LTC') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.ltcPrivateKey;
    const feePerByte = data.fee ? data.fee : ltcFeePerByte;
    const ltcWalletBalance = await getWalletBalance({ coin: checkCoin }, true);

    if (isNaN(Number(ltcWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'LTC',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const ltcWalletBalanceDecimals = Number(ltcWalletBalance);
    const ltcAmountDecimals = Number(amount);
    const fee = feePerByte * 1000; // default 0.00030000
    if (ltcAmountDecimals + fee > ltcWalletBalanceDecimals) {
      throw new Error(
        i18n.t('question:message.error.insufficient_funds', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} LTC`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const url = await createEndpoint(`/crosschain/ltc/send`);
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        litecoinAmount: amount,
        feePerByte: feePerByte,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'DOGE') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.dogePrivateKey;
    const feePerByte = data.fee ? data.fee : dogeFeePerByte;
    const dogeWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(dogeWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'DOGE',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const dogeWalletBalanceDecimals = Number(dogeWalletBalance);
    const dogeAmountDecimals = Number(amount);
    const fee = feePerByte * 5000; // default 0.05000000
    if (dogeAmountDecimals + fee > dogeWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:to_recipient', {
          recipient: recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} DOGE`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        dogecoinAmount: amount,
        feePerByte: feePerByte,
      };
      const url = await createEndpoint(`/crosschain/doge/send`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'DGB') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.dgbPrivateKey;
    const feePerByte = data.fee ? data.fee : dgbFeePerByte;
    const dgbWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(dgbWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'DGB',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const dgbWalletBalanceDecimals = Number(dgbWalletBalance);
    const dgbAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00005000
    if (dgbAmountDecimals + fee > dgbWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: `To: ${recipient}`,
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} DGB`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        digibyteAmount: amount,
        feePerByte: feePerByte,
      };
      const url = await createEndpoint(`/crosschain/dgb/send`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'RVN') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const xprv58 = parsedData.rvnPrivateKey;
    const feePerByte = data.fee ? data.fee : rvnFeePerByte;
    const rvnWalletBalance = await getWalletBalance({ coin: checkCoin }, true);
    if (isNaN(Number(rvnWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'RVN',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const rvnWalletBalanceDecimals = Number(rvnWalletBalance);
    const rvnAmountDecimals = Number(amount);
    const fee = feePerByte * 500; // default 0.00562500
    if (rvnAmountDecimals + fee > rvnWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: `To: ${recipient}`,
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} RVN`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        xprv58: xprv58,
        receivingAddress: recipient,
        ravencoinAmount: amount,
        feePerByte: feePerByte,
      };
      const url = await createEndpoint(`/crosschain/rvn/send`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } else if (checkCoin === 'ARRR') {
    const amount = Number(data.amount);
    const recipient = data?.recipient || data.destinationAddress;
    const memo = data?.memo;
    const arrrWalletBalance = await getWalletBalance({ coin: checkCoin }, true);

    if (isNaN(Number(arrrWalletBalance))) {
      const errorMsg = i18n.t('question:message.error.fetch_balance_token', {
        token: 'ARR',
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }
    const arrrWalletBalanceDecimals = Number(arrrWalletBalance);
    const arrrAmountDecimals = Number(amount);
    const fee = 0.0001;
    if (arrrAmountDecimals + fee > arrrWalletBalanceDecimals) {
      const errorMsg = i18n.t('question:message.error.insufficient_funds', {
        postProcess: 'capitalizeFirstChar',
      });
      throw new Error(errorMsg);
    }

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.send_coins', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: `To: ${recipient}`,
        highlightedText: `${amount} ${checkCoin}`,
        foreignFee: `${fee} ARRR`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;

    if (accepted) {
      const opts = {
        entropy58: parsedData.arrrSeed58,
        receivingAddress: recipient,
        arrrAmount: amount,
        memo: memo,
      };
      const url = await createEndpoint(`/crosschain/arrr/send`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts),
      });
      if (!response.ok)
        throw new Error(
          i18n.t('question:message.error.send', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      let res;
      try {
        res = await response.clone().json();
      } catch (e) {
        res = await response.text();
      }
      return res;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  }
};

function calculateFeeFromRate(feePerKb, sizeInBytes) {
  return (feePerKb / 1000) * sizeInBytes;
}

const getBuyingFees = async (foreignBlockchain) => {
  const ticker = sellerForeignFee[foreignBlockchain].ticker;
  if (!ticker) throw new Error('invalid foreign blockchain');
  const unlockFee = await getForeignFee({
    coin: ticker,
    type: 'feerequired',
  });
  const lockFee = await getForeignFee({
    coin: ticker,
    type: 'feekb',
  });
  return {
    ticker: ticker,
    lock: {
      sats: lockFee,
      fee: lockFee / QORT_DECIMALS,
    },
    unlock: {
      sats: unlockFee,
      fee: unlockFee / QORT_DECIMALS,
      feePerKb: +calculateRateFromFee(+unlockFee, 300) / QORT_DECIMALS,
    },
  };
};

export const createBuyOrder = async (data, isFromExtension) => {
  const requiredFields = ['crosschainAtInfo', 'foreignBlockchain'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();
  const foreignBlockchain = data.foreignBlockchain;
  const atAddresses = data.crosschainAtInfo?.map(
    (order) => order.qortalAtAddress
  );

  const atPromises = atAddresses.map((atAddress) =>
    requestQueueGetAtAddresses.enqueue(async () => {
      const url = await createEndpoint(`/crosschain/trade/${atAddress}`);
      const resAddress = await fetch(url);
      const resData = await resAddress.json();
      if (foreignBlockchain !== resData?.foreignBlockchain) {
        throw new Error(
          i18n.t('core:message.error.same_foreign_blockchain', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      return resData;
    })
  );

  const crosschainAtInfo = await Promise.all(atPromises);

  try {
    const buyingFees = await getBuyingFees(foreignBlockchain);
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.buy_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.buy_order_quantity', {
          count: atAddresses?.length,
          postProcess: 'capitalizeFirstChar',
        }),
        text3: i18n.t('question:permission.buy_order_ticker', {
          qort_amount: crosschainAtInfo?.reduce((latest, cur) => {
            return latest + +cur?.qortAmount;
          }, 0),
          foreign_amount: roundUpToDecimals(
            crosschainAtInfo?.reduce((latest, cur) => {
              return latest + +cur?.expectedForeignAmount;
            }, 0)
          ),
          ticker: buyingFees.ticker,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: i18n.t('auth:node.using_public_gateway', {
          gateway: isGateway,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: '',
        html: `
  <div style="max-height: 30vh; overflow-y: auto; font-family: sans-serif;">
    <style>
      .fee-container {
        background-color: var(--background-default);
        color: var(--text-primary);
        border: 1px solid #444;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
      }
      .fee-label {
        font-weight: bold;
        color: var(--text-primary);
        margin-bottom: 4px;
      }
      .fee-description {
        font-size: 14px;
        color: var(--text-primary);
        margin-bottom: 16px;
      }
    </style>

    <div class="fee-container">
      <div class="fee-label">${i18n.t('question:total_unlocking_fee', {
        postProcess: 'capitalizeFirstChar',
      })}</div>
      <div>${(+buyingFees?.unlock?.fee * atAddresses?.length)?.toFixed(8)} ${buyingFees.ticker}</div>
     <div class="fee-description">
     ${i18n.t('question:permission.buy_order_fee_estimation', {
       count: atAddresses?.length,
       fee: buyingFees?.unlock?.feePerKb?.toFixed(8),
       ticker: buyingFees.ticker,
       postProcess: 'capitalizeFirstChar',
     })}
     </div>
     <div class="fee-label">${i18n.t('question:total_locking_fee', {
       postProcess: 'capitalizeFirstChar',
     })}</div>
     <div>${i18n.t('question:permission.buy_order_per_kb', {
       fee: +buyingFees?.lock.fee.toFixed(8),
       ticker: buyingFees.ticker,
       postProcess: 'capitalizeFirstChar',
     })}
     </div>
    </div>
  </div>
`,
      },
      isFromExtension
    );
    const { accepted } = resPermission;
    if (accepted) {
      const resBuyOrder = await createBuyOrderTx({
        crosschainAtInfo,
        isGateway,
        foreignBlockchain,
      });
      return resBuyOrder;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.buy_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

const cancelTradeOfferTradeBot = async (body, keyPair) => {
  const txn = new DeleteTradeOffer().createTransaction(body);
  const url = await createEndpoint(`/crosschain/tradeoffer`);
  const bodyToString = JSON.stringify(txn);

  const deleteTradeBotResponse = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });

  if (!deleteTradeBotResponse.ok) {
    throw new Error(
      i18n.t('question:message.error.update_tradebot', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  const unsignedTxn = await deleteTradeBotResponse.text();
  const signedTxnBytes = await signTradeBotTransaction(unsignedTxn, keyPair);
  const signedBytes = Base58.encode(signedTxnBytes);

  let res;
  try {
    res = await processTransactionVersion2(signedBytes);
  } catch (error) {
    return {
      error: i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: {
        atAddress: body.atAddress,
        creatorAddress: body.creatorAddress,
      },
    };
  }
  if (res?.error) {
    return {
      error: i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: {
        atAddress: body.atAddress,
        creatorAddress: body.creatorAddress,
      },
    };
  }
  if (res?.signature) {
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.error.cancel_sell_order', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};
const findFailedTradebot = async (createBotCreationTimestamp, body) => {
  //wait 5 secs
  const wallet = await getSaveWallet();
  const address = wallet.address0;
  await new Promise((res) => {
    setTimeout(() => {
      res(null);
    }, 5000);
  });
  const url = await createEndpoint(
    `/crosschain/tradebot?foreignBlockchain=LITECOIN`
  );

  const tradeBotsReponse = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const data = await tradeBotsReponse.json();
  const latestItem2 = data
    .filter((item) => item.creatorAddress === address)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const latestItem = data
    .filter(
      (item) =>
        item.creatorAddress === address &&
        +item.foreignAmount === +body.foreignAmount
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (
    latestItem &&
    createBotCreationTimestamp - latestItem.timestamp <= 5000 &&
    createBotCreationTimestamp > latestItem.timestamp // Ensure latestItem's timestamp is before createBotCreationTimestamp
  ) {
    return latestItem;
  } else {
    return null;
  }
};
const tradeBotCreateRequest = async (body, keyPair) => {
  const txn = new TradeBotCreateRequest().createTransaction(body);
  const url = await createEndpoint(`/crosschain/tradebot/create`);
  const bodyToString = JSON.stringify(txn);

  const unsignedTxnResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: bodyToString,
  });
  if (!unsignedTxnResponse.ok)
    throw new Error(
      i18n.t('question:message.error.create_tradebot', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const createBotCreationTimestamp = Date.now();
  const unsignedTxn = await unsignedTxnResponse.text();
  const signedTxnBytes = await signTradeBotTransaction(unsignedTxn, keyPair);
  const signedBytes = Base58.encode(signedTxnBytes);

  let res;
  try {
    res = await processTransactionVersion2(signedBytes);
  } catch (error) {
    const findFailedTradeBot = await findFailedTradebot(
      createBotCreationTimestamp,
      body
    );
    return {
      error: i18n.t('question:message.error.create_sell_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      failedTradeBot: findFailedTradeBot,
    };
  }

  if (res?.signature) {
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.error.create_sell_order', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const createSellOrder = async (data, isFromExtension) => {
  const requiredFields = ['qortAmount', 'foreignBlockchain', 'foreignAmount'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const parsedForeignAmount = Number(data.foreignAmount)?.toFixed(8);

  const receivingAddress = await getUserWalletFunc(data.foreignBlockchain);
  try {
    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.sell_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.order_detail', {
          qort_amount: data.qortAmount,
          foreign_amount: parsedForeignAmount,
          ticker: data.foreignBlockchain,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: '0.02',
      },
      isFromExtension
    );
    const { accepted } = resPermission;
    if (accepted) {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const userPublicKey = parsedData.publicKey;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };
      const response = await tradeBotCreateRequest(
        {
          creatorPublicKey: userPublicKey,
          qortAmount: parseFloat(data.qortAmount),
          fundingQortAmount: parseFloat(data.qortAmount) + 0.01,
          foreignBlockchain: data.foreignBlockchain,
          foreignAmount: parseFloat(parsedForeignAmount),
          tradeTimeout: 120,
          receivingAddress: receivingAddress.address,
        },
        keyPair
      );

      return response;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.submit_sell_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const cancelSellOrder = async (data, isFromExtension) => {
  const requiredFields = ['atAddress'];
  const missingFields: string[] = [];

  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const url = await createEndpoint(`/crosschain/trade/${data.atAddress}`);
  const resAddress = await fetch(url);
  const resData = await resAddress.json();

  if (!resData?.qortalAtAddress)
    throw new Error(
      i18n.t('question:message.error.at_info', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  try {
    const fee = await getFee('MESSAGE');

    const resPermission = await getUserPermission(
      {
        text1: i18n.t('question:permission.cancel_sell_order', {
          postProcess: 'capitalizeFirstChar',
        }),
        text2: i18n.t('question:permission.order_detail', {
          qort_amount: resData.qortAmount,
          foreign_amount: resData.expectedForeignAmount,
          ticker: resData.foreignBlockchain,
          postProcess: 'capitalizeFirstChar',
        }),
        fee: fee.fee,
      },
      isFromExtension
    );
    const { accepted } = resPermission;
    if (accepted) {
      const resKeyPair = await getKeyPair();
      const parsedData = resKeyPair;
      const userPublicKey = parsedData.publicKey;
      const uint8PrivateKey = Base58.decode(parsedData.privateKey);
      const uint8PublicKey = Base58.decode(parsedData.publicKey);
      const keyPair = {
        privateKey: uint8PrivateKey,
        publicKey: uint8PublicKey,
      };
      const response = await cancelTradeOfferTradeBot(
        {
          creatorPublicKey: userPublicKey,
          atAddress: data.atAddress,
        },
        keyPair
      );

      return response;
    } else {
      throw new Error(
        i18n.t('question:message.generic.user_declined_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  } catch (error) {
    throw new Error(
      error?.message ||
        i18n.t('question:message.error.submit_sell_order', {
          postProcess: 'capitalizeFirstChar',
        })
    );
  }
};

export const openNewTab = async (data, isFromExtension) => {
  const requiredFields = ['qortalLink'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const res = extractComponents(data.qortalLink);
  if (res) {
    const { service, name, identifier, path } = res;
    if (!service && !name)
      throw new Error(
        i18n.t('auth:message.error.invalid_qortal_link', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    executeEvent('addTab', { data: { service, name, identifier, path } });
    executeEvent('open-apps-mode', {});
    return true;
  } else {
    throw new Error(
      i18n.t('auth:message.error.invalid_qortal_link', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const adminAction = async (data, isFromExtension) => {
  const requiredFields = ['type'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  // For actions that require a value, check for 'value' field
  const actionsRequiringValue = [
    'addmintingaccount',
    'addpeer',
    'forcesync',
    'getmintingaccounts',
    'removemintingaccount',
    'removepeer',
  ];
  if (actionsRequiringValue.includes(data.type.toLowerCase()) && !data.value) {
    missingFields.push('value');
  }
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const isGateway = await isRunningGateway();
  if (isGateway) {
    throw new Error(
      i18n.t('question:message.generic.no_action_public_node', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  let apiEndpoint = '';
  let method = 'GET'; // Default method
  let includeValueInBody = false;
  switch (data.type.toLowerCase()) {
    case 'stop':
      apiEndpoint = await createEndpoint('/admin/stop');
      break;
    case 'restart':
      apiEndpoint = await createEndpoint('/admin/restart');
      break;
    case 'bootstrap':
      apiEndpoint = await createEndpoint('/admin/bootstrap');
      break;
    case 'addmintingaccount':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'getmintingaccounts':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      break;
    case 'removemintingaccount':
      apiEndpoint = await createEndpoint('/admin/mintingaccounts');
      method = 'DELETE';
      includeValueInBody = true;
      break;
    case 'forcesync':
      apiEndpoint = await createEndpoint('/admin/forcesync');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'addpeer':
      apiEndpoint = await createEndpoint('/peers');
      method = 'POST';
      includeValueInBody = true;
      break;
    case 'removepeer':
      apiEndpoint = await createEndpoint('/peers');
      method = 'DELETE';
      includeValueInBody = true;
      break;
    default:
      throw new Error(
        i18n.t('question:message.error.unknown_admin_action_type', {
          type: data.type,
          postProcess: 'capitalizeFirstChar',
        })
      );
  }
  // Prepare the permission prompt text
  let permissionText = i18n.t('question:permission.perform_admin_action', {
    type: data.type,
    postProcess: 'capitalizeFirstChar',
  });

  if (data.value) {
    permissionText +=
      ' ' +
      i18n.t('question:permission.perform_admin_action_with_value', {
        value: data.value,
        postProcess: 'capitalizeFirstChar',
      });
  }

  const resPermission = await getUserPermission(
    {
      text1: permissionText,
    },
    isFromExtension
  );

  const { accepted } = resPermission;

  if (accepted) {
    // Set up options for the API call
    const options: RequestInit = {
      method: method,
      headers: {},
    };
    if (includeValueInBody) {
      options.headers['Content-Type'] = 'text/plain';
      options.body = data.value;
    }
    const response = await fetch(apiEndpoint, options);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.perform_request', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    let res;
    try {
      res = await response.clone().json();
    } catch (e) {
      res = await response.text();
    }
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const signTransaction = async (data, isFromExtension) => {
  const requiredFields = ['unsignedBytes'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const shouldProcess = data?.process || false;
  const _url = await createEndpoint(
    '/transactions/decode?ignoreValidityChecks=false'
  );

  const _body = data.unsignedBytes;
  const response = await fetch(_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: _body,
  });

  if (!response.ok)
    throw new Error(
      i18n.t('question:message.error.decode_transaction', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const decodedData = await response.json();
  const resPermission = await getUserPermission(
    {
      text1: shouldProcess
        ? i18n.t('question:permission.sign_process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
        : i18n.t('question:permission.sign_transaction', {
            postProcess: 'capitalizeFirstChar',
          }),
      highlightedText: i18n.t(
        'question:message.generic.read_transaction_carefully',
        { postProcess: 'capitalizeFirstChar' }
      ),
      text2: `Tx type: ${decodedData.type}`,
      json: decodedData,
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (accepted) {
    let urlConverted = await createEndpoint('/transactions/convert');

    const responseConverted = await fetch(urlConverted, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: data.unsignedBytes,
    });
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };
    const convertedBytes = await responseConverted.text();
    const txBytes = Base58.decode(data.unsignedBytes);
    const _arbitraryBytesBuffer = Object.keys(txBytes).map(function (key) {
      return txBytes[key];
    });
    const arbitraryBytesBuffer = new Uint8Array(_arbitraryBytesBuffer);
    const txByteSigned = Base58.decode(convertedBytes);
    const _bytesForSigningBuffer = Object.keys(txByteSigned).map(
      function (key) {
        return txByteSigned[key];
      }
    );
    const bytesForSigningBuffer = new Uint8Array(_bytesForSigningBuffer);
    const signature = nacl.sign.detached(
      bytesForSigningBuffer,
      keyPair.privateKey
    );
    const signedBytes = utils.appendBuffer(arbitraryBytesBuffer, signature);
    const signedBytesToBase58 = Base58.encode(signedBytes);
    if (!shouldProcess) {
      return signedBytesToBase58;
    }
    const res = await processTransactionVersion2(signedBytesToBase58);
    if (!res?.signature)
      throw new Error(
        res?.message ||
          i18n.t('question:message.error.process_transaction', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    return res;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

const missingFieldsFunc = (data, requiredFields) => {
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
};

const encode = (value) => encodeURIComponent(value.trim()); // Helper to encode values
const buildQueryParams = (data) => {
  const allowedParams = [
    'name',
    'service',
    'identifier',
    'mimeType',
    'fileName',
    'encryptionType',
    'key',
  ];
  return Object.entries(data)
    .map(([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === false ||
        !allowedParams.includes(key)
      )
        return null; // Skip null, undefined, or false
      if (typeof value === 'boolean') return `${key}=${value}`; // Handle boolean values
      return `${key}=${encode(value)}`; // Encode other values
    })
    .filter(Boolean) // Remove null values
    .join('&'); // Join with `&`
};
export const createAndCopyEmbedLink = async (data, isFromExtension) => {
  const requiredFields = ['type'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  switch (data.type) {
    case 'POLL': {
      missingFieldsFunc(data, ['type', 'name']);

      const queryParams = [
        `name=${encode(data.name)}`,
        data.ref ? `ref=${encode(data.ref)}` : null, // Add only if ref exists
      ]
        .filter(Boolean) // Remove null values
        .join('&'); // Join with `&`
      const link = `qortal://use-embed/POLL?${queryParams}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch (error) {
        throw new Error(
          i18n.t('question:message.error.copy_clipboard', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      return link;
    }
    case 'IMAGE':
    case 'ATTACHMENT': {
      missingFieldsFunc(data, ['type', 'name', 'service', 'identifier']);
      if (data?.encryptionType === 'private' && !data?.key) {
        throw new Error(
          i18n.t('question:message.generic.provide_key_shared_link', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const queryParams = buildQueryParams(data);

      const link = `qortal://use-embed/${data.type}?${queryParams}`;

      try {
        await navigator.clipboard.writeText(link);
      } catch (error) {
        throw new Error(
          i18n.t('question:message.error.copy_clipboard', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      return link;
    }

    default:
      throw new Error(
        i18n.t('question:message.error.invalid_type', {
          postProcess: 'capitalizeFirstChar',
        })
      );
  }
};

export const registerNameRequest = async (data, isFromExtension) => {
  const requiredFields = ['name'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const fee = await getFee('REGISTER_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.register_name', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: data.name,
      text2: data?.description,
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const name = data.name;
    const description = data?.description || '';
    const response = await registerName({ name, description });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const updateNameRequest = async (data, isFromExtension) => {
  const requiredFields = ['newName', 'oldName'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const oldName = data.oldName;
  const newName = data.newName;
  const description = data?.description || '';
  const fee = await getFee('UPDATE_NAME');
  const resPermission = await getUserPermission(
    {
      text1: `Do you give this application permission to update this name?`, // TODO translate
      text2: `previous name: ${oldName}`,
      text3: `new name: ${newName}`,
      text4: data?.description,
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await updateName({ oldName, newName, description });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const leaveGroupRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const fee = await getFee('LEAVE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.leave_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: `${groupInfo.groupName}`,
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await leaveGroup({ groupId });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const inviteToGroupRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'inviteTime', 'inviteeAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.inviteeAddress;
  const inviteTime = data?.inviteTime;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_INVITE');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.invite', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await inviteToGroup({
      groupId,
      qortalAddress,
      inviteTime,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const kickFromGroupRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const reason = data?.reason;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_KICK');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.kick', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await kickFromGroup({
      groupId,
      qortalAddress,
      rBanReason: reason,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const banFromGroupRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const rBanTime = data?.banTime;
  const reason = data?.reason;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('GROUP_BAN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.ban', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await banFromGroup({
      groupId,
      qortalAddress,
      rBanTime,
      rBanReason: reason,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelGroupBanRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('CANCEL_GROUP_BAN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.cancel_ban', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await cancelBan({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const addGroupAdminRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('ADD_GROUP_ADMIN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.add_admin', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await makeAdmin({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const removeGroupAdminRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('REMOVE_GROUP_ADMIN');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.remove_admin', {
        partecipant: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await removeAdmin({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelGroupInviteRequest = async (data, isFromExtension) => {
  const requiredFields = ['groupId', 'qortalAddress'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = data.groupId;
  const qortalAddress = data?.qortalAddress;
  const txGroupId = data?.txGroupId || 0;

  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(qortalAddress);

  const fee = await getFee('CANCEL_GROUP_INVITE');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.cancel_group_invite', {
        invitee: displayInvitee || qortalAddress,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );

  const { accepted } = resPermission;

  if (accepted) {
    const response = await cancelInvitationToGroup({
      groupId,
      qortalAddress,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const createGroupRequest = async (data, isFromExtension) => {
  const requiredFields = [
    'approvalThreshold',
    'groupId',
    'groupName',
    'maxBlock',
    'minBlock',
    'qortalAddress',
    'type',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupName = data.groupName;
  const description = data?.description || '';
  const type = +data.type;
  const approvalThreshold = +data?.approvalThreshold;
  const minBlock = +data?.minBlock;
  const maxBlock = +data.maxBlock;

  const fee = await getFee('CREATE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.create_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await createGroup({
      groupName,
      groupDescription: description,
      groupType: type,
      groupApprovalThreshold: approvalThreshold,
      minBlock,
      maxBlock,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const updateGroupRequest = async (data, isFromExtension) => {
  const requiredFields = [
    'groupId',
    'newOwner',
    'type',
    'approvalThreshold',
    'minBlock',
    'maxBlock',
  ];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const groupId = +data.groupId;
  const newOwner = data.newOwner;
  const description = data?.description || '';
  const type = +data.type;
  const approvalThreshold = +data?.approvalThreshold;
  const minBlock = +data?.minBlock;
  const maxBlock = +data.maxBlock;
  const txGroupId = data?.txGroupId || 0;
  let groupInfo = null;
  try {
    const url = await createEndpoint(`/groups/${groupId}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        i18n.t('question:message.error.fetch_group', {
          postProcess: 'capitalizeFirstChar',
        })
      );

    groupInfo = await response.json();
  } catch (error) {
    const errorMsg =
      (error && error.message) ||
      i18n.t('question:message.error.no_group_found', {
        postProcess: 'capitalizeFirstChar',
      });
    throw new Error(errorMsg);
  }

  const displayInvitee = await getNameInfoForOthers(newOwner);

  const fee = await getFee('CREATE_GROUP');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.update_group', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:permission.update_group_detail', {
        owner: displayInvitee || newOwner,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('group:group.group_name', {
        name: groupInfo?.groupName,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await updateGroup({
      groupId,
      newOwner,
      newIsOpen: type,
      newDescription: description,
      newApprovalThreshold: approvalThreshold,
      newMinimumBlockDelay: minBlock,
      newMaximumBlockDelay: maxBlock,
      txGroupId,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const decryptAESGCMRequest = async (data, isFromExtension) => {
  const requiredFields = ['encryptedData', 'iv', 'senderPublicKey'];
  requiredFields.forEach((field) => {
    if (!data[field]) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });

  const encryptedData = data.encryptedData;
  const iv = data.iv;
  const senderPublicKeyBase58 = data.senderPublicKey;

  // Decode keys and IV
  const senderPublicKey = Base58.decode(senderPublicKeyBase58);
  const resKeyPair = await getKeyPair(); // Assume this retrieves the current user's keypair
  const uint8PrivateKey = Base58.decode(resKeyPair.privateKey);

  // Convert ed25519 keys to Curve25519
  const convertedPrivateKey = ed2curve.convertSecretKey(uint8PrivateKey);
  const convertedPublicKey = ed2curve.convertPublicKey(senderPublicKey);

  // Generate shared secret
  const sharedSecret = new Uint8Array(32);
  nacl.lowlevel.crypto_scalarmult(
    sharedSecret,
    convertedPrivateKey,
    convertedPublicKey
  );

  // Derive encryption key
  const encryptionKey: Uint8Array = new Sha256()
    .process(sharedSecret)
    .finish().result;

  // Convert IV and ciphertext from Base64
  const base64ToUint8Array = (base64) =>
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const ivUint8Array = base64ToUint8Array(iv);
  const ciphertext = base64ToUint8Array(encryptedData);
  // Validate IV and key lengths
  if (ivUint8Array.length !== 12) {
    throw new Error(
      i18n.t('question:message.error.invalid_encryption_iv', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  if (encryptionKey.length !== 32) {
    throw new Error(
      i18n.t('question:message.error.invalid_encryption_key', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  try {
    // Decrypt data
    const algorithm = { name: 'AES-GCM', iv: ivUint8Array };
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encryptionKey,
      algorithm,
      false,
      ['decrypt']
    );
    const decryptedArrayBuffer = await crypto.subtle.decrypt(
      algorithm,
      cryptoKey,
      ciphertext
    );

    // Return decrypted data as Base64
    return uint8ArrayToBase64(new Uint8Array(decryptedArrayBuffer));
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error(
      i18n.t('question:message.error.decrypt_message', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const sellNameRequest = async (data, isFromExtension) => {
  const requiredFields = ['salePrice', 'nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const name = data.nameForSale;
  const sellPrice = +data.salePrice;

  const validApi = await getBaseApi();

  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();
  if (!nameData)
    throw new Error(
      i18n.t('auth:message.error.name_not_existing', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  if (nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_already_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const fee = await getFee('SELL_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.sell_name_transaction', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t(
        'question:permission.sell_name_transaction_detail',
        {
          name: name,
          price: sellPrice,
          postProcess: 'capitalizeFirstChar',
        }
      ),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await sellName({
      name,
      sellPrice,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const cancelSellNameRequest = async (data, isFromExtension) => {
  const requiredFields = ['nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }
  const name = data.nameForSale;
  const validApi = await getBaseApi();

  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();
  if (!nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_not_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const fee = await getFee('CANCEL_SELL_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.sell_name_cancel', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:name', {
        name: name,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await cancelSellName({
      name,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const buyNameRequest = async (data, isFromExtension) => {
  const requiredFields = ['nameForSale'];
  const missingFields: string[] = [];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  });
  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    const errorMsg = i18n.t('question:message.error.missing_fields', {
      fields: missingFieldsString,
      postProcess: 'capitalizeFirstChar',
    });
    throw new Error(errorMsg);
  }

  const name = data.nameForSale;
  const validApi = await getBaseApi();
  const response = await fetch(validApi + '/names/' + name);
  const nameData = await response.json();

  if (!nameData?.isForSale)
    throw new Error(
      i18n.t('question:message.error.name_not_for_sale', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const sellerAddress = nameData.owner;
  const sellPrice = +nameData.salePrice;

  const fee = await getFee('BUY_NAME');
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.buy_name', {
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:permission.buy_name_detail', {
        name: name,
        price: sellPrice,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee.fee,
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const response = await buyName({
      name,
      sellerAddress,
      sellPrice,
    });
    return response;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};

export const signForeignFees = async (data, isFromExtension) => {
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.sign_fee', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    isFromExtension
  );
  const { accepted } = resPermission;
  if (accepted) {
    const wallet = await getSaveWallet();
    const address = wallet.address0;
    const resKeyPair = await getKeyPair();
    const parsedData = resKeyPair;
    const uint8PrivateKey = Base58.decode(parsedData.privateKey);
    const uint8PublicKey = Base58.decode(parsedData.publicKey);
    const keyPair = {
      privateKey: uint8PrivateKey,
      publicKey: uint8PublicKey,
    };

    const unsignedFeesUrl = await createEndpoint(
      `/crosschain/unsignedfees/${address}`
    );

    const unsignedFeesResponse = await fetch(unsignedFeesUrl);

    const unsignedFees = await unsignedFeesResponse.json();

    const signedFees = [];

    unsignedFees.forEach((unsignedFee) => {
      const unsignedDataDecoded = Base58.decode(unsignedFee.data);

      const signature = nacl.sign.detached(
        unsignedDataDecoded,
        keyPair.privateKey
      );

      const signedFee = {
        timestamp: unsignedFee.timestamp,
        data: `${Base58.encode(signature)}`,
        atAddress: unsignedFee.atAddress,
        fee: unsignedFee.fee,
      };

      signedFees.push(signedFee);
    });

    const signedFeesUrl = await createEndpoint(`/crosschain/signedfees`);

    await fetch(signedFeesUrl, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
      body: `${JSON.stringify(signedFees)}`,
    });

    return true;
  } else {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
};
export const multiPaymentWithPrivateData = async (data, isFromExtension) => {
  const requiredFields = ['payments', 'assetId'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });
  const resKeyPair = await getKeyPair();
  const parsedData = resKeyPair;
  const privateKey = parsedData.privateKey;
  const userPublicKey = parsedData.publicKey;
  const { fee: paymentFee } = await getFee('TRANSFER_ASSET');
  const { fee: arbitraryFee } = await getFee('ARBITRARY');

  let name = null;
  const payments = data.payments;
  const assetId = data.assetId;
  const pendingTransactions = [];
  const pendingAdditionalArbitraryTxs = [];
  const additionalArbitraryTxsWithoutPayment =
    data?.additionalArbitraryTxsWithoutPayment || [];
  let totalAmount = 0;
  let fee = 0;
  for (const payment of payments) {
    const paymentRefId = uid.rnd();
    const requiredFieldsPayment = ['recipient', 'amount'];

    for (const field of requiredFieldsPayment) {
      if (!payment[field]) {
        throw new Error(
          i18n.t('question:message.error.missing_fields', {
            fields: field,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    }

    const confirmReceiver = await getNameOrAddress(payment.recipient);
    if (confirmReceiver.error) {
      throw new Error(
        i18n.t('question:message.error.invalid_receiver', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    const receiverPublicKey = await getPublicKey(confirmReceiver);

    const amount = +payment.amount.toFixed(8);

    pendingTransactions.push({
      type: 'PAYMENT',
      recipientAddress: confirmReceiver,
      amount: amount,
      paymentRefId,
    });

    fee = fee + +paymentFee;
    totalAmount = totalAmount + amount;

    if (payment.arbitraryTxs && payment.arbitraryTxs.length > 0) {
      for (const arbitraryTx of payment.arbitraryTxs) {
        const requiredFieldsArbitraryTx = ['service', 'identifier', 'base64'];

        for (const field of requiredFieldsArbitraryTx) {
          if (!arbitraryTx[field]) {
            throw new Error(
              i18n.t('question:message.error.missing_fields', {
                fields: field,
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
        }

        if (!name) {
          const getName = await getNameInfo();
          if (!getName)
            throw new Error(
              i18n.t('question:message.error.registered_name', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          name = getName;
        }

        const isValid = isValidBase64WithDecode(arbitraryTx.base64);
        if (!isValid)
          throw new Error(
            i18n.t('core:message.error.invalid_base64', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        if (!arbitraryTx?.service?.includes('_PRIVATE'))
          throw new Error(
            i18n.t('question:message.generic.private_service', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        const additionalPublicKeys = arbitraryTx?.additionalPublicKeys || [];
        pendingTransactions.push({
          type: 'ARBITRARY',
          identifier: arbitraryTx.identifier,
          service: arbitraryTx.service,
          base64: arbitraryTx.base64,
          description: arbitraryTx?.description || '',
          paymentRefId,
          publicKeys: [receiverPublicKey, ...additionalPublicKeys],
        });

        fee = fee + +arbitraryFee;
      }
    }
  }

  if (
    additionalArbitraryTxsWithoutPayment &&
    additionalArbitraryTxsWithoutPayment.length > 0
  ) {
    for (const arbitraryTx of additionalArbitraryTxsWithoutPayment) {
      const requiredFieldsArbitraryTx = ['service', 'identifier', 'base64'];

      for (const field of requiredFieldsArbitraryTx) {
        if (!arbitraryTx[field]) {
          throw new Error(
            i18n.t('question:message.error.missing_fields', {
              fields: field,
              postProcess: 'capitalizeFirstChar',
            })
          );
        }
      }

      if (!name) {
        const getName = await getNameInfo();
        if (!getName)
          throw new Error(
            i18n.t('question:message.error.registered_name', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        name = getName;
      }

      const isValid = isValidBase64WithDecode(arbitraryTx.base64);
      if (!isValid)
        throw new Error(
          i18n.t('core:message.error.invalid_base64', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (!arbitraryTx?.service?.includes('_PRIVATE'))
        throw new Error(
          i18n.t('question:message.generic.private_service', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      const additionalPublicKeys = arbitraryTx?.additionalPublicKeys || [];
      pendingAdditionalArbitraryTxs.push({
        type: 'ARBITRARY',
        identifier: arbitraryTx.identifier,
        service: arbitraryTx.service,
        base64: arbitraryTx.base64,
        description: arbitraryTx?.description || '',
        publicKeys: additionalPublicKeys,
      });

      fee = fee + +arbitraryFee;
    }
  }

  if (!name)
    throw new Error(
      i18n.t('question:message.error.registered_name', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const balance = await getBalanceInfo();

  if (+balance < fee)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance_qort', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const assetBalance = await getAssetBalanceInfo(assetId);
  const assetInfo = await getAssetInfo(assetId);
  if (assetBalance < totalAmount)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance', {
        postProcess: 'capitalizeFirstChar',
      })
    );

  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.pay_publish', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:assets_used_pay', {
        asset: assetInfo.name,
        postProcess: 'capitalizeFirstChar',
      }),
      html: `
      <div style="max-height: 30vh; overflow-y: auto;">
      <style>

        .resource-container {
          display: flex;
          flex-direction: column;
          border: 1px solid;
          padding: 16px;
          margin: 8px 0;
          border-radius: 8px;
          background-color: var(--background-default);
        }
        
        .resource-detail {
          margin-bottom: 8px;
        }
        
        .resource-detail span {
          font-weight: bold;
          color: var(--text-primary);
        }
    
        @media (min-width: 600px) {
          .resource-container {
            flex-direction: row;
            flex-wrap: wrap;
          }
          .resource-detail {
            flex: 1 1 45%;
            margin-bottom: 0;
            padding: 4px 0;
          }
        }
      </style>
    
      ${pendingTransactions
        .filter((item) => item.type === 'PAYMENT')
        .map(
          (payment) => `
          <div class="resource-container">
            <div class="resource-detail"><span>Recipient:</span> ${
              payment.recipientAddress
            }</div>
            <div class="resource-detail"><span>Amount:</span> ${payment.amount}</div>
          </div>`
        )
        .join('')}
         ${[...pendingTransactions, ...pendingAdditionalArbitraryTxs]
           .filter((item) => item.type === 'ARBITRARY')
           .map(
             (arbitraryTx) => `
          <div class="resource-container">
            <div class="resource-detail"><span>Service:</span> ${
              arbitraryTx.service
            }</div>
            <div class="resource-detail"><span>Name:</span> ${name}</div>
            <div class="resource-detail"><span>Identifier:</span> ${
              arbitraryTx.identifier
            }</div>
          </div>`
           )
           .join('')}
    </div>
    
        `,
      highlightedText: `Total Amount: ${totalAmount}`,
      fee: fee,
    },
    isFromExtension
  );

  const { accepted, checkbox1 = false } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }

  // const failedTxs = []
  const paymentsDone = {};

  const transactionsDone = [];

  for (const transaction of pendingTransactions) {
    const type = transaction.type;

    if (type === 'PAYMENT') {
      const makePayment = await retryTransaction(
        transferAsset,
        [
          {
            amount: transaction.amount,
            assetId,
            recipient: transaction.recipientAddress,
          },
        ],
        true
      );
      if (makePayment) {
        transactionsDone.push(makePayment?.signature);
        if (transaction.paymentRefId) {
          paymentsDone[transaction.paymentRefId] = makePayment;
        }
      }
    } else if (type === 'ARBITRARY' && paymentsDone[transaction.paymentRefId]) {
      const objectToEncrypt = {
        data: transaction.base64,
        payment: paymentsDone[transaction.paymentRefId],
      };

      const toBase64 = await retryTransaction(
        objectToBase64,
        [objectToEncrypt],
        true
      );

      if (!toBase64) continue; // Skip if encryption fails

      const encryptDataResponse = await retryTransaction(
        encryptDataGroup,
        [
          {
            data64: toBase64,
            publicKeys: transaction.publicKeys,
            privateKey,
            userPublicKey,
          },
        ],
        true
      );

      if (!encryptDataResponse) continue; // Skip if encryption fails

      const resPublish = await retryTransaction(
        publishData,
        [
          {
            registeredName: encodeURIComponent(name),
            file: encryptDataResponse,
            service: transaction.service,
            identifier: encodeURIComponent(transaction.identifier),
            uploadType: 'file',
            description: transaction?.description,
            isBase64: true,
            apiVersion: 2,
            withFee: true,
          },
        ],
        true
      );

      if (resPublish?.signature) {
        transactionsDone.push(resPublish?.signature);
      }
    }
  }

  for (const transaction of pendingAdditionalArbitraryTxs) {
    const objectToEncrypt = {
      data: transaction.base64,
    };

    const toBase64 = await retryTransaction(
      objectToBase64,
      [objectToEncrypt],
      true
    );

    if (!toBase64) continue; // Skip if encryption fails

    const encryptDataResponse = await retryTransaction(
      encryptDataGroup,
      [
        {
          data64: toBase64,
          publicKeys: transaction.publicKeys,
          privateKey,
          userPublicKey,
        },
      ],
      true
    );

    if (!encryptDataResponse) continue; // Skip if encryption fails

    const resPublish = await retryTransaction(
      publishData,
      [
        {
          registeredName: encodeURIComponent(name),
          data: encryptDataResponse,
          service: transaction.service,
          identifier: encodeURIComponent(transaction.identifier),
          uploadType: 'base64',
          description: transaction?.description,
          apiVersion: 2,
          withFee: true,
        },
      ],
      true
    );

    if (resPublish?.signature) {
      transactionsDone.push(resPublish?.signature);
    }
  }

  return transactionsDone;
};

export const transferAssetRequest = async (data, isFromExtension) => {
  const requiredFields = ['amount', 'assetId', 'recipient'];
  requiredFields.forEach((field) => {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        i18n.t('question:message.error.missing_fields', {
          fields: field,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  });
  const amount = data.amount;
  const assetId = data.assetId;
  const recipient = data.recipient;

  const { fee } = await getFee('TRANSFER_ASSET');
  const balance = await getBalanceInfo();

  if (+balance < +fee)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance_qort', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const assetBalance = await getAssetBalanceInfo(assetId);
  if (assetBalance < amount)
    throw new Error(
      i18n.t('question:message.error.insufficient_balance', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  const confirmReceiver = await getNameOrAddress(recipient);
  if (confirmReceiver.error) {
    throw new Error(
      i18n.t('question:message.error.invalid_receiver', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const assetInfo = await getAssetInfo(assetId);
  const resPermission = await getUserPermission(
    {
      text1: i18n.t('question:permission.transfer_asset', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:asset_name', {
        asset: assetInfo?.name,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: i18n.t('question:amount_qty', {
        quantity: amount,
        postProcess: 'capitalizeFirstChar',
      }),
      fee: fee,
    },
    isFromExtension
  );

  const { accepted } = resPermission;
  if (!accepted) {
    throw new Error(
      i18n.t('question:message.generic.user_declined_request', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  const res = await transferAsset({
    amount,
    recipient: confirmReceiver,
    assetId,
  });
  return res;
};

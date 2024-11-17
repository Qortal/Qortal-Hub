// @ts-nocheck

import {bytes_to_base64 as bytesToBase64, Sha512} from 'asmcrypto.js'
import utils from '../utils/utils'
import { crypto as crypto2 } from '../constants/decryptWallet'
import BcryptWorker from './bcryptworker.worker.js?worker';

const stringtoUTF8Array = (message)=> {
    if (typeof message === 'string') {
        var s = unescape(encodeURIComponent(message)) // UTF-8
        message = new Uint8Array(s.length)
        for (var i = 0; i < s.length; i++) {
            message[i] = s.charCodeAt(i) & 0xff
        }
    }
    return message
}



const bcryptInWorker = (hashBase64, salt) => {
  return new Promise((resolve, reject) => {
      const worker = new BcryptWorker()
      worker.onmessage = (e) => {
          const { result, error } = e.data;
          if (error) {
              reject(error);
          } else {
              resolve(result);
          }
          worker.terminate();
      };
      worker.onerror = (err) => {
          reject(err.message);
          worker.terminate();
      };
      worker.postMessage({ hashBase64, salt });
  });
};


const stringToUTF8Array=(message)=> {
    if (typeof message !== 'string') return message; // Assuming you still want to pass through non-string inputs unchanged
    const encoder = new TextEncoder(); // TextEncoder defaults to UTF-8
    return encoder.encode(message);
}
const computekdf = async (req)=> {
    const { salt, key, nonce, staticSalt, staticBcryptSalt } = req
    const combinedBytes = utils.appendBuffer(new Uint8Array([]), stringToUTF8Array(`${staticSalt}${key}${nonce}`))

    const sha512Hash = new Sha512().process(combinedBytes).finish().result
    const sha512HashBase64 = bytesToBase64(sha512Hash)

    const result = await bcryptInWorker(sha512HashBase64.substring(0, 72), staticBcryptSalt);
    return { key, nonce, result }
}

export const doInitWorkers = (numberOfWorkers) => {
    const workers = []

        try {
            for (let i = 0; i < numberOfWorkers; i++) {
                workers.push({})
            }
           
        } catch (e) {
        }
  
    return workers
}

export const kdf = async (seed, salt, threads) => {
	const workers = threads
    const salt2 = 	new Uint8Array(salt)

	salt = new Uint8Array(salt)
	const seedParts = await Promise.all(workers.map((worker, index) => {
		const nonce = index
		return computekdf({
			key: seed,
			salt,
			nonce,
			staticSalt: crypto2.staticSalt,
			staticBcryptSalt: crypto2.staticBcryptSalt
		}).then(data => {
			let jsonData
			try {
				jsonData = JSON.parse(data)
				data = jsonData
			} catch (e) {
				// ...
			}
			// if (seed !== data.key) throw new Error(kst3 + seed + ' !== ' + data.key)
			// if (nonce !== data.nonce) throw new Error(kst4)
			return data.result
		})
	}))
	const result = new Sha512().process(stringtoUTF8Array(crypto2.staticSalt + seedParts.reduce((a, c) => a + c))).finish().result
	return result
}

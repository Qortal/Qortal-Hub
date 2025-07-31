/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import fs from 'fs';
import util from 'util';
import crypto from 'crypto';
const readFile = util.promisify(fs.readFile);

let wasmInstance: any = null;
let computeLock = false;

const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
const heap = new Uint8Array(memory.buffer);
const initialBrk = 512 * 1024;
let brk = initialBrk;
const waitingQueue: any[] = [];

function processWaitingQueue() {
  let i = 0;
  while (i < waitingQueue.length) {
    const request = waitingQueue[i];
    const ptr = sbrk(request.size);
    if (ptr !== null) {
      request.resolve(ptr);
      waitingQueue.splice(i, 1);
    } else {
      i++;
    }
  }
}

function sbrk(size: number) {
  const oldBrk = brk;
  if (brk + size > heap.length) {
    console.log('Not enough memory available, adding to waiting queue');
    return null;
  }
  brk += size;
  return oldBrk;
}

function resetMemory() {
  brk = initialBrk;
  processWaitingQueue();
}

function requestMemory(size: number) {
  return new Promise<number>((resolve, reject) => {
    const ptr = sbrk(size);
    if (ptr !== null) {
      resolve(ptr);
    } else {
      waitingQueue.push({ size, resolve, reject });
    }
  });
}
async function getWasmInstance(memory: WebAssembly.Memory) {
  if (wasmInstance) return wasmInstance;
  const filename = path.join(__dirname, './memory-pow.wasm.full');
  const buffer = await readFile(filename);
  const module = await WebAssembly.compile(buffer);
  wasmInstance = new WebAssembly.Instance(module, { env: { memory } });
  return wasmInstance;
}

async function computePow(
  memory: WebAssembly.Memory,
  hashPtr: number,
  workBufferPtr: number,
  workBufferLength: number,
  difficulty: number
) {
  if (computeLock) throw new Error('Concurrent compute2 call detected');
  computeLock = true;
  try {
    const wasm = await getWasmInstance(memory);
    return wasm.exports.compute2(
      hashPtr,
      workBufferPtr,
      workBufferLength,
      difficulty
    );
  } finally {
    computeLock = false;
  }
}

export async function compute(
  input: Uint8Array,
  difficulty: number,
  workBufferLength = 2 * 1024 * 1024
): Promise<number> {
  try {
    resetMemory();

    const hash = crypto.createHash('sha256').update(input).digest();

    const hashPtr = sbrk(32);
    if (hashPtr === null) throw new Error('Unable to allocate memory for hash');
    const hashView = new Uint8Array(memory.buffer, hashPtr, 32);
    hashView.set(hash);

    const workBufferPtr = await requestMemory(workBufferLength);
    if (workBufferPtr === null)
      throw new Error('Unable to allocate memory for work buffer');

    const nonceValue = await computePow(
      memory,
      hashPtr,
      workBufferPtr,
      workBufferLength,
      difficulty
    );

    if (
      typeof nonceValue !== 'number' ||
      nonceValue < 0 ||
      !Number.isInteger(nonceValue)
    ) {
      throw new Error(`Invalid nonce computed: ${nonceValue}`);
    }

    return nonceValue;
  } catch (error) {
    console.error('❌ PoW nonce computation failed:', error);
    throw error;
  } finally {
    resetMemory();
  }
}

let lastComputePromise: Promise<any> = Promise.resolve();

export function queuedCompute(
  input: Uint8Array,
  difficulty: number,
  workBufferLength = 2 * 1024 * 1024
): Promise<number> {
  const next = () => compute(input, difficulty, workBufferLength);
  lastComputePromise = lastComputePromise.then(next, next);
  return lastComputePromise;
}

import { Sha256 } from 'asmcrypto.js';
import wasmInit from './memory-pow.wasm?init';

let compute; // Exported compute function from Wasm
let memory;  // WebAssembly.Memory instance
let heap;    // Uint8Array view of the memory buffer
let brk = 512 * 1024; // Initial brk set to 512 KiB
const allocations = new Map(); // Track allocations by pointer
let workBufferPtr = null; // Reuse work buffer
const workBufferLength = 8 * 1024 * 1024; // 8 MiB

// Load the WebAssembly module
async function loadWasm() {
  try {
    memory = new WebAssembly.Memory({ initial: 256, maximum: 256 }); // 16 MiB
    heap = new Uint8Array(memory.buffer);

    const importObject = {
      env: {
        memory, // Pass memory to Wasm
        abort: () => { throw new Error('Wasm abort called'); }, // Handle abort calls from Wasm
      },
    };

    const wasmModule = await wasmInit(importObject);
    compute = wasmModule.exports.compute2;
    console.log('Wasm loaded successfully:', compute);
  } catch (error) {
    console.error('Error loading Wasm:', error);
    throw error;
  }
}

// Memory allocation function
function sbrk(size) {
  const old = brk;

  // If a previous allocation exists for this size, reuse it
  if (allocations.has(size)) {
    return allocations.get(size);
  }

  brk += size;

  // Grow memory if needed
  if (brk > memory.buffer.byteLength) {
    const pagesNeeded = Math.ceil((brk - memory.buffer.byteLength) / (64 * 1024)); // 64 KiB per page
    console.log(`Growing memory by ${pagesNeeded} pages`);
    try {
      memory.grow(pagesNeeded);
      heap = new Uint8Array(memory.buffer); // Update heap view
    } catch (e) {
      console.error('Failed to grow memory:', e);
      throw new RangeError('WebAssembly.Memory.grow(): Maximum memory size exceeded');
    }
  }

  allocations.set(size, old); // Track the allocation
  return old;
}

// Proof-of-Work computation function
async function computePow(chatBytes, difficulty) {
  if (!compute) {
    throw new Error('WebAssembly module not initialized. Call loadWasm first.');
  }

  const chatBytesArray = Uint8Array.from(Object.values(chatBytes));
  const chatBytesHash = new Sha256().process(chatBytesArray).finish().result;

  // Allocate memory for the hash
  const hashPtr = sbrk(32);
  const hashAry = new Uint8Array(memory.buffer, hashPtr, 32);
  hashAry.set(chatBytesHash);

  // Reuse the work buffer if already allocated
  if (!workBufferPtr) {
    workBufferPtr = sbrk(workBufferLength);
  }

  console.log('Starting POW computation...');
  const nonce = compute(hashPtr, workBufferPtr, workBufferLength, difficulty);
  console.log('POW computation finished.');

  return { nonce, chatBytesArray };
}

// Worker event listener
self.addEventListener('message', async (e) => {
  const { chatBytes, difficulty } = e.data;

  try {
    // Initialize Wasm if not already done
    if (!compute) {
      await loadWasm();
    }

    // Perform the POW computation
    const result = await computePow(chatBytes, difficulty);

    // Send the result back to the main thread
    self.postMessage(result);
  } catch (error) {
    console.error('Error in worker:', error);
    self.postMessage({ error: error.message });
  }
});

/**
 * Qortino AI's model runs here, in an Electron utility process of its own:
 * a model file that makes llama.cpp abort takes this process down, not Hub.
 * The main process (qortino-llm.ts) starts it on the first load and passes
 * the renderer's calls through.
 *
 * One model at a time, in one context sequence. Each reply is given the whole
 * conversation; llama.cpp keeps what it read last time, so only the new part
 * of the prompt is read again.
 */
import {
  QORTINO_WORKER_EVENT,
  type QortinoWorkerReply,
  type QortinoWorkerRequest,
} from './qortino-llm-protocol';

type ParentPort = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort?: ParentPort })
  .parentPort;

// node-llama-cpp is an ES module; tsc would turn a plain import() into
// require() for this CommonJS build.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>;

type Loaded = {
  path: string;
  nCtx: number;
  model: any;
  context: any;
  sequence: any;
  chat: any;
  gpu: string | false;
  gpuLayers: number;
  /** Asked for with the graphics card allowed ('auto') or not (false). */
  wantGpu: 'auto' | false;
};

let lib: any = null;
let llama: any = null;
let llamaGpu: 'auto' | false = 'auto';
let loaded: Loaded | null = null;
let running: AbortController | null = null;
/** Calls run one after another; cancel does not wait in line. */
let queue: Promise<unknown> = Promise.resolve();

function post(message: QortinoWorkerReply): void {
  parentPort?.postMessage(message);
}

function emit(event: 'token' | 'progress', payload: unknown): void {
  post({ type: QORTINO_WORKER_EVENT, event, payload });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function getLlama(): Promise<any> {
  if (llama) return llama;
  lib ??= await importEsm('node-llama-cpp');
  llama = await lib.getLlama({
    gpu: llamaGpu,
    logLevel: lib.LlamaLogLevel?.error ?? 'error',
  });
  return llama;
}

async function disposeLoaded(): Promise<void> {
  const current = loaded;
  loaded = null;
  if (!current) return;
  await current.context?.dispose?.().catch(() => undefined);
  await current.model?.dispose?.().catch(() => undefined);
}

async function loadModel(args: {
  path: string;
  nCtx?: number;
  gpu?: boolean;
}): Promise<{
  loaded: boolean;
  path: string;
  loadMs: number;
  gpu: string | false;
  gpuLayers: number;
}> {
  const nCtx = Math.max(512, Math.min(32_768, args.nCtx ?? 4096));
  const wantGpu = args.gpu === false ? false : 'auto';
  if (
    loaded &&
    loaded.path === args.path &&
    loaded.nCtx === nCtx &&
    loaded.wantGpu === wantGpu
  ) {
    return {
      loaded: true,
      path: args.path,
      loadMs: 0,
      gpu: loaded.gpu,
      gpuLayers: loaded.gpuLayers,
    };
  }
  const startedAt = Date.now();
  await disposeLoaded();
  if (llama && llamaGpu !== wantGpu) {
    await llama.dispose?.().catch(() => undefined);
    llama = null;
  }
  llamaGpu = wantGpu;
  emit('progress', { stage: 'load', detail: '', percent: 0 });

  let instance = await getLlama();
  let model: any;
  try {
    model = await instance.loadModel({
      modelPath: args.path,
      onLoadProgress: (percent: number) =>
        emit('progress', { stage: 'load', detail: '', percent }),
    });
  } catch (error) {
    // Not enough graphics memory, or a driver that would not take it: the
    // processor can still run it.
    if (instance.gpu === false) throw error;
    await instance.dispose?.().catch(() => undefined);
    llama = null;
    llamaGpu = false;
    instance = await getLlama();
    model = await instance.loadModel({ modelPath: args.path });
  }

  let context: any;
  try {
    context = await model.createContext({ contextSize: nCtx });
  } catch (error) {
    // Too little memory for the whole window: a smaller one still answers.
    context = await model
      .createContext({ contextSize: Math.min(nCtx, 2048) })
      .catch(async () => {
        await model.dispose().catch(() => undefined);
        throw error;
      });
  }
  const sequence = context.getSequence();
  const chat = new lib.LlamaChat({ contextSequence: sequence });
  loaded = {
    path: args.path,
    nCtx,
    model,
    context,
    sequence,
    chat,
    gpu: instance.gpu,
    gpuLayers: Number(model.gpuLayers) || 0,
    wantGpu,
  };
  return {
    loaded: true,
    path: args.path,
    loadMs: Date.now() - startedAt,
    gpu: loaded.gpu,
    gpuLayers: loaded.gpuLayers,
  };
}

function requireLoaded(): Loaded {
  if (!loaded) throw new Error('Model is not loaded');
  return loaded;
}

/** Read the system prompt ahead of the first question. */
async function warmup(args: {
  system: string;
}): Promise<{ ok: boolean; warmMs: number }> {
  const current = requireLoaded();
  if (!args.system) return { ok: true, warmMs: 0 };
  const startedAt = Date.now();
  emit('progress', { stage: 'warmup', detail: '', percent: 0 });
  const state = current.chat.chatWrapper.generateContextState({
    chatHistory: [{ type: 'system', text: args.system }],
  });
  const tokens: number[] = state.contextText.tokenize(current.model.tokenizer);
  const have: number[] = current.sequence.contextTokens;
  let same = 0;
  while (
    same < have.length &&
    same < tokens.length &&
    have[same] === tokens[same]
  ) {
    same += 1;
  }
  if (same < have.length) {
    await current.sequence.eraseContextTokenRanges([
      { start: same, end: current.sequence.nextTokenIndex },
    ]);
  }
  if (same < tokens.length) {
    await current.sequence.evaluateWithoutGeneratingNewTokens(
      tokens.slice(same)
    );
  }
  return { ok: true, warmMs: Date.now() - startedAt };
}

type CompleteArgs = {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
};

async function complete(
  args: CompleteArgs
): Promise<{ ok: boolean; text: string }> {
  const current = requireLoaded();
  const controller = new AbortController();
  running = controller;
  const history: any[] = [];
  if (args.system) history.push({ type: 'system', text: args.system });
  for (const message of args.messages || []) {
    if (message.role === 'assistant') {
      history.push({ type: 'model', response: [message.content] });
    } else if (message.role === 'system') {
      history.push({ type: 'system', text: message.content });
    } else {
      history.push({ type: 'user', text: message.content });
    }
  }
  history.push({ type: 'model', response: [] });

  emit('progress', { stage: 'prefill', detail: '', percent: 0 });
  let writing = false;
  let text = '';
  try {
    const penalty = args.repeatPenalty ?? 1;
    const result = await current.chat.generateResponse(history, {
      maxTokens: Math.max(16, Math.min(8192, args.maxTokens ?? 1024)),
      temperature: args.temperature ?? 0.7,
      topK: args.topK ?? 20,
      topP: args.topP ?? 0.8,
      minP: args.minP ?? 0,
      repeatPenalty:
        penalty > 1 || (args.presencePenalty ?? 0) > 0
          ? {
              penalty: Math.max(1, penalty),
              presencePenalty: args.presencePenalty ?? 0,
            }
          : false,
      // A model that thinks first (DeepSeek R1, Qwen3 hybrid): its thoughts
      // stay out of the answer, and do not get the whole window.
      budgets: { thoughtTokens: Math.max(256, Math.floor(current.nCtx / 3)) },
      signal: controller.signal,
      stopOnAbortSignal: true,
      onResponseChunk: (chunk: any) => {
        if (chunk.type === 'segment') {
          if (!writing) {
            emit('progress', { stage: 'thinking', detail: '', percent: 0 });
          }
          return;
        }
        if (!chunk.text) return;
        if (!writing) {
          writing = true;
          emit('progress', { stage: 'generate', detail: '', percent: 1 });
        }
        text += chunk.text;
        emit('token', { token: chunk.text, done: false });
      },
    });
    const response =
      typeof result?.response === 'string' ? result.response : text;
    emit('token', { token: '', done: true });
    if (controller.signal.aborted && !response.trim()) {
      throw new Error('cancelled');
    }
    return { ok: true, text: response };
  } catch (error) {
    const message = controller.signal.aborted
      ? 'cancelled'
      : errorMessage(error);
    emit('token', { token: '', done: true, error: message });
    throw new Error(message);
  } finally {
    if (running === controller) running = null;
  }
}

async function unload(): Promise<void> {
  running?.abort();
  await disposeLoaded();
}

function info(): Record<string, unknown> {
  return {
    loadedPath: loaded?.path ?? null,
    gpu: loaded?.gpu ?? llama?.gpu ?? null,
    gpuLayers: loaded?.gpuLayers ?? 0,
  };
}

/** Bumped by every cancel: a reply still waiting in line when Stop was pressed never starts. */
let cancelEpoch = 0;

function handle(request: QortinoWorkerRequest): void {
  if (request.op === 'cancel') {
    cancelEpoch += 1;
    running?.abort();
    post({ type: 'reply', id: request.id, ok: true, result: {} });
    return;
  }
  const epoch = cancelEpoch;
  const run = async () => {
    switch (request.op) {
      case 'load':
        return loadModel(request.args as Parameters<typeof loadModel>[0]);
      case 'warmup':
        return warmup(request.args as { system: string });
      case 'complete':
        if (epoch !== cancelEpoch) {
          emit('token', { token: '', done: true, error: 'cancelled' });
          throw new Error('cancelled');
        }
        return complete(request.args as CompleteArgs);
      case 'unload':
        await unload();
        return {};
      case 'info':
        return info();
      default:
        throw new Error(`Unknown Qortino call: ${String(request.op)}`);
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  next.then(
    (result) => post({ type: 'reply', id: request.id, ok: true, result }),
    (error) =>
      post({
        type: 'reply',
        id: request.id,
        ok: false,
        error: errorMessage(error),
      })
  );
}

parentPort?.on('message', (event) => {
  const request = event?.data as QortinoWorkerRequest;
  if (!request || typeof request !== 'object' || !request.id) return;
  handle(request);
});

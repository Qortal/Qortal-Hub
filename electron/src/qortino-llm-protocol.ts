/** Messages between the main process and Qortino's model process. */

export const QORTINO_WORKER_EVENT = 'event';

export type QortinoWorkerOp =
  | 'load'
  | 'warmup'
  | 'complete'
  | 'cancel'
  | 'unload'
  | 'info';

export type QortinoWorkerRequest = {
  id: string;
  op: QortinoWorkerOp;
  args?: unknown;
};

export type QortinoWorkerReply =
  | {
      type: 'reply';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      type: typeof QORTINO_WORKER_EVENT;
      event: 'token' | 'progress';
      payload: unknown;
    };

/** IPC channel the main process sends Qortino's events to the Hub window on. */
export const QORTINO_RENDERER_EVENT_CHANNEL = 'qortino:event';

export type QortinoRendererEventName =
  | 'token'
  | 'progress'
  | 'downloadProgress'
  | 'verifyProgress';

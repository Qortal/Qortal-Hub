/**
 * A converted file publishData can upload without its bytes entering the
 * renderer: a QAppFileReference whose `upload()` has Electron main read the
 * chunk from the job folder and post it to the node (videoTool.uploadChunk),
 * the way the Q-App file worker's references work. A node on this PC reads
 * the file itself instead (`buildOnNode`, videoTool.buildOnNode).
 */
import {
  videoToolErrorCode,
  type VideoToolBridge,
  type VideoUploadResult,
} from '../../../electron/src/video-tool-types';
import { QAppFileUploadError } from '../../../electron/src/qapp-file-protocol';
import type { QAppFileOperation } from '../../../electron/src/qapp-file-protocol';
import {
  needsApiKey,
  NodeAnswerError,
  nodeAnswerErrorFromStatus,
} from '../../qdn/publish/nodeAnswer';
import type { NodeBuildable } from '../../qdn/publish/nodeBuildable';
import { QAppFileReference } from '../../qortal/qapp-file-reference';
import { VideoPublishError } from './errors';

export type JobFileReferenceInput = {
  jobId: string;
  /** 'video' or a subtitle id from the job's output. */
  file: string;
  size: number;
  name: string;
  type: string;
  /** Defaults to window.videoTool. */
  bridge?: Pick<VideoToolBridge, 'uploadChunk'> &
    Partial<Pick<VideoToolBridge, 'buildOnNode'>>;
  /** While a node on this PC reads the file itself (true), then false. */
  onNodeBuild?: (building: boolean) => void;
};

type NodeBuild = NodeBuildable['buildOnNode'];

/** Each reference's build (a QAppFileReference freezes itself). */
const nodeBuilds = new WeakMap<QAppFileReference, NodeBuild>();

/** A job file a node on this PC can also read itself. */
class JobFileReference extends QAppFileReference implements NodeBuildable {
  buildOnNode(endpoint: string, filename?: string) {
    const build = nodeBuilds.get(this);
    return build ? build(endpoint, filename) : Promise.resolve(null);
  }
}

export const videoToolBridge = (): VideoToolBridge | undefined =>
  (globalThis as { videoTool?: VideoToolBridge }).videoTool;

export function createJobFileReference({
  jobId,
  file,
  size,
  name,
  type,
  bridge = videoToolBridge(),
  onNodeBuild,
}: JobFileReferenceInput): QAppFileReference & Partial<NodeBuildable> {
  if (!bridge?.uploadChunk) throw new VideoPublishError('bridge-missing');

  const call = async (operation: QAppFileOperation) => {
    // Only plain uploads: this file is never read back, saved or encrypted
    // through the reference (saving goes through videoTool.saveOutput).
    if (operation.kind !== 'upload' || operation.encryption) {
      throw new VideoPublishError('unsupported-operation', operation.kind);
    }
    const result = await bridge
      .uploadChunk({
        jobId,
        file,
        start: operation.start,
        end: operation.end,
        index: operation.index,
        endpoint: operation.endpoint,
      })
      .catch((error) => {
        // Main turned the request down, and will every time: not retried.
        if (videoToolErrorCode(error)) {
          throw new NodeAnswerError(error.message, 400);
        }
        throw error;
      });
    if (result.ok === true) return undefined;
    const { status } = result as Extract<VideoUploadResult, { ok: false }>;
    // Status 0 is a network failure, not the node's answer: a plain error,
    // which publishData's chunk loop retries (a QAppFileUploadError(0) would
    // count as a refusal there).
    if (!status) throw new Error('network');
    throw new QAppFileUploadError(status);
  };

  const metadata = { reference: {}, size, type, name };
  if (!bridge.buildOnNode) return new QAppFileReference(metadata, 0, call);

  const buildOnNode: NodeBuild = async (endpoint, filename) => {
    onNodeBuild?.(true);
    try {
      const result = await bridge.buildOnNode({
        jobId,
        file,
        endpoint,
        filename: filename || name,
      });
      if (result.ok === true) return result.transaction;
      // An upload would be refused for the API key the same way.
      if (needsApiKey(result.status)) {
        throw nodeAnswerErrorFromStatus(result.status);
      }
      return null;
    } catch (error) {
      if (error instanceof NodeAnswerError) throw error;
      // Main turned the request down: the upload says why, if it fails too.
      return null;
    } finally {
      onNodeBuild?.(false);
    }
  };
  const reference = new JobFileReference(metadata, 0, call);
  nodeBuilds.set(reference, buildOnNode);
  return reference;
}

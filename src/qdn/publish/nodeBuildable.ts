/**
 * A file a node on this PC can read itself (a converted video in Hub's own
 * folder). publishData has the node build the transaction from it (Core's
 * publish-from-path route) before it would upload it in chunks: nothing is
 * uploaded, and the node keeps no temporary copies of its own.
 */
export type NodeBuildable = {
  /**
   * The unsigned transaction (Base58) the node built at `endpoint`
   * (publishData's /arbitrary/<SERVICE>/<name>[/<identifier>] with its
   * query), or null when it can't build it that way: then it's uploaded.
   */
  buildOnNode(endpoint: string, filename?: string): Promise<string | null>;
};

export const isNodeBuildable = (value: unknown): value is NodeBuildable =>
  typeof (value as Partial<NodeBuildable> | null)?.buildOnNode === 'function';

import * as nodeCrypto from 'crypto';

export type ReticulumChatAuthorSequenceHead = {
  authorAddress: string;
  authorStreamId: string;
  maxSeq: number;
};

export interface ReticulumChatAuthorTreeSnapshot {
  groupId: number;
  root: string;
  count: number;
  buckets: ReticulumChatAuthorSequenceHead[][];
  nodeHashes: Map<string, string>;
  nodeCounts: Map<string, number>;
  createdAt: number;
}

export type SerializedReticulumChatAuthorTreeSnapshot = Omit<
  ReticulumChatAuthorTreeSnapshot,
  'nodeHashes' | 'nodeCounts'
> & {
  nodeHashes: Array<[string, string]>;
  nodeCounts: Array<[string, number]>;
};

export const RETICULUM_CHAT_AUTHOR_TREE_DEPTH = 8;
export const RETICULUM_CHAT_AUTHOR_TREE_BUCKETS =
  1 << RETICULUM_CHAT_AUTHOR_TREE_DEPTH;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export function hashReticulumChatAuthorTreeValue(
  value: Record<string, unknown>
): string {
  return nodeCrypto
    .createHash('sha256')
    .update(canonicalize(value), 'utf8')
    .digest('hex');
}

function normalizeAuthorStreamId(value: unknown): string {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : '';
}

export function reticulumChatAuthorTreeHeadKey(
  head: ReticulumChatAuthorSequenceHead
): string {
  return `${head.authorAddress}\u0000${head.authorStreamId}`;
}

export function compareReticulumChatAuthorTreeHeads(
  a: ReticulumChatAuthorSequenceHead,
  b: ReticulumChatAuthorSequenceHead
): number {
  if (a.authorAddress < b.authorAddress) return -1;
  if (a.authorAddress > b.authorAddress) return 1;
  if (a.authorStreamId < b.authorStreamId) return -1;
  if (a.authorStreamId > b.authorStreamId) return 1;
  return 0;
}

export function reticulumChatAuthorTreeBucket(
  head: ReticulumChatAuthorSequenceHead
): number {
  return nodeCrypto
    .createHash('sha256')
    .update(reticulumChatAuthorTreeHeadKey(head), 'utf8')
    .digest()[0];
}

export function hashReticulumChatAuthorTreeBucket(
  groupId: number,
  bucket: number,
  heads: ReticulumChatAuthorSequenceHead[]
): string {
  return hashReticulumChatAuthorTreeValue({
    t: 'author_bucket_v1',
    g: groupId,
    b: bucket,
    h: heads.map((head) => [
      head.authorAddress,
      head.authorStreamId,
      head.maxSeq,
    ]),
  });
}

export function hashReticulumChatAuthorTreeNode(
  groupId: number,
  path: string,
  leftHash: string,
  rightHash: string
): string {
  return hashReticulumChatAuthorTreeValue({
    t: 'author_node_v1',
    g: groupId,
    p: path,
    l: leftHash,
    r: rightHash,
  });
}

export function buildReticulumChatAuthorTreeSnapshot(
  groupId: number,
  inputHeads: ReticulumChatAuthorSequenceHead[],
  createdAt = Date.now()
): ReticulumChatAuthorTreeSnapshot {
  const deduped = new Map<string, ReticulumChatAuthorSequenceHead>();
  for (const candidate of inputHeads) {
    const authorAddress = String(candidate.authorAddress || '').trim();
    const authorStreamId = normalizeAuthorStreamId(candidate.authorStreamId);
    const maxSeq = Math.floor(Number(candidate.maxSeq || 0));
    if (
      !authorAddress ||
      !authorStreamId ||
      !Number.isSafeInteger(maxSeq) ||
      maxSeq <= 0
    )
      continue;
    const head = { authorAddress, authorStreamId, maxSeq };
    const key = reticulumChatAuthorTreeHeadKey(head);
    const existing = deduped.get(key);
    if (!existing || existing.maxSeq < maxSeq) deduped.set(key, head);
  }
  const buckets = Array.from(
    { length: RETICULUM_CHAT_AUTHOR_TREE_BUCKETS },
    () => [] as ReticulumChatAuthorSequenceHead[]
  );
  for (const head of deduped.values()) {
    buckets[reticulumChatAuthorTreeBucket(head)].push(head);
  }
  const nodeHashes = new Map<string, string>();
  const nodeCounts = new Map<string, number>();
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    buckets[bucket].sort(compareReticulumChatAuthorTreeHeads);
    const path = bucket
      .toString(2)
      .padStart(RETICULUM_CHAT_AUTHOR_TREE_DEPTH, '0');
    nodeHashes.set(
      path,
      hashReticulumChatAuthorTreeBucket(groupId, bucket, buckets[bucket])
    );
    nodeCounts.set(path, buckets[bucket].length);
  }
  for (
    let depth = RETICULUM_CHAT_AUTHOR_TREE_DEPTH - 1;
    depth >= 0;
    depth -= 1
  ) {
    const nodesAtDepth = 1 << depth;
    for (let index = 0; index < nodesAtDepth; index += 1) {
      const path = depth === 0 ? '' : index.toString(2).padStart(depth, '0');
      const leftPath = `${path}0`;
      const rightPath = `${path}1`;
      nodeHashes.set(
        path,
        hashReticulumChatAuthorTreeNode(
          groupId,
          path,
          nodeHashes.get(leftPath)!,
          nodeHashes.get(rightPath)!
        )
      );
      nodeCounts.set(
        path,
        (nodeCounts.get(leftPath) ?? 0) + (nodeCounts.get(rightPath) ?? 0)
      );
    }
  }
  return {
    groupId,
    root: nodeHashes.get('')!,
    count: deduped.size,
    buckets,
    nodeHashes,
    nodeCounts,
    createdAt,
  };
}

export function serializeReticulumChatAuthorTreeSnapshot(
  snapshot: ReticulumChatAuthorTreeSnapshot
): SerializedReticulumChatAuthorTreeSnapshot {
  return {
    ...snapshot,
    nodeHashes: [...snapshot.nodeHashes.entries()],
    nodeCounts: [...snapshot.nodeCounts.entries()],
  };
}

export function deserializeReticulumChatAuthorTreeSnapshot(
  snapshot: SerializedReticulumChatAuthorTreeSnapshot
): ReticulumChatAuthorTreeSnapshot {
  return {
    ...snapshot,
    nodeHashes: new Map(snapshot.nodeHashes),
    nodeCounts: new Map(snapshot.nodeCounts),
  };
}

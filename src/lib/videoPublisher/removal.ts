/**
 * Removing what an item published. QDN can't erase a resource, so each one
 * is published again as a one-byte marker, "D" (base64 `RA==`), the way the
 * apps delete: qapp-core's deleteResource for Q-Tube, Subscreen and Torq
 * (no title or file name), Q-Share's buildShareRemoval for shares (titled
 * "deleted", files keeping their names). Nodes then drop the old data and
 * the apps treat the item as deleted.
 *
 * Listings go first (a Subscreen title's cast & crew, then a playlist or
 * Torq post, then metadata), the files they point at after them, so a
 * stopped removal never leaves a listing whose video is gone. Step keys come
 * from the identifiers, so a retry with the runner's `completed` skips what
 * was already replaced. A Subscreen person is never replaced: other titles,
 * anyone's, may name them.
 */
import { VideoPublishError } from './errors';
import { QSHARE_METADATA_FILENAME } from './qshare';
import type {
  PublishedRecord,
  PublishedResource,
  PublishStep,
  PublishStepKind,
} from './types';

export const DELETED_DATA64 = 'RA==';
const QSHARE_DELETED = 'deleted';

/** Removal order: lower first. */
const TIER: Record<PublishStepKind, number> = {
  credits: -1,
  post: 0,
  playlist: 0,
  metadata: 1,
  video: 2,
  file: 2,
  thumbnail: 2,
  subtitle: 2,
  // Never removed (left out below).
  person: 3,
};

function qshareMarker(resource: PublishedResource) {
  const filename =
    resource.service === 'DOCUMENT'
      ? QSHARE_METADATA_FILENAME
      : resource.service === 'FILE'
        ? resource.filename || QSHARE_DELETED
        : QSHARE_DELETED;
  return {
    title: QSHARE_DELETED,
    description: QSHARE_DELETED,
    tag1: QSHARE_DELETED,
    filename,
  };
}

export function buildRemovalSteps(
  record: PublishedRecord,
  { key = 'remove' }: { key?: string } = {}
): PublishStep[] {
  // Only the publishing name's own resources can be replaced, and never a
  // person (shared with other titles).
  const seen = new Set<string>();
  const resources = (record?.resources || []).filter((resource) => {
    const id = `${resource.service}:${resource.identifier}`;
    if (resource.kind === 'person') return false;
    if (resource.name !== record.name || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!resources.length) throw new VideoPublishError('nothing-to-remove');

  const ordered = [...resources].sort((a, b) => TIER[a.kind] - TIER[b.kind]);
  const keyOf = (resource: PublishedResource) =>
    `${key}:${resource.service}:${resource.identifier}`;

  return ordered.map((resource) => ({
    key: keyOf(resource),
    kind: resource.kind,
    service: resource.service,
    identifier: resource.identifier,
    ...(record.app === 'qshare' ? qshareMarker(resource) : {}),
    data: { base64: DELETED_DATA64 },
    dependsOn: ordered
      .filter((other) => TIER[other.kind] < TIER[resource.kind])
      .map(keyOf),
    bytes: 1,
  }));
}

import type { ShotDraft } from './ScreenshotsEditor';
import type { ShotsManifest } from './appPageData';
import {
  AppPageError,
  AppRef,
  findAppPageResources,
  shotImageUrl,
  ShotUpload,
} from './appPageQdn';
import { blobBytes } from './blobBytes';

/**
 * The published screenshots as editor items. `version` is the signature of
 * the screenshots they were read from.
 */
export const draftsFromManifest = (
  base: string,
  app: AppRef,
  manifest: ShotsManifest | null,
  version?: string
): ShotDraft[] =>
  (manifest?.shots || []).map((shot) => ({
    id: `existing-${shot.file}`,
    url: shotImageUrl(base, app, shot.file, version),
    caption: shot.caption,
    width: shot.width,
    height: shot.height,
    ...(version ? { readFrom: version } : {}),
  }));

/** Whether the edited list differs from what's published. */
export const shotDraftsChanged = (
  drafts: ShotDraft[],
  manifest: ShotsManifest | null
): boolean => {
  const published = manifest?.shots || [];
  if (drafts.length !== published.length) return true;
  // A new picture has an id of its own; one this Hub just published holds its
  // picture under its file's name (see heldAfterPublish).
  return drafts.some(
    (draft, index) =>
      draft.id !== `existing-${published[index].file}` ||
      draft.caption.trim() !== published[index].caption.trim()
  );
};

/** Whether two editor lists hold the same screenshots, in the same order. */
export const sameShotDrafts = (a: ShotDraft[], b: ShotDraft[]): boolean =>
  a.length === b.length &&
  a.every(
    (draft, index) =>
      draft.id === b[index].id &&
      draft.blob === b[index].blob &&
      draft.caption.trim() === b[index].caption.trim()
  );

/**
 * Before screenshots go out: the ones read back from QDN must still come from
 * the node's current set. Read back by file name from a set replaced since,
 * their captions would go with other pictures. Throws SHOTS_CHANGED when the
 * set was replaced, and SHOTS_UNVERIFIED when the node can't say: its search
 * fails, or it lists none although they were read from one.
 */
export const checkShotsCurrent = async (
  base: string,
  app: AppRef,
  drafts: ShotDraft[] | null
): Promise<void> => {
  const readBack = (drafts || []).filter((draft) => !draft.blob);
  if (!readBack.length) return;
  const resources = await findAppPageResources(base, app).catch(() => null);
  const current = resources?.shots?.signature;
  if (!current || readBack.some((draft) => !draft.readFrom)) {
    throw new AppPageError('SHOTS_UNVERIFIED');
  }
  if (readBack.some((draft) => draft.readFrom !== current)) {
    throw new AppPageError('SHOTS_CHANGED');
  }
};

/**
 * The pictures to publish, reading back the ones already on QDN, once they're
 * known to come from the node's current set (see checkShotsCurrent): checked
 * before reading them, and again after, in case it changed in between.
 */
export const uploadsFromDrafts = async (
  base: string,
  app: AppRef,
  drafts: ShotDraft[],
  fetcher: typeof fetch = fetch
): Promise<ShotUpload[]> => {
  await checkShotsCurrent(base, app, drafts);
  const uploads = await Promise.all(
    drafts.map(async (draft) => {
      let blob = draft.blob;
      if (!blob) {
        const response = await fetcher(draft.url);
        if (!response.ok) throw new AppPageError('SHOT_UNAVAILABLE');
        blob = await response.blob();
      }
      return {
        data: await blobBytes(blob),
        caption: draft.caption,
        width: draft.width,
        height: draft.height,
      };
    })
  );
  await checkShotsCurrent(base, app, drafts);
  return uploads;
};

/**
 * The screenshots `published` just went out as: each holding its picture,
 * named after its new file. The node numbers the files anew, and lists the
 * new set only after the next block, so nothing of it is read back by file
 * name. `move` puts a list edited from `published` onto them, keeping the
 * edits made meanwhile; a picture of the old set left out of the publish is
 * gone from the node, and from the list.
 */
export const heldAfterPublish = (
  published: ShotDraft[],
  uploads: ShotUpload[]
): { held: ShotDraft[]; move: (drafts: ShotDraft[]) => ShotDraft[] } => {
  const held = published.map((draft, index): ShotDraft => {
    const blob =
      draft.blob ||
      new Blob([uploads[index].data as BlobPart], { type: 'image/webp' });
    return {
      id: `existing-${index + 1}.webp`,
      url: draft.blob ? draft.url : URL.createObjectURL(blob),
      caption: draft.caption,
      width: draft.width,
      height: draft.height,
      blob,
    };
  });
  const byId = new Map(
    published.map((draft, index) => [draft.id, held[index]])
  );
  return {
    held,
    move: (drafts) =>
      drafts.flatMap((draft) => {
        const now = byId.get(draft.id);
        if (now) return [{ ...now, caption: draft.caption }];
        return draft.blob ? [draft] : [];
      }),
  };
};

/** A manifest of the screenshots just published, as the node will list it. */
export const manifestOfHeld = (held: ShotDraft[]): ShotsManifest => ({
  shots: held.map((shot) => ({
    file: shot.id.replace(/^existing-/, ''),
    caption: shot.caption,
    ...(shot.width && shot.height
      ? { width: shot.width, height: shot.height }
      : {}),
  })),
  updated: Date.now(),
});

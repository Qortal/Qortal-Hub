import type { ShotDraft } from './ScreenshotsEditor';
import type { ShotsManifest } from './appPageData';
import { AppPageError, AppRef, shotImageUrl, ShotUpload } from './appPageQdn';
import { blobBytes } from './blobBytes';

/** The published screenshots as editor items. */
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
  }));

/** Whether the edited list differs from what's published. */
export const shotDraftsChanged = (
  drafts: ShotDraft[],
  manifest: ShotsManifest | null
): boolean => {
  const published = manifest?.shots || [];
  if (drafts.length !== published.length) return true;
  return drafts.some(
    (draft, index) =>
      !!draft.blob ||
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

/** The pictures to publish, reading back the ones already on QDN. */
export const uploadsFromDrafts = async (
  drafts: ShotDraft[],
  fetcher: typeof fetch = fetch
): Promise<ShotUpload[]> =>
  Promise.all(
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

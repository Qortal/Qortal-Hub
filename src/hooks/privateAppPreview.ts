/** What Core answers for a preview it built: /render/hash/<hash>?secret=<secret>. */
const NODE_PREVIEW_PATH =
  /^\/render\/hash\/[1-9A-HJ-NP-Za-km-z]+\?secret=[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * The address to load a private app's preview at, or null when the node's
 * answer isn't a preview path. Core authorizes the preview it built, so the
 * address needs no API key and gets none: the app can read its own address.
 */
export const privateAppPreviewUrl = (
  base: string,
  nodeAnswer: unknown
): string | null => {
  const previewPath = typeof nodeAnswer === 'string' ? nodeAnswer.trim() : '';
  if (!NODE_PREVIEW_PATH.test(previewPath)) return null;
  return `${base}${previewPath}`;
};

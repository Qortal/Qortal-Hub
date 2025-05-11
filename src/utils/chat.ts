export function buildImageEmbedLink(image?: {
  name?: string;
  identifier?: string;
  service?: string;
  timestamp?: number;
}): string | null {
  if (!image?.name || !image.identifier || !image.service) return null;

  const base = `qortal://use-embed/IMAGE?name=${image.name}&identifier=${image.identifier}&service=${image.service}&mimeType=image%2Fpng&timestamp=${image?.timestamp || ''}`;

  const isEncrypted = image.identifier.startsWith('grp-q-manager_0');
  return isEncrypted ? `${base}&encryptionType=group` : base;
}

export const messageHasImage = (message) => {
  return (
    Array.isArray(message?.images) &&
    message.images[0]?.identifier &&
    message.images[0]?.name &&
    message.images[0]?.service
  );
};

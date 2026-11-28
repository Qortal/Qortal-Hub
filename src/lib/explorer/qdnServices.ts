/**
 * QDN services for the Explorer. An ARBITRARY transaction's JSON carries
 * its service as Core's number (`"service": 800`); other reads answer it as
 * a name (`"service": "DOCUMENT"`). The list is Core's own enum
 * (org.qortal.arbitrary.misc.Service, Core 6.1.4–6.1.9).
 *
 * Private services (Core's `…_PRIVATE` ones, and MAIL) read as "an
 * encrypted resource": never an identifier, a title or anything else that
 * tells what is inside. Encrypted data under a public service can't be told
 * from the transaction, so it reads as that service. Pure: no text (what
 * was published is `explorer:tx.service.<key>`).
 */

/** Core's service numbers and names. */
export const QDN_SERVICES: Readonly<Record<number, string>> = {
  1: 'AUTO_UPDATE',
  100: 'ARBITRARY_DATA',
  120: 'QCHAT_ATTACHMENT',
  121: 'QCHAT_ATTACHMENT_PRIVATE',
  130: 'ATTACHMENT',
  131: 'ATTACHMENT_PRIVATE',
  140: 'FILE',
  141: 'FILE_PRIVATE',
  150: 'FILES',
  160: 'CHAIN_DATA',
  200: 'WEBSITE',
  300: 'GIT_REPOSITORY',
  400: 'IMAGE',
  401: 'IMAGE_PRIVATE',
  410: 'THUMBNAIL',
  420: 'QCHAT_IMAGE',
  500: 'VIDEO',
  501: 'VIDEO_PRIVATE',
  600: 'AUDIO',
  601: 'AUDIO_PRIVATE',
  610: 'QCHAT_AUDIO',
  620: 'QCHAT_VOICE',
  630: 'VOICE',
  631: 'VOICE_PRIVATE',
  640: 'PODCAST',
  700: 'BLOG',
  777: 'BLOG_POST',
  778: 'BLOG_COMMENT',
  800: 'DOCUMENT',
  801: 'DOCUMENT_PRIVATE',
  900: 'LIST',
  910: 'PLAYLIST',
  1000: 'APP',
  1100: 'METADATA',
  1110: 'JSON',
  1200: 'GIF_REPOSITORY',
  1300: 'STORE',
  1310: 'PRODUCT',
  1330: 'OFFER',
  1340: 'COUPON',
  1400: 'CODE',
  1410: 'PLUGIN',
  1420: 'EXTENSION',
  1500: 'GAME',
  1510: 'ITEM',
  1600: 'NFT',
  1700: 'DATABASE',
  1710: 'SNAPSHOT',
  1800: 'COMMENT',
  1810: 'CHAIN_COMMENT',
  1900: 'MAIL',
  1901: 'MAIL_PRIVATE',
  1910: 'MESSAGE',
  1911: 'MESSAGE_PRIVATE',
};

const KNOWN_NAMES: ReadonlySet<string> = new Set(Object.values(QDN_SERVICES));

/**
 * A service's name from a transaction's number (or a numeric string), or a
 * name that is already one. Null when it isn't a service; an unknown
 * number reads "SERVICE_<n>", so a service Core adds still shows something.
 */
export function serviceName(value: unknown): string | null {
  if (
    typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return null;
    return QDN_SERVICES[n] ?? `SERVICE_${n}`;
  }
  if (typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value))
    return value;
  return null;
}

/** Is this a service Core lists (by name)? */
export const isKnownService = (name: string): boolean => KNOWN_NAMES.has(name);

/**
 * Services whose data is encrypted: Core marks every `*_PRIVATE` one as
 * private, and Q-Mail's older MAIL resources are encrypted too.
 */
export function isPrivateService(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.endsWith('_PRIVATE') || name === 'MAIL';
}

/**
 * The key (under `explorer:tx.service`) of what was published, in words:
 * "an app", "a video", "an encrypted resource" (every encrypted service
 * alike), "a QDN resource" for one with no words of its own.
 */
export function serviceWordKey(name: string | null | undefined): string {
  if (isPrivateService(name)) return 'encrypted';
  if (name && isKnownService(name)) return name.toLowerCase();
  return 'unknown';
}

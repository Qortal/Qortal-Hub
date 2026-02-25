import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import i18n from '../i18n/i18n.ts';

/**
 * True if the host is a local/private address (loopback or LAN).
 * Matches electron/src/local-https-cert.ts isLocalPrivateHost logic.
 * Covers: localhost, 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, ::1.
 */
export function isLocalPrivateHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  if (h === 'localhost') return true;
  const parts = h.split('.');
  if (parts.length === 4) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (h === '::1' || h === '[::1]') return true;
  return false;
}

/** True if url is https and its host is local/private (so we need ensureCertForBase). */
export function isLocalPrivateHttpsUrl(url: string | undefined): boolean {
  if (!url || !url.startsWith('https://')) return false;
  try {
    return isLocalPrivateHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const delay = (time: number) =>
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out')), time)
  );

const originalHtml = `<p>---------- Forwarded message ---------</p><p>From: Alex</p><p>Subject: Batteries </p><p>To: Jessica</p><p><br></p><p><br></p>`;

export function updateMessageDetails(
  newFrom: string,
  newSubject: string,
  newTo: string
) {
  let htmlString = originalHtml;

  htmlString = htmlString.replace(
    /<p>From:.*?<\/p>/,
    `<p>From: ${newFrom}</p>`
  );

  htmlString = htmlString.replace(
    /<p>Subject:.*?<\/p>/,
    `<p>Subject: ${newSubject}</p>`
  );

  htmlString = htmlString.replace(/<p>To:.*?<\/p>/, `<p>To: ${newTo}</p>`);

  return htmlString;
}

export const nodeDisplay = (url) => {
  if (isLocalNodeUrl(url)) i18n.t('auth:node.local_label', { defaultValue: 'local node' });
  if (url === HTTPS_EXT_NODE_QORTAL_LINK) i18n.t('auth:node.shared_label', { defaultValue: 'shared node' });
  return url;
};

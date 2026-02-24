import {
  HTTP_LOCALHOST_12391,
  HTTPS_EXT_NODE_QORTAL_LINK,
} from '../constants/constants';
import i18n from '../i18n/i18n.ts';

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
  switch (url) {
    case HTTP_LOCALHOST_12391:
      return i18n.t('auth:node.local_label', { defaultValue: 'local node' });
    case HTTPS_EXT_NODE_QORTAL_LINK:
      return i18n.t('auth:node.shared_label', { defaultValue: 'shared node' });
    default:
      return url;
  }
};

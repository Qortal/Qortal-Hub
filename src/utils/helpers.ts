import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';

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
  if (isLocalNodeUrl(url)) return 'Local';
  if (url === HTTPS_EXT_NODE_QORTAL_LINK) return 'Public';
  return url;
};

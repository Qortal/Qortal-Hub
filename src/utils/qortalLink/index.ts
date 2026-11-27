import { QORTAL_PROTOCOL } from '../../constants/constants';

export function convertQortalLinks(inputHtml: string) {
  // Regular expression to match 'qortal://...' URLs.
  // This will stop at the first whitespace, comma, or HTML tag
  const regex = /(qortal:\/\/[^\s,<]+)/g;

  // Replace matches in inputHtml with formatted anchor tag
  const outputHtml = inputHtml.replace(regex, function (match) {
    return `<a href="${match}" class="qortal-link">${match}</a>`;
  });

  return outputHtml;
}

/**
 * A name, or an identifier, as it goes into a qortal:// link Hub shows or
 * copies. Hub reads a page link, and any link in a page's text, without the
 * `.`, `!` or `)` a sentence leaves after it ("…/Q-Blog," still opens), and a
 * page's text ends a link at a quote. encodeURIComponent leaves those as they
 * are, so a name ending in one lost it, and one with a quote was cut there.
 * So `!'()*` are escaped too, as RFC 3986 asks of a URI component, and a dot
 * at the end; a dot inside, as in "v2.0", stays. Readers decode them back.
 */
export function encodeQortalLinkName(name: string): string {
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`
  );
  let end = encoded.length;
  while (end > 0 && encoded[end - 1] === '.') end -= 1;
  return encoded.slice(0, end) + '%2E'.repeat(encoded.length - end);
}

type QortalResourceLinkInput = {
  service?: string;
  name?: string;
  path?: string;
  identifier?: string;
};

export function buildQortalResourceLink({
  service,
  name,
  path = '',
  identifier,
}: QortalResourceLinkInput): string {
  const encodedName = encodeQortalLinkName(name || '');
  const normalizedPath = path || '';
  const identifierSuffix = identifier
    ? `${normalizedPath.includes('?') ? '&' : '?'}identifier=${encodeQortalLinkName(identifier)}`
    : '';

  return `${QORTAL_PROTOCOL}${service}/${encodedName}${normalizedPath}${identifierSuffix}`;
}

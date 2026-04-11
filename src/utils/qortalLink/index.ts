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
  const encodedName = (name || '').replace(/ /g, '%20');
  const normalizedPath = path || '';
  const identifierSuffix = identifier
    ? `${normalizedPath.includes('?') ? '&' : '?'}identifier=${encodeURIComponent(identifier)}`
    : '';

  return `${QORTAL_PROTOCOL}${service}/${encodedName}${normalizedPath}${identifierSuffix}`;
}

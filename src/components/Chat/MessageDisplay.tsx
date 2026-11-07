import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import './chat.css';
import { executeEvent } from '../../utils/events';
import { openHttpUrlExternally } from '../../utils/openExternalHttp';
import { Embed } from '../Embeds/Embed';
import { Box, IconButton, Tooltip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { ReticulumUserCard } from './ReticulumUserCard';
import type { ReticulumUserCardData } from './ReticulumUserCard';
import { openQortalUseGroupLink } from '../../utils/openQortalUseGroupLink';

const stripTrailingQortalLinkPunctuation = (value: string) =>
  value.replace(/[),.;!?]+$/g, '');

// Decode the name once, after splitting the URI into segments. Decoding the
// whole link would turn escaped route/query delimiters into URL structure.
const decodeQortalName = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    // Retain compatibility with literal percent signs in unescaped names.
    return name;
  }
};

export const extractComponents = (url: string) => {
  if (!url || !url.startsWith(QORTAL_PROTOCOL)) {
    return null;
  }

  // Skip links starting with "qortal://use-"
  if (url.startsWith(QORTAL_PROTOCOL + 'use-')) {
    return null;
  }

  // Remove protocol prefix
  url = url.replace(/^qortal:\/\/?/i, '').trim();

  // If nothing meaningful left (e.g., "qortal://", "qortal:////"), return null
  if (!/[^/]/.test(url)) return null;

  // Case 1: url contains a slash -> already service-based
  if (url.includes('/')) {
    // Identifier is part of QDN resource identity when present. Keep older
    // links without identifier working, and route future reopen flows here.
    const [basePart, queryString = ''] = url.split('?');
    const parts = basePart.split('/');
    const service = parts[0].toUpperCase();
    parts.shift();
    const name = decodeQortalName(parts[0] ?? '');
    parts.shift();

    const params = new URLSearchParams(queryString);
    const identifier = params.get('identifier') || undefined;
    if (identifier) {
      params.delete('identifier');
    }

    const remainingQuery = params.toString();
    const basePath = parts.join('/');
    const path = `${basePath}${remainingQuery ? `?${remainingQuery}` : ''}`;

    return { service, name, identifier, path };
  }

  // Case 2: url is just a username -> default to WEBSITE
  return {
    service: 'WEBSITE',
    name: decodeQortalName(url),
    identifier: undefined,
    path: '',
  };
};

function processText(input) {
  const linkRegex = /(qortal:\/\/\S+)/g;

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = node.textContent.split(linkRegex);
      if (parts.length > 0) {
        const fragment = document.createDocumentFragment();
        parts.forEach((part) => {
          if (part.startsWith(QORTAL_PROTOCOL)) {
            const link = document.createElement('span');
            link.setAttribute('data-url', part);
            link.setAttribute('class', 'qortal-link');
            link.textContent = part;
            fragment.appendChild(link);
          } else {
            fragment.appendChild(document.createTextNode(part));
          }
        });
        node.replaceWith(fragment);
      }
    } else {
      Array.from(node.childNodes).forEach(processNode);
    }
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = input;
  processNode(wrapper);
  return wrapper.innerHTML;
}

const linkify = (text) => {
  if (!text) return '';
  const cleanText = DOMPurify.sanitize(text);
  let textFormatted = cleanText;
  const urlPattern = /(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+)/g;
  textFormatted = cleanText.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${DOMPurify.sanitize(href)}" class="auto-link">${DOMPurify.sanitize(url)}</a>`;
  });
  return processText(textFormatted);
};

const hasCodeBlock = (html) => /<pre[\s>]/i.test(html ?? '');

const normalizeHtmlContent = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
};

type MentionUser = {
  address: string;
  name?: string;
  role?: 'admin' | 'owner';
};

export type ReticulumChannelLinkAccess = {
  groupId: number;
  ready: boolean;
  visibleChannelNameById: ReadonlyMap<string, string>;
};

const parseReticulumChatLinkMentionId = (
  id: string
): { kind: 'group' | 'channel'; groupId: number; channelId: string } | null => {
  const match = id.match(/^reticulum-(group|channel):(\d+):(.+)$/);
  if (!match) return null;
  const groupId = Number(match[2]);
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  try {
    const channelId = decodeURIComponent(match[3]).trim();
    return channelId
      ? { kind: match[1] as 'group' | 'channel', groupId, channelId }
      : null;
  } catch {
    return null;
  }
};

const parseReticulumChatLinkMention = (
  target: HTMLElement
): { groupId: number; channelId: string } | null => {
  const mention = target.closest?.(
    '[data-type="mention"], .mention'
  ) as HTMLElement | null;
  if (!mention) return null;
  const id = String(mention.dataset.id || '').trim();
  return parseReticulumChatLinkMentionId(id);
};

const escapeMentionPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decorateStaticReticulumMentions = (
  document: Document,
  labels: string[],
  privilegedMentionAuthorized?: boolean
): void => {
  const specialLabels =
    privilegedMentionAuthorized === false
      ? ['no-access']
      : ['everyone', 'here', 'no-access'];
  const normalizedLabels = [
    ...new Set(
      [...specialLabels, ...labels]
        .map((label) =>
          String(label || '')
            .trim()
            .replace(/^@/, '')
        )
        .filter(Boolean)
    ),
  ].sort((left, right) => right.length - left.length);
  if (normalizedLabels.length === 0) return;
  const pattern = new RegExp(
    `(^|\\s)@(${normalizedLabels.map(escapeMentionPattern).join('|')})(?=$|[\\s.,!?;:)\\]])`,
    'gi'
  );
  const walker = document.createTreeWalker(document.body, 4);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (
      parent &&
      !parent.closest(
        '[data-type="mention"], .mention, a, code, pre, [data-url]'
      )
    ) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const text = textNode.data;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const leadingSpace = match[1] || '';
      if (index > cursor) fragment.append(text.slice(cursor, index));
      if (leadingSpace) fragment.append(leadingSpace);
      const mention = document.createElement('span');
      const normalizedLabel = match[2].toLowerCase();
      const isSpecial =
        normalizedLabel === 'everyone' ||
        normalizedLabel === 'here' ||
        normalizedLabel === 'no-access';
      mention.className = isSpecial
        ? 'mention'
        : 'mention reticulum-user-mention';
      mention.dataset.type = 'mention';
      mention.dataset.label = match[2];
      mention.textContent = match[2];
      fragment.append(mention);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    textNode.replaceWith(fragment);
  }
};

export const MessageDisplay = ({
  htmlContent,
  hiddenQortalUrls,
  isReply = false,
  mentionedAddresses,
  mentionUsers,
  myAddress,
  privilegedMentionAuthorized,
  reticulumChannelLinkAccess,
  textColor,
  trailingContent,
}: {
  htmlContent: unknown;
  hiddenQortalUrls?: string[];
  isReply?: boolean;
  mentionedAddresses?: string[];
  mentionUsers?: Record<string, MentionUser>;
  myAddress?: string;
  privilegedMentionAuthorized?: boolean;
  reticulumChannelLinkAccess?: ReticulumChannelLinkAccess;
  textColor?: string;
  trailingContent?: ReactNode;
}) => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const contentRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [mentionCard, setMentionCard] = useState<{
    anchorPlacement: 'above' | 'below';
    anchorPosition: { left: number; top: number };
    boundaryHeight: number;
    data: ReticulumUserCardData;
  } | null>(null);
  const safeHtmlContent = useMemo(
    () => normalizeHtmlContent(htmlContent),
    [htmlContent]
  );

  const sanitizedContent = useMemo(() => {
    const sanitized = DOMPurify.sanitize(linkify(safeHtmlContent), {
      ALLOWED_TAGS: [
        'a',
        'b',
        'i',
        'em',
        'strong',
        'p',
        'br',
        'div',
        'span',
        'img',
        'ul',
        'ol',
        'li',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'code',
        'pre',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        's',
        'hr',
      ],
      ALLOWED_ATTR: [
        'href',
        'target',
        'rel',
        'class',
        'src',
        'alt',
        'title',
        'width',
        'height',
        'align',
        'valign',
        'colspan',
        'rowspan',
        'border',
        'cellpadding',
        'cellspacing',
        'data-url',
        'data-id',
        'data-label',
        'data-type',
      ],
    }).replace(
      /<span[^>]*data-url="qortal:\/\/use-embed\/[^"]*"[^>]*>.*?<\/span>/g,
      ''
    );
    if (typeof DOMParser === 'undefined') {
      return sanitized;
    }
    const document = new DOMParser().parseFromString(sanitized, 'text/html');
    const hiddenUrlSet = new Set(
      (hiddenQortalUrls || []).map((url) =>
        stripTrailingQortalLinkPunctuation(url.trim()).toLowerCase()
      )
    );
    if (hiddenUrlSet.size > 0) {
      for (const node of document.querySelectorAll<HTMLElement>(
        'a[href], [data-url]'
      )) {
        const value = stripTrailingQortalLinkPunctuation(
          String(
            node.getAttribute('href') ||
              node.getAttribute('data-url') ||
              node.textContent ||
              ''
          ).trim()
        ).toLowerCase();
        if (hiddenUrlSet.has(value)) node.remove();
      }
      const textWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
      );
      const textNodes: Text[] = [];
      let textNode = textWalker.nextNode();
      while (textNode) {
        if (!textNode.parentElement?.closest('code, pre')) {
          textNodes.push(textNode as Text);
        }
        textNode = textWalker.nextNode();
      }
      for (const node of textNodes) {
        let nextText = node.textContent || '';
        for (const hiddenUrl of hiddenQortalUrls || []) {
          nextText = nextText.split(hiddenUrl).join('');
        }
        if (nextText !== node.textContent) node.textContent = nextText;
      }
      for (const node of document.querySelectorAll<HTMLElement>('p, div')) {
        if (!node.textContent?.trim() && !node.querySelector('img, video')) {
          node.remove();
        }
      }
    }
    const userMentionLabels = new Set<string>();
    for (const [label, user] of Object.entries(mentionUsers || {})) {
      userMentionLabels.add(label.trim().replace(/^@/, '').toLowerCase());
      if (user.address) userMentionLabels.add(user.address.toLowerCase());
      if (user.name) userMentionLabels.add(user.name.trim().toLowerCase());
    }
    if (reticulumChannelLinkAccess) {
      decorateStaticReticulumMentions(
        document,
        Object.keys(mentionUsers || {}),
        privilegedMentionAuthorized
      );
    }
    if (privilegedMentionAuthorized === false) {
      for (const node of document.querySelectorAll<HTMLElement>(
        '[data-type="mention"], .mention'
      )) {
        const id = String(node.dataset.id || '')
          .trim()
          .replace(/^@/, '')
          .toLowerCase();
        const label = String(node.dataset.label || node.textContent || '')
          .trim()
          .replace(/^@/, '')
          .toLowerCase();
        const privilegedToken =
          id === 'everyone' ||
          id === 'here' ||
          label === 'everyone' ||
          label === 'here';
        if (privilegedToken) {
          node.replaceWith(document.createTextNode(`@${label || id}`));
        }
      }
    }
    for (const node of document.querySelectorAll<HTMLElement>(
      '[data-type="mention"], .mention'
    )) {
      const cleanLabel = String(
        node.dataset.label || node.textContent || node.dataset.id || ''
      )
        .trim()
        .replace(/^@/, '');
      if (cleanLabel) {
        node.textContent = cleanLabel;
        node.dataset.label = cleanLabel;
      }
    }
    for (const node of document.querySelectorAll<HTMLElement>(
      '[data-type="mention"][data-id], .mention[data-id]'
    )) {
      const link = parseReticulumChatLinkMentionId(
        String(node.dataset.id || '').trim()
      );
      if (!link) {
        const label = String(
          node.dataset.label || node.dataset.id || node.textContent || ''
        )
          .trim()
          .replace(/^@/, '')
          .toLowerCase();
        if (userMentionLabels.has(label)) {
          node.classList.add('reticulum-user-mention');
        }
        continue;
      }
      const visibleName =
        reticulumChannelLinkAccess?.ready &&
        link.groupId === reticulumChannelLinkAccess.groupId
          ? reticulumChannelLinkAccess.visibleChannelNameById.get(
              link.channelId
            )
          : undefined;
      if (!visibleName) {
        node.textContent = 'no-access';
        node.dataset.label = 'no-access';
        node.removeAttribute('data-id');
        node.classList.remove('reticulum-chat-link');
        continue;
      }
      node.classList.add('reticulum-chat-link');
      if (link.kind === 'group') continue;
      node.textContent = visibleName;
      node.dataset.label = visibleName;
    }
    return document.body.innerHTML;
  }, [
    hiddenQortalUrls,
    mentionUsers,
    privilegedMentionAuthorized,
    reticulumChannelLinkAccess,
    safeHtmlContent,
  ]);

  const mentionUserByLabel = useMemo(() => {
    const map = new Map<string, MentionUser>();
    for (const [label, user] of Object.entries(mentionUsers || {})) {
      const normalizedLabel = label.trim().replace(/^@/, '').toLowerCase();
      if (normalizedLabel && user?.address) map.set(normalizedLabel, user);
      if (user?.address) map.set(user.address.toLowerCase(), user);
      if (user?.name) map.set(user.name.trim().toLowerCase(), user);
    }
    return map;
  }, [mentionUsers]);

  const openMentionCard = useCallback(
    (target: HTMLElement): boolean => {
      if (isReply) return false;
      const mention = target.closest?.(
        '.reticulum-user-mention'
      ) as HTMLElement | null;
      if (!mention) return false;
      const label = String(
        mention.dataset.label || mention.dataset.id || mention.textContent || ''
      )
        .trim()
        .replace(/^@/, '');
      const uniqueMentionedAddresses = [
        ...new Set(
          (mentionedAddresses || [])
            .map((address) => String(address || '').trim())
            .filter(Boolean)
        ),
      ];
      const user =
        mentionUserByLabel.get(label.toLowerCase()) ||
        (uniqueMentionedAddresses.length === 1
          ? { address: uniqueMentionedAddresses[0], name: label }
          : undefined);
      if (!user?.address) return false;
      const mentionRect = mention.getBoundingClientRect();
      const chatViewport = mention.closest(
        '[data-reticulum-chat-scroll-viewport="true"]'
      ) as HTMLElement | null;
      const viewportRect = chatViewport?.getBoundingClientRect();
      const boundary = viewportRect || {
        bottom: window.innerHeight,
        height: window.innerHeight,
        left: 0,
        right: window.innerWidth,
        top: 0,
      };
      const estimatedCardHeight = user.address === myAddress ? 250 : 340;
      const cardWidth = Math.min(
        440,
        Math.max(280, boundary.right - boundary.left - 24)
      );
      const spaceBelow = boundary.bottom - mentionRect.bottom;
      const spaceAbove = mentionRect.top - boundary.top;
      const anchorPlacement =
        spaceBelow >= estimatedCardHeight || spaceBelow >= spaceAbove
          ? 'below'
          : 'above';
      const left = Math.min(
        Math.max(mentionRect.left, boundary.left + 12),
        Math.max(boundary.left + 12, boundary.right - cardWidth - 12)
      );
      setMentionCard({
        anchorPlacement,
        anchorPosition: {
          left: Math.round(left),
          top: Math.round(
            anchorPlacement === 'above' ? mentionRect.top : mentionRect.bottom
          ),
        },
        boundaryHeight: boundary.height,
        data: {
          address: user.address,
          isMinterResolved: false,
          isOwn: user.address === myAddress,
          name: user.name || label,
          role: user.role,
          status: null,
        },
      });
      return true;
    },
    [isReply, mentionUserByLabel, mentionedAddresses, myAddress]
  );

  const handleClickCapture = (e) => {
    if (isReply) {
      const target = e.target as HTMLElement;
      const isLink =
        target.tagName === 'A' ||
        target.getAttribute?.('data-url') ||
        target.closest?.('a') ||
        target.closest?.('.qortal-link') ||
        target.closest?.('[data-url]');
      if (isLink) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  const handleClick = async (e) => {
    if (isReply) {
      e.preventDefault();
      const target = e.target;
      const isLink =
        target.tagName === 'A' ||
        target.getAttribute?.('data-url') ||
        target.closest?.('a') ||
        target.closest?.('.qortal-link') ||
        target.closest?.('[data-url]');
      if (isLink) {
        e.stopPropagation();
        return;
      }
      return;
    }
    e.preventDefault();

    const target = e.target as HTMLElement;
    const reticulumChatLink = parseReticulumChatLinkMention(target);
    if (reticulumChatLink) {
      e.stopPropagation();
      executeEvent('openGroupMessage', {
        channelId: reticulumChatLink.channelId,
        from: reticulumChatLink.groupId,
      });
      return;
    }
    if (openMentionCard(target)) {
      e.stopPropagation();
      return;
    }
    if (target.closest?.('[data-type="mention"], .mention')) {
      e.stopPropagation();
      return;
    }
    if (target.tagName === 'A') {
      openHttpUrlExternally(target.getAttribute('href'));
    } else if (target.getAttribute('data-url')) {
      const url = target.getAttribute('data-url');

      try {
        if (await openQortalUseGroupLink(url)) return;
      } catch (error) {
        console.log(error);
      }

      const res = extractComponents(url);
      if (res) {
        const { service, name, identifier, path } = res;
        executeEvent('addTab', { data: { service, name, identifier, path } });
        executeEvent('open-apps-mode', {});
      }
    }
  };

  const embedLink = safeHtmlContent.match(/qortal:\/\/use-embed\/[^\s<>]+/);

  let embedData = null;

  if (embedLink) {
    embedData = embedLink[0];
  }

  const showCopyButton = hasCodeBlock(sanitizedContent) && !isReply;

  const handleCopyCode = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = contentRef.current;
    if (!container) return;
    const preEls = container.querySelectorAll('.tiptap pre');
    if (!preEls.length) return;
    const text = Array.from(preEls)
      .map((el) => el.textContent?.trim() ?? '')
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Copy failed', err);
    }
  }, []);

  return (
    <Box
      sx={{
        '--text-primary': theme.palette.text.primary,
        '--text-secondary': theme.palette.text.secondary,
        '--background-default': theme.palette.background.default,
        '--background-secondary': theme.palette.background.paper,
        '--code-block-bg': theme.palette.background.paper,
        '--code-block-accent': theme.palette.primary.main,
        '--code-block-border': theme.palette.divider,
        '--primary-main':
          theme.palette.mode === 'light'
            ? theme.palette.primary.dark
            : theme.palette.primary.main,
        ...(textColor ? { '--text-primary': textColor } : {}),
        '& .tiptap:not(.isReply) [data-type="mention"], & .tiptap:not(.isReply) .mention':
          {
            cursor: 'default',
          },
        '& .tiptap:not(.isReply) [data-type="mention"].reticulum-chat-link, & .tiptap:not(.isReply) .mention.reticulum-chat-link':
          {
            cursor: 'pointer',
          },
        '& .tiptap:not(.isReply) .reticulum-user-mention': {
          cursor: 'pointer',
        },
      }}
    >
      {embedLink && <Embed embedLink={embedData} />}
      <Box
        ref={contentRef}
        sx={{
          position: 'relative',
          ...(trailingContent
            ? {
                display: 'inline',
                '& > .tiptap': {
                  display: 'inline',
                  width: 'auto',
                },
                '& > .tiptap > p:last-child': {
                  display: 'inline',
                },
              }
            : {}),
          '&:hover .message-copy-code-btn': { opacity: 1 },
        }}
      >
        <div
          className={`tiptap ${isReply ? 'isReply' : ''}`}
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          onClick={handleClick}
          onClickCapture={handleClickCapture}
        />
        {trailingContent}
        {showCopyButton && (
          <Tooltip
            title={
              copied
                ? t('core:action.copied', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:action.copy_code', {
                    postProcess: 'capitalizeFirstChar',
                  })
            }
            leaveDelay={0}
          >
            <IconButton
              className="message-copy-code-btn"
              size="small"
              onClick={handleCopyCode}
              sx={{
                position: 'absolute',
                top: 4,
                right: 4,
                opacity: 0,
                transition: 'opacity 0.15s ease',
                backgroundColor: theme.palette.background.paper,
                color: theme.palette.text.secondary,
                '&:hover': {
                  backgroundColor: theme.palette.background.default,
                  color: theme.palette.text.primary,
                },
              }}
              aria-label={
                copied
                  ? t('core:action.copied', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:action.copy_code', {
                      postProcess: 'capitalizeFirstChar',
                    })
              }
            >
              <ContentCopyIcon sx={{ fontSize: '18px' }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {mentionCard && (
        <ReticulumUserCard
          anchorEl={null}
          anchorPlacement={mentionCard.anchorPlacement}
          anchorPosition={mentionCard.anchorPosition}
          boundaryHeight={mentionCard.boundaryHeight}
          data={mentionCard.data}
          onClose={() => setMentionCard(null)}
        />
      )}
    </Box>
  );
};

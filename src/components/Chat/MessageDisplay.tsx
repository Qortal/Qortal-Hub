import { useCallback, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import './chat.css';
import { executeEvent } from '../../utils/events';
import { Embed } from '../Embeds/Embed';
import { Box, IconButton, Tooltip, useTheme } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { QORTAL_PROTOCOL } from '../../constants/constants';

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

  // Case 1: url contains a slash → already service-based
  if (url.includes('/')) {
    const parts = url.split('/');
    const service = parts[0].toUpperCase();
    parts.shift();
    const name = parts[0];
    parts.shift();
    let identifier;
    const path = parts.join('/');
    return { service, name, identifier, path };
  }

  // Case 2: url is just a username → default to WEBSITE
  return {
    service: 'WEBSITE',
    name: url,
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
            link.style.cursor = 'pointer';
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
  if (!text) return ''; // Return an empty string if text is null or undefined
  let textFormatted = text;
  const urlPattern = /(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+)/g;
  textFormatted = text.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${DOMPurify.sanitize(href)}" class="auto-link">${DOMPurify.sanitize(url)}</a>`;
  });
  return processText(textFormatted);
};

const hasCodeBlock = (html) => /<pre[\s>]/i.test(html ?? '');

export const MessageDisplay = ({ htmlContent, isReply = false }) => {
  const theme = useTheme();
  const contentRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const sanitizedContent = useMemo(() => {
    return DOMPurify.sanitize(linkify(htmlContent), {
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
        'style',
        'align',
        'valign',
        'colspan',
        'rowspan',
        'border',
        'cellpadding',
        'cellspacing',
        'data-url',
      ],
    }).replace(
      /<span[^>]*data-url="qortal:\/\/use-embed\/[^"]*"[^>]*>.*?<\/span>/g,
      ''
    );
  }, [htmlContent]);

  const handleClickCapture = (e) => {
    if (isReply) {
      const target = e.target;
      const isLink = target.tagName === 'A' || target.getAttribute?.('data-url') || target.closest?.('a') || target.closest?.('.qortal-link') || target.closest?.('[data-url]');
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
      const isLink = target.tagName === 'A' || target.getAttribute?.('data-url') || target.closest?.('a') || target.closest?.('.qortal-link') || target.closest?.('[data-url]');
      if (isLink) {
        e.stopPropagation();
        return;
      }
      return;
    }
    e.preventDefault();

    const target = e.target;
    if (target.tagName === 'A') {
      const href = target.getAttribute('href');
      if (window?.electronAPI) {
        window.electronAPI.openExternal(href);
      } else {
        window.open(href, '_system');
      }
    } else if (target.getAttribute('data-url')) {
      const url = target.getAttribute('data-url');

      let copyUrl = url;

      try {
        copyUrl = copyUrl.replace(/^(qortal:\/\/)/, '');
        if (copyUrl.startsWith('use-')) {
          // Handle the new 'use' format
          const parts = copyUrl.split('/');
          parts.shift();
          const action = parts.length > 0 ? parts[0].split('-')[1] : null; // e.g., 'invite' from 'action-invite'
          parts.shift();
          const id = parts.length > 0 ? parts[0].split('-')[1] : null; // e.g., '321' from 'groupid-321'
          if (action === 'join') {
            executeEvent('globalActionJoinGroup', { groupId: id });
            return;
          }
        }
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

  const embedLink = htmlContent?.match(/qortal:\/\/use-embed\/[^\s<>]+/);

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
        '--primary-main': theme.palette.primary.main,
      }}
    >
      {embedLink && <Embed embedLink={embedData} />}
      <Box
        ref={contentRef}
        sx={{
          position: 'relative',
          '&:hover .message-copy-code-btn': { opacity: 1 },
        }}
      >
        <div
          className={`tiptap ${isReply ? 'isReply' : ''}`}
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          onClick={handleClick}
          onClickCapture={handleClickCapture}
        />
        {showCopyButton && (
          <Tooltip title={copied ? 'Copied!' : 'Copy code'} leaveDelay={0}>
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
              aria-label={copied ? 'Copied!' : 'Copy code'}
            >
              <ContentCopyIcon sx={{ fontSize: '18px' }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
};

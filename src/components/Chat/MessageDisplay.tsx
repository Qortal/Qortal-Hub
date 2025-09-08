import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import './chat.css';
import { executeEvent } from '../../utils/events';
import { Embed } from '../Embeds/Embed';
import { Box, useTheme } from '@mui/material';
import { QORTAL_PROTOCOL } from '../../constants/constants';

export const extractComponents = (url) => {
  if (!url || !url.startsWith(QORTAL_PROTOCOL)) {
    return null;
  }

  // Skip links starting with "qortal://use-"
  if (url.startsWith(QORTAL_PROTOCOL + 'use-')) {
    return null;
  }

  url = url.replace(/^(qortal:\/\/)/, '');
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

  return null;
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
            link.textContent = part;
            link.style.color = 'var(--code-block-text-color)';
            link.style.textDecoration = 'underline';
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

export const MessageDisplay = ({ htmlContent, isReply = false }) => {
  const theme = useTheme();

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

  const handleClick = async (e) => {
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

  return (
    <Box
      sx={{
        '--text-primary': theme.palette.text.primary,
        '--text-secondary': theme.palette.text.secondary,
        '--background-default': theme.palette.background.default,
        '--background-secondary': theme.palette.background.paper,
      }}
    >
      {embedLink && <Embed embedLink={embedData} />}
      <div
        className={`tiptap ${isReply ? 'isReply' : ''}`}
        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        onClick={handleClick}
      />
    </Box>
  );
};

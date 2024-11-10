import React, { useEffect } from 'react';
import DOMPurify from 'dompurify';
import './styles.css';
import { executeEvent } from '../../utils/events';

const extractComponents = (url) => {
  console.log('url', url);
  if (!url.startsWith("qortal://")) {
    return null;
  }

  url = url.replace(/^(qortal\:\/\/)/, "");
  if (url.includes("/")) {
    let parts = url.split("/");
    const service = parts[0].toUpperCase();
    parts.shift();
    const name = parts[0];
    parts.shift();
    let identifier;
    const path = parts.join("/");
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
          if (part.startsWith('qortal://')) {
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

export const MessageDisplay = ({ htmlContent, isReply }) => {
  const linkify = (text) => {
    let textFormatted = text;
    const urlPattern = /(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+)/g;
    textFormatted = text.replace(urlPattern, (url) => {
      const href = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${DOMPurify.sanitize(href)}" class="auto-link">${DOMPurify.sanitize(url)}</a>`;
    });
    return processText(textFormatted);
  };

  const sanitizedContent = DOMPurify.sanitize(linkify(htmlContent), {
    ALLOWED_TAGS: [
      'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span', 'img', 
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'class', 'src', 'alt', 'title', 
      'width', 'height', 'style', 'align', 'valign', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'data-url'
    ],
  });

  const handleClick = async (e) => {
    e.preventDefault();

    const target = e.target;
    if (target.tagName === 'A') {
      const href = target.getAttribute('href');
      window.electronAPI.openExternal(href);
    } else if (target.getAttribute('data-url')) {
      const url = target.getAttribute('data-url');
      const res = extractComponents(url);
      if (res) {
        const { service, name, identifier, path } = res;
        executeEvent("addTab", { data: { service, name, identifier, path } });
        executeEvent("open-dev-mode", { });

      }
    }
  };

  return (
    <div
      className={`tiptap ${isReply ? 'isReply' : ''}`}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
      onClick={handleClick}
    />
  );
};

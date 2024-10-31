import React, { useEffect } from 'react';
import DOMPurify from 'dompurify';
import './styles.css'; // Ensure this CSS file is imported
import { Browser } from '@capacitor/browser';

export const MessageDisplay = ({ htmlContent , isReply}) => {

  const linkify = (text) => {
    // Regular expression to find URLs starting with https://, http://, or www.
    const urlPattern = /(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+)/g;

    // Replace plain text URLs with anchor tags
    return text?.replace(urlPattern, (url) => {
      const href = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${href}" class="auto-link">${DOMPurify.sanitize(url)}</a>`;
    });
  };

  // Sanitize and linkify the content
  const sanitizedContent = DOMPurify.sanitize(linkify(htmlContent), {
    ALLOWED_TAGS: [
      'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span', 'img', 
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: [
      'href', 'target', 'rel', 'class', 'src', 'alt', 'title', 
      'width', 'height', 'style', 'align', 'valign', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing'
  ],
  });

  // Function to handle link clicks
  const handleClick = async (e) => {
    e.preventDefault();

    // Ensure we are targeting an <a> element
    const target = e.target.closest('a');
    if (target) {
      const href = target.getAttribute('href');
      window.electronAPI.openExternal(href);
    } else {
      console.error('No <a> tag found or href is null.');
    }
  };
  return (
    <div
    className={`tiptap ${isReply ? 'isReply' : ''}`}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
      onClick={(e) => {
        // Delegate click handling to the parent div
        if (e.target.tagName === 'A') {
          handleClick(e);
        }
      }}
    />
  );
};


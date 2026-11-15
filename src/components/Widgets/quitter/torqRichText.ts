/**
 * TipTap document ⇄ Torq post text.
 *
 * Torq stores `text` as plain pre-wrap (what Quitter shows) and, only when
 * bold/italic/underline/lists are used, `richText` as HTML limited to
 * b/i/u/ul/ol/li/br/p (Torq's sanitizer). Torq renders `<p>` blocks with a
 * paragraph gap, and one Enter in the editor is one paragraph, so paragraphs
 * become `\n\n` in `text`.
 */

/** Escapes &, <, > and " for HTML text. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export type TorqDocNode = {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
  content?: TorqDocNode[];
};

type TorqPostBody = {
  text: string;
  /** Present only when the post has formatting. */
  richText?: string;
};

const MARK_TAGS: [string, string][] = [
  ['bold', 'b'],
  ['italic', 'i'],
  ['underline', 'u'],
];

function inlineHtml(nodes: TorqDocNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>';
      if (node.type !== 'text') return '';
      const markTypes = new Set((node.marks || []).map((mark) => mark.type));
      const tags = MARK_TAGS.filter(([mark]) => markTypes.has(mark)).map(
        ([, tag]) => tag
      );
      const open = tags.map((tag) => `<${tag}>`).join('');
      const close = [...tags]
        .reverse()
        .map((tag) => `</${tag}>`)
        .join('');
      return `${open}${escapeHtml(node.text || '')}${close}`;
    })
    .join('');
}

function inlineText(nodes: TorqDocNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '\n';
      return node.type === 'text' ? node.text || '' : '';
    })
    .join('');
}

function listItemsHtml(list: TorqDocNode): string {
  return (list.content || [])
    .map((item) => {
      const parts = (item.content || []).map((child) =>
        child.type === 'paragraph'
          ? inlineHtml(child.content)
          : blockHtml(child)
      );
      return `<li>${parts.filter(Boolean).join('<br>')}</li>`;
    })
    .join('');
}

function blockHtml(node: TorqDocNode): string {
  if (node.type === 'paragraph') {
    return `<p>${inlineHtml(node.content) || '<br>'}</p>`;
  }
  if (node.type === 'bulletList') {
    return `<ul data-list="disc">${listItemsHtml(node)}</ul>`;
  }
  if (node.type === 'orderedList') {
    return `<ol>${listItemsHtml(node)}</ol>`;
  }
  return '';
}

function listText(list: TorqDocNode, depth: number): string {
  const ordered = list.type === 'orderedList';
  const indent = '  '.repeat(depth);
  return (list.content || [])
    .map((item, index) => {
      const prefix = `${indent}${ordered ? `${index + 1}. ` : '• '}`;
      const lines: string[] = [];
      for (const child of item.content || []) {
        if (child.type === 'paragraph') {
          lines.push(inlineText(child.content));
        } else if (
          child.type === 'bulletList' ||
          child.type === 'orderedList'
        ) {
          lines.push(listText(child, depth + 1));
        }
      }
      const [first = '', ...rest] = lines;
      return [`${prefix}${first}`, ...rest].join('\n');
    })
    .join('\n');
}

function hasFormatting(nodes: TorqDocNode[] = []): boolean {
  return nodes.some((node) => {
    if (node.type === 'bulletList' || node.type === 'orderedList') return true;
    if (
      node.type === 'text' &&
      (node.marks || []).some((mark) =>
        MARK_TAGS.some(([type]) => type === mark.type)
      )
    ) {
      return true;
    }
    return hasFormatting(node.content);
  });
}

export function torqDocToPostBody(
  doc: TorqDocNode | null | undefined
): TorqPostBody {
  const blocks = doc?.content || [];
  const text = blocks
    .map((block) => {
      if (block.type === 'paragraph') return inlineText(block.content);
      if (block.type === 'bulletList' || block.type === 'orderedList') {
        return listText(block, 0);
      }
      return '';
    })
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text || !hasFormatting(blocks)) return { text };

  const richText = blocks
    .map(blockHtml)
    .join('')
    // Leading/trailing empty paragraphs are only editor padding.
    .replace(/^(<p><br><\/p>)+/, '')
    .replace(/(<p><br><\/p>)+$/, '');
  return { text, richText };
}

/** Plain text → document: blank lines split paragraphs. */
export function plainTextToTorqDoc(text: string): TorqDocNode {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!normalized) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: normalized.split(/\n{2,}/).map((paragraph) => {
      const content: TorqDocNode[] = [];
      paragraph.split('\n').forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
      });
      return content.length
        ? { type: 'paragraph', content }
        : { type: 'paragraph' };
    }),
  };
}

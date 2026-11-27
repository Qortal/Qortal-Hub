import { getSchema } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { DOMSerializer, Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';

const RETICULUM_MESSAGE_HTML_CACHE_LIMIT = 2_000;
const RETICULUM_MESSAGE_EXTENSIONS = [
  StarterKit,
  Underline,
  Highlight,
  Mention,
  TextStyle,
];

let reticulumMessageSchema: ReturnType<typeof getSchema> | null = null;
let reticulumMessageSerializer: DOMSerializer | null = null;
let reticulumSerializationDocument: Document | null = null;
const reticulumMessageHtmlCache = new Map<string, string>();

function getReticulumMessageSerializer(): {
  schema: ReturnType<typeof getSchema>;
  serializer: DOMSerializer;
  serializationDocument: Document;
} {
  if (!reticulumMessageSchema) {
    reticulumMessageSchema = getSchema(RETICULUM_MESSAGE_EXTENSIONS);
    reticulumMessageSerializer = DOMSerializer.fromSchema(
      reticulumMessageSchema
    );
  }
  if (!reticulumSerializationDocument) {
    reticulumSerializationDocument =
      document.implementation.createHTMLDocument();
  }
  return {
    schema: reticulumMessageSchema,
    serializer: reticulumMessageSerializer!,
    serializationDocument: reticulumSerializationDocument,
  };
}

function cacheReticulumMessageHtml(key: string, html: string): void {
  if (reticulumMessageHtmlCache.has(key)) {
    reticulumMessageHtmlCache.delete(key);
  }
  reticulumMessageHtmlCache.set(key, html);
  if (reticulumMessageHtmlCache.size <= RETICULUM_MESSAGE_HTML_CACHE_LIMIT) {
    return;
  }
  const oldestKey = reticulumMessageHtmlCache.keys().next().value;
  if (typeof oldestKey === 'string')
    reticulumMessageHtmlCache.delete(oldestKey);
}

export function normalizeReticulumChatHtmlContent(raw: unknown): string {
  if (raw == null) return '<p></p>';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : '<p></p>';
  }
  if (typeof raw !== 'object') return '<p></p>';

  try {
    const doc = raw as { type?: string; content?: unknown };
    if (doc.type !== 'doc' || !Array.isArray(doc.content)) return '<p></p>';
    const cacheKey = JSON.stringify(doc);
    const cached = reticulumMessageHtmlCache.get(cacheKey);
    if (cached !== undefined) {
      // Refresh insertion order so frequently revisited channels stay hot.
      reticulumMessageHtmlCache.delete(cacheKey);
      reticulumMessageHtmlCache.set(cacheKey, cached);
      return cached;
    }

    const { schema, serializer, serializationDocument } =
      getReticulumMessageSerializer();
    const contentNode = ProseMirrorNode.fromJSON(schema, doc);
    const fragment = serializer.serializeFragment(contentNode.content, {
      document: serializationDocument,
    });
    const container = serializationDocument.createElement('div');
    container.appendChild(fragment);
    const html = container.innerHTML || '<p></p>';
    cacheReticulumMessageHtml(cacheKey, html);
    return html;
  } catch {
    return '<p></p>';
  }
}

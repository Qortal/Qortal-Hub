// Browser-only transport code, shared by the shell and the bundled sandboxed
// guest preload. Never import Node or Electron APIs here.
import {
  QAPP_FILE_MAX_FILES,
  QAPP_FILE_REQUEST_BYTES,
} from './qapp-file-protocol';

export type QAppRequest = {
  documentId: string;
  requestId: number;
  data: any;
};
type FileDescription = {
  reference: object;
  size: number;
  type: string;
  name?: string;
  lastModified?: number;
};
// Preserve structured-clone containers, cycles and shared references. Binary
// references are identified by object identity in the same IPC message, never by
// magic properties that could collide with an application's own data.
export function mapQAppGraph(
  value: any,
  replace: (value: object) => any,
  seen = new Map()
) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const replacement = replace(value);
  if (replacement !== value) {
    seen.set(value, replacement);
    return replacement;
  }
  const tag = Object.prototype.toString.call(value);
  let output: any;
  if (Array.isArray(value)) output = new Array(value.length);
  else if (tag === '[object Map]') output = new Map();
  else if (tag === '[object Set]') output = new Set();
  else if (tag === '[object Object]') output = {};
  else return value; // ArrayBuffer, typed arrays, Date, RegExp, etc.
  seen.set(value, output);
  if (tag === '[object Map]') {
    for (const [key, item] of value)
      output.set(
        mapQAppGraph(key, replace, seen),
        mapQAppGraph(item, replace, seen)
      );
  } else if (tag === '[object Set]') {
    for (const item of value) output.add(mapQAppGraph(item, replace, seen));
  } else {
    for (const key of Object.keys(value)) {
      Object.defineProperty(output, key, {
        value: mapQAppGraph(value[key], replace, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return output;
}

export function prepareQAppRequest(data: any) {
  const blobs: Blob[] = [];
  const files: FileDescription[] = [];
  let total = 0;
  const encoded = mapQAppGraph(data, (value) => {
    if (!(value instanceof Blob)) return value;
    total += value.size;
    if (total > QAPP_FILE_REQUEST_BYTES || files.length >= QAPP_FILE_MAX_FILES)
      throw new Error('QAPP_BRIDGE_ERROR');
    const reference = {};
    files.push({
      reference,
      size: value.size,
      type: value.type,
      ...(value instanceof File
        ? { name: value.name, lastModified: value.lastModified }
        : {}),
    });
    blobs.push(value);
    return reference;
  });
  return { data: files.length ? encoded : data, files, blobs };
}

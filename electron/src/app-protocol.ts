import { promises as fs } from 'fs';
import { extname, join, normalize, resolve, sep } from 'path';
import type { Session } from 'electron';
import { AUDIO_SURFACE_ENTRY_PATH } from './audio-window-policy';
import { log as loggerLog } from './logger';

export async function registerStaticAppProtocol(
  electronSession: Session,
  scheme: string,
  directory: string
): Promise<void> {
  if (electronSession.protocol.isProtocolHandled(scheme)) {
    electronSession.protocol.unhandle(scheme);
  }
  electronSession.protocol.handle(scheme, async (request) =>
    buildProtocolResponse(request, directory)
  );
}

async function buildProtocolResponse(
  request: Request,
  directory: string
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const indexPath = join(directory, 'index.html');
  const filePath = resolveProtocolPath(directory, requestUrl.pathname);
  const fileExtension = extname(filePath);
  const resolvedPath = await getExistingFilePath(filePath);
  const shouldFallbackToIndex =
    !resolvedPath &&
    (!fileExtension || fileExtension === '.html' || fileExtension === '.asar');
  const finalPath = resolvedPath ?? (shouldFallbackToIndex ? indexPath : null);

  if (!finalPath) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const data = await fs.readFile(finalPath);
  const headers = new Headers(
    Object.entries(protocolHeadersForPath(requestUrl.pathname)).map(
      ([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]
    )
  );
  headers.set('content-type', mimeTypeForPath(finalPath));
  if (shouldTraceAudioSurfaceIsolationAsset(requestUrl.pathname)) {
    loggerLog('[GCall:audio-surface][protocol] response', {
      url: request.url,
      pathname: requestUrl.pathname,
      referrer: request.referrer,
      destination: request.destination,
      mode: request.mode,
      contentType: headers.get('content-type'),
      coop: headers.get('Cross-Origin-Opener-Policy'),
      coep: headers.get('Cross-Origin-Embedder-Policy'),
      corp: headers.get('Cross-Origin-Resource-Policy'),
    });
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers,
  });
}

function resolveProtocolPath(directory: string, requestPathname: string): string {
  const decodedPath = decodeURIComponent(requestPathname);
  const sanitizedRelative = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = resolve(directory, `.${sep}${sanitizedRelative}`);
  const normalizedDirectory = ensureTrailingSep(resolve(directory));
  if (!ensureTrailingSep(resolved).startsWith(normalizedDirectory)) {
    return resolve(directory, 'index.html');
  }
  return resolved;
}

async function getExistingFilePath(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) return filePath;
    if (stat.isDirectory()) {
      return getExistingFilePath(join(filePath, 'index.html'));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function protocolHeadersForPath(
  requestPathname: string
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  if (requestPathname === AUDIO_SURFACE_ENTRY_PATH) {
    headers['Cross-Origin-Opener-Policy'] = ['same-origin'];
    headers['Cross-Origin-Embedder-Policy'] = ['require-corp'];
    headers['Cross-Origin-Resource-Policy'] = ['same-origin'];
    return headers;
  }
  if (isEmbedderCriticalAsset(requestPathname)) {
    headers['Cross-Origin-Embedder-Policy'] = ['require-corp'];
    headers['Cross-Origin-Resource-Policy'] = ['same-origin'];
  }
  return headers;
}

function isEmbedderCriticalAsset(requestPathname: string): boolean {
  return (
    (requestPathname.startsWith('/assets/') &&
      /\.(?:js|mjs|cjs|css|wasm)$/i.test(requestPathname)) ||
    /^\/registerSW\.js$/i.test(requestPathname) ||
    /^\/manifest\.webmanifest$/i.test(requestPathname)
  );
}

function shouldTraceAudioSurfaceIsolationAsset(requestPathname: string): boolean {
  return (
    requestPathname === AUDIO_SURFACE_ENTRY_PATH ||
    /\/assets\/.*\.(?:js|mjs|cjs|css|wasm)$/i.test(requestPathname) ||
    /\/(?:registerSW\.js|manifest\.webmanifest)$/i.test(requestPathname) ||
    /\/assets\/(?:audio-decrypt\.worker|gcall-audio-encode\.worker|gcall-opus-fec\.worker|group-playout-processor|gcall-jitter-scheduler).*?\.(?:js|mjs|cjs|wasm)$/i.test(
      requestPathname
    )
  );
}

function mimeTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function ensureTrailingSep(value: string): string {
  return value.endsWith(sep) ? value : `${value}${sep}`;
}

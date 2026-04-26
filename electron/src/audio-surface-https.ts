import https from 'https';
import { promises as fs } from 'fs';
import { extname, join, normalize, resolve, sep } from 'path';
import { generate as generateCert } from 'selfsigned';
import { AUDIO_SURFACE_ENTRY_PATH } from './audio-window-policy';
import { log as loggerLog } from './logger';
import { trustPinnedCertificateForHost } from './local-https-cert';

const AUDIO_SURFACE_HTTPS_BASE_PORT = 56000;

let audioSurfaceInstanceIndex = 0;
let audioSurfaceServer:
  | {
      host: string;
      origin: string;
      port: number;
      server: https.Server;
    }
  | null = null;
let audioSurfaceServerReady: Promise<string> | null = null;

export function setAudioSurfaceHttpsInstanceIndex(index: number): void {
  audioSurfaceInstanceIndex = Math.max(0, Math.trunc(index));
}

export function getAudioSurfaceHttpsHost(): string {
  return `audio-surface-${audioSurfaceInstanceIndex}.localhost`;
}

export function getAudioSurfaceHttpsPort(): number {
  return AUDIO_SURFACE_HTTPS_BASE_PORT + audioSurfaceInstanceIndex;
}

export function getAudioSurfaceHttpsOrigin(): string {
  return `https://${getAudioSurfaceHttpsHost()}:${getAudioSurfaceHttpsPort()}`;
}

export async function ensureAudioSurfaceHttpsServer(
  directory: string
): Promise<string> {
  if (audioSurfaceServer) {
    return audioSurfaceServer.origin;
  }
  if (audioSurfaceServerReady) {
    return audioSurfaceServerReady;
  }

  const host = getAudioSurfaceHttpsHost();
  const port = getAudioSurfaceHttpsPort();
  const origin = getAudioSurfaceHttpsOrigin();

  audioSurfaceServerReady = new Promise<string>(async (resolvePromise, rejectPromise) => {
    try {
      const notAfterDate = new Date();
      notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
      const pems = await generateCert(
        [{ name: 'commonName', value: host }],
        {
          algorithm: 'sha256',
          keySize: 2048,
          notAfterDate,
          extensions: [
            { name: 'basicConstraints', cA: false },
            {
              name: 'keyUsage',
              digitalSignature: true,
              keyEncipherment: true,
            },
            {
              name: 'subjectAltName',
              altNames: [
                { type: 2, value: host },
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
              ],
            },
          ],
        }
      );

      trustPinnedCertificateForHost(host, pems.cert);

      const server = https.createServer(
        {
          key: pems.private,
          cert: pems.cert,
        },
        async (req, res) => {
          try {
            const requestUrl = new URL(req.url || '/', origin);
            const result = await buildStaticResponse(
              requestUrl.pathname,
              directory
            );
            if (shouldTraceAudioSurfaceIsolationAsset(requestUrl.pathname)) {
              loggerLog('[GCall:audio-surface][https] response', {
                url: requestUrl.toString(),
                pathname: requestUrl.pathname,
                contentType: result.contentType,
                coop: result.headers['Cross-Origin-Opener-Policy'] ?? null,
                coep: result.headers['Cross-Origin-Embedder-Policy'] ?? null,
                corp: result.headers['Cross-Origin-Resource-Policy'] ?? null,
              });
            }
            res.writeHead(result.status, {
              ...result.headers,
              'content-type': result.contentType,
            });
            res.end(result.body);
          } catch {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Internal Server Error');
          }
        }
      );

      server.once('error', (error) => {
        audioSurfaceServerReady = null;
        rejectPromise(error);
      });
      server.listen(port, '127.0.0.1', () => {
        audioSurfaceServer = { host, origin, port, server };
        loggerLog('[GCall:audio-surface][https] listening', {
          host,
          origin,
          port,
        });
        resolvePromise(origin);
      });
    } catch (error) {
      audioSurfaceServerReady = null;
      rejectPromise(error);
    }
  });

  return audioSurfaceServerReady;
}

async function buildStaticResponse(
  requestPathname: string,
  directory: string
): Promise<{
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: Uint8Array | string;
}> {
  const indexPath = join(directory, 'index.html');
  const filePath = resolveStaticPath(directory, requestPathname);
  const fileExtension = extname(filePath);
  const resolvedPath = await getExistingFilePath(filePath);
  const shouldFallbackToIndex =
    !resolvedPath &&
    (!fileExtension || fileExtension === '.html' || fileExtension === '.asar');
  const finalPath = resolvedPath ?? (shouldFallbackToIndex ? indexPath : null);

  if (!finalPath) {
    return {
      status: 404,
      headers: {},
      contentType: 'text/plain; charset=utf-8',
      body: 'Not Found',
    };
  }

  const data = await fs.readFile(finalPath);
  return {
    status: 200,
    headers: staticHeadersForPath(requestPathname),
    contentType: mimeTypeForPath(finalPath),
    body: new Uint8Array(data),
  };
}

function resolveStaticPath(directory: string, requestPathname: string): string {
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

function staticHeadersForPath(
  requestPathname: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (requestPathname === AUDIO_SURFACE_ENTRY_PATH) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
    return headers;
  }
  if (isEmbedderCriticalAsset(requestPathname)) {
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
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
    /\/assets\/(?:audio-decrypt\.worker|gcall-opus-fec\.worker|group-playout-processor|gcall-jitter-scheduler).*?\.(?:js|mjs|cjs|wasm)$/i.test(
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

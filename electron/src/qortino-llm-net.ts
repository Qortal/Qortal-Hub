/**
 * One HTTP request through a session's network stack (its certificate
 * checks and proxy settings), stopping at a redirect instead of following
 * it: the hop fetchKeepingKeyOnOrigin needs. Electron's session.fetch can't
 * do this ("manual" only cancels the redirect), so it uses net.request.
 */
import { net, type Session } from 'electron';
import { Readable } from 'stream';
import type { DownloadHop } from './qortino-llm-files';

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

export function sessionHop(session: Session): DownloadHop {
  return (url, headers, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const request = net.request({
        url,
        method: 'GET',
        session,
        redirect: 'manual',
        useSessionCookies: false,
        cache: 'no-store',
      });
      for (const [name, value] of Object.entries(headers)) {
        request.setHeader(name, value);
      }
      let settled = false;
      const onAbort = () => {
        request.abort();
        if (!settled) {
          settled = true;
          reject(abortError());
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => signal.removeEventListener('abort', onAbort);

      request.on('redirect', (_status, _method, redirectUrl) => {
        // Not followed here: the caller decides what goes with the next hop.
        request.abort();
        done();
        if (!settled) {
          settled = true;
          resolve({ redirect: redirectUrl });
        }
      });
      request.on('response', (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          responseHeaders.set(
            name,
            Array.isArray(value) ? value.join(', ') : String(value)
          );
        }
        // The body's own end (or an abort, which errors it) ends the watch.
        incoming.on('end', done);
        incoming.on('error', done);
        const body = Readable.toWeb(
          incoming as unknown as Readable
        ) as unknown as ReadableStream<Uint8Array>;
        if (settled) return;
        settled = true;
        try {
          // Statuses with no body (204, 205, 304) take none.
          const noBody = [204, 205, 304].includes(incoming.statusCode);
          resolve({
            response: new Response(noBody ? null : body, {
              status: incoming.statusCode,
              headers: responseHeaders,
            }),
          });
        } catch (error) {
          done();
          request.abort();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      request.on('error', (error) => {
        done();
        if (!settled) {
          settled = true;
          reject(signal.aborted ? abortError() : error);
        }
      });
      request.end();
    });
}

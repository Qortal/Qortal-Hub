import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { URL } from 'url';

interface EncryptionConfig {
  key: Buffer;
  iv: Buffer;
  resourceUrl: string;
  totalSize: number;
  mimeType: string;
}

// Store encryption configs temporarily
const encryptionConfigs = new Map<string, EncryptionConfig>();

// Helper: Parse JSON body
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJSON(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  });
  res.end(JSON.stringify(data));
}

// Helper: Derive CTR counter
function deriveCtrCounter(iv: Buffer, blockOffset: bigint): Buffer {
  const counter = Buffer.from(iv);
  let carry = blockOffset;

  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }

  return counter;
}

// Helper: Decrypt chunk
function decryptChunk(
  keyBuffer: Buffer,
  ivBuffer: Buffer,
  blockOffset: bigint,
  encryptedData: Buffer
): Buffer {
  const counter = deriveCtrCounter(ivBuffer, blockOffset);
  const decipher = crypto.createDecipheriv('aes-256-ctr', keyBuffer, counter);
  decipher.setAutoPadding(false);

  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

// Helper: Fetch data with range support
function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        Range: `bytes=${start}-${end}`,
      },
    };

    const req = client.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode === 206 || res.statusCode === 200) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// Route handlers
type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  videoId?: string
) => Promise<void>;

const routes: Record<string, RouteHandler> = {
  // POST /api/video/register
  'POST /api/video/register': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { videoId, key, iv, resourceUrl, totalSize, mimeType } = body;

      if (!videoId || !key || !iv || !resourceUrl || !totalSize) {
        return sendJSON(res, 400, {
          error:
            'Missing required fields: videoId, key, iv, resourceUrl, totalSize',
        });
      }

      const keyBuffer = Buffer.from(key);
      const ivBuffer = Buffer.from(iv);

      if (keyBuffer.length !== 32) {
        return sendJSON(res, 400, { error: 'Key must be 32 bytes' });
      }
      if (ivBuffer.length !== 16) {
        return sendJSON(res, 400, { error: 'IV must be 16 bytes' });
      }

      encryptionConfigs.set(videoId, {
        key: keyBuffer,
        iv: ivBuffer,
        resourceUrl,
        totalSize,
        mimeType: mimeType || 'video/mp4',
      });

      console.log(`[Register] Video registered: ${videoId}`);
      sendJSON(res, 200, { success: true, videoId });
    } catch (error) {
      console.error('[Register] Error:', error);
      sendJSON(res, 500, { error: 'Registration failed' });
    }
  },

  // DELETE /api/video/:videoId
  'DELETE /api/video': async (req, res, videoId) => {
    const existed = encryptionConfigs.has(videoId!);
    encryptionConfigs.delete(videoId!);

    console.log(
      `[Cleanup] Video unregistered: ${videoId} (existed: ${existed})`
    );
    sendJSON(res, 200, { success: true, existed });
  },

  // GET /api/video/:videoId/stream
  'GET /api/video/stream': async (req, res, videoId) => {
    const config = encryptionConfigs.get(videoId!);

    if (!config) {
      console.error(`[Stream] Video config not found: ${videoId}`);
      return sendJSON(res, 404, { error: 'Video config not found' });
    }

    const { key, iv, resourceUrl, totalSize, mimeType } = config;
    const range = req.headers.range;

    try {
      let start = 0;
      let end = totalSize - 1;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      }

      // Fetch encrypted data
      const encryptedData = await fetchRange(resourceUrl, start, end);

      // Decrypt
      const blockOffset = BigInt(start >> 4);
      const decryptedData = decryptChunk(key, iv, blockOffset, encryptedData);

      // Send response
      const statusCode = range ? 206 : 200;
      const headers: http.OutgoingHttpHeaders = {
        'Content-Type': mimeType,
        'Content-Length': decryptedData.length,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Cache-Control': 'no-cache',
      };

      if (range) {
        headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
      }

      res.writeHead(statusCode, headers);
      res.end(decryptedData);
    } catch (error) {
      console.error('[Stream] Error:', error);
      if (!res.headersSent) {
        sendJSON(res, 500, { error: 'Streaming failed' });
      }
    }
  },

  // GET /api/health
  'GET /api/health': async (req, res) => {
    sendJSON(res, 200, {
      status: 'ok',
      activeVideos: encryptionConfigs.size,
      uptime: process.uptime(),
    });
  },
};

let server: http.Server | null = null;
let serverPort: number | null = null;

export function startVideoServer(port: number = 57000): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log(`Video server already running on port ${serverPort}`);
      resolve(serverPort!);
      return;
    }

    // Main request handler
    server = http.createServer(async (req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Range',
        });
        res.end();
        return;
      }

      const url = new URL(req.url!, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Route matching
      if (req.method === 'POST' && pathname === '/api/video/register') {
        await routes['POST /api/video/register'](req, res);
      } else if (
        req.method === 'DELETE' &&
        pathname.startsWith('/api/video/')
      ) {
        const videoId = pathname.split('/')[3];
        await routes['DELETE /api/video'](req, res, videoId);
      } else if (req.method === 'GET' && pathname.includes('/stream')) {
        const videoId = pathname.split('/')[3];
        await routes['GET /api/video/stream'](req, res, videoId);
      } else if (req.method === 'GET' && pathname === '/api/health') {
        await routes['GET /api/health'](req, res);
      } else {
        sendJSON(res, 404, { error: 'Not found' });
      }
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, trying ${port + 1}`);
        // Try next port
        server = null;
        startVideoServer(port + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      serverPort = port;
      console.log(`Video decryption proxy server running on port ${port}`);
      console.log(`Health check: http://localhost:${port}/api/health`);
      resolve(port);
    });
  });
}

export function stopVideoServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log('Video server stopped');
      server = null;
      serverPort = null;
      encryptionConfigs.clear();
      resolve();
    });
  });
}

export function getVideoServerPort(): number | null {
  return serverPort;
}

export function isVideoServerRunning(): boolean {
  return server !== null && serverPort !== null;
}

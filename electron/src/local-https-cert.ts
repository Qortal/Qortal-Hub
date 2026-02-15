import crypto from 'crypto';
import path from 'path';
import { app, type Session } from 'electron';
import fs from 'fs';

const DEBUG_CERT = true;
function certLog(...args: unknown[]) {
  if (DEBUG_CERT) console.log('[local-https-cert]', ...args);
}

/**
 * Store trusted CA PEM per hostname.
 * This lets you be dynamic (user can switch nodes) without overwriting globals.
 */
const trustedCaByHost = new Map<string, string>();

/**
 * Block HTTPS to local node until ensureCertForBase has run (avoids Chromium caching a reject).
 * Set true after first successful ensureCertForBase in this session.
 */
let localNodeHttpsReady = false;

export function setLocalNodeHttpsReady(ready: boolean): void {
  localNodeHttpsReady = ready;
  certLog('localNodeHttpsReady=', ready);
}

export function isLocalNodeHttpsReady(): boolean {
  return localNodeHttpsReady;
}

const PERSISTED_CA_FILENAME = 'qortal-local-node-ca.pem';

function getPersistedCaPath(): string {
  return path.join(app.getPath('userData'), PERSISTED_CA_FILENAME);
}

/** Normalize PEM for consistent storage and comparison (trim, single \\n line endings). */
function normalizePem(pem: string): string {
  return pem.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Persist CA to disk so we can load it before first request on next startup. */
function persistCaForHost(hostname: string, caPem: string): void {
  if (hostname !== '127.0.0.1') return;
  try {
    const normalized = normalizePem(caPem);
    const filePath = getPersistedCaPath();
    fs.writeFileSync(filePath, normalized, 'utf-8');
    const fp = sha256FingerprintFromPem(normalized);
    certLog('persisted CA to', filePath, 'len=', normalized.length, 'start=', normalized.slice(0, 80), 'fp=', fp.slice(0, 24) + '...');
  } catch (e) {
    certLog('persist CA failed', e);
  }
}

/** True if the local node CA has already been persisted (so we can skip reload on subsequent ensureCertForBase). */
export function persistedLocalNodeCaExists(): boolean {
  return fs.existsSync(getPersistedCaPath());
}

/** Read persisted CA PEM from disk if it exists; otherwise null. Uses same normalize as load so comparison is consistent. */
function readPersistedCaPem(): string | null {
  try {
    const filePath = getPersistedCaPath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const caPem = normalizePem(raw);
    return caPem || null;
  } catch {
    return null;
  }
}

/** Load persisted local node CA into trustedCaByHost. Call before first window load. */
export function loadPersistedLocalNodeCa(): void {
  try {
    const filePath = getPersistedCaPath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const caPem = normalizePem(raw);
    if (!caPem) return;
    trustedCaByHost.set('127.0.0.1', caPem);
    trustedCaByHost.set('localhost', caPem);
    const fp = sha256FingerprintFromPem(caPem);
    certLog('loaded persisted CA path=', filePath, 'len=', caPem.length, 'start=', caPem.slice(0, 80), 'fp=', fp.slice(0, 24) + '...');
  } catch {
    /* ignore */
  }
}

/** Treat localhost and 127.0.0.1 as the same “local node” bucket. */
function normalizeHost(hostname: string): string {
  if (hostname === 'localhost') return '127.0.0.1';
  return hostname;
}

/**
 * True if the host is a local/private address (loopback or LAN, not routable to the public internet).
 * Covers: localhost, 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, ::1.
 */
function isLocalPrivateHost(host: string): boolean {
  const h = host.toLowerCase().trim();
  if (h === 'localhost') return true;
  const parts = h.split('.');
  if (parts.length === 4) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  }
  if (h === '::1' || h === '[::1]') return true; // IPv6 loopback
  return false;
}

/**
 * Normalize fingerprint to hex for comparison.
 * Node's X509Certificate.fingerprint is hex; Electron's Certificate.fingerprint is "sha256/<base64>".
 */
function fingerprintToHex(fp: string): string {
  if (!fp) return '';
  const s = fp.trim();
  if (s.startsWith('sha256/')) {
    try {
      const b64 = s.slice(7).replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('hex').toLowerCase();
    } catch {
      return s.replace(/:/g, '').toLowerCase();
    }
  }
  return s.replace(/:/g, '').toLowerCase();
}

/** Compute SHA-256 fingerprint (hex) from PEM. Use when fingerprint256 is not available. */
function sha256FingerprintFromPem(pem: string): string {
  try {
    const m = pem.match(
      /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/
    );
    if (!m) return '';
    const der = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
    return crypto.createHash('sha256').update(der).digest('hex').toLowerCase();
  } catch {
    return '';
  }
}

/** Split PEM string into individual cert PEM blocks. */
function splitPem(pem: string): string[] {
  const blocks: string[] = [];
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pem)) !== null) blocks.push(m[0].trim());
  return blocks;
}

/**
 * From a PEM that may contain multiple certs, choose a likely CA cert.
 * Prefer a cert that Node marks as CA (when available), otherwise fall back.
 */
function extractCaPem(pem: string): string {
  const blocks = splitPem(pem);
  certLog('extractCaPem: found', blocks.length, 'cert(s)');
  if (blocks.length === 0) return pem.trim();
  if (blocks.length === 1) return blocks[0];

  // Prefer blocks that are marked as CA (Node >= v18+ typically exposes .ca)
  for (const block of blocks) {
    try {
      const x = new crypto.X509Certificate(block) as crypto.X509Certificate & {
        ca?: boolean;
      };
      if (x.ca === true) {
        certLog('extractCaPem: using x.ca === true');
        return block;
      }
    } catch {
      /* ignore */
    }
  }

  // Next: look for self-signed as a heuristic
  for (const block of blocks) {
    try {
      const x = new crypto.X509Certificate(block);
      if (x.checkIssued(x)) {
        certLog('extractCaPem: using self-signed cert');
        return block;
      }
    } catch {
      /* ignore */
    }
  }

  // Last resort: assume last is root
  certLog('extractCaPem: fallback to last cert');
  return blocks[blocks.length - 1];
}

/**
 * Install certificate verification on the given session (e.g. mainWindow.webContents.session).
 * - For hosts we have a stored CA for: verify leaf cert is issued by that CA and matches host
 * - For all other hosts: delegate to Chromium (do NOT break normal HTTPS)
 *
 * Call this after the BrowserWindow is created.
 *
 * Note: Electron docs say callback(0) accepts and callback(-2) rejects. :contentReference[oaicite:1]{index=1}
 * Localized docs also describe callback(-3) to use Chromium's verification result. :contentReference[oaicite:2]{index=2}
 */
// Match all HTTPS; we filter to local/private hosts in the callback (match patterns cannot express CIDR).
const LOCAL_NODE_HTTPS_FILTER_URLS = ['https://*/*'];

/**
 * Block HTTPS requests to local/private hosts (127.x, localhost, 10.x, 192.168.x, 172.16–31.x, ::1)
 * until setLocalNodeHttpsReady(true) is called. Prevents any such request from reaching the TLS layer
 * before ensureCertForBase has run, so Chromium never caches a certificate rejection.
 * Call on the same session(s) as installCertificateVerification.
 */
export function installLocalNodeHttpsBlock(session: Session): void {
  session.webRequest.onBeforeRequest(
    { urls: LOCAL_NODE_HTTPS_FILTER_URLS },
    (details, callback) => {
      let hostname: string;
      try {
        hostname = new URL(details.url).hostname;
      } catch {
        callback({});
        return;
      }
      if (!isLocalPrivateHost(hostname)) {
        callback({});
        return;
      }
      if (!localNodeHttpsReady) {
        certLog('blocked HTTPS to local/private host (not ready)', hostname, details.url);
        callback({ cancel: true });
      } else {
        callback({});
      }
    }
  );
  certLog('installLocalNodeHttpsBlock: installed (local/private hosts only)');
}

export function installCertificateVerification(session: Session): void {
  certLog('installCertificateVerification: proc installed');

  session.setCertificateVerifyProc((request, callback) => {
    const hostname = normalizeHost(request.hostname);
    certLog('verify proc called hostname=', hostname);

    const caPem = trustedCaByHost.get(hostname);

    if (!caPem) {
      certLog('no CA for host, delegating -3');
      callback(-3);
      return;
    }

    const storedCa = new crypto.X509Certificate(caPem);
    // Must use SHA-256 to match Electron's "sha256/<base64>"; fallback to computing from PEM if fingerprint256 missing
    const storedFp =
      fingerprintToHex(
        (storedCa as crypto.X509Certificate & { fingerprint256?: string })
          .fingerprint256 ?? ''
      ) || sha256FingerprintFromPem(caPem);
    const storedFpFromPem = sha256FingerprintFromPem(caPem);
    certLog('storedFp len=', storedFp.length, 'storedFpFromPem len=', storedFpFromPem.length, 'same=', storedFp === storedFpFromPem);
    certLog('stored PEM start=', caPem.trim().slice(0, 120), '...');

    // (1) Verify leaf (server cert) is signed by our stored CA
    let leafVerified = false;
    if (request.certificate?.data) {
      try {
        const leafX509 = new crypto.X509Certificate(request.certificate.data);
        leafVerified = leafX509.verify(storedCa.publicKey);
        certLog('leaf verify(storedCa.publicKey)=', leafVerified);
        if (leafVerified) {
          certLog('leaf signed by stored CA, accept');
          callback(0);
          return;
        }
      } catch (e) {
        certLog('leaf verify threw', e);
      }
    }

    // (2) Walk the chain: accept if any cert matches our CA fingerprint (Electron uses sha256/base64, Node uses hex)
    let cert: typeof request.certificate | undefined = request.certificate;
    let topCert: typeof request.certificate | undefined;
    let chainIndex = 0;
    while (cert) {
      topCert = cert;
      const certFp = fingerprintToHex(cert.fingerprint ?? '');
      const certFpFromPem = cert.data ? sha256FingerprintFromPem(cert.data) : '';
      const match = certFp && certFp === storedFp;
      const matchFromPem = certFpFromPem && certFpFromPem === storedFpFromPem;
      certLog(
        'chain i=',
        chainIndex,
        'subject=',
        cert.subjectName,
        'electronFp=',
        (cert.fingerprint ?? '').slice(0, 50),
        'fpFromPem=',
        certFpFromPem.slice(0, 16),
        'match=',
        match,
        'matchFromPem=',
        matchFromPem
      );
      if (cert.data) {
        const chainPemNorm = normalizePem(cert.data);
        const chainFp = sha256FingerprintFromPem(chainPemNorm);
        certLog('chain cert we compare: i=', chainIndex, 'len=', chainPemNorm.length, 'start=', chainPemNorm.slice(0, 80), 'fp=', chainFp.slice(0, 24) + '...');
      }
      chainIndex++;
      if (match || matchFromPem) {
        certLog('chain match fingerprint');
        callback(0);
        return;
      }
      cert = cert.issuerCert;
    }

    // (3) Top of chain signed by our stored CA (server may not send root)
    let topVerified = false;
    if (topCert?.data) {
      try {
        certLog('top PEM len=', topCert.data.length, 'stored PEM len=', caPem.trim().length, 'top start=', topCert.data.trim().slice(0, 80));
        const topX509 = new crypto.X509Certificate(topCert.data);
        topVerified = topX509.verify(storedCa.publicKey);
        certLog('top verify(storedCa.publicKey)=', topVerified);
        if (topVerified) {
          certLog('top cert issued by stored CA, accept');
          callback(0);
          return;
        }
      } catch (e) {
        certLog('top verify threw', e);
      }
    }

    certLog(
      'reject: leaf=',
      leafVerified,
      'top=',
      topVerified,
      'storedFp=',
      storedFp.slice(0, 24),
      'storedFpFromPem=',
      storedFpFromPem.slice(0, 24)
    );
    callback(-2);
  });
}

/**
 * Ensure we have a CA for the given HTTPS base.
 * Fetches /admin/http/getca over HTTP; if missing, POSTs /admin/http/createca then getca again.
 * Compares with persisted CA by fingerprint; returns caChanged when GET differs from cache (or no cache).
 *
 * IMPORTANT: With the CA-based model, call this BEFORE the first HTTPS navigation to that host,
 * because Electron/Chromium may cache verification results. :contentReference[oaicite:8]{index=8}
 */
export async function ensureCertForBase(
  baseUrl: string
): Promise<{ success: boolean; caChanged?: boolean; error?: string }> {
  try {
    certLog('ensureCertForBase start baseUrl=', baseUrl);
    const url = new URL(baseUrl);

    const hostname = normalizeHost(url.hostname);

    // Read persisted CA fingerprint for comparison (same normalization as load/persist).
    const persistedPem = readPersistedCaPem();
    const persistedFp =
      persistedPem !== null ? sha256FingerprintFromPem(persistedPem) : null;

    // Your existing assumption: admin HTTP API is on same port as https URL.
    // (If Qortal differs, split this into explicit httpsPort/httpPort.)
    const port = url.port || '443';
    const httpBase = `http://${hostname}:${port}`;

    let caPem: string | null = null;

    certLog('ensureCertForBase httpBase=', httpBase, 'fetching getca');
    const getcaRes = await fetch(`${httpBase}/admin/http/getca`, {
      method: 'GET',
      headers: { accept: 'text/plain' },
    });

    if (getcaRes.ok) {
      const text = (await getcaRes.text()).trim();
      if (text) caPem = text;
    }

    if (!caPem) {
      certLog('ensureCertForBase no CA yet, calling createca');
      const createRes = await fetch(`${httpBase}/admin/http/createca`, {
        method: 'POST',
        headers: { accept: 'text/plain' },
        body: '',
      });
      if (!createRes.ok) {
        return {
          success: false,
          error: `createca failed: ${createRes.status}`,
        };
      }

      const createText = (await createRes.text()).trim();
      if (
        !createText.includes('CA and server certificate created successfully')
      ) {
        return { success: false, error: `createca response: ${createText}` };
      }

      const getcaRes2 = await fetch(`${httpBase}/admin/http/getca`, {
        method: 'GET',
        headers: { accept: 'text/plain' },
      });
      if (!getcaRes2.ok) {
        return { success: false, error: 'getca after createca failed' };
      }

      const text2 = (await getcaRes2.text()).trim();
      if (!text2) {
        return { success: false, error: 'getca returned empty' };
      }
      caPem = text2;
    }

    const extracted = extractCaPem(caPem);
    const caPemToStore = normalizePem(extracted);
    const getFp = sha256FingerprintFromPem(caPemToStore);

    // caChanged: no persisted CA, or persisted fingerprint differs from GET (CA changed or first run).
    const caChanged =
      persistedFp === null || persistedFp !== getFp;
    if (persistedFp !== null) {
      certLog(
        'ensureCertForBase cache vs GET: persistedFp=',
        persistedFp.slice(0, 24) + '...',
        'getFp=',
        getFp.slice(0, 24) + '...',
        'caChanged=',
        caChanged
      );
    } else {
      certLog('ensureCertForBase no persisted CA, caChanged=', caChanged);
    }

    // Store for both localhost and 127.0.0.1 to avoid mismatch pain.
    trustedCaByHost.set(hostname, caPemToStore);
    if (hostname === '127.0.0.1') {
      trustedCaByHost.set('localhost', caPemToStore);
      persistCaForHost(hostname, caPemToStore);
    }

    certLog('ensureCertForBase done, stored CA for host=', hostname);
    return { success: true, caChanged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    certLog('ensureCertForBase error', message);
    return { success: false, error: message };
  }
}

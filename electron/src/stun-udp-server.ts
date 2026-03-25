/**
 * Minimal RFC 5389 STUN Binding server (UDP).
 * - Walks attribute TLVs on requests; ignores unknown types (incl. FINGERPRINT).
 * - Rate limits: ingress packets/sec, per-IP packets/sec, global responses/sec.
 */

import * as dgram from 'dgram';
import { log as loggerLog, error as loggerError } from './logger';

const STUN_MAGIC = 0x2112a442;
const STUN_HEADER_LEN = 20;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;

/** Max UDP datagrams accepted per second before parse (CPU DoS). */
const MAX_INGRESS_PER_SEC = 4000;
/** Max datagrams per source IP per second (ingress). */
const MAX_INGRESS_PER_IP_PER_SEC = 120;
/** Max Binding success responses per second globally (amplification bound). */
const MAX_RESPONSES_GLOBAL_PER_SEC = 200;
/** Max Binding responses per source IP per second. */
const MAX_RESPONSES_PER_IP_PER_SEC = 40;

function slidingAllow(
  map: Map<string, { count: number; windowStart: number }>,
  key: string,
  maxPerWindow: number,
  windowMs: number,
  now: number
): boolean {
  let e = map.get(key);
  if (!e || now - e.windowStart >= windowMs) {
    e = { count: 1, windowStart: now };
    map.set(key, e);
    return true;
  }
  if (e.count >= maxPerWindow) return false;
  e.count++;
  return true;
}

function isBindingRequest(msgType: number): boolean {
  return (msgType & 0x3fff) === BINDING_REQUEST;
}

function parseXorMappedAddress(
  rinfo: dgram.RemoteInfo,
  txId: Buffer
): Buffer {
  const family = 0x01;
  const port = rinfo.port;
  const xport = port ^ ((STUN_MAGIC >> 16) & 0xffff);
  const host = rinfo.address;
  const parts = host.split('.');
  let ip = 0;
  if (parts.length === 4) {
    for (const p of parts) {
      ip = (ip << 8) + (parseInt(p, 10) & 0xff);
    }
  }
  const xip = ip ^ STUN_MAGIC;
  const attrLen = 8;
  const attr = Buffer.alloc(4 + attrLen);
  attr.writeUInt16BE(ATTR_XOR_MAPPED_ADDRESS, 0);
  attr.writeUInt16BE(attrLen, 2);
  attr.writeUInt8(0, 4);
  attr.writeUInt8(family, 5);
  attr.writeUInt16BE(xport, 6);
  attr.writeUInt32BE(xip >>> 0, 8);
  const len = attr.length;
  const buf = Buffer.alloc(STUN_HEADER_LEN + len);
  buf.writeUInt16BE(BINDING_SUCCESS, 0);
  buf.writeUInt16BE(len, 2);
  buf.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(buf, 8);
  attr.copy(buf, 20);
  return buf;
}

export class StunUdpServer {
  private socket: dgram.Socket | null = null;
  private readonly port: number;
  private ingressGlobal = { count: 0, windowStart: 0 };
  private ingressByIp = new Map<string, { count: number; windowStart: number }>();
  private responseGlobal = { count: 0, windowStart: 0 };
  private responseByIp = new Map<string, { count: number; windowStart: number }>();

  constructor(port: number) {
    this.port = port;
  }

  /**
   * Bind UDP socket. Resolves false if port is in use (another hub instance) or bind fails.
   * Resolves true when listening; message handler is attached only on success.
   */
  tryBind(): Promise<boolean> {
    if (this.socket) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const s = dgram.createSocket('udp4');
      let settled = false;

      const onBindError = (err: NodeJS.ErrnoException): void => {
        if (settled) {
          loggerError('[STUN-UDP] socket error:', err);
          return;
        }
        settled = true;
        s.removeAllListeners();
        try {
          s.close();
        } catch {
          /* ignore */
        }
        if (err.code === 'EADDRINUSE') {
          loggerLog(
            `[STUN-UDP] port ${this.port} in use — another hub instance serves STUN on this machine`
          );
        } else {
          loggerError('[STUN-UDP] bind failed:', err);
        }
        resolve(false);
      };

      s.once('error', onBindError);
      s.once('listening', () => {
        if (settled) return;
        settled = true;
        s.off('error', onBindError);
        s.on('error', (err) => {
          loggerError('[STUN-UDP] socket error:', err);
        });
        this.socket = s;
        s.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        loggerLog(`[STUN-UDP] listening on UDP ${this.port}`);
        resolve(true);
      });

      s.bind(this.port, '0.0.0.0');
    });
  }

  stop(): void {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  private allowIngressGlobal(now: number): boolean {
    const w = 1000;
    if (now - this.ingressGlobal.windowStart >= w) {
      this.ingressGlobal = { count: 1, windowStart: now };
      return true;
    }
    if (this.ingressGlobal.count >= MAX_INGRESS_PER_SEC) return false;
    this.ingressGlobal.count++;
    return true;
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const now = Date.now();
    if (!this.allowIngressGlobal(now)) return;
    const ipKey = rinfo.address;
    if (!slidingAllow(this.ingressByIp, ipKey, MAX_INGRESS_PER_IP_PER_SEC, 1000, now)) {
      return;
    }

    if (msg.length < STUN_HEADER_LEN) return;
    const msgType = msg.readUInt16BE(0);
    const msgLen = msg.readUInt16BE(2);
    const cookie = msg.readUInt32BE(4);
    if (cookie !== STUN_MAGIC) return;
    if (!isBindingRequest(msgType)) return;
    if (msg.length < STUN_HEADER_LEN + msgLen) return;

    const txId = msg.subarray(8, 20);
    let off = STUN_HEADER_LEN;
    const end = STUN_HEADER_LEN + msgLen;
    while (off + 4 <= end) {
      const alen = msg.readUInt16BE(off + 2);
      const padded = ((alen + 3) >> 2) << 2;
      off += 4 + padded;
    }

    if (!this.allowResponseGlobal(now)) return;
    if (!slidingAllow(this.responseByIp, ipKey, MAX_RESPONSES_PER_IP_PER_SEC, 1000, now)) {
      return;
    }

    const out = parseXorMappedAddress(rinfo, txId);
    this.socket?.send(out, rinfo.port, rinfo.address, () => {
      /* ignore */
    });
  }

  private allowResponseGlobal(now: number): boolean {
    const w = 1000;
    if (now - this.responseGlobal.windowStart >= w) {
      this.responseGlobal = { count: 1, windowStart: now };
      return true;
    }
    if (this.responseGlobal.count >= MAX_RESPONSES_GLOBAL_PER_SEC) return false;
    this.responseGlobal.count++;
    return true;
  }
}

/**
 * Outbound STUN Binding probe (RFC 5389) over UDP.
 */

import * as dgram from 'dgram';
import * as crypto from 'crypto';

const STUN_MAGIC = 0x2112a442;
const STUN_HEADER_LEN = 20;
const BINDING_REQUEST = 0x0001;

export function sendStunBindingProbe(
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; rttMs?: number }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const txId = crypto.randomBytes(12);
    const buf = Buffer.alloc(STUN_HEADER_LEN);
    buf.writeUInt16BE(BINDING_REQUEST, 0);
    buf.writeUInt16BE(0, 2);
    buf.writeUInt32BE(STUN_MAGIC, 4);
    txId.copy(buf, 8);

    const started = Date.now();
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false });
    }, timeoutMs);

    socket.on('message', (msg) => {
      if (msg.length < STUN_HEADER_LEN) return;
      if (!txId.equals(msg.subarray(8, 20))) return;
      const typ = msg.readUInt16BE(0);
      if ((typ & 0x3fff) !== 0x0101) return;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: true, rttMs: Date.now() - started });
    });

    socket.on('error', () => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false });
    });

    socket.bind(0, () => {
      socket.send(buf, port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          resolve({ ok: false });
        }
      });
    });
  });
}

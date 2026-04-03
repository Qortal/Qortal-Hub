/**
 * Single source of truth for Reticulum JSON wire size before/after Python injects `r`.
 * Must match `presence_bridge.py` `_call_wire_json_bytes` + `out["r"] = destination_hash_hex(...)`.
 */

/**
 * The Python bridge injects `r` (local hub destination hash hex) — 32 bytes → 64 hex chars.
 * Measure frames with the same length so pre-send size matches wire_bytes in
 * presence_bridge.py. Stay under RNS.Packet.ENCRYPTED_MDU (~383); `handle_send_*`
 * compares `len(wire_bytes)` to that MDU (not 350).
 */
export const RT_RETICULUM_MAX_WIRE_JSON_BYTES = 378;

const BRIDGE_SENDER_HASH_PLACEHOLDER = '0'.repeat(64);
const OVERLAY_MESSAGE_ID_PLACEHOLDER = 'overlay000000';

/**
 * UTF-8 byte length of JSON after Python adds `r` (same width as real destination hash hex).
 */
export function byteLengthUtf8JsonWithBridgeSender(
  obj: Record<string, unknown>
): number {
  return Buffer.byteLength(
    JSON.stringify({
      ...obj,
      r: BRIDGE_SENDER_HASH_PLACEHOLDER,
      X: OVERLAY_MESSAGE_ID_PLACEHOLDER,
      L: 0,
    }),
    'utf8'
  );
}

export function byteLengthUtf8JsonWithBridgeSenderAndTarget(
  obj: Record<string, unknown>,
  targetAddress: string
): number {
  return Buffer.byteLength(
    JSON.stringify({
      ...obj,
      r: BRIDGE_SENDER_HASH_PLACEHOLDER,
      X: OVERLAY_MESSAGE_ID_PLACEHOLDER,
      L: 0,
      U: targetAddress,
    }),
    'utf8'
  );
}

export function wireFitsReticulum(obj: Record<string, unknown>): boolean {
  return byteLengthUtf8JsonWithBridgeSender(obj) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES;
}

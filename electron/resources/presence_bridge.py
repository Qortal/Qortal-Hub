#!/usr/bin/env python3

import argparse
import base64
import hashlib
import json
import math
import os
from collections import deque
import queue
import shutil
import sys
import threading
import time
import traceback
import uuid
from typing import IO, Any, Dict, Optional, Set, Tuple

import RNS

APP_NAMESPACE = "qortal-hub"
PRESENCE_ASPECT = "presence"
PRESENCE_VERSION = "v1"
IDENTITY_FILENAME = "presence-bridge.identity"

_state_lock = threading.RLock()
_reticulum = None
_identity = None
_destination = None
_announce_handler = None
_known_peers: Dict[str, Any] = {}
_candidate_peers: Dict[str, Dict[str, Any]] = {}
_verified_overlay_peers: Dict[str, Dict[str, Any]] = {}
_active_overlay_neighbors: Dict[str, float] = {}
# Per-peer metadata: last_seen_inbound, last_send_ok, last_request_path_at, ts_seed_until (epoch seconds).
_peer_lifecycle: Dict[str, Dict[str, Any]] = {}
# Recent presence senders (destination hash hex, lowercased) for recall retries on publish.
_recent_presence_senders: "deque[str]" = deque(maxlen=128)
_last_presence_wire: Optional[bytes] = None
_last_transport_state: Optional[Dict[str, Any]] = None
_transport_monitor_thread: Optional[threading.Thread] = None
_MAX_ENCRYPTED_WIRE_BYTES = int(getattr(RNS.Packet, "ENCRYPTED_MDU", RNS.Packet.MDU))
# Grep logs for this string to confirm the rebuilt script is running (sync with GC_RETICULUM_WIRE_BUILD_MARKER in group-call-wire-reticulum.ts).
PRESENCE_BRIDGE_BUILD = "wire393-reticulum-await-path-links-v1"

# Peer cache: must match TS base58 in electron/src/presence.ts (Qortal alphabet).
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_MAP = {c: i for i, c in enumerate(_BASE58_ALPHABET)}

# Lifecycle / path nudge (see reticulum presence plan).
_PEER_STALE_SECONDS = 4 * 3600
_PEER_TS_SEED_LEASE_SECONDS = 300
_MAX_KNOWN_PEERS = 256
_REQUEST_PATH_COOLDOWN_SECONDS = 30.0
_MAX_PATH_NUDGES_PER_PUBLISH = 8
_NO_VERIFIED_PEERS_ANNOUNCE_COOLDOWN_SECONDS = 2 * 60
# Extra RNS announce while verified overlay peer count is below this (same cooldown as legacy "no peers" path).
_MIN_VERIFIED_OVERLAY_PEERS_BEFORE_SKIP_EXTRA_ANNOUNCE = 3
_KR_MISMATCH_LOGGED: set[str] = set()
_OVERLAY_MAX_NEIGHBORS = 16
_OVERLAY_NEIGHBOR_GRACE_SECONDS = 30.0
_CANDIDATE_PROOF_WINDOW_SECONDS = 45.0
_CANDIDATE_FAILURE_LIMIT = 2
_OVERLAY_DEFAULT_HOPS = 4
_OVERLAY_LINK_PATH_REQUEST_COOLDOWN_SECONDS = 5.0
_OVERLAY_LINK_PATH_AWAIT_SECONDS = 0.35
_QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS = 8.0
_QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS = 4
_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS = 2.0
# Inbound RNS.Link: classify overlay vs audio by first JSON packet; if none, default to overlay.
_INBOUND_LINK_CLASSIFY_TIMEOUT_SEC = 5.0
_pending_inbound_classify_link_ids: Set[int] = set()
_inbound_classify_timers: Dict[int, threading.Timer] = {}

# RNS Destination.announce: once after authenticated presence (first PRESENCE_ANNOUNCE),
# then every RNS_ANNOUNCE_INTERVAL_SEC while session active; cancel on PRESENCE_OFFLINE / stop.
RNS_ANNOUNCE_INTERVAL_SEC = 15 * 60
_rns_auth_announced: bool = False
_rns_periodic_announce_timer: Optional[threading.Timer] = None
_last_no_verified_peers_announce_at: float = 0.0


def qortal_base58_decode(s: str) -> bytes:
    """Decode Qortal Base58 (same algorithm as presence.ts base58Decode)."""
    if not isinstance(s, str) or not s:
        raise ValueError("empty")
    bytes_acc = [0]
    for ch in s:
        if ch not in _BASE58_MAP:
            raise ValueError(f"invalid Base58 char: {ch!r}")
        carry = _BASE58_MAP[ch]
        for j in range(len(bytes_acc)):
            carry += bytes_acc[j] * 58
            bytes_acc[j] = carry & 0xFF
            carry >>= 8
        while carry > 0:
            bytes_acc.append(carry & 0xFF)
            carry >>= 8
    # Leading '1's → leading zero bytes (after decode loop, before reverse)
    idx = 0
    while idx < len(s) and s[idx] == "1":
        bytes_acc.append(0)
        idx += 1
    return bytes(bytes_acc[::-1])


def _normalize_json_numbers(obj: Any) -> Any:
    """Match Node JSON.stringify: whole-number floats become ints (no '.0' suffix)."""
    if isinstance(obj, float):
        if obj.is_integer():
            return int(obj)
        return obj
    if isinstance(obj, dict):
        return {k: _normalize_json_numbers(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_normalize_json_numbers(v) for v in obj]
    return obj


def _call_wire_json_bytes(out: Dict[str, Any]) -> bytes:
    """Compact UTF-8 JSON aligned with Electron wire size checks in group-call-wire-reticulum.ts."""
    return json.dumps(
        out,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


_GROUP_AUDIO_WIRE_TYPE = "GCA"
_GROUP_AUDIO_HEARTBEAT_WIRE_TYPE = "GAC"
_audio_links_by_id: Dict[str, Dict[str, Any]] = {}
_audio_link_ids_by_object: Dict[int, str] = {}
_outgoing_audio_link_id_by_peer_hash: Dict[str, str] = {}
_overlay_links_by_id: Dict[str, Dict[str, Any]] = {}
_overlay_link_ids_by_object: Dict[int, str] = {}
_active_overlay_link_id_by_peer_hash: Dict[str, str] = {}
_qchat_file_links_by_id: Dict[str, Dict[str, Any]] = {}
_qchat_file_link_ids_by_object: Dict[int, str] = {}
_outgoing_qchat_file_link_id_by_peer_hash: Dict[str, str] = {}
_incoming_unified_peer_hash_by_object: Dict[int, str] = {}
_qchat_file_accepts_by_peer: Dict[str, Dict[str, Any]] = {}
_qchat_file_pending_sends_by_transfer: Dict[str, Dict[str, Any]] = {}
_QCHAT_FILE_PROGRESS_MIN_INTERVAL_SECONDS = 0.5
_QCHAT_FILE_PROGRESS_MIN_DELTA = 0.005
_QCHAT_FILE_CHUNK_SIZE = (1024 * 1024) - 1
_QCHAT_FILE_PARALLEL_LINKS = 8
_TRANSPORT_MONITOR_INTERVAL_SECONDS = 5.0
_OVERLAY_PENDING_PACKET_LIMIT = 24

# Binary audio IPC (fd 3 parent→child, fd 4 child→parent). Must match electron/src/reticulum-audio-ipc.ts.
# Diagnostics: grep logs for "target=reticulum-audio-ipc" (fd open, parse, drops, first bytes).
_AUDIO_IPC_LOG = "target=reticulum-audio-ipc"
AUDIO_MAGIC = b"QAUD"
AUDIO_VERSION = 2
AUDIO_HEADER_BYTES = 9
AUDIO_MAX_BODY = 65536
AUDIO_MAX_FRAMES = 32
AUDIO_MAX_PAYLOAD = 8192
AUDIO_MAX_LINK_ID_LEN = 36
AUDIO_MAX_ROOM_ID_LEN = 255
AUDIO_MAX_HASH_LEN = 128

_CMD_QUEUE_MAX = 256
_AUDIO_DECODED_QUEUE_MAX = 48
_JSON_RESP_OUT_QUEUE_MAX = 512
_JSON_EVENT_OUT_QUEUE_MAX = 2048
_AUDIO_BINARY_OUT_QUEUE_MAX = 128
_AUDIO_BATCH_STALE_SECONDS = 0.75
_AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS = 2
_AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS = 8
_AUDIO_BACKLOG_BATCH_STEP = 2
_AUDIO_BACKLOG_CMD_TIMEOUT_SECONDS = 0.005
_AUDIO_QUEUE_STATE_MIN_INTERVAL_SECONDS = 0.5
_PACKET_PATH_IDLE_REQUEST_COOLDOWN_SECONDS = 5.0
_PACKET_PATH_ACTIVE_REQUEST_COOLDOWN_SECONDS = 0.75
_PACKET_PATH_FRESH_SECONDS = 3.0
_PACKET_PATH_RECENT_FAILURE_SECONDS = 2.0
_PACKET_PATH_AWAIT_SECONDS = 0.12
_PACKET_PATH_IDLE_AWAIT_SECONDS = 0.02
_AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS = 2.0
_PACKET_PATH_WARMING_TIMEOUTS_BEFORE_FAILING = 2
_PACKET_PATH_INBOUND_FRESH_SECONDS = 3.0
_PACKET_PATH_POLL_INTERVAL_SECONDS = 0.01

_shutdown = threading.Event()
_json_resp_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_RESP_OUT_QUEUE_MAX
)
_json_event_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_EVENT_OUT_QUEUE_MAX
)
_audio_binary_out_queue: "queue.Queue[Optional[bytes]]" = queue.Queue(
    maxsize=_AUDIO_BINARY_OUT_QUEUE_MAX
)
_cmd_queue_bounded: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_CMD_QUEUE_MAX
)
_audio_decoded_queue: "queue.Queue[Optional[list]]" = queue.Queue(
    maxsize=_AUDIO_DECODED_QUEUE_MAX
)
_audio_in_f: Optional[IO[bytes]] = None
_audio_drops_ingress = 0
_audio_drops_json_out = 0
_audio_drops_binary_out = 0
_audio_stale_drops = 0
_audio_packet_send_failures = 0
_audio_packet_path_requests = 0
_audio_packet_path_resolutions = 0
_audio_packet_path_timeouts = 0
_audio_packet_fresh_sends = 0
_audio_packet_stale_sends = 0
_audio_packet_unknown_sends = 0
_audio_queue_state_last_emit = 0.0
_audio_queue_state_dirty = False
# One-shot narrowing logs (grep target=reticulum-audio-ipc stage=…)
_audio_ipc_fd3_first_batch_ok_logged = False
_audio_ipc_rns_first_send_ok_logged = False
_audio_ipc_fd4_first_chunk_logged = False
_call_media_path_state: Dict[str, Dict[str, Any]] = {}

# Compact group-call control on call aspect (see electron/src/group-call-wire-reticulum.ts).
_GROUP_CALL_WIRE_TYPES = frozenset(
    {
        "GA",
        "GAC",
        "GJ",
        "GL",
        "GH",
        "GK",
        "GK0",
        "GK1",
        "GQ",
        "GQ0",
        "GQ1",
        "GT",
        "GT0",
        "GT1",
        "GR",
        "GR0",
        "GR1",
        "GO",
        "GO0",
        "GO1",
        "GE",
        "GE0",
        "GE1",
        "GF",
        "GI",
        "GX",
    }
)
_AUDIO_LINK_WIRE_TYPES = frozenset(
    {_GROUP_AUDIO_WIRE_TYPE, _GROUP_AUDIO_HEARTBEAT_WIRE_TYPE}
)


def _queue_json_event_line(frame: Dict[str, Any]) -> None:
    global _audio_drops_json_out
    try:
        _json_event_queue.put_nowait(frame)
    except queue.Full:
        _audio_drops_json_out += 1
        _mark_audio_queue_state_dirty()
        if _audio_drops_json_out % 200 == 1:
            log(
                f"[presence_bridge] json_event_queue full drops={_audio_drops_json_out}"
            )


def _queue_json_resp_line(frame: Dict[str, Any]) -> None:
    while not _shutdown.is_set():
        try:
            _json_resp_queue.put(frame, timeout=0.05)
            return
        except queue.Full:
            continue


def emit(frame: Dict[str, Any]) -> None:
    _queue_json_event_line(frame)


def emit_resp(req_id: str, ok: bool, payload: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    frame: Dict[str, Any] = {"type": "resp", "id": req_id, "ok": ok}
    if payload is not None:
        frame["payload"] = payload
    if error is not None:
        frame["error"] = error
    _queue_json_resp_line(frame)


def emit_event(event: str, payload: Optional[Dict[str, Any]] = None) -> None:
    frame: Dict[str, Any] = {"type": "event", "event": event}
    if payload is not None:
        frame["payload"] = payload
    _queue_json_event_line(frame)


def _mark_audio_queue_state_dirty() -> None:
    global _audio_queue_state_dirty
    _audio_queue_state_dirty = True


def _decoded_queue_oldest_age_ms(now: float) -> float:
    with _audio_decoded_queue.mutex:
        queued = _audio_decoded_queue.queue[0] if _audio_decoded_queue.queue else None
    if not queued:
        return 0.0
    queued_at, _batch = queued
    if not isinstance(queued_at, (int, float)):
        return 0.0
    return max(0.0, (now - queued_at) * 1000.0)


def _binary_out_queue_oldest_age_ms(now: float) -> float:
    with _audio_binary_out_queue.mutex:
        queued = _audio_binary_out_queue.queue[0] if _audio_binary_out_queue.queue else None
    if not queued:
        return 0.0
    if not isinstance(queued, tuple) or len(queued) < 2:
        return 0.0
    queued_at = queued[0]
    if not isinstance(queued_at, (int, float)):
        return 0.0
    return max(0.0, (now - queued_at) * 1000.0)


def _emit_audio_queue_state(force: bool = False) -> None:
    global _audio_queue_state_dirty, _audio_queue_state_last_emit
    now = time.monotonic()
    if not force and not _audio_queue_state_dirty:
        return
    if not force and now - _audio_queue_state_last_emit < _AUDIO_QUEUE_STATE_MIN_INTERVAL_SECONDS:
        return
    _audio_queue_state_last_emit = now
    _audio_queue_state_dirty = False
    emit_event(
        "group_audio_queue_state",
        {
            "decodedQueueDepth": _audio_decoded_queue.qsize(),
            "decodedQueueOldestAgeMs": _decoded_queue_oldest_age_ms(now),
            "decodedQueueMax": _AUDIO_DECODED_QUEUE_MAX,
            "decodedQueueDrops": _audio_drops_ingress,
            "binaryOutQueueDepth": _audio_binary_out_queue.qsize(),
            "binaryOutQueueOldestAgeMs": _binary_out_queue_oldest_age_ms(now),
            "binaryOutQueueMax": _AUDIO_BINARY_OUT_QUEUE_MAX,
            "binaryOutQueueDrops": _audio_drops_binary_out,
            "jsonOutQueueDrops": _audio_drops_json_out,
            "staleDrops": _audio_stale_drops,
            "packetSendFailures": _audio_packet_send_failures,
            "packetPathRequests": _audio_packet_path_requests,
            "packetPathResolutions": _audio_packet_path_resolutions,
            "packetPathTimeouts": _audio_packet_path_timeouts,
            "packetFreshSends": _audio_packet_fresh_sends,
            "packetStaleSends": _audio_packet_stale_sends,
            "packetUnknownSends": _audio_packet_unknown_sends,
        },
    )


def _emit_binary_audio(chunk: bytes) -> None:
    global _audio_drops_binary_out, _audio_ipc_fd4_first_chunk_logged
    try:
        _audio_binary_out_queue.put_nowait((time.monotonic(), chunk))
        _mark_audio_queue_state_dirty()
        if not _audio_ipc_fd4_first_chunk_logged:
            _audio_ipc_fd4_first_chunk_logged = True
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd4-first-chunk-enqueued-to-parent "
                f"len={len(chunk)}"
            )
    except queue.Full:
        _audio_drops_binary_out += 1
        _mark_audio_queue_state_dirty()
        if _audio_drops_binary_out % 100 == 1:
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=binary-out-queue-full drops={_audio_drops_binary_out}"
            )


def _read_exact(f: IO[bytes], n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = f.read(n - len(buf))
        if not chunk:
            raise EOFError()
        buf += chunk
    return buf


def _write_all_binary(f: IO[bytes], data: bytes) -> None:
    """Pipe writes may be partial; must loop until all bytes are sent."""
    off = 0
    mem = memoryview(data)
    while off < len(data):
        n = f.write(mem[off:])
        if n is None:
            f.flush()
            continue
        if not isinstance(n, int) or n <= 0:
            raise OSError("fd4 write returned no progress")
        off += n
    f.flush()


def _parse_audio_batch_body(body: bytes) -> list:
    if len(body) < 2:
        raise ValueError("body too short")
    n = int.from_bytes(body[0:2], "big")
    if n == 0 or n > AUDIO_MAX_FRAMES:
        raise ValueError("bad frame count")
    o = 2
    out: list = []
    for _ in range(n):
        if o >= len(body):
            raise ValueError("truncated")
        ll = body[o]
        o += 1
        if ll > AUDIO_MAX_LINK_ID_LEN or o + ll > len(body):
            raise ValueError("bad link id")
        link_id = body[o : o + ll].decode("utf-8")
        o += ll
        if o >= len(body):
            raise ValueError("truncated")
        rl = body[o]
        o += 1
        if rl > AUDIO_MAX_ROOM_ID_LEN or o + rl > len(body):
            raise ValueError("bad room id")
        room_id = body[o : o + rl].decode("utf-8")
        o += rl
        if o >= len(body):
            raise ValueError("truncated")
        pl = body[o]
        o += 1
        if pl > AUDIO_MAX_HASH_LEN or o + pl > len(body):
            raise ValueError("bad pph")
        peer_presence_hash = body[o : o + pl].decode("utf-8")
        o += pl
        if o >= len(body):
            raise ValueError("truncated")
        cl = body[o]
        o += 1
        if cl > AUDIO_MAX_HASH_LEN or o + cl > len(body):
            raise ValueError("bad pch")
        peer_call_hash = body[o : o + cl].decode("utf-8")
        o += cl
        if o + 2 > len(body):
            raise ValueError("truncated plen")
        plen = int.from_bytes(body[o : o + 2], "big")
        o += 2
        if o + 8 > len(body):
            raise ValueError("truncated received_at")
        received_at_wall_ms = int.from_bytes(body[o : o + 8], "big")
        o += 8
        if plen > AUDIO_MAX_PAYLOAD or o + plen > len(body):
            raise ValueError("bad payload")
        raw = bytes(body[o : o + plen])
        o += plen
        out.append(
            (
                link_id,
                room_id,
                peer_presence_hash,
                peer_call_hash,
                received_at_wall_ms,
                raw,
            )
        )
    if o != len(body):
        raise ValueError("leftover")
    return out


def _encode_audio_batch_binary(
    frames: list,
) -> bytes:
    """frames: list of (link_id, room_id, peer_presence_hash, peer_call_hash, received_at_wall_ms, raw: bytes)"""
    n = len(frames)
    if n == 0 or n > AUDIO_MAX_FRAMES:
        raise ValueError("bad frame count")
    body = bytearray()
    body.extend(n.to_bytes(2, "big"))
    for link_id, room_id, pph, pch, received_at_wall_ms, raw in frames:
        lid = link_id.encode("utf-8")
        rid = room_id.encode("utf-8")
        pb = pph.encode("utf-8")
        cb = pch.encode("utf-8")
        if (
            len(lid) > AUDIO_MAX_LINK_ID_LEN
            or len(rid) > AUDIO_MAX_ROOM_ID_LEN
            or len(pb) > AUDIO_MAX_HASH_LEN
            or len(cb) > AUDIO_MAX_HASH_LEN
            or len(raw) > AUDIO_MAX_PAYLOAD
        ):
            raise ValueError("field too large")
        body.append(len(lid))
        body.extend(lid)
        body.append(len(rid))
        body.extend(rid)
        body.append(len(pb))
        body.extend(pb)
        body.append(len(cb))
        body.extend(cb)
        body.extend(len(raw).to_bytes(2, "big"))
        body.extend(int(max(0, int(received_at_wall_ms))).to_bytes(8, "big"))
        body.extend(raw)
    body_bytes = bytes(body)
    if len(body_bytes) > AUDIO_MAX_BODY:
        raise ValueError("body too large")
    header = bytearray()
    header.extend(AUDIO_MAGIC)
    header.append(AUDIO_VERSION)
    header.extend(len(body_bytes).to_bytes(4, "big"))
    return bytes(header) + body_bytes


def _process_audio_batch(frames: list) -> None:
    """frames: list of (link_id, room_id, peer_presence_hash, peer_call_hash, received_at_wall_ms, raw_opus_bytes)"""
    global _audio_ipc_rns_first_send_ok_logged, _audio_packet_send_failures
    global _audio_packet_fresh_sends, _audio_packet_stale_sends, _audio_packet_unknown_sends
    for link_id, room_id, peer_presence_hash, peer_call_hash, _received_at_wall_ms, raw in frames:
        if link_id:
            state = get_audio_link_state(link_id)
            if state is None:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "reason": "unknown_link_id",
                        "code": "unknown_link_id",
                        "transport": "link",
                    },
                )
                continue
            if state.get("established") is not True:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                        "reason": "audio_link_not_ready",
                        "code": "audio_link_not_ready",
                        "transport": "link",
                    },
                )
                continue
            link = state.get("link")
            if link is None:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                        "reason": "unknown_link_id",
                        "code": "unknown_link_id",
                        "transport": "link",
                    },
                )
                continue
            try:
                data_b64 = base64.b64encode(raw).decode("ascii")
                wire_bytes = make_group_audio_wire(room_id, data_b64)
                max_wire_bytes = _MAX_ENCRYPTED_WIRE_BYTES
                try:
                    link_mdu = link.get_mdu()
                    if isinstance(link_mdu, int) and link_mdu > 0:
                        max_wire_bytes = link_mdu
                except Exception:
                    pass
                if len(wire_bytes) > max_wire_bytes:
                    emit_event(
                        "group_audio_send_failed",
                        {
                            "linkId": link_id,
                            "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                            "reason": "audio_payload_too_large",
                            "code": "audio_payload_too_large",
                            "transport": "link",
                        },
                    )
                    continue
                packet = RNS.Packet(link, wire_bytes, create_receipt=False)
                result = packet.send()
                if result is False:
                    _audio_packet_send_failures += 1
                    _mark_audio_queue_state_dirty()
                    emit_event(
                        "group_audio_send_failed",
                        {
                            "linkId": link_id,
                            "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                            "reason": "packet_send_false",
                            "code": "packet_send_false",
                            "transport": "link",
                        },
                    )
                else:
                    if not _audio_ipc_rns_first_send_ok_logged:
                        _audio_ipc_rns_first_send_ok_logged = True
                        log(
                            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-first-packet-send-ok "
                            f"link_prefix={link_id[:8] if len(link_id) >= 8 else link_id} bytes_wire={len(wire_bytes)}"
                        )
                continue
            except Exception as exc:
                _audio_packet_send_failures += 1
                _mark_audio_queue_state_dirty()
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                        "reason": "exception",
                        "code": "exception",
                        "error": str(exc),
                        "transport": "link",
                    },
                )
                continue

        peer_hash = str(peer_presence_hash or "").strip().lower()
        if not peer_hash:
            emit_event(
                "group_audio_send_failed",
                {
                    "reason": "unknown_peer_presence_hash",
                    "code": "unknown_peer_presence_hash",
                    "transport": "packet",
                },
            )
            continue
        peer_identity = _get_group_audio_peer_identity(peer_hash)
        if peer_identity is None:
            emit_event(
                "group_audio_send_failed",
                {
                    "peerPresenceHash": peer_hash,
                    "reason": "unknown_peer_presence_hash",
                    "code": "unknown_peer_presence_hash",
                    "transport": "packet",
                },
            )
            continue
        try:
            outbound = build_outbound_destination(peer_identity)
            destination_hash = outbound.hash
            path_state, path_ready = _ensure_call_media_path(
                peer_hash,
                destination_hash,
                active_call=True,
                allow_wait=False,
                reason="audio_send",
            )
            if path_state == "fresh":
                _audio_packet_fresh_sends += 1
            elif path_state in ("stale", "warming"):
                _audio_packet_stale_sends += 1
            else:
                _audio_packet_unknown_sends += 1
            _mark_audio_queue_state_dirty()
            if not path_ready:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "peerPresenceHash": peer_hash,
                        "reason": "path_request_timeout",
                        "code": "path_request_timeout",
                        "pathState": path_state,
                        "transport": "packet",
                    },
                )
                continue
            data_b64 = base64.b64encode(raw).decode("ascii")
            wire_bytes = make_group_audio_wire(room_id, data_b64)
            if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "peerPresenceHash": peer_hash,
                        "reason": "audio_payload_too_large",
                        "code": "audio_payload_too_large",
                        "transport": "packet",
                    },
                )
                continue
            packet = RNS.Packet(outbound, wire_bytes, create_receipt=False)
            result = packet.send()
            if result is False:
                _audio_packet_send_failures += 1
                _note_call_media_send_result(peer_hash, False)
                _mark_audio_queue_state_dirty()
                emit_event(
                    "group_audio_send_failed",
                    {
                        "peerPresenceHash": peer_hash,
                        "reason": "packet_send_false",
                        "code": "packet_send_false",
                        "transport": "packet",
                    },
                )
                continue
            _note_call_media_send_result(peer_hash, True)
            if not _audio_ipc_rns_first_send_ok_logged:
                _audio_ipc_rns_first_send_ok_logged = True
                target = str(peer_call_hash or destination_hash_hex(destination_hash))
                log(
                    f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-first-packet-send-ok "
                    f"packet_peer={target[:16]} bytes_wire={len(wire_bytes)}"
                )
        except Exception as exc:
            _audio_packet_send_failures += 1
            _note_call_media_send_result(peer_hash, False)
            _mark_audio_queue_state_dirty()
            emit_event(
                "group_audio_send_failed",
                {
                    "peerPresenceHash": peer_hash,
                    "reason": "exception",
                    "code": "exception",
                    "error": str(exc),
                    "transport": "packet",
                },
            )


def _stdout_writer_loop() -> None:
    resp_closed = False
    event_closed = False
    while True:
        if not resp_closed:
            try:
                frame = _json_resp_queue.get_nowait()
            except queue.Empty:
                frame = None
            else:
                if frame is None:
                    resp_closed = True
                else:
                    sys.stdout.write(json.dumps(frame, separators=(",", ":")) + "\n")
                    sys.stdout.flush()
                    continue

        if resp_closed and event_closed:
            break

        if not resp_closed:
            try:
                frame = _json_resp_queue.get(timeout=0.01)
            except queue.Empty:
                frame = None
            else:
                if frame is None:
                    resp_closed = True
                else:
                    sys.stdout.write(json.dumps(frame, separators=(",", ":")) + "\n")
                    sys.stdout.flush()
                    continue

        if event_closed:
            continue
        try:
            frame = _json_event_queue.get(timeout=0.05)
        except queue.Empty:
            continue
        if frame is None:
            event_closed = True
            continue
        sys.stdout.write(json.dumps(frame, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def _audio_binary_out_writer_loop() -> None:
    try:
        outf = open(4, "wb", buffering=0)
    except OSError as exc:
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=open-failed child→parent-binary-disabled err={exc}")
        return
    log(
        f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=egress-ready child→parent-binary (inbound audio to Electron)"
    )
    while True:
        queued = _audio_binary_out_queue.get()
        if queued is None:
            break
        try:
            _queued_at, chunk = queued
            _write_all_binary(outf, chunk)
        except BrokenPipeError:
            break
        except Exception as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=write-error err={exc}")


def _audio_in_reader_loop() -> None:
    global _audio_in_f, _audio_drops_ingress, _audio_ipc_fd3_first_batch_ok_logged
    try:
        _audio_in_f = open(3, "rb", buffering=0)
    except OSError as exc:
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=open-failed parent→child-binary-disabled err={exc}")
        return
    log(
        f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=ingress-ready parent→child-binary (outbound audio from Electron)"
    )
    f = _audio_in_f
    while not _shutdown.is_set():
        try:
            header = _read_exact(f, AUDIO_HEADER_BYTES)
        except EOFError:
            break
        except Exception as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=read-header-error err={exc}")
            break
        if header[0:4] != AUDIO_MAGIC:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-magic")
            continue
        if header[4] != AUDIO_VERSION:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-version got={header[4]}")
            continue
        body_len = int.from_bytes(header[5:9], "big")
        if body_len > AUDIO_MAX_BODY or body_len < 2:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-body_len len={body_len}")
            continue
        try:
            body = _read_exact(f, body_len)
        except EOFError:
            break
        except Exception as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=read-body-error err={exc}")
            break
        try:
            frames = _parse_audio_batch_body(body)
        except ValueError as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=parse-batch-failed err={exc}")
            continue
        if not _audio_ipc_fd3_first_batch_ok_logged:
            _audio_ipc_fd3_first_batch_ok_logged = True
            nframes = len(frames) if isinstance(frames, list) else 0
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-first-batch-from-parent-parsed "
                f"frames={nframes}"
            )
        try:
            _audio_decoded_queue.put_nowait((time.monotonic(), frames))
            _mark_audio_queue_state_dirty()
            _emit_audio_queue_state()
        except queue.Full:
            _audio_drops_ingress += 1
            _mark_audio_queue_state_dirty()
            _emit_audio_queue_state()
            if _audio_drops_ingress % 100 == 1:
                log(
                    f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=decoded-queue-full drops={_audio_drops_ingress}"
                )


def _rns_executor_loop() -> None:
    global _audio_stale_drops
    while True:
        drained_audio = False
        drained_batches = 0
        decoded_backlog = 0
        try:
            decoded_backlog = _audio_decoded_queue.qsize()
            batch_budget = min(
                _AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS,
                _AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS
                + max(0, decoded_backlog // _AUDIO_BACKLOG_BATCH_STEP),
            )
            while drained_batches < batch_budget:
                queued = _audio_decoded_queue.get_nowait()
                if queued is None:
                    break
                queued_at, batch = queued
                batch_age = time.monotonic() - queued_at
                if batch_age > _AUDIO_BATCH_STALE_SECONDS:
                    _audio_stale_drops += len(batch)
                    _mark_audio_queue_state_dirty()
                else:
                    _process_audio_batch(batch)
                drained_audio = True
                drained_batches += 1
        except queue.Empty:
            pass
        if drained_audio:
            _mark_audio_queue_state_dirty()
            _emit_audio_queue_state()
        try:
            if not _cmd_queue_bounded.empty():
                message = _cmd_queue_bounded.get_nowait()
            elif not _audio_decoded_queue.empty():
                if _shutdown.is_set() and _cmd_queue_bounded.empty():
                    continue
                _emit_audio_queue_state()
                time.sleep(_AUDIO_BACKLOG_CMD_TIMEOUT_SECONDS)
                continue
            else:
                message = _cmd_queue_bounded.get(timeout=0.05)
        except queue.Empty:
            if _shutdown.is_set() and _cmd_queue_bounded.empty() and _audio_decoded_queue.empty():
                return
            _emit_audio_queue_state()
            continue
        if message is None:
            try:
                while True:
                    queued = _audio_decoded_queue.get_nowait()
                    if queued is None:
                        continue
                    _, batch = queued
                    _process_audio_batch(batch)
            except queue.Empty:
                pass
            _emit_audio_queue_state(force=True)
            return
        try:
            handle_command(message)
        except Exception as exc:
            emit_event(
                "error",
                {
                    "code": "command_failed",
                    "message": str(exc),
                    "detail": traceback.format_exc(limit=3),
                },
            )
        _emit_audio_queue_state()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return False


def _is_qortal_mesh_listen_name(name: str) -> bool:
    """Match managed-config section title; RNS may use a short or long display name."""
    n = (name or "").strip()
    if n == "Qortal Hub Mesh Listen":
        return True
    return "Qortal Hub Mesh Listen" in n


def _is_mesh_listen_inbound_backbone_client(item: Dict[str, Any]) -> bool:
    """
    Inbound peers attached to mesh listen appear as BackboneClientInterface with
    "Client on Qortal Hub Mesh Listen" in the name. Those are not bootstrap hubs.
    Outbound Backbone hubs (e.g. phantom.mobilefabrik.com) use the same type.
    """
    if str(item.get("type") or "") != "BackboneClientInterface":
        return False
    n = str(item.get("name") or item.get("short_name") or "")
    return "Client on Qortal Hub Mesh Listen" in n


def summarize_transport_state(payload: Dict[str, Any]) -> str:
    return (
        f"{payload.get('reachability')} "
        f"hubs={payload.get('onlineHubInterfaces', 0)}/{payload.get('configuredHubInterfaces', 0)} "
        f"remote_hubs={payload.get('onlineRemoteHubInterfaces', 0)}/{payload.get('configuredRemoteHubInterfaces', 0)} "
        f"transport={'on' if payload.get('transportEnabled') else 'off'}"
    )


def collect_transport_state() -> Dict[str, Any]:
    if _reticulum is None:
        return {
            "reachability": "unknown",
            "transportEnabled": False,
            "configuredHubInterfaces": 0,
            "onlineHubInterfaces": 0,
            "configuredRemoteHubInterfaces": 0,
            "onlineRemoteHubInterfaces": 0,
            "hubSummary": "Reticulum bridge not started",
            "reason": "Reticulum bridge not started",
            "meshListenOnline": False,
        }

    stats = _reticulum.get_interface_stats() or {}
    interfaces = stats.get("interfaces")
    if not isinstance(interfaces, list):
        interfaces = []

    normalised = []
    for item in interfaces:
        if not isinstance(item, dict):
            continue
        normalised.append(
            {
                "name": str(item.get("name") or item.get("short_name") or ""),
                "type": str(item.get("type") or ""),
                "online": as_bool(item.get("status")),
            }
        )

    hub_interfaces = [
        item
        for item in normalised
        if item.get("type")
        in ("TCPClientInterface", "BackboneInterface", "BackboneClientInterface")
        and not _is_mesh_listen_inbound_backbone_client(item)
    ]
    # Outbound bootstrap hubs only — exclude local mesh listen (same Backbone type on Linux).
    remote_hub_interfaces = [
        item
        for item in hub_interfaces
        if not _is_qortal_mesh_listen_name(str(item.get("name") or ""))
    ]
    online_hubs = [item for item in hub_interfaces if item.get("online")]
    online_remote_hubs = [item for item in remote_hub_interfaces if item.get("online")]
    local_auto_online = any(
        item.get("online") and item.get("type") == "AutoInterface"
        for item in normalised
    )

    if online_hubs:
        reachability = "hub-connected"
    elif hub_interfaces:
        reachability = "disconnected"
    elif local_auto_online:
        reachability = "lan-only"
    else:
        reachability = "unknown"

    if hub_interfaces:
        hub_summary = ", ".join(
            [
                f"{item.get('name') or item.get('type')}={'online' if item.get('online') else 'offline'}"
                for item in hub_interfaces
            ]
        )
    elif local_auto_online:
        hub_summary = "LAN-only discovery available"
    else:
        hub_summary = "No active Reticulum interfaces"

    mesh_listen_online = False
    _mesh_listen_types = frozenset({"BackboneInterface", "TCPServerInterface"})
    for item in normalised:
        if (
            _is_qortal_mesh_listen_name(str(item.get("name") or ""))
            and item.get("type") in _mesh_listen_types
            and item.get("online")
        ):
            mesh_listen_online = True
            break

    return {
        "reachability": reachability,
        "transportEnabled": "transport_id" in stats,
        "configuredHubInterfaces": len(hub_interfaces),
        "onlineHubInterfaces": len(online_hubs),
        "configuredRemoteHubInterfaces": len(remote_hub_interfaces),
        "onlineRemoteHubInterfaces": len(online_remote_hubs),
        "hubSummary": hub_summary,
        "meshListenOnline": mesh_listen_online,
    }


def maybe_emit_transport_state(force: bool = False) -> None:
    global _last_transport_state

    try:
        payload = collect_transport_state()
    except Exception as exc:
        payload = {
            "reachability": "unknown",
            "transportEnabled": False,
            "configuredHubInterfaces": 0,
            "onlineHubInterfaces": 0,
            "configuredRemoteHubInterfaces": 0,
            "onlineRemoteHubInterfaces": 0,
            "hubSummary": "Unable to read Reticulum interface stats",
            "reason": str(exc),
            "meshListenOnline": False,
        }

    previous = _last_transport_state
    if not force and previous == payload:
        return

    _last_transport_state = payload
    emit_event("transport_state", payload)
    log(f"[presence_bridge] transport_state {summarize_transport_state(payload)}")


def transport_monitor_loop() -> None:
    while True:
        try:
            maybe_emit_transport_state()
        except Exception as exc:
            log(f"[presence_bridge] transport monitor error: {exc}")
        time.sleep(_TRANSPORT_MONITOR_INTERVAL_SECONDS)


def ensure_transport_monitor_started() -> None:
    global _transport_monitor_thread
    if _transport_monitor_thread is not None and _transport_monitor_thread.is_alive():
        return
    _transport_monitor_thread = threading.Thread(
        target=transport_monitor_loop,
        daemon=True,
        name="reticulum-transport-monitor",
    )
    _transport_monitor_thread.start()


def destination_hash_hex(destination_hash: bytes) -> str:
    return destination_hash.hex()


def _local_presence_hash_hex() -> Optional[str]:
    """Hex of local RNS destination; skip overlay links and fanout to ourselves."""
    if _destination is None:
        return None
    return destination_hash_hex(_destination.hash)


def _register_peer(
    peer_key: str,
    peer_identity: Any,
    source: str,
) -> None:
    """Register identity for fanout; updates lifecycle by source."""
    global _known_peers, _peer_lifecycle
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        log(
            "[presence_bridge] target=presence-reticulum skip_register_peer_self "
            f"source={source}"
        )
        return
    is_new = peer_key not in _known_peers
    _known_peers[peer_key] = peer_identity
    now = time.time()
    if peer_key not in _peer_lifecycle:
        _peer_lifecycle[peer_key] = {
            "last_seen_inbound": None,
            "last_send_ok": None,
            "last_request_path_at": None,
            "ts_seed_until": None,
        }
    st = _peer_lifecycle[peer_key]
    if source in ("inbound", "announce", "wire_kr", "gcall_join"):
        st["last_seen_inbound"] = now
    if source == "ts_seed":
        st["ts_seed_until"] = now + _PEER_TS_SEED_LEASE_SECONDS
    if is_new:
        peers_sorted = sorted(_known_peers.keys())
        log(
            "[presence_bridge] target=presence-reticulum peer_learned "
            f"peer_hash={peer_key} source={source} known_peers_count={len(_known_peers)} "
            f"all_peer_hashes={','.join(peers_sorted)}"
        )
    _evict_lru_if_needed()


def _mark_candidate_peer(peer_key: str, source: str) -> None:
    peer_key = str(peer_key or "").strip().lower()
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return
    now = time.time()
    existing = _candidate_peers.get(peer_key) or {}
    peer = {
        "first_seen_at": existing.get("first_seen_at") or now,
        "last_seen_at": now,
        "proof_deadline_at": now + _CANDIDATE_PROOF_WINDOW_SECONDS,
        "failure_count": int(existing.get("failure_count") or 0),
        "source": source,
    }
    if "last_failure_reason" in existing:
        peer["last_failure_reason"] = existing["last_failure_reason"]
    _candidate_peers[peer_key] = peer
    emit_event(
        "candidate_peer_discovered",
        {
            "peerHash": peer_key,
            "source": source,
        },
    )
    log(
        "[presence_bridge] target=presence-reticulum candidate_discovered "
        f"peer_hash={peer_key} source={source} proof_deadline_at={peer['proof_deadline_at']}"
    )


def _note_candidate_failure(peer_key: str, reason: str) -> None:
    now = time.time()
    existing = _candidate_peers.get(peer_key)
    if existing is None:
        existing = {
            "first_seen_at": now,
            "last_seen_at": now,
            "proof_deadline_at": now + _CANDIDATE_PROOF_WINDOW_SECONDS,
            "failure_count": 0,
            "source": "failure",
        }
    existing["last_seen_at"] = now
    existing["failure_count"] = int(existing.get("failure_count") or 0) + 1
    existing["last_failure_reason"] = reason
    if existing["failure_count"] >= _CANDIDATE_FAILURE_LIMIT:
        _candidate_peers.pop(peer_key, None)
        log(
            "[presence_bridge] target=presence-reticulum candidate_evicted "
            f"peer_hash={peer_key} failure_count={existing['failure_count']} reason={reason}"
        )
        return
    _candidate_peers[peer_key] = existing
    log(
        "[presence_bridge] target=presence-reticulum candidate_failure "
        f"peer_hash={peer_key} failure_count={existing['failure_count']} reason={reason}"
    )


def _prune_candidate_peers() -> None:
    now = time.time()
    for peer_key, peer in list(_candidate_peers.items()):
        deadline = peer.get("proof_deadline_at")
        if isinstance(deadline, (int, float)) and now > float(deadline):
            _candidate_peers.pop(peer_key, None)
            log(
                "[presence_bridge] target=presence-reticulum candidate_timeout "
                f"peer_hash={peer_key}"
            )


def _set_verified_overlay_peers(
    verified_peers: list[Dict[str, Any]], active_neighbor_hashes: list[str]
) -> None:
    global _verified_overlay_peers, _active_overlay_neighbors
    now = time.time()
    local_hex = _local_presence_hash_hex()
    prev_verified = dict(_verified_overlay_peers)
    prev_neighbors = dict(_active_overlay_neighbors)
    next_verified: Dict[str, Dict[str, Any]] = {}
    for peer in verified_peers:
        if not isinstance(peer, dict):
            continue
        peer_hash = str(peer.get("destinationHash") or "").strip().lower()
        address = str(peer.get("address") or "").strip()
        last_seen = peer.get("lastSeen")
        if not peer_hash or not address or not isinstance(last_seen, (int, float)):
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        next_verified[peer_hash] = {
            "address": address,
            "last_seen": float(last_seen),
        }
        _candidate_peers.pop(peer_hash, None)
    _verified_overlay_peers = next_verified
    next_neighbors: Dict[str, float] = {}
    for raw_hash in active_neighbor_hashes[:_OVERLAY_MAX_NEIGHBORS]:
        peer_hash = str(raw_hash or "").strip().lower()
        if not peer_hash:
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        # Fanout list from TS: verified neighbors plus candidate backfill
        # (bootstrap). Keep the lease even if local RNS identity recall is
        # temporarily empty; _sync_overlay_links will defer opening the link
        # until recall/path data is available. Dropping it here can collapse
        # verified=N into publish_fanout=0 and drain the overlay.
        next_neighbors[peer_hash] = now
    retained_neighbors = 0
    for peer_hash, seen_at in prev_neighbors.items():
        if len(next_neighbors) >= _OVERLAY_MAX_NEIGHBORS:
            break
        if peer_hash in next_neighbors:
            continue
        if not isinstance(seen_at, (int, float)):
            continue
        if now - float(seen_at) > _OVERLAY_NEIGHBOR_GRACE_SECONDS:
            continue
        if peer_hash not in next_verified and peer_hash not in prev_verified:
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        next_neighbors[peer_hash] = float(seen_at)
        retained_neighbors += 1
    _active_overlay_neighbors = next_neighbors
    log(
        "[presence_bridge] target=presence-reticulum overlay_sync "
        f"verified={len(_verified_overlay_peers)} publish_fanout={len(_active_overlay_neighbors)} "
        f"retained={retained_neighbors}"
    )


def _resolve_overlay_neighbor_hashes(exclude_hashes: Optional[list[str]] = None) -> list[str]:
    _prune_candidate_peers()
    exclude = {
        str(h).strip().lower() for h in (exclude_hashes or []) if str(h).strip()
    }
    local_hex = _local_presence_hash_hex()
    now = time.time()
    out: list[str] = []
    for peer_hash in list(_active_overlay_neighbors.keys()):
        seen_at = _active_overlay_neighbors.get(peer_hash)
        if isinstance(seen_at, (int, float)) and now - float(seen_at) > _OVERLAY_NEIGHBOR_GRACE_SECONDS:
            _active_overlay_neighbors.pop(peer_hash, None)
            continue
        if peer_hash in exclude:
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if peer_hash not in _known_peers:
            continue
        # Refresh the active-neighbor lease on real fanout use. Overlay sync from
        # Electron is event-driven, so steady 25 s presence heartbeats must keep a
        # healthy neighbor from aging out after the 30 s grace window.
        _active_overlay_neighbors[peer_hash] = now
        out.append(peer_hash)
    return out[:_OVERLAY_MAX_NEIGHBORS]


def _get_group_audio_peer_identity(peer_hash: str):
    """RNS identity for group audio using join destination hash + recall.

    Group audio is keyed by the joiner's Reticulum destination hash from Electron; it does
    not require membership in the verified-overlay snapshot from ``overlay_sync_state``."""
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return None
    ident = _known_peers.get(peer_key)
    if ident is not None:
        return ident
    ensure_known_peer_from_recall(peer_key, "ts_seed")
    return _known_peers.get(peer_key)


def _evict_lru_if_needed() -> None:
    """Cap _known_peers by dropping least-recently-seen peers (not TS-leased)."""
    global _known_peers, _peer_lifecycle
    if len(_known_peers) <= _MAX_KNOWN_PEERS:
        return
    now = time.time()
    candidates: list[tuple[float, str]] = []
    for pk in list(_known_peers.keys()):
        st = _peer_lifecycle.get(pk) or {}
        lease = st.get("ts_seed_until")
        if isinstance(lease, (int, float)) and lease > now:
            continue
        last = st.get("last_seen_inbound")
        if not isinstance(last, (int, float)):
            last = 0.0
        candidates.append((float(last), pk))
    candidates.sort(key=lambda x: x[0])
    need = len(_known_peers) - _MAX_KNOWN_PEERS
    for _score, pk in candidates[: max(0, need)]:
        _known_peers.pop(pk, None)
        _peer_lifecycle.pop(pk, None)
        log(
            f"[presence_bridge] target=presence-reticulum peer_evicted_lru peer_hash={pk}"
        )


def _refresh_ts_seed_only(peer_key: str) -> None:
    """Extend lease for Electron-supplied destination hashes (split-brain sync)."""
    now = time.time()
    if peer_key not in _peer_lifecycle:
        _peer_lifecycle[peer_key] = {
            "last_seen_inbound": None,
            "last_send_ok": None,
            "last_request_path_at": None,
            "ts_seed_until": None,
        }
    _peer_lifecycle[peer_key]["ts_seed_until"] = now + _PEER_TS_SEED_LEASE_SECONDS


def _maybe_prune_stale_peers() -> None:
    """Remove peers with no recent activity and no active TS seed lease."""
    global _known_peers, _peer_lifecycle
    if _destination is None:
        return
    now = time.time()
    local_hex = destination_hash_hex(_destination.hash)
    to_drop: list[str] = []
    for pk, st in list(_peer_lifecycle.items()):
        if pk == local_hex:
            continue
        lease = st.get("ts_seed_until")
        if isinstance(lease, (int, float)) and lease > now:
            continue
        last_in = st.get("last_seen_inbound")
        last_ok = st.get("last_send_ok")
        active = False
        if isinstance(last_in, (int, float)) and (now - float(last_in)) <= _PEER_STALE_SECONDS:
            active = True
        if isinstance(last_ok, (int, float)) and (now - float(last_ok)) <= _PEER_STALE_SECONDS:
            active = True
        if not active:
            to_drop.append(pk)
    for pk in to_drop:
        _known_peers.pop(pk, None)
        _peer_lifecycle.pop(pk, None)
        log(f"[presence_bridge] target=presence-reticulum peer_pruned_stale peer_hash={pk}")


def _request_path_if_eligible(peer_key: str, h: bytes, nudge_budget: list[int]) -> None:
    """Nudge Reticulum path discovery when appropriate (throttled)."""
    if nudge_budget[0] <= 0:
        return
    st = _peer_lifecycle.get(peer_key) or {}
    now = time.time()
    last_rp = st.get("last_request_path_at")
    if isinstance(last_rp, (int, float)) and (now - float(last_rp)) < _REQUEST_PATH_COOLDOWN_SECONDS:
        return
    has_path = True
    try:
        has_path = bool(RNS.Transport.has_path(h))
    except Exception:
        has_path = False
    last_ok = st.get("last_send_ok")
    recently_sent = isinstance(last_ok, (int, float)) and (now - float(last_ok)) < 180.0
    if has_path and recently_sent:
        return
    try:
        RNS.Transport.request_path(h)
        if peer_key not in _peer_lifecycle:
            _peer_lifecycle[peer_key] = {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            }
        _peer_lifecycle[peer_key]["last_request_path_at"] = now
        nudge_budget[0] -= 1
        log(
            f"[presence_bridge] target=presence-reticulum request_path peer={peer_key} "
            f"has_path={has_path}"
        )
    except Exception as exc:
        log(f"[presence_bridge] target=presence-reticulum request_path_failed peer={peer_key}: {exc}")


def _nudge_overlay_path_for_peer(peer_key: str) -> None:
    """
    Ask Reticulum to resolve a destination we need for overlay group_signal fanout.
    Throttled; pairs with ensure_known_peer_from_recall on the next tick.
    """
    try:
        h = bytes.fromhex(peer_key)
    except ValueError:
        return
    if len(h) != 16:
        return
    now = time.time()
    st = _peer_lifecycle.get(peer_key) or {}
    last_rp = st.get("last_request_path_at")
    if isinstance(last_rp, (int, float)) and (now - float(last_rp)) < _REQUEST_PATH_COOLDOWN_SECONDS:
        return
    try:
        RNS.Transport.request_path(h)
        if peer_key not in _peer_lifecycle:
            _peer_lifecycle[peer_key] = {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            }
        _peer_lifecycle[peer_key]["last_request_path_at"] = now
        log(
            f"[presence_bridge] target=presence-reticulum overlay_path_nudge peer={peer_key} "
            "reason=group_signal_unknown_peer"
        )
    except Exception as exc:
        log(
            f"[presence_bridge] target=presence-reticulum overlay_path_nudge_failed "
            f"peer={peer_key}: {exc}"
        )


def _get_call_media_state(peer_hash: str) -> Dict[str, Any]:
    state = _call_media_path_state.get(peer_hash)
    if state is not None:
        return state
    state = {
        "path_state": "unknown",
        "destination_hash_hex": "",
        "last_request_path_at": None,
        "last_resolved_at": None,
        "last_timeout_at": None,
        "last_send_ok": None,
        "last_send_fail": None,
        "last_inbound_at": None,
        "last_state_change_at": None,
        "last_transition_reason": "",
        "consecutive_timeouts": 0,
    }
    _call_media_path_state[peer_hash] = state
    return state


_CALL_MEDIA_PATH_ALLOWED_TRANSITIONS: Dict[str, set[str]] = {
    "unknown": {"warming"},
    "warming": {"fresh", "stale", "failing"},
    "fresh": {"stale"},
    "stale": {"warming", "failing", "fresh"},
    "failing": {"recovering", "stale"},
    "recovering": {"fresh", "failing", "stale"},
}


def _transition_call_media_path_state(
    peer_hash: str, next_state: str, reason: str = ""
) -> str:
    state = _get_call_media_state(peer_hash)
    current = str(state.get("path_state") or "unknown")
    if current == next_state:
        return current
    allowed = _CALL_MEDIA_PATH_ALLOWED_TRANSITIONS.get(current, set())
    if next_state not in allowed:
        log(
            "[presence_bridge] target=reticulum-audio-ipc packet_path_invalid_transition "
            f"peer={peer_hash} current={current} next={next_state} reason={reason}"
        )
        return current
    state["path_state"] = next_state
    state["last_state_change_at"] = time.time()
    state["last_transition_reason"] = reason
    return next_state


def _reset_call_media_state(
    peer_hash: str, destination_hash: bytes, reason: str = "destination_changed"
) -> Dict[str, Any]:
    state = _get_call_media_state(peer_hash)
    state["path_state"] = "unknown"
    state["destination_hash_hex"] = destination_hash_hex(destination_hash)
    state["last_request_path_at"] = None
    state["last_resolved_at"] = None
    state["last_timeout_at"] = None
    state["last_send_ok"] = None
    state["last_send_fail"] = None
    state["last_inbound_at"] = None
    state["last_state_change_at"] = time.time()
    state["last_transition_reason"] = reason
    state["consecutive_timeouts"] = 0
    return state


def _classify_call_media_path_state(peer_hash: str, destination_hash: bytes) -> str:
    now = time.time()
    state = _get_call_media_state(peer_hash)
    dest_hex = destination_hash_hex(destination_hash)
    if state.get("destination_hash_hex") != dest_hex:
        state = _reset_call_media_state(peer_hash, destination_hash)
    has_path = False
    try:
        has_path = bool(RNS.Transport.has_path(destination_hash))
    except Exception:
        has_path = False
    if not has_path:
        if str(state.get("path_state") or "unknown") == "unknown":
            return "unknown"
        return str(state.get("path_state") or "unknown")
    last_send_ok = state.get("last_send_ok")
    last_send_fail = state.get("last_send_fail")
    last_inbound = state.get("last_inbound_at")
    recent_ok = isinstance(last_send_ok, (int, float)) and (
        now - float(last_send_ok)
    ) <= _PACKET_PATH_FRESH_SECONDS
    recent_inbound = isinstance(last_inbound, (int, float)) and (
        now - float(last_inbound)
    ) <= _PACKET_PATH_INBOUND_FRESH_SECONDS
    recent_fail = isinstance(last_send_fail, (int, float)) and (
        now - float(last_send_fail)
    ) <= _PACKET_PATH_RECENT_FAILURE_SECONDS
    if (recent_ok or recent_inbound) and not recent_fail:
        return "fresh"
    current = str(state.get("path_state") or "unknown")
    if current in ("failing", "recovering"):
        return current
    return "stale"


def _ensure_call_media_path(
    peer_hash: str,
    destination_hash: bytes,
    *,
    active_call: bool = True,
    allow_wait: bool = True,
    reason: str = "send",
    await_seconds_override: Optional[float] = None,
) -> tuple[str, bool]:
    global _audio_packet_path_requests, _audio_packet_path_resolutions, _audio_packet_path_timeouts
    state = _get_call_media_state(peer_hash)
    dest_hex = destination_hash_hex(destination_hash)
    if state.get("destination_hash_hex") != dest_hex:
        state = _reset_call_media_state(peer_hash, destination_hash)
    initial_state = _classify_call_media_path_state(peer_hash, destination_hash)
    if initial_state == "fresh":
        state["consecutive_timeouts"] = 0
        return initial_state, True
    if initial_state == "stale" and str(state.get("path_state") or "") == "fresh":
        _transition_call_media_path_state(peer_hash, "stale", "fresh_expired")
        initial_state = "stale"
    now = time.time()
    last_rp = state.get("last_request_path_at")
    request_cooldown = (
        _PACKET_PATH_ACTIVE_REQUEST_COOLDOWN_SECONDS
        if active_call
        else _PACKET_PATH_IDLE_REQUEST_COOLDOWN_SECONDS
    )
    should_request = not (
        isinstance(last_rp, (int, float))
        and (now - float(last_rp)) < request_cooldown
    )
    requested = False
    used_request_await = False
    resolved = False
    await_seconds = (
        float(await_seconds_override)
        if await_seconds_override is not None
        else (
            _PACKET_PATH_AWAIT_SECONDS
            if active_call
            else _PACKET_PATH_IDLE_AWAIT_SECONDS
        )
    )
    if should_request:
        current = str(state.get("path_state") or "unknown")
        if current == "unknown":
            _transition_call_media_path_state(peer_hash, "warming", f"{reason}:request_path")
        elif current == "stale":
            _transition_call_media_path_state(peer_hash, "warming", f"{reason}:refresh_path")
        elif current == "failing":
            _transition_call_media_path_state(peer_hash, "recovering", f"{reason}:recover_path")
        if allow_wait and await_seconds > 0:
            used_request_await = True
            resolved, requested = _request_and_await_destination_path(
                destination_hash,
                await_seconds,
                log_context=f"call_media_path peer={peer_hash} reason={reason}",
            )
        else:
            try:
                RNS.Transport.request_path(destination_hash)
                requested = True
            except Exception as exc:
                log(
                    "[presence_bridge] target=reticulum-audio-ipc packet_path_request_failed "
                    f"peer={peer_hash} err={exc}"
                )
    if requested:
        state["last_request_path_at"] = now
        _audio_packet_path_requests += 1
        _mark_audio_queue_state_dirty()
    if not should_request:
        resolved = False
    if not resolved and not used_request_await:
        if allow_wait and await_seconds > 0:
            resolved = _await_destination_path(destination_hash, await_seconds)
        else:
            try:
                resolved = bool(RNS.Transport.has_path(destination_hash))
            except Exception:
                resolved = False
    if resolved:
        current = str(state.get("path_state") or "unknown")
        if current == "unknown":
            _transition_call_media_path_state(peer_hash, "warming", f"{reason}:resolved")
            current = "warming"
        if current == "failing":
            _transition_call_media_path_state(peer_hash, "recovering", f"{reason}:resolved")
        _transition_call_media_path_state(peer_hash, "fresh", f"{reason}:resolved")
        state["last_resolved_at"] = time.time()
        state["consecutive_timeouts"] = 0
        _audio_packet_path_resolutions += 1
        _mark_audio_queue_state_dirty()
        return str(state.get("path_state") or "fresh"), True
    try:
        resolved = bool(RNS.Transport.has_path(destination_hash))
    except Exception:
        resolved = False
    if resolved:
        current = str(state.get("path_state") or "unknown")
        if current == "unknown":
            _transition_call_media_path_state(peer_hash, "warming", f"{reason}:has_path")
            current = "warming"
        if current == "failing":
            _transition_call_media_path_state(peer_hash, "recovering", f"{reason}:has_path")
        _transition_call_media_path_state(peer_hash, "fresh", f"{reason}:has_path")
        state["last_resolved_at"] = time.time()
        state["consecutive_timeouts"] = 0
        _audio_packet_path_resolutions += 1
        _mark_audio_queue_state_dirty()
        return str(state.get("path_state") or "fresh"), True
    _audio_packet_path_timeouts += 1
    state["last_timeout_at"] = time.time()
    state["consecutive_timeouts"] = int(state.get("consecutive_timeouts") or 0) + 1
    current = str(state.get("path_state") or "unknown")
    if current == "warming":
        _transition_call_media_path_state(peer_hash, "stale", f"{reason}:timeout")
        current = "stale"
    if current == "stale" and (
        int(state.get("consecutive_timeouts") or 0)
        >= _PACKET_PATH_WARMING_TIMEOUTS_BEFORE_FAILING
    ):
        _transition_call_media_path_state(peer_hash, "failing", f"{reason}:timeout")
    elif current == "recovering":
        _transition_call_media_path_state(peer_hash, "failing", f"{reason}:recover_timeout")
    _mark_audio_queue_state_dirty()
    return str(state.get("path_state") or initial_state), False


def _await_destination_path(destination_hash: bytes, timeout_seconds: float) -> bool:
    if timeout_seconds <= 0:
        try:
            return bool(RNS.Transport.has_path(destination_hash))
        except Exception:
            return False
    deadline = time.time() + timeout_seconds
    while True:
        try:
            resolved = bool(RNS.Transport.has_path(destination_hash))
        except Exception:
            resolved = False
        if resolved:
            return True
        remaining = deadline - time.time()
        if remaining <= 0:
            return False
        time.sleep(min(_PACKET_PATH_POLL_INTERVAL_SECONDS, remaining))


def _request_and_await_destination_path(
    destination_hash: bytes,
    timeout_seconds: float,
    *,
    log_context: str,
) -> tuple[bool, bool]:
    try:
        if RNS.Transport.has_path(destination_hash):
            return True, False
    except Exception:
        pass

    requested = False
    try:
        await_path = getattr(RNS.Transport, "await_path", None)
        if callable(await_path) and timeout_seconds > 0:
            requested = True
            return bool(await_path(destination_hash, timeout_seconds)), requested
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum path_await_failed "
            f"{log_context} err={exc}"
        )

    try:
        RNS.Transport.request_path(destination_hash)
        requested = True
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum path_request_failed "
            f"{log_context} err={exc}"
        )
        return False, requested

    return _await_destination_path(destination_hash, timeout_seconds), requested


def _nudge_overlay_link_path(
    peer_key: str,
    destination_hash: bytes,
    *,
    await_seconds: float = 0.0,
) -> bool:
    try:
        if RNS.Transport.has_path(destination_hash):
            return True
    except Exception:
        pass

    now = time.time()
    st = _peer_lifecycle.get(peer_key) or {}
    last_rp = st.get("last_request_path_at")
    should_request = not (
        isinstance(last_rp, (int, float))
        and (now - float(last_rp)) < _OVERLAY_LINK_PATH_REQUEST_COOLDOWN_SECONDS
    )
    if should_request:
        if await_seconds > 0:
            resolved, requested = _request_and_await_destination_path(
                destination_hash,
                await_seconds,
                log_context=f"overlay_link_path peer={peer_key}",
            )
            if requested:
                if peer_key not in _peer_lifecycle:
                    _peer_lifecycle[peer_key] = {
                        "last_seen_inbound": None,
                        "last_send_ok": None,
                        "last_request_path_at": None,
                        "ts_seed_until": None,
                    }
                _peer_lifecycle[peer_key]["last_request_path_at"] = now
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_path_request "
                    f"peer={peer_key} await={await_seconds} resolved={str(resolved).lower()}"
                )
            if resolved:
                return True
        else:
            try:
                RNS.Transport.request_path(destination_hash)
                if peer_key not in _peer_lifecycle:
                    _peer_lifecycle[peer_key] = {
                        "last_seen_inbound": None,
                        "last_send_ok": None,
                        "last_request_path_at": None,
                        "ts_seed_until": None,
                    }
                _peer_lifecycle[peer_key]["last_request_path_at"] = now
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_path_request "
                    f"peer={peer_key}"
                )
            except Exception as exc:
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_path_request_failed "
                    f"peer={peer_key}: {exc}"
                )
    if await_seconds > 0:
        return _await_destination_path(destination_hash, await_seconds)
    return False


def _note_call_media_inbound(peer_hash: str, sender_call_hash: str = "") -> None:
    if not peer_hash:
        return
    state = _get_call_media_state(peer_hash)
    now = time.time()
    if sender_call_hash:
        state["destination_hash_hex"] = str(sender_call_hash or "").strip().lower()
    state["last_inbound_at"] = now
    state["last_resolved_at"] = now
    state["consecutive_timeouts"] = 0
    current = str(state.get("path_state") or "unknown")
    if current == "unknown":
        _transition_call_media_path_state(peer_hash, "warming", "inbound_packet")
        current = "warming"
    if current == "failing":
        _transition_call_media_path_state(peer_hash, "recovering", "inbound_packet")
    if str(state.get("path_state") or "") in ("warming", "stale", "recovering"):
        _transition_call_media_path_state(peer_hash, "fresh", "inbound_packet")


def _note_call_media_send_result(peer_hash: str, ok: bool) -> None:
    state = _get_call_media_state(peer_hash)
    now = time.time()
    if ok:
        state["last_send_ok"] = now
        state["last_resolved_at"] = now
        state["consecutive_timeouts"] = 0
        current = str(state.get("path_state") or "unknown")
        if current == "unknown":
            _transition_call_media_path_state(peer_hash, "warming", "send_ok")
            current = "warming"
        if current == "failing":
            _transition_call_media_path_state(peer_hash, "recovering", "send_ok")
        if str(state.get("path_state") or "") in ("warming", "stale", "recovering"):
            _transition_call_media_path_state(peer_hash, "fresh", "send_ok")
    else:
        state["last_send_fail"] = now
        current = str(state.get("path_state") or "unknown")
        if current == "fresh":
            _transition_call_media_path_state(peer_hash, "stale", "send_fail")
            current = "stale"
        if current == "stale":
            _transition_call_media_path_state(peer_hash, "failing", "send_fail")


def _warm_call_media_path_if_possible(
    peer_hash: str,
    *,
    active_call: bool,
    allow_wait: bool,
    reason: str,
) -> tuple[str, bool]:
    peer_identity = _get_group_audio_peer_identity(peer_hash)
    if peer_identity is None:
        return "unknown", False
    try:
        outbound = build_outbound_destination(peer_identity)
    except Exception as exc:
        log(
            "[presence_bridge] target=reticulum-audio-ipc packet_path_build_failed "
            f"peer={peer_hash} err={exc}"
        )
        return "unknown", False
    return _ensure_call_media_path(
        peer_hash,
        outbound.hash,
        active_call=active_call,
        allow_wait=allow_wait,
        reason=reason,
    )


def identity_hash_hex(identity: Any) -> str:
    raw = getattr(identity, "hash", None)
    if isinstance(raw, bytes):
        return destination_hash_hex(raw)
    return ""


def derive_presence_destination_hash_for_identity(identity: Any) -> str:
    try:
        outbound = build_outbound_destination(identity)
    except Exception:
        return ""
    return destination_hash_hex(outbound.hash)


def find_peer_hash_for_identity(identity: Any) -> str:
    identity_hash = identity_hash_hex(identity)
    if not identity_hash:
        return ""
    for peer_hash, peer_identity in list(_known_peers.items()):
        if identity_hash_hex(peer_identity) == identity_hash:
            return peer_hash
    return ""


def ensure_known_peer_from_recall(
    peer_hash_hex: str, registration_source: str = "recall"
) -> bool:
    """
    Mirror RNS's known destination into _known_peers when we see traffic but missed the announce.
    Uses RNS.Identity.recall(destination_hash).
    registration_source: recall | ts_seed (TS-supplied hashes refresh seed lease).
    """
    if not peer_hash_hex or _destination is None:
        return False
    peer_key = peer_hash_hex.lower()
    local_hex = destination_hash_hex(_destination.hash)
    if peer_key == local_hex:
        return False
    if peer_key in _known_peers:
        if registration_source == "ts_seed":
            _refresh_ts_seed_only(peer_key)
        return True
    try:
        h = bytes.fromhex(peer_hash_hex)
    except ValueError:
        return False
    if len(h) != 16:
        return False
    recalled = RNS.Identity.recall(h)
    if recalled is None:
        return False
    try:
        derived = derive_presence_destination_hash_for_identity(recalled)
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum recall_build_failed "
            f"peer={peer_key} err={exc}"
        )
        return False
    if not derived:
        log(
            "[presence_bridge] target=presence-reticulum recall_build_failed "
            f"peer={peer_key} err=empty_derived_hash"
        )
        return False
    if derived != peer_key:
        log(
            "[presence_bridge] target=presence-reticulum recall_hash_mismatch "
            f"peer={peer_key} derived={derived}"
        )
        return False
    _register_peer(peer_key, recalled, registration_source)
    return True


def ensure_known_peer_from_wire_kr(public_key_base58: str, peer_hash_hex: str) -> bool:
    """
    When Identity.recall(r) failed, derive RNS destination from wire k (Base58) and verify
    it matches r. Only works when k decodes to a full RNS public key (64 bytes: X25519+Ed25519).
    Qortal's usual 32-byte Ed25519-only k cannot be used here; those peers rely on recall/TS seed.
    """
    if not peer_hash_hex or _destination is None:
        return False
    peer_key = peer_hash_hex.lower()
    if peer_key in _known_peers:
        return True
    local_hex = destination_hash_hex(_destination.hash)
    if peer_key == local_hex:
        return False
    try:
        pub_bytes = qortal_base58_decode(public_key_base58)
    except Exception:
        return False
    if len(pub_bytes) != 64:
        if peer_key not in _KR_MISMATCH_LOGGED:
            _KR_MISMATCH_LOGGED.add(peer_key)
            log(
                f"[presence_bridge] target=presence-reticulum kr_skip peer={peer_key} "
                f"reason=pub_len_{len(pub_bytes)}_not_64_rns_full_key"
            )
        return False
    try:
        ident = RNS.Identity(create_keys=False)
        ident.load_public_key(pub_bytes)
        outbound = RNS.Destination(
            ident,
            RNS.Destination.OUT,
            RNS.Destination.SINGLE,
            APP_NAMESPACE,
            PRESENCE_ASPECT,
            PRESENCE_VERSION,
        )
        derived = destination_hash_hex(outbound.hash)
    except Exception as exc:
        log(
            f"[presence_bridge] target=presence-reticulum kr_skip peer={peer_key} err={exc}"
        )
        return False
    if derived != peer_key:
        if peer_key not in _KR_MISMATCH_LOGGED:
            _KR_MISMATCH_LOGGED.add(peer_key)
            log(
                f"[presence_bridge] target=presence-reticulum kr_mismatch peer={peer_key} "
                f"derived={derived}"
            )
        return False
    _register_peer(peer_key, ident, "wire_kr")
    return True


def ensure_identity(config_dir: str):
    global _identity

    identity_path = os.environ.get("QORTAL_RETICULUM_IDENTITY_PATH") or os.path.join(
        config_dir, IDENTITY_FILENAME
    )
    if os.path.exists(identity_path):
        loaded = RNS.Identity.from_file(identity_path)
        if loaded is not None:
            _identity = loaded
            return _identity

    _identity = RNS.Identity()
    _identity.to_file(identity_path)
    return _identity


class PresenceAnnounceHandler:
    def __init__(self, local_hash: bytes):
        self.aspect_filter = f"{APP_NAMESPACE}.{PRESENCE_ASPECT}.{PRESENCE_VERSION}"
        self.local_hash = local_hash

    def received_announce(self, destination_hash, announced_identity, app_data):
        if destination_hash == self.local_hash:
            return
        peer_hash = destination_hash_hex(destination_hash)
        app_data_len = len(app_data) if app_data is not None else 0
        log(
            f"[presence_bridge] received announce peer={peer_hash} app_data_len={app_data_len}"
        )
        _register_peer(peer_hash, announced_identity, "announce")
        _mark_candidate_peer(peer_hash, "announce")
        _retry_pending_overlay_connect_on_announce(peer_hash)


def build_outbound_destination(peer_identity):
    return RNS.Destination(
        peer_identity,
        RNS.Destination.OUT,
        RNS.Destination.SINGLE,
        APP_NAMESPACE,
        PRESENCE_ASPECT,
        PRESENCE_VERSION,
    )


def get_overlay_link_id(link) -> Optional[str]:
    if link is None:
        return None
    with _state_lock:
        return _overlay_link_ids_by_object.get(id(link))


def get_overlay_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        return _overlay_links_by_id.get(link_id)


def remove_overlay_link(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        state = _overlay_links_by_id.pop(link_id, None)
        if not state:
            return None
        link = state.get("link")
        if link is not None:
            _overlay_link_ids_by_object.pop(id(link), None)
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_hash:
            existing = _active_overlay_link_id_by_peer_hash.get(peer_hash)
            if existing == link_id:
                _active_overlay_link_id_by_peer_hash.pop(peer_hash, None)
        return state


def emit_overlay_link_state(
    link_id: str,
    state: Dict[str, Any],
    reason: str = "",
    *,
    closed_by_reticulum: bool = False,
) -> None:
    emit_event(
        "overlay_link_state",
        {
            "linkId": link_id,
            "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
            "incoming": state.get("incoming") is True,
            "established": state.get("established") is True,
            "reason": reason,
            "queuedPackets": len(state.get("pending_packets") or []),
            "closedByReticulum": closed_by_reticulum,
        },
    )


def _queue_overlay_packet(state: Dict[str, Any], traffic: str, wire_bytes: bytes) -> None:
    pending = state.get("pending_packets")
    if pending is None:
        pending = deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT)
        state["pending_packets"] = pending
    pending.append((traffic, bytes(wire_bytes)))


def _send_packet_on_link(link, wire_bytes: bytes, log_target: str) -> bool:
    try:
        packet = RNS.Packet(link, wire_bytes, create_receipt=False)
        result = packet.send()
        if result is False:
            log(f"[presence_bridge] {log_target} packet_send_false")
            return False
        return True
    except Exception as exc:
        log(f"[presence_bridge] {log_target} packet_send_exception err={exc}")
        return False


def _valid_presence_destination_hash_hex(peer_hash: str) -> bool:
    h = str(peer_hash or "").strip().lower()
    if len(h) != 32:
        return False
    try:
        bytes.fromhex(h)
    except ValueError:
        return False
    return True


def _dedup_age_ts(state: Dict[str, Any], both_established: bool) -> float:
    """Monotonic-ish sort key: lower = older link (prefer keeping)."""
    if both_established:
        t = state.get("established_at")
        if isinstance(t, (int, float)):
            return float(t)
        t = state.get("created_at")
        if isinstance(t, (int, float)):
            return float(t)
        return 0.0
    t = state.get("created_at")
    if isinstance(t, (int, float)):
        return float(t)
    return 0.0


def _dedup_pick_keep_link(
    peer_key: str,
    link_id_a: str,
    state_a: Dict[str, Any],
    link_id_b: str,
    state_b: Dict[str, Any],
) -> tuple[str, str]:
    """Return (keep_link_id, teardown_link_id) for two links to the same peer."""
    incoming_a = state_a.get("incoming") is True
    incoming_b = state_b.get("incoming") is True
    if incoming_a != incoming_b:
        local_hex = _local_presence_hash_hex()
        if local_hex and _valid_presence_destination_hash_hex(peer_key):
            # Deterministic duplicate resolution for simultaneous dials:
            # lower hash keeps the outbound link, higher hash keeps the incoming link.
            prefer_incoming = local_hex > peer_key
            if incoming_a == prefer_incoming:
                return link_id_a, link_id_b
            return link_id_b, link_id_a
    est_a = state_a.get("established") is True
    est_b = state_b.get("established") is True
    if est_a and not est_b:
        return link_id_a, link_id_b
    if est_b and not est_a:
        return link_id_b, link_id_a
    both_est = est_a and est_b
    ta = _dedup_age_ts(state_a, both_est)
    tb = _dedup_age_ts(state_b, both_est)
    if ta != tb:
        return (link_id_a, link_id_b) if ta < tb else (link_id_b, link_id_a)
    return (link_id_a, link_id_b) if link_id_a < link_id_b else (link_id_b, link_id_a)


def _should_initiate_overlay_link(peer_key: str) -> bool:
    local_hex = _local_presence_hash_hex()
    return not (
        local_hex
        and _valid_presence_destination_hash_hex(peer_key)
        and local_hex > peer_key
    )


def _teardown_overlay_link_id(link_id: str, reason: str) -> None:
    state = remove_overlay_link(link_id)
    if state is None:
        return
    link = state.get("link")
    if link is not None:
        try:
            link.teardown()
        except Exception:
            pass
    state["established"] = False
    emit_overlay_link_state(link_id, state, reason)


def _register_active_overlay_for_peer(peer_key: str, link_id: str) -> Optional[Dict[str, Any]]:
    """One active overlay link per peer hash; teardown duplicate links."""
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return None
    lose_id: Optional[str] = None
    with _state_lock:
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key)
        if existing_link_id == link_id:
            return _overlay_links_by_id.get(link_id)
        if not existing_link_id:
            _active_overlay_link_id_by_peer_hash[peer_key] = link_id
            return _overlay_links_by_id.get(link_id)
        st_new = _overlay_links_by_id.get(link_id)
        st_old = _overlay_links_by_id.get(existing_link_id)
        if st_new is None:
            if st_old is not None:
                return st_old
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            return None
        if st_old is None:
            _active_overlay_link_id_by_peer_hash[peer_key] = link_id
            return st_new
        keep_id, lose_id = _dedup_pick_keep_link(
            peer_key,
            existing_link_id, st_old, link_id, st_new
        )
        _active_overlay_link_id_by_peer_hash[peer_key] = keep_id
        keep_state = _overlay_links_by_id.get(keep_id)
    if lose_id:
        log(
            "[presence_bridge] target=presence-reticulum overlay_dedup_peer "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        _teardown_overlay_link_id(lose_id, "dedup_same_peer")
    return keep_state


def _flush_overlay_link_pending(link_id: str) -> None:
    state = get_overlay_link_state(link_id)
    if state is None or state.get("established") is not True:
        return
    link = state.get("link")
    pending = state.get("pending_packets")
    if link is None or pending is None:
        return
    while pending:
        traffic, wire_bytes = pending[0]
        if not _send_packet_on_link(
            link,
            wire_bytes,
            f"target=presence-reticulum overlay_link_flush peer={state.get('peerPresenceHash') or 'unknown'} traffic={traffic}",
        ):
            break
        pending.popleft()
    emit_overlay_link_state(link_id, state, "flush")


def _ensure_overlay_link(
    peer_hash: str, respect_dial_owner: bool = True
) -> Optional[Dict[str, Any]]:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return None
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_skipped_self "
            f"peer={peer_key}"
        )
        return None
    with _state_lock:
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key)
        if existing_link_id:
            existing = _overlay_links_by_id.get(existing_link_id)
            if existing is not None:
                return existing
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
    if respect_dial_owner and not _should_initiate_overlay_link(peer_key):
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_wait_incoming "
            f"peer={peer_key}"
        )
        return None
    link_id = ""
    state: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    outbound = None
    try:
        with _state_lock:
            peer_identity = _known_peers.get(peer_key)
            if peer_identity is None:
                return None
            outbound = build_outbound_destination(peer_identity)
            outbound_hash = destination_hash_hex(outbound.hash)
            if local_hex and outbound_hash == local_hex:
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_rejected_self_identity "
                    f"peer={peer_key} derived={outbound_hash}"
                )
                _known_peers.pop(peer_key, None)
                _peer_lifecycle.pop(peer_key, None)
                return None
            if outbound_hash != peer_key:
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_hash_mismatch "
                    f"peer={peer_key} derived={outbound_hash}"
                )
                _known_peers.pop(peer_key, None)
                _peer_lifecycle.pop(peer_key, None)
                return None
        if outbound is not None:
            if not _nudge_overlay_link_path(
                peer_key,
                outbound.hash,
                await_seconds=_OVERLAY_LINK_PATH_AWAIT_SECONDS,
            ):
                log(
                    "[presence_bridge] target=presence-reticulum "
                    "overlay_link_deferred_no_path "
                    f"peer={peer_key} await={_OVERLAY_LINK_PATH_AWAIT_SECONDS}"
                )
                return None
        with _state_lock:
            existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key)
            if existing_link_id:
                existing = _overlay_links_by_id.get(existing_link_id)
                if existing is not None:
                    return existing
                _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            if outbound is None:
                return None
            link_id = str(uuid.uuid4())
            link = RNS.Link(
                outbound,
                established_callback=on_outgoing_overlay_link_established,
                closed_callback=on_overlay_link_closed,
            )
            now = time.time()
            state = {
                "link": link,
                "peerPresenceHash": peer_key,
                "incoming": False,
                "established": False,
                "created_at": now,
                "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
            }
            _overlay_links_by_id[link_id] = state
            _overlay_link_ids_by_object[id(link)] = link_id
    except Exception as exc:
        error = str(exc)
    if error is not None:
        log(
            f"[presence_bridge] target=presence-reticulum overlay_link_connect_failed peer={peer_key}: {error}"
        )
        return None
    if state is None or not link_id:
        return None
    _register_active_overlay_for_peer(peer_key, link_id)
    state = get_overlay_link_state(link_id)
    if state is None:
        with _state_lock:
            fallback_id = _active_overlay_link_id_by_peer_hash.get(peer_key)
        if fallback_id:
            state = get_overlay_link_state(fallback_id)
    if state is None:
        return None
    st_new = get_overlay_link_state(link_id)
    if st_new is not None and st_new.get("incoming") is not True:
        emit_overlay_link_state(link_id, st_new, "connecting")
    log(
        f"[presence_bridge] target=presence-reticulum overlay_link_connect peer={peer_key}"
    )
    return state


def _retry_pending_overlay_connect_on_announce(peer_hash: str) -> None:
    """If an outbound reverse dial started before path resolution, retry it after announce arrives."""
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return
    if not _should_initiate_overlay_link(peer_key):
        return
    link = None
    existing_link_id = ""
    stale_state: Optional[Dict[str, Any]] = None
    with _state_lock:
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        if not existing_link_id:
            return
        existing = _overlay_links_by_id.get(existing_link_id)
        if existing is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            return
        if existing.get("incoming") is True or existing.get("established") is True:
            return
        link = existing.get("link")
        if link is not None:
            try:
                link.set_link_closed_callback(None)
            except Exception:
                pass
        stale_state = remove_overlay_link(existing_link_id)
    if link is not None:
        try:
            link.teardown()
        except Exception:
            pass
    if stale_state is not None:
        stale_state["established"] = False
        emit_overlay_link_state(existing_link_id, stale_state, "announce_retry")
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce "
            f"peer={peer_key} previous_link={existing_link_id}"
        )
    _ensure_overlay_link(peer_key)


def _sync_overlay_links() -> None:
    desired = set(_active_overlay_neighbors.keys())
    for peer_hash in desired:
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        _ensure_overlay_link(peer_hash, respect_dial_owner=True)
    for peer_hash, link_id in list(_active_overlay_link_id_by_peer_hash.items()):
        if peer_hash in desired:
            continue
        state = get_overlay_link_state(link_id)
        if state is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_hash, None)
            continue
        if state.get("incoming") is True:
            continue
        _teardown_overlay_link_id(link_id, "pruned")
    for link_id, state in list(_overlay_links_by_id.items()):
        if state.get("incoming") is True:
            continue
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_hash)
        if active_link_id == link_id:
            continue
        if peer_hash not in desired:
            _teardown_overlay_link_id(link_id, "pruned_orphan")
        elif active_link_id:
            _teardown_overlay_link_id(link_id, "dedup_orphan")


def _resolve_sender_peer_destination_hash(sender_hex: str) -> str:
    """Map wire `r` (destination hash hex) to peer key in _known_peers; recall fallback."""
    sender_hex = str(sender_hex or "").strip().lower()
    if not sender_hex:
        return ""
    if sender_hex in _known_peers:
        return sender_hex
    # Register via recall (same as presence inbound). Previously we only recalled and
    # looked up find_peer_hash_for_identity, which stayed empty until another path registered.
    if ensure_known_peer_from_recall(sender_hex, "inbound"):
        return sender_hex
    return ""


def _emit_presence_message(message: Dict[str, Any], link_id: Optional[str] = None) -> bool:
    message_type = message.get("t")
    message_id = message.get("i")
    address = message.get("a")
    public_key = message.get("k")
    session_id = message.get("n")
    timestamp = message.get("m")
    signature = message.get("g")
    sender_hash = message.get("r")
    origin_hash = message.get("o")
    overlay_hops_remaining = message.get("q")

    if (
        not isinstance(message_type, str)
        or not isinstance(message_id, str)
        or not isinstance(address, str)
        or not isinstance(public_key, str)
        or not isinstance(session_id, str)
        or not isinstance(timestamp, int)
        or not isinstance(signature, str)
        or not isinstance(sender_hash, str)
    ):
        log("[presence_bridge] ignored malformed presence packet")
        return False
    sender_hash = sender_hash.strip().lower()
    if not _valid_presence_destination_hash_hex(sender_hash):
        log("[presence_bridge] ignored malformed presence packet sender_hash")
        return False
    origin_peer_hash = sender_hash
    if isinstance(origin_hash, str) and origin_hash.strip():
        candidate_origin_hash = origin_hash.strip().lower()
        if not _valid_presence_destination_hash_hex(candidate_origin_hash):
            log("[presence_bridge] ignored malformed presence packet origin_hash")
            return False
        origin_peer_hash = candidate_origin_hash

    payload: Dict[str, Any] = {
        "address": address,
        "publicKey": public_key,
        "sessionId": session_id,
    }
    if message_type == "PRESENCE_ANNOUNCE":
        payload["status"] = message.get("s")
        payload["clientVersion"] = message.get("c")
    elif message_type == "PRESENCE_HEARTBEAT":
        payload["status"] = message.get("s")
    elif message_type == "PRESENCE_OFFLINE":
        payload["status"] = "offline"
    else:
        log(f"[presence_bridge] ignored unknown presence packet type={message_type}")
        return False

    envelope = {
        "id": message_id,
        "type": message_type,
        "senderAddress": address,
        "timestamp": timestamp,
        "payload": payload,
        "signature": signature,
    }

    _recent_presence_senders.append(sender_hash)
    ensure_known_peer_from_recall(sender_hash)
    if origin_peer_hash != sender_hash:
        ensure_known_peer_from_recall(origin_peer_hash)
    if origin_peer_hash not in _known_peers:
        ensure_known_peer_from_wire_kr(public_key, origin_peer_hash)
    if origin_peer_hash in _known_peers:
        st = _peer_lifecycle.setdefault(
            origin_peer_hash,
            {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            },
        )
        now = time.time()
        st["last_seen_inbound"] = now
        lease = st.get("ts_seed_until")
        if isinstance(lease, (int, float)) and now < float(lease):
            log(
                "[presence_bridge] target=presence-reticulum ts_seed_confirmed "
                f"peer={origin_peer_hash[:24]}..."
            )

    route: Dict[str, Any] = {
        "kind": "reticulum",
        "destinationHash": origin_peer_hash,
        "overlayHopsRemaining": overlay_hops_remaining
        if isinstance(overlay_hops_remaining, int)
        else 0,
    }
    if origin_peer_hash != sender_hash:
        route["viaDestinationHash"] = sender_hash
    if link_id:
        route["linkId"] = link_id
    emit_event(
        "presence_message",
        {
            "envelope": envelope,
            "route": route,
        },
    )
    log(
        "[presence_bridge] received presence packet "
        f"sender={origin_peer_hash} via={sender_hash} "
        f"envelope_type={envelope.get('type')} size={len(_call_wire_json_bytes(message))}"
    )
    return True


def _emit_call_bridge_message(
    message: Dict[str, Any], peer_presence_hash: str = "", link_id: Optional[str] = None
) -> bool:
    sender_r = message.get("r")
    sender_call_hash = sender_r if isinstance(sender_r, str) else ""
    if sender_call_hash:
        ensure_known_peer_from_recall(sender_call_hash.strip().lower(), "inbound")
    resolved_presence_hash = (
        peer_presence_hash
        if isinstance(peer_presence_hash, str) and peer_presence_hash
        else _resolve_sender_peer_destination_hash(sender_call_hash)
    )
    t = message.get("t")
    event_name = (
        "group_call_message"
        if isinstance(t, str) and t in _GROUP_CALL_WIRE_TYPES
        else "call_message"
    )
    payload: Dict[str, Any] = {
        "wire": message,
        "senderDestinationHash": sender_call_hash,
        "peerPresenceHash": resolved_presence_hash,
    }
    if link_id:
        payload["linkId"] = link_id
    emit_event(event_name, payload)
    log(
        f"[presence_bridge] received {event_name} t={message.get('t')} sender_r={sender_call_hash[:16] if sender_call_hash else ''} size={len(_call_wire_json_bytes(message))}"
    )
    return True


def on_overlay_link_closed(link) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    teardown_reason = getattr(link, "teardown_reason", None)
    reason = str(teardown_reason) if teardown_reason is not None else "closed"
    state = remove_overlay_link(link_id)
    if state is None:
        return
    state["established"] = False
    emit_overlay_link_state(
        link_id,
        state,
        reason,
        closed_by_reticulum=True,
    )


def on_overlay_link_remote_identified(link, identity) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    derived_peer_hash = derive_presence_destination_hash_for_identity(identity)
    local_hex = _local_presence_hash_hex()
    if derived_peer_hash:
        expected = str(state.get("peerPresenceHash") or "").strip().lower()
        if local_hex and derived_peer_hash == local_hex:
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified_self "
                f"link={link_id} expected={expected or 'unknown'}"
            )
            _teardown_overlay_link_id(link_id, "remote_identified_self")
            return
        if expected and derived_peer_hash != expected:
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified_mismatch "
                f"link={link_id} expected={expected} derived={derived_peer_hash}"
            )
            _teardown_overlay_link_id(link_id, "remote_identified_mismatch")
            return
    peer_hash = find_peer_hash_for_identity(identity)
    if peer_hash:
        state["peerPresenceHash"] = peer_hash
        log(
            "[presence_bridge] target=presence-reticulum overlay_remote_identified "
            f"link={link_id} peer={peer_hash} source=known_identity"
        )
    else:
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_hash and _valid_presence_destination_hash_hex(peer_hash):
            _register_peer(peer_hash, identity, "inbound")
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified "
                f"link={link_id} peer={peer_hash} source=inbound_identity"
            )
        else:
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified "
                f"link={link_id} peer=unknown source=unbound"
            )
    emit_overlay_link_state(link_id, state, "identified")
    ph_reg = str(state.get("peerPresenceHash") or "").strip().lower()
    if ph_reg and _valid_presence_destination_hash_hex(ph_reg):
        _register_active_overlay_for_peer(ph_reg, link_id)


def on_overlay_link_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    link_id = get_overlay_link_id(link) if link is not None else None
    if link_id is None:
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid overlay link payload: {exc}")
        return
    if not isinstance(decoded, dict):
        return
    state["last_activity_at"] = time.time()
    t = decoded.get("t")
    if isinstance(t, str) and t.startswith("PRESENCE_"):
        if _emit_presence_message(decoded, link_id):
            peer_hash = str(decoded.get("r") or "").strip().lower()
            if peer_hash:
                state["peerPresenceHash"] = peer_hash
                _register_active_overlay_for_peer(peer_hash, link_id)
                emit_overlay_link_state(link_id, state, "rx_presence")
        return
    _emit_call_bridge_message(
        decoded,
        str(state.get("peerPresenceHash") or ""),
        link_id,
    )

def _sha256_file_hex(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _resource_file_path(resource) -> Optional[str]:
    storage_path = str(getattr(resource, "storagepath", "") or "")
    if storage_path and os.path.isfile(storage_path):
        return storage_path
    data = getattr(resource, "data", None)
    data_name = str(getattr(data, "name", "") or "")
    if data_name and os.path.isfile(data_name):
        return data_name
    return None


def _move_file_to_save_path(source_path: str, save_path: str) -> None:
    save_dir = os.path.dirname(save_path)
    os.makedirs(save_dir, exist_ok=True)
    try:
        os.replace(source_path, save_path)
        return
    except OSError:
        pass

    temp_path = os.path.join(
        save_dir,
        f".{os.path.basename(save_path)}.part-{uuid.uuid4().hex}",
    )
    try:
        with open(source_path, "rb") as src, open(temp_path, "wb") as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
        os.replace(temp_path, save_path)
    except Exception:
        try:
            if os.path.isfile(temp_path):
                os.unlink(temp_path)
        except Exception:
            pass
        raise


def _write_chunk_to_part_file(source_path: str, save_path: str, offset: int) -> None:
    part_path = save_path + ".part"
    save_dir = os.path.dirname(save_path)
    os.makedirs(save_dir, exist_ok=True)
    with open(source_path, "rb") as src, open(part_path, "r+b" if os.path.exists(part_path) else "w+b") as out:
        out.seek(offset)
        shutil.copyfileobj(src, out, 1024 * 1024)


def _qchat_file_chunk_count(size: int) -> int:
    if size <= 0:
        return 0
    return int(math.ceil(size / float(_QCHAT_FILE_CHUNK_SIZE)))


def _qchat_file_chunk_bounds(size: int, chunk_index: int) -> Tuple[int, int]:
    offset = chunk_index * _QCHAT_FILE_CHUNK_SIZE
    remaining = max(0, size - offset)
    return offset, min(_QCHAT_FILE_CHUNK_SIZE, remaining)


def _qchat_file_emit(status: str, payload: Dict[str, Any]) -> None:
    event_payload = dict(payload)
    event_payload["status"] = status
    emit_event("qchat_file_transfer", event_payload)


def _qchat_file_progress_payload(
    state: Dict[str, Any],
    progress: float,
    size: int,
) -> Dict[str, Any]:
    now = time.monotonic()
    started_at = float(state.get("progress_started_at") or 0)
    if started_at <= 0:
        started_at = now
        state["progress_started_at"] = started_at

    progress = max(0.0, min(1.0, float(progress)))
    payload: Dict[str, Any] = {"progress": progress}
    elapsed = max(0.001, now - started_at)
    if size > 0:
        bytes_done = int(size * progress)
        payload["bytesTransferred"] = bytes_done
        payload["bytesPerSecond"] = int(bytes_done / elapsed)
    return payload


def _should_emit_qchat_file_progress(
    state: Dict[str, Any],
    progress: float,
    *,
    force: bool = False,
) -> bool:
    progress = max(0.0, min(1.0, float(progress)))
    if force or progress >= 1.0:
        state["last_progress_emit_at"] = time.monotonic()
        state["last_progress_emit_value"] = progress
        return True

    now = time.monotonic()
    last_at = float(state.get("last_progress_emit_at") or 0)
    last_value = float(state.get("last_progress_emit_value") or -1)
    if (
        now - last_at >= _QCHAT_FILE_PROGRESS_MIN_INTERVAL_SECONDS
        or abs(progress - last_value) >= _QCHAT_FILE_PROGRESS_MIN_DELTA
    ):
        state["last_progress_emit_at"] = now
        state["last_progress_emit_value"] = progress
        return True

    return False


def _identity_from_reticulum_public_key_base64(pk_b64: str):
    s = str(pk_b64 or "").strip()
    if not s:
        raise ValueError("Missing Reticulum identity public key")
    pad = "=" * ((4 - len(s) % 4) % 4)
    pub_bytes = base64.b64decode(s + pad, validate=True)
    if len(pub_bytes) != 64:
        raise ValueError("Bad Reticulum identity public key length")
    ident = RNS.Identity(create_keys=False)
    ident.load_public_key(pub_bytes)
    return ident


def _destination_hash_for_identity(identity) -> str:
    outbound = build_outbound_destination(identity)
    return destination_hash_hex(outbound.hash)


def _identity_matches_destination_hash(identity, expected_hash: str) -> bool:
    return _destination_hash_for_identity(identity) == str(expected_hash or "").strip().lower()


def _is_reticulum_destination_hash(value: str) -> bool:
    s = str(value or "").strip().lower()
    return len(s) == 32 and all(c in "0123456789abcdef" for c in s)


def _parse_qchat_file_peer_identity(peer_hash: str, pk_b64: Any):
    if not _is_reticulum_destination_hash(peer_hash):
        raise ValueError("Missing or invalid Reticulum destination hash")
    if not isinstance(pk_b64, str) or not pk_b64.strip():
        raise ValueError("Missing Reticulum identity public key")
    identity = _identity_from_reticulum_public_key_base64(pk_b64)
    if not _identity_matches_destination_hash(identity, peer_hash):
        raise ValueError("Reticulum public key does not match destination hash")
    return identity


def _request_qchat_file_path(destination_hash: bytes, peer_hash: str) -> bool:
    try:
        if RNS.Transport.has_path(destination_hash):
            log(
                "[presence_bridge] target=qchat-file-reticulum path_ready "
                f"peer={peer_hash} source=cache"
            )
            return True
    except Exception:
        pass

    try:
        RNS.Transport.request_path(destination_hash)
        log(
            "[presence_bridge] target=qchat-file-reticulum path_request_sent "
            f"peer={peer_hash}"
        )
    except Exception as exc:
        log(
            "[presence_bridge] target=qchat-file-reticulum path_request_failed "
            f"peer={peer_hash} err={exc}"
        )

    try:
        await_path = getattr(RNS.Transport, "await_path", None)
        if callable(await_path):
            resolved = bool(
                await_path(destination_hash, _QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS)
            )
            log(
                "[presence_bridge] target=qchat-file-reticulum path_await "
                f"peer={peer_hash} resolved={str(resolved).lower()}"
            )
            if resolved:
                return True
    except Exception as exc:
        log(
            "[presence_bridge] target=qchat-file-reticulum path_await_failed "
            f"peer={peer_hash} err={exc}"
        )

    try:
        RNS.Transport.request_path(destination_hash)
    except Exception as exc:
        log(
            "[presence_bridge] target=qchat-file-reticulum path_request_failed "
            f"peer={peer_hash} err={exc}"
        )
        return False

    resolved = _await_destination_path(
        destination_hash,
        _QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS,
    )
    log(
        "[presence_bridge] target=qchat-file-reticulum path_request "
        f"peer={peer_hash} resolved={str(resolved).lower()}"
    )
    return resolved


def get_qchat_file_link_id(link) -> Optional[str]:
    if link is None:
        return None
    return _qchat_file_link_ids_by_object.get(id(link))


def get_qchat_file_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    return _qchat_file_links_by_id.get(link_id)


def remove_qchat_file_link(link_id: str) -> Optional[Dict[str, Any]]:
    state = _qchat_file_links_by_id.pop(link_id, None)
    if state is None:
        return None
    link = state.get("link")
    if link is not None:
        _qchat_file_link_ids_by_object.pop(id(link), None)
        _incoming_unified_peer_hash_by_object.pop(id(link), None)
    peer_hash = state.get("peerPresenceHash")
    if isinstance(peer_hash, str):
        existing = _outgoing_qchat_file_link_id_by_peer_hash.get(peer_hash)
        if existing == link_id:
            _outgoing_qchat_file_link_id_by_peer_hash.pop(peer_hash, None)
    return state


def on_qchat_file_link_closed(link) -> None:
    link_id = get_qchat_file_link_id(link)
    if link_id is None:
        return
    state = remove_qchat_file_link(link_id)
    if state is not None:
        timer = state.pop("auth_timeout_timer", None)
        if timer is not None:
            try:
                timer.cancel()
            except Exception:
                pass
        if state.get("completed") is True:
            return
        if state.get("incoming") is not True and int(state.get("open_attempts") or 0) < _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS:
            transfer_id_retry = str(state.get("transferId") or "")
            peer_hash_retry = str(state.get("peerPresenceHash") or "")

            def retry() -> None:
                try:
                    _open_qchat_file_link_for_state(state)
                except Exception as exc:
                    _qchat_file_emit(
                        "failed",
                        {
                            "transferId": transfer_id_retry,
                            "peerPresenceHash": peer_hash_retry,
                            "fileName": state.get("fileName") or "",
                            "reason": "file_link_retry_failed",
                            "error": str(exc),
                        },
                    )

            timer = threading.Timer(_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS, retry)
            timer.daemon = True
            timer.start()
            _qchat_file_emit(
                "retrying",
                {
                    "transferId": transfer_id_retry,
                    "peerPresenceHash": peer_hash_retry,
                    "fileName": state.get("fileName") or "",
                    "attempt": int(state.get("open_attempts") or 0) + 1,
                    "maxAttempts": _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS,
                },
            )
            return
        transfer_id = str(state.get("transferId") or "")
        if transfer_id:
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": state.get("peerPresenceHash") or "",
                    "fileName": state.get("fileName") or "",
                    "reason": "file_link_closed",
                },
            )


def _open_qchat_file_link_for_state(state: Dict[str, Any]) -> bool:
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if not peer_hash:
        return False
    peer_identity = state.get("peerIdentity")
    if peer_identity is None:
        raise RuntimeError("Missing embedded Reticulum peer identity")
    outbound = build_outbound_destination(peer_identity)
    if destination_hash_hex(outbound.hash) != peer_hash:
        raise RuntimeError("Reticulum public key does not match destination hash")
    state["open_attempts"] = int(state.get("open_attempts") or 0) + 1
    state["last_open_attempt_at"] = time.time()
    _qchat_file_emit(
        "connecting",
        {
            "transferId": state.get("transferId") or "",
            "peerPresenceHash": peer_hash,
            "fileName": state.get("fileName") or "",
            "size": int(state.get("size") or 0),
            "attempt": state["open_attempts"],
            "maxAttempts": _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS,
        },
    )
    path_ready = _request_qchat_file_path(outbound.hash, peer_hash)
    if not path_ready:
        raise RuntimeError("No Reticulum path for file transfer link")
    previous_link = state.get("link")
    if previous_link is not None:
        _qchat_file_link_ids_by_object.pop(id(previous_link), None)
    link_id = str(uuid.uuid4())
    link = RNS.Link(
        outbound,
        established_callback=on_outgoing_qchat_file_link_established,
        closed_callback=on_qchat_file_link_closed,
    )
    state["link"] = link
    state["peerDestinationHash"] = destination_hash_hex(outbound.hash)
    state["incoming"] = False
    state["established"] = False
    _qchat_file_links_by_id[link_id] = state
    _qchat_file_link_ids_by_object[id(link)] = link_id
    _outgoing_qchat_file_link_id_by_peer_hash[peer_hash] = link_id
    return True


def _schedule_qchat_file_open_retry(state: Dict[str, Any], reason: str) -> bool:
    attempts = int(state.get("open_attempts") or 0)
    if attempts >= _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS:
        return False
    transfer_id = str(state.get("transferId") or "")
    peer_hash = str(state.get("peerPresenceHash") or "")

    def retry() -> None:
        try:
            _open_qchat_file_link_for_state(state)
        except Exception as exc:
            if not _schedule_qchat_file_open_retry(state, str(exc)):
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "fileName": state.get("fileName") or "",
                        "reason": "link_open_failed",
                        "error": str(exc),
                    },
                )

    timer = threading.Timer(_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS, retry)
    timer.daemon = True
    timer.start()
    _qchat_file_emit(
        "retrying",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": state.get("fileName") or "",
            "attempt": attempts + 1,
            "maxAttempts": _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS,
            "reason": reason,
        },
    )
    return True


def _open_qchat_file_link_async(state: Dict[str, Any]) -> None:
    def run() -> None:
        try:
            _open_qchat_file_link_for_state(state)
        except Exception as exc:
            if _schedule_qchat_file_open_retry(state, str(exc)):
                return
            _qchat_file_emit(
                "failed",
                {
                    "transferId": state.get("transferId") or "",
                    "peerPresenceHash": state.get("peerPresenceHash") or "",
                    "fileName": state.get("fileName") or "",
                    "reason": "link_open_failed",
                    "error": str(exc),
                },
            )

    thread = threading.Thread(
        target=run,
        name=f"qchat-file-open-{state.get('transferId') or 'unknown'}",
        daemon=True,
    )
    thread.start()


def configure_qchat_file_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_qchat_file_link_closed)
    link.set_packet_callback(on_qchat_file_link_packet)
    link.set_resource_strategy(RNS.Link.ACCEPT_APP)
    link.set_resource_callback(on_qchat_file_resource_advertised)
    link.set_resource_started_callback(on_qchat_file_resource_started)
    link.set_resource_concluded_callback(on_qchat_file_resource_concluded)
    _qchat_file_link_ids_by_object[id(link)] = link_id


def on_qchat_file_link_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    link_id = get_qchat_file_link_id(link) if link is not None else None
    if not link_id:
        return
    state = get_qchat_file_link_state(link_id)
    if state is None:
        return
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid qchat file link payload: {exc}")
        return
    if not isinstance(decoded, dict):
        return
    if decoded.get("type") == "QCHAT_FILE_LINK_AUTH_RESULT":
        if decoded.get("ok") is True:
            _qchat_file_emit(
                "authorized",
                {
                    "transferId": str(decoded.get("transferId") or state.get("transferId") or ""),
                    "peerPresenceHash": state.get("peerPresenceHash") or "",
                    "fileName": state.get("fileName") or "",
                },
            )
        else:
            _qchat_file_emit(
                "failed",
                {
                    "transferId": str(decoded.get("transferId") or state.get("transferId") or ""),
                    "peerPresenceHash": state.get("peerPresenceHash") or "",
                    "fileName": state.get("fileName") or "",
                    "reason": str(decoded.get("reason") or "sender_rejected_auth"),
                },
            )
            try:
                link.teardown()
            except Exception:
                pass
        return
    if decoded.get("type") != "QCHAT_FILE_LINK_AUTH":
        return
    transfer_id = str(decoded.get("transferId") or "").strip()
    state["transferId"] = transfer_id
    _qchat_file_emit(
        "auth",
        {
            "linkId": link_id,
            "transferId": transfer_id,
            "auth": decoded,
        },
    )


def on_qchat_file_link_remote_identified(link, identity) -> None:
    try:
        peer_hash = _destination_hash_for_identity(identity)
    except Exception:
        return
    _incoming_unified_peer_hash_by_object[id(link)] = peer_hash
    link_id = get_qchat_file_link_id(link)
    if link_id:
        state = get_qchat_file_link_state(link_id)
        if state is not None:
            state["peerPresenceHash"] = peer_hash
            state["peerDestinationHash"] = peer_hash


def _register_incoming_qchat_file_link(link, peer_hash: str, transfer_id: str) -> str:
    link_id = get_qchat_file_link_id(link)
    if link_id:
        return link_id
    now = time.time()
    link_id = str(uuid.uuid4())
    state = {
        "link": link,
        "peerPresenceHash": peer_hash,
        "peerDestinationHash": peer_hash,
        "incoming": True,
        "established": True,
        "created_at": now,
        "established_at": now,
        "transferId": transfer_id,
    }
    with _state_lock:
        _qchat_file_links_by_id[link_id] = state
    configure_qchat_file_link(link, link_id)
    link.set_remote_identified_callback(on_qchat_file_link_remote_identified)
    return link_id


def _qchat_file_update_sent_progress(state: Dict[str, Any]) -> None:
    size = int(state.get("size") or 0)
    sent_bytes = int(state.get("sent_bytes") or 0)
    active = state.get("active_chunks")
    if isinstance(active, dict):
        for chunk in active.values():
            try:
                sent_bytes += int(chunk.get("size") or 0) * float(chunk.get("progress") or 0)
            except Exception:
                pass
    progress = min(1.0, max(0.0, sent_bytes / float(size))) if size > 0 else 0.0
    if not _should_emit_qchat_file_progress(state, progress):
        return
    _qchat_file_emit(
        "sending",
        {
            "transferId": state.get("transferId") or "",
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "fileName": state.get("fileName") or "",
            "size": size,
            **_qchat_file_progress_payload(state, progress, size),
        },
    )


def _qchat_file_mark_chunk_sent(state: Dict[str, Any], chunk_index: int, chunk_size: int) -> None:
    active = state.setdefault("active_chunks", {})
    if isinstance(active, dict):
        active.pop(chunk_index, None)
    completed = state.setdefault("completed_chunks", set())
    if isinstance(completed, set) and chunk_index not in completed:
        completed.add(chunk_index)
        state["sent_bytes"] = int(state.get("sent_bytes") or 0) + int(chunk_size)
    _qchat_file_update_sent_progress(state)
    if int(state.get("sent_bytes") or 0) >= int(state.get("size") or 0):
        if state.get("completed") is True:
            return
        state["completed"] = True
        transfer_id = str(state.get("transferId") or "")
        if transfer_id:
            with _state_lock:
                _qchat_file_pending_sends_by_transfer.pop(transfer_id, None)
        _qchat_file_emit(
            "sent",
            {
                "transferId": transfer_id,
                "peerPresenceHash": state.get("peerPresenceHash") or "",
                "fileName": state.get("fileName") or "",
                "size": int(state.get("size") or 0),
            },
        )


def _qchat_file_receiver_transfer_done(peer_hash: str, transfer_id: str) -> None:
    for link_id, link_state in list(_qchat_file_links_by_id.items()):
        if (
            str(link_state.get("peerPresenceHash") or "").strip().lower() == peer_hash
            and str(link_state.get("transferId") or "") == transfer_id
        ):
            link = link_state.get("link")
            link_state["completed"] = True
            remove_qchat_file_link(link_id)
            try:
                if link is not None:
                    link.teardown()
            except Exception:
                pass


def _qchat_file_read_chunk(file_path: str, offset: int, chunk_size: int) -> bytes:
    with open(file_path, "rb") as f:
        f.seek(offset)
        return f.read(chunk_size)


def _start_qchat_file_resource_for_state(state: Dict[str, Any]) -> bool:
    link = state.get("link")
    file_path = str(state.get("filePath") or "")
    transfer_id = str(state.get("transferId") or "")
    peer_hash = str(state.get("peerPresenceHash") or "")
    file_name = str(state.get("fileName") or os.path.basename(file_path))
    sha256 = str(state.get("sha256") or "").strip().lower()
    if link is None or not file_path or not transfer_id:
        return False
    if state.get("resource_started") is True:
        return True
    size = os.path.getsize(file_path)
    if not state.get("send_root"):
        state["send_root"] = state
    root = state.get("send_root") if isinstance(state.get("send_root"), dict) else state
    chunk_count = _qchat_file_chunk_count(size)
    with _state_lock:
        next_chunk = int(root.get("next_chunk_index") or 0)
        if next_chunk >= chunk_count:
            try:
                if link is not None:
                    link.teardown()
            except Exception:
                pass
            return False
        chunk_index = next_chunk
        chunk_offset, chunk_size = _qchat_file_chunk_bounds(size, chunk_index)
        root["next_chunk_index"] = next_chunk + 1
        root["transferId"] = transfer_id
        root["peerPresenceHash"] = peer_hash
        root["fileName"] = file_name
        root["size"] = size
        root.setdefault("active_chunks", {})[chunk_index] = {
            "size": chunk_size,
            "progress": 0.0,
        }
    metadata = {
        "kind": "qchat-dm-file",
        "transferId": transfer_id,
        "fileName": file_name,
        "size": size,
        "sha256": sha256,
        "chunked": True,
        "chunkIndex": chunk_index,
        "chunkCount": chunk_count,
        "chunkOffset": chunk_offset,
        "chunkSize": chunk_size,
    }

    def on_done(resource) -> None:
        status = "sent" if getattr(resource, "status", None) == RNS.Resource.COMPLETE else "failed"
        if status == "sent":
            _qchat_file_mark_chunk_sent(root, chunk_index, chunk_size)
        else:
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "reason": "send_failed",
                    "chunkIndex": chunk_index,
                },
            )
        link_id_done = get_qchat_file_link_id(link)
        if link_id_done:
            remove_qchat_file_link(link_id_done)
        try:
            link.teardown()
        except Exception:
            pass

    def on_progress(resource) -> None:
        try:
            progress = float(resource.get_progress())
        except Exception:
            progress = 0.0
        active = root.setdefault("active_chunks", {})
        if isinstance(active, dict) and chunk_index in active:
            active[chunk_index]["progress"] = progress
        _qchat_file_update_sent_progress(root)

    chunk_data = _qchat_file_read_chunk(file_path, chunk_offset, chunk_size)
    RNS.Resource(
        chunk_data,
        link,
        metadata=metadata,
        auto_compress=False,
        callback=on_done,
        progress_callback=on_progress,
    )
    state["resource_started"] = True
    _qchat_file_emit(
        "sending",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": file_name,
            "size": size,
            "progress": 0,
            "chunkIndex": chunk_index,
            "chunkCount": chunk_count,
        },
    )
    return True


def _send_qchat_file_auth_message(link, state: Dict[str, Any], log_label: str) -> bool:
    auth_message = state.get("authMessage")
    if not isinstance(auth_message, dict):
        return False
    try:
        encoded = json.dumps(auth_message, separators=(",", ":")).encode("utf-8")
        ok = _send_packet_on_link(
            link,
            encoded,
            f"target=qchat-file-reticulum {log_label} transfer={state.get('transferId') or ''}",
        )
        if ok:
            _qchat_file_emit(
                "auth_sent",
                {
                    "transferId": state.get("transferId") or "",
                    "peerPresenceHash": state.get("peerPresenceHash") or "",
                    "fileName": state.get("fileName") or "",
                    "size": int(state.get("size") or 0),
                },
            )
            previous_timer = state.pop("auth_timeout_timer", None)
            if previous_timer is not None:
                try:
                    previous_timer.cancel()
                except Exception:
                    pass

            def auth_timeout() -> None:
                if state.get("resource_started") is True or state.get("completed") is True:
                    return
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": state.get("transferId") or "",
                        "peerPresenceHash": state.get("peerPresenceHash") or "",
                        "fileName": state.get("fileName") or "",
                        "reason": "sender_auth_timeout",
                        "error": "Sender did not authorize the file transfer",
                    },
                )
                try:
                    link.teardown()
                except Exception:
                    pass

            timer = threading.Timer(45.0, auth_timeout)
            timer.daemon = True
            state["auth_timeout_timer"] = timer
            timer.start()
            return True
        _qchat_file_emit(
            "failed",
            {
                "transferId": state.get("transferId") or "",
                "peerPresenceHash": state.get("peerPresenceHash") or "",
                "fileName": state.get("fileName") or "",
                "reason": "auth_send_failed",
            },
        )
    except Exception as exc:
        _qchat_file_emit(
            "failed",
            {
                "transferId": state.get("transferId") or "",
                "peerPresenceHash": state.get("peerPresenceHash") or "",
                "fileName": state.get("fileName") or "",
                "reason": "auth_send_failed",
                "error": str(exc),
            },
        )
    return False


def on_outgoing_qchat_file_link_established(link) -> None:
    link_id = get_qchat_file_link_id(link)
    if link_id is None:
        return
    state = get_qchat_file_link_state(link_id)
    if state is None:
        return
    configure_qchat_file_link(link, link_id)
    link.set_remote_identified_callback(on_qchat_file_link_remote_identified)
    state["established"] = True
    state["established_at"] = time.time()
    _qchat_file_emit(
        "link_established",
        {
            "transferId": state.get("transferId") or "",
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "fileName": state.get("fileName") or "",
            "size": int(state.get("size") or 0),
        },
    )
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] qchat file link identify failed link={link_id}: {exc}")
    if isinstance(state.get("authMessage"), dict):
        _send_qchat_file_auth_message(link, state, "auth")
        return
    try:
        _start_qchat_file_resource_for_state(state)
    except Exception as exc:
        _qchat_file_emit(
            "failed",
            {
                "transferId": state.get("transferId") or "",
                "peerPresenceHash": state.get("peerPresenceHash") or "",
                "fileName": state.get("fileName") or "",
                "reason": "resource_start_failed",
                "error": str(exc),
            },
        )


def on_qchat_file_resource_advertised(resource) -> bool:
    link = getattr(resource, "link", None)
    link_id = get_qchat_file_link_id(link) if link is not None else None
    state = get_qchat_file_link_state(link_id) if link_id else None
    peer_hash = str((state or {}).get("peerPresenceHash") or "").strip().lower()
    if not peer_hash and link is not None:
        peer_hash = str(_incoming_unified_peer_hash_by_object.get(id(link)) or "").strip().lower()
    if not peer_hash:
        return False
    now = time.time()
    with _state_lock:
        pending = _qchat_file_accepts_by_peer.get(peer_hash)
        if pending and float(pending.get("expires_at") or 0) < now:
            _qchat_file_accepts_by_peer.pop(peer_hash, None)
            pending = None
    if not pending:
        return False
    expected_size = int(pending.get("size") or 0)
    pending["started_at"] = time.time()
    transfer_id = str(pending.get("transferId") or "")
    try:
        setattr(resource, "_qchat_peer_hash", peer_hash)
        setattr(resource, "_qchat_transfer_id", transfer_id)
    except Exception:
        pass
    _register_incoming_qchat_file_link(link, peer_hash, transfer_id)
    _qchat_file_emit(
        "receiving",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": pending.get("fileName"),
            "size": expected_size,
        },
    )
    return True


def on_qchat_file_resource_started(resource) -> None:
    link = getattr(resource, "link", None)
    link_id = get_qchat_file_link_id(link) if link is not None else None
    state = get_qchat_file_link_state(link_id) if link_id else None
    peer_hash = str((state or {}).get("peerPresenceHash") or "").strip().lower()
    pending = _qchat_file_accepts_by_peer.get(peer_hash) if peer_hash else None
    if state is not None:
        timer = state.pop("auth_timeout_timer", None)
        if timer is not None:
            try:
                timer.cancel()
            except Exception:
                pass
        state["resource_started"] = True
    if not pending:
        return
    transfer_id = str(pending.get("transferId") or "")
    file_name = str(pending.get("fileName") or "")
    size = int(pending.get("size") or 0)

    def on_progress(res) -> None:
        if isinstance(pending.get("completed_chunks"), set):
            return
        try:
            progress = float(res.get_progress())
        except Exception:
            progress = 0.0
        if not _should_emit_qchat_file_progress(pending, progress):
            return
        _qchat_file_emit(
            "receiving",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": file_name,
                "size": size,
                **_qchat_file_progress_payload(pending, progress, size),
            },
        )

    try:
        resource.progress_callback(on_progress)
    except Exception:
        pass
    on_progress(resource)


def on_qchat_file_resource_concluded(resource) -> None:
    link = getattr(resource, "link", None)
    link_id = get_qchat_file_link_id(link) if link is not None else None
    state = get_qchat_file_link_state(link_id) if link_id else None
    peer_hash = str(
        (state or {}).get("peerPresenceHash")
        or getattr(resource, "_qchat_peer_hash", "")
        or (
            _incoming_unified_peer_hash_by_object.get(id(link))
            if link is not None
            else ""
        )
        or ""
    ).strip().lower()
    if not peer_hash:
        log("[presence_bridge] qchat file resource concluded without peer hash")
        return
    with _state_lock:
        pending = _qchat_file_accepts_by_peer.get(peer_hash)
        if pending is None:
            resource_transfer_id = str(getattr(resource, "_qchat_transfer_id", "") or "")
            for candidate in _qchat_file_accepts_by_peer.values():
                if str(candidate.get("transferId") or "") == resource_transfer_id:
                    pending = candidate
                    break
    if not pending:
        log(
            "[presence_bridge] qchat file resource concluded without pending receive "
            f"peer={peer_hash}"
        )
        return
    transfer_id = str(
        pending.get("transferId") or getattr(resource, "_qchat_transfer_id", "") or ""
    )
    save_path = str(pending.get("savePath") or "")
    expected_hash = str(pending.get("sha256") or "").strip().lower()
    try:
        if getattr(resource, "status", None) != RNS.Resource.COMPLETE:
            if state is not None:
                state["completed"] = True
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "reason": "resource_incomplete",
                },
            )
            return
        metadata = getattr(resource, "metadata", None)
        is_chunked = isinstance(metadata, dict) and metadata.get("chunked") is True
        if isinstance(metadata, dict):
            metadata_transfer_id = str(metadata.get("transferId") or "")
            metadata_file_name = str(metadata.get("fileName") or "")
            metadata_size = int(metadata.get("size") or 0)
            metadata_sha256 = str(metadata.get("sha256") or "").strip().lower()
            expected_size = int(pending.get("size") or 0)
            expected_file_name = str(pending.get("fileName") or "")
            if (
                (metadata_transfer_id and metadata_transfer_id != transfer_id)
                or (metadata_file_name and metadata_file_name != expected_file_name)
                or (metadata_size and expected_size and metadata_size != expected_size)
                or (not is_chunked and metadata_sha256 and expected_hash and metadata_sha256 != expected_hash)
            ):
                if state is not None:
                    state["completed"] = True
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "reason": "metadata_mismatch",
                    },
                )
                return
        source_path = _resource_file_path(resource)
        if not source_path:
            if state is not None:
                state["completed"] = True
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "reason": "missing_resource_file",
                },
            )
            return
        if is_chunked:
            chunk_index = int(metadata.get("chunkIndex") or 0)
            chunk_count = int(metadata.get("chunkCount") or 0)
            chunk_offset = int(metadata.get("chunkOffset") or 0)
            chunk_size = int(metadata.get("chunkSize") or 0)
            lock = pending.get("chunk_lock")
            if lock is None:
                lock = threading.RLock()
                pending["chunk_lock"] = lock
            with lock:
                completed_chunks = pending.setdefault("completed_chunks", set())
                if chunk_index not in completed_chunks:
                    _write_chunk_to_part_file(source_path, save_path, chunk_offset)
                    completed_chunks.add(chunk_index)
                    pending["received_bytes"] = int(pending.get("received_bytes") or 0) + chunk_size
                size = int(pending.get("size") or 0)
                progress = min(1.0, max(0.0, int(pending.get("received_bytes") or 0) / float(size))) if size > 0 else 0.0
                if _should_emit_qchat_file_progress(pending, progress, force=progress >= 1.0):
                    _qchat_file_emit(
                        "receiving",
                        {
                            "transferId": transfer_id,
                            "peerPresenceHash": peer_hash,
                            "fileName": pending.get("fileName"),
                            "size": size,
                            **_qchat_file_progress_payload(pending, progress, size),
                        },
                    )
                done = chunk_count > 0 and len(completed_chunks) >= chunk_count
            if state is not None:
                state["completed"] = True
            if not done:
                peer_identity = pending.get("peerIdentity")
                if peer_identity is not None:
                    next_state = {
                        "peerPresenceHash": peer_hash,
                        "peerDestinationHash": "",
                        "incoming": False,
                        "established": False,
                        "transferId": transfer_id,
                        "fileName": pending.get("fileName") or "",
                        "size": int(pending.get("size") or 0),
                        "sha256": pending.get("sha256") or "",
                        "peerIdentity": peer_identity,
                        "authMessage": pending.get("authMessage"),
                        "created_at": time.time(),
                    }
                    if isinstance(next_state.get("authMessage"), dict):
                        _open_qchat_file_link_async(next_state)
                return
            part_path = save_path + ".part"
            actual_hash = _sha256_file_hex(part_path)
            if expected_hash and actual_hash.lower() != expected_hash:
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "reason": "hash_mismatch",
                        "expectedHash": expected_hash,
                        "actualHash": actual_hash,
                    },
                )
                return
            os.replace(part_path, save_path)
            with _state_lock:
                _qchat_file_accepts_by_peer.pop(peer_hash, None)
            _qchat_file_emit(
                "received",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": pending.get("fileName"),
                    "path": save_path,
                    "sha256": actual_hash,
                },
            )
            _qchat_file_receiver_transfer_done(peer_hash, transfer_id)
            return
        actual_hash = _sha256_file_hex(source_path)
        if expected_hash and actual_hash.lower() != expected_hash:
            if state is not None:
                state["completed"] = True
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "reason": "hash_mismatch",
                    "expectedHash": expected_hash,
                    "actualHash": actual_hash,
                },
            )
            return
        _move_file_to_save_path(source_path, save_path)
        if state is not None:
            state["completed"] = True
        with _state_lock:
            _qchat_file_accepts_by_peer.pop(peer_hash, None)
        _qchat_file_emit(
            "received",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": pending.get("fileName"),
                "path": save_path,
                "sha256": actual_hash,
            },
        )
        _qchat_file_receiver_transfer_done(peer_hash, transfer_id)
    except Exception as exc:
        _qchat_file_emit(
            "failed",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "reason": "save_failed",
                "error": str(exc),
            },
        )


def _configure_overlay_link_resources(link) -> None:
    return None


def configure_overlay_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_overlay_link_closed)
    link.set_packet_callback(on_overlay_link_packet)
    link.set_remote_identified_callback(on_overlay_link_remote_identified)
    _configure_overlay_link_resources(link)
    _overlay_link_ids_by_object[id(link)] = link_id


def on_outgoing_overlay_link_established(link) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    configure_overlay_link(link, link_id)
    now = time.time()
    state["established"] = True
    state["established_at"] = now
    state["last_activity_at"] = now
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] overlay link identify failed link={link_id}: {exc}")
    emit_overlay_link_state(link_id, state, "established")
    ph_out = str(state.get("peerPresenceHash") or "").strip().lower()
    if ph_out and _valid_presence_destination_hash_hex(ph_out):
        _register_active_overlay_for_peer(ph_out, link_id)
    _flush_overlay_link_pending(link_id)


def _send_wire_to_overlay_peer(
    peer_hash: str, wire_bytes: bytes, traffic: str, queue_if_pending: bool = True
) -> bool:
    state = _ensure_overlay_link(
        peer_hash,
        respect_dial_owner=traffic in ("presence_publish", "presence_forward"),
    )
    if state is None:
        log(
            f"[presence_bridge] target=presence-reticulum overlay_link_missing peer={peer_hash} traffic={traffic}"
        )
        return False
    link = state.get("link")
    if state.get("established") is True and link is not None:
        ok = _send_packet_on_link(
            link,
            wire_bytes,
            f"target=presence-reticulum overlay_link_send peer={peer_hash} traffic={traffic}",
        )
        if ok:
            state["last_activity_at"] = time.time()
        else:
            _queue_overlay_packet(state, traffic, wire_bytes)
        emit_overlay_link_state(get_overlay_link_id(link) or "", state, traffic)
        return True
    if queue_if_pending:
        _queue_overlay_packet(state, traffic, wire_bytes)
        emit_overlay_link_state(
            _active_overlay_link_id_by_peer_hash.get(peer_hash, ""),
            state,
            f"queued:{traffic}",
        )
        return True
    return False


def make_presence_wire(
    envelope: Dict[str, Any],
    overlay_hops_remaining: Optional[int] = None,
    origin_sender_hash: Optional[str] = None,
) -> bytes:
    if _destination is None:
        raise RuntimeError("Local destination not initialised")
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        raise RuntimeError("Presence envelope missing payload")
    local_sender_hash = destination_hash_hex(_destination.hash)

    wire = {
        "t": envelope.get("type"),
        "i": envelope.get("id"),
        "a": payload.get("address"),
        "k": payload.get("publicKey"),
        "n": payload.get("sessionId"),
        "m": envelope.get("timestamp"),
        "g": envelope.get("signature"),
        "r": local_sender_hash,
    }
    if isinstance(origin_sender_hash, str):
        origin_peer_hash = origin_sender_hash.strip().lower()
        if origin_peer_hash:
            if not _valid_presence_destination_hash_hex(origin_peer_hash):
                raise RuntimeError("Invalid originalSenderHash")
            if origin_peer_hash != local_sender_hash:
                wire["o"] = origin_peer_hash
    if "status" in payload:
        wire["s"] = payload.get("status")
    if "clientVersion" in payload:
        wire["c"] = payload.get("clientVersion")
    if isinstance(overlay_hops_remaining, int) and overlay_hops_remaining >= 0:
        wire["q"] = overlay_hops_remaining
    return json.dumps(wire, separators=(",", ":")).encode("utf-8")


def announce_local_destination(reason: str = "unspecified") -> None:
    if _destination is None:
        return
    _destination.announce(app_data=b"presence")
    log(
        "[presence_bridge] rns destination announce "
        f"reason={reason} "
        + destination_hash_hex(_destination.hash)
    )


def _maybe_announce_local_destination_low_verified_overlay_peers() -> None:
    """Extra RNS announce when verified overlay peers < MIN (same cooldown as legacy no-peers path)."""
    global _last_no_verified_peers_announce_at
    if _destination is None or not _rns_auth_announced:
        return
    if len(_verified_overlay_peers) >= _MIN_VERIFIED_OVERLAY_PEERS_BEFORE_SKIP_EXTRA_ANNOUNCE:
        return
    now = time.time()
    if (now - _last_no_verified_peers_announce_at) < _NO_VERIFIED_PEERS_ANNOUNCE_COOLDOWN_SECONDS:
        return
    try:
        announce_local_destination(
            "low_verified_overlay_peers "
            f"verified={len(_verified_overlay_peers)} "
            f"min_skip={_MIN_VERIFIED_OVERLAY_PEERS_BEFORE_SKIP_EXTRA_ANNOUNCE}"
        )
    except Exception as exc:
        log(f"[presence_bridge] rns announce low_verified_overlay_peers failed: {exc}")
        return
    _last_no_verified_peers_announce_at = now


def _cancel_rns_periodic_announce_timer() -> None:
    global _rns_periodic_announce_timer
    t = _rns_periodic_announce_timer
    _rns_periodic_announce_timer = None
    if t is not None:
        t.cancel()


def _rns_periodic_announce_fire() -> None:
    global _rns_periodic_announce_timer, _last_no_verified_peers_announce_at
    _rns_periodic_announce_timer = None
    if _shutdown.is_set():
        return
    with _state_lock:
        if _destination is None or not _rns_auth_announced:
            return
        try:
            announce_local_destination(
                f"periodic interval_sec={RNS_ANNOUNCE_INTERVAL_SEC}"
            )
            _last_no_verified_peers_announce_at = time.time()
        except Exception as exc:
            log(f"[presence_bridge] rns announce periodic failed: {exc}")
    _schedule_rns_periodic_announce_timer()


def _schedule_rns_periodic_announce_timer() -> None:
    global _rns_periodic_announce_timer
    _cancel_rns_periodic_announce_timer()
    t = threading.Timer(RNS_ANNOUNCE_INTERVAL_SEC, _rns_periodic_announce_fire)
    t.daemon = True
    _rns_periodic_announce_timer = t
    t.start()


def _rns_announce_on_auth_session_end() -> None:
    global _rns_auth_announced, _last_no_verified_peers_announce_at
    _rns_auth_announced = False
    _last_no_verified_peers_announce_at = 0.0
    _cancel_rns_periodic_announce_timer()


def send_presence_wire_to_peer(peer_hash: str, peer_identity, wire_bytes: bytes) -> None:
    """Send presence wire; updates last_send_ok in _peer_lifecycle (TODO: failure vs no-path diagnostics)."""
    now = time.time()
    try:
        outbound = build_outbound_destination(peer_identity)
        packet = RNS.Packet(outbound, wire_bytes, create_receipt=False)
        result = packet.send()
        if peer_hash not in _peer_lifecycle:
            _peer_lifecycle[peer_hash] = {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            }
        st = _peer_lifecycle[peer_hash]
        if result is False:
            st["last_send_ok"] = None
            log(
                f"[presence_bridge] target=presence-reticulum send_failed peer={peer_hash}"
            )
        else:
            st["last_send_ok"] = now
            log(
                f"[presence_bridge] target=presence-reticulum sent_presence peer={peer_hash}"
            )
    except Exception as exc:
        if peer_hash in _peer_lifecycle:
            _peer_lifecycle[peer_hash]["last_send_ok"] = None
        log(
            f"[presence_bridge] target=presence-reticulum send_exception peer={peer_hash}: {exc}"
        )


def make_group_audio_wire(room_id: str, data_b64: str) -> bytes:
    if _destination is None:
        raise RuntimeError("Local destination not initialised")
    wire = {
        "t": _GROUP_AUDIO_WIRE_TYPE,
        "R": room_id,
        "d": data_b64,
        "r": destination_hash_hex(_destination.hash),
    }
    return json.dumps(wire, separators=(",", ":")).encode("utf-8")


def get_audio_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    return _audio_links_by_id.get(link_id)


def get_audio_link_id(link: Any) -> Optional[str]:
    return _audio_link_ids_by_object.get(id(link))


def remove_audio_link(link_id: str) -> Optional[Dict[str, Any]]:
    state = _audio_links_by_id.pop(link_id, None)
    if state is None:
        return None
    link = state.get("link")
    if link is not None:
        _audio_link_ids_by_object.pop(id(link), None)
    peer_hash = state.get("peerPresenceHash")
    if isinstance(peer_hash, str):
        existing = _outgoing_audio_link_id_by_peer_hash.get(peer_hash)
        if existing == link_id:
            _outgoing_audio_link_id_by_peer_hash.pop(peer_hash, None)
    return state


def emit_audio_link_established(link_id: str) -> None:
    state = get_audio_link_state(link_id)
    if state is None:
        return
    emit_event(
        "group_audio_link_established",
        {
            "linkId": link_id,
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "peerDestinationHash": state.get("peerDestinationHash") or "",
            "incoming": state.get("incoming") is True,
        },
    )


def emit_audio_link_closed(link_id: str, reason: str = "") -> None:
    state = remove_audio_link(link_id)
    if state is None:
        return
    emit_event(
        "group_audio_link_closed",
        {
            "linkId": link_id,
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "peerDestinationHash": state.get("peerDestinationHash") or "",
            "incoming": state.get("incoming") is True,
            "reason": reason,
        },
    )


def on_audio_link_closed(link) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    teardown_reason = getattr(link, "teardown_reason", None)
    reason = str(teardown_reason) if teardown_reason is not None else "closed"
    emit_audio_link_closed(link_id, reason)


def on_audio_link_remote_identified(link, identity) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    peer_hash = find_peer_hash_for_identity(identity)
    if peer_hash:
        state["peerPresenceHash"] = peer_hash
        state["peerDestinationHash"] = peer_hash
    emit_audio_link_established(link_id)


def on_audio_link_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    link_id = get_audio_link_id(link) if link is not None else None
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid link audio payload: {exc}")
        return
    if not isinstance(decoded, dict):
        return
    if decoded.get("t") == _GROUP_AUDIO_HEARTBEAT_WIRE_TYPE:
        sender_call_hash = decoded.get("r")
        if isinstance(sender_call_hash, str) and sender_call_hash:
            state["peerDestinationHash"] = sender_call_hash
        _emit_call_bridge_message(
            decoded,
            str(state.get("peerPresenceHash") or ""),
            link_id,
        )
        return
    if decoded.get("t") != _GROUP_AUDIO_WIRE_TYPE:
        return
    room_id = decoded.get("R")
    data_b64 = decoded.get("d")
    sender_call_hash = decoded.get("r")
    if not isinstance(room_id, str) or not room_id:
        return
    if not isinstance(data_b64, str) or not data_b64:
        return
    if isinstance(sender_call_hash, str) and sender_call_hash:
        state["peerDestinationHash"] = sender_call_hash
    try:
        raw_audio = base64.b64decode(data_b64, validate=True)
    except Exception:
        log("[presence_bridge] invalid base64 in link audio payload")
        return
    try:
        chunk = _encode_audio_batch_binary(
            [
                (
                    link_id,
                    room_id,
                    str(state.get("peerPresenceHash") or ""),
                    str(state.get("peerDestinationHash") or ""),
                    int(time.time() * 1000),
                    raw_audio,
                )
            ]
        )
        _emit_binary_audio(chunk)
    except Exception as exc:
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=encode-to-parent-failed err={exc}")


def configure_audio_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_audio_link_closed)
    link.set_packet_callback(on_audio_link_packet)
    link.set_remote_identified_callback(on_audio_link_remote_identified)
    _audio_link_ids_by_object[id(link)] = link_id


def on_outgoing_audio_link_established(link) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    configure_audio_link(link, link_id)
    state["established"] = True
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] audio link identify failed link={link_id}: {exc}")
    emit_audio_link_established(link_id)


def _cancel_inbound_classify_timer(link_key: int) -> None:
    timer = _inbound_classify_timers.pop(link_key, None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _register_incoming_overlay_link(link) -> str:
    link_id = str(uuid.uuid4())
    now = time.time()
    state = {
        "link": link,
        "peerPresenceHash": "",
        "incoming": True,
        "established": True,
        "established_at": now,
        "created_at": now,
        "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
        "last_activity_at": now,
    }
    with _state_lock:
        _overlay_links_by_id[link_id] = state
    configure_overlay_link(link, link_id)
    emit_overlay_link_state(link_id, state, "incoming")
    return link_id


def _schedule_inbound_classify_fallback(link) -> None:
    link_key = id(link)

    def fire() -> None:
        with _state_lock:
            if link_key not in _pending_inbound_classify_link_ids:
                return
            _pending_inbound_classify_link_ids.discard(link_key)
        _cancel_inbound_classify_timer(link_key)
        if (
            get_overlay_link_id(link) is not None
            or get_audio_link_id(link) is not None
            or get_qchat_file_link_id(link) is not None
        ):
            return
        log(
            "[presence_bridge] WARNING inbound_link_classify_timeout defaulting_to_overlay "
            f"link_obj={link_key}"
        )
        try:
            _register_incoming_overlay_link(link)
        except Exception as exc:
            log(f"[presence_bridge] inbound_link_classify_timeout err={exc}")

    timer = threading.Timer(_INBOUND_LINK_CLASSIFY_TIMEOUT_SEC, fire)
    timer.daemon = True
    _inbound_classify_timers[link_key] = timer
    timer.start()


def on_inbound_unified_link_closed(link) -> None:
    link_key = id(link)
    _cancel_inbound_classify_timer(link_key)
    with _state_lock:
        _pending_inbound_classify_link_ids.discard(link_key)
    if get_overlay_link_id(link):
        on_overlay_link_closed(link)
    elif get_audio_link_id(link):
        on_audio_link_closed(link)
    elif get_qchat_file_link_id(link):
        on_qchat_file_link_closed(link)
    else:
        _incoming_unified_peer_hash_by_object.pop(id(link), None)


def on_inbound_link_first_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    if link is None:
        return
    link_key = id(link)
    with _state_lock:
        if link_key not in _pending_inbound_classify_link_ids:
            return
        _pending_inbound_classify_link_ids.discard(link_key)
    _cancel_inbound_classify_timer(link_key)
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] inbound_link_first_packet non-json err={exc}")
        _register_incoming_overlay_link(link)
        return
    if not isinstance(decoded, dict):
        _register_incoming_overlay_link(link)
        return
    if decoded.get("t") in _AUDIO_LINK_WIRE_TYPES:
        link_id = str(uuid.uuid4())
        _audio_links_by_id[link_id] = {
            "link": link,
            "peerPresenceHash": "",
            "peerDestinationHash": "",
            "incoming": True,
            "established": True,
        }
        configure_audio_link(link, link_id)
        on_audio_link_packet(message, packet)
        return
    if decoded.get("type") == "QCHAT_FILE_LINK_AUTH":
        link_id = _register_incoming_qchat_file_link(
            link,
            "",
            str(decoded.get("transferId") or ""),
        )
        on_qchat_file_link_packet(message, packet)
        return
    _register_incoming_overlay_link(link)
    on_overlay_link_packet(message, packet)


def on_incoming_unified_link_established(link) -> None:
    link_key = id(link)
    with _state_lock:
        _pending_inbound_classify_link_ids.add(link_key)
    link.set_link_closed_callback(on_inbound_unified_link_closed)
    link.set_packet_callback(on_inbound_link_first_packet)
    link.set_remote_identified_callback(on_qchat_file_link_remote_identified)
    link.set_resource_strategy(RNS.Link.ACCEPT_APP)
    link.set_resource_callback(on_qchat_file_resource_advertised)
    link.set_resource_concluded_callback(on_qchat_file_resource_concluded)
    _schedule_inbound_classify_fallback(link)


def on_hub_packet_received(data, packet) -> None:
    try:
        message = json.loads(data.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid hub packet payload: {exc}")
        return

    if not isinstance(message, dict):
        log("[presence_bridge] ignored non-object hub packet payload")
        return
    t = message.get("t")
    if t == _GROUP_AUDIO_WIRE_TYPE:
        room_id = message.get("R")
        data_b64 = message.get("d")
        sender_dest = message.get("r")
        if not isinstance(room_id, str) or not room_id:
            return
        if not isinstance(data_b64, str) or not data_b64:
            return
        sender_dest = sender_dest if isinstance(sender_dest, str) else ""
        try:
            raw_audio = base64.b64decode(data_b64, validate=True)
        except Exception:
            log("[presence_bridge] invalid base64 in hub packet audio payload")
            return
        peer_presence_hash = _resolve_sender_peer_destination_hash(sender_dest)
        try:
            chunk = _encode_audio_batch_binary(
                [
                    (
                        "",
                        room_id,
                        peer_presence_hash,
                        sender_dest,
                        int(time.time() * 1000),
                        raw_audio,
                    )
                ]
            )
            _note_call_media_inbound(peer_presence_hash, sender_dest)
            _emit_binary_audio(chunk)
        except Exception as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=encode-to-parent-failed err={exc}")
        return
    if isinstance(t, str) and t.startswith("PRESENCE_"):
        _emit_presence_message(message)
        return
    _emit_call_bridge_message(message)


def ensure_started(config_dir: str):
    global _reticulum, _identity, _destination
    global _announce_handler

    with _state_lock:
        if _destination is not None:
            return _destination

        os.makedirs(config_dir, exist_ok=True)
        _reticulum = RNS.Reticulum(
            configdir=config_dir,
            logdest=RNS.LOG_FILE,
            require_shared_instance=True,
        )
        log(
            "[presence_bridge] connected_to_shared_instance="
            + str(getattr(_reticulum, "is_connected_to_shared_instance", None))
        )
        _identity = ensure_identity(config_dir)
        _destination = RNS.Destination(
            _identity,
            RNS.Destination.IN,
            RNS.Destination.SINGLE,
            APP_NAMESPACE,
            PRESENCE_ASPECT,
            PRESENCE_VERSION,
        )
        _destination.set_proof_strategy(RNS.Destination.PROVE_NONE)
        _destination.set_packet_callback(on_hub_packet_received)
        _destination.set_link_established_callback(on_incoming_unified_link_established)
        _announce_handler = PresenceAnnounceHandler(_destination.hash)
        RNS.Transport.register_announce_handler(_announce_handler)
        ensure_transport_monitor_started()
        return _destination


def handle_start(req_id: str, payload: Dict[str, Any]) -> None:
    config_dir = str(payload.get("configDir") or os.environ.get("QORTAL_RETICULUM_CONFIG_DIR") or "")
    if not config_dir:
        emit_resp(req_id, False, error="Missing configDir")
        return

    try:
        destination = ensure_started(config_dir)
        maybe_emit_transport_state(force=True)
        presence_hex = destination_hash_hex(destination.hash)
        emit_event(
            "ready",
            {"destinationHash": presence_hex},
        )
        emit_resp(
            req_id,
            True,
            payload={"destinationHash": presence_hex},
        )
        log(f"[presence_bridge] build={PRESENCE_BRIDGE_BUILD}")
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_publish_presence(req_id: str, payload: Dict[str, Any]) -> None:
    envelope = payload.get("envelope")
    if not isinstance(envelope, dict):
        emit_resp(req_id, False, error="Missing envelope")
        return

    if _destination is None:
        emit_resp(req_id, False, error="Bridge not started")
        return

    try:
        global _last_presence_wire, _rns_auth_announced, _last_no_verified_peers_announce_at
        env_type = envelope.get("type") if isinstance(envelope.get("type"), str) else ""
        if env_type == "PRESENCE_OFFLINE":
            _rns_announce_on_auth_session_end()
        elif env_type == "PRESENCE_ANNOUNCE":
            if not _rns_auth_announced:
                announce_local_destination("authenticated_initial")
                _rns_auth_announced = True
                _schedule_rns_periodic_announce_timer()
                _last_no_verified_peers_announce_at = time.time()

        wire_bytes = make_presence_wire(envelope, _OVERLAY_DEFAULT_HOPS)
        _last_presence_wire = wire_bytes
        for ph in list(_recent_presence_senders):
            ensure_known_peer_from_recall(ph)
        extra = payload.get("overlayNeighborHashes")
        if isinstance(extra, list):
            for h in extra:
                if isinstance(h, str) and h.strip():
                    ensure_known_peer_from_recall(h.strip().lower(), "ts_seed")
        _maybe_prune_stale_peers()
        _sync_overlay_links()
        peer_hashes = _resolve_overlay_neighbor_hashes()
        nudge_budget = [_MAX_PATH_NUDGES_PER_PUBLISH]
        for peer_hash in peer_hashes:
            try:
                hb = bytes.fromhex(peer_hash)
            except ValueError:
                continue
            if len(hb) != 16:
                continue
            _request_path_if_eligible(peer_hash, hb, nudge_budget)
            _warm_call_media_path_if_possible(
                peer_hash,
                active_call=False,
                allow_wait=False,
                reason="publish_presence",
            )
        local_hex = destination_hash_hex(_destination.hash)
        env_type = envelope.get("type") if isinstance(envelope.get("type"), str) else ""
        env_payload = envelope.get("payload")
        env_addr = ""
        if isinstance(env_payload, dict) and isinstance(env_payload.get("address"), str):
            env_addr = str(env_payload.get("address"))
        log(
            "[presence_bridge] target=presence-reticulum publish_fanout "
            f"peers={len(peer_hashes)} local_presence_hash={local_hex} "
            f"type={env_type} peer_addr={env_addr} "
            f"fanout_hashes={','.join(peer_hashes)}"
        )
        for peer_hash in peer_hashes:
            _send_wire_to_overlay_peer(peer_hash, wire_bytes, "presence_publish")
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(peer_hashes),
                "fanoutHashes": peer_hashes,
                "localPresenceHash": local_hex,
            },
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_forward_presence(req_id: str, payload: Dict[str, Any]) -> None:
    envelope = payload.get("envelope")
    if not isinstance(envelope, dict):
        emit_resp(req_id, False, error="Missing envelope")
        return
    if _destination is None:
        emit_resp(req_id, False, error="Bridge not started")
        return
    hops_remaining = payload.get("overlayHopsRemaining")
    if not isinstance(hops_remaining, int) or hops_remaining < 0:
        emit_resp(req_id, False, error="Missing overlayHopsRemaining")
        return
    exclude_raw = payload.get("excludeDestinationHashes")
    exclude_hashes = (
        [str(h).strip().lower() for h in exclude_raw if isinstance(h, str) and h.strip()]
        if isinstance(exclude_raw, list)
        else []
    )
    origin_sender_hash = payload.get("originalSenderHash")
    if origin_sender_hash is not None and not isinstance(origin_sender_hash, str):
        emit_resp(req_id, False, error="Invalid originalSenderHash")
        return
    try:
        wire_bytes = make_presence_wire(
            envelope,
            hops_remaining,
            origin_sender_hash=origin_sender_hash,
        )
        _sync_overlay_links()
        peer_hashes = _resolve_overlay_neighbor_hashes(exclude_hashes)
        for peer_hash in peer_hashes:
            _send_wire_to_overlay_peer(peer_hash, wire_bytes, "presence_forward")
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(peer_hashes),
                "fanoutHashes": peer_hashes,
            },
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_overlay_sync_state(req_id: str, payload: Dict[str, Any]) -> None:
    verified_raw = payload.get("verifiedPeers")
    active_raw = payload.get("activeNeighborHashes")
    verified = verified_raw if isinstance(verified_raw, list) else []
    active = active_raw if isinstance(active_raw, list) else []
    _set_verified_overlay_peers(verified, [str(h) for h in active])
    _sync_overlay_links()
    _maybe_announce_local_destination_low_verified_overlay_peers()
    emit_resp(req_id, True)


def handle_overlay_note_candidate_failure(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerHash") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip() or "unknown"
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerHash")
        return
    _note_candidate_failure(peer_hash, reason)
    emit_resp(req_id, True)


def handle_stop(req_id: str) -> None:
    _rns_announce_on_auth_session_end()
    emit_resp(req_id, True)


def _encode_group_signal_wire(msg: Dict[str, Any]) -> Dict[str, Any]:
    out = _normalize_json_numbers(dict(msg))
    out["r"] = destination_hash_hex(_destination.hash)
    wire_bytes = _call_wire_json_bytes(out)
    if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
        return {
            "ok": False,
            "payload": {
                "code": "wire_too_large",
                "wireBytes": len(wire_bytes),
                "maxWireBytes": _MAX_ENCRYPTED_WIRE_BYTES,
                "messageType": out.get("t"),
            },
            "error": (
                f"Wire size {len(wire_bytes)} exceeds encrypted MDU "
                f"{_MAX_ENCRYPTED_WIRE_BYTES}"
            ),
        }
    return {
        "ok": True,
        "wire_bytes": wire_bytes,
        "message_type": out.get("t"),
    }


def _prepare_group_signal_peer(peer_hash: str) -> Optional[Dict[str, Any]]:
    peer_key = peer_hash.strip().lower()
    if not peer_key:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    # Overlay fanout: best-effort recall for overlay links; do not reject with
    # unknown_peer_presence_hash before attempting send (RNS may still lack identity).
    ensure_known_peer_from_recall(peer_key, "ts_seed")
    if peer_key not in _known_peers:
        _nudge_overlay_path_for_peer(peer_key)
        ensure_known_peer_from_recall(peer_key, "ts_seed")
    if peer_key not in _active_overlay_neighbors:
        _ensure_overlay_link(peer_key)
    if peer_key not in _known_peers:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    return None


def _send_group_signal_wire_to_peer(peer_hash: str, wire_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not _send_wire_to_overlay_peer(peer_hash, wire_bytes, "group_signal"):
        return {
            "payload": {"code": "packet_send_false"},
            "error": "Packet send returned False",
        }
    return None


def _encode_call_signal_wire(msg: Dict[str, Any]) -> Dict[str, Any]:
    out = _normalize_json_numbers(dict(msg))
    out["r"] = destination_hash_hex(_destination.hash)
    wire_bytes = _call_wire_json_bytes(out)
    if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
        return {
            "ok": False,
            "payload": {
                "code": "wire_too_large",
                "wireBytes": len(wire_bytes),
                "maxWireBytes": _MAX_ENCRYPTED_WIRE_BYTES,
                "messageType": out.get("t"),
            },
            "error": (
                f"Wire size {len(wire_bytes)} exceeds encrypted MDU "
                f"{_MAX_ENCRYPTED_WIRE_BYTES}"
            ),
        }
    return {
        "ok": True,
        "wire_bytes": wire_bytes,
        "message_type": out.get("t"),
    }


def _prepare_call_signal_peer(peer_hash: str) -> Optional[Dict[str, Any]]:
    peer_key = peer_hash.strip().lower()
    if not peer_key:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    ensure_known_peer_from_recall(peer_key, "ts_seed")
    if peer_key not in _known_peers:
        _nudge_overlay_path_for_peer(peer_key)
        ensure_known_peer_from_recall(peer_key, "ts_seed")
    if peer_key not in _active_overlay_neighbors:
        _ensure_overlay_link(peer_key)
    if peer_key not in _known_peers:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    return None


def _send_call_signal_wire_to_peer(peer_hash: str, wire_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not _send_wire_to_overlay_peer(peer_hash, wire_bytes, "call_signal"):
        return {
            "payload": {"code": "packet_send_false"},
            "error": "Packet send returned False",
        }
    return None


def handle_send_call(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    msg = payload.get("message")
    if not peer_hash or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHash or message")
        return

    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_key = peer_hash.strip().lower()

    try:
        encoded = _encode_call_signal_wire(msg)
        if not encoded.get("ok"):
            emit_resp(
                req_id,
                False,
                payload=encoded.get("payload"),
                error=str(encoded.get("error") or "Wire encoding failed"),
            )
            return
        wire_bytes = encoded["wire_bytes"]
        if len(wire_bytes) > 600:
            log(f"[presence_bridge] warning call packet len={len(wire_bytes)}")
        failure = _prepare_call_signal_peer(peer_key)
        if failure is not None:
            emit_resp(
                req_id,
                False,
                payload=failure.get("payload"),
                error=str(failure.get("error") or "Unknown peer presence hash"),
            )
            return
        failure = _send_call_signal_wire_to_peer(peer_key, wire_bytes)
        if failure is not None:
            emit_resp(
                req_id,
                False,
                payload=failure.get("payload"),
                error=str(failure.get("error") or "Packet send returned False"),
            )
            return
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))

def handle_accept_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    pk_b64 = payload.get("reticulumIdentityPublicKeyBase64")
    auth_message = payload.get("authMessage")
    transfer_id = str(payload.get("transferId") or "").strip()
    save_path = str(payload.get("savePath") or "").strip()
    file_name = str(payload.get("fileName") or "").strip()
    sha256 = str(payload.get("sha256") or "").strip().lower()
    try:
        size = int(payload.get("size") or 0)
    except Exception:
        size = 0
    if not peer_hash or not transfer_id or not save_path:
        emit_resp(req_id, False, error="Missing peerPresenceHash, transferId or savePath")
        return
    if size <= 0:
        emit_resp(req_id, False, error="Missing or invalid file size")
        return
    if not isinstance(auth_message, dict):
        emit_resp(req_id, False, error="Missing Reticulum link auth message")
        return
    try:
        peer_identity = _parse_qchat_file_peer_identity(peer_hash, pk_b64)
    except Exception as exc:
        emit_resp(
            req_id,
            False,
            payload={"code": "bad_reticulum_identity"},
            error=str(exc),
        )
        return
    with _state_lock:
        _qchat_file_accepts_by_peer[peer_hash] = {
            "transferId": transfer_id,
            "savePath": save_path,
            "fileName": file_name,
            "size": size,
            "sha256": sha256,
            "peerIdentity": peer_identity,
            "authMessage": auth_message,
            "received_bytes": 0,
            "active_chunks": {},
            "completed_chunks": set(),
            "chunk_lock": threading.RLock(),
            "expires_at": time.time() + 15 * 60,
        }
    _qchat_file_emit(
        "accepted",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": file_name,
            "size": size,
        },
    )
    links_to_open = min(_QCHAT_FILE_PARALLEL_LINKS, max(1, _qchat_file_chunk_count(size)))
    for _ in range(links_to_open):
        state = {
            "peerPresenceHash": peer_hash,
            "peerDestinationHash": "",
            "incoming": False,
            "established": False,
            "transferId": transfer_id,
            "fileName": file_name,
            "size": size,
            "sha256": sha256,
            "peerIdentity": peer_identity,
            "authMessage": auth_message,
            "created_at": time.time(),
        }
        _open_qchat_file_link_async(state)
    emit_resp(req_id, True)


def handle_send_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    transfer_id = str(payload.get("transferId") or "").strip()
    allowed_recipient = str(payload.get("allowedRecipientAddress") or "").strip()
    file_path = str(payload.get("filePath") or "").strip()
    file_name = str(payload.get("fileName") or os.path.basename(file_path)).strip()
    sha256 = str(payload.get("sha256") or "").strip().lower()
    try:
        expires_at_ms = float(payload.get("expiresAt") or 0)
    except Exception:
        expires_at_ms = 0
    expires_at = expires_at_ms / 1000 if expires_at_ms > 0 else time.time() + 2 * 60 * 60
    if not allowed_recipient or not transfer_id or not file_path:
        emit_resp(req_id, False, error="Missing allowedRecipientAddress, transferId or filePath")
        return
    if not os.path.isfile(file_path):
        emit_resp(req_id, False, error="File does not exist")
        return
    try:
        size = os.path.getsize(file_path)
        with _state_lock:
            _qchat_file_pending_sends_by_transfer[transfer_id] = {
                "allowedRecipientAddress": allowed_recipient,
                "filePath": file_path,
                "fileName": file_name,
                "size": size,
                "sha256": sha256,
                "created_at": time.time(),
                "expires_at": expires_at,
                "next_chunk_index": 0,
                "sent_bytes": 0,
                "active_chunks": {},
                "completed_chunks": set(),
            }
        _qchat_file_emit(
            "registered",
            {
                "transferId": transfer_id,
                "fileName": file_name,
                "size": size,
            },
        )
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_authorize_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    link_id = str(payload.get("linkId") or "").strip()
    transfer_id = str(payload.get("transferId") or "").strip()
    if not link_id or not transfer_id:
        emit_resp(req_id, False, error="Missing linkId or transferId")
        return
    state = get_qchat_file_link_state(link_id)
    if state is None:
        emit_resp(req_id, False, payload={"code": "unknown_link_id"}, error="Unknown link id")
        return
    with _state_lock:
        pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
    if not pending:
        emit_resp(req_id, False, payload={"code": "unknown_transfer_id"}, error="Unknown transfer id")
        return
    if float(pending.get("expires_at") or 0) < time.time():
        emit_resp(req_id, False, payload={"code": "transfer_expired"}, error="Transfer expired")
        return
    state.update(
        {
            "filePath": pending.get("filePath") or "",
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "sha256": pending.get("sha256") or "",
            "transferId": transfer_id,
            "send_root": pending,
        }
    )
    try:
        link = state.get("link")
        if link is not None:
            _send_packet_on_link(
                link,
                json.dumps(
                    {
                        "type": "QCHAT_FILE_LINK_AUTH_RESULT",
                        "ok": True,
                        "transferId": transfer_id,
                    },
                    separators=(",", ":"),
                ).encode("utf-8"),
                f"target=qchat-file-reticulum auth_result_ok transfer={transfer_id}",
            )
        _start_qchat_file_resource_for_state(state)
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_reject_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    link_id = str(payload.get("linkId") or "").strip()
    transfer_id = str(payload.get("transferId") or "").strip()
    reason = str(payload.get("reason") or "sender_rejected_auth").strip()
    state = get_qchat_file_link_state(link_id)
    if state is None:
        emit_resp(req_id, False, payload={"code": "unknown_link_id"}, error="Unknown link id")
        return
    link = state.get("link")
    try:
        if link is not None:
            _send_packet_on_link(
                link,
                json.dumps(
                    {
                        "type": "QCHAT_FILE_LINK_AUTH_RESULT",
                        "ok": False,
                        "transferId": transfer_id,
                        "reason": reason,
                    },
                    separators=(",", ":"),
                ).encode("utf-8"),
                f"target=qchat-file-reticulum auth_result_reject transfer={transfer_id}",
            )
            try:
                link.teardown()
            except Exception:
                pass
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_fanout_call(req_id: str, payload: Dict[str, Any]) -> None:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or any(
        not isinstance(msg, dict) for msg in messages
    ):
        emit_resp(req_id, False, error="Missing messages")
        return

    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    exclude_raw = payload.get("excludePeerPresenceHashes")
    exclude_hashes = (
        [str(h).strip().lower() for h in exclude_raw if isinstance(h, str) and h.strip()]
        if isinstance(exclude_raw, list)
        else []
    )

    try:
        encoded_frames = []
        message_types = []
        for msg in messages:
            encoded = _encode_call_signal_wire(msg)
            if not encoded.get("ok"):
                emit_resp(
                    req_id,
                    False,
                    payload=encoded.get("payload"),
                    error=str(encoded.get("error") or "Wire encoding failed"),
                )
                return
            wire_bytes = encoded["wire_bytes"]
            if len(wire_bytes) > 600:
                log(f"[presence_bridge] warning call packet len={len(wire_bytes)}")
            encoded_frames.append(wire_bytes)
            message_type = encoded.get("message_type")
            message_types.append(message_type if isinstance(message_type, str) else "")

        extra = payload.get("overlayNeighborHashes")
        if isinstance(extra, list):
            for h in extra:
                if isinstance(h, str) and h.strip():
                    ensure_known_peer_from_recall(h.strip().lower(), "ts_seed")

        _maybe_prune_stale_peers()
        _sync_overlay_links()
        peer_hashes = _resolve_overlay_neighbor_hashes(exclude_hashes)
        if not peer_hashes:
            emit_resp(
                req_id,
                False,
                payload={"code": "no_route"},
                error="No overlay route",
            )
            return

        log(
            "[presence_bridge] target=call-signal-reticulum fanout "
            f"peers={len(peer_hashes)} exclude_hashes={','.join(exclude_hashes)} "
            f"fanout_hashes={','.join(peer_hashes)} "
            f"message_types={','.join(t or '?' for t in message_types)}"
        )

        any_peer_full_delivery = False
        last_failure_payload = {"code": "packet_send_false"}
        last_failure_error = "Packet send returned False"
        saw_failure = False

        for peer_hash in peer_hashes:
            failure = _prepare_call_signal_peer(peer_hash)
            if failure is not None:
                saw_failure = True
                last_failure_payload = failure.get("payload") or {"code": "packet_send_false"}
                last_failure_error = str(
                    failure.get("error") or "Unknown peer presence hash"
                )
                log(
                    "[presence_bridge] target=call-signal-reticulum fanout_peer_failed "
                    f"peer_hash={peer_hash} "
                    f"reason={last_failure_payload.get('code', 'packet_send_false')} "
                    f"error={last_failure_error}"
                )
                continue

            peer_delivered_all_frames = True
            for index, wire_bytes in enumerate(encoded_frames):
                failure = _send_call_signal_wire_to_peer(peer_hash, wire_bytes)
                if failure is not None:
                    saw_failure = True
                    peer_delivered_all_frames = False
                    last_failure_payload = failure.get("payload") or {
                        "code": "packet_send_false"
                    }
                    last_failure_error = str(
                        failure.get("error") or "Packet send returned False"
                    )
                    message_type = (
                        message_types[index]
                        if index < len(message_types) and message_types[index]
                        else "?"
                    )
                    log(
                        "[presence_bridge] target=call-signal-reticulum fanout_send_failed "
                        f"peer_hash={peer_hash} "
                        f"reason={last_failure_payload.get('code', 'packet_send_false')} "
                        f"message_type={message_type} "
                        f"error={last_failure_error}"
                    )
            if peer_delivered_all_frames:
                any_peer_full_delivery = True

        if any_peer_full_delivery:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": len(peer_hashes),
                    "fanoutHashes": peer_hashes,
                },
            )
            return

        if saw_failure:
            emit_resp(
                req_id,
                False,
                payload=last_failure_payload,
                error=last_failure_error,
            )
            return

        emit_resp(
            req_id,
            False,
            payload={"code": "packet_send_false"},
            error="Overlay fanout had no successful delivery",
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_send_group_call(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    msg = payload.get("message")
    if not peer_hash or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHash or message")
        return

    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_key = peer_hash.strip().lower()
    try:
        encoded = _encode_group_signal_wire(msg)
        if not encoded.get("ok"):
            emit_resp(
                req_id,
                False,
                payload=encoded.get("payload"),
                error=str(encoded.get("error") or "Wire encoding failed"),
            )
            return
        failure = _prepare_group_signal_peer(peer_key)
        if failure is not None:
            emit_resp(
                req_id,
                False,
                payload=failure.get("payload"),
                error=str(failure.get("error") or "Unknown peer presence hash"),
            )
            return
        failure = _send_group_signal_wire_to_peer(
            peer_key, encoded["wire_bytes"]
        )
        if failure is not None:
            emit_resp(
                req_id,
                False,
                payload=failure.get("payload"),
                error=str(failure.get("error") or "Packet send returned False"),
            )
            return
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_fanout_group_call(req_id: str, payload: Dict[str, Any]) -> None:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or any(
        not isinstance(msg, dict) for msg in messages
    ):
        emit_resp(req_id, False, error="Missing messages")
        return

    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    exclude_raw = payload.get("excludePeerPresenceHashes")
    exclude_hashes = (
        [str(h).strip().lower() for h in exclude_raw if isinstance(h, str) and h.strip()]
        if isinstance(exclude_raw, list)
        else []
    )

    try:
        encoded_frames = []
        message_types = []
        for msg in messages:
            encoded = _encode_group_signal_wire(msg)
            if not encoded.get("ok"):
                emit_resp(
                    req_id,
                    False,
                    payload=encoded.get("payload"),
                    error=str(encoded.get("error") or "Wire encoding failed"),
                )
                return
            encoded_frames.append(encoded["wire_bytes"])
            message_type = encoded.get("message_type")
            message_types.append(message_type if isinstance(message_type, str) else "")

        extra = payload.get("overlayNeighborHashes")
        if isinstance(extra, list):
            for h in extra:
                if isinstance(h, str) and h.strip():
                    ensure_known_peer_from_recall(h.strip().lower(), "ts_seed")

        _maybe_prune_stale_peers()
        _sync_overlay_links()
        peer_hashes = _resolve_overlay_neighbor_hashes(exclude_hashes)
        if not peer_hashes:
            emit_resp(
                req_id,
                False,
                payload={"code": "no_route"},
                error="No overlay route",
            )
            return

        log(
            "[presence_bridge] target=group-signal-reticulum fanout "
            f"peers={len(peer_hashes)} exclude_hashes={','.join(exclude_hashes)} "
            f"fanout_hashes={','.join(peer_hashes)} "
            f"message_types={','.join(t or '?' for t in message_types)}"
        )

        any_peer_full_delivery = False
        last_failure_payload = {"code": "packet_send_false"}
        last_failure_error = "Packet send returned False"
        saw_failure = False

        for peer_hash in peer_hashes:
            failure = _prepare_group_signal_peer(peer_hash)
            if failure is not None:
                saw_failure = True
                last_failure_payload = failure.get("payload") or {"code": "packet_send_false"}
                last_failure_error = str(
                    failure.get("error") or "Unknown peer presence hash"
                )
                log(
                    "[presence_bridge] target=group-signal-reticulum fanout_peer_failed "
                    f"peer_hash={peer_hash} "
                    f"reason={last_failure_payload.get('code', 'packet_send_false')} "
                    f"error={last_failure_error}"
                )
                continue

            peer_delivered_all_frames = True
            for index, wire_bytes in enumerate(encoded_frames):
                failure = _send_group_signal_wire_to_peer(peer_hash, wire_bytes)
                if failure is not None:
                    saw_failure = True
                    peer_delivered_all_frames = False
                    last_failure_payload = failure.get("payload") or {
                        "code": "packet_send_false"
                    }
                    last_failure_error = str(
                        failure.get("error") or "Packet send returned False"
                    )
                    message_type = (
                        message_types[index]
                        if index < len(message_types) and message_types[index]
                        else "?"
                    )
                    log(
                        "[presence_bridge] target=group-signal-reticulum fanout_send_failed "
                        f"peer_hash={peer_hash} "
                        f"reason={last_failure_payload.get('code', 'packet_send_false')} "
                        f"message_type={message_type} "
                        f"error={last_failure_error}"
                    )
            if peer_delivered_all_frames:
                any_peer_full_delivery = True

        if any_peer_full_delivery:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": len(peer_hashes),
                    "fanoutHashes": peer_hashes,
                },
            )
            return

        if saw_failure:
            emit_resp(
                req_id,
                False,
                payload=last_failure_payload,
                error=last_failure_error,
            )
            return

        emit_resp(
            req_id,
            False,
            payload={"code": "packet_send_false"},
            error="Overlay fanout had no successful delivery",
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_open_group_audio_link(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return

    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_key = peer_hash.strip().lower()
    peer_identity = _get_group_audio_peer_identity(peer_key)
    if peer_identity is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "unknown_peer_presence_hash"},
            error="Unknown peer presence hash",
        )
        return

    existing_link_id = _outgoing_audio_link_id_by_peer_hash.get(peer_key)
    if existing_link_id:
        state = get_audio_link_state(existing_link_id)
        if state is not None:
            emit_resp(
                req_id,
                True,
                payload={
                    "linkId": existing_link_id,
                    "established": state.get("established") is True,
                },
            )
            return

    try:
        outbound = build_outbound_destination(peer_identity)
        path_state, path_ready = _ensure_call_media_path(
            peer_key,
            outbound.hash,
            active_call=True,
            allow_wait=True,
            reason="open_link",
            await_seconds_override=_AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS,
        )
        if not path_ready:
            emit_resp(
                req_id,
                False,
                payload={
                    "code": "no_route",
                    "pathState": path_state,
                    "pathAwaitSeconds": _AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS,
                },
                error="No confirmed Reticulum path for group audio link",
            )
            return
        link_id = str(uuid.uuid4())
        link = RNS.Link(
            outbound,
            established_callback=on_outgoing_audio_link_established,
            closed_callback=on_audio_link_closed,
        )
        _audio_links_by_id[link_id] = {
            "link": link,
            "peerPresenceHash": peer_key,
            "peerDestinationHash": destination_hash_hex(outbound.hash),
            "incoming": False,
            "established": False,
        }
        _audio_link_ids_by_object[id(link)] = link_id
        _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
        emit_resp(
            req_id,
            True,
            payload={"linkId": link_id, "established": False},
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_close_group_audio_link(req_id: str, payload: Dict[str, Any]) -> None:
    link_id = str(payload.get("linkId") or "")
    if not link_id:
        emit_resp(req_id, False, error="Missing linkId")
        return
    state = get_audio_link_state(link_id)
    if state is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "unknown_link_id"},
            error="Unknown audio link id",
        )
        return
    link = state.get("link")
    try:
        if link is not None:
            try:
                link.set_link_closed_callback(None)
            except Exception:
                pass
            link.teardown()
        emit_audio_link_closed(link_id, "local_close")
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_get_local_identity_public_key(req_id: str, payload: Dict[str, Any]) -> None:
    if _identity is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return
    try:
        pub = _identity.get_public_key()
        if not isinstance(pub, bytes) or len(pub) != 64:
            emit_resp(req_id, False, error="Unexpected identity public key length")
            return
        b64 = base64.b64encode(pub).decode("ascii")
        emit_resp(req_id, True, payload={"publicKeyBase64": b64})
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_register_peer_identity(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    pk_b64 = payload.get("reticulumIdentityPublicKeyBase64")
    if not peer_hash or not isinstance(pk_b64, str) or not pk_b64.strip():
        emit_resp(req_id, False, error="Missing peerPresenceHash or reticulumIdentityPublicKeyBase64")
        return
    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return
    local_hex = destination_hash_hex(_destination.hash)
    if peer_hash == local_hex:
        emit_resp(req_id, False, error="Cannot register self")
        return
    try:
        s = pk_b64.strip()
        pad = "=" * ((4 - len(s) % 4) % 4)
        pub_bytes = base64.b64decode(s + pad, validate=True)
    except Exception:
        emit_resp(req_id, False, error="Invalid base64")
        return
    if len(pub_bytes) != 64:
        emit_resp(req_id, False, error="Bad public key length")
        return
    try:
        ident = RNS.Identity(create_keys=False)
        ident.load_public_key(pub_bytes)
        outbound = RNS.Destination(
            ident,
            RNS.Destination.OUT,
            RNS.Destination.SINGLE,
            APP_NAMESPACE,
            PRESENCE_ASPECT,
            PRESENCE_VERSION,
        )
        derived = destination_hash_hex(outbound.hash)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))
        return
    if derived != peer_hash:
        emit_resp(req_id, False, error="reticulum_public_key_hash_mismatch")
        return
    _register_peer(peer_hash, ident, "gcall_join")
    emit_resp(req_id, True)


def handle_warm_group_audio_path(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return
    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return
    path_state, ready = _warm_call_media_path_if_possible(
        peer_hash,
        active_call=True,
        allow_wait=True,
        reason="explicit_warm",
    )
    emit_resp(
        req_id,
        True,
        payload={
            "pathState": path_state,
            "ready": ready,
        },
    )


def handle_send_group_audio_link_heartbeat(req_id: str, payload: Dict[str, Any]) -> None:
    room_id = str(payload.get("roomId") or "")
    command = str(payload.get("command") or "")
    if not room_id or command not in ("PING", "PONG"):
        emit_resp(req_id, False, error="Missing roomId or invalid heartbeat command")
        return
    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    link_id = str(payload.get("linkId") or "").strip()
    peer_key = str(payload.get("peerPresenceHash") or "").strip().lower()
    state: Optional[Dict[str, Any]] = None
    resolved_link_id = link_id
    if resolved_link_id:
        state = get_audio_link_state(resolved_link_id)
        if state is None:
            emit_resp(
                req_id,
                False,
                payload={"code": "unknown_link_id"},
                error="Unknown audio link id",
            )
            return
    else:
        if not peer_key:
            emit_resp(req_id, False, error="Missing linkId or peerPresenceHash")
            return
        candidate = _outgoing_audio_link_id_by_peer_hash.get(peer_key)
        if candidate:
            state = get_audio_link_state(candidate)
            resolved_link_id = candidate
        if state is None:
            for candidate_link_id, candidate_state in _audio_links_by_id.items():
                if (
                    str(candidate_state.get("peerPresenceHash") or "").strip().lower()
                    == peer_key
                ):
                    state = candidate_state
                    resolved_link_id = candidate_link_id
                    break
        if state is None:
            emit_resp(
                req_id,
                False,
                payload={"code": "audio_link_not_ready"},
                error="Audio link not ready",
            )
            return

    link = state.get("link")
    if state.get("established") is not True or link is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "audio_link_not_ready"},
            error="Audio link not ready",
        )
        return

    wire: Dict[str, Any] = {
        "t": _GROUP_AUDIO_HEARTBEAT_WIRE_TYPE,
        "R": room_id,
        "c": command,
        "m": int(time.time() * 1000),
    }
    seq = payload.get("seq")
    if isinstance(seq, int) and seq >= 0:
        wire["p"] = seq
    packet_rx_age_ms = payload.get("packetRxAgeMs")
    if isinstance(packet_rx_age_ms, (int, float)):
        wire["pa"] = max(-1, min(60000, int(packet_rx_age_ms)))
    packet_rx_recent = payload.get("packetRxRecent")
    if isinstance(packet_rx_recent, bool):
        wire["pr"] = 1 if packet_rx_recent else 0
    encoded = _encode_group_signal_wire(wire)
    if not encoded.get("ok"):
        emit_resp(
            req_id,
            False,
            payload=encoded.get("payload"),
            error=str(encoded.get("error") or "Wire encoding failed"),
        )
        return
    try:
        packet = RNS.Packet(link, encoded["wire_bytes"], create_receipt=False)
        result = packet.send()
        if result is False:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_false"},
                error="Packet send returned False",
            )
            return
        state["last_activity_at"] = time.time()
        emit_resp(req_id, True, payload={"linkId": resolved_link_id})
    except Exception as exc:
        emit_resp(
            req_id,
            False,
            payload={"code": "exception"},
            error=str(exc),
        )


def handle_command(message: Dict[str, Any]) -> None:
    req_id = str(message.get("id") or "")
    action = message.get("action")
    payload = message.get("payload")

    if not req_id:
        emit_event(
            "error",
            {"code": "missing_id", "message": "Command frame missing id"},
        )
        return

    if not isinstance(payload, dict):
        payload = {}

    if action == "start":
        handle_start(req_id, payload)
    elif action == "publish_presence":
        handle_publish_presence(req_id, payload)
    elif action == "forward_presence":
        handle_forward_presence(req_id, payload)
    elif action == "overlay_sync_state":
        handle_overlay_sync_state(req_id, payload)
    elif action == "overlay_note_candidate_failure":
        handle_overlay_note_candidate_failure(req_id, payload)
    elif action == "stop":
        handle_stop(req_id)
    elif action == "send_call":
        handle_send_call(req_id, payload)
    elif action == "accept_qchat_file_resource":
        handle_accept_qchat_file_resource(req_id, payload)
    elif action == "send_qchat_file_resource":
        handle_send_qchat_file_resource(req_id, payload)
    elif action == "authorize_qchat_file_resource":
        handle_authorize_qchat_file_resource(req_id, payload)
    elif action == "reject_qchat_file_resource":
        handle_reject_qchat_file_resource(req_id, payload)
    elif action == "fanout_call":
        handle_fanout_call(req_id, payload)
    elif action == "send_group_call":
        handle_send_group_call(req_id, payload)
    elif action == "fanout_group_call":
        handle_fanout_group_call(req_id, payload)
    elif action == "open_group_audio_link":
        handle_open_group_audio_link(req_id, payload)
    elif action == "close_group_audio_link":
        handle_close_group_audio_link(req_id, payload)
    elif action == "warm_group_audio_path":
        handle_warm_group_audio_path(req_id, payload)
    elif action == "send_group_audio_link_heartbeat":
        handle_send_group_audio_link_heartbeat(req_id, payload)
    elif action == "get_local_identity_public_key":
        handle_get_local_identity_public_key(req_id, payload)
    elif action == "register_peer_identity":
        handle_register_peer_identity(req_id, payload)
    else:
        emit_resp(req_id, False, error=f"Unknown action: {action}")


def stdin_loop() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except Exception as exc:
            emit_event(
                "error",
                {"code": "invalid_json", "message": str(exc), "detail": line[:200]},
            )
            continue

        if not isinstance(message, dict) or message.get("type") != "cmd":
            emit_event(
                "error",
                {
                    "code": "invalid_frame",
                    "message": "Expected cmd frame",
                    "detail": str(message)[:200],
                },
            )
            continue

        _cmd_queue_bounded.put(message)

    _cmd_queue_bounded.put(None)


def main() -> None:
    parser = argparse.ArgumentParser(description="Qortal Hub Reticulum presence bridge")
    parser.add_argument("--config", action="store", default=None, help="Reticulum config directory")
    args = parser.parse_args()

    if args.config:
        os.environ["QORTAL_RETICULUM_CONFIG_DIR"] = args.config
        ensure_started(args.config)

    _shutdown.clear()
    stdout_thread = threading.Thread(
        target=_stdout_writer_loop, name="reticulum-json-out", daemon=False
    )
    stdout_thread.start()
    audio_out_thread = threading.Thread(
        target=_audio_binary_out_writer_loop, name="reticulum-audio-out", daemon=True
    )
    audio_out_thread.start()
    rns_thread = threading.Thread(
        target=_rns_executor_loop, name="reticulum-rns", daemon=False
    )
    rns_thread.start()
    audio_in_thread = threading.Thread(
        target=_audio_in_reader_loop, name="reticulum-audio-in", daemon=True
    )
    audio_in_thread.start()

    stdin_thread = threading.Thread(target=stdin_loop, daemon=True)
    stdin_thread.start()
    stdin_thread.join()
    _shutdown.set()
    _cmd_queue_bounded.put(None)
    rns_thread.join(timeout=60.0)
    try:
        _json_resp_queue.put(None, timeout=0.1)
    except queue.Full:
        pass
    try:
        _json_event_queue.put_nowait(None)
    except queue.Full:
        pass
    stdout_thread.join(timeout=10.0)
    try:
        _audio_binary_out_queue.put_nowait(None)
    except queue.Full:
        pass
    audio_out_thread.join(timeout=5.0)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        sys.stdout.write(
            json.dumps(
                {
                    "type": "event",
                    "event": "error",
                    "payload": {
                        "code": "fatal",
                        "message": str(exc),
                        "detail": traceback.format_exc(limit=5),
                    },
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        sys.stdout.flush()

#!/usr/bin/env python3

import argparse
import base64
import json
import os
from collections import deque
import queue
import sys
import threading
import time
import traceback
import uuid
from typing import IO, Any, Dict, Optional

import RNS

APP_NAMESPACE = "qortal-hub"
PRESENCE_ASPECT = "presence"
PRESENCE_VERSION = "v1"
CALL_ASPECT = "call"
CALL_VERSION = "v1"
IDENTITY_FILENAME = "presence-bridge.identity"

_state_lock = threading.RLock()
_reticulum = None
_identity = None
_destination = None
_call_destination = None
_announce_handler = None
_call_announce_handler = None
_known_peers: Dict[str, Any] = {}
# Per-peer metadata: last_seen_inbound, last_send_ok, last_request_path_at, ts_seed_until (epoch seconds).
_peer_lifecycle: Dict[str, Dict[str, Any]] = {}
# Recent presence senders (destination hash hex, lowercased) for recall retries on publish.
_recent_presence_senders: "deque[str]" = deque(maxlen=128)
_last_presence_wire: Optional[bytes] = None
_last_transport_state: Optional[Dict[str, Any]] = None
_transport_monitor_thread: Optional[threading.Thread] = None
_MAX_ENCRYPTED_WIRE_BYTES = int(getattr(RNS.Packet, "ENCRYPTED_MDU", RNS.Packet.MDU))
# Grep logs for this string to confirm the rebuilt script is running (sync with GC_RETICULUM_WIRE_BUILD_MARKER in group-call-wire-reticulum.ts).
PRESENCE_BRIDGE_BUILD = "wire378-gq-frag-v1"

# Peer cache: must match TS base58 in electron/src/presence.ts (Qortal alphabet).
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_MAP = {c: i for i, c in enumerate(_BASE58_ALPHABET)}

# Lifecycle / path nudge (see reticulum presence plan).
_PEER_STALE_SECONDS = 4 * 3600
_PEER_TS_SEED_LEASE_SECONDS = 300
_MAX_KNOWN_PEERS = 256
_REQUEST_PATH_COOLDOWN_SECONDS = 90.0
_MAX_PATH_NUDGES_PER_PUBLISH = 5
_KR_MISMATCH_LOGGED: set[str] = set()

# Hub mesh peer exchange (Reticulum transport hints — TCP endpoint ≠ identity)
_MESH_TYPES = frozenset({"HUB_MESH_PEER_REQUEST", "HUB_MESH_PEER_RESPONSE"})
_MAX_MESH_PEER_REQUESTS_PER_MINUTE = 12
_mesh_req_times: Dict[str, deque] = {}


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
_audio_links_by_id: Dict[str, Dict[str, Any]] = {}
_audio_link_ids_by_object: Dict[int, str] = {}
_outgoing_audio_link_id_by_peer_hash: Dict[str, str] = {}
_TRANSPORT_MONITOR_INTERVAL_SECONDS = 5.0

# Binary audio IPC (fd 3 parent→child, fd 4 child→parent). Must match electron/src/reticulum-audio-ipc.ts.
# Diagnostics: grep logs for "target=reticulum-audio-ipc" (fd open, parse, drops, first bytes).
_AUDIO_IPC_LOG = "target=reticulum-audio-ipc"
AUDIO_MAGIC = b"QAUD"
AUDIO_VERSION = 1
AUDIO_HEADER_BYTES = 9
AUDIO_MAX_BODY = 65536
AUDIO_MAX_FRAMES = 32
AUDIO_MAX_PAYLOAD = 8192
AUDIO_MAX_LINK_ID_LEN = 36
AUDIO_MAX_ROOM_ID_LEN = 255
AUDIO_MAX_HASH_LEN = 128

_CMD_QUEUE_MAX = 256
_AUDIO_DECODED_QUEUE_MAX = 48
_JSON_OUT_QUEUE_MAX = 2048
_AUDIO_BINARY_OUT_QUEUE_MAX = 128

_shutdown = threading.Event()
_json_line_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_OUT_QUEUE_MAX
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
# One-shot narrowing logs (grep target=reticulum-audio-ipc stage=…)
_audio_ipc_fd3_first_batch_ok_logged = False
_audio_ipc_rns_first_send_ok_logged = False
_audio_ipc_fd4_first_chunk_logged = False

# Compact group-call control on call aspect (see electron/src/group-call-wire-reticulum.ts).
_GROUP_CALL_WIRE_TYPES = frozenset(
    {
        "GA",
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


def _queue_json_line(frame: Dict[str, Any]) -> None:
    global _audio_drops_json_out
    try:
        _json_line_queue.put_nowait(frame)
    except queue.Full:
        _audio_drops_json_out += 1
        if _audio_drops_json_out % 200 == 1:
            log(
                f"[presence_bridge] json_out_queue full drops={_audio_drops_json_out}"
            )


def emit(frame: Dict[str, Any]) -> None:
    _queue_json_line(frame)


def emit_resp(req_id: str, ok: bool, payload: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    frame: Dict[str, Any] = {"type": "resp", "id": req_id, "ok": ok}
    if payload is not None:
        frame["payload"] = payload
    if error is not None:
        frame["error"] = error
    _queue_json_line(frame)


def emit_event(event: str, payload: Optional[Dict[str, Any]] = None) -> None:
    frame: Dict[str, Any] = {"type": "event", "event": event}
    if payload is not None:
        frame["payload"] = payload
    _queue_json_line(frame)


def _emit_binary_audio(chunk: bytes) -> None:
    global _audio_drops_binary_out, _audio_ipc_fd4_first_chunk_logged
    try:
        _audio_binary_out_queue.put_nowait(chunk)
        if not _audio_ipc_fd4_first_chunk_logged:
            _audio_ipc_fd4_first_chunk_logged = True
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd4-first-chunk-enqueued-to-parent "
                f"len={len(chunk)}"
            )
    except queue.Full:
        _audio_drops_binary_out += 1
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
        o += pl  # peer presence hash — unused on parent→child sends
        if o >= len(body):
            raise ValueError("truncated")
        cl = body[o]
        o += 1
        if cl > AUDIO_MAX_HASH_LEN or o + cl > len(body):
            raise ValueError("bad pch")
        o += cl  # peer call hash — unused on send path
        if o + 2 > len(body):
            raise ValueError("truncated plen")
        plen = int.from_bytes(body[o : o + 2], "big")
        o += 2
        if plen > AUDIO_MAX_PAYLOAD or o + plen > len(body):
            raise ValueError("bad payload")
        raw = bytes(body[o : o + plen])
        o += plen
        out.append((link_id, room_id, raw))
    if o != len(body):
        raise ValueError("leftover")
    return out


def _encode_audio_batch_binary(
    frames: list,
) -> bytes:
    """frames: list of (link_id, room_id, peer_presence_hash, peer_call_hash, raw: bytes)"""
    n = len(frames)
    if n == 0 or n > AUDIO_MAX_FRAMES:
        raise ValueError("bad frame count")
    body = bytearray()
    body.extend(n.to_bytes(2, "big"))
    for link_id, room_id, pph, pch, raw in frames:
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
    """frames: list of (link_id, room_id, raw_opus_bytes)"""
    global _audio_ipc_rns_first_send_ok_logged
    for link_id, room_id, raw in frames:
        state = get_audio_link_state(link_id)
        if state is None:
            emit_event(
                "group_audio_send_failed",
                {
                    "linkId": link_id,
                    "reason": "unknown_link_id",
                    "code": "unknown_link_id",
                },
            )
            continue
        if state.get("established") is not True:
            emit_event(
                "group_audio_send_failed",
                {
                    "linkId": link_id,
                    "reason": "audio_link_not_ready",
                    "code": "audio_link_not_ready",
                },
            )
            continue
        link = state.get("link")
        if link is None:
            emit_event(
                "group_audio_send_failed",
                {
                    "linkId": link_id,
                    "reason": "unknown_link_id",
                    "code": "unknown_link_id",
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
                        "reason": "audio_payload_too_large",
                        "code": "audio_payload_too_large",
                    },
                )
                continue
            packet = RNS.Packet(link, wire_bytes, create_receipt=False)
            result = packet.send()
            if result is False:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "reason": "packet_send_false",
                        "code": "packet_send_false",
                    },
                )
            else:
                if not _audio_ipc_rns_first_send_ok_logged:
                    _audio_ipc_rns_first_send_ok_logged = True
                    log(
                        f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-first-packet-send-ok "
                        f"link_prefix={link_id[:8] if len(link_id) >= 8 else link_id} bytes_wire={len(wire_bytes)}"
                    )
        except Exception as exc:
            emit_event(
                "group_audio_send_failed",
                {
                    "linkId": link_id,
                    "reason": "exception",
                    "code": "exception",
                    "error": str(exc),
                },
            )


def _stdout_writer_loop() -> None:
    while True:
        frame = _json_line_queue.get()
        if frame is None:
            break
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
        chunk = _audio_binary_out_queue.get()
        if chunk is None:
            break
        try:
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
            _audio_decoded_queue.put_nowait(frames)
        except queue.Full:
            _audio_drops_ingress += 1
            if _audio_drops_ingress % 100 == 1:
                log(
                    f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=decoded-queue-full drops={_audio_drops_ingress}"
                )


def _rns_executor_loop() -> None:
    while True:
        drained_audio = False
        try:
            while True:
                batch = _audio_decoded_queue.get_nowait()
                _process_audio_batch(batch)
                drained_audio = True
        except queue.Empty:
            pass
        if drained_audio:
            continue
        try:
            message = _cmd_queue_bounded.get(timeout=0.05)
        except queue.Empty:
            if _shutdown.is_set() and _cmd_queue_bounded.empty() and _audio_decoded_queue.empty():
                return
            continue
        if message is None:
            try:
                while True:
                    batch = _audio_decoded_queue.get_nowait()
                    _process_audio_batch(batch)
            except queue.Empty:
                pass
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


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return False


def summarize_transport_state(payload: Dict[str, Any]) -> str:
    return (
        f"{payload.get('reachability')} "
        f"hubs={payload.get('onlineHubInterfaces', 0)}/{payload.get('configuredHubInterfaces', 0)} "
        f"transport={'on' if payload.get('transportEnabled') else 'off'}"
    )


def collect_transport_state() -> Dict[str, Any]:
    if _reticulum is None:
        return {
            "reachability": "unknown",
            "transportEnabled": False,
            "configuredHubInterfaces": 0,
            "onlineHubInterfaces": 0,
            "hubSummary": "Reticulum bridge not started",
            "reason": "Reticulum bridge not started",
            "meshTcpListenOnline": False,
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
        if item.get("type") in ("TCPClientInterface", "BackboneInterface")
    ]
    online_hubs = [item for item in hub_interfaces if item.get("online")]
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

    mesh_tcp_listen_online = False
    for item in normalised:
        if (
            item.get("name") == "Qortal Hub Mesh Listen"
            and item.get("type") == "TCPServerInterface"
            and item.get("online")
        ):
            mesh_tcp_listen_online = True
            break

    return {
        "reachability": reachability,
        "transportEnabled": "transport_id" in stats,
        "configuredHubInterfaces": len(hub_interfaces),
        "onlineHubInterfaces": len(online_hubs),
        "hubSummary": hub_summary,
        "meshTcpListenOnline": mesh_tcp_listen_online,
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
            "hubSummary": "Unable to read Reticulum interface stats",
            "reason": str(exc),
            "meshTcpListenOnline": False,
        }

    previous = _last_transport_state
    if not force and previous == payload:
        return

    _last_transport_state = payload
    emit_event("transport_state", payload)
    log(f"[presence_bridge] transport_state {summarize_transport_state(payload)}")

    if payload.get("reachability") == "hub-connected" and (
        previous is None or previous.get("reachability") != "hub-connected"
    ):
        announce_local_destination()
        announce_call_local_destination()


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


def _register_peer(
    peer_key: str,
    peer_identity: Any,
    source: str,
) -> None:
    """Register identity for fanout; updates lifecycle by source."""
    global _known_peers, _peer_lifecycle
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
    if source in ("inbound", "announce", "wire_kr"):
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


def identity_hash_hex(identity: Any) -> str:
    raw = getattr(identity, "hash", None)
    if isinstance(raw, bytes):
        return destination_hash_hex(raw)
    return ""


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
    _register_peer(peer_key, recalled, registration_source)
    if _last_presence_wire is not None:
        send_presence_wire_to_peer(peer_key, recalled, _last_presence_wire)
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
    if _last_presence_wire is not None:
        send_presence_wire_to_peer(peer_key, ident, _last_presence_wire)
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
        if _last_presence_wire is not None:
            send_presence_wire_to_peer(peer_hash, announced_identity, _last_presence_wire)


class CallAnnounceHandler:
    """Registers on the call aspect so Reticulum learns paths to peers' call destinations."""

    def __init__(self, local_hash: bytes):
        self.aspect_filter = f"{APP_NAMESPACE}.{CALL_ASPECT}.{CALL_VERSION}"
        self.local_hash = local_hash

    def received_announce(self, destination_hash, announced_identity, app_data):
        if destination_hash == self.local_hash:
            return
        peer_hash = destination_hash_hex(destination_hash)
        log(f"[presence_bridge] call aspect announce peer_call={peer_hash}")


def build_outbound_destination(peer_identity):
    return RNS.Destination(
        peer_identity,
        RNS.Destination.OUT,
        RNS.Destination.SINGLE,
        APP_NAMESPACE,
        PRESENCE_ASPECT,
        PRESENCE_VERSION,
    )


def build_outbound_call_destination(peer_identity):
    return RNS.Destination(
        peer_identity,
        RNS.Destination.OUT,
        RNS.Destination.SINGLE,
        APP_NAMESPACE,
        CALL_ASPECT,
        CALL_VERSION,
    )


def make_presence_wire(envelope: Dict[str, Any]) -> bytes:
    if _destination is None:
        raise RuntimeError("Local destination not initialised")
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        raise RuntimeError("Presence envelope missing payload")

    wire = {
        "t": envelope.get("type"),
        "i": envelope.get("id"),
        "a": payload.get("address"),
        "k": payload.get("publicKey"),
        "n": payload.get("sessionId"),
        "m": envelope.get("timestamp"),
        "g": envelope.get("signature"),
        "r": destination_hash_hex(_destination.hash),
    }
    if "status" in payload:
        wire["s"] = payload.get("status")
    if "clientVersion" in payload:
        wire["c"] = payload.get("clientVersion")
    return json.dumps(wire, separators=(",", ":")).encode("utf-8")


def announce_local_destination() -> None:
    if _destination is None:
        return
    _destination.announce(app_data=b"presence")
    log(
        "[presence_bridge] announced local destination "
        + destination_hash_hex(_destination.hash)
    )


def announce_call_local_destination() -> None:
    if _call_destination is None:
        return
    _call_destination.announce(app_data=b"call")
    log(
        "[presence_bridge] announced call destination "
        + destination_hash_hex(_call_destination.hash)
    )


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


def _packet_source_hash_hex(packet) -> str:
    try:
        gh = getattr(packet, "get_source_hash", None)
        if callable(gh):
            h = gh()
            if isinstance(h, bytes) and len(h) == 16:
                return destination_hash_hex(h)
    except Exception:
        pass
    return ""


def _mesh_rate_limit_ok(sender_hash: str) -> bool:
    global _mesh_req_times
    now = time.time()
    window = 60.0
    dq = _mesh_req_times.setdefault(sender_hash, deque())
    while dq and dq[0] < now - window:
        dq.popleft()
    if len(dq) >= _MAX_MESH_PEER_REQUESTS_PER_MINUTE:
        return False
    dq.append(now)
    return True


def send_mesh_wire_to_peer(peer_hash: str, peer_identity, wire_obj: Dict[str, Any]) -> None:
    wire_bytes = json.dumps(wire_obj, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )
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
            log(f"[presence_bridge] target=reticulum-mesh send_failed peer={peer_hash}")
        else:
            st["last_send_ok"] = now
            log(f"[presence_bridge] target=reticulum-mesh sent peer={peer_hash}")
    except Exception as exc:
        if peer_hash in _peer_lifecycle:
            _peer_lifecycle[peer_hash]["last_send_ok"] = None
        log(f"[presence_bridge] target=reticulum-mesh send_exception peer={peer_hash}: {exc}")


def try_handle_mesh_packet(
    data: bytes, packet, message: Dict[str, Any]
) -> bool:
    t = message.get("t")
    if t not in _MESH_TYPES:
        return False
    sender_r = str(message.get("r") or "").lower()
    if len(sender_r) != 32:
        ph = _packet_source_hash_hex(packet)
        if len(ph) == 32:
            sender_r = ph
        else:
            log("[presence_bridge] target=reticulum-mesh ignored (bad sender r)")
            return True
    if t == "HUB_MESH_PEER_REQUEST":
        if not _mesh_rate_limit_ok(sender_r):
            log(
                "[presence_bridge] target=reticulum-mesh rate_limited "
                f"peer={sender_r[:16]}..."
            )
            return True
    elif t == "HUB_MESH_PEER_RESPONSE":
        if not _mesh_rate_limit_ok(sender_r + ":resp"):
            log(
                "[presence_bridge] target=reticulum-mesh rate_limited_response "
                f"peer={sender_r[:16]}..."
            )
            return True
    ensure_known_peer_from_recall(sender_r)
    emit_event(
        "mesh_peer_message",
        {
            "t": t,
            "senderHash": sender_r,
            "message": message,
        },
    )
    log(
        f"[presence_bridge] target=reticulum-mesh rx t={t} sender={sender_r[:16]}..."
    )
    return True


def make_group_audio_wire(room_id: str, data_b64: str) -> bytes:
    if _call_destination is None:
        raise RuntimeError("Local call destination not initialised")
    wire = {
        "t": _GROUP_AUDIO_WIRE_TYPE,
        "R": room_id,
        "d": data_b64,
        "r": destination_hash_hex(_call_destination.hash),
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
            "peerCallHash": state.get("peerCallHash") or "",
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
            "peerCallHash": state.get("peerCallHash") or "",
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
    identity_hex = identity_hash_hex(identity)
    if identity_hex:
        state["peerCallHash"] = identity_hex
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
        state["peerCallHash"] = sender_call_hash
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
                    str(state.get("peerCallHash") or ""),
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


def on_incoming_audio_link_established(link) -> None:
    link_id = str(uuid.uuid4())
    _audio_links_by_id[link_id] = {
        "link": link,
        "peerPresenceHash": "",
        "peerCallHash": "",
        "incoming": True,
        "established": True,
    }
    configure_audio_link(link, link_id)


def on_packet_received(data, packet) -> None:
    try:
        message = json.loads(data.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid packet payload: {exc}")
        return

    if not isinstance(message, dict):
        log("[presence_bridge] ignored non-object packet payload")
        return

    if try_handle_mesh_packet(data, packet, message):
        return

    message_type = message.get("t")
    message_id = message.get("i")
    address = message.get("a")
    public_key = message.get("k")
    session_id = message.get("n")
    timestamp = message.get("m")
    signature = message.get("g")
    sender_hash = message.get("r")

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
        return

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
        return

    envelope = {
        "id": message_id,
        "type": message_type,
        "senderAddress": address,
        "timestamp": timestamp,
        "payload": payload,
        "signature": signature,
    }

    peer_key = sender_hash.lower()
    _recent_presence_senders.append(peer_key)
    ensure_known_peer_from_recall(peer_key)
    if peer_key not in _known_peers:
        ensure_known_peer_from_wire_kr(public_key, sender_hash)
    if peer_key in _known_peers:
        st = _peer_lifecycle.setdefault(
            peer_key,
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
                f"peer={peer_key[:24]}..."
            )

    emit_event(
        "presence_message",
        {
            "envelope": envelope,
            "route": {
                "kind": "reticulum",
                "destinationHash": sender_hash,
            },
        },
    )
    log(
        f"[presence_bridge] received presence packet sender={sender_hash} envelope_type={envelope.get('type')} size={len(data)}"
    )


def on_call_packet_received(data, packet) -> None:
    try:
        message = json.loads(data.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid call packet payload: {exc}")
        return

    if not isinstance(message, dict):
        log("[presence_bridge] ignored non-object call packet payload")
        return

    sender_r = message.get("r")
    sender_call_hash = sender_r if isinstance(sender_r, str) else ""

    t = message.get("t")
    event_name = (
        "group_call_message" if isinstance(t, str) and t in _GROUP_CALL_WIRE_TYPES else "call_message"
    )
    emit_event(
        event_name,
        {
            "wire": message,
            "senderCallHash": sender_call_hash,
        },
    )
    log(
        f"[presence_bridge] received {event_name} t={message.get('t')} sender_r={sender_call_hash[:16] if sender_call_hash else ''} size={len(data)}"
    )


def ensure_started(config_dir: str):
    global _reticulum, _identity, _destination, _call_destination
    global _announce_handler, _call_announce_handler

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
        _destination.set_packet_callback(on_packet_received)
        _announce_handler = PresenceAnnounceHandler(_destination.hash)
        RNS.Transport.register_announce_handler(_announce_handler)

        _call_destination = RNS.Destination(
            _identity,
            RNS.Destination.IN,
            RNS.Destination.SINGLE,
            APP_NAMESPACE,
            CALL_ASPECT,
            CALL_VERSION,
        )
        _call_destination.set_proof_strategy(RNS.Destination.PROVE_NONE)
        _call_destination.set_packet_callback(on_call_packet_received)
        _call_destination.set_link_established_callback(on_incoming_audio_link_established)
        _call_announce_handler = CallAnnounceHandler(_call_destination.hash)
        RNS.Transport.register_announce_handler(_call_announce_handler)
        ensure_transport_monitor_started()
        return _destination


def handle_start(req_id: str, payload: Dict[str, Any]) -> None:
    config_dir = str(payload.get("configDir") or os.environ.get("QORTAL_RETICULUM_CONFIG_DIR") or "")
    if not config_dir:
        emit_resp(req_id, False, error="Missing configDir")
        return

    try:
        destination = ensure_started(config_dir)
        announce_local_destination()
        announce_call_local_destination()
        maybe_emit_transport_state(force=True)
        presence_hex = destination_hash_hex(destination.hash)
        call_hex = (
            destination_hash_hex(_call_destination.hash)
            if _call_destination is not None
            else ""
        )
        emit_event(
            "ready",
            {"destinationHash": presence_hex, "callDestinationHash": call_hex},
        )
        emit_resp(
            req_id,
            True,
            payload={"destinationHash": presence_hex, "callDestinationHash": call_hex},
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
        wire_bytes = make_presence_wire(envelope)
        global _last_presence_wire
        _last_presence_wire = wire_bytes
        announce_local_destination()
        announce_call_local_destination()
        for ph in list(_recent_presence_senders):
            ensure_known_peer_from_recall(ph)
        extra = payload.get("additionalFanoutHashes")
        if isinstance(extra, list):
            for h in extra:
                if isinstance(h, str) and h.strip():
                    ensure_known_peer_from_recall(h.strip().lower(), "ts_seed")
        _maybe_prune_stale_peers()
        nudge_budget = [_MAX_PATH_NUDGES_PER_PUBLISH]
        for peer_hash in sorted(_known_peers.keys()):
            try:
                hb = bytes.fromhex(peer_hash)
            except ValueError:
                continue
            if len(hb) != 16:
                continue
            _request_path_if_eligible(peer_hash, hb, nudge_budget)
        peer_hashes = sorted(_known_peers.keys())
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
        for peer_hash, peer_identity in list(_known_peers.items()):
            send_presence_wire_to_peer(peer_hash, peer_identity, wire_bytes)
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


def handle_stop(req_id: str) -> None:
    emit_resp(req_id, True)


def handle_send_call(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    msg = payload.get("message")
    if not peer_hash or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHash or message")
        return

    if _call_destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_identity = _known_peers.get(peer_hash)
    if peer_identity is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "unknown_peer_presence_hash"},
            error="Unknown peer presence hash",
        )
        return

    try:
        out = _normalize_json_numbers(dict(msg))
        out["r"] = destination_hash_hex(_call_destination.hash)
        wire_bytes = _call_wire_json_bytes(out)
        if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
            emit_resp(
                req_id,
                False,
                payload={
                    "code": "wire_too_large",
                    "wireBytes": len(wire_bytes),
                    "maxWireBytes": _MAX_ENCRYPTED_WIRE_BYTES,
                    "messageType": out.get("t"),
                },
                error=(
                    f"Wire size {len(wire_bytes)} exceeds encrypted MDU "
                    f"{_MAX_ENCRYPTED_WIRE_BYTES}"
                ),
            )
            return
        if len(wire_bytes) > 600:
            log(f"[presence_bridge] warning call packet len={len(wire_bytes)}")
        outbound = build_outbound_call_destination(peer_identity)
        packet = RNS.Packet(outbound, wire_bytes, create_receipt=False)
        result = packet.send()
        if result is False:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_false"},
                error="Packet send returned False",
            )
            return
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_send_group_call(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    msg = payload.get("message")
    if not peer_hash or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHash or message")
        return

    if _call_destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_identity = _known_peers.get(peer_hash)
    if peer_identity is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "unknown_peer_presence_hash"},
            error="Unknown peer presence hash",
        )
        return

    try:
        out = _normalize_json_numbers(dict(msg))
        out["r"] = destination_hash_hex(_call_destination.hash)
        wire_bytes = _call_wire_json_bytes(out)
        if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
            emit_resp(
                req_id,
                False,
                payload={
                    "code": "wire_too_large",
                    "wireBytes": len(wire_bytes),
                    "maxWireBytes": _MAX_ENCRYPTED_WIRE_BYTES,
                    "messageType": out.get("t"),
                },
                error=(
                    f"Wire size {len(wire_bytes)} exceeds encrypted MDU "
                    f"{_MAX_ENCRYPTED_WIRE_BYTES}"
                ),
            )
            return
        outbound = build_outbound_call_destination(peer_identity)
        packet = RNS.Packet(outbound, wire_bytes, create_receipt=False)
        result = packet.send()
        if result is False:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_false"},
                error="Packet send returned False",
            )
            return
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_open_group_audio_link(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return

    if _call_destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return

    peer_identity = _known_peers.get(peer_hash)
    if peer_identity is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "unknown_peer_presence_hash"},
            error="Unknown peer presence hash",
        )
        return

    existing_link_id = _outgoing_audio_link_id_by_peer_hash.get(peer_hash)
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
        outbound = build_outbound_call_destination(peer_identity)
        link_id = str(uuid.uuid4())
        link = RNS.Link(
            outbound,
            established_callback=on_outgoing_audio_link_established,
            closed_callback=on_audio_link_closed,
        )
        _audio_links_by_id[link_id] = {
            "link": link,
            "peerPresenceHash": peer_hash,
            "peerCallHash": destination_hash_hex(outbound.hash),
            "incoming": False,
            "established": False,
        }
        _audio_link_ids_by_object[id(link)] = link_id
        _outgoing_audio_link_id_by_peer_hash[peer_hash] = link_id
        emit_resp(
            req_id,
            True,
            payload={"linkId": link_id, "established": False},
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_mesh_send_peer_exchange(req_id: str, payload: Dict[str, Any]) -> None:
    if _destination is None:
        emit_resp(req_id, False, error="bridge_not_started")
        return
    peer_hash = str(payload.get("peerPresenceHash") or "").lower()
    if not peer_hash:
        emit_resp(req_id, False, error="missing_peerPresenceHash")
        return
    peer_identity = _known_peers.get(peer_hash)
    if peer_identity is None:
        emit_resp(req_id, False, error="unknown_peer")
        return
    kind = str(payload.get("kind") or "")
    local_hex = destination_hash_hex(_destination.hash)
    now_ms = int(time.time() * 1000)
    if kind == "request":
        wire: Dict[str, Any] = {
            "t": "HUB_MESH_PEER_REQUEST",
            "r": local_hex,
            "m": now_ms,
        }
    elif kind == "response":
        peers = payload.get("endpoints")
        if not isinstance(peers, list):
            peers = []
        wire = {
            "t": "HUB_MESH_PEER_RESPONSE",
            "r": local_hex,
            "m": now_ms,
            "peers": peers,
        }
    else:
        emit_resp(req_id, False, error="bad_kind")
        return
    send_mesh_wire_to_peer(peer_hash, peer_identity, wire)
    emit_resp(req_id, True)


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
            link.teardown()
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


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
    elif action == "stop":
        handle_stop(req_id)
    elif action == "send_call":
        handle_send_call(req_id, payload)
    elif action == "send_group_call":
        handle_send_group_call(req_id, payload)
    elif action == "open_group_audio_link":
        handle_open_group_audio_link(req_id, payload)
    elif action == "close_group_audio_link":
        handle_close_group_audio_link(req_id, payload)
    elif action == "mesh_send_peer_exchange":
        handle_mesh_send_peer_exchange(req_id, payload)
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
        _json_line_queue.put_nowait(None)
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

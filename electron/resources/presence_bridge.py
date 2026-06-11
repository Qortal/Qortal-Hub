#!/usr/bin/env python3

import argparse
import base64
import hashlib
import json
import math
import os
import selectors
from collections import deque
import queue
import secrets
import shutil
import socket
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
from typing import IO, Any, Callable, Dict, List, Optional, Set, Tuple

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
_overlay_peer_failures: Dict[str, Dict[str, Any]] = {}
# Outbound peers we chose for our presence overlay fanout.
_active_overlay_neighbors: Dict[str, float] = {}
# Inbound peers that chose us. They are included in publish fanout too, but
# have their own cap so inbound reciprocity is not blocked by outbound fill.
_inbound_overlay_neighbors: Dict[str, float] = {}
# Per-peer metadata: last_seen_inbound, last_send_ok, last_request_path_at, ts_seed_until (epoch seconds).
_peer_lifecycle: Dict[str, Dict[str, Any]] = {}
# Recent presence senders (destination hash hex, lowercased) for recall retries on publish.
_recent_presence_senders: "deque[str]" = deque(maxlen=128)
_last_presence_wire: Optional[bytes] = None
_last_transport_state: Optional[Dict[str, Any]] = None
_transport_monitor_thread: Optional[threading.Thread] = None
_rns_callback_scheduler_monitor_thread: Optional[threading.Thread] = None
_MAX_ENCRYPTED_WIRE_BYTES = int(getattr(RNS.Packet, "ENCRYPTED_MDU", RNS.Packet.MDU))
# Grep logs for this string to confirm the rebuilt script is running (sync with GC_RETICULUM_WIRE_BUILD_MARKER in group-call-wire-reticulum.ts).
PRESENCE_BRIDGE_BUILD = "wire394-reticulum-binary-audio-v1"

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
_OVERLAY_MAX_OUTBOUND_NEIGHBORS = 12
_OVERLAY_MAX_INBOUND_NEIGHBORS = 8
_OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS = _OVERLAY_MAX_OUTBOUND_NEIGHBORS
_OVERLAY_MIN_HEALTHY_FANOUT = 8
_OVERLAY_NEIGHBOR_GRACE_SECONDS = 90.0
_CANDIDATE_PROOF_WINDOW_SECONDS = 90.0
_CANDIDATE_FAILURE_LIMIT = 2
_OVERLAY_DEFAULT_HOPS = 4
_OVERLAY_LINK_PATH_REQUEST_COOLDOWN_SECONDS = 5.0
_OVERLAY_LINK_PATH_AWAIT_SECONDS = 0.35
_OVERLAY_LINK_FAILURE_SUPPRESS_LIMIT = 2
_OVERLAY_LINK_FAILURE_SUPPRESS_SECONDS = 3 * 60.0
_OVERLAY_LINK_TIMEOUT_RECENT_ACTIVITY_GRACE_SECONDS = 30.0
_PRESENCE_BRIDGE_VERBOSE_LOGS = (
    os.environ.get("QORTAL_PRESENCE_BRIDGE_VERBOSE_LOGS", "").strip().lower()
    in ("1", "true", "yes", "on")
)
# Presence heartbeats are expected every 25s and TS expires sessions after 95s.
# Keep overlay links a little longer than that, but do not trust a link forever
# when no inbound Qortal overlay traffic arrives after the remote app exits.
_OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS = 95.0
_QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS = 8.0
_QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS = 4
_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS = 2.0
# Inbound RNS.Link: classify overlay vs audio by first JSON packet; if none, default to overlay.
_INBOUND_LINK_CLASSIFY_TIMEOUT_SEC = 5.0
_pending_inbound_classify_link_ids: Set[int] = set()
_inbound_classify_timers: Dict[int, threading.Timer] = {}

# RNS Destination.announce: once after authenticated local presence activity
# (PRESENCE_ANNOUNCE, or PRESENCE_HEARTBEAT after bridge recovery), then every
# RNS_ANNOUNCE_INTERVAL_SEC while session active; cancel on PRESENCE_OFFLINE / stop.
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
_GROUP_AUDIO_BINARY_MAGIC = b"QGAU"
_GROUP_AUDIO_BINARY_VERSION = 1
_GROUP_AUDIO_BINARY_HEADER_BYTES = 9
_audio_links_by_id: Dict[str, Dict[str, Any]] = {}
_audio_link_ids_by_object: Dict[int, str] = {}
_outgoing_audio_link_id_by_peer_hash: Dict[str, str] = {}
_active_audio_link_id_by_peer_hash: Dict[str, str] = {}
_audio_link_desired_by_peer_hash: Dict[str, Dict[str, Any]] = {}
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
_QCHAT_FILE_SUCCESS_LINK_CLOSE_GRACE_SECONDS = 15.0
_QCHAT_FILE_CHUNK_ACK_TIMEOUT_SECONDS = 90.0
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
_CMD_DRAIN_BATCH_MAX = 16 if os.name == "nt" else 8
_AUDIO_DECODED_QUEUE_MAX = 96
_JSON_RESP_OUT_QUEUE_MAX = 512
_JSON_EVENT_OUT_QUEUE_MAX = 2048
_AUDIO_BINARY_OUT_QUEUE_MAX = 128
_AUDIO_BATCH_STALE_SECONDS = 0.75
_AUDIO_OUTBOUND_DEADLINE_SECONDS = 0.32
_AUDIO_DATA_PLANE_STALE_MS = 160
_AUDIO_DATA_PLANE_MAX_ROUTES = 128
_AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS = 2
_AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS = 16
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
_AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS = 6.0
_AUDIO_LINK_RETRY_MIN_SECONDS = 1.0
_AUDIO_LINK_RETRY_MAX_SECONDS = 20.0
_PACKET_PATH_WARMING_TIMEOUTS_BEFORE_FAILING = 2
_PACKET_PATH_INBOUND_FRESH_SECONDS = 3.0
_PACKET_PATH_POLL_INTERVAL_SECONDS = 0.01
_SCHEDULER_AUDIO_SHARDS = 4
_SCHEDULER_SLOW_TASK_LOG_THRESHOLD_MS = 80.0
_SCHEDULER_QUEUE_MAX_BY_LANE: Dict[str, int] = {
    "control-send": 256,
    "link-management": 128,
    "path-management": 128,
    "file-transfer": 64,
}
for _audio_shard in range(_SCHEDULER_AUDIO_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"audio-send-{_audio_shard}"] = 64

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
_scheduler_queues: Dict[str, "queue.Queue[Optional[Tuple[float, str, Callable[..., Any], tuple, dict]]]"] = {}
_scheduler_threads: list[threading.Thread] = []
_scheduler_stats: Dict[str, Dict[str, Any]] = {}
_rns_wake_read_fd: Optional[int] = None
_rns_wake_write_fd: Optional[int] = None
if os.name != "nt":
    try:
        _rns_wake_read_fd, _rns_wake_write_fd = os.pipe()
        os.set_blocking(_rns_wake_read_fd, False)
        os.set_blocking(_rns_wake_write_fd, False)
    except OSError:
        _rns_wake_read_fd = None
        _rns_wake_write_fd = None
_audio_in_fd: Optional[int] = None
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
_audio_deadline_drops = 0
_audio_decoded_queue_evict_oldest = 0
_audio_decoded_queue_drop_newest = 0
_audio_fd3_decoded_age_ms_max = 0.0
_audio_decoded_queue_dwell_ms_max = 0.0
_audio_rns_send_duration_ms_max = 0.0
_audio_packet_path_check_ms_max = 0.0
_audio_executor_loop_gap_ms_max = 0.0
_audio_executor_gap_while_queued_ms_max = 0.0
_audio_executor_audio_pass_ms_max = 0.0
_audio_process_batch_ms_max = 0.0
_audio_process_batch_frames_max = 0
_audio_rns_send_slow_count = 0
_audio_executor_stall_count = 0
_audio_executor_command_ms_max = 0.0
_audio_executor_command_while_queued_ms_max = 0.0
_audio_executor_command_slow_count = 0
_audio_rns_callback_scheduler_gap_ms_max = 0.0
_audio_rns_callback_scheduler_gap_over_100_count = 0
_audio_rns_callback_scheduler_gap_over_250_count = 0
_audio_rns_callback_scheduler_gap_over_500_count = 0
_audio_rns_callback_scheduler_gap_over_1000_count = 0
_audio_rns_raw_inbound_gap_ms_max = 0.0
_audio_rns_raw_inbound_gap_over_80_count = 0
_audio_rns_raw_inbound_gap_over_160_count = 0
_audio_rns_raw_inbound_gap_over_320_count = 0
_audio_rns_raw_inbound_gap_over_640_count = 0
_audio_rns_raw_inbound_gap_over_1000_count = 0
_audio_rns_raw_inbound_to_link_receive_ms_max = 0.0
_audio_rns_raw_inbound_to_link_receive_over_80_count = 0
_audio_rns_raw_inbound_to_link_receive_over_160_count = 0
_audio_rns_raw_inbound_to_link_receive_over_320_count = 0
_audio_rns_raw_inbound_to_link_receive_over_640_count = 0
_audio_rns_raw_inbound_to_link_receive_over_1000_count = 0
_audio_rns_raw_inbound_to_link_receive_samples = 0
_audio_rns_raw_inbound_interface_last = ""
_audio_rns_raw_inbound_interface_worst = ""
_audio_rns_shared_frame_gap_ms_max = 0.0
_audio_rns_shared_frame_gap_over_80_count = 0
_audio_rns_shared_frame_gap_over_160_count = 0
_audio_rns_shared_frame_gap_over_320_count = 0
_audio_rns_shared_frame_gap_over_640_count = 0
_audio_rns_shared_frame_gap_over_1000_count = 0
_audio_rns_shared_frame_to_transport_inbound_ms_max = 0.0
_audio_rns_shared_frame_to_transport_inbound_over_80_count = 0
_audio_rns_shared_frame_to_transport_inbound_over_160_count = 0
_audio_rns_shared_frame_to_transport_inbound_over_320_count = 0
_audio_rns_shared_frame_to_transport_inbound_over_640_count = 0
_audio_rns_shared_frame_to_transport_inbound_over_1000_count = 0
_audio_rns_shared_frame_to_transport_inbound_samples = 0
_audio_rns_shared_frame_interface_last = ""
_audio_rns_shared_frame_interface_worst = ""
_audio_media_route_stats: Dict[str, Dict[str, Any]] = {}
_audio_link_receive_probe_by_packet_id: Dict[int, Dict[str, Any]] = {}
_audio_rns_raw_inbound_probe_by_packet_hash: Dict[bytes, Dict[str, Any]] = {}
_audio_rns_raw_inbound_last_wall_ms_by_destination_hash: Dict[str, int] = {}
_audio_rns_shared_frame_probe_by_packet_hash: Dict[bytes, Dict[str, Any]] = {}
_audio_rns_shared_frame_last_wall_ms_by_destination_hash: Dict[str, int] = {}
_rns_link_receive_probe_installed = False
_rns_transport_inbound_probe_installed = False
_rns_shared_frame_probe_installed = False
_rns_shared_rpc_failure_guard_installed = False
_rns_shared_rpc_failure_last_log_by_method: Dict[str, float] = {}
_rns_link_receive_probe_context = threading.local()
_AUDIO_MEDIA_ROUTE_STATS_MAX = 64
_AUDIO_LINK_RECEIVE_PROBE_MAX = 2048
_AUDIO_RNS_RAW_INBOUND_PROBE_MAX = 4096
_AUDIO_RNS_SHARED_FRAME_PROBE_MAX = 4096
_AUDIO_ROUTE_GAP_BUCKETS_MS = (80, 160, 320, 640, 1000)
_AUDIO_RNS_CALLBACK_SCHEDULER_MONITOR_INTERVAL_SECONDS = 0.05
_AUDIO_SLOW_RNS_SEND_LOG_THRESHOLD_MS = 40.0
_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS = 80.0
_AUDIO_TIMING_GAP_LOG_THRESHOLD_MS = 320.0
_AUDIO_TIMING_LOG_THROTTLE_SECONDS = 2.0
_AUDIO_EXECUTOR_STALL_LOG_THRESHOLD_MS = 120.0
_AUDIO_PROCESS_BATCH_LOG_THRESHOLD_MS = 80.0
_AUDIO_EXECUTOR_COMMAND_LOG_THRESHOLD_MS = 80.0
_audio_queue_state_last_emit = 0.0
_audio_queue_state_dirty = False
_audio_timing_anomaly_log_last_by_key: Dict[str, float] = {}
_audio_fd3_parse_last_wall_ms_by_route: Dict[str, int] = {}
# One-shot narrowing logs (grep target=reticulum-audio-ipc stage=…)
_audio_ipc_fd3_first_batch_ok_logged = False
_audio_ipc_rns_first_send_ok_logged = False
_audio_ipc_fd4_first_chunk_logged = False
_audio_data_plane_lock = threading.RLock()
_audio_data_plane_server_thread: Optional[threading.Thread] = None
_audio_data_plane_socket: Optional[socket.socket] = None
_audio_data_plane_endpoint = ""
_audio_data_plane_token = ""
_audio_data_plane_routes_by_address: Dict[str, Dict[str, Any]] = {}
_audio_data_plane_clients: Dict[int, socket.socket] = {}
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
    {_GROUP_AUDIO_HEARTBEAT_WIRE_TYPE}
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


def _log_clock_time() -> str:
    return time.strftime("%H:%M:%S", time.localtime())


def _mark_audio_queue_state_dirty() -> None:
    global _audio_queue_state_dirty
    _audio_queue_state_dirty = True


def _scheduler_stats_for_lane(lane: str) -> Dict[str, Any]:
    stats = _scheduler_stats.get(lane)
    if stats is not None:
        return stats
    stats = {
        "lane": lane,
        "queueMax": int(_SCHEDULER_QUEUE_MAX_BY_LANE.get(lane) or 0),
        "queueDepth": 0,
        "queueDepthHighWater": 0,
        "droppedTasks": 0,
        "completedTasks": 0,
        "enqueuedTasks": 0,
        "dwellMsMax": 0.0,
        "busyMsMax": 0.0,
        "slowTaskCount": 0,
        "lastTask": "",
    }
    _scheduler_stats[lane] = stats
    return stats


def _logical_scheduler_lane(lane: str) -> str:
    if lane.startswith("audio-send-"):
        return "audio-send"
    return lane


def _scheduler_diagnostics() -> list:
    with _state_lock:
        out = []
        for lane in sorted(_scheduler_stats.keys()):
            stats = dict(_scheduler_stats_for_lane(lane))
            q = _scheduler_queues.get(lane)
            stats["queueDepth"] = q.qsize() if q is not None else int(stats.get("queueDepth") or 0)
            stats["logicalLane"] = _logical_scheduler_lane(lane)
            out.append(stats)
        return out


def _note_scheduler_enqueue(lane: str) -> None:
    with _state_lock:
        stats = _scheduler_stats_for_lane(lane)
        q = _scheduler_queues.get(lane)
        depth = q.qsize() if q is not None else 0
        stats["queueDepth"] = depth
        stats["queueDepthHighWater"] = max(int(stats.get("queueDepthHighWater") or 0), depth)
        stats["enqueuedTasks"] = int(stats.get("enqueuedTasks") or 0) + 1
        _mark_audio_queue_state_dirty()


def _note_scheduler_drop(lane: str) -> None:
    with _state_lock:
        stats = _scheduler_stats_for_lane(lane)
        stats["droppedTasks"] = int(stats.get("droppedTasks") or 0) + 1
        _mark_audio_queue_state_dirty()


def _note_scheduler_complete(lane: str, name: str, queued_at: float, started_at: float) -> None:
    duration_ms = max(0.0, (time.monotonic() - started_at) * 1000.0)
    dwell_ms = max(0.0, (started_at - queued_at) * 1000.0)
    with _state_lock:
        stats = _scheduler_stats_for_lane(lane)
        q = _scheduler_queues.get(lane)
        stats["queueDepth"] = q.qsize() if q is not None else int(stats.get("queueDepth") or 0)
        stats["completedTasks"] = int(stats.get("completedTasks") or 0) + 1
        stats["dwellMsMax"] = max(float(stats.get("dwellMsMax") or 0.0), dwell_ms)
        stats["busyMsMax"] = max(float(stats.get("busyMsMax") or 0.0), duration_ms)
        stats["lastTask"] = str(name or "")[:80]
        if duration_ms >= _SCHEDULER_SLOW_TASK_LOG_THRESHOLD_MS:
            stats["slowTaskCount"] = int(stats.get("slowTaskCount") or 0) + 1
        _mark_audio_queue_state_dirty()
    if duration_ms >= _SCHEDULER_SLOW_TASK_LOG_THRESHOLD_MS:
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=scheduler-task-slow "
            f"lane={lane} task={str(name or '')[:80]!r} duration_ms={duration_ms:.3f} "
            f"dwell_ms={dwell_ms:.3f}"
        )


def _enqueue_scheduler_task(
    lane: str,
    name: str,
    fn: Callable[..., Any],
    *args: Any,
    drop_oldest: bool = False,
    **kwargs: Any,
) -> bool:
    q = _scheduler_queues.get(lane)
    if q is None:
        try:
            fn(*args, **kwargs)
            return True
        except Exception as exc:
            emit_event(
                "error",
                {
                    "code": "scheduler_direct_task_failed",
                    "message": str(exc),
                    "detail": traceback.format_exc(limit=3),
                    "lane": lane,
                    "task": name,
                },
            )
            return False
    item = (time.monotonic(), name, fn, args, kwargs)
    try:
        q.put_nowait(item)
        _note_scheduler_enqueue(lane)
        return True
    except queue.Full:
        if not drop_oldest:
            _note_scheduler_drop(lane)
            return False
    try:
        q.get_nowait()
        _note_scheduler_drop(lane)
    except queue.Empty:
        pass
    try:
        q.put_nowait(item)
        _note_scheduler_enqueue(lane)
        return True
    except queue.Full:
        _note_scheduler_drop(lane)
        return False


def _scheduler_worker_loop(lane: str) -> None:
    q = _scheduler_queues[lane]
    while not _shutdown.is_set():
        item = q.get()
        if item is None:
            return
        queued_at, name, fn, args, kwargs = item
        started_at = time.monotonic()
        try:
            fn(*args, **kwargs)
        except Exception as exc:
            emit_event(
                "error",
                {
                    "code": "scheduler_task_failed",
                    "message": str(exc),
                    "detail": traceback.format_exc(limit=3),
                    "lane": lane,
                    "task": name,
                },
            )
        finally:
            _note_scheduler_complete(lane, name, queued_at, started_at)
            _emit_audio_queue_state()


def _start_scheduler_workers() -> None:
    if _scheduler_threads:
        return
    for lane, maxsize in _SCHEDULER_QUEUE_MAX_BY_LANE.items():
        _scheduler_queues[lane] = queue.Queue(maxsize=max(1, int(maxsize)))
        _scheduler_stats_for_lane(lane)
        worker_count = 1
        for worker_index in range(worker_count):
            thread = threading.Thread(
                target=_scheduler_worker_loop,
                args=(lane,),
                name=f"reticulum-{lane}-{worker_index}",
                daemon=True,
            )
            thread.start()
            _scheduler_threads.append(thread)
    log(
        "[presence_bridge] target=reticulum-scheduler started "
        f"lanes={','.join(sorted(_SCHEDULER_QUEUE_MAX_BY_LANE.keys()))}"
    )


def _stop_scheduler_workers() -> None:
    for q in list(_scheduler_queues.values()):
        try:
            q.put_nowait(None)
        except queue.Full:
            try:
                q.get_nowait()
                q.put_nowait(None)
            except Exception:
                pass
    for thread in list(_scheduler_threads):
        thread.join(timeout=5.0)


def _audio_route_stats_key(
    transport: str,
    route_key: str,
    peer_presence_hash: str = "",
    peer_destination_hash: str = "",
) -> str:
    if str(transport or "").strip().lower() == "link":
        return f"{transport}:{route_key}"
    peer_key = str(peer_presence_hash or peer_destination_hash or "").strip().lower()
    return f"{transport}:{route_key}:{peer_key}"


def _get_audio_route_stats(
    transport: str,
    route_key: str,
    peer_presence_hash: str = "",
    peer_destination_hash: str = "",
    incoming: Optional[bool] = None,
) -> Dict[str, Any]:
    key = _audio_route_stats_key(
        transport, route_key, peer_presence_hash, peer_destination_hash
    )
    stats = _audio_media_route_stats.get(key)
    if stats is None:
        if len(_audio_media_route_stats) >= _AUDIO_MEDIA_ROUTE_STATS_MAX:
            oldest_key = min(
                _audio_media_route_stats,
                key=lambda k: float(_audio_media_route_stats[k].get("lastActivityAtMs") or 0),
            )
            _audio_media_route_stats.pop(oldest_key, None)
        stats = {
            "transport": transport,
            "routeKey": route_key,
            "linkId": route_key if transport == "link" else "",
            "peerPresenceHash": str(peer_presence_hash or ""),
            "peerDestinationHash": str(peer_destination_hash or ""),
            "incoming": incoming is True,
            "sentFrames": 0,
            "sentBytes": 0,
            "sendFailures": 0,
            "receivedFrames": 0,
            "receivedBytes": 0,
            "fd4EnqueuedFrames": 0,
            "fd4EnqueueFailures": 0,
            "lastSendAtMs": 0,
            "lastSendFailureAtMs": 0,
            "lastReceiveAtMs": 0,
            "lastFd4EnqueueAtMs": 0,
            "lastActivityAtMs": 0,
            "lastRoomId": "",
            "sendGapMsMax": 0,
            "receiveGapMsMax": 0,
            "sendGapOver80Count": 0,
            "sendGapOver160Count": 0,
            "sendGapOver320Count": 0,
            "sendGapOver640Count": 0,
            "sendGapOver1000Count": 0,
            "receiveGapOver80Count": 0,
            "receiveGapOver160Count": 0,
            "receiveGapOver320Count": 0,
            "receiveGapOver640Count": 0,
            "receiveGapOver1000Count": 0,
            "linkReceiveGapMsMax": 0,
            "linkReceiveGapOver80Count": 0,
            "linkReceiveGapOver160Count": 0,
            "linkReceiveGapOver320Count": 0,
            "linkReceiveGapOver640Count": 0,
            "linkReceiveGapOver1000Count": 0,
            "linkReceiveToCallbackDispatchMsMax": 0,
            "linkCallbackDispatchToStartMsMax": 0,
            "linkReceiveToCallbackStartMsMax": 0,
            "linkCallbackDispatchToStartOver80Count": 0,
            "linkCallbackDispatchToStartOver160Count": 0,
            "linkCallbackDispatchToStartOver320Count": 0,
            "linkCallbackDispatchToStartOver640Count": 0,
            "linkCallbackDispatchToStartOver1000Count": 0,
            "rnsRawInboundGapMsMax": 0,
            "rnsRawInboundGapOver80Count": 0,
            "rnsRawInboundGapOver160Count": 0,
            "rnsRawInboundGapOver320Count": 0,
            "rnsRawInboundGapOver640Count": 0,
            "rnsRawInboundGapOver1000Count": 0,
            "rnsRawInboundToLinkReceiveMsMax": 0,
            "rnsRawInboundToLinkReceiveOver80Count": 0,
            "rnsRawInboundToLinkReceiveOver160Count": 0,
            "rnsRawInboundToLinkReceiveOver320Count": 0,
            "rnsRawInboundToLinkReceiveOver640Count": 0,
            "rnsRawInboundToLinkReceiveOver1000Count": 0,
            "rnsRawInboundInterfaceLast": "",
            "rnsRawInboundInterfaceWorst": "",
            "rnsSharedFrameGapMsMax": 0,
            "rnsSharedFrameGapOver80Count": 0,
            "rnsSharedFrameGapOver160Count": 0,
            "rnsSharedFrameGapOver320Count": 0,
            "rnsSharedFrameGapOver640Count": 0,
            "rnsSharedFrameGapOver1000Count": 0,
            "rnsSharedFrameToTransportInboundMsMax": 0,
            "rnsSharedFrameToTransportInboundOver80Count": 0,
            "rnsSharedFrameToTransportInboundOver160Count": 0,
            "rnsSharedFrameToTransportInboundOver320Count": 0,
            "rnsSharedFrameToTransportInboundOver640Count": 0,
            "rnsSharedFrameToTransportInboundOver1000Count": 0,
            "rnsSharedFrameInterfaceLast": "",
            "rnsSharedFrameInterfaceWorst": "",
            "preRnsSendAgeMsMax": 0,
            "rnsSendDurationMsMax": 0,
            "receiveToFd4EnqueueMsMax": 0,
        }
        _audio_media_route_stats[key] = stats
    if peer_presence_hash:
        stats["peerPresenceHash"] = str(peer_presence_hash)
    if peer_destination_hash:
        stats["peerDestinationHash"] = str(peer_destination_hash)
    if incoming is not None:
        stats["incoming"] = incoming is True
    return stats


def _note_audio_route_gap(
    stats: Dict[str, Any],
    *,
    previous_key: str,
    max_key: str,
    bucket_prefix: str,
    now_ms: int,
) -> None:
    previous_ms = int(stats.get(previous_key) or 0)
    if previous_ms <= 0:
        return
    gap_ms = max(0, now_ms - previous_ms)
    if gap_ms > int(stats.get(max_key) or 0):
        stats[max_key] = gap_ms
    for bucket_ms in _AUDIO_ROUTE_GAP_BUCKETS_MS:
        if gap_ms >= bucket_ms:
            key = f"{bucket_prefix}GapOver{bucket_ms}Count"
            stats[key] = int(stats.get(key) or 0) + 1


def _note_audio_route_bucketed_duration(
    stats: Dict[str, Any],
    *,
    duration_ms: float,
    max_key: str,
    bucket_prefix: Optional[str] = None,
) -> None:
    duration = max(0.0, float(duration_ms or 0.0))
    if duration > float(stats.get(max_key) or 0):
        stats[max_key] = duration
    if not bucket_prefix:
        return
    for bucket_ms in _AUDIO_ROUTE_GAP_BUCKETS_MS:
        if duration >= bucket_ms:
            key = f"{bucket_prefix}Over{bucket_ms}Count"
            stats[key] = int(stats.get(key) or 0) + 1


def _interface_label(interface: Any) -> str:
    if interface is None:
        return ""
    try:
        value = getattr(interface, "name", None)
        if value is None:
            value = str(interface)
        return str(value or "")[:160]
    except Exception:
        return ""


def _short_route(value: Any, limit: int = 16) -> str:
    text = str(value or "").strip()
    return text[:limit] if text else "n/a"


_GC_LINK_CONTROL_MAGIC = b"QGCCTL1\x00"


def _inspect_gcall_audio_payload(payload: Any) -> tuple[str, str]:
    if not isinstance(payload, (bytes, bytearray)):
        return "media", ""
    data = bytes(payload)
    if len(data) <= len(_GC_LINK_CONTROL_MAGIC) or not data.startswith(
        _GC_LINK_CONTROL_MAGIC
    ):
        return "media", ""
    try:
        parsed = json.loads(data[len(_GC_LINK_CONTROL_MAGIC) :].decode("utf-8"))
        control_type = (
            str(parsed.get("type") or "") if isinstance(parsed, dict) else ""
        )
    except Exception:
        control_type = ""
    return "control", control_type


def _log_audio_timing_anomaly(stage: str, route_key: str, detail: str) -> None:
    """Throttled timeline logs for narrowing Reticulum audio gaps."""
    key = f"{stage}:{route_key}"
    now = time.monotonic()
    last = float(_audio_timing_anomaly_log_last_by_key.get(key) or 0.0)
    if now - last < _AUDIO_TIMING_LOG_THROTTLE_SECONDS:
        return
    _audio_timing_anomaly_log_last_by_key[key] = now
    if len(_audio_timing_anomaly_log_last_by_key) > 512:
        for old_key in list(_audio_timing_anomaly_log_last_by_key.keys())[:128]:
            _audio_timing_anomaly_log_last_by_key.pop(old_key, None)
    log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage={stage} {detail}")


def _log_audio_data_plane(stage: str, detail: str = "") -> None:
    suffix = f" {detail}" if detail else ""
    log(f"[presence_bridge] target=gcall-audio-data-plane stage={stage}{suffix}")


def _ws_accept_key(key: str) -> str:
    digest = hashlib.sha1(
        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _ws_send_json(conn: socket.socket, payload: Dict[str, Any]) -> bool:
    try:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        header = bytearray([0x81])
        if len(data) < 126:
            header.append(len(data))
        elif len(data) < 65536:
            header.extend([126, (len(data) >> 8) & 0xFF, len(data) & 0xFF])
        else:
            header.extend([127])
            header.extend(len(data).to_bytes(8, "big"))
        conn.sendall(bytes(header) + data)
        return True
    except Exception as exc:
        _log_audio_data_plane("ws-send-failed", f"err={str(exc)[:160]}")
        return False


def _ws_read_frame(conn: socket.socket) -> Optional[Tuple[int, bytes]]:
    header = conn.recv(2)
    if len(header) < 2:
        return None
    opcode = header[0] & 0x0F
    masked = (header[1] & 0x80) != 0
    length = header[1] & 0x7F
    if length == 126:
        ext = conn.recv(2)
        if len(ext) < 2:
            return None
        length = int.from_bytes(ext, "big")
    elif length == 127:
        ext = conn.recv(8)
        if len(ext) < 8:
            return None
        length = int.from_bytes(ext, "big")
    if length > 262144:
        raise ValueError("websocket frame too large")
    mask = b""
    if masked:
        mask = conn.recv(4)
        if len(mask) < 4:
            return None
    data = b""
    while len(data) < length:
        chunk = conn.recv(length - len(data))
        if not chunk:
            return None
        data += chunk
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, data


def _audio_data_plane_route_for_address(address: str) -> Optional[Dict[str, Any]]:
    key = str(address or "").strip()
    if not key:
        return None
    with _audio_data_plane_lock:
        route = _audio_data_plane_routes_by_address.get(key)
        if isinstance(route, dict):
            return dict(route)
    return None


def _audio_data_plane_enqueue_frame(message: Dict[str, Any]) -> Tuple[bool, str]:
    if _destination is None:
        return False, "bridge_not_started"
    room_id = str(message.get("roomId") or "").strip()
    if not room_id:
        return False, "missing_room"
    target = str(message.get("targetAddress") or "").strip()
    route = _audio_data_plane_route_for_address(target)
    if route is None:
        return False, "route_missing"
    encoded = message.get("data")
    if not isinstance(encoded, str) or not encoded:
        return False, "missing_payload"
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        return False, "bad_payload_base64"
    if len(raw) <= 0 or len(raw) > AUDIO_MAX_PAYLOAD:
        return False, "bad_payload_size"
    now_ms = _now_wall_ms()
    source_ms = message.get("rendererSendAtWallMs")
    if isinstance(source_ms, (int, float)) and source_ms > 0:
        age_ms = max(0, now_ms - int(source_ms))
        if age_ms > _AUDIO_DATA_PLANE_STALE_MS:
            return False, f"stale:{age_ms}"
    transport = "packet" if route.get("transport") == "packet" else "link"
    link_id = str(route.get("linkId") or "")
    peer_presence_hash = str(route.get("peerPresenceHash") or "").strip().lower()
    peer_destination_hash = str(route.get("peerDestinationHash") or "").strip().lower()
    if transport == "link" and not link_id:
        return False, "route_link_missing"
    if transport == "packet" and not peer_presence_hash:
        return False, "route_peer_missing"
    ok = _put_audio_decoded_batch_keep_newest(
        [
            (
                link_id if transport == "link" else "",
                room_id,
                peer_presence_hash,
                peer_destination_hash,
                int(source_ms) if isinstance(source_ms, (int, float)) and source_ms > 0 else now_ms,
                raw,
            )
        ]
    )
    if not ok:
        return False, "decoded_queue_full"
    return True, "queued"


def _handle_audio_data_plane_message(conn: socket.socket, message: Dict[str, Any]) -> None:
    kind = message.get("type")
    if kind == "hello":
        _ws_send_json(conn, {"type": "hello-ok", "atMs": _now_wall_ms()})
        return
    if kind != "audio":
        _ws_send_json(conn, {"type": "error", "reason": "unknown_type"})
        return
    targets = message.get("targets")
    if not isinstance(targets, list) or not targets:
        _ws_send_json(conn, {"type": "audio-result", "ok": False, "reason": "missing_targets"})
        return
    queued = 0
    failures: list = []
    for target in targets[:_AUDIO_DATA_PLANE_MAX_ROUTES]:
        if not isinstance(target, str) or not target.strip():
            continue
        per_target = dict(message)
        per_target["targetAddress"] = target
        ok, reason = _audio_data_plane_enqueue_frame(per_target)
        if ok:
            queued += 1
        else:
            failures.append({"targetAddress": target, "reason": reason})
            if reason.startswith("stale:"):
                _log_audio_data_plane(
                    "stale-outbound-drop",
                    f"room={str(message.get('roomId') or '')[:80]} target={target[:16]} reason={reason}",
                )
    _ws_send_json(
        conn,
        {
            "type": "audio-result",
            "ok": queued > 0,
            "queued": queued,
            "failures": failures[:8],
            "atMs": _now_wall_ms(),
        },
    )


def _audio_data_plane_client_loop(conn: socket.socket, addr: Any) -> None:
    client_id = id(conn)
    try:
        request = b""
        while b"\r\n\r\n" not in request and len(request) < 8192:
            chunk = conn.recv(1024)
            if not chunk:
                return
            request += chunk
        header_text = request.decode("iso-8859-1", errors="replace")
        first_line = header_text.split("\r\n", 1)[0]
        parts = first_line.split(" ")
        path = parts[1] if len(parts) >= 2 else "/"
        query = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
        token = (query.get("token") or [""])[0]
        with _audio_data_plane_lock:
            expected = _audio_data_plane_token
        if not expected or not secrets.compare_digest(str(token), expected):
            conn.sendall(b"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
            _log_audio_data_plane("auth-rejected", f"addr={addr}")
            return
        headers: Dict[str, str] = {}
        for line in header_text.split("\r\n")[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        sec_key = headers.get("sec-websocket-key", "")
        if not sec_key:
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            return
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {_ws_accept_key(sec_key)}\r\n\r\n"
        )
        conn.sendall(response.encode("ascii"))
        with _audio_data_plane_lock:
            _audio_data_plane_clients[client_id] = conn
        _log_audio_data_plane("connection-open", f"addr={addr}")
        conn.settimeout(None)
        _ws_send_json(conn, {"type": "ready", "atMs": _now_wall_ms()})
        while not _shutdown.is_set():
            frame = _ws_read_frame(conn)
            if frame is None:
                break
            opcode, data = frame
            if opcode == 0x8:
                break
            if opcode == 0x9:
                conn.sendall(b"\x8a\x00")
                continue
            if opcode != 0x1:
                continue
            try:
                parsed = json.loads(data.decode("utf-8"))
            except Exception:
                _ws_send_json(conn, {"type": "error", "reason": "bad_json"})
                continue
            if isinstance(parsed, dict):
                if parsed.get("type") == "ping":
                    _ws_send_json(
                        conn,
                        {
                            "type": "pong",
                            "atMs": _now_wall_ms(),
                            "echoAtMs": parsed.get("atMs"),
                        },
                    )
                    continue
                _handle_audio_data_plane_message(conn, parsed)
    except Exception as exc:
        _log_audio_data_plane("connection-error", f"addr={addr} err={str(exc)[:160]}")
    finally:
        with _audio_data_plane_lock:
            _audio_data_plane_clients.pop(client_id, None)
        try:
            conn.close()
        except Exception:
            pass
        _log_audio_data_plane("connection-closed", f"addr={addr}")


def _audio_data_plane_accept_loop(sock: socket.socket) -> None:
    while not _shutdown.is_set():
        try:
            conn, addr = sock.accept()
            conn.settimeout(5.0)
            threading.Thread(
                target=_audio_data_plane_client_loop,
                args=(conn, addr),
                name="gcall-audio-data-plane-client",
                daemon=True,
            ).start()
        except OSError:
            break
        except Exception as exc:
            _log_audio_data_plane("accept-failed", f"err={str(exc)[:160]}")


def _ensure_audio_data_plane_server() -> Tuple[bool, Dict[str, Any], str]:
    global _audio_data_plane_server_thread, _audio_data_plane_socket
    global _audio_data_plane_endpoint, _audio_data_plane_token
    with _audio_data_plane_lock:
        if _audio_data_plane_endpoint and _audio_data_plane_token:
            return True, {
                "endpoint": _audio_data_plane_endpoint,
                "token": _audio_data_plane_token,
                "version": 2,
            }, ""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", 0))
            sock.listen(16)
            host, port = sock.getsockname()
            _audio_data_plane_socket = sock
            _audio_data_plane_token = secrets.token_urlsafe(32)
            _audio_data_plane_endpoint = f"ws://{host}:{port}/gcall-audio"
            _audio_data_plane_server_thread = threading.Thread(
                target=_audio_data_plane_accept_loop,
                args=(sock,),
                name="gcall-audio-data-plane",
                daemon=True,
            )
            _audio_data_plane_server_thread.start()
            _log_audio_data_plane("listen-ok", f"endpoint={_audio_data_plane_endpoint}")
            return True, {
                "endpoint": _audio_data_plane_endpoint,
                "token": _audio_data_plane_token,
                "version": 2,
            }, ""
        except Exception as exc:
            _log_audio_data_plane("listen-failed", f"err={str(exc)[:160]}")
            return False, {}, str(exc)


def _configure_audio_data_plane_routes(routes: Any) -> int:
    next_routes: Dict[str, Dict[str, Any]] = {}
    if isinstance(routes, list):
        for raw in routes[:_AUDIO_DATA_PLANE_MAX_ROUTES]:
            if not isinstance(raw, dict):
                continue
            address = str(raw.get("address") or "").strip()
            if not address:
                continue
            transport = "packet" if raw.get("transport") == "packet" else "link"
            next_routes[address] = {
                "address": address,
                "transport": transport,
                "linkId": str(raw.get("linkId") or ""),
                "peerPresenceHash": str(raw.get("peerPresenceHash") or "").strip().lower(),
                "peerDestinationHash": str(raw.get("peerDestinationHash") or "").strip().lower(),
            }
    with _audio_data_plane_lock:
        _audio_data_plane_routes_by_address.clear()
        _audio_data_plane_routes_by_address.update(next_routes)
    _log_audio_data_plane("routes-configured", f"routes={len(next_routes)}")
    return len(next_routes)


def _increment_raw_gap_buckets(gap_ms: float) -> None:
    global _audio_rns_raw_inbound_gap_over_80_count
    global _audio_rns_raw_inbound_gap_over_160_count
    global _audio_rns_raw_inbound_gap_over_320_count
    global _audio_rns_raw_inbound_gap_over_640_count
    global _audio_rns_raw_inbound_gap_over_1000_count
    if gap_ms >= 80:
        _audio_rns_raw_inbound_gap_over_80_count += 1
    if gap_ms >= 160:
        _audio_rns_raw_inbound_gap_over_160_count += 1
    if gap_ms >= 320:
        _audio_rns_raw_inbound_gap_over_320_count += 1
    if gap_ms >= 640:
        _audio_rns_raw_inbound_gap_over_640_count += 1
    if gap_ms >= 1000:
        _audio_rns_raw_inbound_gap_over_1000_count += 1


def _increment_raw_to_link_buckets(duration_ms: float) -> None:
    global _audio_rns_raw_inbound_to_link_receive_over_80_count
    global _audio_rns_raw_inbound_to_link_receive_over_160_count
    global _audio_rns_raw_inbound_to_link_receive_over_320_count
    global _audio_rns_raw_inbound_to_link_receive_over_640_count
    global _audio_rns_raw_inbound_to_link_receive_over_1000_count
    if duration_ms >= 80:
        _audio_rns_raw_inbound_to_link_receive_over_80_count += 1
    if duration_ms >= 160:
        _audio_rns_raw_inbound_to_link_receive_over_160_count += 1
    if duration_ms >= 320:
        _audio_rns_raw_inbound_to_link_receive_over_320_count += 1
    if duration_ms >= 640:
        _audio_rns_raw_inbound_to_link_receive_over_640_count += 1
    if duration_ms >= 1000:
        _audio_rns_raw_inbound_to_link_receive_over_1000_count += 1


def _increment_shared_frame_gap_buckets(gap_ms: float) -> None:
    global _audio_rns_shared_frame_gap_over_80_count
    global _audio_rns_shared_frame_gap_over_160_count
    global _audio_rns_shared_frame_gap_over_320_count
    global _audio_rns_shared_frame_gap_over_640_count
    global _audio_rns_shared_frame_gap_over_1000_count
    if gap_ms >= 80:
        _audio_rns_shared_frame_gap_over_80_count += 1
    if gap_ms >= 160:
        _audio_rns_shared_frame_gap_over_160_count += 1
    if gap_ms >= 320:
        _audio_rns_shared_frame_gap_over_320_count += 1
    if gap_ms >= 640:
        _audio_rns_shared_frame_gap_over_640_count += 1
    if gap_ms >= 1000:
        _audio_rns_shared_frame_gap_over_1000_count += 1


def _increment_shared_to_transport_buckets(duration_ms: float) -> None:
    global _audio_rns_shared_frame_to_transport_inbound_over_80_count
    global _audio_rns_shared_frame_to_transport_inbound_over_160_count
    global _audio_rns_shared_frame_to_transport_inbound_over_320_count
    global _audio_rns_shared_frame_to_transport_inbound_over_640_count
    global _audio_rns_shared_frame_to_transport_inbound_over_1000_count
    if duration_ms >= 80:
        _audio_rns_shared_frame_to_transport_inbound_over_80_count += 1
    if duration_ms >= 160:
        _audio_rns_shared_frame_to_transport_inbound_over_160_count += 1
    if duration_ms >= 320:
        _audio_rns_shared_frame_to_transport_inbound_over_320_count += 1
    if duration_ms >= 640:
        _audio_rns_shared_frame_to_transport_inbound_over_640_count += 1
    if duration_ms >= 1000:
        _audio_rns_shared_frame_to_transport_inbound_over_1000_count += 1


def _prune_rns_shared_frame_probe_cache() -> None:
    if len(_audio_rns_shared_frame_probe_by_packet_hash) <= _AUDIO_RNS_SHARED_FRAME_PROBE_MAX:
        return
    overflow = len(_audio_rns_shared_frame_probe_by_packet_hash) - _AUDIO_RNS_SHARED_FRAME_PROBE_MAX
    for packet_hash in list(_audio_rns_shared_frame_probe_by_packet_hash.keys())[: max(1, overflow)]:
        _audio_rns_shared_frame_probe_by_packet_hash.pop(packet_hash, None)


def _prune_rns_raw_inbound_probe_cache() -> None:
    if len(_audio_rns_raw_inbound_probe_by_packet_hash) <= _AUDIO_RNS_RAW_INBOUND_PROBE_MAX:
        return
    overflow = len(_audio_rns_raw_inbound_probe_by_packet_hash) - _AUDIO_RNS_RAW_INBOUND_PROBE_MAX
    for packet_hash in list(_audio_rns_raw_inbound_probe_by_packet_hash.keys())[: max(1, overflow)]:
        _audio_rns_raw_inbound_probe_by_packet_hash.pop(packet_hash, None)


def _record_rns_shared_frame_probe(raw: Any, interface: Any) -> None:
    global _audio_rns_shared_frame_gap_ms_max, _audio_rns_shared_frame_interface_last
    global _audio_rns_shared_frame_interface_worst
    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 4:
        return
    try:
        packet = RNS.Packet(None, bytes(raw), create_receipt=False)
        if not packet.unpack():
            return
        if (
            getattr(packet, "packet_type", None) != getattr(RNS.Packet, "DATA", object())
            or getattr(packet, "destination_type", None) != getattr(RNS.Destination, "LINK", object())
        ):
            return
        packet_hash = getattr(packet, "packet_hash", None)
        destination_hash = getattr(packet, "destination_hash", None)
        if not isinstance(packet_hash, (bytes, bytearray)):
            return
        destination_hex = bytes(destination_hash or b"").hex()
        if not destination_hex:
            return
        now_mono = time.monotonic()
        now_wall_ms = _now_wall_ms()
        interface_name = _interface_label(interface)
        with _state_lock:
            previous_ms = int(_audio_rns_shared_frame_last_wall_ms_by_destination_hash.get(destination_hex) or 0)
            frame_gap_ms = 0
            if previous_ms > 0:
                frame_gap_ms = max(0, now_wall_ms - previous_ms)
                if frame_gap_ms > _audio_rns_shared_frame_gap_ms_max:
                    _audio_rns_shared_frame_gap_ms_max = float(frame_gap_ms)
                    _audio_rns_shared_frame_interface_worst = interface_name
                _increment_shared_frame_gap_buckets(float(frame_gap_ms))
                if frame_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-shared-frame-gap",
                        destination_hex,
                        f"destination={_short_route(destination_hex)} gap_ms={frame_gap_ms} "
                        f"interface={interface_name or 'n/a'} packet={_short_route(bytes(packet_hash).hex())}",
                    )
            _audio_rns_shared_frame_last_wall_ms_by_destination_hash[destination_hex] = now_wall_ms
            _audio_rns_shared_frame_interface_last = interface_name
            _audio_rns_shared_frame_probe_by_packet_hash[bytes(packet_hash)] = {
                "monotonic": now_mono,
                "wallMs": now_wall_ms,
                "destinationHash": destination_hex,
                "interface": interface_name,
                "frameGapMs": frame_gap_ms,
            }
            _prune_rns_shared_frame_probe_cache()
            _mark_audio_queue_state_dirty()
    except Exception:
        return


def _record_rns_raw_inbound_probe(raw: Any, interface: Any) -> None:
    global _audio_rns_raw_inbound_gap_ms_max, _audio_rns_raw_inbound_interface_last
    global _audio_rns_raw_inbound_interface_worst
    global _audio_rns_shared_frame_to_transport_inbound_ms_max
    global _audio_rns_shared_frame_to_transport_inbound_samples
    global _audio_rns_shared_frame_interface_last, _audio_rns_shared_frame_interface_worst
    if not isinstance(raw, (bytes, bytearray)) or len(raw) < 4:
        return
    try:
        packet = RNS.Packet(None, bytes(raw), create_receipt=False)
        if not packet.unpack():
            return
        if (
            getattr(packet, "packet_type", None) != getattr(RNS.Packet, "DATA", object())
            or getattr(packet, "destination_type", None) != getattr(RNS.Destination, "LINK", object())
        ):
            return
        packet_hash = getattr(packet, "packet_hash", None)
        destination_hash = getattr(packet, "destination_hash", None)
        if not isinstance(packet_hash, (bytes, bytearray)):
            return
        destination_hex = bytes(destination_hash or b"").hex()
        if not destination_hex:
            return
        now_mono = time.monotonic()
        now_wall_ms = _now_wall_ms()
        interface_name = _interface_label(interface)
        shared_probe = None
        with _state_lock:
            shared_probe = _audio_rns_shared_frame_probe_by_packet_hash.pop(bytes(packet_hash), None)
            shared_to_transport_ms = 0.0
            shared_frame_gap_ms = 0.0
            shared_interface_name = ""
            if shared_probe is not None:
                shared_mono = float(shared_probe.get("monotonic") or 0.0)
                shared_to_transport_ms = (
                    max(0.0, (now_mono - shared_mono) * 1000.0)
                    if shared_mono > 0
                    else 0.0
                )
                shared_frame_gap_ms = max(0.0, float(shared_probe.get("frameGapMs") or 0.0))
                shared_interface_name = str(shared_probe.get("interface") or interface_name)
                _audio_rns_shared_frame_to_transport_inbound_samples += 1
                _audio_rns_shared_frame_interface_last = shared_interface_name
                if shared_to_transport_ms > _audio_rns_shared_frame_to_transport_inbound_ms_max:
                    _audio_rns_shared_frame_to_transport_inbound_ms_max = shared_to_transport_ms
                    _audio_rns_shared_frame_interface_worst = shared_interface_name
                _increment_shared_to_transport_buckets(shared_to_transport_ms)
                if shared_to_transport_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-shared-to-transport-delay",
                        destination_hex,
                        f"destination={_short_route(destination_hex)} "
                        f"delay_ms={shared_to_transport_ms:.3f} "
                        f"shared_gap_ms={shared_frame_gap_ms:.3f} "
                        f"interface={shared_interface_name or interface_name or 'n/a'} "
                        f"packet={_short_route(bytes(packet_hash).hex())}",
                    )
            previous_ms = int(_audio_rns_raw_inbound_last_wall_ms_by_destination_hash.get(destination_hex) or 0)
            raw_gap_ms = 0
            if previous_ms > 0:
                raw_gap_ms = max(0, now_wall_ms - previous_ms)
                if raw_gap_ms > _audio_rns_raw_inbound_gap_ms_max:
                    _audio_rns_raw_inbound_gap_ms_max = float(raw_gap_ms)
                    _audio_rns_raw_inbound_interface_worst = interface_name
                _increment_raw_gap_buckets(float(raw_gap_ms))
                if raw_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-raw-inbound-gap",
                        destination_hex,
                        f"destination={_short_route(destination_hex)} gap_ms={raw_gap_ms} "
                        f"interface={interface_name or 'n/a'} packet={_short_route(bytes(packet_hash).hex())}",
                    )
            _audio_rns_raw_inbound_last_wall_ms_by_destination_hash[destination_hex] = now_wall_ms
            _audio_rns_raw_inbound_interface_last = interface_name
            _audio_rns_raw_inbound_probe_by_packet_hash[bytes(packet_hash)] = {
                "monotonic": now_mono,
                "wallMs": now_wall_ms,
                "destinationHash": destination_hex,
                "interface": interface_name,
                "rawGapMs": raw_gap_ms,
                "sharedFrameGapMs": shared_frame_gap_ms,
                "sharedFrameToTransportInboundMs": shared_to_transport_ms,
                "sharedFrameInterface": shared_interface_name,
            }
            _prune_rns_raw_inbound_probe_cache()
            _mark_audio_queue_state_dirty()
    except Exception:
        return


def _get_audio_route_stats_for_link_id(
    link_id: str,
    *,
    incoming: Optional[bool] = None,
) -> Optional[Dict[str, Any]]:
    if not link_id:
        return None
    state = get_audio_link_state(link_id)
    if state is None:
        return None
    return _get_audio_route_stats(
        "link",
        link_id,
        str(state.get("peerPresenceHash") or ""),
        str(state.get("peerDestinationHash") or ""),
        state.get("incoming") is True if incoming is None else incoming,
    )


def _prune_audio_link_receive_probe_cache() -> None:
    if len(_audio_link_receive_probe_by_packet_id) <= _AUDIO_LINK_RECEIVE_PROBE_MAX:
        return
    overflow = len(_audio_link_receive_probe_by_packet_id) - _AUDIO_LINK_RECEIVE_PROBE_MAX
    for packet_id in list(_audio_link_receive_probe_by_packet_id.keys())[: max(1, overflow)]:
        _audio_link_receive_probe_by_packet_id.pop(packet_id, None)


def _qortal_link_receive_probe(
    stage: str,
    link: Any,
    packet: Any,
    monotonic_at: float,
    wall_at: float,
) -> None:
    """Runtime RNS.Link.receive probe to split delivery vs callback dispatch."""
    global _audio_rns_raw_inbound_to_link_receive_ms_max
    global _audio_rns_raw_inbound_to_link_receive_samples
    global _audio_rns_raw_inbound_interface_last, _audio_rns_raw_inbound_interface_worst
    if link is None or packet is None:
        return
    link_id = get_audio_link_id(link)
    if not link_id:
        return
    packet_id = id(packet)
    now_wall_ms = int(max(0.0, float(wall_at or time.time())) * 1000.0)
    now_mono = float(monotonic_at or time.monotonic())
    stats = _get_audio_route_stats_for_link_id(link_id)
    if stats is None:
        return
    if stage == "receive_enter":
        raw_probe = None
        packet_hash = getattr(packet, "packet_hash", None)
        if isinstance(packet_hash, (bytes, bytearray)):
            with _state_lock:
                raw_probe = _audio_rns_raw_inbound_probe_by_packet_hash.pop(bytes(packet_hash), None)
        if raw_probe is not None:
            raw_mono = float(raw_probe.get("monotonic") or 0.0)
            raw_to_link_ms = max(0.0, (now_mono - raw_mono) * 1000.0) if raw_mono > 0 else 0.0
            interface_name = str(raw_probe.get("interface") or "")
            raw_gap_ms = max(0.0, float(raw_probe.get("rawGapMs") or 0.0))
            shared_frame_gap_ms = max(0.0, float(raw_probe.get("sharedFrameGapMs") or 0.0))
            shared_to_transport_ms = max(
                0.0, float(raw_probe.get("sharedFrameToTransportInboundMs") or 0.0)
            )
            shared_interface_name = str(raw_probe.get("sharedFrameInterface") or interface_name)
            if raw_to_link_ms > float(stats.get("rnsRawInboundToLinkReceiveMsMax") or 0):
                stats["rnsRawInboundToLinkReceiveMsMax"] = raw_to_link_ms
                stats["rnsRawInboundInterfaceWorst"] = interface_name
            stats["rnsRawInboundInterfaceLast"] = interface_name
            if raw_to_link_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                _log_audio_timing_anomaly(
                    "rns-raw-to-link-delay",
                    link_id,
                    f"link={_short_route(link_id)} delay_ms={raw_to_link_ms:.3f} "
                    f"raw_gap_ms={raw_gap_ms:.3f} shared_gap_ms={shared_frame_gap_ms:.3f} "
                    f"shared_to_transport_ms={shared_to_transport_ms:.3f} "
                    f"interface={interface_name or 'n/a'}",
                )
            _note_audio_route_bucketed_duration(
                stats,
                duration_ms=raw_to_link_ms,
                max_key="rnsRawInboundToLinkReceiveMsMax",
                bucket_prefix="rnsRawInboundToLinkReceive",
            )
            if raw_gap_ms > float(stats.get("rnsRawInboundGapMsMax") or 0):
                stats["rnsRawInboundGapMsMax"] = raw_gap_ms
            for bucket_ms in _AUDIO_ROUTE_GAP_BUCKETS_MS:
                if raw_gap_ms >= bucket_ms:
                    key = f"rnsRawInboundGapOver{bucket_ms}Count"
                    stats[key] = int(stats.get(key) or 0) + 1
            if shared_frame_gap_ms > float(stats.get("rnsSharedFrameGapMsMax") or 0):
                stats["rnsSharedFrameGapMsMax"] = shared_frame_gap_ms
            for bucket_ms in _AUDIO_ROUTE_GAP_BUCKETS_MS:
                if shared_frame_gap_ms >= bucket_ms:
                    key = f"rnsSharedFrameGapOver{bucket_ms}Count"
                    stats[key] = int(stats.get(key) or 0) + 1
            if shared_to_transport_ms > float(
                stats.get("rnsSharedFrameToTransportInboundMsMax") or 0
            ):
                stats["rnsSharedFrameInterfaceWorst"] = shared_interface_name
            stats["rnsSharedFrameInterfaceLast"] = shared_interface_name
            _note_audio_route_bucketed_duration(
                stats,
                duration_ms=shared_to_transport_ms,
                max_key="rnsSharedFrameToTransportInboundMsMax",
                bucket_prefix="rnsSharedFrameToTransportInbound",
            )
            with _state_lock:
                _audio_rns_raw_inbound_to_link_receive_samples += 1
                _audio_rns_raw_inbound_interface_last = interface_name
                if raw_to_link_ms > _audio_rns_raw_inbound_to_link_receive_ms_max:
                    _audio_rns_raw_inbound_to_link_receive_ms_max = raw_to_link_ms
                    _audio_rns_raw_inbound_interface_worst = interface_name
                _increment_raw_to_link_buckets(raw_to_link_ms)
        previous_link_receive_ms = int(stats.get("lastLinkReceiveEnterAtMs") or 0)
        if previous_link_receive_ms > 0:
            link_receive_gap_ms = max(0, now_wall_ms - previous_link_receive_ms)
            if link_receive_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                _log_audio_timing_anomaly(
                    "rns-link-receive-gap",
                    link_id,
                    f"link={_short_route(link_id)} gap_ms={link_receive_gap_ms} "
                    f"peer={_short_route(stats.get('peerPresenceHash'))} "
                    f"dest={_short_route(stats.get('peerDestinationHash'))}",
                )
        _note_audio_route_gap(
            stats,
            previous_key="lastLinkReceiveEnterAtMs",
            max_key="linkReceiveGapMsMax",
            bucket_prefix="linkReceive",
            now_ms=now_wall_ms,
        )
        stats["lastLinkReceiveEnterAtMs"] = now_wall_ms
        stats["lastActivityAtMs"] = max(int(stats.get("lastActivityAtMs") or 0), now_wall_ms)
        _audio_link_receive_probe_by_packet_id[packet_id] = {
            "linkId": link_id,
            "receiveEnterMonotonic": now_mono,
            "receiveEnterAtMs": now_wall_ms,
            "callbackDispatchMonotonic": 0.0,
            "callbackDispatchAtMs": 0,
        }
        _prune_audio_link_receive_probe_cache()
        _mark_audio_queue_state_dirty()
        return
    if stage == "callback_dispatch":
        probe = _audio_link_receive_probe_by_packet_id.get(packet_id)
        if probe is None:
            probe = {
                "linkId": link_id,
                "receiveEnterMonotonic": 0.0,
                "receiveEnterAtMs": 0,
            }
            _audio_link_receive_probe_by_packet_id[packet_id] = probe
            _prune_audio_link_receive_probe_cache()
        enter_mono = float(probe.get("receiveEnterMonotonic") or 0.0)
        if enter_mono > 0:
            dispatch_delay_ms = (now_mono - enter_mono) * 1000.0
            if dispatch_delay_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                _log_audio_timing_anomaly(
                    "rns-link-callback-dispatch-delay",
                    link_id,
                    f"link={_short_route(link_id)} delay_ms={dispatch_delay_ms:.3f} "
                    f"peer={_short_route(stats.get('peerPresenceHash'))} "
                    f"dest={_short_route(stats.get('peerDestinationHash'))}",
                )
            _note_audio_route_bucketed_duration(
                stats,
                duration_ms=dispatch_delay_ms,
                max_key="linkReceiveToCallbackDispatchMsMax",
            )
        probe["callbackDispatchMonotonic"] = now_mono
        probe["callbackDispatchAtMs"] = now_wall_ms
        _mark_audio_queue_state_dirty()
        return
    if stage == "callback_start":
        probe = _audio_link_receive_probe_by_packet_id.pop(packet_id, None)
        if probe is None:
            return
        dispatch_mono = float(probe.get("callbackDispatchMonotonic") or 0.0)
        enter_mono = float(probe.get("receiveEnterMonotonic") or 0.0)
        if dispatch_mono > 0:
            _note_audio_route_bucketed_duration(
                stats,
                duration_ms=(now_mono - dispatch_mono) * 1000.0,
                max_key="linkCallbackDispatchToStartMsMax",
                bucket_prefix="linkCallbackDispatchToStart",
            )
        if enter_mono > 0:
            _note_audio_route_bucketed_duration(
                stats,
                duration_ms=(now_mono - enter_mono) * 1000.0,
                max_key="linkReceiveToCallbackStartMsMax",
            )
        _mark_audio_queue_state_dirty()


setattr(RNS, "_qortal_link_receive_probe", _qortal_link_receive_probe)


def install_rns_link_receive_probe() -> None:
    """Track RNS.Link.receive timing without replacing global threading primitives."""
    global _rns_link_receive_probe_installed
    if _rns_link_receive_probe_installed:
        return
    original_receive = getattr(RNS.Link, "receive", None)
    if not callable(original_receive):
        return

    def probed_receive(self, packet):
        try:
            if (
                getattr(packet, "packet_type", None) == getattr(RNS.Packet, "DATA", object())
                and getattr(packet, "context", None) == getattr(RNS.Packet, "NONE", object())
            ):
                _qortal_link_receive_probe(
                    "receive_enter",
                    self,
                    packet,
                    time.monotonic(),
                    time.time(),
                )
        except Exception:
            pass
        return original_receive(self, packet)

    setattr(RNS.Link, "receive", probed_receive)
    _rns_link_receive_probe_installed = True


def install_rns_shared_frame_probe() -> None:
    """Track shared-instance frame arrival before it enters RNS.Transport."""
    global _rns_shared_frame_probe_installed
    if _rns_shared_frame_probe_installed:
        return
    try:
        from RNS.Interfaces.LocalInterface import LocalClientInterface
    except Exception:
        return
    original_process_incoming = getattr(LocalClientInterface, "process_incoming", None)
    if not callable(original_process_incoming):
        return

    def probed_process_incoming(self, data):
        try:
            if getattr(self, "is_connected_to_shared_instance", False):
                _record_rns_shared_frame_probe(data, self)
        except Exception:
            pass
        return original_process_incoming(self, data)

    setattr(LocalClientInterface, "process_incoming", probed_process_incoming)
    _rns_shared_frame_probe_installed = True


def install_rns_transport_inbound_probe() -> None:
    """Track when raw link packets enter RNS.Transport before Link.receive routing."""
    global _rns_transport_inbound_probe_installed
    if _rns_transport_inbound_probe_installed:
        return
    original_inbound = getattr(RNS.Transport, "inbound", None)
    if not callable(original_inbound):
        return

    def probed_inbound(raw, interface=None):
        try:
            _record_rns_raw_inbound_probe(raw, interface)
        except Exception:
            pass
        return original_inbound(raw, interface)

    setattr(RNS.Transport, "inbound", staticmethod(probed_inbound))
    _rns_transport_inbound_probe_installed = True


def install_rns_shared_rpc_failure_guard() -> None:
    """Keep shared-instance bookkeeping RPC failures from aborting inbound frames."""
    global _rns_shared_rpc_failure_guard_installed
    if _rns_shared_rpc_failure_guard_installed:
        return

    reticulum_cls = getattr(RNS, "Reticulum", None)
    if reticulum_cls is None:
        return

    rpc_failure_types = (ConnectionResetError, BrokenPipeError, EOFError, OSError)
    method_names = (
        "_used_destination_data",
        "_retain_destination_data",
        "_unretain_destination_data",
        "_retain_identity",
    )

    def make_guard(method_name: str, original):
        def guarded(self, *args, **kwargs):
            if not getattr(self, "is_connected_to_shared_instance", False):
                return original(self, *args, **kwargs)
            try:
                return original(self, *args, **kwargs)
            except rpc_failure_types as exc:
                now = time.monotonic()
                last = _rns_shared_rpc_failure_last_log_by_method.get(method_name, 0.0)
                if now - last >= 30.0:
                    _rns_shared_rpc_failure_last_log_by_method[method_name] = now
                    log(
                        "[presence_bridge] target=reticulum-shared-rpc "
                        f"method={method_name} action=ignored_nonfatal err={type(exc).__name__}: {exc}"
                    )
                return False

        return guarded

    installed_any = False
    for method_name in method_names:
        original = getattr(reticulum_cls, method_name, None)
        if callable(original):
            setattr(reticulum_cls, method_name, make_guard(method_name, original))
            installed_any = True

    _rns_shared_rpc_failure_guard_installed = installed_any


def _now_wall_ms() -> int:
    return int(time.time() * 1000)


def _note_audio_route_send(
    transport: str,
    route_key: str,
    room_id: str,
    peer_presence_hash: str = "",
    peer_destination_hash: str = "",
    byte_count: int = 0,
    ok: bool = True,
    incoming: Optional[bool] = None,
    source_received_at_wall_ms: Optional[int] = None,
    send_duration_ms: Optional[float] = None,
) -> None:
    with _state_lock:
        stats = _get_audio_route_stats(
            transport, route_key, peer_presence_hash, peer_destination_hash, incoming
        )
        now_ms = _now_wall_ms()
        stats["lastRoomId"] = str(room_id or "")
        stats["lastActivityAtMs"] = now_ms
        if ok:
            previous_send_ms = int(stats.get("lastSendAtMs") or 0)
            if previous_send_ms > 0:
                send_gap_ms = max(0, now_ms - previous_send_ms)
                if send_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-audio-send-gap",
                        f"{transport}:{route_key}",
                        f"transport={transport} route={_short_route(route_key)} "
                        f"room={room_id or 'n/a'} gap_ms={send_gap_ms} "
                        f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                    )
            _note_audio_route_gap(
                stats,
                previous_key="lastSendAtMs",
                max_key="sendGapMsMax",
                bucket_prefix="send",
                now_ms=now_ms,
            )
            stats["sentFrames"] = int(stats.get("sentFrames") or 0) + 1
            stats["sentBytes"] = int(stats.get("sentBytes") or 0) + max(0, int(byte_count or 0))
            stats["lastSendAtMs"] = now_ms
            if isinstance(source_received_at_wall_ms, int) and source_received_at_wall_ms > 0:
                age_ms = max(0, now_ms - source_received_at_wall_ms)
                if age_ms > int(stats.get("preRnsSendAgeMsMax") or 0):
                    stats["preRnsSendAgeMsMax"] = age_ms
                if age_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-audio-pre-send-age",
                        f"{transport}:{route_key}",
                        f"transport={transport} route={_short_route(route_key)} "
                        f"room={room_id or 'n/a'} age_ms={age_ms} "
                        f"bytes={max(0, int(byte_count or 0))} "
                        f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                    )
            if isinstance(send_duration_ms, (int, float)):
                duration_ms = max(0.0, float(send_duration_ms))
                if duration_ms > float(stats.get("rnsSendDurationMsMax") or 0):
                    stats["rnsSendDurationMsMax"] = duration_ms
                if duration_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-audio-send-duration",
                        f"{transport}:{route_key}",
                        f"transport={transport} route={_short_route(route_key)} "
                        f"room={room_id or 'n/a'} duration_ms={duration_ms:.3f} "
                        f"bytes={max(0, int(byte_count or 0))} "
                        f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                    )
        else:
            stats["sendFailures"] = int(stats.get("sendFailures") or 0) + 1
            stats["lastSendFailureAtMs"] = now_ms
        _mark_audio_queue_state_dirty()


def _note_audio_route_receive(
    transport: str,
    route_key: str,
    room_id: str,
    peer_presence_hash: str = "",
    peer_destination_hash: str = "",
    byte_count: int = 0,
    fd4_enqueued: Optional[bool] = None,
    incoming: Optional[bool] = None,
    received_at_wall_ms: Optional[int] = None,
    fd4_enqueued_at_wall_ms: Optional[int] = None,
) -> None:
    with _state_lock:
        stats = _get_audio_route_stats(
            transport, route_key, peer_presence_hash, peer_destination_hash, incoming
        )
        now_ms = (
            received_at_wall_ms
            if isinstance(received_at_wall_ms, int) and received_at_wall_ms > 0
            else _now_wall_ms()
        )
        previous_receive_ms = int(stats.get("lastReceiveAtMs") or 0)
        if previous_receive_ms > 0:
            receive_gap_ms = max(0, now_ms - previous_receive_ms)
            if receive_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                _log_audio_timing_anomaly(
                    "rns-audio-callback-gap",
                    f"{transport}:{route_key}",
                    f"transport={transport} route={_short_route(route_key)} "
                    f"room={room_id or 'n/a'} gap_ms={receive_gap_ms} "
                    f"bytes={max(0, int(byte_count or 0))} "
                    f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                )
        _note_audio_route_gap(
            stats,
            previous_key="lastReceiveAtMs",
            max_key="receiveGapMsMax",
            bucket_prefix="receive",
            now_ms=now_ms,
        )
        stats["receivedFrames"] = int(stats.get("receivedFrames") or 0) + 1
        stats["receivedBytes"] = int(stats.get("receivedBytes") or 0) + max(0, int(byte_count or 0))
        stats["lastReceiveAtMs"] = now_ms
        stats["lastActivityAtMs"] = now_ms
        stats["lastRoomId"] = str(room_id or "")
        if fd4_enqueued is True:
            stats["fd4EnqueuedFrames"] = int(stats.get("fd4EnqueuedFrames") or 0) + 1
            fd4_ms = (
                fd4_enqueued_at_wall_ms
                if isinstance(fd4_enqueued_at_wall_ms, int) and fd4_enqueued_at_wall_ms > 0
                else _now_wall_ms()
            )
            stats["lastFd4EnqueueAtMs"] = fd4_ms
            enqueue_delay_ms = max(0, fd4_ms - now_ms)
            if enqueue_delay_ms > int(stats.get("receiveToFd4EnqueueMsMax") or 0):
                stats["receiveToFd4EnqueueMsMax"] = enqueue_delay_ms
            if enqueue_delay_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                _log_audio_timing_anomaly(
                    "rns-audio-fd4-enqueue-delay",
                    f"{transport}:{route_key}",
                    f"transport={transport} route={_short_route(route_key)} "
                    f"room={room_id or 'n/a'} delay_ms={enqueue_delay_ms} "
                    f"bytes={max(0, int(byte_count or 0))} "
                    f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                )
        elif fd4_enqueued is False:
            stats["fd4EnqueueFailures"] = int(stats.get("fd4EnqueueFailures") or 0) + 1
        _mark_audio_queue_state_dirty()


def _audio_media_route_diagnostics() -> list:
    with _state_lock:
        routes = sorted(
            _audio_media_route_stats.values(),
            key=lambda item: int(item.get("lastActivityAtMs") or 0),
            reverse=True,
        )
        return [dict(route) for route in routes[:16]]


def _clear_audio_media_route_diagnostics(room_id: str = "") -> int:
    normalized_room_id = str(room_id or "").strip()
    with _state_lock:
        if not normalized_room_id:
            cleared = len(_audio_media_route_stats)
            _audio_media_route_stats.clear()
            return cleared
        keys = [
            key
            for key, stats in _audio_media_route_stats.items()
            if str(stats.get("lastRoomId") or "") == normalized_room_id
        ]
        for key in keys:
            _audio_media_route_stats.pop(key, None)
        return len(keys)


def _notify_rns_work_available() -> None:
    if _rns_wake_write_fd is None:
        return
    try:
        os.write(_rns_wake_write_fd, b"\x01")
    except BlockingIOError:
        pass
    except OSError:
        pass


def _drain_rns_wake_pipe() -> None:
    if _rns_wake_read_fd is None:
        return
    while True:
        try:
            chunk = os.read(_rns_wake_read_fd, 1024)
        except BlockingIOError:
            return
        except OSError:
            return
        if not chunk:
            return


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
            "deadlineDropCount": _audio_deadline_drops,
            "decodedQueueEvictOldestCount": _audio_decoded_queue_evict_oldest,
            "decodedQueueDropNewestCount": _audio_decoded_queue_drop_newest,
            "fd3DecodedAgeMsMax": _audio_fd3_decoded_age_ms_max,
            "decodedQueueDwellMsMax": _audio_decoded_queue_dwell_ms_max,
            "rnsSendDurationMsMax": _audio_rns_send_duration_ms_max,
            "packetPathCheckMsMax": _audio_packet_path_check_ms_max,
            "executorLoopGapMsMax": _audio_executor_loop_gap_ms_max,
            "executorGapWhileQueuedMsMax": _audio_executor_gap_while_queued_ms_max,
            "executorAudioPassMsMax": _audio_executor_audio_pass_ms_max,
            "processBatchMsMax": _audio_process_batch_ms_max,
            "processBatchFramesMax": _audio_process_batch_frames_max,
            "rnsSendSlowCount": _audio_rns_send_slow_count,
            "executorStallCount": _audio_executor_stall_count,
            "executorCommandMsMax": _audio_executor_command_ms_max,
            "executorCommandWhileQueuedMsMax": _audio_executor_command_while_queued_ms_max,
            "executorCommandSlowCount": _audio_executor_command_slow_count,
            "rnsCallbackSchedulerGapMsMax": _audio_rns_callback_scheduler_gap_ms_max,
            "rnsCallbackSchedulerGapOver100Count": _audio_rns_callback_scheduler_gap_over_100_count,
            "rnsCallbackSchedulerGapOver250Count": _audio_rns_callback_scheduler_gap_over_250_count,
            "rnsCallbackSchedulerGapOver500Count": _audio_rns_callback_scheduler_gap_over_500_count,
            "rnsCallbackSchedulerGapOver1000Count": _audio_rns_callback_scheduler_gap_over_1000_count,
            "rnsRawInboundGapMsMax": _audio_rns_raw_inbound_gap_ms_max,
            "rnsRawInboundGapOver80Count": _audio_rns_raw_inbound_gap_over_80_count,
            "rnsRawInboundGapOver160Count": _audio_rns_raw_inbound_gap_over_160_count,
            "rnsRawInboundGapOver320Count": _audio_rns_raw_inbound_gap_over_320_count,
            "rnsRawInboundGapOver640Count": _audio_rns_raw_inbound_gap_over_640_count,
            "rnsRawInboundGapOver1000Count": _audio_rns_raw_inbound_gap_over_1000_count,
            "rnsRawInboundToLinkReceiveMsMax": _audio_rns_raw_inbound_to_link_receive_ms_max,
            "rnsRawInboundToLinkReceiveOver80Count": _audio_rns_raw_inbound_to_link_receive_over_80_count,
            "rnsRawInboundToLinkReceiveOver160Count": _audio_rns_raw_inbound_to_link_receive_over_160_count,
            "rnsRawInboundToLinkReceiveOver320Count": _audio_rns_raw_inbound_to_link_receive_over_320_count,
            "rnsRawInboundToLinkReceiveOver640Count": _audio_rns_raw_inbound_to_link_receive_over_640_count,
            "rnsRawInboundToLinkReceiveOver1000Count": _audio_rns_raw_inbound_to_link_receive_over_1000_count,
            "rnsRawInboundToLinkReceiveSamples": _audio_rns_raw_inbound_to_link_receive_samples,
            "rnsRawInboundInterfaceLast": _audio_rns_raw_inbound_interface_last,
            "rnsRawInboundInterfaceWorst": _audio_rns_raw_inbound_interface_worst,
            "rnsSharedFrameGapMsMax": _audio_rns_shared_frame_gap_ms_max,
            "rnsSharedFrameGapOver80Count": _audio_rns_shared_frame_gap_over_80_count,
            "rnsSharedFrameGapOver160Count": _audio_rns_shared_frame_gap_over_160_count,
            "rnsSharedFrameGapOver320Count": _audio_rns_shared_frame_gap_over_320_count,
            "rnsSharedFrameGapOver640Count": _audio_rns_shared_frame_gap_over_640_count,
            "rnsSharedFrameGapOver1000Count": _audio_rns_shared_frame_gap_over_1000_count,
            "rnsSharedFrameToTransportInboundMsMax": _audio_rns_shared_frame_to_transport_inbound_ms_max,
            "rnsSharedFrameToTransportInboundOver80Count": _audio_rns_shared_frame_to_transport_inbound_over_80_count,
            "rnsSharedFrameToTransportInboundOver160Count": _audio_rns_shared_frame_to_transport_inbound_over_160_count,
            "rnsSharedFrameToTransportInboundOver320Count": _audio_rns_shared_frame_to_transport_inbound_over_320_count,
            "rnsSharedFrameToTransportInboundOver640Count": _audio_rns_shared_frame_to_transport_inbound_over_640_count,
            "rnsSharedFrameToTransportInboundOver1000Count": _audio_rns_shared_frame_to_transport_inbound_over_1000_count,
            "rnsSharedFrameToTransportInboundSamples": _audio_rns_shared_frame_to_transport_inbound_samples,
            "rnsSharedFrameInterfaceLast": _audio_rns_shared_frame_interface_last,
            "rnsSharedFrameInterfaceWorst": _audio_rns_shared_frame_interface_worst,
            "schedulerDiagnostics": _scheduler_diagnostics(),
            "mediaRouteDiagnostics": _audio_media_route_diagnostics(),
        },
    )


def _emit_binary_audio(chunk: bytes) -> bool:
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
        return True
    except queue.Full:
        _audio_drops_binary_out += 1
        _mark_audio_queue_state_dirty()
        if _audio_drops_binary_out % 100 == 1:
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=binary-out-queue-full drops={_audio_drops_binary_out}"
            )
        return False


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


def _filter_outbound_audio_deadline(
    frames: list, now_wall_ms: Optional[int] = None
) -> tuple[list, int]:
    """Drop parent→child audio frames that already missed the live send deadline."""
    if not frames:
        return frames, 0
    now_ms = (
        now_wall_ms if isinstance(now_wall_ms, int) else int(time.time() * 1000)
    )
    deadline_ms = int(_AUDIO_OUTBOUND_DEADLINE_SECONDS * 1000)
    fresh: list = []
    dropped = 0
    for frame in frames:
        try:
            received_at_wall_ms = int(frame[4])
        except Exception:
            received_at_wall_ms = 0
        if received_at_wall_ms > 0 and now_ms - received_at_wall_ms > deadline_ms:
            dropped += 1
            continue
        fresh.append(frame)
    return fresh, dropped


def _note_fd3_decoded_age(frames: list) -> None:
    global _audio_fd3_decoded_age_ms_max
    if not frames:
        return
    now_ms = int(time.time() * 1000)
    max_age = 0.0
    max_frame: Optional[tuple] = None
    for frame in frames:
        try:
            received_at_wall_ms = int(frame[4])
        except Exception:
            received_at_wall_ms = 0
        if received_at_wall_ms > 0:
            age_ms = float(max(0, now_ms - received_at_wall_ms))
            if age_ms > max_age:
                max_age = age_ms
                max_frame = frame
    if max_age > _audio_fd3_decoded_age_ms_max:
        _audio_fd3_decoded_age_ms_max = max_age
        _mark_audio_queue_state_dirty()
    if max_age >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS and max_frame is not None:
        try:
            route_key = str(max_frame[0] or max_frame[2] or "")
            room_id = str(max_frame[1] or "")
            peer_presence_hash = str(max_frame[2] or "")
            peer_destination_hash = str(max_frame[3] or "")
            byte_count = len(max_frame[5]) if len(max_frame) > 5 else 0
        except Exception:
            route_key = "unknown"
            room_id = ""
            peer_presence_hash = ""
            peer_destination_hash = ""
            byte_count = 0
        _log_audio_timing_anomaly(
            "rns-audio-fd3-decoded-age",
            f"fd3:{route_key}",
            f"route={_short_route(route_key)} room={room_id or 'n/a'} "
            f"age_ms={max_age:.0f} bytes={max(0, int(byte_count or 0))} "
            f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
        )


def _note_decoded_queue_dwell_ms(dwell_ms: float) -> None:
    global _audio_decoded_queue_dwell_ms_max
    if dwell_ms > _audio_decoded_queue_dwell_ms_max:
        _audio_decoded_queue_dwell_ms_max = dwell_ms
        _mark_audio_queue_state_dirty()
    if dwell_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
        _log_audio_timing_anomaly(
            "rns-audio-decoded-queue-dwell",
            "decoded-queue",
            f"dwell_ms={dwell_ms:.0f}",
        )


def _note_rns_send_duration(start_monotonic: float) -> float:
    global _audio_rns_send_duration_ms_max, _audio_rns_send_slow_count
    duration_ms = max(0.0, (time.monotonic() - start_monotonic) * 1000.0)
    if duration_ms > _audio_rns_send_duration_ms_max:
        _audio_rns_send_duration_ms_max = duration_ms
        _mark_audio_queue_state_dirty()
    if duration_ms >= _AUDIO_SLOW_RNS_SEND_LOG_THRESHOLD_MS:
        _audio_rns_send_slow_count += 1
        _mark_audio_queue_state_dirty()
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-send-slow "
            f"duration_ms={duration_ms:.3f} threshold_ms={_AUDIO_SLOW_RNS_SEND_LOG_THRESHOLD_MS:.1f}"
        )
    return duration_ms


def _note_packet_path_check_duration(start_monotonic: float) -> None:
    global _audio_packet_path_check_ms_max
    duration_ms = max(0.0, (time.monotonic() - start_monotonic) * 1000.0)
    if duration_ms > _audio_packet_path_check_ms_max:
        _audio_packet_path_check_ms_max = duration_ms
        _mark_audio_queue_state_dirty()


def _note_executor_loop_gap(
    previous_loop_at: Optional[float],
    now: float,
    queued_before_gap: int,
) -> None:
    global _audio_executor_loop_gap_ms_max, _audio_executor_gap_while_queued_ms_max
    global _audio_executor_stall_count
    if previous_loop_at is None:
        return
    gap_ms = max(0.0, (now - previous_loop_at) * 1000.0)
    if gap_ms > _audio_executor_loop_gap_ms_max:
        _audio_executor_loop_gap_ms_max = gap_ms
        _mark_audio_queue_state_dirty()
    if queued_before_gap > 0 and gap_ms > _audio_executor_gap_while_queued_ms_max:
        _audio_executor_gap_while_queued_ms_max = gap_ms
        _mark_audio_queue_state_dirty()
    if queued_before_gap > 0 and gap_ms >= _AUDIO_EXECUTOR_STALL_LOG_THRESHOLD_MS:
        _audio_executor_stall_count += 1
        _mark_audio_queue_state_dirty()
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-executor-stall "
            f"gap_ms={gap_ms:.3f} queued_before_gap={queued_before_gap} "
            f"threshold_ms={_AUDIO_EXECUTOR_STALL_LOG_THRESHOLD_MS:.1f}"
        )


def _note_executor_audio_pass_duration(start_monotonic: float, batches: int) -> None:
    global _audio_executor_audio_pass_ms_max
    if batches <= 0:
        return
    duration_ms = max(0.0, (time.monotonic() - start_monotonic) * 1000.0)
    if duration_ms > _audio_executor_audio_pass_ms_max:
        _audio_executor_audio_pass_ms_max = duration_ms
        _mark_audio_queue_state_dirty()


def _note_process_audio_batch_duration(start_monotonic: float, frame_count: int) -> None:
    global _audio_process_batch_ms_max, _audio_process_batch_frames_max
    duration_ms = max(0.0, (time.monotonic() - start_monotonic) * 1000.0)
    if duration_ms > _audio_process_batch_ms_max:
        _audio_process_batch_ms_max = duration_ms
        _mark_audio_queue_state_dirty()
    if frame_count > _audio_process_batch_frames_max:
        _audio_process_batch_frames_max = frame_count
        _mark_audio_queue_state_dirty()
    if duration_ms >= _AUDIO_PROCESS_BATCH_LOG_THRESHOLD_MS:
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=process-audio-batch-slow "
            f"duration_ms={duration_ms:.3f} frames={frame_count} "
            f"threshold_ms={_AUDIO_PROCESS_BATCH_LOG_THRESHOLD_MS:.1f}"
        )


def _note_executor_command_duration(
    start_monotonic: float,
    action: Any,
    audio_queued_at_start: int,
) -> None:
    global _audio_executor_command_ms_max, _audio_executor_command_while_queued_ms_max
    global _audio_executor_command_slow_count
    duration_ms = max(0.0, (time.monotonic() - start_monotonic) * 1000.0)
    if duration_ms > _audio_executor_command_ms_max:
        _audio_executor_command_ms_max = duration_ms
        _mark_audio_queue_state_dirty()
    if audio_queued_at_start > 0 and duration_ms > _audio_executor_command_while_queued_ms_max:
        _audio_executor_command_while_queued_ms_max = duration_ms
        _mark_audio_queue_state_dirty()
    if duration_ms >= _AUDIO_EXECUTOR_COMMAND_LOG_THRESHOLD_MS:
        _audio_executor_command_slow_count += 1
        _mark_audio_queue_state_dirty()
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-executor-command-slow "
            f"duration_ms={duration_ms:.3f} action={str(action)[:80]!r} "
            f"audio_queued_at_start={audio_queued_at_start} "
            f"threshold_ms={_AUDIO_EXECUTOR_COMMAND_LOG_THRESHOLD_MS:.1f}"
        )


def _put_audio_decoded_batch_keep_newest(frames: list) -> bool:
    """Admit fresh outbound audio by evicting the oldest decoded batch under pressure."""
    global _audio_drops_ingress, _audio_decoded_queue_evict_oldest
    global _audio_decoded_queue_drop_newest
    queued = (time.monotonic(), frames)
    try:
        _audio_decoded_queue.put_nowait(queued)
        _mark_audio_queue_state_dirty()
        _notify_rns_work_available()
        return True
    except queue.Full:
        pass

    evicted_oldest = False
    try:
        dropped = _audio_decoded_queue.get_nowait()
        if dropped is not None:
            evicted_oldest = True
            _audio_drops_ingress += 1
            _audio_decoded_queue_evict_oldest += 1
    except queue.Empty:
        pass

    try:
        _audio_decoded_queue.put_nowait(queued)
        _mark_audio_queue_state_dirty()
        _notify_rns_work_available()
        if evicted_oldest and _audio_drops_ingress % 100 == 1:
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=decoded-queue-full "
                f"evicted_oldest drops={_audio_drops_ingress}"
            )
        return True
    except queue.Full:
        _audio_drops_ingress += 1
        _audio_decoded_queue_drop_newest += 1
        _mark_audio_queue_state_dirty()
        if _audio_drops_ingress % 100 == 1:
            log(
                f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=decoded-queue-full "
                f"drop_newest drops={_audio_drops_ingress}"
            )
        return False


def _process_audio_batch(frames: list) -> None:
    """frames: list of (link_id, room_id, peer_presence_hash, peer_call_hash, received_at_wall_ms, raw_opus_bytes)"""
    global _audio_ipc_rns_first_send_ok_logged, _audio_packet_send_failures
    global _audio_packet_fresh_sends, _audio_packet_stale_sends, _audio_packet_unknown_sends
    process_start = time.monotonic()
    for link_id, room_id, peer_presence_hash, peer_call_hash, _received_at_wall_ms, raw in frames:
        if link_id:
            peer_key_hint = str(peer_presence_hash or peer_call_hash or "").strip().lower()
            snapshot = _snapshot_audio_link_for_send(link_id, peer_key_hint)
            send_link_id = str(snapshot.get("linkId") or link_id) if snapshot is not None else link_id
            if snapshot is None:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": link_id,
                        "peerPresenceHash": peer_key_hint,
                        "reason": "unknown_link_id",
                        "code": "unknown_link_id",
                        "transport": "link",
                    },
                )
                continue
            if snapshot.get("ready") is not True:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": send_link_id,
                        "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
                        "reason": str(snapshot.get("reason") or "audio_link_not_ready"),
                        "code": str(snapshot.get("reason") or "audio_link_not_ready"),
                        "transport": "link",
                    },
                )
                continue
            link = snapshot.get("link")
            if link is None:
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": send_link_id,
                        "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
                        "reason": "unknown_link_id",
                        "code": "unknown_link_id",
                        "transport": "link",
                    },
                )
                continue
            try:
                wire_bytes = make_group_audio_wire(room_id, raw)
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
                            "linkId": send_link_id,
                            "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
                            "reason": "audio_payload_too_large",
                            "code": "audio_payload_too_large",
                            "transport": "link",
                        },
                    )
                    continue
                send_lock = snapshot.get("sendLock")
                generation = int(snapshot.get("generation") or 0)
                if send_lock is None:
                    send_lock = threading.RLock()
                with send_lock:
                    if not _audio_link_generation_matches(send_link_id, generation):
                        emit_event(
                            "group_audio_send_failed",
                            {
                                "linkId": send_link_id,
                                "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
                                "reason": "audio_link_generation_changed",
                                "code": "audio_link_generation_changed",
                                "transport": "link",
                            },
                        )
                        continue
                    packet = RNS.Packet(link, wire_bytes, create_receipt=False)
                    send_start = time.monotonic()
                    result = packet.send()
                send_duration_ms = _note_rns_send_duration(send_start)
                if result is False:
                    _audio_packet_send_failures += 1
                    _note_audio_route_send(
                        "link",
                        send_link_id,
                        room_id,
                        str(snapshot.get("peerPresenceHash") or ""),
                        str(snapshot.get("peerDestinationHash") or ""),
                        len(wire_bytes),
                        ok=False,
                        incoming=snapshot.get("incoming") is True,
                        source_received_at_wall_ms=_received_at_wall_ms,
                        send_duration_ms=send_duration_ms,
                    )
                    _mark_audio_queue_state_dirty()
                    emit_event(
                        "group_audio_send_failed",
                        {
                            "linkId": send_link_id,
                            "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
                            "reason": "packet_send_false",
                            "code": "packet_send_false",
                            "transport": "link",
                        },
                    )
                else:
                    with _state_lock:
                        current_state = _audio_links_by_id.get(send_link_id)
                        if current_state is not None:
                            now_send = time.time()
                            current_state["last_send_ok_at"] = now_send
                            current_state["last_activity_at"] = now_send
                    _note_audio_route_send(
                        "link",
                        send_link_id,
                        room_id,
                        str(snapshot.get("peerPresenceHash") or ""),
                        str(snapshot.get("peerDestinationHash") or ""),
                        len(wire_bytes),
                        ok=True,
                        incoming=snapshot.get("incoming") is True,
                        source_received_at_wall_ms=_received_at_wall_ms,
                        send_duration_ms=send_duration_ms,
                    )
                    if not _audio_ipc_rns_first_send_ok_logged:
                        _audio_ipc_rns_first_send_ok_logged = True
                        log(
                            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-first-packet-send-ok "
                            f"link_prefix={send_link_id[:8] if len(send_link_id) >= 8 else send_link_id} bytes_wire={len(wire_bytes)}"
                        )
                continue
            except Exception as exc:
                _audio_packet_send_failures += 1
                _note_audio_route_send(
                    "link",
                    send_link_id,
                    room_id,
                    str(snapshot.get("peerPresenceHash") or ""),
                    str(snapshot.get("peerDestinationHash") or ""),
                    0,
                    ok=False,
                    incoming=snapshot.get("incoming") is True,
                )
                _mark_audio_queue_state_dirty()
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": send_link_id,
                        "peerPresenceHash": str(snapshot.get("peerPresenceHash") or ""),
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
            path_check_start = time.monotonic()
            path_state, path_ready = _ensure_call_media_path(
                peer_hash,
                destination_hash,
                active_call=True,
                allow_wait=False,
                reason="audio_send",
            )
            _note_packet_path_check_duration(path_check_start)
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
            wire_bytes = make_group_audio_wire(room_id, raw)
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
            send_start = time.monotonic()
            result = packet.send()
            send_duration_ms = _note_rns_send_duration(send_start)
            if result is False:
                _audio_packet_send_failures += 1
                _note_audio_route_send(
                    "packet",
                    str(peer_hash),
                    room_id,
                    str(peer_hash),
                    str(peer_call_hash or destination_hash_hex(destination_hash)),
                    len(wire_bytes),
                    ok=False,
                    source_received_at_wall_ms=_received_at_wall_ms,
                    send_duration_ms=send_duration_ms,
                )
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
            _note_audio_route_send(
                "packet",
                str(peer_hash),
                room_id,
                str(peer_hash),
                str(peer_call_hash or destination_hash_hex(destination_hash)),
                len(wire_bytes),
                ok=True,
                source_received_at_wall_ms=_received_at_wall_ms,
                send_duration_ms=send_duration_ms,
            )
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
            _note_audio_route_send(
                "packet",
                str(peer_hash),
                room_id,
                str(peer_hash),
                str(peer_call_hash or ""),
                0,
                ok=False,
            )
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
    _note_process_audio_batch_duration(process_start, len(frames))


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


def _open_audio_input_fd_for_audio_reader() -> Optional[int]:
    global _audio_in_fd
    try:
        os.set_blocking(3, False)
    except OSError as exc:
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=open-failed parent→child-binary-disabled err={exc}")
        return None
    _audio_in_fd = 3
    log(
        f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=ingress-ready parent→child-binary "
        f"(outbound audio from Electron, dedicated-reader)"
    )
    return _audio_in_fd


def _audio_input_buffer_has_complete_batch(buffer: bytearray) -> bool:
    if len(buffer) < AUDIO_HEADER_BYTES:
        return False
    if bytes(buffer[0:4]) != AUDIO_MAGIC:
        return True
    body_len = int.from_bytes(buffer[5:9], "big")
    return len(buffer) >= AUDIO_HEADER_BYTES + body_len


def _read_audio_input_available(fd: int, buffer: bytearray) -> bool:
    while True:
        try:
            chunk = os.read(fd, 65536)
        except BlockingIOError:
            return True
        except OSError as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=read-error err={exc}")
            return False
        if not chunk:
            return False
        buffer.extend(chunk)


def _process_audio_input_frames(frames: list, queued_at: float) -> bool:
    global _audio_stale_drops, _audio_deadline_drops, _audio_ipc_fd3_first_batch_ok_logged
    global _audio_fd3_parse_last_wall_ms_by_route
    batch_age = max(0.0, time.monotonic() - queued_at)
    now_wall_ms = int(time.time() * 1000)
    for frame in frames:
        try:
            route_key = str(frame[0] or frame[2] or "")
            room_id = str(frame[1] or "")
            peer_presence_hash = str(frame[2] or "")
            peer_destination_hash = str(frame[3] or "")
            payload = frame[5] if len(frame) > 5 else b""
            byte_count = (
                len(payload) if isinstance(payload, (bytes, bytearray)) else 0
            )
            frame_kind, control_type = _inspect_gcall_audio_payload(payload)
        except Exception:
            route_key = "unknown"
            room_id = ""
            peer_presence_hash = ""
            peer_destination_hash = ""
            byte_count = 0
            frame_kind = "media"
            control_type = ""
        previous_parse_ms = int(
            _audio_fd3_parse_last_wall_ms_by_route.get(route_key) or 0
        )
        if previous_parse_ms > 0:
            parse_gap_ms = max(0, now_wall_ms - previous_parse_ms)
            if parse_gap_ms >= _AUDIO_TIMING_GAP_LOG_THRESHOLD_MS:
                stage = (
                    "rns-control-fd3-parse-gap"
                    if frame_kind == "control"
                    else "rns-audio-fd3-parse-gap"
                )
                _log_audio_timing_anomaly(
                    stage,
                    f"fd3:{route_key}",
                    f"route={_short_route(route_key)} room={room_id or 'n/a'} "
                    f"gap_ms={parse_gap_ms} bytes={max(0, int(byte_count or 0))} "
                    f"frame_kind={frame_kind}"
                    f"{(' control_type=' + control_type) if control_type else ''} "
                    f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)}",
                )
        _audio_fd3_parse_last_wall_ms_by_route[route_key] = now_wall_ms
    _note_fd3_decoded_age(frames)
    frames, deadline_drops = _filter_outbound_audio_deadline(frames)
    if deadline_drops > 0:
        _audio_deadline_drops += deadline_drops
        _audio_stale_drops += deadline_drops
        _mark_audio_queue_state_dirty()
        _emit_audio_queue_state()
    if not frames:
        return False
    if not _audio_ipc_fd3_first_batch_ok_logged:
        _audio_ipc_fd3_first_batch_ok_logged = True
        nframes = len(frames) if isinstance(frames, list) else 0
        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-first-batch-from-parent-parsed "
            f"frames={nframes} mode=dedicated-reader"
        )
    if batch_age > _AUDIO_BATCH_STALE_SECONDS:
        _audio_stale_drops += len(frames)
        _mark_audio_queue_state_dirty()
        return False
    return _put_audio_decoded_batch_keep_newest(frames)


def _drain_audio_input_buffer(buffer: bytearray, batch_budget: int) -> tuple[bool, int]:
    drained_audio = False
    drained_batches = 0
    while drained_batches < batch_budget and len(buffer) >= AUDIO_HEADER_BYTES:
        if bytes(buffer[0:4]) != AUDIO_MAGIC:
            del buffer[0:1]
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-magic")
            continue
        if buffer[4] != AUDIO_VERSION:
            got_version = buffer[4]
            del buffer[:AUDIO_HEADER_BYTES]
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-version got={got_version}")
            continue
        body_len = int.from_bytes(buffer[5:9], "big")
        if body_len > AUDIO_MAX_BODY or body_len < 2:
            del buffer[:AUDIO_HEADER_BYTES]
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=bad-body_len len={body_len}")
            continue
        frame_len = AUDIO_HEADER_BYTES + body_len
        if len(buffer) < frame_len:
            break
        queued_at = time.monotonic()
        body = bytes(buffer[AUDIO_HEADER_BYTES:frame_len])
        del buffer[:frame_len]
        try:
            frames = _parse_audio_batch_body(body)
        except ValueError as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=parse-batch-failed err={exc}")
            continue
        _process_audio_input_frames(frames, queued_at)
        drained_audio = True
        drained_batches += 1
    if drained_audio:
        _mark_audio_queue_state_dirty()
        _emit_audio_queue_state()
    return drained_audio, drained_batches


def _audio_fd3_reader_loop() -> None:
    audio_input_buffer = bytearray()
    audio_fd = _open_audio_input_fd_for_audio_reader()
    if audio_fd is None:
        return

    selector = None
    selector_enabled = False
    if os.name == "nt":
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-reader-selector-skipped platform=windows")
    else:
        selector = selectors.DefaultSelector()
        try:
            selector.register(audio_fd, selectors.EVENT_READ, "audio")
            selector_enabled = True
        except Exception as exc:
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-reader-selector-setup-failed err={exc}")
            try:
                selector.close()
            except Exception:
                pass
            selector = None
            selector_enabled = False

    log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-reader-thread-started")
    try:
        while not _shutdown.is_set():
            if _audio_input_buffer_has_complete_batch(audio_input_buffer):
                _drain_audio_input_buffer(audio_input_buffer, _AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS)
                continue

            if selector_enabled:
                try:
                    assert selector is not None
                    events = selector.select(timeout=0.05)
                except Exception as exc:
                    log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=fd3-reader-selector-error err={exc}")
                    selector_enabled = False
                    try:
                        if selector is not None:
                            selector.close()
                    except Exception:
                        pass
                    selector = None
                    events = []
                for _key, _mask in events:
                    if not _read_audio_input_available(audio_fd, audio_input_buffer):
                        log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=closed")
                        return
            else:
                if not _read_audio_input_available(audio_fd, audio_input_buffer):
                    log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd3=closed")
                    return
                if not _audio_input_buffer_has_complete_batch(audio_input_buffer):
                    time.sleep(0.005)

            if _audio_input_buffer_has_complete_batch(audio_input_buffer):
                _drain_audio_input_buffer(audio_input_buffer, _AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS)
            else:
                _emit_audio_queue_state()
    finally:
        if selector is not None:
            try:
                selector.close()
            except Exception:
                pass


def _audio_frame_route_key(frame: Any) -> str:
    try:
        link_id, _room_id, peer_presence_hash, peer_call_hash, *_rest = frame
    except Exception:
        return "unknown"
    link_key = str(link_id or "").strip()
    if link_key:
        return f"link:{link_key}"
    peer_key = str(peer_presence_hash or peer_call_hash or "").strip().lower()
    return f"packet:{peer_key or 'unknown'}"


def _audio_scheduler_lane_for_route(route_key: str) -> str:
    digest = hashlib.blake2s(str(route_key or "unknown").encode("utf-8"), digest_size=2).digest()
    shard = int.from_bytes(digest, "big") % max(1, _SCHEDULER_AUDIO_SHARDS)
    return f"audio-send-{shard}"


def _enqueue_audio_send_batch(route_key: str, batch: list) -> bool:
    if not batch:
        return False
    lane = _audio_scheduler_lane_for_route(route_key)
    return _enqueue_scheduler_task(
        lane,
        f"audio-send:{route_key}",
        _process_audio_batch,
        batch,
        drop_oldest=True,
    )


def _drain_audio_executor_pass(batch_budget: int) -> tuple[bool, int]:
    global _audio_stale_drops, _audio_deadline_drops
    global _audio_drops_ingress, _audio_decoded_queue_drop_newest
    drained_audio = False
    drained_batches = 0
    audio_pass_start = time.monotonic()
    try:
        while drained_batches < batch_budget:
            queued = _audio_decoded_queue.get_nowait()
            if queued is None:
                break
            queued_at, batch = queued
            batch_age = time.monotonic() - queued_at
            _note_decoded_queue_dwell_ms(batch_age * 1000.0)
            if batch_age > _AUDIO_BATCH_STALE_SECONDS:
                _audio_stale_drops += len(batch)
                _mark_audio_queue_state_dirty()
            else:
                batch, deadline_drops = _filter_outbound_audio_deadline(batch)
                if deadline_drops > 0:
                    _audio_deadline_drops += deadline_drops
                    _audio_stale_drops += deadline_drops
                    _mark_audio_queue_state_dirty()
                if batch:
                    by_route: Dict[str, list] = {}
                    for frame in batch:
                        route_key = _audio_frame_route_key(frame)
                        by_route.setdefault(route_key, []).append(frame)
                    for route_key, route_batch in by_route.items():
                        if not _enqueue_audio_send_batch(route_key, route_batch):
                            _audio_drops_ingress += len(route_batch)
                            _audio_decoded_queue_drop_newest += len(route_batch)
                            _mark_audio_queue_state_dirty()
            drained_audio = True
            drained_batches += 1
    except queue.Empty:
        pass
    _note_executor_audio_pass_duration(audio_pass_start, drained_batches)
    if drained_audio:
        _mark_audio_queue_state_dirty()
        _emit_audio_queue_state()
    return drained_audio, drained_batches


def _handle_rns_command_message(
    message: Optional[Dict[str, Any]],
    audio_queued_at_start_override: Optional[int] = None,
) -> bool:
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
        return False
    action = message.get("action") if isinstance(message, dict) else None
    lane = _scheduler_lane_for_command(action)
    ok = _enqueue_scheduler_task(lane, f"cmd:{action or 'unknown'}", handle_command, message)
    if not ok:
        req_id = str(message.get("id") or "") if isinstance(message, dict) else ""
        if req_id:
            emit_resp(
                req_id,
                False,
                payload={"code": "scheduler_queue_full", "lane": lane},
                error=f"Reticulum scheduler lane is full: {lane}",
            )
        else:
            emit_event(
                "error",
                {
                    "code": "scheduler_queue_full",
                    "message": f"Reticulum scheduler lane is full: {lane}",
                    "action": str(action or ""),
                },
            )
    _emit_audio_queue_state()
    return True


def _drain_rns_command_pass(
    first_message: Optional[Dict[str, Any]] = None,
    audio_queued_at_start_override: Optional[int] = None,
) -> bool:
    drained = 0
    if first_message is not None:
        if not _handle_rns_command_message(
            first_message,
            audio_queued_at_start_override,
        ):
            return False
        drained += 1

    while drained < _CMD_DRAIN_BATCH_MAX:
        try:
            message = _cmd_queue_bounded.get_nowait()
        except queue.Empty:
            break
        audio_queued_at_start = _audio_decoded_queue.qsize()
        if not _handle_rns_command_message(message, audio_queued_at_start):
            return False
        drained += 1
    return True


def _scheduler_lane_for_command(action: Any) -> str:
    action_name = str(action or "")
    if action_name in {"clear_group_audio_diagnostics"}:
        return "control-send"
    if action_name in {
        "open_group_audio_link",
        "close_group_audio_link",
        "reset_group_audio_peer_state",
        "overlay_sync_state",
    }:
        return "link-management"
    if action_name in {"warm_group_audio_path"}:
        return "path-management"
    if action_name in {
        "accept_qchat_file_resource",
        "send_qchat_file_resource",
        "authorize_qchat_file_resource",
        "reject_qchat_file_resource",
    }:
        return "file-transfer"
    return "control-send"


def _rns_executor_loop() -> None:
    last_loop_at: Optional[float] = None
    queued_before_gap = 0
    next_lane = "audio"
    selector = selectors.DefaultSelector()
    selector_enabled = False
    try:
        if _rns_wake_read_fd is not None:
            selector.register(_rns_wake_read_fd, selectors.EVENT_READ, "wake")
        selector_enabled = bool(selector.get_map())
    except Exception as exc:
        log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-owner-selector-setup-failed err={exc}")
        try:
            selector.close()
        except Exception:
            pass
        selector_enabled = False

    while True:
        loop_start = time.monotonic()
        _note_executor_loop_gap(last_loop_at, loop_start, queued_before_gap)
        last_loop_at = loop_start

        audio_ready = not _audio_decoded_queue.empty()
        cmd_ready = not _cmd_queue_bounded.empty()
        if not audio_ready and not cmd_ready:
            if _shutdown.is_set():
                return
            queued_before_gap = 0
            _emit_audio_queue_state()
            if selector_enabled:
                try:
                    events = selector.select(timeout=0.05)
                except Exception as exc:
                    log(f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-owner-selector-error err={exc}")
                    events = []
                for key, _mask in events:
                    if key.data == "wake":
                        _drain_rns_wake_pipe()
            else:
                try:
                    message = _cmd_queue_bounded.get(timeout=0.01)
                except queue.Empty:
                    time.sleep(0.002)
                    continue
                if not _drain_rns_command_pass(message, 0):
                    return
                next_lane = "audio"
                queued_before_gap = _audio_decoded_queue.qsize()
            continue

        if audio_ready and (not cmd_ready or next_lane == "audio"):
            decoded_backlog = _audio_decoded_queue.qsize()
            if cmd_ready:
                batch_budget = _AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS
            else:
                batch_budget = min(
                    _AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS,
                    _AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS
                    + max(0, decoded_backlog // _AUDIO_BACKLOG_BATCH_STEP),
                )
            _drain_audio_executor_pass(batch_budget)
            next_lane = "cmd"
            queued_before_gap = _audio_decoded_queue.qsize()
            continue

        if cmd_ready:
            if not _drain_rns_command_pass():
                return
            next_lane = "audio"
            queued_before_gap = _audio_decoded_queue.qsize()
            continue


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def verbose_presence_log(message: str) -> None:
    if _PRESENCE_BRIDGE_VERBOSE_LOGS:
        log(message)


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


def rns_callback_scheduler_monitor_loop() -> None:
    global _audio_rns_callback_scheduler_gap_ms_max
    global _audio_rns_callback_scheduler_gap_over_100_count
    global _audio_rns_callback_scheduler_gap_over_250_count
    global _audio_rns_callback_scheduler_gap_over_500_count
    global _audio_rns_callback_scheduler_gap_over_1000_count
    interval = _AUDIO_RNS_CALLBACK_SCHEDULER_MONITOR_INTERVAL_SECONDS
    last_at = time.monotonic()
    while True:
        time.sleep(interval)
        now = time.monotonic()
        elapsed_ms = max(0.0, (now - last_at) * 1000.0)
        last_at = now
        if elapsed_ms > _audio_rns_callback_scheduler_gap_ms_max:
            _audio_rns_callback_scheduler_gap_ms_max = elapsed_ms
        if elapsed_ms >= 100.0:
            _audio_rns_callback_scheduler_gap_over_100_count += 1
            if elapsed_ms >= 250.0:
                _audio_rns_callback_scheduler_gap_over_250_count += 1
            if elapsed_ms >= 500.0:
                _audio_rns_callback_scheduler_gap_over_500_count += 1
            if elapsed_ms >= 1000.0:
                _audio_rns_callback_scheduler_gap_over_1000_count += 1
            _mark_audio_queue_state_dirty()


def ensure_rns_callback_scheduler_monitor_started() -> None:
    global _rns_callback_scheduler_monitor_thread
    if (
        _rns_callback_scheduler_monitor_thread is not None
        and _rns_callback_scheduler_monitor_thread.is_alive()
    ):
        return
    _rns_callback_scheduler_monitor_thread = threading.Thread(
        target=rns_callback_scheduler_monitor_loop,
        daemon=True,
        name="reticulum-rns-callback-scheduler-monitor",
    )
    _rns_callback_scheduler_monitor_thread.start()


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
        _note_overlay_peer_alive(peer_key, source)
    if source in ("ts_seed", "recall"):
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


def _overlay_failure_should_suppress(reason: str) -> bool:
    reason_key = str(reason or "").strip().lower()
    return any(
        token in reason_key
        for token in (
            "timeout",
            "no_link",
            "no_established_link",
            "destination_closed",
            "rx_idle_timeout",
        )
    )


def _overlay_peer_suppressed_until(peer_key: str) -> float:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return 0.0
    state = _overlay_peer_failures.get(peer_key)
    if not isinstance(state, dict):
        return 0.0
    until = state.get("suppress_until")
    if not isinstance(until, (int, float)):
        return 0.0
    now = time.time()
    if float(until) <= now:
        _overlay_peer_failures.pop(peer_key, None)
        return 0.0
    return float(until)


def _overlay_peer_is_suppressed(peer_key: str) -> bool:
    return _overlay_peer_suppressed_until(peer_key) > time.time()


def _note_overlay_peer_alive(peer_key: str, source: str) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    if _overlay_peer_failures.pop(peer_key, None) is not None:
        log(
            "[presence_bridge] target=presence-reticulum overlay_peer_failure_reset "
            f"peer={peer_key} source={source}"
        )


def _note_overlay_peer_failure(peer_key: str, reason: str) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _overlay_failure_should_suppress(reason):
        return
    now = time.time()
    state = _overlay_peer_failures.get(peer_key) or {}
    count = int(state.get("count") or 0) + 1
    suppress_until = state.get("suppress_until")
    if count >= _OVERLAY_LINK_FAILURE_SUPPRESS_LIMIT:
        suppress_until = now + _OVERLAY_LINK_FAILURE_SUPPRESS_SECONDS
    _overlay_peer_failures[peer_key] = {
        "count": count,
        "last_reason": reason,
        "last_failure_at": now,
        "suppress_until": suppress_until if isinstance(suppress_until, (int, float)) else None,
    }
    if isinstance(suppress_until, (int, float)) and float(suppress_until) > now:
        log(
            "[presence_bridge] target=presence-reticulum overlay_peer_suppressed "
            f"peer={peer_key} reason={reason} failures={count} "
            f"suppress_seconds={int(float(suppress_until) - now)}"
        )
    else:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_peer_failure "
            f"peer={peer_key} reason={reason} failures={count}"
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
        last_seen_seconds = _coerce_epoch_seconds(last_seen)
        if last_seen_seconds is not None:
            st = _peer_lifecycle.setdefault(
                peer_hash,
                {
                    "last_seen_inbound": None,
                    "last_send_ok": None,
                    "last_request_path_at": None,
                    "ts_seed_until": None,
                },
            )
            prev_seen = st.get("last_seen_inbound")
            if not isinstance(prev_seen, (int, float)) or last_seen_seconds > float(prev_seen):
                st["last_seen_inbound"] = last_seen_seconds
        next_verified[peer_hash] = {
            "address": address,
            "last_seen": float(last_seen),
        }
        _candidate_peers.pop(peer_hash, None)
    _verified_overlay_peers = next_verified
    next_neighbors: Dict[str, float] = {}
    for raw_hash in active_neighbor_hashes:
        if len(next_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        peer_hash = str(raw_hash or "").strip().lower()
        if not peer_hash:
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if _overlay_peer_is_suppressed(peer_hash):
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
        if len(next_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        if peer_hash in next_neighbors:
            continue
        if _overlay_peer_is_suppressed(peer_hash):
            continue
        if not isinstance(seen_at, (int, float)):
            continue
        if now - float(seen_at) > _OVERLAY_NEIGHBOR_GRACE_SECONDS:
            continue
        if (
            peer_hash not in next_verified
            and peer_hash not in prev_verified
            and peer_hash not in _candidate_peers
        ):
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        next_neighbors[peer_hash] = float(seen_at)
        retained_neighbors += 1
    if len(next_neighbors) < _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        candidates: list[tuple[float, str]] = []
        for peer_hash, peer in next_verified.items():
            peer_key = str(peer_hash or "").strip().lower()
            if (
                not peer_key
                or peer_key in next_neighbors
                or (local_hex and peer_key == local_hex)
                or _overlay_peer_is_suppressed(peer_key)
            ):
                continue
            last_seen = peer.get("last_seen") if isinstance(peer, dict) else None
            if not isinstance(last_seen, (int, float)):
                last_seen = 0.0
            candidates.append((float(last_seen), peer_key))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        for _last_seen, peer_key in candidates:
            if len(next_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
                break
            if peer_key not in _known_peers:
                ensure_known_peer_from_recall(peer_key, "ts_seed")
            next_neighbors[peer_key] = now
    _active_overlay_neighbors = next_neighbors
    publish_fanout_count = len(set(_active_overlay_neighbors.keys()) | set(_inbound_overlay_neighbors.keys()))
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_sync "
        f"verified={len(_verified_overlay_peers)} outbound_fanout={len(_active_overlay_neighbors)} "
        f"inbound_fanout={len(_inbound_overlay_neighbors)} "
        f"publish_fanout={publish_fanout_count} "
        f"retained={retained_neighbors}"
    )


def _overlay_peer_has_established_link(peer_hash: str) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_key)
        if not link_id:
            return False
        state = _overlay_links_by_id.get(link_id)
        return bool(
            state is not None
            and state.get("established") is True
            and state.get("link") is not None
        )


def _coerce_epoch_seconds(value: Any) -> Optional[float]:
    if not isinstance(value, (int, float)):
        return None
    ts = float(value)
    if ts <= 0:
        return None
    # Electron sends epoch milliseconds; Python-side timestamps are seconds.
    if ts > 10_000_000_000:
        ts = ts / 1000.0
    return ts


def _overlay_peer_recently_rx_active(peer_hash: str, now: Optional[float] = None) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    st = _peer_lifecycle.get(peer_key) or {}
    last_in = st.get("last_seen_inbound")
    last_in_seconds = _coerce_epoch_seconds(last_in)
    if last_in_seconds is None:
        return False
    if now is None:
        now = time.time()
    return (float(now) - last_in_seconds) <= _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS


def _resolve_overlay_neighbor_hashes(
    exclude_hashes: Optional[list[str]] = None,
    established_only: bool = False,
) -> list[str]:
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
        if established_only and not _overlay_peer_has_established_link(peer_hash):
            continue
        # Refresh the active-neighbor lease on real fanout use. Overlay sync from
        # Electron is event-driven, so steady 25 s presence heartbeats must keep a
        # healthy neighbor from aging out after the 30 s grace window.
        _active_overlay_neighbors[peer_hash] = now
        out.append(peer_hash)
    for peer_hash in list(_inbound_overlay_neighbors.keys()):
        if peer_hash in exclude or peer_hash in out:
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if peer_hash not in _known_peers:
            continue
        if established_only and not _overlay_peer_has_established_link(peer_hash):
            continue
        if not _overlay_peer_recently_rx_active(peer_hash, now):
            _inbound_overlay_neighbors.pop(peer_hash, None)
            continue
        _inbound_overlay_neighbors[peer_hash] = now
        out.append(peer_hash)
    return out[:(_OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_INBOUND_NEIGHBORS)]


def _overlay_peer_is_admitted(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    return peer_key in _active_overlay_neighbors or peer_key in _inbound_overlay_neighbors


def _overlay_peer_is_outbound(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    return bool(peer_key and peer_key in _active_overlay_neighbors)


def _overlay_peer_is_inbound(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    return bool(peer_key and peer_key in _inbound_overlay_neighbors)


def _promote_recent_verified_overlay_neighbors(
    reason: str, exclude_hashes: Optional[Set[str]] = None
) -> int:
    global _active_overlay_neighbors
    if len(_active_overlay_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        return 0
    exclude = {
        str(h).strip().lower() for h in (exclude_hashes or set()) if str(h).strip()
    }
    local_hex = _local_presence_hash_hex()
    candidates: list[tuple[float, str]] = []
    for peer_hash, peer in _verified_overlay_peers.items():
        peer_key = str(peer_hash or "").strip().lower()
        if not peer_key:
            continue
        if local_hex and peer_key == local_hex:
            continue
        if _overlay_peer_is_suppressed(peer_key):
            continue
        if (
            peer_key in exclude
            or peer_key in _active_overlay_neighbors
            or peer_key in _inbound_overlay_neighbors
        ):
            continue
        last_seen = peer.get("last_seen") if isinstance(peer, dict) else None
        if not isinstance(last_seen, (int, float)):
            last_seen = 0.0
        candidates.append((float(last_seen), peer_key))
    if not candidates:
        return 0
    candidates.sort(key=lambda item: (-item[0], item[1]))
    now = time.time()
    selected: list[str] = []
    for _last_seen, peer_key in candidates:
        if len(_active_overlay_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        if peer_key not in _known_peers:
            ensure_known_peer_from_recall(peer_key, "ts_seed")
        if peer_key not in _known_peers:
            continue
        _active_overlay_neighbors[peer_key] = now
        selected.append(peer_key)
    if selected:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_fanout_promote "
            f"reason={reason} selected={len(selected)} total={len(_active_overlay_neighbors)} "
            f"fanout_hashes={','.join(selected)}"
        )
    return len(selected)


def _demote_overlay_fanout_peer(peer_hash: str, reason: str) -> bool:
    global _active_overlay_neighbors, _inbound_overlay_neighbors
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    was_outbound = peer_key in _active_overlay_neighbors
    was_inbound = peer_key in _inbound_overlay_neighbors
    if not was_outbound and not was_inbound:
        return False
    _active_overlay_neighbors.pop(peer_key, None)
    _inbound_overlay_neighbors.pop(peer_key, None)
    _note_overlay_peer_failure(peer_key, reason)
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_fanout_demote "
        f"peer={peer_key} reason={reason} outbound={len(_active_overlay_neighbors)} "
        f"inbound={len(_inbound_overlay_neighbors)}"
    )
    if was_outbound:
        _promote_recent_verified_overlay_neighbors(reason, {peer_key})
    return True


def _get_group_audio_peer_identity(peer_hash: str):
    """RNS identity for group audio using join destination hash + recall.

    Group audio is keyed by the joiner's Reticulum destination hash from Electron; it does
    not require membership in the verified-overlay snapshot from ``overlay_sync_state``."""
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return None
    with _state_lock:
        ident = _known_peers.get(peer_key)
    if ident is not None:
        return ident
    ensure_known_peer_from_recall(peer_key, "ts_seed")
    with _state_lock:
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


def _overlay_bootstrap_peer_sort_key(peer_key: str) -> tuple[int, float, str]:
    st = _peer_lifecycle.get(peer_key) or {}
    now = time.time()
    lease = st.get("ts_seed_until")
    last_in = st.get("last_seen_inbound")
    last_ok = st.get("last_send_ok")
    recent_ts = 0.0
    if isinstance(last_in, (int, float)):
        recent_ts = max(recent_ts, float(last_in))
    if isinstance(last_ok, (int, float)):
        recent_ts = max(recent_ts, float(last_ok))
    if isinstance(lease, (int, float)) and float(lease) > now:
        recent_ts = max(recent_ts, float(lease))
        return (0, -recent_ts, peer_key)
    if recent_ts > 0:
        return (1, -recent_ts, peer_key)
    return (2, 0.0, peer_key)


def _bootstrap_overlay_neighbors_if_degraded(reason: str) -> int:
    """
    Recover from a drained or low-fanout overlay by temporarily seeding fanout
    from known Reticulum/Qortal presence destinations.

    This only creates send targets. Peers still become verified solely through
    accepted signed Qortal presence or other validated overlay traffic.
    """
    global _active_overlay_neighbors
    if len(_active_overlay_neighbors) >= _OVERLAY_MIN_HEALTHY_FANOUT:
        return 0
    local_hex = _local_presence_hash_hex()
    candidates: list[str] = []
    for peer_key in list(_known_peers.keys()):
        if not _valid_presence_destination_hash_hex(peer_key):
            continue
        if local_hex and peer_key == local_hex:
            continue
        if _overlay_peer_is_suppressed(peer_key):
            continue
        if peer_key in _active_overlay_neighbors or peer_key in _inbound_overlay_neighbors:
            continue
        candidates.append(peer_key)
    if not candidates:
        return 0
    candidates.sort(key=_overlay_bootstrap_peer_sort_key)
    now = time.time()
    needed = max(0, _OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS - len(_active_overlay_neighbors))
    selected = candidates[:needed]
    for peer_key in selected:
        _active_overlay_neighbors[peer_key] = now
    for peer_key in selected:
        _mark_candidate_peer(peer_key, f"bootstrap:{reason}")
    log(
        "[presence_bridge] target=presence-reticulum overlay_bootstrap "
        f"reason={reason} selected={len(selected)} total={len(_active_overlay_neighbors)} "
        f"known_peers={len(_known_peers)} "
        f"fanout_hashes={','.join(selected)}"
    )
    return len(selected)


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
        _retry_pending_audio_connect_on_announce(peer_hash)


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


def _overlay_link_is_current(link_id: str, link: Any = None) -> bool:
    if not link_id:
        return False
    with _state_lock:
        state = _overlay_links_by_id.get(link_id)
        if state is None:
            return False
        if link is not None and state.get("link") is not link:
            return False
    if link is not None and getattr(link, "status", None) == getattr(RNS.Link, "CLOSED", object()):
        return False
    return True


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
            state["_was_active_overlay"] = existing == link_id
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
    now = time.time()
    created_at = state.get("created_at")
    established_at = state.get("established_at")
    last_rx_at = state.get("last_rx_at")
    last_send_ok_at = state.get("last_send_ok_at")
    last_activity_at = state.get("last_activity_at")

    def age_ms(value: Any) -> Optional[int]:
        if not isinstance(value, (int, float)):
            return None
        return max(0, int((now - float(value)) * 1000.0))

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
            "lastRxAt": (
                float(last_rx_at) * 1000.0
                if isinstance(last_rx_at, (int, float))
                else None
            ),
            "createdAgeMs": age_ms(created_at),
            "establishedAgeMs": age_ms(established_at),
            "lastRxAgeMs": age_ms(last_rx_at),
            "lastSendOkAgeMs": age_ms(last_send_ok_at),
            "lastActivityAgeMs": age_ms(last_activity_at),
        },
    )


def _overlay_teardown_reason_name(reason: Any) -> str:
    if reason == getattr(RNS.Link, "TIMEOUT", object()):
        return "timeout"
    if reason == getattr(RNS.Link, "INITIATOR_CLOSED", object()):
        return "initiator_closed"
    if reason == getattr(RNS.Link, "DESTINATION_CLOSED", object()):
        return "destination_closed"
    if reason is None:
        return "closed"
    return str(reason)


def _overlay_close_debug_line(link_id: str, state: Dict[str, Any], reason: str) -> str:
    now = time.time()

    def age_label(key: str) -> str:
        value = state.get(key)
        if not isinstance(value, (int, float)):
            return "na"
        return str(max(0, int((now - float(value)) * 1000.0)))

    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower() or "unknown"
    link = state.get("link")
    reticulum_status = getattr(link, "status", None) if link is not None else None
    was_active = state.get("_was_active_overlay") is True
    return (
        "[presence_bridge] target=presence-reticulum overlay_link_close_detail "
        f"link={link_id} peer={peer_hash} incoming={str(state.get('incoming') is True).lower()} "
        f"was_established={str(state.get('established') is True).lower()} "
        f"was_active={str(was_active).lower()} reason={reason} "
        f"created_age_ms={age_label('created_at')} "
        f"established_age_ms={age_label('established_at')} "
        f"last_rx_age_ms={age_label('last_rx_at')} "
        f"last_send_ok_age_ms={age_label('last_send_ok_at')} "
        f"last_activity_age_ms={age_label('last_activity_at')} "
        f"queued={len(state.get('pending_packets') or [])} rns_status={reticulum_status}"
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


def _dedup_activity_ts(state: Dict[str, Any]) -> float:
    """Sort key for recently useful links; higher = more useful."""
    best = 0.0
    for key in ("last_rx_at", "last_send_ok_at", "last_activity_at", "established_at"):
        t = state.get(key)
        if isinstance(t, (int, float)):
            best = max(best, float(t))
    return best


def _dedup_has_peer_hash(state: Dict[str, Any], peer_key: str) -> bool:
    return str(state.get("peerPresenceHash") or "").strip().lower() == peer_key


def _dedup_pick_keep_link(
    peer_key: str,
    link_id_a: str,
    state_a: Dict[str, Any],
    link_id_b: str,
    state_b: Dict[str, Any],
) -> tuple[str, str]:
    """Return (keep_link_id, teardown_link_id) for two links to the same peer."""
    est_a = state_a.get("established") is True
    est_b = state_b.get("established") is True
    if est_a and not est_b:
        return link_id_a, link_id_b
    if est_b and not est_a:
        return link_id_b, link_id_a
    known_a = _dedup_has_peer_hash(state_a, peer_key)
    known_b = _dedup_has_peer_hash(state_b, peer_key)
    if known_a and not known_b:
        return link_id_a, link_id_b
    if known_b and not known_a:
        return link_id_b, link_id_a
    activity_a = _dedup_activity_ts(state_a)
    activity_b = _dedup_activity_ts(state_b)
    if abs(activity_a - activity_b) > 0.001:
        return (link_id_a, link_id_b) if activity_a > activity_b else (link_id_b, link_id_a)
    incoming_a = state_a.get("incoming") is True
    incoming_b = state_b.get("incoming") is True
    if incoming_a != incoming_b:
        local_hex = _local_presence_hash_hex()
        if local_hex and _valid_presence_destination_hash_hex(peer_key):
            # Deterministic duplicate resolution for otherwise equivalent links:
            # lower hash keeps outbound, higher hash keeps incoming.
            prefer_incoming = local_hex > peer_key
            if incoming_a == prefer_incoming:
                return link_id_a, link_id_b
            return link_id_b, link_id_a
    both_est = est_a and est_b
    ta = _dedup_age_ts(state_a, both_est)
    tb = _dedup_age_ts(state_b, both_est)
    if ta != tb:
        return (link_id_a, link_id_b) if ta < tb else (link_id_b, link_id_a)
    return (link_id_a, link_id_b) if link_id_a < link_id_b else (link_id_b, link_id_a)


def _overlay_teardown_should_demote(reason: str) -> bool:
    # These are local management events, not proof that the peer cannot keep a
    # usable fanout link. Demoting here causes sync churn and can prune good links.
    if reason in {
        "pruned",
        "pruned_orphan",
        "dedup_orphan",
        "dedup_same_peer",
        "announce_retry",
        "initiator_closed",
        "admission_rejected",
        "pruned_unknown_full",
    }:
        return False
    return True


def _overlay_link_recent_activity_age_seconds(state: Dict[str, Any], now: float) -> Optional[float]:
    recent_at = 0.0
    for key in ("last_send_ok_at", "last_rx_at", "last_activity_at"):
        value = state.get(key)
        if isinstance(value, (int, float)):
            recent_at = max(recent_at, float(value))
    if recent_at <= 0.0:
        return None
    return max(0.0, now - recent_at)


def _overlay_timeout_close_should_keep_peer(state: Dict[str, Any], reason: str, now: float) -> bool:
    if str(reason or "").strip().lower() != "timeout":
        return False
    age = _overlay_link_recent_activity_age_seconds(state, now)
    return (
        age is not None
        and age <= _OVERLAY_LINK_TIMEOUT_RECENT_ACTIVITY_GRACE_SECONDS
    )


def _overlay_mesh_link_count_locked() -> int:
    return len(_overlay_links_by_id)


def _admit_overlay_peer_if_allowed(peer_key: str, reason: str, incoming: bool = False) -> bool:
    """Admit a peer into the direction-specific presence overlay mesh budget."""
    global _active_overlay_neighbors, _inbound_overlay_neighbors
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return False
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return False
    target = _inbound_overlay_neighbors if incoming else _active_overlay_neighbors
    direction = "inbound" if incoming else "outbound"
    limit = _OVERLAY_MAX_INBOUND_NEIGHBORS if incoming else _OVERLAY_MAX_OUTBOUND_NEIGHBORS
    if peer_key in target:
        return True
    if len(target) >= limit:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_admission_reject "
            f"peer={peer_key} direction={direction} reason={reason} active={len(target)}"
        )
        return False
    target[peer_key] = time.time()
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_admission_accept "
        f"peer={peer_key} direction={direction} reason={reason} active={len(target)}"
    )
    return True


def _overlay_unknown_inbound_allowed() -> bool:
    if len(_inbound_overlay_neighbors) >= _OVERLAY_MAX_INBOUND_NEIGHBORS:
        return False
    with _state_lock:
        return _overlay_mesh_link_count_locked() < (
            _OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_INBOUND_NEIGHBORS
        )


def _teardown_overlay_link_id(link_id: str, reason: str) -> None:
    state = remove_overlay_link(link_id)
    if state is None:
        return
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    verbose_presence_log(_overlay_close_debug_line(link_id, state, reason))
    link = state.get("link")
    if link is not None:
        try:
            link.teardown()
        except Exception:
            pass
    state["established"] = False
    emit_overlay_link_state(link_id, state, reason)
    if peer_hash and _overlay_teardown_should_demote(reason):
        _demote_overlay_fanout_peer(peer_hash, f"link_teardown:{reason}")


def _maybe_prune_stale_overlay_links() -> None:
    now = time.time()
    stale_ids = []
    with _state_lock:
        for link_id, state in list(_overlay_links_by_id.items()):
            if state.get("established") is not True:
                continue
            last_activity = state.get("last_activity_at")
            if not isinstance(last_activity, (int, float)):
                last_activity = state.get("last_rx_at")
            if not isinstance(last_activity, (int, float)):
                last_activity = state.get("last_send_ok_at")
            if not isinstance(last_activity, (int, float)):
                last_activity = state.get("established_at") or state.get("created_at")
            if not isinstance(last_activity, (int, float)):
                continue
            if now - float(last_activity) > _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS:
                stale_ids.append(link_id)
    for link_id in stale_ids:
        _teardown_overlay_link_id(link_id, "rx_idle_timeout")


def _register_active_overlay_for_peer(peer_key: str, link_id: str) -> Optional[Dict[str, Any]]:
    """One active overlay link per peer hash; teardown duplicate links."""
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return None
    state_for_direction = get_overlay_link_state(link_id)
    incoming = bool(state_for_direction and state_for_direction.get("incoming") is True)
    if not _admit_overlay_peer_if_allowed(peer_key, "register_active", incoming=incoming):
        _teardown_overlay_link_id(link_id, "admission_rejected")
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
            "[presence_bridge] target=presence-reticulum overlay_link_duplicate_teardown "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        if keep_state is not None:
            log(
                "[presence_bridge] target=presence-reticulum overlay_link_canonical_keep "
                f"peer={peer_key} link={keep_id} incoming={str(keep_state.get('incoming') is True).lower()} "
                f"established={str(keep_state.get('established') is True).lower()}"
            )
        _teardown_overlay_link_id(lose_id, "dedup_same_peer")
    return keep_state


def _dedup_overlay_links_for_peer(
    peer_key: str,
    preferred_link_id: str = "",
    reason: str = "dedup_same_peer",
) -> Optional[Dict[str, Any]]:
    """Collapse all live overlay links for a peer down to one canonical link."""
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return None
    preferred_link_id = str(preferred_link_id or "")
    lose_ids: List[str] = []
    keep_id = ""
    keep_state: Optional[Dict[str, Any]] = None
    with _state_lock:
        candidates = [
            (link_id, state)
            for link_id, state in _overlay_links_by_id.items()
            if str(state.get("peerPresenceHash") or "").strip().lower() == peer_key
        ]
        if not candidates:
            if _active_overlay_link_id_by_peer_hash.get(peer_key):
                _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            return None
        if len(candidates) == 1:
            keep_id, keep_state = candidates[0]
            _active_overlay_link_id_by_peer_hash[peer_key] = keep_id
            return keep_state

        preferred = next(
            ((link_id, state) for link_id, state in candidates if link_id == preferred_link_id),
            None,
        )
        active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        active = next(
            ((link_id, state) for link_id, state in candidates if link_id == active_link_id),
            None,
        )
        keep_id, keep_state = preferred or active or candidates[0]
        for candidate_id, candidate_state in candidates:
            if candidate_id == keep_id:
                continue
            next_keep_id, next_lose_id = _dedup_pick_keep_link(
                peer_key,
                keep_id,
                keep_state,
                candidate_id,
                candidate_state,
            )
            if next_keep_id == candidate_id:
                lose_ids.append(keep_id)
                keep_id = candidate_id
                keep_state = candidate_state
            else:
                lose_ids.append(next_lose_id)
        _active_overlay_link_id_by_peer_hash[peer_key] = keep_id
        keep_state = _overlay_links_by_id.get(keep_id)

    for lose_id in dict.fromkeys(lose_ids):
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_duplicate_teardown "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        _teardown_overlay_link_id(lose_id, reason)
    return keep_state


def _flush_overlay_link_pending(link_id: str) -> None:
    state = get_overlay_link_state(link_id)
    if state is None or state.get("established") is not True:
        return
    link = state.get("link")
    pending = state.get("pending_packets")
    if link is None or pending is None:
        return
    if not _overlay_link_is_current(link_id, link):
        return
    while pending:
        if not _overlay_link_is_current(link_id, link):
            return
        traffic, wire_bytes = pending[0]
        if not _send_packet_on_link(
            link,
            wire_bytes,
            f"target=presence-reticulum overlay_link_flush peer={state.get('peerPresenceHash') or 'unknown'} traffic={traffic}",
        ):
            break
        if not _overlay_link_is_current(link_id, link):
            return
        pending.popleft()
    if _overlay_link_is_current(link_id, link):
        emit_overlay_link_state(link_id, state, "flush")


def _ensure_overlay_link(
    peer_hash: str,
    await_path: bool = True,
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
    if not _admit_overlay_peer_if_allowed(peer_key, "outbound", incoming=False):
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
                await_seconds=_OVERLAY_LINK_PATH_AWAIT_SECONDS if await_path else 0.0,
            ):
                if await_path:
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
                    log(
                        "[presence_bridge] target=presence-reticulum "
                        f"overlay_link_reuse_{'incoming' if existing.get('incoming') is True else 'outgoing'} "
                        f"peer={peer_key} link={existing_link_id}"
                    )
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
        f"[presence_bridge] target=presence-reticulum overlay_link_open_on_demand peer={peer_key}"
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
    _enqueue_scheduler_task(
        "link-management",
        "overlay-link-retry-on-announce",
        _ensure_overlay_link,
        peer_key,
    )


def _retry_pending_audio_connect_on_announce(peer_hash: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
        existing_link_id = _outgoing_audio_link_id_by_peer_hash.get(peer_key)
    if desired is None or desired.get("desired") is not True:
        return
    existing = get_audio_link_state(existing_link_id) if existing_link_id else None
    if existing is not None and existing.get("established") is True:
        return
    if _has_viable_audio_link_for_peer(peer_key):
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_retry_on_announce_skipped "
            f"peer={peer_key} existing_link={existing_link_id or 'none'} reason=viable_link"
        )
        return
    if existing is not None and existing_link_id:
        link = existing.get("link")
        if link is not None:
            try:
                link.set_link_closed_callback(None)
            except Exception:
                pass
            try:
                link.teardown()
            except Exception:
                pass
        removed = remove_audio_link(existing_link_id)
        if removed is not None:
            emit_event(
                "group_audio_link_closed",
                {
                    "linkId": existing_link_id,
                    "peerPresenceHash": removed.get("peerPresenceHash") or "",
                    "peerDestinationHash": removed.get("peerDestinationHash") or "",
                    "incoming": removed.get("incoming") is True,
                    "reason": "announce_retry",
                },
            )
    if desired.get("retry_timer") is not None:
        _cancel_audio_link_retry_timer(peer_key)
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_retry_on_announce "
        f"peer={peer_key} existing_link={existing_link_id or 'none'}"
    )
    _schedule_audio_link_retry(peer_key, "announce", immediate=True)


def _sync_overlay_links() -> None:
    _maybe_prune_stale_overlay_links()
    _bootstrap_overlay_neighbors_if_degraded("sync")
    desired_outbound = set(_active_overlay_neighbors.keys())
    desired = desired_outbound | set(_inbound_overlay_neighbors.keys())
    for peer_hash in desired_outbound:
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        state = _ensure_overlay_link(
            peer_hash,
            await_path=False,
        )
        if state is None:
            # A sync pass can run while Reticulum is still resolving recall/path
            # state. Keep the fanout lease and let explicit closes or real send
            # failures decide whether the peer is dead.
            continue
    for peer_hash, link_id in list(_active_overlay_link_id_by_peer_hash.items()):
        if peer_hash in desired:
            continue
        state = get_overlay_link_state(link_id)
        if state is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_hash, None)
            continue
        _teardown_overlay_link_id(link_id, "pruned")
    for peer_hash in list(desired):
        _dedup_overlay_links_for_peer(peer_hash, reason="dedup_same_peer")
    for link_id, state in list(_overlay_links_by_id.items()):
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if not peer_hash:
            if (
                len(_inbound_overlay_neighbors) >= _OVERLAY_MAX_INBOUND_NEIGHBORS
                or len(_overlay_links_by_id) > (
                    _OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_INBOUND_NEIGHBORS
                )
            ):
                _teardown_overlay_link_id(link_id, "pruned_unknown_full")
            continue
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
        _note_overlay_peer_alive(origin_peer_hash, "presence")
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
    verbose_presence_log(
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
    reason = _overlay_teardown_reason_name(teardown_reason)
    now = time.time()
    state = remove_overlay_link(link_id)
    if state is None:
        return
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    verbose_presence_log(_overlay_close_debug_line(link_id, state, reason))
    state["established"] = False
    emit_overlay_link_state(
        link_id,
        state,
        reason,
        closed_by_reticulum=True,
    )
    if peer_hash and _overlay_timeout_close_should_keep_peer(state, reason, now):
        age = _overlay_link_recent_activity_age_seconds(state, now)
        _note_overlay_peer_alive(peer_hash, "recent_timeout_activity")
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_timeout_kept_peer "
            f"peer={peer_hash} recent_activity_age_ms={int((age or 0.0) * 1000.0)}"
        )
        return
    if peer_hash and _overlay_teardown_should_demote(reason):
        _demote_overlay_fanout_peer(peer_hash, f"link_closed:{reason}")


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
        _note_overlay_peer_alive(ph_reg, "remote_identified")
        _register_active_overlay_for_peer(ph_reg, link_id)
        _dedup_overlay_links_for_peer(ph_reg, preferred_link_id=link_id)


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
    state["last_rx_at"] = time.time()
    t = decoded.get("t")
    if isinstance(t, str) and t.startswith("PRESENCE_"):
        if _emit_presence_message(decoded, link_id):
            peer_hash = str(decoded.get("r") or "").strip().lower()
            if peer_hash:
                previous_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
                state["peerPresenceHash"] = peer_hash
                _note_overlay_peer_alive(peer_hash, "rx_presence")
                _register_active_overlay_for_peer(peer_hash, link_id)
                emit_reason = (
                    "rx_presence_identified"
                    if not previous_peer_hash and previous_peer_hash != peer_hash
                    else "rx_presence"
                )
                emit_overlay_link_state(link_id, state, emit_reason)
                _dedup_overlay_links_for_peer(peer_hash, preferred_link_id=link_id)
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
    with _state_lock:
        return _qchat_file_link_ids_by_object.get(id(link))


def get_qchat_file_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        return _qchat_file_links_by_id.get(link_id)


def remove_qchat_file_link(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        state = _qchat_file_links_by_id.pop(link_id, None)
        if state is not None:
            link = state.get("link")
            if link is not None:
                _qchat_file_link_ids_by_object.pop(id(link), None)
                _incoming_unified_peer_hash_by_object.pop(id(link), None)
            peer_hash = state.get("peerPresenceHash")
            if isinstance(peer_hash, str):
                existing = _outgoing_qchat_file_link_id_by_peer_hash.get(peer_hash)
                if existing == link_id:
                    _outgoing_qchat_file_link_id_by_peer_hash.pop(peer_hash, None)
    if state is None:
        return None
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
        if state.get("qchat_file_chunk_completed") is True:
            return
        transfer_id = str(state.get("transferId") or "")
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        with _state_lock:
            receive_pending = _qchat_file_accepts_by_peer.get(peer_hash)
            send_pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
        if receive_pending is not None and str(receive_pending.get("transferId") or "") == transfer_id:
            return
        if send_pending is not None:
            return
        if state.get("incoming") is not True and int(state.get("open_attempts") or 0) < _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS:
            transfer_id_retry = transfer_id
            peer_hash_retry = peer_hash

            def retry() -> None:
                if not _enqueue_scheduler_task(
                    "file-transfer",
                    "qchat-file-closed-retry",
                    _run_qchat_file_open_task,
                    state,
                ):
                    _qchat_file_emit(
                        "failed",
                        {
                            "transferId": transfer_id_retry,
                            "peerPresenceHash": peer_hash_retry,
                            "fileName": state.get("fileName") or "",
                            "reason": "file_link_retry_queue_full",
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
        if transfer_id:
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
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
        _enqueue_scheduler_task(
            "file-transfer",
            "qchat-file-open-retry",
            _run_qchat_file_open_task,
            state,
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
    _enqueue_scheduler_task(
        "file-transfer",
        "qchat-file-open",
        _run_qchat_file_open_task,
        state,
    )


def _run_qchat_file_open_task(state: Dict[str, Any]) -> None:
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
    if decoded.get("type") == "QCHAT_FILE_CHUNK_ACK":
        try:
            chunk_index = int(decoded.get("chunkIndex"))
        except Exception:
            return
        transfer_id = str(decoded.get("transferId") or "").strip()
        if transfer_id and transfer_id != str(state.get("transferId") or ""):
            return
        root = state.get("send_root") if isinstance(state.get("send_root"), dict) else state
        active = root.get("active_chunks") if isinstance(root, dict) else None
        if not isinstance(active, dict):
            return
        chunk = active.get(chunk_index)
        if not isinstance(chunk, dict):
            return
        chunk_size = int(chunk.get("size") or decoded.get("chunkSize") or 0)
        transfer_complete = _qchat_file_mark_chunk_sent(root, chunk_index, chunk_size)
        if transfer_complete:
            _qchat_file_close_success_link_after_grace(link, state)
            return
        state["resource_started"] = False
        _enqueue_scheduler_task(
            "file-transfer",
            "qchat-file-next-chunk-ack",
            _start_qchat_file_resource_for_state,
            state,
        )
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


def _qchat_file_mark_chunk_sent(state: Dict[str, Any], chunk_index: int, chunk_size: int) -> bool:
    active = state.setdefault("active_chunks", {})
    if isinstance(active, dict):
        chunk = active.get(chunk_index)
        if isinstance(chunk, dict):
            timer = chunk.pop("ack_timeout_timer", None)
            if timer is not None:
                try:
                    timer.cancel()
                except Exception:
                    pass
        active.pop(chunk_index, None)
    completed = state.setdefault("completed_chunks", set())
    if isinstance(completed, set) and chunk_index not in completed:
        completed.add(chunk_index)
        state["sent_bytes"] = int(state.get("sent_bytes") or 0) + int(chunk_size)
    _qchat_file_update_sent_progress(state)
    if int(state.get("sent_bytes") or 0) >= int(state.get("size") or 0):
        if state.get("completed") is True:
            return True
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
        return True
    return False


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


def _send_qchat_file_chunk_ack(link, transfer_id: str, chunk_index: int, chunk_size: int) -> bool:
    if link is None:
        return False
    try:
        return bool(
            _send_packet_on_link(
                link,
                json.dumps(
                    {
                        "type": "QCHAT_FILE_CHUNK_ACK",
                        "transferId": transfer_id,
                        "chunkIndex": chunk_index,
                        "chunkSize": chunk_size,
                    },
                    separators=(",", ":"),
                ).encode("utf-8"),
                (
                    "target=qchat-file-reticulum chunk_ack "
                    f"transfer={transfer_id} chunk={chunk_index}"
                ),
            )
        )
    except Exception as exc:
        log(
            "[presence_bridge] qchat file chunk ack failed "
            f"transfer={transfer_id} chunk={chunk_index}: {exc}"
        )
        return False


def _qchat_file_close_success_link_after_grace(link, state: Dict[str, Any]) -> None:
    state["completed"] = True
    link_id_done = get_qchat_file_link_id(link)
    if link_id_done:
        remove_qchat_file_link(link_id_done)

    def close_link() -> None:
        try:
            if link is not None:
                link.teardown()
        except Exception:
            pass

    timer = threading.Timer(_QCHAT_FILE_SUCCESS_LINK_CLOSE_GRACE_SECONDS, close_link)
    timer.daemon = True
    timer.start()


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
            _qchat_file_close_success_link_after_grace(link, state)
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
            active = root.setdefault("active_chunks", {})
            if isinstance(active, dict) and chunk_index in active:
                active[chunk_index]["progress"] = 1.0
                def ack_timeout() -> None:
                    current_active = root.get("active_chunks")
                    if not isinstance(current_active, dict) or chunk_index not in current_active:
                        return
                    if root.get("completed") is True or state.get("completed") is True:
                        return
                    _qchat_file_emit(
                        "failed",
                        {
                            "transferId": transfer_id,
                            "peerPresenceHash": peer_hash,
                            "fileName": file_name,
                            "size": size,
                            "reason": "chunk_ack_timeout",
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

                timer = threading.Timer(_QCHAT_FILE_CHUNK_ACK_TIMEOUT_SECONDS, ack_timeout)
                timer.daemon = True
                active[chunk_index]["ack_timeout_timer"] = timer
                timer.start()
            state["resource_send_complete"] = True
            _qchat_file_update_sent_progress(root)
            return
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
            return

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
    _qchat_file_update_sent_progress(root)
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
        state["qchat_file_chunk_completed"] = False
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
                state["resource_started"] = False
                state["qchat_file_chunk_completed"] = True
            if not done:
                if not _send_qchat_file_chunk_ack(link, transfer_id, chunk_index, chunk_size):
                    if state is not None:
                        state["completed"] = True
                    _qchat_file_emit(
                        "failed",
                        {
                            "transferId": transfer_id,
                            "peerPresenceHash": peer_hash,
                            "reason": "chunk_ack_send_failed",
                            "chunkIndex": chunk_index,
                        },
                    )
                return
            part_path = save_path + ".part"
            actual_hash = _sha256_file_hex(part_path)
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
            os.replace(part_path, save_path)
            if not _send_qchat_file_chunk_ack(link, transfer_id, chunk_index, chunk_size):
                if state is not None:
                    state["completed"] = True
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "reason": "chunk_ack_send_failed",
                        "chunkIndex": chunk_index,
                    },
                )
                return
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
    if not _overlay_link_is_current(link_id, link):
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
    if not _overlay_link_is_current(link_id, link):
        return
    emit_overlay_link_state(link_id, state, "established")
    ph_out = str(state.get("peerPresenceHash") or "").strip().lower()
    if ph_out and _valid_presence_destination_hash_hex(ph_out):
        _note_overlay_peer_alive(ph_out, "link_established")
        _register_active_overlay_for_peer(ph_out, link_id)
    if not _overlay_link_is_current(link_id, link):
        return
    _flush_overlay_link_pending(link_id)


def _send_wire_to_overlay_peer(
    peer_hash: str, wire_bytes: bytes, traffic: str, queue_if_pending: bool = True
) -> bool:
    state = _ensure_overlay_link(
        peer_hash,
        await_path=False,
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
            now = time.time()
            state["last_activity_at"] = now
            state["last_send_ok_at"] = now
        else:
            _queue_overlay_packet(state, traffic, wire_bytes)
            emit_overlay_link_state(get_overlay_link_id(link) or "", state, traffic)
            return False
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
        f"at={_log_clock_time()} "
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
        should_announce = _destination is not None and _rns_auth_announced
    if not should_announce:
        return
    def run() -> None:
        global _last_no_verified_peers_announce_at
        try:
            announce_local_destination(
                f"periodic interval_sec={RNS_ANNOUNCE_INTERVAL_SEC}"
            )
            _last_no_verified_peers_announce_at = time.time()
        except Exception as exc:
            log(f"[presence_bridge] rns announce periodic failed: {exc}")
    _enqueue_scheduler_task("control-send", "periodic-announce", run)
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
            verbose_presence_log(
                f"[presence_bridge] target=presence-reticulum send_failed peer={peer_hash}"
            )
        else:
            st["last_send_ok"] = now
            verbose_presence_log(
                f"[presence_bridge] target=presence-reticulum sent_presence peer={peer_hash}"
            )
    except Exception as exc:
        if peer_hash in _peer_lifecycle:
            _peer_lifecycle[peer_hash]["last_send_ok"] = None
        verbose_presence_log(
            f"[presence_bridge] target=presence-reticulum send_exception peer={peer_hash}: {exc}"
        )


def make_group_audio_wire(room_id: str, raw_audio: bytes) -> bytes:
    if _destination is None:
        raise RuntimeError("Local destination not initialised")
    room_bytes = str(room_id or "").encode("utf-8")
    sender_hash = bytes(_destination.hash)
    payload = bytes(raw_audio or b"")
    if (
        not room_bytes
        or len(room_bytes) > AUDIO_MAX_ROOM_ID_LEN
        or len(sender_hash) > AUDIO_MAX_HASH_LEN
        or len(payload) > AUDIO_MAX_PAYLOAD
    ):
        raise ValueError("field too large")
    return (
        _GROUP_AUDIO_BINARY_MAGIC
        + bytes(
            (
                _GROUP_AUDIO_BINARY_VERSION,
                len(room_bytes),
                len(sender_hash),
            )
        )
        + len(payload).to_bytes(2, "big")
        + room_bytes
        + sender_hash
        + payload
    )


def _decode_group_audio_wire(data: bytes) -> Optional[Tuple[str, str, bytes]]:
    if not isinstance(data, (bytes, bytearray)):
        return None
    wire = bytes(data)
    if len(wire) < _GROUP_AUDIO_BINARY_HEADER_BYTES:
        return None
    if wire[:4] != _GROUP_AUDIO_BINARY_MAGIC:
        return None
    if wire[4] != _GROUP_AUDIO_BINARY_VERSION:
        return None
    room_len = wire[5]
    sender_len = wire[6]
    payload_len = int.from_bytes(wire[7:9], "big")
    if (
        room_len == 0
        or room_len > AUDIO_MAX_ROOM_ID_LEN
        or sender_len == 0
        or sender_len > AUDIO_MAX_HASH_LEN
        or payload_len > AUDIO_MAX_PAYLOAD
    ):
        return None
    expected_len = _GROUP_AUDIO_BINARY_HEADER_BYTES + room_len + sender_len + payload_len
    if len(wire) != expected_len:
        return None
    offset = _GROUP_AUDIO_BINARY_HEADER_BYTES
    try:
        room_id = wire[offset : offset + room_len].decode("utf-8")
    except Exception:
        return None
    offset += room_len
    sender_hex = wire[offset : offset + sender_len].hex()
    offset += sender_len
    return room_id, sender_hex, bytes(wire[offset : offset + payload_len])


def get_audio_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        return _audio_links_by_id.get(link_id)


def get_audio_link_id(link: Any) -> Optional[str]:
    with _state_lock:
        return _audio_link_ids_by_object.get(id(link))


def _ensure_audio_link_lifecycle_fields(state: Dict[str, Any]) -> Dict[str, Any]:
    if "send_lock" not in state:
        state["send_lock"] = threading.RLock()
    if "generation" not in state:
        state["generation"] = 0
    if "closing" not in state:
        state["closing"] = False
    return state


def _audio_link_activity_ts(state: Dict[str, Any]) -> float:
    best = 0.0
    for key in ("last_rx_at", "last_send_ok_at", "last_activity_at", "established_at", "created_at"):
        value = state.get(key)
        if isinstance(value, (int, float)):
            best = max(best, float(value))
    return best


def _audio_link_pick_keep(
    peer_key: str,
    link_id_a: str,
    state_a: Dict[str, Any],
    link_id_b: str,
    state_b: Dict[str, Any],
) -> tuple[str, str]:
    est_a = state_a.get("established") is True
    est_b = state_b.get("established") is True
    if est_a and not est_b:
        return link_id_a, link_id_b
    if est_b and not est_a:
        return link_id_b, link_id_a
    activity_a = _audio_link_activity_ts(state_a)
    activity_b = _audio_link_activity_ts(state_b)
    if abs(activity_a - activity_b) > 0.001:
        return (link_id_a, link_id_b) if activity_a > activity_b else (link_id_b, link_id_a)
    incoming_a = state_a.get("incoming") is True
    incoming_b = state_b.get("incoming") is True
    if incoming_a != incoming_b:
        local_hex = _local_presence_hash_hex()
        if local_hex and _valid_presence_destination_hash_hex(peer_key):
            prefer_incoming = local_hex > peer_key
            if incoming_a == prefer_incoming:
                return link_id_a, link_id_b
            return link_id_b, link_id_a
    created_a = float(state_a.get("created_at") or 0.0)
    created_b = float(state_b.get("created_at") or 0.0)
    if created_a != created_b:
        return (link_id_a, link_id_b) if created_a < created_b else (link_id_b, link_id_a)
    return (link_id_a, link_id_b) if link_id_a < link_id_b else (link_id_b, link_id_a)


def _teardown_audio_link_id(link_id: str, reason: str) -> None:
    state = get_audio_link_state(link_id)
    link = state.get("link") if state is not None else None
    if link is not None:
        try:
            link.set_link_closed_callback(None)
        except Exception:
            pass
        try:
            link.teardown()
        except Exception:
            pass
    emit_audio_link_closed(link_id, reason)


def _register_active_audio_for_peer(peer_key: str, link_id: str) -> Optional[Dict[str, Any]]:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return None
    lose_id = ""
    keep_id = link_id
    keep_state: Optional[Dict[str, Any]] = None
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is None:
            return None
        _ensure_audio_link_lifecycle_fields(state)
        state["peerPresenceHash"] = peer_key
        if not state.get("peerDestinationHash"):
            state["peerDestinationHash"] = peer_key
        existing_id = _active_audio_link_id_by_peer_hash.get(peer_key)
        if existing_id == link_id:
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            return state
        if not existing_id:
            _active_audio_link_id_by_peer_hash[peer_key] = link_id
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            return state
        existing = _audio_links_by_id.get(existing_id)
        if existing is None:
            _active_audio_link_id_by_peer_hash[peer_key] = link_id
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            return state
        keep_id, lose_id = _audio_link_pick_keep(peer_key, existing_id, existing, link_id, state)
        _active_audio_link_id_by_peer_hash[peer_key] = keep_id
        _outgoing_audio_link_id_by_peer_hash[peer_key] = keep_id
        keep_state = _audio_links_by_id.get(keep_id)
    if lose_id and lose_id != keep_id:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_duplicate_teardown "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        _teardown_audio_link_id(lose_id, "dedup_same_peer")
    return keep_state


def _canonical_audio_link_id_for_peer(peer_key: str) -> str:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return ""
    with _state_lock:
        active = _active_audio_link_id_by_peer_hash.get(peer_key) or ""
        if active and active in _audio_links_by_id:
            return active
        outgoing = _outgoing_audio_link_id_by_peer_hash.get(peer_key) or ""
        if outgoing and outgoing in _audio_links_by_id:
            _active_audio_link_id_by_peer_hash[peer_key] = outgoing
            return outgoing
    return ""


def _snapshot_audio_link_for_send(
    link_id: str,
    peer_key_hint: str = "",
) -> Optional[Dict[str, Any]]:
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        peer_key_hint = str(peer_key_hint or "").strip().lower()
        if state is None:
            canonical_id = _active_audio_link_id_by_peer_hash.get(peer_key_hint) if peer_key_hint else ""
            if not canonical_id:
                canonical_id = _outgoing_audio_link_id_by_peer_hash.get(peer_key_hint) if peer_key_hint else ""
            if not canonical_id:
                return None
            state = _audio_links_by_id.get(canonical_id)
            if state is None:
                return None
            link_id = canonical_id
        _ensure_audio_link_lifecycle_fields(state)
        if state.get("closing") is True:
            return None
        peer_key = str(state.get("peerPresenceHash") or peer_key_hint).strip().lower()
        canonical_id = _active_audio_link_id_by_peer_hash.get(peer_key) if peer_key else ""
        if canonical_id and canonical_id != link_id:
            canonical_state = _audio_links_by_id.get(canonical_id)
            if canonical_state is not None and canonical_state.get("closing") is not True:
                state = canonical_state
                link_id = canonical_id
                _ensure_audio_link_lifecycle_fields(state)
        if state.get("established") is not True:
            return {
                "ready": False,
                "linkId": link_id,
                "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                "reason": "audio_link_not_ready",
            }
        link = state.get("link")
        if link is None:
            return None
        return {
            "ready": True,
            "linkId": link_id,
            "link": link,
            "sendLock": state.get("send_lock"),
            "generation": int(state.get("generation") or 0),
            "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
            "peerDestinationHash": str(state.get("peerDestinationHash") or ""),
            "incoming": state.get("incoming") is True,
        }


def _audio_link_generation_matches(link_id: str, generation: int) -> bool:
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is None or state.get("closing") is True:
            return False
        return int(state.get("generation") or 0) == int(generation)


def remove_audio_link(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        state = _audio_links_by_id.pop(link_id, None)
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
            state["closing"] = True
            state["generation"] = int(state.get("generation") or 0) + 1
            link = state.get("link")
            if link is not None:
                _audio_link_ids_by_object.pop(id(link), None)
            peer_hash = state.get("peerPresenceHash")
            if isinstance(peer_hash, str):
                existing = _outgoing_audio_link_id_by_peer_hash.get(peer_hash)
                if existing == link_id:
                    _outgoing_audio_link_id_by_peer_hash.pop(peer_hash, None)
                active = _active_audio_link_id_by_peer_hash.get(peer_hash)
                if active == link_id:
                    _active_audio_link_id_by_peer_hash.pop(peer_hash, None)
    if state is None:
        return None
    timer = state.pop("establish_timeout_timer", None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass
    return state


def _get_audio_link_desired_state(peer_key: str) -> Dict[str, Any]:
    with _state_lock:
        state = _audio_link_desired_by_peer_hash.get(peer_key)
        if state is not None:
            return state
        state = {
            "desired": True,
            "attempts": 0,
            "retry_delay": _AUDIO_LINK_RETRY_MIN_SECONDS,
            "retry_timer": None,
            "last_open_attempt_at": None,
            "last_failure_reason": "",
        }
        _audio_link_desired_by_peer_hash[peer_key] = state
        return state


def _cancel_audio_link_retry_timer(peer_key: str) -> None:
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
        if desired is None:
            return
        timer = desired.get("retry_timer")
        desired["retry_timer"] = None
    if desired is None:
        return
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _set_audio_link_desired(peer_key: str, desired: bool) -> Dict[str, Any]:
    state = _get_audio_link_desired_state(peer_key)
    with _state_lock:
        state["desired"] = desired
    if desired:
        return state
    _cancel_audio_link_retry_timer(peer_key)
    return state


def _has_viable_audio_link_for_peer(peer_key: str, excluding_link_id: str = "") -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        for candidate_link_id, state in list(_audio_links_by_id.items()):
            if excluding_link_id and candidate_link_id == excluding_link_id:
                continue
            if str(state.get("peerPresenceHash") or "").strip().lower() != peer_key:
                continue
            link = state.get("link")
            if link is None or state.get("closing") is True:
                continue
            if state.get("established") is True:
                return True
            created_at = state.get("created_at")
            if isinstance(created_at, (int, float)) and (
                time.time() - float(created_at)
            ) < _AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS:
                return True
    return False


def _best_viable_audio_link_id_for_peer(peer_key: str) -> str:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return ""
    best_link_id = ""
    best_state: Optional[Dict[str, Any]] = None
    now = time.time()
    with _state_lock:
        for candidate_link_id, state in list(_audio_links_by_id.items()):
            if str(state.get("peerPresenceHash") or "").strip().lower() != peer_key:
                continue
            if state.get("closing") is True or state.get("link") is None:
                continue
            established = state.get("established") is True
            created_at = state.get("created_at")
            pending_recent = isinstance(created_at, (int, float)) and (
                now - float(created_at)
            ) < _AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS
            if not established and not pending_recent:
                continue
            if not best_link_id:
                best_link_id = candidate_link_id
                best_state = state
                continue
            if best_state is None:
                best_link_id = candidate_link_id
                best_state = state
                continue
            keep_id, _lose_id = _audio_link_pick_keep(
                peer_key,
                best_link_id,
                best_state,
                candidate_link_id,
                state,
            )
            if keep_id == candidate_link_id:
                best_link_id = candidate_link_id
                best_state = state
        if best_link_id:
            _active_audio_link_id_by_peer_hash[peer_key] = best_link_id
            _outgoing_audio_link_id_by_peer_hash[peer_key] = best_link_id
    return best_link_id


def _schedule_audio_link_retry(peer_key: str, reason: str, immediate: bool = False) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
    if desired is None or desired.get("desired") is not True:
        return
    if _has_viable_audio_link_for_peer(peer_key):
        return
    if desired.get("retry_timer") is not None:
        return
    delay = 0.0 if immediate else float(
        desired.get("retry_delay") or _AUDIO_LINK_RETRY_MIN_SECONDS
    )
    with _state_lock:
        desired["last_failure_reason"] = reason

    def retry() -> None:
        with _state_lock:
            desired_state = _audio_link_desired_by_peer_hash.get(peer_key)
        if desired_state is None:
            return
        with _state_lock:
            desired_state["retry_timer"] = None
        if desired_state.get("desired") is not True:
            return
        if _has_viable_audio_link_for_peer(peer_key):
            return
        _enqueue_scheduler_task(
            "link-management",
            f"audio-link-retry:{reason}",
            _open_group_audio_link_for_peer,
            peer_key,
            retry_reason=reason,
        )

    timer = threading.Timer(delay, retry)
    timer.daemon = True
    with _state_lock:
        desired["retry_timer"] = timer
    timer.start()
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_retry_scheduled "
        f"peer={peer_key} reason={reason} delay={delay:.2f}"
    )


def _schedule_audio_link_establish_timeout(link_id: str) -> None:
    state = get_audio_link_state(link_id)
    if state is None or state.get("incoming") is True:
        return

    def fire() -> None:
        _enqueue_scheduler_task(
            "link-management",
            "audio-link-establish-timeout",
            _handle_audio_link_establish_timeout,
            link_id,
        )

    timer = threading.Timer(_AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS, fire)
    timer.daemon = True
    with _state_lock:
        state["establish_timeout_timer"] = timer
    timer.start()


def _handle_audio_link_establish_timeout(link_id: str) -> None:
    current = get_audio_link_state(link_id)
    if current is None or current.get("established") is True:
        return
    peer_key = str(current.get("peerPresenceHash") or "").strip().lower()
    link = current.get("link")
    if link is not None:
        try:
            link.set_link_closed_callback(None)
        except Exception:
            pass
        try:
            link.teardown()
        except Exception:
            pass
    removed = remove_audio_link(link_id)
    if removed is None:
        return
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_establish_timeout "
        f"peer={peer_key} link={link_id}"
    )
    emit_event(
        "group_audio_link_closed",
        {
            "linkId": link_id,
            "peerPresenceHash": removed.get("peerPresenceHash") or "",
            "peerDestinationHash": removed.get("peerDestinationHash") or "",
            "incoming": removed.get("incoming") is True,
            "reason": "establish_timeout",
        },
    )
    _schedule_audio_link_retry(peer_key, "establish_timeout")


def _open_group_audio_link_for_peer(
    peer_key: str,
    *,
    retry_reason: str = "open",
) -> Tuple[bool, Dict[str, Any], str]:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False, {"code": "missing_peer_presence_hash"}, "Missing peerPresenceHash"
    if _destination is None:
        return False, {"code": "bridge_not_started"}, "Bridge not started"
    desired = _set_audio_link_desired(peer_key, True)
    with _state_lock:
        existing_link_id = (
            _active_audio_link_id_by_peer_hash.get(peer_key)
            or _outgoing_audio_link_id_by_peer_hash.get(peer_key)
        )
    if existing_link_id:
        existing = get_audio_link_state(existing_link_id)
        if existing is not None:
            return True, {
                "linkId": existing_link_id,
                "established": existing.get("established") is True,
            }, ""
        with _state_lock:
            _outgoing_audio_link_id_by_peer_hash.pop(peer_key, None)
            _active_audio_link_id_by_peer_hash.pop(peer_key, None)
    viable_link_id = _best_viable_audio_link_id_for_peer(peer_key)
    if viable_link_id:
        existing = get_audio_link_state(viable_link_id)
        return True, {
            "linkId": viable_link_id,
            "established": existing.get("established") is True if existing is not None else False,
        }, ""
    peer_identity = _get_group_audio_peer_identity(peer_key)
    if peer_identity is None:
        return False, {"code": "unknown_peer_presence_hash"}, "Unknown peer presence hash"
    try:
        outbound = build_outbound_destination(peer_identity)
        outbound_hash = destination_hash_hex(outbound.hash)
        if outbound_hash != peer_key:
            return False, {
                "code": "peer_hash_mismatch",
                "derived": outbound_hash,
            }, "Reticulum public key does not match destination hash"
        desired["attempts"] = int(desired.get("attempts") or 0) + 1
        desired["last_open_attempt_at"] = time.time()
        path_state, path_ready = _ensure_call_media_path(
            peer_key,
            outbound.hash,
            active_call=True,
            allow_wait=True,
            reason=f"open_link:{retry_reason}",
            await_seconds_override=_AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS,
        )
        if not path_ready:
            desired["retry_delay"] = min(
                _AUDIO_LINK_RETRY_MAX_SECONDS,
                max(
                    _AUDIO_LINK_RETRY_MIN_SECONDS,
                    float(desired.get("retry_delay") or _AUDIO_LINK_RETRY_MIN_SECONDS) * 2,
                ),
            )
            _schedule_audio_link_retry(peer_key, f"no_route:{path_state}")
            return False, {
                "code": "no_route",
                "pathState": path_state,
                "pathAwaitSeconds": _AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS,
            }, "No confirmed Reticulum path for group audio link"
        desired["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
        link_id = str(uuid.uuid4())
        link = RNS.Link(
            outbound,
            established_callback=on_outgoing_audio_link_established,
            closed_callback=on_audio_link_closed,
        )
        audio_state = {
            "link": link,
            "peerPresenceHash": peer_key,
            "peerDestinationHash": outbound_hash,
            "incoming": False,
            "established": False,
            "created_at": time.time(),
            "open_reason": retry_reason,
            "open_attempt": desired["attempts"],
        }
        _ensure_audio_link_lifecycle_fields(audio_state)
        with _state_lock:
            _audio_links_by_id[link_id] = audio_state
            _audio_link_ids_by_object[id(link)] = link_id
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            _active_audio_link_id_by_peer_hash[peer_key] = link_id
        _schedule_audio_link_establish_timeout(link_id)
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_opening "
            f"peer={peer_key} link={link_id} attempt={desired['attempts']} reason={retry_reason}"
        )
        return True, {"linkId": link_id, "established": False}, ""
    except Exception as exc:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_open_exception "
            f"peer={peer_key} reason={retry_reason} err={exc}\n{traceback.format_exc()}"
        )
        desired["retry_delay"] = min(
            _AUDIO_LINK_RETRY_MAX_SECONDS,
            max(
                _AUDIO_LINK_RETRY_MIN_SECONDS,
                float(desired.get("retry_delay") or _AUDIO_LINK_RETRY_MIN_SECONDS) * 2,
            ),
        )
        _schedule_audio_link_retry(peer_key, "open_exception")
        return False, {"code": "exception"}, str(exc)


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
    state = get_audio_link_state(link_id)
    peer_key = ""
    incoming = False
    if state is not None:
        peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
        incoming = state.get("incoming") is True
    teardown_reason = getattr(link, "teardown_reason", None)
    reason = str(teardown_reason) if teardown_reason is not None else "closed"
    emit_audio_link_closed(link_id, reason)
    if (
        not incoming
        and reason not in ("local_close", "peer_state_reset")
        and not _has_viable_audio_link_for_peer(peer_key)
    ):
        _schedule_audio_link_retry(peer_key, f"closed:{reason}")


def on_audio_link_remote_identified(link, identity) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    peer_hash = find_peer_hash_for_identity(identity)
    if peer_hash:
        with _state_lock:
            state["peerPresenceHash"] = peer_hash
            state["peerDestinationHash"] = peer_hash
        _register_active_audio_for_peer(peer_hash, link_id)
    emit_audio_link_established(link_id)


def on_audio_link_packet(message, packet) -> None:
    received_at_wall_ms = _now_wall_ms()
    callback_started_monotonic = time.monotonic()
    link = getattr(packet, "link", None)
    link_id = get_audio_link_id(link) if link is not None else None
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    probe = _audio_link_receive_probe_by_packet_id.pop(id(packet), None)
    if isinstance(probe, dict):
        stats = _get_audio_route_stats_for_link_id(
            link_id,
            incoming=state.get("incoming") is True,
        )
        if stats is not None:
            dispatch_mono = float(probe.get("callbackDispatchMonotonic") or 0.0)
            enter_mono = float(probe.get("receiveEnterMonotonic") or 0.0)
            if dispatch_mono > 0:
                dispatch_to_start_ms = (callback_started_monotonic - dispatch_mono) * 1000.0
                if dispatch_to_start_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-link-callback-start-delay",
                        link_id,
                        f"link={_short_route(link_id)} delay_ms={dispatch_to_start_ms:.3f} "
                        f"peer={_short_route(state.get('peerPresenceHash'))} "
                        f"dest={_short_route(state.get('peerDestinationHash'))}",
                    )
                _note_audio_route_bucketed_duration(
                    stats,
                    duration_ms=dispatch_to_start_ms,
                    max_key="linkCallbackDispatchToStartMsMax",
                    bucket_prefix="linkCallbackDispatchToStart",
                )
            if enter_mono > 0:
                receive_to_start_ms = (callback_started_monotonic - enter_mono) * 1000.0
                if receive_to_start_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-link-receive-to-callback-start-delay",
                        link_id,
                        f"link={_short_route(link_id)} delay_ms={receive_to_start_ms:.3f} "
                        f"peer={_short_route(state.get('peerPresenceHash'))} "
                        f"dest={_short_route(state.get('peerDestinationHash'))}",
                    )
                _note_audio_route_bucketed_duration(
                    stats,
                    duration_ms=receive_to_start_ms,
                    max_key="linkReceiveToCallbackStartMsMax",
                )
            _mark_audio_queue_state_dirty()
    decoded_audio = _decode_group_audio_wire(message)
    if decoded_audio is not None:
        room_id, sender_call_hash, raw_audio = decoded_audio
        if sender_call_hash:
            peer_presence_hash = _resolve_sender_peer_destination_hash(sender_call_hash)
            with _state_lock:
                state["peerDestinationHash"] = sender_call_hash
                if peer_presence_hash:
                    state["peerPresenceHash"] = peer_presence_hash
                state["last_rx_at"] = time.time()
                state["last_activity_at"] = state["last_rx_at"]
            if peer_presence_hash:
                _register_active_audio_for_peer(peer_presence_hash, link_id)
                canonical_id = _canonical_audio_link_id_for_peer(peer_presence_hash)
                if canonical_id and canonical_id != link_id:
                    return
        try:
            chunk = _encode_audio_batch_binary(
                [
                    (
                        link_id,
                        room_id,
                        str(state.get("peerPresenceHash") or ""),
                        str(state.get("peerDestinationHash") or ""),
                        received_at_wall_ms,
                        raw_audio,
                    )
                ]
            )
            fd4_ok = _emit_binary_audio(chunk)
            fd4_enqueued_at_wall_ms = _now_wall_ms()
            _note_audio_route_receive(
                "link",
                link_id,
                room_id,
                str(state.get("peerPresenceHash") or ""),
                str(state.get("peerDestinationHash") or sender_call_hash or ""),
                len(raw_audio),
                fd4_enqueued=fd4_ok,
                incoming=state.get("incoming") is True,
                received_at_wall_ms=received_at_wall_ms,
                fd4_enqueued_at_wall_ms=fd4_enqueued_at_wall_ms,
            )
        except Exception as exc:
            _note_audio_route_receive(
                "link",
                link_id,
                room_id,
                str(state.get("peerPresenceHash") or ""),
                str(state.get("peerDestinationHash") or sender_call_hash or ""),
                len(raw_audio),
                fd4_enqueued=False,
                incoming=state.get("incoming") is True,
                received_at_wall_ms=received_at_wall_ms,
            )
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=encode-to-parent-failed err={exc}")
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
            peer_presence_hash = _resolve_sender_peer_destination_hash(sender_call_hash)
            with _state_lock:
                state["peerDestinationHash"] = sender_call_hash
                if peer_presence_hash:
                    state["peerPresenceHash"] = peer_presence_hash
                state["last_rx_at"] = time.time()
                state["last_activity_at"] = state["last_rx_at"]
            if peer_presence_hash:
                _register_active_audio_for_peer(peer_presence_hash, link_id)
        _emit_call_bridge_message(
            decoded,
            str(state.get("peerPresenceHash") or ""),
            link_id,
        )
        return
    if decoded.get("t") != _GROUP_AUDIO_WIRE_TYPE:
        return
    log("[presence_bridge] ignored legacy json/base64 link audio payload")


def configure_audio_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_audio_link_closed)
    link.set_packet_callback(on_audio_link_packet)
    link.set_remote_identified_callback(on_audio_link_remote_identified)
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
        _audio_link_ids_by_object[id(link)] = link_id


def on_outgoing_audio_link_established(link) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    configure_audio_link(link, link_id)
    with _state_lock:
        _ensure_audio_link_lifecycle_fields(state)
        state["established"] = True
        state["established_at"] = time.time()
        timer = state.pop("establish_timeout_timer", None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass
    peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
    if peer_key:
        _register_active_audio_for_peer(peer_key, link_id)
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
    if desired is not None:
        _cancel_audio_link_retry_timer(peer_key)
        with _state_lock:
            desired["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
            desired["last_failure_reason"] = ""
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] audio link identify failed link={link_id}: {exc}")
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_established "
        f"peer={peer_key} link={link_id}"
    )
    emit_audio_link_established(link_id)


def _cancel_inbound_classify_timer(link_key: int) -> None:
    timer = _inbound_classify_timers.pop(link_key, None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _register_incoming_overlay_link(link, peer_hash: str = "", reason: str = "incoming") -> str:
    peer_key = str(peer_hash or "").strip().lower()
    if peer_key:
        if not _admit_overlay_peer_if_allowed(peer_key, f"inbound:{reason}", incoming=True):
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_inbound_rejected "
                f"peer={peer_key} reason={reason}"
            )
            try:
                link.teardown()
            except Exception:
                pass
            return ""
    elif not _overlay_unknown_inbound_allowed():
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_inbound_rejected "
            f"peer=unknown reason={reason} active={len(_inbound_overlay_neighbors)}"
        )
        try:
            link.teardown()
        except Exception:
            pass
        return ""
    link_id = str(uuid.uuid4())
    now = time.time()
    state = {
        "link": link,
        "peerPresenceHash": peer_key,
        "incoming": True,
        "established": True,
        "established_at": now,
        "created_at": now,
        "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
        "last_activity_at": now,
        "last_rx_at": None,
    }
    with _state_lock:
        _overlay_links_by_id[link_id] = state
    configure_overlay_link(link, link_id)
    if peer_key:
        _register_active_overlay_for_peer(peer_key, link_id)
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
    if _decode_group_audio_wire(message) is not None:
        link_id = str(uuid.uuid4())
        now = time.time()
        audio_state = {
            "link": link,
            "peerPresenceHash": "",
            "peerDestinationHash": "",
            "incoming": True,
            "established": True,
            "established_at": now,
            "created_at": now,
            "last_activity_at": now,
            "last_rx_at": now,
        }
        _ensure_audio_link_lifecycle_fields(audio_state)
        with _state_lock:
            _audio_links_by_id[link_id] = audio_state
        configure_audio_link(link, link_id)
        on_audio_link_packet(message, packet)
        return
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] inbound_link_first_packet non-json err={exc}")
        _register_incoming_overlay_link(link, reason="first_packet_non_json")
        return
    if not isinstance(decoded, dict):
        _register_incoming_overlay_link(link, reason="first_packet_non_object")
        return
    if decoded.get("t") in _AUDIO_LINK_WIRE_TYPES:
        link_id = str(uuid.uuid4())
        now = time.time()
        audio_state = {
            "link": link,
            "peerPresenceHash": "",
            "peerDestinationHash": "",
            "incoming": True,
            "established": True,
            "established_at": now,
            "created_at": now,
            "last_activity_at": now,
            "last_rx_at": now,
        }
        _ensure_audio_link_lifecycle_fields(audio_state)
        with _state_lock:
            _audio_links_by_id[link_id] = audio_state
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
    peer_hash = ""
    if isinstance(decoded.get("t"), str) and str(decoded.get("t")).startswith("PRESENCE_"):
        peer_hash = str(decoded.get("r") or "").strip().lower()
    link_id = _register_incoming_overlay_link(
        link,
        peer_hash if _valid_presence_destination_hash_hex(peer_hash) else "",
        "first_packet",
    )
    if link_id:
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
    received_at_wall_ms = _now_wall_ms()
    decoded_audio = _decode_group_audio_wire(data)
    if decoded_audio is not None:
        room_id, sender_dest, raw_audio = decoded_audio
        peer_presence_hash = _resolve_sender_peer_destination_hash(sender_dest)
        try:
            chunk = _encode_audio_batch_binary(
                [
                    (
                        "",
                        room_id,
                        peer_presence_hash,
                        sender_dest,
                        received_at_wall_ms,
                        raw_audio,
                    )
                ]
            )
            _note_call_media_inbound(peer_presence_hash, sender_dest)
            fd4_ok = _emit_binary_audio(chunk)
            fd4_enqueued_at_wall_ms = _now_wall_ms()
            _note_audio_route_receive(
                "packet",
                str(peer_presence_hash or sender_dest or ""),
                room_id,
                str(peer_presence_hash or ""),
                str(sender_dest or ""),
                len(raw_audio),
                fd4_enqueued=fd4_ok,
                received_at_wall_ms=received_at_wall_ms,
                fd4_enqueued_at_wall_ms=fd4_enqueued_at_wall_ms,
            )
        except Exception as exc:
            _note_audio_route_receive(
                "packet",
                str(peer_presence_hash or sender_dest or ""),
                room_id,
                str(peer_presence_hash or ""),
                str(sender_dest or ""),
                len(raw_audio),
                fd4_enqueued=False,
                received_at_wall_ms=received_at_wall_ms,
            )
            log(f"[presence_bridge] {_AUDIO_IPC_LOG} fd4=encode-to-parent-failed err={exc}")
        return
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
        log("[presence_bridge] ignored legacy json/base64 hub audio payload")
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
        install_rns_shared_rpc_failure_guard()
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
        ensure_rns_callback_scheduler_monitor_started()
        install_rns_shared_frame_probe()
        install_rns_transport_inbound_probe()
        install_rns_link_receive_probe()
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
        elif env_type == "PRESENCE_HEARTBEAT":
            if not _rns_auth_announced:
                announce_local_destination("authenticated_recovered_heartbeat")
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
        peer_hashes = _resolve_overlay_neighbor_hashes(established_only=True)
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
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum publish_fanout "
            f"peers={len(peer_hashes)} local_presence_hash={local_hex} "
            f"type={env_type} peer_addr={env_addr} "
            f"fanout_hashes={','.join(peer_hashes)}"
        )
        attempted_peer_hashes: Set[str] = set()
        sent_peer_hashes: list[str] = []
        demoted_peer_hashes: Set[str] = set()
        for peer_hash in list(peer_hashes):
            attempted_peer_hashes.add(peer_hash)
            if _send_wire_to_overlay_peer(
                peer_hash,
                wire_bytes,
                "presence_publish",
                queue_if_pending=False,
            ):
                sent_peer_hashes.append(peer_hash)
            else:
                if _demote_overlay_fanout_peer(peer_hash, "publish_no_link"):
                    demoted_peer_hashes.add(peer_hash)
        if demoted_peer_hashes:
            replacement_hashes = [
                h for h in _resolve_overlay_neighbor_hashes(established_only=True)
                if h not in attempted_peer_hashes and h not in demoted_peer_hashes
            ]
            if replacement_hashes:
                verbose_presence_log(
                    "[presence_bridge] target=presence-reticulum publish_fanout_replacements "
                    f"peers={len(replacement_hashes)} fanout_hashes={','.join(replacement_hashes)}"
                )
            for peer_hash in replacement_hashes:
                attempted_peer_hashes.add(peer_hash)
                if _send_wire_to_overlay_peer(
                    peer_hash,
                    wire_bytes,
                    "presence_publish_replacement",
                    queue_if_pending=False,
                ):
                    sent_peer_hashes.append(peer_hash)
                else:
                    _demote_overlay_fanout_peer(peer_hash, "publish_replacement_no_link")
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(sent_peer_hashes),
                "fanoutHashes": sent_peer_hashes,
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
        peer_hashes = _resolve_overlay_neighbor_hashes(
            exclude_hashes,
            established_only=True,
        )
        sent_peer_hashes: list[str] = []
        for peer_hash in peer_hashes:
            if _send_wire_to_overlay_peer(
                peer_hash,
                wire_bytes,
                "presence_forward",
                queue_if_pending=False,
            ):
                sent_peer_hashes.append(peer_hash)
            else:
                _demote_overlay_fanout_peer(peer_hash, "presence_forward_no_link")
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(sent_peer_hashes),
                "fanoutHashes": sent_peer_hashes,
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
    if not _overlay_peer_is_admitted(peer_key):
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
    if not _overlay_peer_is_admitted(peer_key):
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

    ok, resp_payload, error = _open_group_audio_link_for_peer(
        peer_hash.strip().lower(),
        retry_reason="command",
    )
    emit_resp(req_id, ok, payload=resp_payload, error=error or None)


def handle_close_group_audio_link(req_id: str, payload: Dict[str, Any]) -> None:
    link_id = str(payload.get("linkId") or "")
    close_reason = str(payload.get("reason") or "local_close")
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
    peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
    with _state_lock:
        is_current_outgoing = bool(
            peer_key and _outgoing_audio_link_id_by_peer_hash.get(peer_key) == link_id
        )
        is_current_active = bool(
            peer_key and _active_audio_link_id_by_peer_hash.get(peer_key) == link_id
        )
    is_duplicate_cleanup = (
        close_reason.startswith("duplicate-")
        or close_reason.startswith("superseded-")
        or close_reason.startswith("open-result-")
    )
    if is_duplicate_cleanup and is_current_active:
        emit_resp(req_id, True, payload={"suppressed": True, "reason": "canonical_link"})
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_close_suppressed "
            f"peer={peer_key} link={link_id} reason={close_reason} active=true"
        )
        return
    if is_current_outgoing:
        _set_audio_link_desired(peer_key, False)
    link = state.get("link")
    try:
        if link is not None:
            try:
                link.set_link_closed_callback(None)
            except Exception:
                pass
            link.teardown()
        emit_audio_link_closed(link_id, close_reason or "local_close")
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_reset_group_audio_peer_state(req_id: str, payload: Dict[str, Any]) -> None:
    peer_key = str(payload.get("peerPresenceHash") or "").strip().lower()
    if not peer_key:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return

    closed = 0
    _set_audio_link_desired(peer_key, False)
    with _state_lock:
        links_to_close = [
            (link_id, state.get("link"))
            for link_id, state in list(_audio_links_by_id.items())
            if str(state.get("peerPresenceHash") or "").strip().lower() == peer_key
        ]
    for link_id, link in links_to_close:
        try:
            if link is not None:
                try:
                    link.set_link_closed_callback(None)
                except Exception:
                    pass
                link.teardown()
        except Exception:
            pass
        emit_audio_link_closed(link_id, "peer_state_reset")
        closed += 1

    with _state_lock:
        _call_media_path_state.pop(peer_key, None)
        _peer_lifecycle.pop(peer_key, None)
    _mark_audio_queue_state_dirty()
    emit_resp(req_id, True, payload={"closedLinks": closed})


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
        with _state_lock:
            candidate = (
                _active_audio_link_id_by_peer_hash.get(peer_key)
                or _outgoing_audio_link_id_by_peer_hash.get(peer_key)
            )
        if candidate:
            state = get_audio_link_state(candidate)
            resolved_link_id = candidate
        if state is None:
            with _state_lock:
                candidates = list(_audio_links_by_id.items())
            for candidate_link_id, candidate_state in candidates:
                if str(candidate_state.get("peerPresenceHash") or "").strip().lower() == peer_key:
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
    elif action == "reset_group_audio_peer_state":
        handle_reset_group_audio_peer_state(req_id, payload)
    elif action == "warm_group_audio_path":
        handle_warm_group_audio_path(req_id, payload)
    elif action == "send_group_audio_link_heartbeat":
        handle_send_group_audio_link_heartbeat(req_id, payload)
    elif action == "clear_group_audio_diagnostics":
        room_id = str(payload.get("roomId") or "")
        cleared = _clear_audio_media_route_diagnostics(room_id)
        emit_resp(
            req_id,
            True,
            payload={
                "clearedMediaRouteDiagnostics": cleared,
                "roomId": room_id,
            },
        )
    elif action == "get_group_audio_data_plane_session":
        ok, session_payload, error = _ensure_audio_data_plane_server()
        if ok:
            emit_resp(req_id, True, payload=session_payload)
        else:
            emit_resp(req_id, False, payload={"code": "audio_data_plane_listen_failed"}, error=error)
    elif action == "configure_group_audio_data_plane_routes":
        route_count = _configure_audio_data_plane_routes(payload.get("routes"))
        emit_resp(req_id, True, payload={"routeCount": route_count})
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

        req_id = str(message.get("id") or "")
        action = str(message.get("action") or "")
        try:
            _cmd_queue_bounded.put_nowait(message)
            _notify_rns_work_available()
        except queue.Full:
            if req_id:
                emit_resp(
                    req_id,
                    False,
                    payload={"code": "bridge_command_queue_full", "action": action},
                    error=f"Reticulum bridge command queue is full: {action}",
                )
            else:
                emit_event(
                    "error",
                    {
                        "code": "bridge_command_queue_full",
                        "message": "Reticulum bridge command queue is full",
                        "action": action,
                    },
                )

    try:
        _cmd_queue_bounded.put_nowait(None)
    except queue.Full:
        pass
    _notify_rns_work_available()


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
    _start_scheduler_workers()
    audio_out_thread = threading.Thread(
        target=_audio_binary_out_writer_loop, name="reticulum-audio-out", daemon=True
    )
    audio_out_thread.start()
    audio_in_thread = threading.Thread(
        target=_audio_fd3_reader_loop, name="reticulum-audio-in", daemon=True
    )
    audio_in_thread.start()
    rns_thread = threading.Thread(
        target=_rns_executor_loop, name="reticulum-rns", daemon=False
    )
    rns_thread.start()

    stdin_thread = threading.Thread(target=stdin_loop, daemon=True)
    stdin_thread.start()
    stdin_thread.join()
    _shutdown.set()
    _cmd_queue_bounded.put(None)
    _notify_rns_work_available()
    rns_thread.join(timeout=60.0)
    _stop_scheduler_workers()
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

#!/usr/bin/env python3

import argparse
import base64
import hashlib
import json
import math
import os
import select
import selectors
from collections import deque
import queue
import secrets
import shutil
import socket
import statistics
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
from typing import IO, Any, Callable, Dict, List, Optional, Set, Tuple

import RNS
from RNS.vendor import umsgpack

_BRIDGE_RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
if _BRIDGE_RESOURCE_DIR not in sys.path:
    sys.path.insert(0, _BRIDGE_RESOURCE_DIR)
from qortalland_games import QortalLandGameManager, _b58decode, _b58encode, derive_qortal_address

APP_NAMESPACE = "qortal-hub-test2"
PRESENCE_ASPECT = "presence"
PRESENCE_VERSION = "v1-test2"
IDENTITY_FILENAME = "presence-bridge.identity"
disable_bootstrap = False

_state_lock = threading.RLock()
_reticulum = None
_identity = None
_destination = None
_announce_handler = None
_reticulum_config_dir = ""
# A shared-instance client does not own the authoritative Transport.path_table.
# Keep a very short cache for the uncommon local-miss/RPC-fallback path so
# high-frequency features (notably call media) never turn route checks into an
# RPC per packet.
_reticulum_path_availability_cache: Dict[str, Tuple[float, bool]] = {}
_reticulum_path_availability_cache_lock = threading.Lock()
_RETICULUM_PATH_POSITIVE_CACHE_SECONDS = 1.0
_RETICULUM_PATH_NEGATIVE_CACHE_SECONDS = 0.05
_known_peers: Dict[str, Any] = {}
_candidate_peers: Dict[str, Dict[str, Any]] = {}
_verified_overlay_peers: Dict[str, Dict[str, Any]] = {}
# Wallet-authenticated, expiring account -> Reticulum endpoint leases. Kept
# separate from transport peers because one installation can serve different
# Qortal accounts over time (or several active account sessions).
_account_endpoint_leases: Dict[str, Dict[str, Dict[str, Any]]] = {}
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
_recent_presence_message_ids: Dict[str, float] = {}
_RECENT_PRESENCE_MESSAGE_ID_TTL_SECONDS = 2 * 60.0
_RECENT_PRESENCE_MESSAGE_ID_LIMIT = 4096
_last_presence_wire: Optional[bytes] = None
_last_presence_announce_wire: Optional[bytes] = None
_last_presence_announce_id = ""
_last_transport_state: Optional[Dict[str, Any]] = None
_last_overlay_zero_fanout_recovery_at: float = 0.0
_transport_monitor_thread: Optional[threading.Thread] = None
_rns_callback_scheduler_monitor_thread: Optional[threading.Thread] = None
_audio_rtt_monitor_thread: Optional[threading.Thread] = None
_MAX_ENCRYPTED_WIRE_BYTES = int(getattr(RNS.Packet, "ENCRYPTED_MDU", RNS.Packet.MDU))
# Grep logs for this string to confirm the rebuilt script is running (sync with GC_RETICULUM_WIRE_BUILD_MARKER in group-call-wire-reticulum.ts).
PRESENCE_BRIDGE_BUILD = "wire404-multidevice-size-safe-v1"

_GROUP_AUDIO_CONTROL_CHANNEL_VERSION = 1
_GROUP_AUDIO_CONTROL_CHANNEL_DATA = 1
_GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE = "GCC1"
_GROUP_AUDIO_CONTROL_CAPABILITY_HELLO = "H"
_GROUP_AUDIO_CONTROL_CAPABILITY_ACK = "A"
# Outbound signaling is fragmented here against the live Channel MDU. Keep
# these defensive bounds aligned with GroupCallManager's receive limits.
_GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENTS = 1024
_GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENT_CHARS = 384
_GROUP_AUDIO_CONTROL_CHANNEL_MAX_BYTES = 96 * 1024
_group_audio_control_pending_dedupe: set[str] = set()


class GroupAudioControlChannelMessage(RNS.MessageBase):
    """Small reliable control message carried by the audio link's RNS Channel."""

    MSGTYPE = 0x5143

    def __init__(self, kind: int = 0, data: bytes = b""):
        self.kind = int(kind)
        self.data = bytes(data or b"")

    def pack(self) -> bytes:
        return bytes((_GROUP_AUDIO_CONTROL_CHANNEL_VERSION, self.kind)) + self.data

    def unpack(self, raw: bytes):
        value = bytes(raw or b"")
        if len(value) < 2 or value[0] != _GROUP_AUDIO_CONTROL_CHANNEL_VERSION:
            raise ValueError("Unsupported group control channel message")
        self.kind = int(value[1])
        self.data = value[2:]

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
_OVERLAY_MAX_PINNED_CHAT_PEERS = 4
_OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS = _OVERLAY_MAX_OUTBOUND_NEIGHBORS
_OVERLAY_MIN_HEALTHY_FANOUT = 8
_OVERLAY_NEIGHBOR_GRACE_SECONDS = 90.0
_CANDIDATE_PROOF_WINDOW_SECONDS = 90.0
_CANDIDATE_FAILURE_LIMIT = 2
_OVERLAY_DEFAULT_HOPS = 4
_OVERLAY_LINK_PATH_REQUEST_COOLDOWN_SECONDS = 5.0
_OVERLAY_LINK_PATH_AWAIT_SECONDS = 2.0
_OVERLAY_LINK_CACHED_PATH_SETTLE_SECONDS = 1.5
_DIRECT_LINK_PATH_PROVEN_SECONDS = 30.0
_UNPROVEN_CACHED_PATH_NUDGE_COOLDOWN_SECONDS = 30.0
_UNESTABLISHED_LINK_PATH_REQUEST_COOLDOWN_SECONDS = 60.0
_UNESTABLISHED_LINK_HARD_REFRESH_FAILURES = 3
_UNESTABLISHED_LINK_HARD_REFRESH_COOLDOWN_SECONDS = 5 * 60.0
_OVERLAY_LINK_HARD_REFRESH_COOLDOWN_SECONDS = 20.0
_UNESTABLISHED_LINK_HARD_REFRESH_AWAIT_SECONDS = 2.0
_OVERLAY_LINK_FAILURE_SUPPRESS_LIMIT = 2
_OVERLAY_LINK_FAILURE_SUPPRESS_SECONDS = 5 * 60.0
_OVERLAY_LINK_FAILURE_SUPPRESS_MAX_SECONDS = 30 * 60.0
_OVERLAY_ZERO_FANOUT_RECOVERY_COOLDOWN_SECONDS = 15.0
_OVERLAY_REPLACE_UNUSABLE_ACTIVE_MIN_AGE_SECONDS = 2.0
_OVERLAY_LINK_CLOSE_RECENT_ACTIVITY_GRACE_SECONDS = 30.0
_OVERLAY_DIRECT_ACTIVITY_BACKFILL_SECONDS = 15 * 60.0
_OVERLAY_MAX_TOTAL_LINKS = (
    _OVERLAY_MAX_OUTBOUND_NEIGHBORS
    + _OVERLAY_MAX_INBOUND_NEIGHBORS
    + _OVERLAY_MAX_PINNED_CHAT_PEERS
    + 4
)
_OVERLAY_UNESTABLISHED_LINK_TIMEOUT_SECONDS = 60.0
_OVERLAY_PENDING_UNESTABLISHED_LIMIT = 4
_OVERLAY_ESTABLISHED_REPLAY_DELAY_SECONDS = 0.75
_OVERLAY_DUPLICATE_CLOSE_GRACE_SECONDS = 2.0
_OVERLAY_ANNOUNCE_RETRY_DEBOUNCE_SECONDS = 2.0
_OVERLAY_CLOSE_DIAGNOSTIC_WINDOW_SECONDS = 5 * 60.0
_OVERLAY_REPLAY_CLOSE_ASSOCIATION_SECONDS = 5.0
_PRESENCE_ANNOUNCE_APP_DATA_OPEN = b"presence"
_PRESENCE_ANNOUNCE_APP_DATA_FULL = b"presence-full"
_PEER_INBOUND_FULL_HINT_TTL_SECONDS = 2 * 60.0
_PRESENCE_PEER_SEND_TIMEOUT_SECONDS = 2.5
_AUDIO_LINK_PACKET_SEND_TIMEOUT_SECONDS = 1.5
_AUDIO_LINK_TEARDOWN_TIMEOUT_SECONDS = 1.5
_OVERLAY_LINK_TEARDOWN_TIMEOUT_SECONDS = 1.5
_LINK_PACKET_SEND_TIMEOUT_SECONDS = 2.5
_LINK_TEARDOWN_TIMEOUT_SECONDS = 1.5
_LINK_STATE_IDLE = "IDLE"
_LINK_STATE_PATH_WAIT = "PATH_WAIT"
_LINK_STATE_CONNECTING = "CONNECTING"
_LINK_STATE_ESTABLISHED = "ESTABLISHED"
_LINK_STATE_DEGRADED = "DEGRADED"
_LINK_STATE_CLOSING = "CLOSING"
_LINK_STATE_BACKOFF = "BACKOFF"
_LINK_STATE_DEAD = "DEAD"
_OVERLAY_RECONCILE_MAX_OPENS = 2
_OVERLAY_RECONCILE_MAX_CLOSES = 4
_OVERLAY_RECONCILE_MAX_DEDUPES = 4
_OVERLAY_RECONCILE_MAX_SECONDS = 0.050
_AUDIO_LINK_SEND_TIMEOUTS_BEFORE_TEARDOWN = 4
_AUDIO_LINK_SEND_TIMEOUT_RECENT_RX_GRACE_SECONDS = 10.0
_AUDIO_LINK_SEND_TIMEOUT_BACKOFF_SECONDS = 0.75
_PRESENCE_BRIDGE_VERBOSE_LOGS = (
    os.environ.get("QORTAL_PRESENCE_BRIDGE_VERBOSE_LOGS", "").strip().lower()
    in ("1", "true", "yes", "on")
)
_RNS_INTERNAL_TIMING_PROBES_ENABLED = (
    os.environ.get("QORTAL_RNS_SHARED_TIMING_LOGS", "").strip().lower()
    in ("1", "true", "yes", "on")
)
# Overlay ping/pong is the app-level liveness signal. Keep it faster than
# Reticulum's lower-level route purge so the app decides dead peers first.
_OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS = 25.0
_OVERLAY_TRANSPORT_MAINTENANCE_INTERVAL_SECONDS = 5.0
_OVERLAY_TRANSPORT_PING_INTERVAL_SECONDS = 5.0
_OVERLAY_HELLO_WIRE_TYPE = "OVERLAY_HELLO"
_OVERLAY_PING_WIRE_TYPE = "OVERLAY_PING"
_OVERLAY_PONG_WIRE_TYPE = "OVERLAY_PONG"
_OVERLAY_MIGRATION_COMMIT_WIRE_TYPE = "OVERLAY_MIGRATION_COMMIT"
_OVERLAY_MIGRATION_ACK_WIRE_TYPE = "OVERLAY_MIGRATION_ACK"
_OVERLAY_MIGRATION_FINALIZE_WIRE_TYPE = "OVERLAY_MIGRATION_FINALIZE"
_OVERLAY_ROUTE_MIGRATION_CAPABILITY = "route-rtt-v1"
_OVERLAY_ROUTE_MIGRATION_MARKER = "route-probe-v1"
_OVERLAY_TRANSPORT_WIRE_TYPES = {
    _OVERLAY_HELLO_WIRE_TYPE,
    _OVERLAY_PING_WIRE_TYPE,
    _OVERLAY_PONG_WIRE_TYPE,
    _OVERLAY_MIGRATION_COMMIT_WIRE_TYPE,
    _OVERLAY_MIGRATION_ACK_WIRE_TYPE,
    _OVERLAY_MIGRATION_FINALIZE_WIRE_TYPE,
}
_OVERLAY_ROUTE_MIGRATION_MIN_ACTIVE_SECONDS = 60.0
_OVERLAY_ROUTE_MIGRATION_COOLDOWN_SECONDS = 30 * 60.0
_OVERLAY_ROUTE_MIGRATION_ESTABLISH_TIMEOUT_SECONDS = 30.0
_OVERLAY_ROUTE_MIGRATION_PROBE_SAMPLES = 5
_OVERLAY_ROUTE_MIGRATION_MIN_SAMPLES = 4
_OVERLAY_ROUTE_MIGRATION_PROBE_TIMEOUT_SECONDS = 5.0
_OVERLAY_ROUTE_MIGRATION_RTT_RATIO = 0.80
_OVERLAY_ROUTE_MIGRATION_RTT_MIN_GAIN_MS = 20.0
_OVERLAY_ROUTE_MIGRATION_COMMIT_TIMEOUT_SECONDS = 3.0
_OVERLAY_ROUTE_MIGRATION_COMMIT_ATTEMPTS = 3
_OVERLAY_ROUTE_MIGRATION_MAX_CONCURRENT = 2
_OVERLAY_ROUTE_MIGRATION_CANDIDATE_MAX_AGE_SECONDS = 90.0
_CALL_RELAY_DEDUP_TTL_SECONDS = 90.0
_CALL_RELAY_DEDUP_MAX = 4096
_call_relay_dedup: Dict[str, float] = {}
_call_relay_dedup_last_log_at: float = 0.0
_call_relay_dedup_suppressed_since_log: int = 0
_RETICULUM_CHAT_INBOUND_DEDUP_MAX = 8192
_RETICULUM_CHAT_IDENTITY_DEDUP_TTL_SECONDS = 35.0
_RETICULUM_CHAT_TYPING_DEDUP_TTL_SECONDS = 35.0
_reticulum_chat_inbound_dedup: Dict[str, float] = {}
_reticulum_chat_inbound_dedup_last_log_at: float = 0.0
_reticulum_chat_inbound_dedup_suppressed_since_log: int = 0
_QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS = 0.0
_QCHAT_FILE_LINK_PATH_WAIT_TIMEOUT_SECONDS = 45.0
_QCHAT_FILE_LINK_PATH_POLL_SECONDS = 1.0
_QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS = 4
_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS = 2.0
_QCHAT_FILE_OPEN_QUEUE_MAX_PER_PEER = 32
_QCHAT_FILE_OPEN_QUEUE_MAX_TOTAL = 256
_QCHAT_FILE_ACTIVE_OUTGOING_MAX_PER_PEER = 4
_QCHAT_FILE_CHAT_RESERVED_ACTIVE_PER_PEER = 1
_QCHAT_FILE_BULK_ACTIVE_MAX_PER_PEER = (
    _QCHAT_FILE_ACTIVE_OUTGOING_MAX_PER_PEER
    - _QCHAT_FILE_CHAT_RESERVED_ACTIVE_PER_PEER
)
_RESOURCE_SESSION_REQUEST_PATH = "/qortal/resource/v1"
_RESOURCE_SESSION_HELLO_TYPE = "RETICULUM_RESOURCE_SESSION_HELLO"
_RESOURCE_SESSION_READY_TYPE = "RETICULUM_RESOURCE_SESSION_READY"
_RESOURCE_SESSION_CANCEL_TYPE = "RETICULUM_RESOURCE_SESSION_CANCEL"
_RESOURCE_SESSION_ESTABLISH_TIMEOUT_SECONDS = 30.0
_RESOURCE_SESSION_REQUEST_TIMEOUT_SECONDS = 60.0
# Authorization is a local Electron/database decision and should normally take
# milliseconds. Bound a wedged provider quickly; receivers retain a longer
# compatibility deadline for older bridges that still use 30 seconds.
_RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS = 10.0
_RESOURCE_SESSION_PRIMARY_IDLE_TIMEOUT_SECONDS = 2 * 60.0
_RESOURCE_SESSION_OVERFLOW_IDLE_TIMEOUT_SECONDS = 30.0
# Providers must not expire an incoming session before its requester-side
# lease. Otherwise the requester can keep reusing a locally active Link after
# the provider has already discarded its matching state. Normal requester
# teardown still closes overflow sessions promptly on both ends.
_RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS = 3 * 60.0
# READY packets from older bridges did not advertise their provider lease and
# those bridges expired incoming sessions after 60 seconds. Close our side a
# little earlier when no lease is advertised so mixed-version peers cannot
# create a half-open reuse window during rollout.
_RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS = 60.0
_RESOURCE_SESSION_PROVIDER_IDLE_GUARD_SECONDS = 5.0
_RESOURCE_SESSION_PATH_WAIT_TIMEOUT_SECONDS = 30.0
_RESOURCE_SESSION_PATH_POLL_SECONDS = 1.0
_RESOURCE_SESSION_MAX_QUEUE_PER_LANE = 64
_RESOURCE_SESSION_MAX_QUEUE_TOTAL = 256
_RESOURCE_SESSION_FAST_CONCURRENCY = 1
# Reticulum serialises outgoing Resources on each Link. Use independent Links
# for real wire-level parallelism instead of dispatching several requests onto
# one Link where they would wait invisibly inside Reticulum.
_RESOURCE_SESSION_BULK_POOL_SIZE = 6
_RESOURCE_SESSION_BULK_CONCURRENCY = 1
# Five attachment ranges retain their existing parallelism across five bulk
# Links. The sixth bulk Link remains available for history or metadata so a
# large download cannot stall chat synchronization with the same peer.
_RESOURCE_SESSION_BULK_ATTACHMENT_CONCURRENCY_PER_PEER = 5
# Authorization is admitted separately so slow membership checks cannot occupy
# response capacity. The nested response ceilings preserve one slot for live
# events and two slots that attachment ranges cannot consume.
_RESOURCE_SESSION_PROVIDER_CONCURRENCY = 12
_RESOURCE_SESSION_PROVIDER_NON_LIVE_CONCURRENCY = 11
_RESOURCE_SESSION_PROVIDER_ATTACHMENT_CONCURRENCY = 10
_RESOURCE_SESSION_PROVIDER_METADATA_CONCURRENCY = 2
_RESOURCE_SESSION_PROVIDER_ACTIVE_MAX_PER_PEER = 10
_RESOURCE_SESSION_PROVIDER_ATTACHMENT_MAX_PER_PEER = 8
_RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX = 40
_RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX_PER_PEER = 8
_RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX = 24
_RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX_PER_PEER = 6
_RESOURCE_SESSION_PROVIDER_CAPACITY_WAIT_SECONDS = 15.0
# A requester can finish assembling a response just before the provider
# receives the final Resource proof and releases that Link. Allow exactly one
# next request to wait for that short hand-off instead of rejecting it as
# resource_session_busy. Link request handlers run on independent Reticulum
# threads, so this does not block packet processing or transfers on other
# Links. The bound remains short enough to expose a genuinely wedged Resource.
_RESOURCE_SESSION_PROVIDER_LINK_HANDOFF_WAIT_SECONDS = 5.0
_RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS = 2.0
_RESOURCE_SESSION_PROVIDER_CANCEL_TTL_SECONDS = 2 * 60.0
_RESOURCE_SESSION_PROVIDER_CANCEL_MAX = 4096
_RESOURCE_SESSION_AUTH_MAX_QUEUE_SECONDS = 90.0
_RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS = 15.0
_RESOURCE_SESSION_RESPONSE_STALL_TIMEOUT_SECONDS = 30.0
_RESOURCE_SESSION_FAILURE_BACKOFF_SECONDS = (2.0, 5.0, 15.0, 30.0, 60.0)
_RESOURCE_SESSION_FAILURE_RECORD_MAX = 4096
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
_overlay_transport_maintenance_thread: Optional[threading.Thread] = None
_last_no_verified_peers_announce_at: float = 0.0

_OVERLAY_GOOD_OUTBOUND_CACHE_FILENAME = "overlay-good-outbound-cache.json"
_OVERLAY_GOOD_OUTBOUND_CACHE_VERSION = 1
_OVERLAY_GOOD_OUTBOUND_CACHE_MAX_PEERS = 32
_OVERLAY_GOOD_OUTBOUND_CACHE_TTL_SECONDS = 2 * 60 * 60.0
_OVERLAY_GOOD_OUTBOUND_CACHE_WRITE_MIN_SECONDS = 30.0
_overlay_good_outbound_cache: Dict[str, Dict[str, Any]] = {}
_overlay_good_outbound_cache_lock = threading.RLock()
_overlay_good_outbound_cache_loaded = False
_overlay_good_outbound_cache_dirty = False
_overlay_good_outbound_cache_last_write_at = 0.0


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


def _reticulum_chat_digest_fingerprint(msg: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    if msg.get("t") != _RETICULUM_CHAT_WIRE_TYPE or msg.get("k") != "group_digest":
        return None
    group_id = str(msg.get("g") or "").strip()
    if not group_id:
        return None
    latest = msg.get("latest")
    latest_id = ""
    latest_ts = ""
    if isinstance(latest, dict):
        latest_id = str(latest.get("id") or "")
        latest_ts = str(latest.get("ts") or "")
    digest_hash = str(msg.get("digestHash") or "")
    more = "1" if msg.get("more") is True else "0"
    next_offset = str(msg.get("nextOffset") or "")
    fingerprint = "|".join((digest_hash, latest_id, latest_ts, more, next_offset))
    return group_id, fingerprint


def _reticulum_chat_wire_log_details(msg: Dict[str, Any]) -> str:
    message_type = str(msg.get("k") or "?")
    if message_type == "group_digest":
        latest = msg.get("latest")
        latest_id = ""
        latest_ts = ""
        if isinstance(latest, dict):
            latest_id = str(latest.get("id") or "")[:12]
            latest_ts = str(latest.get("ts") or "")
        details = [
            f"g={msg.get('g')}",
            f"digest={str(msg.get('digestHash') or '-')[:12]}",
            f"latest_id={latest_id or '-'}",
            f"latest_ts={latest_ts or '-'}",
            f"channels={len(msg.get('channels')) if isinstance(msg.get('channels'), list) else 0}",
        ]
        if msg.get("more") is True:
            details.append(f"more=true")
            details.append(f"nextOffset={msg.get('nextOffset')}")
        return " ".join(details)
    if message_type == "group_sub":
        groups = msg.get("groups")
        if isinstance(groups, list):
            group_ids = ",".join(str(group_id) for group_id in groups[:12])
            more = "+" if len(groups) > 12 else ""
            return f"mode={msg.get('mode')} groups={group_ids}{more} group_count={len(groups)} origin={str(msg.get('o') or '-')[:16]} hops={msg.get('h', 0)}"
        return f"mode={msg.get('mode')} groups=invalid origin={str(msg.get('o') or '-')[:16]} hops={msg.get('h', 0)}"
    if "g" in msg:
        return f"g={msg.get('g')}"
    return ""


def _reticulum_chat_prune_digest_fanout_recent(now: float) -> None:
    cutoff = now - _RETICULUM_CHAT_DIGEST_DEDUPE_TTL_SECONDS
    stale_keys = [
        key
        for key, sent_at in _reticulum_chat_digest_fanout_recent.items()
        if sent_at < cutoff
    ]
    for key in stale_keys:
        _reticulum_chat_digest_fanout_recent.pop(key, None)


_GROUP_AUDIO_WIRE_TYPE = "GCA"
_GROUP_AUDIO_HEARTBEAT_WIRE_TYPE = "GAC"
# Keep RTT controls under the established audio-control type so an older peer
# still classifies the first packet on this dedicated link as audio.
_GROUP_AUDIO_RTT_WIRE_TYPE = _GROUP_AUDIO_HEARTBEAT_WIRE_TYPE
_GROUP_AUDIO_RTT_PROBE_COMMAND = "P"
_GROUP_AUDIO_RTT_ACK_COMMAND = "A"
_AUDIO_RTT_PROBE_INTERVAL_SECONDS = 5.0
_AUDIO_RTT_PROBE_TIMEOUT_SECONDS = 4.0
_AUDIO_RTT_MONITOR_INTERVAL_SECONDS = 0.5
_AUDIO_RTT_SAMPLE_LIMIT = 16
_AUDIO_RTT_ACK_MIN_INTERVAL_SECONDS = 0.25
_GROUP_AUDIO_BINARY_MAGIC = b"QGAU"
_GROUP_AUDIO_BINARY_VERSION = 1
_GROUP_AUDIO_BINARY_HEADER_BYTES = 9
_AUDIO_LINK_TRACE_EVERY_FRAMES = 250
_audio_links_by_id: Dict[str, Dict[str, Any]] = {}
_audio_link_ids_by_object: Dict[int, str] = {}
_outgoing_audio_link_id_by_peer_hash: Dict[str, str] = {}
_active_audio_link_id_by_peer_hash: Dict[str, str] = {}
_audio_link_desired_by_peer_hash: Dict[str, Dict[str, Any]] = {}
_overlay_links_by_id: Dict[str, Dict[str, Any]] = {}
_overlay_link_ids_by_object: Dict[int, str] = {}
_active_overlay_link_id_by_peer_hash: Dict[str, str] = {}
_pinned_chat_overlay_peers: Dict[str, float] = {}
_overlay_open_pending_by_peer_hash: Set[str] = set()
_overlay_close_pending_link_ids: Set[str] = set()
_overlay_dedup_pending_by_peer_hash: Set[str] = set()
_overlay_delayed_duplicate_close_pending: Set[str] = set()
_overlay_announce_retry_last_at_by_peer_hash: Dict[str, float] = {}
_overlay_route_migration_pending_by_peer_hash: Set[str] = set()
_overlay_route_migration_last_attempt_at_by_peer_hash: Dict[str, float] = {}
_overlay_close_diagnostics: "deque[Tuple[float, str, bool, bool]]" = deque(maxlen=512)
_qchat_file_links_by_id: Dict[str, Dict[str, Any]] = {}
_qchat_file_link_ids_by_object: Dict[int, str] = {}
_outgoing_qchat_file_link_id_by_peer_hash: Dict[str, str] = {}
_qchat_file_open_queue_by_peer: Dict[str, deque] = {}
_qchat_file_open_queue_state_ids: Set[int] = set()
_qchat_file_open_drain_pending_peers: Set[str] = set()
_qchat_file_opening_state_by_peer: Dict[str, Dict[str, Any]] = {}
_incoming_unified_peer_hash_by_object: Dict[int, str] = {}
_qchat_file_accepts_by_peer: Dict[str, Dict[str, Any]] = {}
_qchat_file_accepts_by_transfer: Dict[str, Dict[str, Any]] = {}
_qchat_file_pending_sends_by_transfer: Dict[str, Dict[str, Any]] = {}
_resource_sessions_by_key: Dict[str, str] = {}
_resource_session_jobs_by_transfer: Dict[str, Dict[str, Any]] = {}
_resource_session_jobs_by_semantic_key: Dict[str, Dict[str, Any]] = {}
_resource_session_provider_waiters: Dict[str, Dict[str, Any]] = {}
_resource_session_failures_by_key: Dict[str, Dict[str, Any]] = {}
_resource_session_provider_pending_auth_by_peer: Dict[str, int] = {}
_resource_session_provider_inflight_transfers: Set[str] = set()
_resource_session_provider_recent_cancellations: Dict[str, float] = {}
_resource_session_provider_capacity_condition = threading.Condition(_state_lock)
_resource_session_provider_capacity_waiters: Dict[str, int] = {
    "live": 0,
    "metadata": 0,
    "history": 0,
    "attachment": 0,
}
_resource_session_provider_capacity_waiters_by_peer: Dict[str, int] = {}
_resource_session_provider_capacity_queue: List[Dict[str, Any]] = []
_resource_session_provider_active_by_class: Dict[str, int] = {
    "live": 0,
    "metadata": 0,
    "history": 0,
    "attachment": 0,
}
_resource_session_provider_active_by_peer: Dict[str, int] = {}
_resource_session_provider_active_attachments_by_peer: Dict[str, int] = {}
_RETICULUM_CHAT_RESOURCE_TYPE = "reticulum_chat_event"
_RETICULUM_RESOURCE_TYPE = "reticulum_resource"
_RETICULUM_CHAT_RESOURCE_AUTH_TYPE = "RETICULUM_CHAT_RESOURCE_AUTH"
_RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_TYPE = "RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH"
_RETICULUM_CHAT_RESOURCE_AUTH_COMPACT_TYPE = "RCR"
_RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_COMPACT_TYPE = "RCP"
_RETICULUM_CHAT_HISTORY_PAGE_REQUEST_TYPE = "RETICULUM_CHAT_HISTORY_PAGE_REQUEST"
_RETICULUM_CHAT_DM_PAGE_REQUEST_TYPE = "RETICULUM_CHAT_DM_PAGE_REQUEST"
_RETICULUM_GROUP_RESOURCE_AUTH_TYPE = "RETICULUM_GROUP_RESOURCE_AUTH"
_RETICULUM_DM_RESOURCE_AUTH_TYPE = "RETICULUM_DM_RESOURCE_AUTH"
_QCHAT_FILE_PROGRESS_MIN_INTERVAL_SECONDS = 0.5
_QCHAT_FILE_PROGRESS_MIN_DELTA = 0.005
_QCHAT_FILE_CHUNK_SIZE = 1024 * 1024
_QCHAT_FILE_PARALLEL_LINKS = 10
_QCHAT_FILE_CHUNK_MAX_ATTEMPTS = 4
_QCHAT_FILE_UNKNOWN_CHUNK_MAX_FAILURES = 24
_QCHAT_FILE_SUCCESS_LINK_CLOSE_GRACE_SECONDS = 15.0
_QCHAT_FILE_CHUNK_ACK_TIMEOUT_SECONDS = 90.0
_QCHAT_FILE_CHANNEL_STREAM_IDLE_TIMEOUT_SECONDS = 90.0
_QCHAT_FILE_CHUNK_DIAG_MIN_INTERVAL_SECONDS = 5.0
_QCHAT_FILE_CHUNK_DIAG_MIN_DELTA = 0.05
_STDOUT_RESP_BATCH_MAX = 32
_STDOUT_EVENT_BATCH_MAX = 128
_STDOUT_BATCH_MAX_BYTES = 1024 * 1024


def _qchat_file_is_managed_resource_type(resource_type: str) -> bool:
    normalized = str(resource_type or "").strip()
    return normalized in (
        _RETICULUM_CHAT_RESOURCE_TYPE,
        _RETICULUM_RESOURCE_TYPE,
        "reticulum_group_resource",
        "reticulum_group_resource_chunk",
    ) or (
        normalized.startswith(f"{_RETICULUM_RESOURCE_TYPE}_")
        or (
            normalized.startswith("reticulum_")
            and "_resource" in normalized
        )
    )


def _qchat_file_is_bridge_chunkable_managed_resource_type(resource_type: str) -> bool:
    normalized = str(resource_type or "").strip()
    if normalized == _RETICULUM_CHAT_RESOURCE_TYPE:
        return False
    if (
        normalized == "reticulum_resource_range"
        or normalized.endswith("_resource_range")
        or normalized == f"{_RETICULUM_RESOURCE_TYPE}_dm_range"
    ):
        return False
    return _qchat_file_is_managed_resource_type(normalized)


def _qchat_file_should_bridge_chunk_resource(resource_type: str, stream_mode: bool) -> bool:
    if stream_mode:
        return False
    return (
        not _qchat_file_is_managed_resource_type(resource_type)
        or _qchat_file_is_bridge_chunkable_managed_resource_type(resource_type)
    )
_QCHAT_FILE_RESERVED_METADATA_KEYS = {
    "kind",
    "resourceType",
    "transferId",
    "fileName",
    "size",
    "sha256",
    "chunked",
    "chunkIndex",
    "chunkCount",
    "chunkOffset",
    "chunkSize",
}
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
_AUDIO_DECODED_QUEUE_MAX = 96
_JSON_RESP_OUT_QUEUE_MAX = 512
_JSON_EVENT_OUT_QUEUE_MAX = 2048
_JSON_PRIORITY_EVENT_OUT_QUEUE_MAX = 512
_JSON_PRIORITY_EVENT_COALESCE_HIGH_WATERMARK = 16
_JSON_EVENT_COALESCE_HIGH_WATERMARK = 512
_JSON_EVENT_COALESCED_MAX = 512
_AUDIO_BINARY_OUT_QUEUE_MAX = 128
_AUDIO_BATCH_STALE_SECONDS = 0.75
_AUDIO_OUTBOUND_DEADLINE_SECONDS = 0.32
_AUDIO_DATA_PLANE_STALE_MS = 160
_AUDIO_DATA_PLANE_MAX_ROUTES = 128
_AUDIO_DATA_PLANE_INBOUND_QUEUE_MAX = 64
_AUDIO_MIN_BATCHES_PER_EXECUTOR_PASS = 2
_AUDIO_MAX_BATCHES_PER_EXECUTOR_PASS = 16
_AUDIO_BACKLOG_BATCH_STEP = 2
_AUDIO_BACKLOG_CMD_TIMEOUT_SECONDS = 0.005
_AUDIO_QUEUE_STATE_MIN_INTERVAL_SECONDS = 0.5
_BRIDGE_PRESSURE_LOG_INTERVAL_SECONDS = 5.0
_BRIDGE_PRESSURE_RNS_GAP_THRESHOLD_MS = 1000.0
_PRESENCE_PRESSURE_LOG_INTERVAL_SECONDS = 10.0
_CALLBACK_SLOW_LOG_THRESHOLD_MS = 100.0
_CALLBACK_SLOW_LOG_MIN_INTERVAL_SECONDS = 5.0
_PACKET_PATH_IDLE_REQUEST_COOLDOWN_SECONDS = 5.0
_PACKET_PATH_ACTIVE_REQUEST_COOLDOWN_SECONDS = 0.75
_PACKET_PATH_FRESH_SECONDS = 3.0
_PACKET_PATH_RECENT_FAILURE_SECONDS = 2.0
_PACKET_PATH_AWAIT_SECONDS = 0.12
_PACKET_PATH_IDLE_AWAIT_SECONDS = 0.02
_AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS = 2.0
_AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS = 12.0
_AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS = 4
_AUDIO_LINK_RETRY_MIN_SECONDS = 1.0
_AUDIO_LINK_RETRY_MAX_SECONDS = 20.0
_AUDIO_LINK_RECOVERY_REARM_DEBOUNCE_SECONDS = 2.0
_AUDIO_LINK_ACTIVE_CALL_REARM_SECONDS = 10.0
_PACKET_PATH_WARMING_TIMEOUTS_BEFORE_FAILING = 2
_AUDIO_LINK_FORCE_PATH_REFRESH_TIMEOUTS = 2
_PACKET_PATH_INBOUND_FRESH_SECONDS = 3.0
_PACKET_PATH_POLL_INTERVAL_SECONDS = 0.01
_SCHEDULER_AUDIO_SHARDS = 4
_SCHEDULER_GCALL_CONTROL_SHARDS = 8
_SCHEDULER_PRESENCE_FANOUT_SHARDS = 8
_SCHEDULER_LAND_STATE_SHARDS = 4
_SCHEDULER_RESOURCE_OPEN_SHARDS = 4
_SCHEDULER_OVERLAY_MIGRATION_SHARDS = 2
_SCHEDULER_SLOW_TASK_LOG_THRESHOLD_MS = 80.0
_SCHEDULER_QUEUE_MAX_BY_LANE: Dict[str, int] = {
    "control-send": 256,
    "link-management": 128,
    "overlay-control": 64,
    "overlay-io-0": 32,
    "overlay-io-1": 32,
    "audio-control": 64,
    "audio-rtt": 256,
    "path-management": 128,
    "resource-control": 128,
    "game-control": 128,
    "proximity-media": 32,
}
for _gcall_control_shard in range(_SCHEDULER_GCALL_CONTROL_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"gcall-control-{_gcall_control_shard}"] = 64
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"gcall-control-command-{_gcall_control_shard}"] = 64
for _audio_shard in range(_SCHEDULER_AUDIO_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"audio-send-{_audio_shard}"] = 64
for _presence_shard in range(_SCHEDULER_PRESENCE_FANOUT_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"presence-fanout-{_presence_shard}"] = 64
for _land_state_shard in range(_SCHEDULER_LAND_STATE_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"land-state-forward-{_land_state_shard}"] = 64
for _resource_open_shard in range(_SCHEDULER_RESOURCE_OPEN_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"resource-open-{_resource_open_shard}"] = 32
for _overlay_migration_shard in range(_SCHEDULER_OVERLAY_MIGRATION_SHARDS):
    _SCHEDULER_QUEUE_MAX_BY_LANE[f"overlay-migration-{_overlay_migration_shard}"] = 2

_shutdown = threading.Event()
_OWNER_WATCH_INTERVAL_SECONDS = 0.5
_OWNER_EXIT_GRACE_SECONDS = 7.0
_qortalland_game_manager: Optional[QortalLandGameManager] = None
_json_resp_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_RESP_OUT_QUEUE_MAX
)
_json_event_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_EVENT_OUT_QUEUE_MAX
)
_json_priority_event_queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_JSON_PRIORITY_EVENT_OUT_QUEUE_MAX
)
_json_event_coalesce_lock = threading.Lock()
_json_event_coalesced_by_key: Dict[str, Dict[str, Any]] = {}
_audio_binary_out_queue: "queue.Queue[Optional[bytes]]" = queue.Queue(
    maxsize=_AUDIO_BINARY_OUT_QUEUE_MAX
)
_cmd_queue_bounded: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue(
    maxsize=_CMD_QUEUE_MAX
)
_audio_decoded_queue: "queue.Queue[Optional[list]]" = queue.Queue(
    maxsize=_AUDIO_DECODED_QUEUE_MAX
)
_audio_data_plane_inbound_queue: "queue.Queue[Optional[Tuple[float, bytes]]]" = queue.Queue(
    maxsize=_AUDIO_DATA_PLANE_INBOUND_QUEUE_MAX
)
_scheduler_queues: Dict[str, "queue.Queue[Optional[Tuple[float, str, Callable[..., Any], tuple, dict]]]"] = {}
_scheduler_threads: list[threading.Thread] = []
_scheduler_stats: Dict[str, Dict[str, Any]] = {}
_latest_land_state_lock = threading.Lock()
_latest_land_state_commands: Dict[str, Dict[str, Any]] = {}
_latest_land_state_generations: Dict[str, int] = {}
_latest_land_state_next_generation = 0
_LATEST_LAND_STATE_MAX_PENDING = 4096
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
_json_event_coalesced_updates = 0
_json_event_coalesced_evictions = 0
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
_audio_rns_callback_scheduler_gap_ms_window = 0.0
_audio_rns_callback_scheduler_gap_over_100_count = 0
_audio_rns_callback_scheduler_gap_over_250_count = 0
_audio_rns_callback_scheduler_gap_over_500_count = 0
_audio_rns_callback_scheduler_gap_over_1000_count = 0
_RNS_GAP_MEDIAN_BUCKET_MS = 50
_RNS_GAP_MEDIAN_MAX_MS = 120_000
_RNS_GAP_MEDIAN_BUCKET_COUNT = (_RNS_GAP_MEDIAN_MAX_MS // _RNS_GAP_MEDIAN_BUCKET_MS) + 2
_audio_rns_raw_inbound_gap_ms_max = 0.0
_audio_rns_raw_inbound_gap_ms_window = 0.0
_audio_rns_raw_inbound_gap_over_80_count = 0
_audio_rns_raw_inbound_gap_over_160_count = 0
_audio_rns_raw_inbound_gap_over_320_count = 0
_audio_rns_raw_inbound_gap_over_640_count = 0
_audio_rns_raw_inbound_gap_over_1000_count = 0
_audio_rns_raw_inbound_gap_bucket_counts = [0] * _RNS_GAP_MEDIAN_BUCKET_COUNT
_audio_rns_raw_inbound_gap_sample_count = 0
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
_audio_rns_shared_frame_gap_ms_window = 0.0
_audio_rns_shared_frame_gap_over_80_count = 0
_audio_rns_shared_frame_gap_over_160_count = 0
_audio_rns_shared_frame_gap_over_320_count = 0
_audio_rns_shared_frame_gap_over_640_count = 0
_audio_rns_shared_frame_gap_over_1000_count = 0
_audio_rns_shared_frame_gap_bucket_counts = [0] * _RNS_GAP_MEDIAN_BUCKET_COUNT
_audio_rns_shared_frame_gap_sample_count = 0
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
_audio_stage_counters_by_link_id: Dict[str, Dict[str, Any]] = {}
_audio_stage_counters_by_destination_hash: Dict[str, Dict[str, Any]] = {}
_audio_stage_link_id_by_destination_hash: Dict[str, str] = {}
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
_AUDIO_STAGE_COUNTER_LOG_INTERVAL_MS = 5000
_AUDIO_PATH_PRESSURE_LOG_INTERVAL_MS = 5000
_AUDIO_EXECUTOR_STALL_LOG_THRESHOLD_MS = 120.0
_AUDIO_PROCESS_BATCH_LOG_THRESHOLD_MS = 80.0
_AUDIO_EXECUTOR_COMMAND_LOG_THRESHOLD_MS = 80.0
_audio_queue_state_last_emit = 0.0
_audio_queue_state_dirty = False
_bridge_pressure_last_log_at = 0.0
_audio_stage_counter_last_log_at_ms = 0
_rns_interface_pressure_last_log_at = 0.0
_RNS_INTERFACE_PRESSURE_LOG_INTERVAL_SECONDS = 15.0
_presence_pressure_window_started_at = time.monotonic()
_presence_pressure_counts: Dict[str, int] = {}
_callback_slow_last_log_by_name: Dict[str, float] = {}
_audio_timing_anomaly_log_last_by_key: Dict[str, float] = {}
_bridge_event_timing_log_last_by_event: Dict[str, float] = {}
_audio_fd3_parse_last_wall_ms_by_route: Dict[str, int] = {}
# One-shot narrowing logs (grep target=reticulum-audio-ipc stage=…)
_audio_ipc_fd3_first_batch_ok_logged = False
_audio_ipc_rns_first_send_ok_logged = False
_audio_ipc_fd4_first_chunk_logged = False
_audio_data_plane_lock = threading.RLock()
_audio_data_plane_server_thread: Optional[threading.Thread] = None
_audio_data_plane_inbound_sender_thread: Optional[threading.Thread] = None
_audio_data_plane_socket: Optional[socket.socket] = None
_audio_data_plane_endpoint = ""
_audio_data_plane_token = ""
_audio_data_plane_routes_by_address: Dict[str, Dict[str, Any]] = {}
_audio_forwarding_plans_by_room: Dict[str, Dict[str, Any]] = {}
_audio_forwarding_activity_last_emit_ms: Dict[str, int] = {}
_audio_forwarding_stats_by_room: Dict[str, Dict[str, int]] = {}
_audio_data_plane_clients: Dict[int, socket.socket] = {}
_audio_data_plane_send_locks: Dict[int, threading.RLock] = {}
_audio_data_plane_direct_inbound_enabled = os.environ.get(
    "QORTAL_AUDIO_DIRECT_DATA_PLANE", "1"
).strip().lower() not in ("0", "false", "no", "off")
_audio_data_plane_direct_group_inbound_enabled = os.environ.get(
    "QORTAL_AUDIO_DIRECT_DATA_PLANE_GROUP_INBOUND", "0"
).strip().lower() in ("1", "true", "yes", "on")
_audio_data_plane_direct_room_prefixes = ("dmv:",)
_audio_group_forward_fast_path_enabled = os.environ.get(
    "QORTAL_AUDIO_GROUP_FORWARD_FAST_PATH", "1"
).strip().lower() not in ("0", "false", "no", "off")
_audio_data_plane_first_inbound_sent = False
_audio_data_plane_inbound_queue_drops = 0
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
_RETICULUM_CHAT_WIRE_TYPE = "RCHAT"
_RETICULUM_CHAT_DIGEST_DEDUPE_TTL_SECONDS = 5 * 60.0
_RETICULUM_CHAT_SOFT_FANOUT_TYPES = {
    "hello",
    "group_sub",
    "group_digest",
    "dm_notify",
    "dm_probe",
    "typing",
    "land_state",
}
_reticulum_chat_digest_fanout_recent: Dict[Tuple[str, str, str], float] = {}
_land_state_forwarding_lock = threading.RLock()
_land_state_forwarding_plans: Dict[int, Dict[str, float]] = {}
_land_state_auth_sessions: Dict[Tuple[int, str, str], Dict[str, Any]] = {}
_land_state_forward_pending: Dict[
    Tuple[str, int, str, str, int, str], Dict[str, Any]
] = {}
_land_state_forwarding_revision = 0
_qortalland_proximity_discovery_seen: Dict[str, float] = {}
_QORTAL_LAND_PROXIMITY_DISCOVERY_PREFIX = b"QLPV1"
_LAND_STATE_FORWARDING_MAX_GROUPS = 1024
_LAND_STATE_FORWARDING_MAX_TARGETS_PER_GROUP = 64
_LAND_STATE_FORWARDING_MAX_SESSIONS = 4096
_LAND_STATE_FORWARDING_MAX_PENDING = 4096
_RETICULUM_CHAT_TARGET_BATCH_MAX = 4096
_LAND_STATE_MAX_HOPS = 8
_LAND_STATE_MAX_AGE_MS = 2 * 60_000
_LAND_STATE_MAX_FUTURE_SKEW_MS = 30_000
_AUDIO_LINK_WIRE_TYPES = frozenset(
    {
        _GROUP_AUDIO_HEARTBEAT_WIRE_TYPE,
        _GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE,
    }
)

_PRIORITY_EVENT_NAMES = frozenset(
    {
        "group_audio_link_closed",
        "group_audio_link_established",
        "group_audio_send_failed",
        "error",
        "ready",
    }
)
_COALESCIBLE_EVENT_NAMES = frozenset(
    {
        "candidate_peer_discovered",
        "group_audio_send_failed",
        "group_audio_queue_state",
        "overlay_link_state",
        "presence_message",
        "transport_state",
    }
)


def _json_event_depth() -> int:
    with _json_event_coalesce_lock:
        coalesced_depth = len(_json_event_coalesced_by_key)
    return (
        _json_event_queue.qsize()
        + _json_priority_event_queue.qsize()
        + coalesced_depth
    )


def _event_payload(frame: Dict[str, Any]) -> Dict[str, Any]:
    payload = frame.get("payload")
    return payload if isinstance(payload, dict) else {}


def _coalesce_key_for_event(frame: Dict[str, Any]) -> Optional[str]:
    event_name = str(frame.get("event") or "")
    if event_name not in _COALESCIBLE_EVENT_NAMES:
        return None
    payload = _event_payload(frame)
    if event_name == "group_audio_send_failed":
        link_id = str(payload.get("linkId") or "")
        peer_hash = str(payload.get("peerPresenceHash") or "")
        code = str(payload.get("code") or payload.get("reason") or "")
        transport = str(payload.get("transport") or "")
        return f"{event_name}:{transport}:{link_id or peer_hash}:{code}"
    if event_name == "presence_message":
        envelope = payload.get("envelope")
        if isinstance(envelope, dict):
            address = str(envelope.get("address") or envelope.get("peerAddress") or "")
            session_id = str(envelope.get("sessionId") or "")
            if address or session_id:
                return f"{event_name}:{address}:{session_id}"
            envelope_id = str(envelope.get("id") or "")
            if envelope_id:
                return f"{event_name}:{envelope_id}"
        return event_name
    if event_name == "overlay_link_state":
        link_id = str(payload.get("linkId") or "")
        peer_hash = str(payload.get("peerPresenceHash") or "")
        return f"{event_name}:{link_id or peer_hash}"
    if event_name == "candidate_peer_discovered":
        return f"{event_name}:{str(payload.get('peerHash') or '')}"
    if event_name == "group_audio_queue_state":
        return event_name
    if event_name == "transport_state":
        return event_name
    return None


def _queue_coalesced_json_event_line(frame: Dict[str, Any], key: str) -> None:
    global _json_event_coalesced_updates, _json_event_coalesced_evictions
    with _json_event_coalesce_lock:
        if (
            key not in _json_event_coalesced_by_key
            and len(_json_event_coalesced_by_key) >= _JSON_EVENT_COALESCED_MAX
        ):
            oldest_key = next(iter(_json_event_coalesced_by_key), None)
            if oldest_key is not None:
                _json_event_coalesced_by_key.pop(oldest_key, None)
                _json_event_coalesced_evictions += 1
        _json_event_coalesced_by_key[key] = frame
        _json_event_coalesced_updates += 1


def _pop_coalesced_json_event_line() -> Optional[Dict[str, Any]]:
    with _json_event_coalesce_lock:
        if not _json_event_coalesced_by_key:
            return None
        key = next(iter(_json_event_coalesced_by_key))
        return _json_event_coalesced_by_key.pop(key, None)


def _queue_json_event_line(frame: Dict[str, Any]) -> None:
    global _audio_drops_json_out
    target_queue = _json_event_queue
    try:
        if isinstance(frame, dict):
            frame.setdefault("_queuedAtMs", _now_wall_ms())
            frame.setdefault("_queuedAtMono", time.monotonic())
            frame.setdefault("_eventQueueDepthBefore", _json_event_depth())
            event_name = str(frame.get("event") or "")
            if event_name in _PRIORITY_EVENT_NAMES:
                coalesce_key = _coalesce_key_for_event(frame)
                if (
                    coalesce_key is not None
                    and _json_priority_event_queue.qsize() >= _JSON_PRIORITY_EVENT_COALESCE_HIGH_WATERMARK
                ):
                    _queue_coalesced_json_event_line(frame, coalesce_key)
                    return
                target_queue = _json_priority_event_queue
            else:
                coalesce_key = _coalesce_key_for_event(frame)
                if (
                    coalesce_key is not None
                    and _json_event_depth() >= _JSON_EVENT_COALESCE_HIGH_WATERMARK
                ):
                    _queue_coalesced_json_event_line(frame, coalesce_key)
                    return
        target_queue.put_nowait(frame)
    except queue.Full:
        if isinstance(frame, dict):
            coalesce_key = _coalesce_key_for_event(frame)
            if coalesce_key is not None:
                _queue_coalesced_json_event_line(frame, coalesce_key)
                return
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
        "currentTask": "",
        "currentTaskStartedAt": 0.0,
    }
    _scheduler_stats[lane] = stats
    return stats


def _logical_scheduler_lane(lane: str) -> str:
    if lane.startswith("audio-send-"):
        return "audio-send"
    if lane.startswith("presence-fanout-"):
        return "presence-fanout"
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


def _format_bridge_pressure_counts(counts: Dict[str, int]) -> str:
    if not counts:
        return "none"
    return ",".join(f"{key}:{value}" for key, value in sorted(counts.items()))


def _overlay_close_diagnostic_counts(now_wall: float) -> Tuple[int, int, int]:
    cutoff = now_wall - _OVERLAY_CLOSE_DIAGNOSTIC_WINDOW_SECONDS
    destination_closed = 0
    replay_associated = 0
    announce_retry_associated = 0
    with _state_lock:
        while _overlay_close_diagnostics and _overlay_close_diagnostics[0][0] < cutoff:
            _overlay_close_diagnostics.popleft()
        for _ts, reason, replay_close, announce_retry_close in _overlay_close_diagnostics:
            if reason == "destination_closed":
                destination_closed += 1
                if replay_close:
                    replay_associated += 1
                if announce_retry_close:
                    announce_retry_associated += 1
    return destination_closed, replay_associated, announce_retry_associated


def _format_scheduler_active_tasks(now: float) -> str:
    parts: list[str] = []
    with _state_lock:
        for lane in sorted(_scheduler_stats.keys()):
            stats = _scheduler_stats.get(lane) or {}
            task = str(stats.get("currentTask") or "")
            started_at = float(stats.get("currentTaskStartedAt") or 0.0)
            if not task or started_at <= 0:
                continue
            duration_ms = max(0.0, (now - started_at) * 1000.0)
            parts.append(f"{lane}:{task[:48]}:{int(duration_ms)}ms")
    return ",".join(parts) if parts else "none"


def _record_gap_median_sample(bucket_counts: List[int], gap_ms: float) -> None:
    try:
        bucket = int(max(0.0, float(gap_ms)) // _RNS_GAP_MEDIAN_BUCKET_MS)
    except Exception:
        bucket = 0
    if bucket >= len(bucket_counts):
        bucket = len(bucket_counts) - 1
    bucket_counts[bucket] += 1


def _estimate_gap_median_ms(bucket_counts: List[int], sample_count: int) -> int:
    if sample_count <= 0:
        return 0
    target = (sample_count + 1) // 2
    seen = 0
    for bucket, count in enumerate(bucket_counts):
        seen += int(count or 0)
        if seen >= target:
            return min(bucket * _RNS_GAP_MEDIAN_BUCKET_MS, _RNS_GAP_MEDIAN_MAX_MS)
    return _RNS_GAP_MEDIAN_MAX_MS


def _maybe_log_bridge_pressure(now: Optional[float] = None, force: bool = False) -> None:
    global _bridge_pressure_last_log_at
    global _audio_rns_callback_scheduler_gap_ms_window
    global _audio_rns_raw_inbound_gap_ms_window
    global _audio_rns_shared_frame_gap_ms_window
    if now is None:
        now = time.monotonic()
    if not force and now - _bridge_pressure_last_log_at < _BRIDGE_PRESSURE_LOG_INTERVAL_SECONDS:
        return

    cmd_q = _cmd_queue_bounded.qsize()
    resp_q = _json_resp_queue.qsize()
    event_q = _json_event_queue.qsize()
    priority_event_q = _json_priority_event_queue.qsize()
    with _json_event_coalesce_lock:
        coalesced_event_q = len(_json_event_coalesced_by_key)
    lane_depths: Dict[str, int] = {}
    slow_counts: Dict[str, int] = {}
    now_wall = time.time()
    (
        resource_sessions,
        resource_session_active,
        resource_session_queued,
        resource_session_oldest_age,
    ) = _resource_session_queue_counts()
    overlay_destination_closes, overlay_replay_closes, overlay_announce_retry_closes = (
        _overlay_close_diagnostic_counts(now_wall)
    )
    with _state_lock:
        lanes = set(_SCHEDULER_QUEUE_MAX_BY_LANE.keys()) | set(_scheduler_queues.keys()) | set(_scheduler_stats.keys())
        for lane in lanes:
            q = _scheduler_queues.get(lane)
            lane_depths[lane] = q.qsize() if q is not None else 0
            stats = _scheduler_stats.get(lane)
            slow_count = int(stats.get("slowTaskCount") or 0) if stats is not None else 0
            if slow_count > 0:
                slow_counts[lane] = slow_count
        overlay_links = len(_overlay_links_by_id)
        audio_links = len(_audio_links_by_id)
        file_links = len(_qchat_file_links_by_id)
        provider_pending_auth = len(_resource_session_provider_waiters)
        provider_inflight = len(_resource_session_provider_inflight_transfers)
        provider_capacity_waiters = dict(
            _resource_session_provider_capacity_waiters
        )
        provider_waiting_peers = len(
            _resource_session_provider_capacity_waiters_by_peer
        )
        provider_active_by_class = dict(
            _resource_session_provider_active_by_class
        )
        provider_active_peers = len(_resource_session_provider_active_by_peer)
        provider_link_handoff_waiting = sum(
            1
            for state in _qchat_file_links_by_id.values()
            if isinstance(state, dict)
            and state.get("manager_kind") == "resource_session"
            and state.get("incoming") is True
            and state.get("provider_link_waiter_transfer")
        )
        provider_link_handoffs = sum(
            int(state.get("provider_link_handoffs") or 0)
            for state in _qchat_file_links_by_id.values()
            if isinstance(state, dict)
            and state.get("manager_kind") == "resource_session"
            and state.get("incoming") is True
        )
        raw_gap_sample_count = int(_audio_rns_raw_inbound_gap_sample_count or 0)
        shared_gap_sample_count = int(_audio_rns_shared_frame_gap_sample_count or 0)
        raw_gap_median_ms = _estimate_gap_median_ms(
            _audio_rns_raw_inbound_gap_bucket_counts,
            raw_gap_sample_count,
        )
        shared_gap_median_ms = _estimate_gap_median_ms(
            _audio_rns_shared_frame_gap_bucket_counts,
            shared_gap_sample_count,
        )

    rns_scheduler_gap_ms_max = float(_audio_rns_callback_scheduler_gap_ms_max or 0.0)
    rns_raw_gap_ms_max = float(_audio_rns_raw_inbound_gap_ms_max or 0.0)
    rns_shared_gap_ms_max = float(_audio_rns_shared_frame_gap_ms_max or 0.0)
    rns_gap_ms_max = max(rns_scheduler_gap_ms_max, rns_raw_gap_ms_max, rns_shared_gap_ms_max)
    rns_scheduler_gap_ms_window = float(_audio_rns_callback_scheduler_gap_ms_window or 0.0)
    rns_raw_gap_ms_window = float(_audio_rns_raw_inbound_gap_ms_window or 0.0)
    rns_shared_gap_ms_window = float(_audio_rns_shared_frame_gap_ms_window or 0.0)
    rns_gap_ms_window = max(
        rns_scheduler_gap_ms_window,
        rns_raw_gap_ms_window,
        rns_shared_gap_ms_window,
    )
    rns_gap_pressure = (
        rns_gap_ms_window >= _BRIDGE_PRESSURE_RNS_GAP_THRESHOLD_MS
    )
    has_pressure = (
        cmd_q > 0
        or resp_q > 0
        or event_q > 0
        or priority_event_q > 0
        or coalesced_event_q > 0
        or any(depth > 0 for depth in lane_depths.values())
        or file_links > 0
        or resource_session_active > 0
        or resource_session_queued > 0
        or provider_pending_auth > 0
        or provider_inflight > 0
        or provider_link_handoff_waiting > 0
        or any(count > 0 for count in provider_capacity_waiters.values())
        or any(count > 0 for count in provider_active_by_class.values())
        or rns_gap_pressure
        or overlay_destination_closes > 0
    )
    if not force and not has_pressure:
        return

    _bridge_pressure_last_log_at = now
    lanes_text = _format_bridge_pressure_counts(lane_depths)
    slow_text = _format_bridge_pressure_counts(slow_counts)
    active_text = _format_scheduler_active_tasks(now)
    log(
        "[presence_bridge] bridge_pressure "
        f"cmd_q={cmd_q} resp_q={resp_q} event_q={event_q} "
        f"priority_event_q={priority_event_q} coalesced_event_q={coalesced_event_q} "
        f"lanes={lanes_text} "
        f"links=overlay:{overlay_links},audio:{audio_links},file:{file_links} "
        f"resource_sessions={resource_sessions} resource_active={resource_session_active} "
        f"resource_queued={resource_session_queued} resource_oldest_ms={int(resource_session_oldest_age * 1000)} "
        f"provider_auth_pending={provider_pending_auth} "
        f"provider_inflight={provider_inflight} "
        f"provider_link_handoff_waiting={provider_link_handoff_waiting} "
        f"provider_link_handoffs={provider_link_handoffs} "
        f"provider_waiting={_format_bridge_pressure_counts(provider_capacity_waiters)} "
        f"provider_waiting_peers={provider_waiting_peers} "
        f"provider_active={_format_bridge_pressure_counts(provider_active_by_class)} "
        f"provider_active_peers={provider_active_peers} "
        f"scheduler_slow={slow_text} scheduler_active={active_text} "
        f"rns_gap_ms_window={int(rns_gap_ms_window)} "
        f"rns_gap_ms_max={int(rns_gap_ms_max)} "
        f"rns_gap_window_parts=scheduler:{int(rns_scheduler_gap_ms_window)},"
        f"raw:{int(rns_raw_gap_ms_window)},shared:{int(rns_shared_gap_ms_window)} "
        f"rns_gap_max_parts=scheduler:{int(rns_scheduler_gap_ms_max)},"
        f"raw:{int(rns_raw_gap_ms_max)},shared:{int(rns_shared_gap_ms_max)} "
        f"rns_gap_total_median_ms=raw:{raw_gap_median_ms},shared:{shared_gap_median_ms} "
        f"rns_gap_total_samples=raw:{raw_gap_sample_count},shared:{shared_gap_sample_count} "
        f"overlay_destination_closed_5m={overlay_destination_closes} "
        f"overlay_replay_destination_closed_5m={overlay_replay_closes} "
        f"overlay_announce_retry_destination_closed_5m={overlay_announce_retry_closes}"
    )
    _maybe_log_audio_stage_counters(_now_wall_ms())
    if rns_gap_ms_window >= _BRIDGE_PRESSURE_RNS_GAP_THRESHOLD_MS:
        _maybe_log_rns_interface_pressure(
            rns_gap_ms_window,
            reason="bridge_pressure",
            now=now,
        )
    _audio_rns_callback_scheduler_gap_ms_window = 0.0
    _audio_rns_raw_inbound_gap_ms_window = 0.0
    _audio_rns_shared_frame_gap_ms_window = 0.0


def _note_presence_pressure(kind: str, message_type: str = "") -> None:
    global _presence_pressure_window_started_at, _presence_pressure_counts
    try:
        now = time.monotonic()
        snapshot: Optional[Dict[str, int]] = None
        elapsed = 0.0
        with _state_lock:
            key = str(kind or "").strip()
            if key:
                _presence_pressure_counts[key] = int(_presence_pressure_counts.get(key) or 0) + 1
            type_key = str(message_type or "").strip()
            if type_key:
                safe_type = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in type_key)
                _presence_pressure_counts[f"type:{safe_type}"] = int(
                    _presence_pressure_counts.get(f"type:{safe_type}") or 0
                ) + 1
            elapsed = max(0.0, now - _presence_pressure_window_started_at)
            if elapsed < _PRESENCE_PRESSURE_LOG_INTERVAL_SECONDS:
                return
            if _presence_pressure_counts:
                snapshot = dict(_presence_pressure_counts)
            _presence_pressure_counts = {}
            _presence_pressure_window_started_at = now
            overlay_links = len(_overlay_links_by_id)
            audio_links = len(_audio_links_by_id)
            file_links = len(_qchat_file_links_by_id)
            known_peers = len(_known_peers)
            verified_peers = len(_verified_overlay_peers)
            candidates = len(_candidate_peers)
            outbound_neighbors = len(_active_overlay_neighbors)
            inbound_neighbors = len(_inbound_overlay_neighbors)
        if not snapshot:
            return

        def count(name: str) -> int:
            return int(snapshot.get(name) or 0)

        source_total = count("source:hub") + count("source:overlay") + count("source:qchat_file")
        presence_total = (
            count("type:PRESENCE_ANNOUNCE")
            + count("type:PRESENCE_HEARTBEAT")
            + count("type:PRESENCE_OFFLINE")
        )
        decoded_total = presence_total + count("decoded:call") + count("decoded:group_call")
        log(
            "[presence_bridge] presence_pressure "
            f"window_s={int(elapsed)} inbound={source_total} decoded={decoded_total} "
            f"sources=hub:{count('source:hub')},overlay:{count('source:overlay')},qchat_file:{count('source:qchat_file')} "
            f"presence=total:{presence_total},announce:{count('type:PRESENCE_ANNOUNCE')},"
            f"heartbeat:{count('type:PRESENCE_HEARTBEAT')},offline:{count('type:PRESENCE_OFFLINE')} "
            f"calls=dm:{count('decoded:call')},group:{count('decoded:group_call')} "
            f"links=overlay:{overlay_links},audio:{audio_links},file:{file_links} "
            f"peers=known:{known_peers},verified:{verified_peers},candidates:{candidates},"
            f"outbound:{outbound_neighbors},inbound:{inbound_neighbors}"
        )
    except Exception:
        return


def _callback_payload_label(raw: Any) -> str:
    try:
        if not isinstance(raw, (bytes, bytearray)):
            return ""
        data = bytes(raw)
        if not data:
            return ""
        stripped = data.lstrip()
        if stripped.startswith(b"{"):
            try:
                decoded = json.loads(data.decode("utf-8"))
                if isinstance(decoded, dict):
                    label = decoded.get("t") or decoded.get("type")
                    return str(label or "")[:80]
            except Exception:
                return "json_decode_failed"
        if _decode_group_audio_wire(data) is not None:
            return "group_audio"
        return "binary"
    except Exception:
        return ""


def _note_callback_duration(name: str, started_at: float, raw: Any = None) -> None:
    try:
        duration_ms = (time.monotonic() - started_at) * 1000.0
        if duration_ms < _CALLBACK_SLOW_LOG_THRESHOLD_MS:
            return
        now = time.monotonic()
        last_at = float(_callback_slow_last_log_by_name.get(name) or 0.0)
        if now - last_at < _CALLBACK_SLOW_LOG_MIN_INTERVAL_SECONDS:
            return
        _callback_slow_last_log_by_name[name] = now
        label = _callback_payload_label(raw)
        log(
            "[presence_bridge] callback_slow "
            f"name={name} duration_ms={duration_ms:.1f}"
            f"{(' type=' + label) if label else ''}"
        )
    except Exception:
        return


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


def _land_state_coalesce_key(message: Dict[str, Any]) -> Optional[Tuple[str, int]]:
    action = str(message.get("action") or "")
    payload = message.get("payload")
    if not isinstance(payload, dict):
        return None

    target_key = ""
    wire: Any = None
    if action == "send_reticulum_chat":
        peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
        if not peer_hash:
            return None
        target_key = f"send:{peer_hash}"
        wire = payload.get("message")
    elif action == "fanout_reticulum_chat":
        messages = payload.get("messages")
        if not isinstance(messages, list) or len(messages) != 1:
            return None
        exclude_hashes = payload.get("excludePeerPresenceHashes")
        if isinstance(exclude_hashes, list):
            excluded = ",".join(sorted(str(item).strip().lower() for item in exclude_hashes if str(item).strip()))
        else:
            excluded = ""
        target_key = f"fanout:{excluded}"
        wire = messages[0]
    else:
        return None

    if not isinstance(wire, dict):
        return None
    if wire.get("t") != _RETICULUM_CHAT_WIRE_TYPE or wire.get("k") != "land_state":
        return None

    group_id = wire.get("g")
    author = str(wire.get("a") or "").strip()
    session_id = str(wire.get("s") or "").strip()
    if not isinstance(group_id, int) or group_id <= 0 or not author or not session_id:
        return None
    try:
        sequence = int(wire.get("q") or 0)
    except Exception:
        sequence = 0
    return f"{target_key}:g={group_id}:a={author}:s={session_id}", sequence


def _drain_latest_land_state_command(key: str, generation: int) -> None:
    with _latest_land_state_lock:
        if int(_latest_land_state_generations.get(key) or 0) != int(generation):
            return
        message = _latest_land_state_commands.pop(key, None)
        _latest_land_state_generations.pop(key, None)
    if message is not None:
        handle_command(message)


def _enqueue_latest_land_state_command(message: Dict[str, Any]) -> Optional[bool]:
    global _latest_land_state_next_generation
    parsed = _land_state_coalesce_key(message)
    if parsed is None:
        return None

    key, sequence = parsed
    req_id = str(message.get("id") or "")
    schedule_needed = False
    generation = 0
    deferred_responses: List[Tuple[str, Dict[str, Any]]] = []
    with _latest_land_state_lock:
        existing = _latest_land_state_commands.get(key)
        if existing is not None:
            _existing_key, existing_sequence = _land_state_coalesce_key(existing) or (key, -1)
            if existing_sequence >= sequence:
                deferred_responses.append((req_id, {"coalesced": True, "dropped": "older_land_state"}))
                schedule_needed = False
                key = ""
            existing_id = str(existing.get("id") or "") if key else ""
            if existing_id and existing_id != req_id:
                deferred_responses.append((existing_id, {"coalesced": True, "replacedByLatest": True}))

        if not key:
            pass
        elif (
            key not in _latest_land_state_commands
            and len(_latest_land_state_commands) >= _LATEST_LAND_STATE_MAX_PENDING
        ):
            oldest_key = next(iter(_latest_land_state_commands), "")
            if oldest_key:
                oldest = _latest_land_state_commands.pop(oldest_key, None)
                _latest_land_state_generations.pop(oldest_key, None)
                oldest_id = str(oldest.get("id") or "") if isinstance(oldest, dict) else ""
                if oldest_id:
                    deferred_responses.append(
                        (oldest_id, {"coalesced": True, "dropped": "land_state_queue_limit"})
                    )

        if key:
            _latest_land_state_commands[key] = message
            generation = int(_latest_land_state_generations.get(key) or 0)
            if generation <= 0:
                _latest_land_state_next_generation += 1
                generation = _latest_land_state_next_generation
                _latest_land_state_generations[key] = generation
                schedule_needed = True

    for response_id, payload in deferred_responses:
        if response_id:
            emit_resp(response_id, True, payload=payload)

    if not key:
        return True

    if not schedule_needed:
        return True

    queued = _enqueue_scheduler_task(
        "control-send",
        "cmd:latest_land_state",
        _drain_latest_land_state_command,
        key,
        generation,
    )
    if queued:
        return True

    with _latest_land_state_lock:
        current = _latest_land_state_commands.get(key)
        if current is message and int(_latest_land_state_generations.get(key) or 0) == int(generation):
            _latest_land_state_commands.pop(key, None)
            _latest_land_state_generations.pop(key, None)
    if req_id:
        emit_resp(
            req_id,
            True,
            payload={"coalesced": True, "dropped": "land_state_scheduler_full"},
        )
    return True


def _scheduler_worker_loop(lane: str) -> None:
    q = _scheduler_queues[lane]
    while not _shutdown.is_set():
        item = q.get()
        if item is None:
            return
        queued_at, name, fn, args, kwargs = item
        started_at = time.monotonic()
        with _state_lock:
            stats = _scheduler_stats_for_lane(lane)
            stats["currentTask"] = str(name or "")[:80]
            stats["currentTaskStartedAt"] = started_at
            _mark_audio_queue_state_dirty()
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
            with _state_lock:
                stats = _scheduler_stats_for_lane(lane)
                if str(stats.get("currentTask") or "") == str(name or "")[:80]:
                    stats["currentTask"] = ""
                    stats["currentTaskStartedAt"] = 0.0
                    _mark_audio_queue_state_dirty()
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
            "pressureWindowStartedAtMs": 0,
            "pressureWindowFrames": 0,
            "pressureWindowBytes": 0,
            "pressureWindowReceiveGapMsMax": 0,
            "pressureWindowFd4DelayMsMax": 0,
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


def _maybe_log_audio_path_pressure(
    stats: Dict[str, Any],
    *,
    transport: str,
    route_key: str,
    room_id: str,
    peer_presence_hash: str,
    peer_destination_hash: str,
    now_ms: int,
) -> None:
    window_started_at_ms = int(stats.get("pressureWindowStartedAtMs") or 0)
    if window_started_at_ms <= 0:
        stats["pressureWindowStartedAtMs"] = now_ms
        return
    elapsed_ms = max(0, now_ms - window_started_at_ms)
    if elapsed_ms < _AUDIO_PATH_PRESSURE_LOG_INTERVAL_MS:
        return
    frames = int(stats.get("pressureWindowFrames") or 0)
    if frames <= 0:
        stats["pressureWindowStartedAtMs"] = now_ms
        return
    bytes_count = int(stats.get("pressureWindowBytes") or 0)
    receive_gap_ms = int(stats.get("pressureWindowReceiveGapMsMax") or 0)
    fd4_delay_ms = int(stats.get("pressureWindowFd4DelayMsMax") or 0)
    log(
        f"[presence_bridge] audio_path_pressure side=python_rx "
        f"window_ms={elapsed_ms} room={room_id or 'n/a'} transport={transport} "
        f"route={_short_route(route_key)} link={_short_route(route_key) if transport == 'link' else 'n/a'} "
        f"peer={_short_route(peer_presence_hash)} dest={_short_route(peer_destination_hash)} "
        f"packets={frames} bytes={bytes_count} rx_gap_ms={receive_gap_ms} "
        f"fd4_enqueue_delay_ms={fd4_delay_ms} fd4_enqueued={int(stats.get('fd4EnqueuedFrames') or 0)} "
        f"fd4_failures={int(stats.get('fd4EnqueueFailures') or 0)}"
    )
    stats["pressureWindowStartedAtMs"] = now_ms
    stats["pressureWindowFrames"] = 0
    stats["pressureWindowBytes"] = 0
    stats["pressureWindowReceiveGapMsMax"] = 0
    stats["pressureWindowFd4DelayMsMax"] = 0


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


def _merge_audio_stage_counters_locked(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key, value in source.items():
        if key.endswith("Count") or key.endswith("Window"):
            target[key] = int(target.get(key) or 0) + int(value or 0)
        elif key.endswith("AtMs"):
            target[key] = max(int(target.get(key) or 0), int(value or 0))
        elif key.startswith("last") and value:
            target[key] = value


def _bind_audio_stage_destination_to_link_locked(destination_hash: str, link_id: str) -> None:
    destination_key = str(destination_hash or "").strip().lower()
    link_key = str(link_id or "").strip()
    if not destination_key or not link_key:
        return
    _audio_stage_link_id_by_destination_hash[destination_key] = link_key
    pending = _audio_stage_counters_by_destination_hash.pop(destination_key, None)
    if pending is not None:
        target = _audio_stage_counters_by_link_id.setdefault(link_key, {})
        _merge_audio_stage_counters_locked(target, pending)


def _note_audio_stage_counter(
    stage: str,
    *,
    link_id: str = "",
    destination_hash: str = "",
    packet_hash: str = "",
    byte_count: int = 0,
    wall_ms: Optional[int] = None,
) -> None:
    stage_key = str(stage or "").strip()
    if not stage_key:
        return
    now_ms = wall_ms if isinstance(wall_ms, int) and wall_ms > 0 else _now_wall_ms()
    link_key = str(link_id or "").strip()
    destination_key = str(destination_hash or "").strip().lower()
    packet_key = str(packet_hash or "").strip().lower()
    with _state_lock:
        if destination_key:
            mapped_link_id = _audio_stage_link_id_by_destination_hash.get(destination_key)
            if mapped_link_id and not link_key:
                link_key = mapped_link_id
        if link_key and destination_key:
            _bind_audio_stage_destination_to_link_locked(destination_key, link_key)
        if link_key:
            counters = _audio_stage_counters_by_link_id.setdefault(link_key, {})
        elif destination_key:
            counters = _audio_stage_counters_by_destination_hash.setdefault(destination_key, {})
        else:
            return
        count_key = f"{stage_key}Count"
        window_key = f"{stage_key}Window"
        last_key = f"{stage_key}LastAtMs"
        counters[count_key] = int(counters.get(count_key) or 0) + 1
        counters[window_key] = int(counters.get(window_key) or 0) + 1
        counters[last_key] = now_ms
        counters["lastStage"] = stage_key
        counters["lastStageAtMs"] = now_ms
        if packet_key:
            counters["lastPacket"] = packet_key
        if destination_key:
            counters["destinationHash"] = destination_key
        if byte_count > 0:
            byte_key = f"{stage_key}Bytes"
            counters[byte_key] = int(counters.get(byte_key) or 0) + max(0, int(byte_count or 0))


def _maybe_log_audio_stage_counters(now_ms: Optional[int] = None, force: bool = False) -> None:
    global _audio_stage_counter_last_log_at_ms
    current_ms = now_ms if isinstance(now_ms, int) and now_ms > 0 else _now_wall_ms()
    if (
        not force
        and _audio_stage_counter_last_log_at_ms > 0
        and current_ms - _audio_stage_counter_last_log_at_ms < _AUDIO_STAGE_COUNTER_LOG_INTERVAL_MS
    ):
        return
    rows: List[Tuple[str, str, str, bool, Dict[str, Any]]] = []
    with _state_lock:
        link_ids = set(_audio_stage_counters_by_link_id.keys()) | set(_audio_links_by_id.keys())
        for link_key in sorted(link_ids):
            state = _audio_links_by_id.get(link_key) or {}
            counters = _audio_stage_counters_by_link_id.setdefault(link_key, {})
            rows.append(
                (
                    link_key,
                    str(state.get("peerPresenceHash") or ""),
                    str(state.get("peerDestinationHash") or counters.get("destinationHash") or ""),
                    state.get("incoming") is True,
                    dict(counters),
                )
            )
            for key in list(counters.keys()):
                if key.endswith("Window"):
                    counters[key] = 0
        orphan_items = list(_audio_stage_counters_by_destination_hash.items())[:8]
        for destination_key, counters in orphan_items:
            rows.append((f"dest:{destination_key}", "", destination_key, False, dict(counters)))
            for key in list(counters.keys()):
                if key.endswith("Window"):
                    counters[key] = 0
    if not rows:
        return
    _audio_stage_counter_last_log_at_ms = current_ms
    for link_key, peer_hash, destination_hash, incoming, counters in rows:
        def count(name: str) -> int:
            return int(counters.get(f"{name}Count") or 0)

        def window(name: str) -> int:
            return int(counters.get(f"{name}Window") or 0)

        def age(name: str) -> str:
            last_ms = int(counters.get(f"{name}LastAtMs") or 0)
            return str(max(0, current_ms - last_ms)) if last_ms > 0 else "never"

        log(
            f"[presence_bridge] {_AUDIO_IPC_LOG} stage=rns-audio-stage-counters "
            f"link={_short_route(link_key)} incoming={'yes' if incoming else 'no'} "
            f"peer={_short_route(peer_hash)} dest={_short_route(destination_hash)} "
            f"shared={count('shared')}/{window('shared')}/{age('shared')} "
            f"raw={count('raw')}/{window('raw')}/{age('raw')} "
            f"link_receive={count('link_receive')}/{window('link_receive')}/{age('link_receive')} "
            f"callback_dispatch={count('callback_dispatch')}/{window('callback_dispatch')}/{age('callback_dispatch')} "
            f"callback_start={count('callback_start')}/{window('callback_start')}/{age('callback_start')} "
            f"bridge_rx={count('bridge_rx')}/{window('bridge_rx')}/{age('bridge_rx')} "
            f"fd4={count('fd4')}/{window('fd4')}/{age('fd4')} "
            f"decrypt_failed={count('decrypt_failed')}/{window('decrypt_failed')}/{age('decrypt_failed')} "
            f"callback_missing={count('callback_missing')}/{window('callback_missing')}/{age('callback_missing')} "
            f"last_stage={counters.get('lastStage') or 'none'} "
            f"last_packet={_short_route(counters.get('lastPacket'))}"
        )


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


def _log_bridge_event_timing_anomaly(event_name: str, detail: str) -> None:
    """Throttled diagnostics for Python→Electron event delivery."""
    key = str(event_name or "unknown")
    now = time.monotonic()
    last = float(_bridge_event_timing_log_last_by_event.get(key) or 0.0)
    if now - last < _AUDIO_TIMING_LOG_THROTTLE_SECONDS:
        return
    _bridge_event_timing_log_last_by_event[key] = now
    if len(_bridge_event_timing_log_last_by_event) > 256:
        for old_key in list(_bridge_event_timing_log_last_by_event.keys())[:64]:
            _bridge_event_timing_log_last_by_event.pop(old_key, None)
    log(f"[presence_bridge] target=presence-reticulum event_delivery {detail}")


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
        lock = _audio_data_plane_send_locks.get(id(conn))
        if lock is not None:
            with lock:
                conn.sendall(bytes(header) + data)
        else:
            conn.sendall(bytes(header) + data)
        return True
    except Exception as exc:
        _log_audio_data_plane("ws-send-failed", f"err={str(exc)[:160]}")
        return False


def _ws_send_binary(conn: socket.socket, data: bytes) -> bool:
    try:
        header = bytearray([0x82])
        if len(data) < 126:
            header.append(len(data))
        elif len(data) < 65536:
            header.extend([126, (len(data) >> 8) & 0xFF, len(data) & 0xFF])
        else:
            header.extend([127])
            header.extend(len(data).to_bytes(8, "big"))
        lock = _audio_data_plane_send_locks.get(id(conn))
        if lock is not None:
            with lock:
                conn.sendall(bytes(header) + data)
        else:
            conn.sendall(bytes(header) + data)
        return True
    except Exception as exc:
        _log_audio_data_plane("ws-binary-send-failed", f"err={str(exc)[:160]}")
        return False


def _audio_data_plane_send_inbound_audio_now(chunk: bytes) -> bool:
    global _audio_data_plane_first_inbound_sent
    with _audio_data_plane_lock:
        clients = list(_audio_data_plane_clients.values())
    if not clients:
        return False
    sent = 0
    failed = 0
    for conn in clients:
        if _ws_send_binary(conn, chunk):
            sent += 1
        else:
            failed += 1
    if sent > 0 and not _audio_data_plane_first_inbound_sent:
        _audio_data_plane_first_inbound_sent = True
        _log_audio_data_plane(
            "first-inbound-binary-sent",
            f"bytes={len(chunk)} clients={sent} failed={failed}",
        )
    return sent > 0


def _audio_data_plane_inbound_sender_loop() -> None:
    while not _shutdown.is_set():
        try:
            queued = _audio_data_plane_inbound_queue.get(timeout=0.25)
        except queue.Empty:
            continue
        if queued is None:
            return
        queued_at, chunk = queued
        age_ms = max(0.0, (time.monotonic() - queued_at) * 1000.0)
        if age_ms > _AUDIO_DATA_PLANE_STALE_MS:
            continue
        _audio_data_plane_send_inbound_audio_now(chunk)


def _audio_data_plane_broadcast_inbound_audio(chunk: bytes) -> bool:
    global _audio_data_plane_inbound_queue_drops
    if not _audio_data_plane_direct_inbound_enabled:
        return False
    with _audio_data_plane_lock:
        if not _audio_data_plane_clients:
            return False
    item = (time.monotonic(), bytes(chunk))
    try:
        _audio_data_plane_inbound_queue.put_nowait(item)
        return True
    except queue.Full:
        pass
    try:
        _audio_data_plane_inbound_queue.get_nowait()
        _audio_data_plane_inbound_queue_drops += 1
    except queue.Empty:
        pass
    try:
        _audio_data_plane_inbound_queue.put_nowait(item)
        if _audio_data_plane_inbound_queue_drops % 100 == 1:
            _log_audio_data_plane(
                "inbound-queue-pressure",
                f"drops={_audio_data_plane_inbound_queue_drops} max={_AUDIO_DATA_PLANE_INBOUND_QUEUE_MAX}",
            )
        return True
    except queue.Full:
        _audio_data_plane_inbound_queue_drops += 1
        return False


def _audio_data_plane_should_take_inbound_media(room_id: str) -> bool:
    if not _audio_data_plane_direct_inbound_enabled:
        return False
    normalized = str(room_id or "").strip().lower()
    if normalized.startswith(_audio_data_plane_direct_room_prefixes):
        return True
    return _audio_data_plane_direct_group_inbound_enabled


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
            _audio_data_plane_send_locks[client_id] = threading.RLock()
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
            _audio_data_plane_send_locks.pop(client_id, None)
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
    global _audio_data_plane_inbound_sender_thread
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
            if (
                _audio_data_plane_inbound_sender_thread is None
                or not _audio_data_plane_inbound_sender_thread.is_alive()
            ):
                _audio_data_plane_inbound_sender_thread = threading.Thread(
                    target=_audio_data_plane_inbound_sender_loop,
                    name="gcall-audio-data-plane-inbound",
                    daemon=True,
                )
                _audio_data_plane_inbound_sender_thread.start()
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


def _normalize_audio_forward_route(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    address = str(raw.get("address") or "").strip()
    if not address:
        return None
    transport = "packet" if raw.get("transport") == "packet" else "link"
    link_id = str(raw.get("linkId") or "").strip()
    peer_presence_hash = str(raw.get("peerPresenceHash") or "").strip().lower()
    peer_destination_hash = str(raw.get("peerDestinationHash") or "").strip().lower()
    if transport == "link" and not link_id:
        return None
    if transport == "packet" and not peer_presence_hash and not peer_destination_hash:
        return None
    return {
        "address": address,
        "transport": transport,
        "linkId": link_id,
        "peerPresenceHash": peer_presence_hash,
        "peerDestinationHash": peer_destination_hash,
    }


def _configure_audio_forwarding_plans(plans: Any) -> Tuple[int, int]:
    next_plans: Dict[str, Dict[str, Any]] = {}
    rule_count = 0
    if isinstance(plans, list):
        for raw_plan in plans[:64]:
            if not isinstance(raw_plan, dict):
                continue
            room_id = str(raw_plan.get("roomId") or "").strip()
            if not room_id or room_id.lower().startswith(_audio_data_plane_direct_room_prefixes):
                continue
            try:
                topology_epoch = max(0, int(raw_plan.get("topologyEpoch") or 0))
            except Exception:
                topology_epoch = 0
            rules = []
            raw_rules = raw_plan.get("rules")
            if isinstance(raw_rules, list):
                for raw_rule in raw_rules[:256]:
                    if not isinstance(raw_rule, dict):
                        continue
                    source_address = str(raw_rule.get("sourceAddress") or "").strip()
                    ingress = _normalize_audio_forward_route(raw_rule.get("ingress"))
                    if not source_address or ingress is None or ingress.get("address") != source_address:
                        continue
                    targets = []
                    seen_targets = set()
                    raw_targets = raw_rule.get("targets")
                    if isinstance(raw_targets, list):
                        for raw_target in raw_targets[:_AUDIO_DATA_PLANE_MAX_ROUTES]:
                            target = _normalize_audio_forward_route(raw_target)
                            if target is None:
                                continue
                            target_address = str(target.get("address") or "")
                            target_link_id = str(target.get("linkId") or "")
                            if (
                                not target_address
                                or target_address == source_address
                                or target_address in seen_targets
                                or (target_link_id and target_link_id == str(ingress.get("linkId") or ""))
                            ):
                                continue
                            seen_targets.add(target_address)
                            targets.append(target)
                    rules.append(
                        {
                            "sourceAddress": source_address,
                            "ingress": ingress,
                            "targets": targets,
                        }
                    )
            if rules:
                next_plans[room_id] = {
                    "roomId": room_id,
                    "topologyEpoch": topology_epoch,
                    "rules": rules,
                }
                rule_count += len(rules)
    with _audio_data_plane_lock:
        _audio_forwarding_plans_by_room.clear()
        _audio_forwarding_plans_by_room.update(next_plans)
        active_rooms = set(next_plans.keys())
        for key in list(_audio_forwarding_activity_last_emit_ms.keys()):
            if key.split("|", 1)[0] not in active_rooms:
                _audio_forwarding_activity_last_emit_ms.pop(key, None)
        for room_id in list(_audio_forwarding_stats_by_room.keys()):
            if room_id not in active_rooms:
                _audio_forwarding_stats_by_room.pop(room_id, None)
    _log_audio_data_plane(
        "forward-plans-configured",
        f"rooms={len(next_plans)} rules={rule_count}",
    )
    return len(next_plans), rule_count


def _audio_forwarding_rule_for_inbound(
    room_id: str,
    link_id: str,
    peer_presence_hash: str,
    peer_destination_hash: str,
) -> Optional[Dict[str, Any]]:
    if not _audio_group_forward_fast_path_enabled:
        return None
    normalized_room = str(room_id or "").strip()
    normalized_link = str(link_id or "").strip()
    inbound_hashes = {
        value
        for value in (
            str(peer_presence_hash or "").strip().lower(),
            str(peer_destination_hash or "").strip().lower(),
        )
        if value
    }
    with _audio_data_plane_lock:
        plan = _audio_forwarding_plans_by_room.get(normalized_room)
        rules = list(plan.get("rules") or []) if isinstance(plan, dict) else []
    for rule in rules:
        ingress = rule.get("ingress") if isinstance(rule, dict) else None
        if not isinstance(ingress, dict):
            continue
        ingress_link = str(ingress.get("linkId") or "").strip()
        if normalized_link:
            # Link media is admitted only by exact verified link ownership.
            if ingress.get("transport") == "link" and ingress_link == normalized_link:
                return rule
            continue
        if ingress.get("transport") != "packet" or not inbound_hashes:
            continue
        ingress_hashes = {
            value
            for value in (
                str(ingress.get("peerPresenceHash") or "").strip().lower(),
                str(ingress.get("peerDestinationHash") or "").strip().lower(),
            )
            if value
        }
        if inbound_hashes.intersection(ingress_hashes):
            return rule
    return None


def _emit_audio_forwarding_activity(
    room_id: str,
    rule: Dict[str, Any],
    link_id: str,
    peer_presence_hash: str,
    peer_destination_hash: str,
    forwarded_targets: int,
) -> None:
    source_address = str(rule.get("sourceAddress") or "")
    key = f"{room_id}|{source_address}"
    now_ms = _now_wall_ms()
    with _audio_data_plane_lock:
        last_ms = int(_audio_forwarding_activity_last_emit_ms.get(key) or 0)
        if now_ms - last_ms < 5_000:
            return
        _audio_forwarding_activity_last_emit_ms[key] = now_ms
    emit_event(
        "group_audio_fast_path_activity",
        {
            "roomId": room_id,
            "sourceAddress": source_address,
            "linkId": link_id,
            "peerPresenceHash": peer_presence_hash,
            "peerDestinationHash": peer_destination_hash,
            "forwardedTargets": forwarded_targets,
            "receivedAtWallMs": now_ms,
        },
    )


def _note_audio_forward_fast_path(room_id: str, forwarded_targets: int) -> None:
    now_ms = _now_wall_ms()
    snapshot = None
    with _audio_data_plane_lock:
        stats = _audio_forwarding_stats_by_room.setdefault(
            room_id,
            {"frames": 0, "targets": 0, "lastLogAtMs": now_ms},
        )
        stats["frames"] = int(stats.get("frames") or 0) + 1
        stats["targets"] = int(stats.get("targets") or 0) + max(
            0, int(forwarded_targets)
        )
        last_log_at_ms = int(stats.get("lastLogAtMs") or now_ms)
        if now_ms - last_log_at_ms >= 10_000:
            snapshot = {
                "frames": int(stats.get("frames") or 0),
                "targets": int(stats.get("targets") or 0),
                "windowMs": max(1, now_ms - last_log_at_ms),
            }
            stats["frames"] = 0
            stats["targets"] = 0
            stats["lastLogAtMs"] = now_ms
    if snapshot is not None:
        _log_audio_data_plane(
            "forward-fast-path-active",
            f"room={room_id[:80]} window_ms={snapshot['windowMs']} "
            f"frames={snapshot['frames']} forwarded_targets={snapshot['targets']}",
        )


def _try_group_audio_forward_fast_path(
    room_id: str,
    link_id: str,
    peer_presence_hash: str,
    peer_destination_hash: str,
    received_at_wall_ms: int,
    raw_audio: bytes,
    encoded_inbound_chunk: bytes,
) -> bool:
    rule = _audio_forwarding_rule_for_inbound(
        room_id,
        link_id,
        peer_presence_hash,
        peer_destination_hash,
    )
    if rule is None:
        return False

    # Do not forward unless local playback has accepted the same frame. This
    # keeps the existing Electron path as an all-or-nothing fallback.
    if not _audio_data_plane_broadcast_inbound_audio(encoded_inbound_chunk):
        return False

    frames = []
    for target in list(rule.get("targets") or []):
        if not isinstance(target, dict):
            continue
        transport = "packet" if target.get("transport") == "packet" else "link"
        target_link_id = str(target.get("linkId") or "") if transport == "link" else ""
        target_presence_hash = str(target.get("peerPresenceHash") or "").strip().lower()
        target_destination_hash = str(target.get("peerDestinationHash") or "").strip().lower()
        if transport == "link" and (not target_link_id or target_link_id == link_id):
            continue
        if transport == "packet" and not target_presence_hash:
            continue
        frames.append(
            (
                target_link_id,
                room_id,
                target_presence_hash,
                target_destination_hash,
                received_at_wall_ms,
                raw_audio,
            )
        )

    if frames and not _put_audio_decoded_batch_keep_newest(frames):
        _log_audio_data_plane(
            "forward-fast-path-drop",
            f"room={room_id[:80]} source={str(rule.get('sourceAddress') or '')[:16]} "
            f"reason=decoded_queue_full targets={len(frames)}",
        )
        # Local playback already owns this realtime frame. Returning False
        # would also route it through fd4, duplicating local playback while the
        # same pressured outbound queue is unlikely to accept the retry.
        return True

    _emit_audio_forwarding_activity(
        room_id,
        rule,
        link_id,
        peer_presence_hash,
        peer_destination_hash,
        len(frames),
    )
    _note_audio_forward_fast_path(room_id, len(frames))
    return True


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
    global _audio_rns_shared_frame_gap_ms_window
    global _audio_rns_shared_frame_gap_sample_count
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
        _note_audio_stage_counter(
            "shared",
            destination_hash=destination_hex,
            packet_hash=bytes(packet_hash).hex(),
            byte_count=len(raw),
            wall_ms=now_wall_ms,
        )
        with _state_lock:
            previous_ms = int(_audio_rns_shared_frame_last_wall_ms_by_destination_hash.get(destination_hex) or 0)
            frame_gap_ms = 0
            if previous_ms > 0:
                frame_gap_ms = max(0, now_wall_ms - previous_ms)
                if frame_gap_ms > _audio_rns_shared_frame_gap_ms_max:
                    _audio_rns_shared_frame_gap_ms_max = float(frame_gap_ms)
                    _audio_rns_shared_frame_interface_worst = interface_name
                if frame_gap_ms > _audio_rns_shared_frame_gap_ms_window:
                    _audio_rns_shared_frame_gap_ms_window = float(frame_gap_ms)
                _increment_shared_frame_gap_buckets(float(frame_gap_ms))
                _record_gap_median_sample(
                    _audio_rns_shared_frame_gap_bucket_counts,
                    float(frame_gap_ms),
                )
                _audio_rns_shared_frame_gap_sample_count += 1
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
    global _audio_rns_raw_inbound_gap_ms_window
    global _audio_rns_raw_inbound_gap_sample_count
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
        _note_audio_stage_counter(
            "raw",
            destination_hash=destination_hex,
            packet_hash=bytes(packet_hash).hex(),
            byte_count=len(raw),
            wall_ms=now_wall_ms,
        )
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
                if raw_gap_ms > _audio_rns_raw_inbound_gap_ms_window:
                    _audio_rns_raw_inbound_gap_ms_window = float(raw_gap_ms)
                _increment_raw_gap_buckets(float(raw_gap_ms))
                _record_gap_median_sample(
                    _audio_rns_raw_inbound_gap_bucket_counts,
                    float(raw_gap_ms),
                )
                _audio_rns_raw_inbound_gap_sample_count += 1
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
    packet_hash = getattr(packet, "packet_hash", None)
    packet_hash_hex = bytes(packet_hash).hex() if isinstance(packet_hash, (bytes, bytearray)) else ""
    if stage == "receive_enter":
        destination_hash = getattr(packet, "destination_hash", None)
        destination_hex = (
            bytes(destination_hash).hex()
            if isinstance(destination_hash, (bytes, bytearray))
            else ""
        )
        _note_audio_stage_counter(
            "link_receive",
            link_id=link_id,
            destination_hash=destination_hex,
            packet_hash=packet_hash_hex,
            byte_count=len(getattr(packet, "data", b"") or b""),
            wall_ms=now_wall_ms,
        )
        raw_probe = None
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
                    f"interface={interface_name or 'n/a'} "
                    f"packet={_short_route(packet_hash_hex)}",
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
                    f"dest={_short_route(stats.get('peerDestinationHash'))} "
                    f"packet={_short_route(packet_hash_hex)} "
                    f"raw_probe={'yes' if raw_probe is not None else 'no'}",
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
            "packetHash": packet_hash_hex,
        }
        _prune_audio_link_receive_probe_cache()
        _mark_audio_queue_state_dirty()
        return
    if stage == "callback_dispatch":
        destination_hash = getattr(packet, "destination_hash", None)
        destination_hex = (
            bytes(destination_hash).hex()
            if isinstance(destination_hash, (bytes, bytearray))
            else ""
        )
        _note_audio_stage_counter(
            "callback_dispatch",
            link_id=link_id,
            destination_hash=destination_hex,
            packet_hash=packet_hash_hex,
            byte_count=len(getattr(packet, "data", b"") or b""),
            wall_ms=now_wall_ms,
        )
        probe = _audio_link_receive_probe_by_packet_id.get(packet_id)
        if probe is None:
            probe = {
                "linkId": link_id,
                "receiveEnterMonotonic": 0.0,
                "receiveEnterAtMs": 0,
                "packetHash": packet_hash_hex,
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
                    f"dest={_short_route(stats.get('peerDestinationHash'))} "
                    f"packet={_short_route(packet_hash_hex or str(probe.get('packetHash') or ''))}",
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
    if stage in ("decrypt_failed", "callback_missing"):
        destination_hash = getattr(packet, "destination_hash", None)
        destination_hex = (
            bytes(destination_hash).hex()
            if isinstance(destination_hash, (bytes, bytearray))
            else ""
        )
        _note_audio_stage_counter(
            stage,
            link_id=link_id,
            destination_hash=destination_hex,
            packet_hash=packet_hash_hex,
            byte_count=len(getattr(packet, "data", b"") or b""),
            wall_ms=now_wall_ms,
        )
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
    """Keep shared-instance helper RPC failures from aborting inbound frames."""
    global _rns_shared_rpc_failure_guard_installed
    if _rns_shared_rpc_failure_guard_installed:
        return

    reticulum_cls = getattr(RNS, "Reticulum", None)
    if reticulum_cls is None:
        return

    rpc_failure_types = (ConnectionResetError, BrokenPipeError, EOFError, OSError)
    safe_return_factories = {
        "_used_destination_data": lambda: False,
        "_retain_destination_data": lambda: False,
        "_unretain_destination_data": lambda: False,
        "_retain_identity": lambda: False,
        "get_blackholed_identities": list,
        "is_blackholed": lambda: False,
    }

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
                        f"method={method_name} action=ignored_nonfatal "
                        f"return={safe_return_factories[method_name]()!r} "
                        f"err={type(exc).__name__}: {exc}"
                    )
                return safe_return_factories[method_name]()

        return guarded

    installed_any = False
    for method_name in safe_return_factories:
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
        receive_gap_ms = 0
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
        stats["pressureWindowFrames"] = int(stats.get("pressureWindowFrames") or 0) + 1
        stats["pressureWindowBytes"] = int(stats.get("pressureWindowBytes") or 0) + max(0, int(byte_count or 0))
        if receive_gap_ms > int(stats.get("pressureWindowReceiveGapMsMax") or 0):
            stats["pressureWindowReceiveGapMsMax"] = receive_gap_ms
        stats["lastReceiveAtMs"] = now_ms
        stats["lastActivityAtMs"] = now_ms
        stats["lastRoomId"] = str(room_id or "")
        if transport == "link":
            _note_audio_stage_counter(
                "bridge_rx",
                link_id=route_key,
                destination_hash=peer_destination_hash,
                byte_count=max(0, int(byte_count or 0)),
                wall_ms=now_ms,
            )
        if fd4_enqueued is True:
            stats["fd4EnqueuedFrames"] = int(stats.get("fd4EnqueuedFrames") or 0) + 1
            fd4_ms = (
                fd4_enqueued_at_wall_ms
                if isinstance(fd4_enqueued_at_wall_ms, int) and fd4_enqueued_at_wall_ms > 0
                else _now_wall_ms()
            )
            if transport == "link":
                _note_audio_stage_counter(
                    "fd4",
                    link_id=route_key,
                    destination_hash=peer_destination_hash,
                    byte_count=max(0, int(byte_count or 0)),
                    wall_ms=fd4_ms,
                )
            stats["lastFd4EnqueueAtMs"] = fd4_ms
            enqueue_delay_ms = max(0, fd4_ms - now_ms)
            if enqueue_delay_ms > int(stats.get("receiveToFd4EnqueueMsMax") or 0):
                stats["receiveToFd4EnqueueMsMax"] = enqueue_delay_ms
            if enqueue_delay_ms > int(stats.get("pressureWindowFd4DelayMsMax") or 0):
                stats["pressureWindowFd4DelayMsMax"] = enqueue_delay_ms
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
        _maybe_log_audio_path_pressure(
            stats,
            transport=transport,
            route_key=route_key,
            room_id=room_id,
            peer_presence_hash=peer_presence_hash,
            peer_destination_hash=peer_destination_hash,
            now_ms=now_ms,
        )
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
            "rnsCallbackSchedulerGapMsWindow": _audio_rns_callback_scheduler_gap_ms_window,
            "rnsCallbackSchedulerGapMsMax": _audio_rns_callback_scheduler_gap_ms_max,
            "rnsCallbackSchedulerGapOver100Count": _audio_rns_callback_scheduler_gap_over_100_count,
            "rnsCallbackSchedulerGapOver250Count": _audio_rns_callback_scheduler_gap_over_250_count,
            "rnsCallbackSchedulerGapOver500Count": _audio_rns_callback_scheduler_gap_over_500_count,
            "rnsCallbackSchedulerGapOver1000Count": _audio_rns_callback_scheduler_gap_over_1000_count,
            "rnsRawInboundGapMsWindow": _audio_rns_raw_inbound_gap_ms_window,
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
            "rnsSharedFrameGapMsWindow": _audio_rns_shared_frame_gap_ms_window,
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
    _maybe_log_bridge_pressure(now)


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
                if peer_key_hint:
                    _rearm_audio_link_recovery(peer_key_hint, "send_no_canonical_link")
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
                snapshot_peer_key = str(snapshot.get("peerPresenceHash") or peer_key_hint)
                if snapshot_peer_key:
                    _rearm_audio_link_recovery(snapshot_peer_key, "send_audio_link_not_ready")
                emit_event(
                    "group_audio_send_failed",
                    {
                        "linkId": send_link_id,
                        "peerPresenceHash": snapshot_peer_key,
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
                    result, send_duration_ms = _send_packet_on_audio_link_bounded(
                        send_link_id,
                        link,
                        wire_bytes,
                        "audio_send",
                    )
                if result is None:
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
                            "reason": "packet_send_timeout",
                            "code": "packet_send_timeout",
                            "transport": "link",
                        },
                    )
                elif result is False:
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
                            current_state["consecutive_send_timeouts"] = 0
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
            result, send_duration_ms = _send_packet_to_destination_bounded(
                outbound,
                wire_bytes,
                f"target=gcall-audio-data-plane packet_audio_send peer={peer_hash}",
                timeout_seconds=_AUDIO_LINK_PACKET_SEND_TIMEOUT_SECONDS,
            )
            if result is None:
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
                        "reason": "packet_send_timeout",
                        "code": "packet_send_timeout",
                        "transport": "packet",
                    },
                )
                continue
            elif result is False:
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

    def encode_resp_frame(frame: Dict[str, Any]) -> str:
        return json.dumps(frame, separators=(",", ":")) + "\n"

    def encode_event_frame(frame: Dict[str, Any]) -> str:
        if isinstance(frame, dict):
            now_mono = time.monotonic()
            queued_mono = float(frame.get("_queuedAtMono") or 0.0)
            queued_age_ms = (
                max(0.0, (now_mono - queued_mono) * 1000.0)
                if queued_mono > 0
                else 0.0
            )
            depth_after = _json_event_depth()
            frame["_writeAtMs"] = _now_wall_ms()
            frame["_writeAtMono"] = now_mono
            frame["_eventQueueDepthAfter"] = depth_after
            if queued_age_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                event_name = str(frame.get("event") or "unknown")
                _log_bridge_event_timing_anomaly(
                    event_name,
                    f"event={event_name} queued_age_ms={queued_age_ms:.3f} "
                    f"queue_depth_before={int(frame.get('_eventQueueDepthBefore') or 0)} "
                    f"queue_depth_after={depth_after}",
                )
        return json.dumps(frame, separators=(",", ":")) + "\n"

    def write_lines(lines: list[str]) -> None:
        if not lines:
            return
        sys.stdout.write("".join(lines))
        sys.stdout.flush()

    def append_line(lines: list[str], line: str, bytes_so_far: int) -> int:
        lines.append(line)
        return bytes_so_far + len(line)

    def drain_resp_lines(max_lines: int, max_bytes: int) -> list[str]:
        nonlocal resp_closed
        lines: list[str] = []
        bytes_so_far = 0
        while not resp_closed and len(lines) < max_lines and bytes_so_far < max_bytes:
            try:
                frame = _json_resp_queue.get_nowait()
            except queue.Empty:
                break
            if frame is None:
                resp_closed = True
                break
            bytes_so_far = append_line(lines, encode_resp_frame(frame), bytes_so_far)
        return lines

    def next_event_frame_nonblocking() -> Optional[Dict[str, Any]]:
        nonlocal event_closed
        if event_closed:
            return None
        try:
            frame = _json_priority_event_queue.get_nowait()
        except queue.Empty:
            pass
        else:
            if frame is not None:
                return frame

        frame = _pop_coalesced_json_event_line()
        if frame is not None:
            return frame

        try:
            frame = _json_event_queue.get_nowait()
        except queue.Empty:
            return None
        if frame is None:
            event_closed = True
            return None
        return frame

    def drain_event_lines(max_lines: int, max_bytes: int) -> list[str]:
        lines: list[str] = []
        bytes_so_far = 0
        while not event_closed and len(lines) < max_lines and bytes_so_far < max_bytes:
            frame = next_event_frame_nonblocking()
            if frame is None:
                break
            bytes_so_far = append_line(lines, encode_event_frame(frame), bytes_so_far)
        return lines

    while True:
        resp_lines = drain_resp_lines(
            _STDOUT_RESP_BATCH_MAX,
            _STDOUT_BATCH_MAX_BYTES,
        )
        if resp_lines:
            write_lines(resp_lines)
            continue

        if resp_closed and event_closed:
            break

        event_lines = drain_event_lines(
            _STDOUT_EVENT_BATCH_MAX,
            _STDOUT_BATCH_MAX_BYTES,
        )
        if event_lines:
            write_lines(event_lines)
            continue

        if not resp_closed:
            try:
                frame = _json_resp_queue.get(timeout=0.01)
            except queue.Empty:
                frame = None
            else:
                if frame is None:
                    resp_closed = True
                else:
                    write_lines([encode_resp_frame(frame)])
                    continue

        if event_closed:
            continue
        try:
            try:
                frame = _json_priority_event_queue.get_nowait()
            except queue.Empty:
                frame = _pop_coalesced_json_event_line()
                if frame is None:
                    frame = _json_event_queue.get(timeout=0.05)
        except queue.Empty:
            continue
        if frame is None:
            event_closed = True
            continue
        lines = [encode_event_frame(frame)]
        lines.extend(
            drain_event_lines(
                max(0, _STDOUT_EVENT_BATCH_MAX - 1),
                max(0, _STDOUT_BATCH_MAX_BYTES - len(lines[0])),
            )
        )
        write_lines(lines)


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


def _gcall_control_scheduler_lane(link_id: str) -> str:
    digest = hashlib.blake2s(
        str(link_id or "unknown").encode("utf-8"), digest_size=2
    ).digest()
    shard = int.from_bytes(digest, "big") % max(1, _SCHEDULER_GCALL_CONTROL_SHARDS)
    return f"gcall-control-{shard}"


def _resource_open_scheduler_lane(peer_hash: str) -> str:
    digest = hashlib.blake2s(
        str(peer_hash or "unknown").strip().lower().encode("utf-8"),
        digest_size=2,
    ).digest()
    shard = int.from_bytes(digest, "big") % max(1, _SCHEDULER_RESOURCE_OPEN_SHARDS)
    return f"resource-open-{shard}"


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
    land_state_queued = _enqueue_latest_land_state_command(message) if isinstance(message, dict) else None
    if land_state_queued is not None:
        _emit_audio_queue_state()
        return True
    lane = _scheduler_lane_for_command(action, message)
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


def _scheduler_lane_for_command(
    action: Any,
    message: Optional[Dict[str, Any]] = None,
) -> str:
    action_name = str(action or "")
    if action_name in {"clear_group_audio_diagnostics"}:
        return "control-send"
    if action_name == "send_group_audio_link_control":
        payload = message.get("payload") if isinstance(message, dict) else None
        route_key = ""
        if isinstance(payload, dict):
            route_key = str(
                payload.get("linkId") or payload.get("peerPresenceHash") or ""
            )
        base_lane = _gcall_control_scheduler_lane(route_key)
        return base_lane.replace("gcall-control-", "gcall-control-command-", 1)
    if action_name in {
        "open_group_audio_link",
        "close_group_audio_link",
        "reset_group_audio_peer_state",
    }:
        return "audio-control"
    if action_name in {"warm_group_audio_path"}:
        return "path-management"
    if action_name in {
        "prepare_reticulum_resource_session",
        "accept_qchat_file_resource",
        "send_qchat_file_resource",
        "authorize_qchat_file_resource",
        "reject_qchat_file_resource",
        "accept_reticulum_chat_resource",
        "send_reticulum_chat_resource",
        "authorize_reticulum_chat_resource",
        "reject_reticulum_chat_resource",
        "accept_reticulum_resource",
        "send_reticulum_resource",
        "authorize_reticulum_resource",
        "reject_reticulum_resource",
        "cancel_reticulum_resource",
    }:
        return "resource-control"
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
            _maybe_log_bridge_pressure()
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
                if not _handle_rns_command_message(message, 0):
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
            try:
                message = _cmd_queue_bounded.get_nowait()
            except queue.Empty:
                queued_before_gap = _audio_decoded_queue.qsize()
                continue
            audio_queued_at_start = _audio_decoded_queue.qsize()
            if not _handle_rns_command_message(message, audio_queued_at_start):
                return
            next_lane = "audio"
            queued_before_gap = _audio_decoded_queue.qsize()
            continue


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def verbose_presence_log(message: str) -> None:
    if _PRESENCE_BRIDGE_VERBOSE_LOGS:
        log(message)


def _overlay_good_outbound_cache_path() -> str:
    if not _reticulum_config_dir:
        return ""
    return os.path.join(_reticulum_config_dir, _OVERLAY_GOOD_OUTBOUND_CACHE_FILENAME)


def _overlay_good_cache_float(value: Any, fallback: float = 0.0) -> float:
    if not isinstance(value, (int, float)):
        return fallback
    try:
        out = float(value)
    except Exception:
        return fallback
    if not math.isfinite(out):
        return fallback
    return out


def _overlay_good_cache_int(value: Any, fallback: int = 0) -> int:
    if not isinstance(value, (int, float)):
        return fallback
    try:
        out = int(value)
    except Exception:
        return fallback
    return out


def _prune_overlay_good_outbound_cache(now: Optional[float] = None) -> None:
    with _overlay_good_outbound_cache_lock:
        if now is None:
            now = time.time()
        expired = [
            peer_hash
            for peer_hash, entry in _overlay_good_outbound_cache.items()
            if not isinstance(entry, dict)
            or not _valid_presence_destination_hash_hex(peer_hash)
            or now - _overlay_good_cache_float(entry.get("last_rx_at")) > _OVERLAY_GOOD_OUTBOUND_CACHE_TTL_SECONDS
        ]
        for peer_hash in expired:
            _overlay_good_outbound_cache.pop(peer_hash, None)
        if len(_overlay_good_outbound_cache) <= _OVERLAY_GOOD_OUTBOUND_CACHE_MAX_PEERS:
            return
        ranked = sorted(
            _overlay_good_outbound_cache.items(),
            key=lambda item: (
                -_overlay_good_cache_float((item[1] or {}).get("last_rx_at")),
                -_overlay_good_cache_int((item[1] or {}).get("rx_count")),
                item[0],
            ),
        )
        keep = {peer_hash for peer_hash, _entry in ranked[:_OVERLAY_GOOD_OUTBOUND_CACHE_MAX_PEERS]}
        for peer_hash in list(_overlay_good_outbound_cache.keys()):
            if peer_hash not in keep:
                _overlay_good_outbound_cache.pop(peer_hash, None)


def _flush_overlay_good_outbound_cache(force: bool = False) -> None:
    global _overlay_good_outbound_cache_dirty, _overlay_good_outbound_cache_last_write_at
    tmp_path = ""
    with _overlay_good_outbound_cache_lock:
        if not _overlay_good_outbound_cache_dirty and not force:
            return
        path = _overlay_good_outbound_cache_path()
        if not path:
            return
        now = time.time()
        if not force and now - _overlay_good_outbound_cache_last_write_at < _OVERLAY_GOOD_OUTBOUND_CACHE_WRITE_MIN_SECONDS:
            return
        _prune_overlay_good_outbound_cache(now)
        payload = {
            "version": _OVERLAY_GOOD_OUTBOUND_CACHE_VERSION,
            "updatedAt": now,
            "peers": [
                {
                    "peerHash": peer_hash,
                    "lastRxAt": _overlay_good_cache_float(entry.get("last_rx_at")),
                    "firstRxAt": _overlay_good_cache_float(
                        entry.get("first_rx_at"),
                        _overlay_good_cache_float(entry.get("last_rx_at")),
                    ),
                    "rxCount": _overlay_good_cache_int(entry.get("rx_count")),
                }
                for peer_hash, entry in sorted(
                    _overlay_good_outbound_cache.items(),
                    key=lambda item: (-_overlay_good_cache_float((item[1] or {}).get("last_rx_at")), item[0]),
                )
            ],
        }
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp_path = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, separators=(",", ":"))
            os.replace(tmp_path, path)
            _overlay_good_outbound_cache_last_write_at = now
            _overlay_good_outbound_cache_dirty = False
        except Exception as exc:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except FileNotFoundError:
                    pass
                except Exception:
                    pass
            log(f"[presence_bridge] target=presence-reticulum overlay_good_outbound_cache_write_failed err={exc}")


def _load_overlay_good_outbound_cache() -> None:
    global _overlay_good_outbound_cache_loaded, _overlay_good_outbound_cache_dirty
    with _overlay_good_outbound_cache_lock:
        if _overlay_good_outbound_cache_loaded:
            return
        _overlay_good_outbound_cache_loaded = True
    path = _overlay_good_outbound_cache_path()
    if not path or not os.path.exists(path):
        return
    now = time.time()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            parsed = json.load(fh)
    except Exception as exc:
        log(f"[presence_bridge] target=presence-reticulum overlay_good_outbound_cache_read_failed err={exc}")
        return
    peers = parsed.get("peers") if isinstance(parsed, dict) else None
    if not isinstance(peers, list):
        return
    with _overlay_good_outbound_cache_lock:
        loaded = 0
        for item in peers:
            if not isinstance(item, dict):
                continue
            peer_hash = str(item.get("peerHash") or "").strip().lower()
            last_rx_at = _coerce_epoch_seconds(item.get("lastRxAt"))
            if not _valid_presence_destination_hash_hex(peer_hash) or last_rx_at is None:
                continue
            if now - last_rx_at > _OVERLAY_GOOD_OUTBOUND_CACHE_TTL_SECONDS:
                _overlay_good_outbound_cache_dirty = True
                continue
            first_rx_at = _coerce_epoch_seconds(item.get("firstRxAt")) or last_rx_at
            _overlay_good_outbound_cache[peer_hash] = {
                "first_rx_at": first_rx_at,
                "last_rx_at": last_rx_at,
                "rx_count": max(1, _overlay_good_cache_int(item.get("rxCount"), 1)),
            }
            loaded += 1
        _prune_overlay_good_outbound_cache(now)
        retained = len(_overlay_good_outbound_cache)
        dirty = _overlay_good_outbound_cache_dirty
    log(
        "[presence_bridge] target=presence-reticulum overlay_good_outbound_cache_loaded "
        f"peers={loaded} retained={retained}"
    )
    if dirty:
        _flush_overlay_good_outbound_cache(force=True)


def _note_good_outbound_overlay_rx(peer_hash: str) -> None:
    global _overlay_good_outbound_cache_dirty
    peer_key = str(peer_hash or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer_key):
        return
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return
    with _overlay_good_outbound_cache_lock:
        now = time.time()
        entry = _overlay_good_outbound_cache.get(peer_key) or {}
        entry["first_rx_at"] = float(entry.get("first_rx_at") or now)
        entry["last_rx_at"] = now
        entry["rx_count"] = int(entry.get("rx_count") or 0) + 1
        _overlay_good_outbound_cache[peer_key] = entry
        _overlay_good_outbound_cache_dirty = True
    _flush_overlay_good_outbound_cache()


def _seed_overlay_good_outbound_cache_candidates() -> None:
    if disable_bootstrap:
        log("[presence_bridge] target=presence-reticulum overlay_good_outbound_cache_seed_skipped disabled=true")
        return
    _load_overlay_good_outbound_cache()
    with _overlay_good_outbound_cache_lock:
        cache_items = list(_overlay_good_outbound_cache.items())
    if not cache_items:
        return
    now = time.time()
    seeded = 0
    for peer_hash, entry in sorted(
        cache_items,
        key=lambda item: (-_overlay_good_cache_float((item[1] or {}).get("last_rx_at")), item[0]),
    ):
        if seeded >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        last_rx_at = _coerce_epoch_seconds(entry.get("last_rx_at"))
        if last_rx_at is None or now - last_rx_at > _OVERLAY_GOOD_OUTBOUND_CACHE_TTL_SECONDS:
            continue
        if not _overlay_peer_available_for_new_outbound(peer_hash):
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "bootstrap_cache")
        _mark_candidate_peer(peer_hash, "bootstrap_cache")
        seeded += 1
    if seeded:
        log(
            "[presence_bridge] target=presence-reticulum overlay_good_outbound_cache_seeded "
            f"candidates={seeded}"
        )


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return False


def _compact_interface_value(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        if isinstance(value, float):
            return f"{value:.3f}".rstrip("0").rstrip(".")
        return str(value)
    return str(value or "").replace(",", "_").replace(" ", "_")[:80]


def _compact_interface_detail(item: Dict[str, Any]) -> str:
    name = str(item.get("name") or item.get("short_name") or item.get("ifac_name") or "")
    interface_type = str(item.get("type") or item.get("ifac_type") or "")
    online = as_bool(item.get("status"))
    parts = [
        f"name={name.replace(',', '_')[:80] or 'unknown'}",
        f"type={interface_type.replace(',', '_')[:48] or 'unknown'}",
        f"online={'yes' if online else 'no'}",
    ]
    wanted_keys = (
        "rxb",
        "txb",
        "rxs",
        "txs",
        "rx",
        "tx",
        "rx_bytes",
        "tx_bytes",
        "rx_bitrate",
        "tx_bitrate",
        "bitrate",
        "clients",
        "peers",
        "held_announces",
        "announces",
    )
    for key in wanted_keys:
        if key in item:
            parts.append(f"{key}={_compact_interface_value(item.get(key))}")
    return "{" + ";".join(parts) + "}"


def _collect_rns_interface_pressure_summary(max_interfaces: int = 12) -> str:
    if _reticulum is None:
        return "reticulum=not-started"
    try:
        stats = _reticulum.get_interface_stats() or {}
    except Exception as exc:
        return f"error={str(exc).replace(' ', '_')[:120]}"
    interfaces = stats.get("interfaces")
    if not isinstance(interfaces, list):
        interfaces = []
    details = [
        _compact_interface_detail(item)
        for item in interfaces[:max_interfaces]
        if isinstance(item, dict)
    ]
    omitted = max(0, len(interfaces) - len(details))
    top_parts = [
        f"transport={'on' if 'transport_id' in stats else 'off'}",
        f"interfaces={len(interfaces)}",
    ]
    for key in ("transport_id", "rss", "ifac_size", "path_table_size", "link_count"):
        if key in stats:
            top_parts.append(f"{key}={_compact_interface_value(stats.get(key))}")
    if omitted > 0:
        top_parts.append(f"omitted={omitted}")
    return " ".join(top_parts) + " details=" + "|".join(details)


def _maybe_log_rns_interface_pressure(
    gap_ms: float,
    *,
    reason: str,
    now: Optional[float] = None,
) -> None:
    global _rns_interface_pressure_last_log_at
    if gap_ms < _BRIDGE_PRESSURE_RNS_GAP_THRESHOLD_MS:
        return
    if now is None:
        now = time.monotonic()
    if now - _rns_interface_pressure_last_log_at < _RNS_INTERFACE_PRESSURE_LOG_INTERVAL_SECONDS:
        return
    _rns_interface_pressure_last_log_at = now
    log(
        "[presence_bridge] rns_interface_pressure "
        f"reason={reason} gap_ms={int(gap_ms)} "
        f"{_collect_rns_interface_pressure_summary()}"
    )


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
    global _audio_rns_callback_scheduler_gap_ms_window
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
        if elapsed_ms > _audio_rns_callback_scheduler_gap_ms_window:
            _audio_rns_callback_scheduler_gap_ms_window = elapsed_ms
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


def overlay_transport_maintenance_loop() -> None:
    last_announce_at = 0.0
    while True:
        try:
            if _destination is not None:
                now = time.time()
                if now - last_announce_at >= RNS_ANNOUNCE_INTERVAL_SEC:
                    announce_reason = (
                        "transport_initial"
                        if last_announce_at <= 0.0
                        else "transport_periodic"
                    )
                    try:
                        announce_local_destination(announce_reason)
                    except Exception as exc:
                        log(f"[presence_bridge] rns announce {announce_reason} failed: {exc}")
                    last_announce_at = now
                _seed_overlay_good_outbound_cache_candidates()
                _run_overlay_sync_maintenance("overlay_transport_periodic")
                pinged = _ping_established_overlay_links("periodic")
                with _state_lock:
                    active = len(_active_overlay_neighbors)
                    inbound = len(_inbound_overlay_neighbors)
                    links = len(_overlay_links_by_id)
                verbose_presence_log(
                    "[presence_bridge] target=presence-reticulum overlay_transport_sync "
                    f"outbound={active} inbound={inbound} links={links} pinged={pinged}"
                )
        except Exception as exc:
            log(
                "[presence_bridge] target=presence-reticulum overlay_transport_sync_failed "
                f"err={exc}"
            )
        time.sleep(_OVERLAY_TRANSPORT_MAINTENANCE_INTERVAL_SECONDS)


def ensure_overlay_transport_maintenance_started() -> None:
    global _overlay_transport_maintenance_thread
    if (
        _overlay_transport_maintenance_thread is not None
        and _overlay_transport_maintenance_thread.is_alive()
    ):
        return
    _overlay_transport_maintenance_thread = threading.Thread(
        target=overlay_transport_maintenance_loop,
        daemon=True,
        name="reticulum-overlay-transport-maintenance",
    )
    _overlay_transport_maintenance_thread.start()


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
    if source in ("inbound", "wire_kr", "gcall_join"):
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
    if (
        peer_key in _active_overlay_neighbors
        or peer_key in _inbound_overlay_neighbors
        or _overlay_peer_is_admitted(peer_key)
    ):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum candidate_skipped "
            f"peer_hash={peer_key} source={source} reason=already_admitted"
        )
        _candidate_peers.pop(peer_key, None)
        return
    if _overlay_peer_inbound_full(peer_key):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum candidate_skipped "
            f"peer_hash={peer_key} source={source} reason=peer_inbound_full"
        )
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


def _parse_presence_announce_capacity(app_data: Any) -> Optional[bool]:
    if app_data is None:
        return None
    if isinstance(app_data, dict):
        inbound_full = app_data.get("inboundFull")
        if isinstance(inbound_full, bool):
            return inbound_full
        inbound_free = app_data.get("inboundFree")
        if isinstance(inbound_free, int):
            return inbound_free <= 0
        return None
    if isinstance(app_data, str):
        raw = app_data.strip().encode("utf-8", errors="ignore")
    elif isinstance(app_data, (bytes, bytearray)):
        raw = bytes(app_data).strip()
    else:
        return None
    if raw == _PRESENCE_ANNOUNCE_APP_DATA_FULL:
        return True
    if raw in (_PRESENCE_ANNOUNCE_APP_DATA_OPEN, b"presence-open"):
        return False
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(decoded, dict):
        return None
    inbound_full = decoded.get("inboundFull")
    if isinstance(inbound_full, bool):
        return inbound_full
    inbound_free = decoded.get("inboundFree")
    if isinstance(inbound_free, int):
        return inbound_free <= 0
    return None


def _note_peer_inbound_capacity_hint(peer_key: str, app_data: Any) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    inbound_full = _parse_presence_announce_capacity(app_data)
    if inbound_full is None:
        return
    now = time.time()
    st = _peer_lifecycle.setdefault(
        peer_key,
        {
            "last_seen_inbound": None,
            "last_send_ok": None,
            "last_request_path_at": None,
            "ts_seed_until": None,
        },
    )
    if inbound_full:
        st["overlay_inbound_full_until"] = now + _PEER_INBOUND_FULL_HINT_TTL_SECONDS
        _candidate_peers.pop(peer_key, None)
    else:
        st.pop("overlay_inbound_full_until", None)
    st["overlay_inbound_full_last_seen"] = now


def _overlay_peer_inbound_full(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    st = _peer_lifecycle.get(peer_key) or {}
    until = st.get("overlay_inbound_full_until")
    if not isinstance(until, (int, float)):
        return False
    now = time.time()
    if float(until) <= now:
        st.pop("overlay_inbound_full_until", None)
        return False
    return True


def _overlay_peer_available_for_new_outbound(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    if _overlay_peer_is_suppressed(peer_key):
        return False
    if _overlay_peer_inbound_full(peer_key) and not _overlay_peer_has_established_link(peer_key):
        return False
    return True


def _note_overlay_peer_alive(peer_key: str, source: str) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    if _overlay_peer_failures.pop(peer_key, None) is not None:
        log(
            "[presence_bridge] target=presence-reticulum overlay_peer_failure_reset "
            f"peer={peer_key} source={source}"
        )
    st = _peer_lifecycle.get(peer_key)
    if isinstance(st, dict):
        had_unestablished_failures = int(st.get("unestablished_link_failures") or 0)
        for key in (
            "unestablished_link_failures",
            "last_unestablished_link_failure_at",
            "last_unestablished_link_failure_reason",
            "last_unestablished_link_path_request_at",
            "last_unestablished_link_path_request_reason",
        ):
            st.pop(key, None)
        if had_unestablished_failures > 0:
            log(
                "[presence_bridge] target=presence-reticulum hard_path_refresh_failure_reset "
                f"peer={peer_key} source={source} failures={had_unestablished_failures}"
            )


def _clear_overlay_peer_failure_for_recovery(peer_key: str, reason: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    state = _overlay_peer_failures.pop(peer_key, None)
    if state is None:
        return False
    log(
        "[presence_bridge] target=presence-reticulum overlay_peer_failure_reset "
        f"peer={peer_key} source={reason}"
    )
    return True


def _note_overlay_peer_failure(peer_key: str, reason: str) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _overlay_failure_should_suppress(reason):
        return
    now = time.time()
    state = _overlay_peer_failures.get(peer_key) or {}
    count = int(state.get("count") or 0) + 1
    suppress_until = state.get("suppress_until")
    if count >= _OVERLAY_LINK_FAILURE_SUPPRESS_LIMIT:
        suppress_seconds = min(
            _OVERLAY_LINK_FAILURE_SUPPRESS_MAX_SECONDS,
            _OVERLAY_LINK_FAILURE_SUPPRESS_SECONDS
            * (2 ** max(0, count - _OVERLAY_LINK_FAILURE_SUPPRESS_LIMIT)),
        )
        suppress_until = now + suppress_seconds
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
    verified_peers: list[Dict[str, Any]],
    active_neighbor_hashes: list[str],
    account_endpoint_leases: Optional[list[Dict[str, Any]]] = None,
) -> None:
    global _verified_overlay_peers, _account_endpoint_leases
    now = time.time()
    local_hex = _local_presence_hash_hex()
    next_verified: Dict[str, Dict[str, Any]] = {}
    for peer in verified_peers:
        if not isinstance(peer, dict):
            continue
        peer_hash = str(peer.get("destinationHash") or "").strip().lower()
        last_seen = peer.get("lastSeen")
        if not peer_hash or not isinstance(last_seen, (int, float)):
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
            "last_seen": float(last_seen),
        }
    next_leases: Dict[str, Dict[str, Dict[str, Any]]] = {}
    raw_leases = (
        list(account_endpoint_leases)
        if isinstance(account_endpoint_leases, list)
        else []
    )
    # Compatibility with a main process that still sends the former embedded
    # address. It is short-lived and never restores the old immutable mapping.
    if not raw_leases:
        for peer in verified_peers:
            if not isinstance(peer, dict):
                continue
            address = str(peer.get("address") or "").strip()
            peer_hash = str(peer.get("destinationHash") or "").strip().lower()
            last_seen = peer.get("lastSeen")
            last_seen_seconds = _coerce_epoch_seconds(last_seen)
            if address and peer_hash and last_seen_seconds is not None:
                raw_leases.append(
                    {
                        "address": address,
                        "destinationHash": peer_hash,
                        "sessionId": "legacy-overlay-sync",
                        "lastSeen": last_seen,
                        "expiresAt": (last_seen_seconds + 95.0) * 1000.0,
                        "verification": "direct-legacy",
                    }
                )
    verification_rank = {
        "relayed-bound": 1,
        "direct-legacy": 2,
        "direct-bound": 3,
    }
    for lease in raw_leases:
        if not isinstance(lease, dict):
            continue
        address = str(lease.get("address") or "").strip()
        peer_hash = str(lease.get("destinationHash") or "").strip().lower()
        session_id = str(lease.get("sessionId") or "").strip()
        verification = str(lease.get("verification") or "").strip()
        last_seen_seconds = _coerce_epoch_seconds(lease.get("lastSeen"))
        expires_seconds = _coerce_epoch_seconds(lease.get("expiresAt"))
        if (
            not address
            or not _valid_presence_destination_hash_hex(peer_hash)
            or not session_id
            or verification not in verification_rank
            or last_seen_seconds is None
            or expires_seconds is None
            or expires_seconds <= now
        ):
            continue
        by_destination = next_leases.setdefault(address, {})
        existing = by_destination.get(peer_hash)
        candidate = {
            "address": address,
            "destination_hash": peer_hash,
            "session_id": session_id,
            "last_seen": last_seen_seconds,
            "expires_at": expires_seconds,
            "verification": verification,
        }
        if existing is None or (
            verification_rank[verification],
            last_seen_seconds,
        ) > (
            verification_rank.get(str(existing.get("verification") or ""), 0),
            float(existing.get("last_seen") or 0),
        ):
            by_destination[peer_hash] = candidate
    # Game/proximity services can resolve routes from their own threads. Swap
    # both views atomically so account switching cannot expose a new transport
    # snapshot with stale account ownership (or the reverse).
    with _state_lock:
        _verified_overlay_peers = next_verified
        _account_endpoint_leases = next_leases

    for peer_hash in list(_active_overlay_neighbors.keys()):
        if not _overlay_peer_has_established_link(peer_hash):
            _active_overlay_neighbors.pop(peer_hash, None)
    _prune_candidate_peers()

    seeded_candidates = 0
    for raw_hash in active_neighbor_hashes:
        if len(_active_overlay_neighbors) + len(_candidate_peers) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        peer_hash = str(raw_hash or "").strip().lower()
        if not peer_hash:
            continue
        if local_hex and peer_hash == local_hex:
            continue
        if not _overlay_peer_available_for_new_outbound(peer_hash):
            continue
        if peer_hash in _active_overlay_neighbors or peer_hash in _candidate_peers or peer_hash in _inbound_overlay_neighbors:
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        if peer_hash not in _known_peers:
            continue
        _mark_candidate_peer(peer_hash, "overlay_sync")
        seeded_candidates += 1
    if len(_active_overlay_neighbors) + len(_candidate_peers) < _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        candidates: list[tuple[float, str]] = []
        direct_cutoff = now - _OVERLAY_DIRECT_ACTIVITY_BACKFILL_SECONDS
        for peer_hash, peer in next_verified.items():
            peer_key = str(peer_hash or "").strip().lower()
            if (
                not peer_key
                or peer_key in _active_overlay_neighbors
                or peer_key in _candidate_peers
                or peer_key in _inbound_overlay_neighbors
                or (local_hex and peer_key == local_hex)
                or not _overlay_peer_available_for_new_outbound(peer_key)
            ):
                continue
            activity = _overlay_peer_direct_activity_score(peer_key)
            if activity <= direct_cutoff:
                continue
            candidates.append((activity, peer_key))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        for _last_seen, peer_key in candidates:
            if len(_active_overlay_neighbors) + len(_candidate_peers) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
                break
            if peer_key not in _known_peers:
                ensure_known_peer_from_recall(peer_key, "ts_seed")
            if peer_key not in _known_peers:
                continue
            _mark_candidate_peer(peer_key, "overlay_sync_backfill")
            seeded_candidates += 1
    publish_fanout_count = len(set(_active_overlay_neighbors.keys()) | set(_inbound_overlay_neighbors.keys()))
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_sync "
        f"verified={len(_verified_overlay_peers)} outbound_fanout={len(_active_overlay_neighbors)} "
        f"inbound_fanout={len(_inbound_overlay_neighbors)} "
        f"candidates={len(_candidate_peers)} "
        f"publish_fanout={publish_fanout_count} "
        f"seeded_candidates={seeded_candidates}"
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
        return bool(state is not None and _overlay_link_is_fanout_usable(state))


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


def _overlay_peer_direct_activity_score(peer_hash: str) -> float:
    st = _peer_lifecycle.get(str(peer_hash or "").strip().lower()) or {}
    score = 0.0
    for key in ("last_seen_inbound", "last_send_ok"):
        value = _coerce_epoch_seconds(st.get(key))
        if value is not None:
            score = max(score, value)
    return score


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
        if not _overlay_peer_has_established_link(peer_hash):
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
        if not _overlay_peer_has_established_link(peer_hash):
            continue
        if not _overlay_peer_recently_rx_active(peer_hash, now):
            _inbound_overlay_neighbors.pop(peer_hash, None)
            continue
        _inbound_overlay_neighbors[peer_hash] = now
        out.append(peer_hash)
    return out[:(_OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_INBOUND_NEIGHBORS)]


def _snapshot_established_overlay_neighbor_hashes(
    exclude_hashes: Optional[list[str]] = None,
) -> list[str]:
    exclude = {
        str(h).strip().lower() for h in (exclude_hashes or []) if str(h).strip()
    }
    local_hex = _local_presence_hash_hex()
    out: list[str] = []
    with _state_lock:
        candidates = list(_active_overlay_neighbors.keys()) + list(_inbound_overlay_neighbors.keys())
        for peer_hash in candidates:
            peer_key = str(peer_hash or "").strip().lower()
            if not peer_key or peer_key in exclude or peer_key in out:
                continue
            if local_hex and peer_key == local_hex:
                continue
            if _overlay_peer_is_suppressed(peer_key):
                continue
            link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
            state = _overlay_links_by_id.get(link_id) if link_id else None
            if (
                state is None
                or not _overlay_link_is_fanout_usable(state)
            ):
                continue
            out.append(peer_key)
    return out[:(_OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_INBOUND_NEIGHBORS)]


def _overlay_peer_is_admitted(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        state = _overlay_links_by_id.get(link_id) if link_id else None
        return bool(state is not None and _overlay_link_is_fanout_usable(state))


def _overlay_peer_is_outbound(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    return bool(peer_key and peer_key in _active_overlay_neighbors)


def _overlay_peer_is_inbound(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    return bool(peer_key and peer_key in _inbound_overlay_neighbors)


def _promote_recent_verified_overlay_neighbors(
    reason: str, exclude_hashes: Optional[Set[str]] = None
) -> int:
    _prune_candidate_peers()
    if len(_active_overlay_neighbors) + len(_candidate_peers) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        return 0
    exclude = {
        str(h).strip().lower() for h in (exclude_hashes or set()) if str(h).strip()
    }
    local_hex = _local_presence_hash_hex()
    candidates: list[tuple[float, str]] = []
    direct_cutoff = time.time() - _OVERLAY_DIRECT_ACTIVITY_BACKFILL_SECONDS
    for peer_hash, peer in _verified_overlay_peers.items():
        peer_key = str(peer_hash or "").strip().lower()
        if not peer_key:
            continue
        if local_hex and peer_key == local_hex:
            continue
        if not _overlay_peer_available_for_new_outbound(peer_key):
            continue
        if (
            peer_key in exclude
            or peer_key in _active_overlay_neighbors
            or peer_key in _candidate_peers
            or peer_key in _inbound_overlay_neighbors
        ):
            continue
        activity = _overlay_peer_direct_activity_score(peer_key)
        if activity <= direct_cutoff:
            continue
        candidates.append((activity, peer_key))
    if not candidates:
        return 0
    candidates.sort(key=lambda item: (-item[0], item[1]))
    selected: list[str] = []
    for _last_seen, peer_key in candidates:
        if len(_active_overlay_neighbors) + len(_candidate_peers) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            break
        if peer_key not in _known_peers:
            ensure_known_peer_from_recall(peer_key, "ts_seed")
        if peer_key not in _known_peers:
            continue
        _mark_candidate_peer(peer_key, f"promote:{reason}")
        selected.append(peer_key)
    if selected:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_candidate_promote "
            f"reason={reason} selected={len(selected)} candidates={len(_candidate_peers)} "
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
    if isinstance(last_in, (int, float)):
        return (0, -float(last_in), peer_key)
    if isinstance(last_ok, (int, float)):
        return (1, -float(last_ok), peer_key)
    if isinstance(lease, (int, float)) and float(lease) > now:
        # TS seed leases prove Electron wants the peer, not that we recently
        # heard from it. Prefer real RX/send activity when recovering fanout.
        return (2, -float(lease), peer_key)
    return (3, 0.0, peer_key)


def _bootstrap_overlay_neighbors_if_degraded(reason: str) -> int:
    """
    Recover from a drained or low-fanout overlay by temporarily seeding fanout
    from known Reticulum overlay destinations.

    This only creates send targets. Peers become overlay-admitted after
    Reticulum-level HELLO/PING/PONG traffic; Qortal presence is separate.
    """
    _prune_candidate_peers()
    if len(_active_overlay_neighbors) >= _OVERLAY_MIN_HEALTHY_FANOUT:
        return 0
    local_hex = _local_presence_hash_hex()
    candidates: list[str] = []
    for peer_key in list(_known_peers.keys()):
        if not _valid_presence_destination_hash_hex(peer_key):
            continue
        if local_hex and peer_key == local_hex:
            continue
        if not _overlay_peer_available_for_new_outbound(peer_key):
            continue
        if (
            peer_key in _active_overlay_neighbors
            or peer_key in _inbound_overlay_neighbors
            or peer_key in _candidate_peers
        ):
            continue
        candidates.append(peer_key)
    if not candidates:
        return 0
    candidates.sort(key=_overlay_bootstrap_peer_sort_key)
    needed = max(
        0,
        _OVERLAY_BOOTSTRAP_MAX_OUTBOUND_NEIGHBORS
        - len(_active_overlay_neighbors)
        - len(_candidate_peers),
    )
    selected = candidates[:needed]
    for peer_key in selected:
        _mark_candidate_peer(peer_key, f"bootstrap:{reason}")
    log(
        "[presence_bridge] target=presence-reticulum overlay_bootstrap "
        f"reason={reason} selected={len(selected)} active={len(_active_overlay_neighbors)} "
        f"candidates={len(_candidate_peers)} "
        f"known_peers={len(_known_peers)} "
        f"fanout_hashes={','.join(selected)}"
    )
    return len(selected)


def _recover_zero_overlay_fanout(reason: str) -> int:
    """
    Break the suppression deadlock after the overlay drains completely.

    Suppression prevents churn while we still have usable peers. With zero
    overlay links, it can also prevent recovery, so retry only the best known
    peers and let normal RX-based verification decide whether they stay good.
    """
    global _last_overlay_zero_fanout_recovery_at
    with _state_lock:
        has_usable_overlay_link = any(
            _overlay_link_is_fanout_usable(state)
            for state in _overlay_links_by_id.values()
        )
    if has_usable_overlay_link:
        return 0
    now = time.time()
    if (
        _last_overlay_zero_fanout_recovery_at > 0
        and now - _last_overlay_zero_fanout_recovery_at
        < _OVERLAY_ZERO_FANOUT_RECOVERY_COOLDOWN_SECONDS
    ):
        return 0
    local_hex = _local_presence_hash_hex()
    pool: Set[str] = set(_active_overlay_neighbors.keys())
    pool.update(_verified_overlay_peers.keys())
    pool.update(_candidate_peers.keys())
    pool.update(_known_peers.keys())
    candidates: list[str] = []
    for raw_peer in pool:
        peer_key = str(raw_peer or "").strip().lower()
        if not _valid_presence_destination_hash_hex(peer_key):
            continue
        if local_hex and peer_key == local_hex:
            continue
        if _overlay_peer_inbound_full(peer_key):
            continue
        if peer_key not in _known_peers:
            ensure_known_peer_from_recall(peer_key, "ts_seed")
        if peer_key not in _known_peers:
            continue
        candidates.append(peer_key)
    if not candidates:
        return 0
    candidates = sorted(set(candidates), key=_overlay_bootstrap_peer_sort_key)
    selected = candidates[:_OVERLAY_PENDING_UNESTABLISHED_LIMIT]
    _last_overlay_zero_fanout_recovery_at = now
    cleared = 0
    queued = 0
    for peer_key in selected:
        if _clear_overlay_peer_failure_for_recovery(peer_key, f"zero_fanout:{reason}"):
            cleared += 1
        _mark_candidate_peer(peer_key, f"zero_fanout:{reason}")
        if _overlay_enqueue_peer_recovery(
            peer_key,
            f"zero_fanout:{reason}",
            force_refresh=True,
        ):
            queued += 1
    log(
        "[presence_bridge] target=presence-reticulum overlay_zero_fanout_recover "
        f"reason={reason} selected={len(selected)} cleared_suppression={cleared} "
        f"queued_recovery={queued} known_peers={len(_known_peers)} "
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
    has_path = _reticulum_has_path(h)
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


def _reticulum_has_path(destination_hash: bytes) -> bool:
    """Return path availability from the owner of the active path table.

    Local Transport state is authoritative for an embedded Reticulum instance.
    When this bridge is a client of shared rnsd, however, a local miss does not
    mean the daemon has no route. In that case query the daemon through its
    bounded RPC and briefly cache the answer.
    """
    try:
        if RNS.Transport.has_path(destination_hash):
            return True
    except Exception:
        pass
    reticulum = _reticulum
    if (
        reticulum is None
        or getattr(reticulum, "is_connected_to_shared_instance", False) is not True
        or not hasattr(reticulum, "get_path_snapshot")
    ):
        return False
    cache_key = destination_hash_hex(destination_hash)
    now = time.monotonic()
    with _reticulum_path_availability_cache_lock:
        cached = _reticulum_path_availability_cache.get(cache_key)
    if cached is not None and now - cached[0] <= (
        _RETICULUM_PATH_POSITIVE_CACHE_SECONDS
        if cached[1]
        else _RETICULUM_PATH_NEGATIVE_CACHE_SECONDS
    ):
        return cached[1]
    available = False
    try:
        available = isinstance(reticulum.get_path_snapshot(destination_hash), dict)
    except Exception:
        available = False
    with _reticulum_path_availability_cache_lock:
        _reticulum_path_availability_cache[cache_key] = (now, available)
        if len(_reticulum_path_availability_cache) > 512:
            oldest = min(
                _reticulum_path_availability_cache,
                key=lambda key: _reticulum_path_availability_cache[key][0],
            )
            _reticulum_path_availability_cache.pop(oldest, None)
    return available


def _invalidate_reticulum_path_availability(destination_hash: bytes) -> None:
    with _reticulum_path_availability_cache_lock:
        _reticulum_path_availability_cache.pop(
            destination_hash_hex(destination_hash),
            None,
        )


def _reticulum_path_snapshot(destination_hash: bytes) -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "has_path": False,
        "hops": None,
        "next_hop": "",
        "interface": "",
        "timestamp": None,
        "expires": None,
        "packet": "",
    }
    try:
        if _reticulum is not None and hasattr(_reticulum, "get_path_snapshot"):
            snapshot = _reticulum.get_path_snapshot(destination_hash)
            if isinstance(snapshot, dict):
                info["has_path"] = True
                hops = snapshot.get("hops")
                info["hops"] = int(hops) if isinstance(hops, int) else None
                next_hop = snapshot.get("via")
                if isinstance(next_hop, (bytes, bytearray)):
                    info["next_hop"] = bytes(next_hop).hex()
                info["interface"] = str(snapshot.get("interface") or "")
                info["timestamp"] = snapshot.get("timestamp")
                info["expires"] = snapshot.get("expires")
                packet_hash = snapshot.get("packet")
                if isinstance(packet_hash, (bytes, bytearray)):
                    info["packet"] = bytes(packet_hash).hex()
                elif packet_hash is not None:
                    info["packet"] = str(packet_hash)
                return info
    except Exception:
        pass
    try:
        info["has_path"] = bool(RNS.Transport.has_path(destination_hash))
    except Exception:
        info["has_path"] = False
    if not info["has_path"]:
        return info
    try:
        hops = RNS.Transport.hops_to(destination_hash)
        if isinstance(hops, int):
            info["hops"] = hops
    except Exception:
        pass
    try:
        next_hop = RNS.Transport.next_hop(destination_hash)
        if isinstance(next_hop, (bytes, bytearray)):
            info["next_hop"] = bytes(next_hop).hex()
    except Exception:
        pass
    try:
        iface = RNS.Transport.next_hop_interface(destination_hash)
        if iface is not None:
            info["interface"] = str(iface)
    except Exception:
        pass
    try:
        path_table = getattr(RNS.Transport, "path_table", None)
        entry = path_table.get(destination_hash) if isinstance(path_table, dict) else None
        if isinstance(entry, (list, tuple)):
            if len(entry) > 0 and isinstance(entry[0], (int, float)):
                info["timestamp"] = float(entry[0])
            if len(entry) > 3 and isinstance(entry[3], (int, float)):
                info["expires"] = float(entry[3])
            if len(entry) > 6:
                packet_hash = entry[6]
                if isinstance(packet_hash, (bytes, bytearray)):
                    info["packet"] = bytes(packet_hash).hex()
                elif packet_hash is not None:
                    info["packet"] = str(packet_hash)
    except Exception:
        pass
    return info


def _rns_link_id_bytes(link: Any) -> Optional[bytes]:
    value = getattr(link, "link_id", None) if link is not None else None
    if not isinstance(value, (bytes, bytearray)):
        return None
    value = bytes(value)
    return value if value else None


def _reticulum_link_route_snapshot(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    link = state.get("link")
    rns_link_id = _rns_link_id_bytes(link)
    if rns_link_id is None:
        return None
    try:
        if _reticulum is not None and hasattr(_reticulum, "get_link_route_snapshot"):
            snapshot = _reticulum.get_link_route_snapshot(rns_link_id)
        elif hasattr(RNS.Transport, "link_route_snapshot"):
            snapshot = RNS.Transport.link_route_snapshot(rns_link_id)
        else:
            snapshot = None
    except Exception:
        snapshot = None
    return snapshot if isinstance(snapshot, dict) else None


def _format_reticulum_path_snapshot(info: Dict[str, Any]) -> str:
    hops = info.get("hops")
    hops_label = str(hops) if isinstance(hops, int) else "na"
    next_hop = str(info.get("next_hop") or "na")
    interface = str(info.get("interface") or "na").replace(" ", "_")
    timestamp = info.get("timestamp")
    expires = info.get("expires")
    age_ms = (
        str(max(0, int((time.time() - float(timestamp)) * 1000.0)))
        if isinstance(timestamp, (int, float)) and float(timestamp) > 0
        else "na"
    )
    expires_in_ms = (
        str(int((float(expires) - time.time()) * 1000.0))
        if isinstance(expires, (int, float))
        else "na"
    )
    packet = str(info.get("packet") or "na")
    return (
        f"has_path={str(info.get('has_path') is True).lower()} "
        f"hops={hops_label} next_hop={next_hop} interface={interface} "
        f"age_ms={age_ms} expires_in_ms={expires_in_ms} packet={packet}"
    )


def _drop_reticulum_path(destination_hash: bytes) -> bool:
    _invalidate_reticulum_path_availability(destination_hash)
    dropped = False
    try:
        if _reticulum is not None and hasattr(_reticulum, "drop_path"):
            dropped = bool(_reticulum.drop_path(destination_hash))
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum hard_path_refresh_drop_failed "
            f"peer={destination_hash_hex(destination_hash)} via=reticulum err={exc}"
        )
    try:
        dropped = bool(RNS.Transport.expire_path(destination_hash)) or dropped
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum hard_path_refresh_drop_failed "
            f"peer={destination_hash_hex(destination_hash)} via=transport err={exc}"
        )
    try:
        RNS.Transport.mark_path_unresponsive(destination_hash)
    except Exception:
        pass
    return dropped


def _path_snapshot_is_fresh(
    before: Dict[str, Any],
    after: Dict[str, Any],
    refresh_started_at: float,
) -> bool:
    if after.get("has_path") is not True:
        return False
    after_timestamp = after.get("timestamp")
    if isinstance(after_timestamp, (int, float)) and float(after_timestamp) >= refresh_started_at:
        return True
    before_packet = str(before.get("packet") or "")
    after_packet = str(after.get("packet") or "")
    if after_packet and before_packet and after_packet != before_packet:
        return True
    before_had_path = before.get("has_path") is True
    if (
        not before_had_path
        and isinstance(after_timestamp, (int, float))
        and float(after_timestamp) > 0
    ):
        return True
    return False


def _await_fresh_destination_path(
    destination_hash: bytes,
    timeout_seconds: float,
    before: Dict[str, Any],
    refresh_started_at: float,
) -> tuple[bool, Dict[str, Any]]:
    if timeout_seconds <= 0:
        after = _reticulum_path_snapshot(destination_hash)
        return _path_snapshot_is_fresh(before, after, refresh_started_at), after
    deadline = time.time() + timeout_seconds
    after = _reticulum_path_snapshot(destination_hash)
    while True:
        after = _reticulum_path_snapshot(destination_hash)
        if _path_snapshot_is_fresh(before, after, refresh_started_at):
            return True, after
        remaining = deadline - time.time()
        if remaining <= 0:
            return False, after
        time.sleep(min(_PACKET_PATH_POLL_INTERVAL_SECONDS, remaining))


def _force_overlay_peer_path_refresh(
    peer_hash: str,
    *,
    target: str,
    reason: str,
    cooldown_seconds: float = _OVERLAY_LINK_HARD_REFRESH_COOLDOWN_SECONDS,
    await_seconds: Optional[float] = None,
) -> bool:
    peer = str(peer_hash or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer):
        return False
    try:
        destination_hash = bytes.fromhex(peer)
    except Exception:
        return False

    now = time.time()
    st = _lifecycle_state_for_peer(peer)
    last_refresh = st.get("last_overlay_link_hard_refresh_at") if st is not None else None
    if (
        isinstance(last_refresh, (int, float))
        and now - float(last_refresh) < cooldown_seconds
    ):
        log(
            f"[presence_bridge] target={target} overlay_hard_path_refresh_skipped "
            f"peer={peer} reason=recent_hard_refresh trigger={reason} "
            f"age_ms={int((now - float(last_refresh)) * 1000.0)}"
        )
        return False

    before = _reticulum_path_snapshot(destination_hash)
    refresh_started_at = time.time()
    dropped = _drop_reticulum_path(destination_hash)
    if st is not None:
        st["last_overlay_link_hard_refresh_at"] = now
        st["last_overlay_link_hard_refresh_reason"] = reason
        st["last_request_path_at"] = now
    log(
        f"[presence_bridge] target={target} overlay_hard_path_refresh "
        f"peer={peer} dropped={str(dropped).lower()} trigger={reason} "
        f"before={_format_reticulum_path_snapshot(before)}"
    )
    resolved = False
    try:
        RNS.Transport.request_path(destination_hash)
        wait_seconds = (
            _UNESTABLISHED_LINK_HARD_REFRESH_AWAIT_SECONDS
            if await_seconds is None
            else max(0.0, float(await_seconds or 0.0))
        )
        resolved, after = _await_fresh_destination_path(
            destination_hash,
            wait_seconds,
            before,
            refresh_started_at,
        )
        log(
            f"[presence_bridge] target={target} overlay_hard_path_refresh_request "
            f"peer={peer} resolved={str(resolved).lower()} "
            f"await={wait_seconds:.3f} "
            f"after={_format_reticulum_path_snapshot(after)}"
        )
    except Exception as exc:
        log(
            f"[presence_bridge] target={target} overlay_hard_path_refresh_request_failed "
            f"peer={peer} trigger={reason} err={exc}"
        )
    try:
        announce_local_destination(
            f"overlay_hard_path_refresh peer={peer[:16]} trigger={reason}"
        )
    except Exception as exc:
        log(
            f"[presence_bridge] target={target} overlay_hard_path_refresh_announce_failed "
            f"peer={peer} trigger={reason} err={exc}"
        )
    return resolved


def _peer_has_recent_direct_activity(peer_key: str, now: Optional[float] = None) -> bool:
    peer = str(peer_key or "").strip().lower()
    if not peer:
        return False
    if now is None:
        now = time.time()
    st = _peer_lifecycle.get(peer) or {}
    for key in ("last_seen_inbound", "last_send_ok"):
        value = st.get(key)
        if isinstance(value, (int, float)) and now - float(value) <= _DIRECT_LINK_PATH_PROVEN_SECONDS:
            return True
    return False


def _request_fresh_link_path(
    destination_hash: bytes,
    peer_key: str,
    *,
    target: str,
    reason: str,
    await_seconds: float,
    force_refresh: bool,
) -> bool:
    peer = str(peer_key or "").strip().lower()
    had_path = _reticulum_has_path(destination_hash)
    before = _reticulum_path_snapshot(destination_hash)
    now = time.time()
    if had_path and not force_refresh:
        log(
            f"[presence_bridge] target={target} path_ready "
            f"peer={peer or destination_hash_hex(destination_hash)} source=recent_activity"
        )
        return True
    if had_path and force_refresh:
        _drop_reticulum_path(destination_hash)
        log(
            f"[presence_bridge] target={target} cached_path_force_refresh "
            f"peer={peer or destination_hash_hex(destination_hash)} reason={reason}"
        )
    refresh_started_at = time.time()
    try:
        RNS.Transport.request_path(destination_hash)
        st = _peer_lifecycle.setdefault(
            peer,
            {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            },
        ) if peer else None
        if st is not None:
            st["last_request_path_at"] = now
        log(
            f"[presence_bridge] target={target} path_request_sent "
            f"peer={peer or destination_hash_hex(destination_hash)} "
            f"had_path={str(had_path).lower()} force_refresh={str(force_refresh).lower()} "
            f"reason={reason}"
        )
    except Exception as exc:
        log(
            f"[presence_bridge] target={target} path_request_failed "
            f"peer={peer or destination_hash_hex(destination_hash)} reason={reason} err={exc}"
        )
        return False
    if await_seconds <= 0:
        return False
    if force_refresh:
        resolved, after = _await_fresh_destination_path(
            destination_hash,
            await_seconds,
            before,
            refresh_started_at,
        )
    else:
        resolved = _await_destination_path(destination_hash, await_seconds)
        after = _reticulum_path_snapshot(destination_hash)
    log(
        f"[presence_bridge] target={target} path_await "
        f"peer={peer or destination_hash_hex(destination_hash)} "
        f"resolved={str(resolved).lower()} await={await_seconds} reason={reason} "
        f"after={_format_reticulum_path_snapshot(after)}"
    )
    return resolved


def _lifecycle_state_for_peer(peer_key: str) -> Optional[Dict[str, Any]]:
    peer = str(peer_key or "").strip().lower()
    if not peer:
        return None
    return _peer_lifecycle.setdefault(
        peer,
        {
            "last_seen_inbound": None,
            "last_send_ok": None,
            "last_request_path_at": None,
            "ts_seed_until": None,
        },
    )


def _peer_has_recent_unestablished_link_failure(
    peer_key: str,
    *,
    within_seconds: float = _UNESTABLISHED_LINK_PATH_REQUEST_COOLDOWN_SECONDS,
) -> bool:
    peer = str(peer_key or "").strip().lower()
    if not peer:
        return False
    st = _peer_lifecycle.get(peer) or {}
    failures = int(st.get("unestablished_link_failures") or 0)
    failed_at = st.get("last_unestablished_link_failure_at")
    return (
        failures > 0
        and isinstance(failed_at, (int, float))
        and time.time() - float(failed_at) <= within_seconds
    )


def _nudge_cached_reticulum_path(
    destination_hash: bytes,
    peer_key: str,
    *,
    target: str,
    reason: str,
    cooldown_seconds: float,
) -> bool:
    peer = str(peer_key or "").strip().lower()
    now = time.time()
    st = _lifecycle_state_for_peer(peer)
    last_nudge = st.get("last_cached_path_nudge_at") if st is not None else None
    if isinstance(last_nudge, (int, float)) and now - float(last_nudge) < cooldown_seconds:
        return False
    try:
        RNS.Transport.request_path(destination_hash)
        if st is not None:
            st["last_request_path_at"] = now
            st["last_cached_path_nudge_at"] = now
            st["last_cached_path_nudge_reason"] = reason
        log(
            f"[presence_bridge] target={target} cached_path_nudge "
            f"peer={peer or destination_hash_hex(destination_hash)} reason={reason}"
        )
        return True
    except Exception as exc:
        log(
            f"[presence_bridge] target={target} cached_path_nudge_failed "
            f"peer={peer or destination_hash_hex(destination_hash)} reason={reason} err={exc}"
        )
        return False


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
    # Proven packet traffic is stronger evidence than either the child or
    # daemon path table and keeps the media hot path free of shared-instance RPC.
    if (recent_ok or recent_inbound) and not recent_fail:
        return "fresh"
    if not _reticulum_has_path(destination_hash):
        if str(state.get("path_state") or "unknown") == "unknown":
            return "unknown"
        return str(state.get("path_state") or "unknown")
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
    force_refresh_cached_path: bool = False,
    nudge_cached_path: bool = False,
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
    should_request = force_refresh_cached_path or not (
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
                force_refresh_cached_path=force_refresh_cached_path,
                nudge_cached_path=nudge_cached_path,
                peer_key=peer_hash,
                target="reticulum-audio-link",
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
            resolved = _reticulum_has_path(destination_hash)
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
    if not force_refresh_cached_path:
        resolved = _reticulum_has_path(destination_hash)
    else:
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
        return _reticulum_has_path(destination_hash)
    deadline = time.time() + timeout_seconds
    while True:
        resolved = _reticulum_has_path(destination_hash)
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
    force_refresh_cached_path: bool = False,
    nudge_cached_path: bool = False,
    peer_key: str = "",
    target: str = "presence-reticulum",
) -> tuple[bool, bool]:
    before: Optional[Dict[str, Any]] = None
    refresh_started_at = 0.0
    if _reticulum_has_path(destination_hash):
        if not force_refresh_cached_path:
            if nudge_cached_path:
                _nudge_cached_reticulum_path(
                    destination_hash,
                    peer_key,
                    target=target,
                    reason=f"{log_context}:cached_path_open",
                    cooldown_seconds=_UNPROVEN_CACHED_PATH_NUDGE_COOLDOWN_SECONDS,
                )
            return True, False
        before = _reticulum_path_snapshot(destination_hash)
        _drop_reticulum_path(destination_hash)
        refresh_started_at = time.time()
        log(
            f"[presence_bridge] target={target} cached_path_force_refresh "
            f"peer={peer_key or destination_hash_hex(destination_hash)} "
            f"reason={log_context}:refresh_cached_path"
        )

    requested = False
    try:
        RNS.Transport.request_path(destination_hash)
        requested = True
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum path_request_failed "
            f"{log_context} err={exc}"
        )
        return False, requested

    if force_refresh_cached_path and before is not None:
        resolved, after = _await_fresh_destination_path(
            destination_hash,
            timeout_seconds,
            before,
            refresh_started_at,
        )
        log(
            f"[presence_bridge] target={target} path_force_refresh_await "
            f"peer={peer_key or destination_hash_hex(destination_hash)} "
            f"resolved={str(resolved).lower()} await={timeout_seconds} "
            f"after={_format_reticulum_path_snapshot(after)}"
        )
        return resolved, requested

    return _await_destination_path(destination_hash, timeout_seconds), requested


def _nudge_overlay_link_path(
    peer_key: str,
    destination_hash: bytes,
    *,
    await_seconds: float = 0.0,
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if _reticulum_has_path(destination_hash):
        if _peer_has_recent_direct_activity(peer_key):
            return True
        nudged = _nudge_cached_reticulum_path(
            destination_hash,
            peer_key,
            target="presence-reticulum",
            reason="overlay_link_cached_path_unproven",
            cooldown_seconds=_UNPROVEN_CACHED_PATH_NUDGE_COOLDOWN_SECONDS,
        )
        settle_seconds = min(
            _OVERLAY_LINK_CACHED_PATH_SETTLE_SECONDS,
            max(0.0, float(await_seconds or 0.0)),
        )
        if nudged and settle_seconds > 0:
            log(
                "[presence_bridge] target=presence-reticulum "
                "overlay_link_cached_path_settle "
                f"peer={peer_key} await={settle_seconds}"
            )
            time.sleep(settle_seconds)
        return True

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
        inbound_full = _parse_presence_announce_capacity(app_data)
        log(
            f"[presence_bridge] received announce peer={peer_hash} app_data_len={app_data_len} "
            f"inbound_full={inbound_full if inbound_full is not None else 'unknown'}"
        )
        _register_peer(peer_hash, announced_identity, "announce")
        _note_peer_inbound_capacity_hint(peer_hash, app_data)
        _mark_candidate_peer(peer_hash, "announce")
        _retry_pending_overlay_connect_on_announce(peer_hash)
        _retry_pending_audio_connect_on_announce(peer_hash)
        _maybe_schedule_overlay_route_migration(peer_hash, "announce")


def build_outbound_destination(peer_identity):
    return RNS.Destination(
        peer_identity,
        RNS.Destination.OUT,
        RNS.Destination.SINGLE,
        APP_NAMESPACE,
        PRESENCE_ASPECT,
        PRESENCE_VERSION,
    )


def _resolve_verified_game_peer(address: str, preferred_hash: str = "") -> Optional[str]:
    target = str(address or "").strip()
    preferred = str(preferred_hash or "").strip().lower()
    if not target:
        return None
    now = time.time()
    with _state_lock:
        leases = _account_endpoint_leases.get(target) or {}
        if preferred:
            details = leases.get(preferred)
            return (
                preferred
                if isinstance(details, dict)
                and float(details.get("expires_at") or 0) > now
                else None
            )
        ranked = sorted(
            (
                details
                for details in leases.values()
                if isinstance(details, dict)
                and float(details.get("expires_at") or 0) > now
            ),
            key=lambda details: (
                {"direct-bound": 3, "direct-legacy": 2, "relayed-bound": 1}.get(
                    str(details.get("verification") or ""), 0
                ),
                float(details.get("last_seen") or 0),
            ),
            reverse=True,
        )
        if ranked:
            return str(ranked[0].get("destination_hash") or "") or None
    return None


def _qortalland_game_link_peer_hash(link: Any) -> str:
    identity = _overlay_link_remote_identity(link)
    return (
        derive_presence_destination_hash_for_identity(identity)
        if identity is not None
        else ""
    )


def _qortalland_local_destination_hash() -> str:
    return destination_hash_hex(_destination.hash) if _destination is not None else ""


def _identify_qortalland_private_link(link: Any) -> None:
    if _identity is None:
        raise RuntimeError("reticulum_identity_unavailable")
    link.identify(_identity)


def _enqueue_game_control(fn: Callable[..., Any], args: tuple) -> bool:
    return _enqueue_scheduler_task(
        "game-control",
        f"qortalland-game:{getattr(fn, '__name__', 'command')}",
        fn,
        *args,
    )


def _enqueue_proximity_media(fn: Callable[..., Any], args: tuple) -> bool:
    return _enqueue_scheduler_task(
        "proximity-media",
        f"qortalland-proximity:{getattr(fn, '__name__', 'media')}",
        fn,
        *args,
        drop_oldest=True,
    )


def _encode_qortalland_proximity_discovery(wire: Dict[str, Any]) -> Optional[bytes]:
    try:
        capability = wire.get("c")
        if not isinstance(capability, dict):
            return None
        compact = [
            int(capability["protocolVersion"]),
            _b58decode(str(capability["signerPublicKey"])),
            bytes.fromhex(str(capability["ephemeralPublicKey"])),
            bytes.fromhex(str(capability["destinationHash"])),
            int(capability["groupId"]),
            str(capability["landSessionId"]),
            uuid.UUID(str(capability["instanceId"])).bytes,
            int(capability["createdAt"]),
            int(capability["expiresAt"]) - int(capability["createdAt"]),
            _b58decode(str(wire["z"])),
            wire.get("e") is True,
            str(wire.get("u") or ""),
            wire.get("b") is True,
            int(wire["ts"]),
            int(wire.get("p") or 0),
            bytes.fromhex(str(wire["j"])),
        ]
        if (
            len(compact[1]) != 32 or len(compact[2]) != 32 or len(compact[3]) != 16
            or len(compact[9]) != 64 or len(compact[15]) != 64
            or not 0 <= compact[14] <= 3
            or not 0 < compact[8] <= 4 * 60 * 60 * 1000
        ):
            return None
        raw = _QORTAL_LAND_PROXIMITY_DISCOVERY_PREFIX + umsgpack.packb(compact)
        return raw if len(raw) <= _MAX_ENCRYPTED_WIRE_BYTES else None
    except Exception:
        return None


def _decode_qortalland_proximity_discovery(raw: bytes) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, (bytes, bytearray)) or not raw.startswith(_QORTAL_LAND_PROXIMITY_DISCOVERY_PREFIX):
        return None
    try:
        compact = umsgpack.unpackb(bytes(raw[len(_QORTAL_LAND_PROXIMITY_DISCOVERY_PREFIX):]))
        if not isinstance(compact, list) or len(compact) != 16:
            return None
        public_key = bytes(compact[1])
        ephemeral_key = bytes(compact[2])
        destination_hash = bytes(compact[3])
        nonce = ephemeral_key
        wallet_signature = bytes(compact[9])
        announcement_signature = bytes(compact[15])
        instance_bytes = bytes(compact[6])
        if (
            len(public_key) != 32 or len(ephemeral_key) != 32 or len(destination_hash) != 16 or len(nonce) != 32
            or len(wallet_signature) != 64 or len(announcement_signature) != 64
            or len(instance_bytes) != 16
            or compact[0] != 1
            or not isinstance(compact[4], int) or isinstance(compact[4], bool)
            or not 0 < compact[4] <= 0x7FFFFFFF
            or not isinstance(compact[5], str) or not 0 < len(compact[5]) <= 24
            or not isinstance(compact[7], int) or isinstance(compact[7], bool)
            or not isinstance(compact[8], int) or isinstance(compact[8], bool)
            or not 0 < compact[8] <= 4 * 60 * 60 * 1000
            or not isinstance(compact[10], bool) or not isinstance(compact[12], bool)
            or not isinstance(compact[11], str) or not 0 < len(compact[11]) <= 64
            or not isinstance(compact[13], int) or isinstance(compact[13], bool)
            or not isinstance(compact[14], int) or isinstance(compact[14], bool)
            or not 0 <= compact[14] <= 3
        ):
            return None
        public_key_b58 = _b58encode(public_key)
        address = derive_qortal_address(public_key_b58)
        capability = {
            "type": "QORTAL_LAND_PROXIMITY_VOICE_SESSION",
            "protocolVersion": int(compact[0]),
            "address": address,
            "signerPublicKey": public_key_b58,
            "ephemeralPublicKey": ephemeral_key.hex(),
            "destinationHash": destination_hash.hex(),
            "groupId": str(int(compact[4])),
            "landSessionId": str(compact[5]),
            "instanceId": str(uuid.UUID(bytes=instance_bytes)),
            "nonce": nonce.hex(),
            "createdAt": int(compact[7]),
            "expiresAt": int(compact[7]) + int(compact[8]),
        }
        signature_b58 = _b58encode(wallet_signature)
        capability_hash = hashlib.sha256(
            json.dumps(capability, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            + wallet_signature
        ).hexdigest()
        return {
            "t": "QLPV1", "v": int(compact[0]), "e": compact[10],
            "a": address, "g": str(int(compact[4])), "s": str(compact[5]),
            "u": str(compact[11]), "b": compact[12], "ts": int(compact[13]),
            "p": compact[14], "c": capability, "z": signature_b58,
            "h": capability_hash, "j": announcement_signature.hex(),
        }
    except Exception:
        return None


def _broadcast_qortalland_proximity(wire: Dict[str, Any]) -> None:
    wire_bytes = _encode_qortalland_proximity_discovery(wire)
    if wire_bytes is None:
        return
    group_id = str(wire.get("g") or "")
    with _land_state_forwarding_lock:
        targets = list((_land_state_forwarding_plans.get(int(group_id)) or {}).items()) if group_id.isdigit() else []
    now = time.time()
    for peer_hash, expires_at in targets:
        if float(expires_at or 0) > now:
            _send_wire_to_overlay_peer(peer_hash, wire_bytes, "qortalland_proximity", queue_if_pending=False)


def _forward_qortalland_proximity(wire: Dict[str, Any], source_peer_hash: str) -> None:
    now = time.time()
    dedupe_key = hashlib.sha256(
        f"{wire.get('a')}:{wire.get('h')}:{wire.get('ts')}:{wire.get('e')}".encode("utf-8")
    ).hexdigest()[:24]
    with _land_state_forwarding_lock:
        for key, seen_at in list(_qortalland_proximity_discovery_seen.items()):
            if now - seen_at > 30.0:
                _qortalland_proximity_discovery_seen.pop(key, None)
        if dedupe_key in _qortalland_proximity_discovery_seen:
            return
        _qortalland_proximity_discovery_seen[dedupe_key] = now
        raw_group_id = wire.get("g")
        try:
            group_id = int(raw_group_id)
        except (TypeError, ValueError):
            group_id = 0
        targets = dict(_land_state_forwarding_plans.get(group_id) or {}) if group_id > 0 else {}
    hops = wire.get("p")
    if not isinstance(hops, int) or isinstance(hops, bool) or hops >= 3:
        return
    forwarded = {**wire, "p": hops + 1}
    wire_bytes = _encode_qortalland_proximity_discovery(forwarded)
    if wire_bytes is None:
        return
    source = str(source_peer_hash or "").strip().lower()
    for peer_hash, expires_at in targets.items():
        if peer_hash != source and float(expires_at or 0) > now:
            _send_wire_to_overlay_peer(peer_hash, wire_bytes, "qortalland_proximity", queue_if_pending=False)


def _refresh_qortalland_game_path(peer_hash: str, reason: str) -> bool:
    """Recover game routes without discarding a route that has not failed.

    A missing bridge-local identity/path can occur while shared rnsd still has
    a valid route. Only an actual failed private-link attempt justifies the
    destructive path replacement; discovery misses receive a harmless announce
    nudge instead.
    """
    peer = str(peer_hash or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer):
        return False
    destination_hash = bytes.fromhex(peer)
    if reason == "game_link_attempt_closed":
        return _force_overlay_peer_path_refresh(
            peer,
            target="qortalland-game",
            reason=reason,
            await_seconds=0.0,
        )
    requested = _nudge_cached_reticulum_path(
        destination_hash,
        peer,
        target="qortalland-game",
        reason=reason,
        cooldown_seconds=1.0,
    )
    return requested or _reticulum_has_path(destination_hash)


def _ensure_qortalland_game_manager() -> Optional[QortalLandGameManager]:
    global _qortalland_game_manager
    if _qortalland_game_manager is None:
        _qortalland_game_manager = QortalLandGameManager(
            emit=lambda _event, _payload: None,
            log=log,
            resolve_peer=_resolve_verified_game_peer,
            resolve_identity=_get_group_audio_peer_identity,
            build_destination=build_outbound_destination,
            link_id_bytes=lambda link: _rns_link_id_bytes(link) or b"",
            enqueue=_enqueue_game_control,
            enqueue_proximity_media=_enqueue_proximity_media,
            refresh_path=_refresh_qortalland_game_path,
            broadcast_proximity=_broadcast_qortalland_proximity,
            resolve_link_peer_hash=_qortalland_game_link_peer_hash,
            local_destination_hash=_qortalland_local_destination_hash,
            identify_link=_identify_qortalland_private_link,
            path_available=_reticulum_has_path,
        )
    return _qortalland_game_manager


def get_overlay_link_id(link) -> Optional[str]:
    if link is None:
        return None
    with _state_lock:
        return _overlay_link_ids_by_object.get(id(link))


def get_overlay_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        return _overlay_links_by_id.get(link_id)


def _ensure_managed_link_fields(
    state: Dict[str, Any],
    *,
    kind: str,
    desired_state: str = _LINK_STATE_IDLE,
) -> Dict[str, Any]:
    if "manager_kind" not in state:
        state["manager_kind"] = kind
    if "manager_state" not in state:
        if state.get("established") is True:
            state["manager_state"] = _LINK_STATE_ESTABLISHED
        else:
            state["manager_state"] = desired_state
    if "generation" not in state:
        state["generation"] = 0
    if "last_failure_reason" not in state:
        state["last_failure_reason"] = ""
    if "backoff_until" not in state:
        state["backoff_until"] = 0.0
    return state


def _managed_link_generation_matches(
    kind: str,
    link_id: str,
    generation: int,
    link: Any = None,
) -> bool:
    table = _overlay_links_by_id if kind == "overlay" else _audio_links_by_id
    with _state_lock:
        state = table.get(link_id)
        if state is None:
            return False
        if link is not None and state.get("link") is not link:
            return False
        return int(state.get("generation") or 0) == int(generation)


def _set_link_manager_generation(link: Any, state: Dict[str, Any]) -> None:
    if link is None:
        return
    try:
        setattr(link, "_qortal_manager_generation", int(state.get("generation") or 0))
    except Exception:
        pass


def _link_manager_generation_current(kind: str, link_id: str, link: Any) -> bool:
    generation = getattr(link, "_qortal_manager_generation", None)
    if not isinstance(generation, int):
        return True
    return _managed_link_generation_matches(kind, link_id, generation, link)


def _overlay_io_lane_for_peer(peer_hash: str) -> str:
    try:
        shard = int(str(peer_hash or "")[:8], 16) % 2
    except Exception:
        shard = 0
    return f"overlay-io-{shard}"


def _overlay_enqueue_open(
    peer_hash: str,
    reason: str,
    *,
    await_path: bool = False,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        existing_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        existing = _overlay_links_by_id.get(existing_id) if existing_id else None
        if existing is not None:
            _ensure_managed_link_fields(existing, kind="overlay")
            if _overlay_link_is_fanout_usable(existing):
                return False
            if not _overlay_open_reason_replaces_unusable_active(reason):
                return False
        if peer_key in _overlay_open_pending_by_peer_hash:
            return False
        _overlay_open_pending_by_peer_hash.add(peer_key)
    queued = _enqueue_scheduler_task(
        _overlay_io_lane_for_peer(peer_key),
        f"overlay-open:{reason}:{peer_key[:8]}",
        _overlay_open_job,
        peer_key,
        reason,
        await_path,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_open_pending_by_peer_hash.discard(peer_key)
    return bool(queued)


def _overlay_enqueue_open_after_delay(
    peer_hash: str,
    reason: str,
    *,
    delay_seconds: float,
    await_path: bool = False,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return False
    delay = max(0.0, float(delay_seconds or 0.0))

    def run() -> None:
        _overlay_enqueue_open(peer_key, reason, await_path=await_path)

    timer = threading.Timer(delay, run)
    timer.daemon = True
    timer.start()
    return True


def _overlay_recovery_job(peer_key: str, reason: str, force_refresh: bool) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    try:
        if peer_key not in _known_peers:
            ensure_known_peer_from_recall(peer_key, "ts_seed")
        if peer_key not in _known_peers:
            log(
                "[presence_bridge] target=presence-reticulum zero_fanout_path_missing "
                f"peer={peer_key} reason={reason} cause=unknown_identity"
            )
            return
        if _overlay_peer_inbound_full(peer_key):
            log(
                "[presence_bridge] target=presence-reticulum zero_fanout_recovery_skip "
                f"peer={peer_key} reason={reason} cause=peer_inbound_full"
            )
            return
        with _state_lock:
            existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
            existing = _overlay_links_by_id.get(existing_link_id) if existing_link_id else None
        if existing is not None and _overlay_link_is_fanout_usable(existing):
            log(
                "[presence_bridge] target=presence-reticulum zero_fanout_recovered "
                f"peer={peer_key} reason={reason} link={existing_link_id}"
            )
            return
        refresh_resolved = True
        if force_refresh:
            refresh_resolved = _force_overlay_peer_path_refresh(
                peer_key,
                target="presence-reticulum",
                reason=reason,
                cooldown_seconds=_OVERLAY_ZERO_FANOUT_RECOVERY_COOLDOWN_SECONDS,
                await_seconds=_UNESTABLISHED_LINK_HARD_REFRESH_AWAIT_SECONDS,
            )
        if force_refresh and not refresh_resolved:
            log(
                "[presence_bridge] target=presence-reticulum zero_fanout_peer_open_deferred "
                f"peer={peer_key} reason={reason} cause=fresh_path_missing"
            )
            timer = threading.Timer(
                _OVERLAY_ZERO_FANOUT_RECOVERY_COOLDOWN_SECONDS,
                lambda: _overlay_enqueue_peer_recovery(
                    peer_key,
                    reason,
                    force_refresh=True,
                ),
            )
            timer.daemon = True
            timer.start()
            return
        log(
            "[presence_bridge] target=presence-reticulum zero_fanout_peer_open "
            f"peer={peer_key} reason={reason} force_refresh={str(force_refresh).lower()}"
        )
        _overlay_enqueue_open_after_delay(
            peer_key,
            reason,
            delay_seconds=0.25,
            await_path=False,
        )
        _overlay_enqueue_open_after_delay(
            peer_key,
            reason,
            delay_seconds=1.0,
            await_path=False,
        )
        _overlay_enqueue_open_after_delay(
            peer_key,
            reason,
            delay_seconds=2.5,
            await_path=False,
        )
    finally:
        with _state_lock:
            _overlay_open_pending_by_peer_hash.discard(peer_key)


def _overlay_enqueue_peer_recovery(
    peer_hash: str,
    reason: str,
    *,
    force_refresh: bool = True,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return False
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return False
    with _state_lock:
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        existing = _overlay_links_by_id.get(existing_link_id) if existing_link_id else None
        if existing is not None and _overlay_link_is_fanout_usable(existing):
            return False
        if peer_key in _overlay_open_pending_by_peer_hash:
            return False
        _overlay_open_pending_by_peer_hash.add(peer_key)
    queued = _enqueue_scheduler_task(
        _overlay_io_lane_for_peer(peer_key),
        f"overlay-recovery:{reason}:{peer_key[:8]}",
        _overlay_recovery_job,
        peer_key,
        reason,
        force_refresh,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_open_pending_by_peer_hash.discard(peer_key)
    else:
        log(
            "[presence_bridge] target=presence-reticulum zero_fanout_recovery_queued "
            f"peer={peer_key} reason={reason} force_refresh={str(force_refresh).lower()}"
        )
    return bool(queued)


def _overlay_enqueue_close(link_id: str, reason: str) -> bool:
    link_key = str(link_id or "").strip()
    if not link_key:
        return False
    peer_key = ""
    was_active = False
    promoted_link_id = ""
    already_pending = False
    with _state_lock:
        state = _overlay_links_by_id.get(link_key)
        if state is None:
            _overlay_close_pending_link_ids.discard(link_key)
            return False
        _ensure_managed_link_fields(state, kind="overlay")
        state["manager_state"] = _LINK_STATE_CLOSING
        state["last_failure_reason"] = reason
        peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_key and _active_overlay_link_id_by_peer_hash.get(peer_key) == link_key:
            was_active = True
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            promoted_link_id = _promote_overlay_fallback_locked(peer_key, link_key)
            if promoted_link_id:
                state["_promoted_overlay_link_id"] = promoted_link_id
        if link_key in _overlay_close_pending_link_ids:
            already_pending = True
        else:
            _overlay_close_pending_link_ids.add(link_key)
    if was_active:
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_active_detached "
            f"peer={peer_key} link={link_key} reason={reason} "
            f"promoted={promoted_link_id or 'none'}"
        )
        if not promoted_link_id and _overlay_teardown_should_demote(reason):
            _demote_overlay_fanout_peer(peer_key, f"link_close_queued:{reason}")
    if already_pending:
        return False
    queued = _enqueue_scheduler_task(
        _overlay_io_lane_for_peer(peer_key or link_key),
        f"overlay-close:{reason}:{link_key[:8]}",
        _overlay_close_job,
        link_key,
        reason,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_close_pending_link_ids.discard(link_key)
    return bool(queued)


def _run_delayed_overlay_duplicate_close(
    peer_key: str,
    keep_id: str,
    lose_id: str,
    reason: str,
) -> None:
    peer_key = str(peer_key or "").strip().lower()
    keep_id = str(keep_id or "").strip()
    lose_id = str(lose_id or "").strip()
    pending_key = f"{peer_key}:{keep_id}:{lose_id}"
    try:
        close_loser = False
        promote_loser = False
        with _state_lock:
            keep_state = _overlay_links_by_id.get(keep_id)
            lose_state = _overlay_links_by_id.get(lose_id)
            active_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
            keep_usable = keep_state is not None and _overlay_link_is_fanout_usable(keep_state)
            lose_usable = lose_state is not None and _overlay_link_is_fanout_usable(lose_state)
            if lose_state is None:
                return
            if active_id and active_id != keep_id:
                return
            if keep_usable:
                close_loser = True
            elif lose_usable:
                promote_loser = True
            else:
                _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            if promote_loser:
                lose_state.pop("migration_draining", None)
                lose_state.pop("migration_successor_link_id", None)
                _active_overlay_link_id_by_peer_hash[peer_key] = lose_id
        if promote_loser:
            log(
                "[presence_bridge] target=presence-reticulum "
                "overlay_link_duplicate_close_deferred_keep_lost "
                f"peer={peer_key} keep={keep_id} promoted={lose_id}"
            )
            _overlay_enqueue_dedup(peer_key, reason="dedup_same_peer")
            return
        if not close_loser:
            log(
                "[presence_bridge] target=presence-reticulum "
                "overlay_link_duplicate_close_deferred_no_usable_link "
                f"peer={peer_key} keep={keep_id} backup={lose_id}"
            )
            _overlay_enqueue_open(peer_key, "duplicate_keep_lost", await_path=False)
            return
        if close_loser:
            log(
                "[presence_bridge] target=presence-reticulum overlay_link_duplicate_teardown "
                f"peer={peer_key} keep={keep_id} teardown={lose_id} delayed=true"
            )
            _overlay_enqueue_close(lose_id, reason)
    finally:
        with _state_lock:
            _overlay_delayed_duplicate_close_pending.discard(pending_key)


def _schedule_overlay_duplicate_close(
    peer_key: str,
    keep_id: str,
    lose_id: str,
    reason: str = "dedup_same_peer",
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    keep_id = str(keep_id or "").strip()
    lose_id = str(lose_id or "").strip()
    if not peer_key or not keep_id or not lose_id or keep_id == lose_id:
        return False
    pending_key = f"{peer_key}:{keep_id}:{lose_id}"
    with _state_lock:
        if pending_key in _overlay_delayed_duplicate_close_pending:
            return False
        if lose_id not in _overlay_links_by_id:
            return False
        _overlay_delayed_duplicate_close_pending.add(pending_key)
    log(
        "[presence_bridge] target=presence-reticulum overlay_link_duplicate_close_deferred "
        f"peer={peer_key} keep={keep_id} teardown={lose_id} "
        f"delay_ms={int(_OVERLAY_DUPLICATE_CLOSE_GRACE_SECONDS * 1000)}"
    )

    def fire() -> None:
        queued = _enqueue_scheduler_task(
            _overlay_io_lane_for_peer(peer_key),
            f"overlay-dedup-close:{peer_key[:8]}",
            _run_delayed_overlay_duplicate_close,
            peer_key,
            keep_id,
            lose_id,
            reason,
            drop_oldest=False,
        )
        if not queued:
            with _state_lock:
                _overlay_delayed_duplicate_close_pending.discard(pending_key)

    timer = threading.Timer(_OVERLAY_DUPLICATE_CLOSE_GRACE_SECONDS, fire)
    timer.daemon = True
    timer.start()
    return True


def _overlay_enqueue_dedup(peer_hash: str, reason: str = "dedup_same_peer") -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        if peer_key in _overlay_dedup_pending_by_peer_hash:
            return False
        _overlay_dedup_pending_by_peer_hash.add(peer_key)
    queued = _enqueue_scheduler_task(
        _overlay_io_lane_for_peer(peer_key),
        f"overlay-dedup:{reason}:{peer_key[:8]}",
        _overlay_dedup_job,
        peer_key,
        reason,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_dedup_pending_by_peer_hash.discard(peer_key)
    return bool(queued)


def _promote_overlay_fallback_locked(peer_key: str, exclude_link_id: str = "") -> str:
    peer_key = str(peer_key or "").strip().lower()
    exclude_link_id = str(exclude_link_id or "").strip()
    if not peer_key:
        return ""
    fallback_candidates = [
        (candidate_id, candidate_state)
        for candidate_id, candidate_state in _overlay_links_by_id.items()
        if candidate_id != exclude_link_id
        and candidate_state.get("migration_candidate") is not True
        and str(candidate_state.get("peerPresenceHash") or "").strip().lower() == peer_key
    ]
    if not fallback_candidates:
        return ""
    keep_id, keep_state = fallback_candidates[0]
    for candidate_id, candidate_state in fallback_candidates[1:]:
        keep_id, _lose_id = _dedup_pick_keep_link(
            peer_key,
            keep_id,
            keep_state,
            candidate_id,
            candidate_state,
        )
        keep_state = _overlay_links_by_id.get(keep_id, keep_state)
    if keep_state is not None and _overlay_link_is_fanout_usable(keep_state):
        keep_state.pop("migration_draining", None)
        keep_state.pop("migration_successor_link_id", None)
        _active_overlay_link_id_by_peer_hash[peer_key] = keep_id
        return keep_id
    return ""


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
            _overlay_close_pending_link_ids.discard(link_id)
            return None
        _ensure_managed_link_fields(state, kind="overlay")
        for event_key in (
            "migration_established_event",
            "migration_ready_event",
            "migration_commit_event",
        ):
            event = state.get(event_key)
            if isinstance(event, threading.Event):
                event.set()
        for pending in list((state.get("rtt_pending") or {}).values()):
            event = pending.get("event") if isinstance(pending, dict) else None
            if isinstance(event, threading.Event):
                event.set()
        state["manager_state"] = _LINK_STATE_DEAD
        state["generation"] = int(state.get("generation") or 0) + 1
        _overlay_close_pending_link_ids.discard(link_id)
        link = state.get("link")
        if link is not None:
            _overlay_link_ids_by_object.pop(id(link), None)
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_hash:
            _overlay_open_pending_by_peer_hash.discard(peer_hash)
            _overlay_dedup_pending_by_peer_hash.discard(peer_hash)
            existing = _active_overlay_link_id_by_peer_hash.get(peer_hash)
            state["_was_active_overlay"] = existing == link_id
            if existing == link_id:
                _active_overlay_link_id_by_peer_hash.pop(peer_hash, None)
                promoted_id = _promote_overlay_fallback_locked(peer_hash)
                if promoted_id:
                    state["_promoted_overlay_link_id"] = promoted_id
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
    last_replay_at = state.get("last_replay_at")

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
            "managerState": str(state.get("manager_state") or ""),
            "generation": int(state.get("generation") or 0),
            "overlayTransportAdmitted": state.get("overlay_transport_admitted") is True,
            "replayPending": state.get("replay_pending") is True,
            "openReason": str(state.get("open_reason") or ""),
            "lastReplayAgeMs": age_ms(last_replay_at),
            "backoffMs": max(
                0,
                int((float(state.get("backoff_until") or 0.0) - now) * 1000.0),
            ),
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


def _link_close_was_timeout(link: Any, reason: str = "") -> bool:
    teardown_reason = getattr(link, "teardown_reason", None)
    if teardown_reason == getattr(RNS.Link, "TIMEOUT", object()):
        return True
    return str(reason or "").lower() == "timeout"


def _maybe_request_path_after_unestablished_link_close(
    state: Optional[Dict[str, Any]],
    link: Any,
    *,
    target: str,
    reason: str,
) -> None:
    if state is None:
        return
    if state.get("incoming") is True:
        return
    if state.get("established") is True:
        return
    if not _link_close_was_timeout(link, reason):
        return
    peer_hash = str(
        state.get("peerDestinationHash")
        or state.get("peerPresenceHash")
        or ""
    ).strip().lower()
    if not _valid_presence_destination_hash_hex(peer_hash):
        return
    try:
        destination_hash = bytes.fromhex(peer_hash)
    except Exception:
        return
    now = time.time()
    st = _lifecycle_state_for_peer(peer_hash)
    failure_count = 1
    if st is not None:
        failure_count = int(st.get("unestablished_link_failures") or 0) + 1
        st["unestablished_link_failures"] = failure_count
        st["last_unestablished_link_failure_at"] = now
        st["last_unestablished_link_failure_reason"] = reason
    with _state_lock:
        overlay_fanout_count = len(set(_active_overlay_neighbors.keys()) | set(_inbound_overlay_neighbors.keys()))
    hard_refresh_due = (
        failure_count >= _UNESTABLISHED_LINK_HARD_REFRESH_FAILURES
        or (target == "presence-reticulum" and overlay_fanout_count <= 0)
    )
    last_hard_refresh = (
        st.get("last_unestablished_link_hard_refresh_at") if st is not None else None
    )
    hard_refresh_cooldown = (
        _OVERLAY_LINK_HARD_REFRESH_COOLDOWN_SECONDS
        if target == "presence-reticulum"
        else _UNESTABLISHED_LINK_HARD_REFRESH_COOLDOWN_SECONDS
    )
    hard_refresh_cooling_down = (
        isinstance(last_hard_refresh, (int, float))
        and now - float(last_hard_refresh) < hard_refresh_cooldown
    )
    if hard_refresh_due:
        if hard_refresh_cooling_down:
            log(
                f"[presence_bridge] target={target} hard_path_refresh_skipped "
                f"peer={peer_hash} reason=recent_hard_refresh failures={failure_count} "
                f"age_ms={int((now - float(last_hard_refresh)) * 1000.0)}"
            )
        else:
            before = _reticulum_path_snapshot(destination_hash)
            refresh_started_at = time.time()
            dropped = _drop_reticulum_path(destination_hash)
            if st is not None:
                st["last_unestablished_link_hard_refresh_at"] = now
                st["last_unestablished_link_hard_refresh_reason"] = (
                    f"unestablished_link_closed:{reason}"
                )
                st["last_request_path_at"] = now
                st["last_unestablished_link_path_request_at"] = now
                st["last_unestablished_link_path_request_reason"] = (
                    f"hard_refresh:{reason}"
                )
            log(
                f"[presence_bridge] target={target} hard_path_refresh "
                f"peer={peer_hash} failures={failure_count} dropped={str(dropped).lower()} "
                f"fanout={overlay_fanout_count} reason=unestablished_link_closed:{reason} "
                f"before={_format_reticulum_path_snapshot(before)}"
            )
            try:
                RNS.Transport.request_path(destination_hash)
                resolved, after = _await_fresh_destination_path(
                    destination_hash,
                    _UNESTABLISHED_LINK_HARD_REFRESH_AWAIT_SECONDS,
                    before,
                    refresh_started_at,
                )
                log(
                    f"[presence_bridge] target={target} hard_path_refresh_request "
                    f"peer={peer_hash} resolved={str(resolved).lower()} "
                    f"after={_format_reticulum_path_snapshot(after)}"
                )
            except Exception as exc:
                log(
                    f"[presence_bridge] target={target} hard_path_refresh_request_failed "
                    f"peer={peer_hash} reason=unestablished_link_closed:{reason} err={exc}"
                )
            try:
                announce_local_destination(
                    f"hard_path_refresh peer={peer_hash[:16]} failures={failure_count}"
                )
            except Exception as exc:
                log(
                    f"[presence_bridge] target={target} hard_path_refresh_announce_failed "
                    f"peer={peer_hash} err={exc}"
                )
            return
    last_request = (
        st.get("last_unestablished_link_path_request_at") if st is not None else None
    )
    if (
        isinstance(last_request, (int, float))
        and now - float(last_request) < _UNESTABLISHED_LINK_PATH_REQUEST_COOLDOWN_SECONDS
    ):
        log(
            f"[presence_bridge] target={target} cached_path_refresh_skipped "
            f"peer={peer_hash} reason=recent_request close_reason={reason} "
            f"failures={failure_count} age_ms={int((now - float(last_request)) * 1000.0)}"
        )
        return
    try:
        RNS.Transport.request_path(destination_hash)
        if st is not None:
            st["last_request_path_at"] = now
            st["last_unestablished_link_path_request_at"] = now
            st["last_unestablished_link_path_request_reason"] = (
                f"unestablished_link_closed:{reason}"
            )
        log(
            f"[presence_bridge] target={target} cached_path_refresh_request "
            f"peer={peer_hash} failures={failure_count} reason=unestablished_link_closed:{reason}"
        )
    except Exception as exc:
        log(
            f"[presence_bridge] target={target} cached_path_refresh_failed "
            f"peer={peer_hash} reason=unestablished_link_closed:{reason} err={exc}"
        )


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
    last_replay_age = age_label("last_replay_at")
    replay_recent = (
        last_replay_age != "na"
        and int(last_replay_age) <= int(_OVERLAY_REPLAY_CLOSE_ASSOCIATION_SECONDS * 1000)
    )
    return (
        "[presence_bridge] target=presence-reticulum overlay_link_close_detail "
        f"link={link_id} peer={peer_hash} incoming={str(state.get('incoming') is True).lower()} "
        f"was_established={str(state.get('established') is True).lower()} "
        f"was_active={str(was_active).lower()} reason={reason} "
        f"manager_state={state.get('manager_state') or ''} "
        f"generation={int(state.get('generation') or 0)} "
        f"open_reason={state.get('open_reason') or ''} "
        f"announce_retry_created={str(state.get('announce_retry_created') is True).lower()} "
        f"replay_recent={str(replay_recent).lower()} "
        f"last_replay_age_ms={last_replay_age} "
        f"created_age_ms={age_label('created_at')} "
        f"established_age_ms={age_label('established_at')} "
        f"last_rx_age_ms={age_label('last_rx_at')} "
        f"last_send_ok_age_ms={age_label('last_send_ok_at')} "
        f"last_activity_age_ms={age_label('last_activity_at')} "
        f"queued={len(state.get('pending_packets') or [])} rns_status={reticulum_status}"
    )


def _queue_overlay_packet(
    state: Dict[str, Any],
    traffic: str,
    wire_bytes: bytes,
) -> None:
    pending = state.get("pending_packets")
    if pending is None:
        pending = deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT)
        state["pending_packets"] = pending
    if state.get("established") is not True:
        while len(pending) >= _OVERLAY_PENDING_UNESTABLISHED_LIMIT:
            pending.popleft()
    pending.append((traffic, bytes(wire_bytes)))


def _send_packet_on_link(
    link,
    wire_bytes: bytes,
    log_target: str,
) -> bool:
    def note_overlay_send_failure(reason: str) -> None:
        link_id = get_overlay_link_id(link)
        if not link_id:
            return
        with _state_lock:
            state = _overlay_links_by_id.get(link_id)
            if state is None:
                return
            _ensure_managed_link_fields(state, kind="overlay")
            state["manager_state"] = _LINK_STATE_DEGRADED
            state["last_failure_reason"] = reason
            state["last_failure_at"] = time.time()
            peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_key:
            _note_overlay_peer_failure(peer_key, reason)

    try:
        packet = RNS.Packet(link, wire_bytes, create_receipt=False)
        completed, result, error = _run_with_timeout(
            f"link-packet-send-{str(id(link))[-8:]}",
            _LINK_PACKET_SEND_TIMEOUT_SECONDS,
            packet.send,
        )
        if not completed:
            log(
                f"[presence_bridge] {log_target} packet_send_timeout "
                f"timeout_ms={int(_LINK_PACKET_SEND_TIMEOUT_SECONDS * 1000)}"
            )
            note_overlay_send_failure("packet_send_timeout")
            return False
        if error:
            log(f"[presence_bridge] {log_target} packet_send_exception err={error}")
            note_overlay_send_failure("packet_send_exception")
            return False
        if result is False:
            log(f"[presence_bridge] {log_target} packet_send_false")
            note_overlay_send_failure("packet_send_false")
            return False
        return True
    except Exception as exc:
        log(f"[presence_bridge] {log_target} packet_send_exception err={exc}")
        note_overlay_send_failure("packet_send_exception")
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


def _presence_route_bound_destination_hash(session_id: Any) -> Optional[str]:
    """Decode the destination committed by a new wallet-signed presence id."""
    if (
        not isinstance(session_id, str)
        or len(session_id) != 36
        or not session_id.startswith("P")
    ):
        return None
    encoded = session_id[1:23]
    entropy = session_id[23:]
    if len(entropy) != 13:
        return None
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    if any(ch not in allowed for ch in encoded) or any(
        ch not in allowed for ch in entropy
    ):
        return None
    try:
        raw = base64.urlsafe_b64decode(encoded + "==")
    except Exception:
        return None
    if len(raw) != 16:
        return None
    # Reject non-canonical encodings so one route has one representation.
    canonical = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    if canonical != encoded:
        return None
    return raw.hex()


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
    """Sort key for recently useful links; higher = more useful.

    Overlay usefulness is based on inbound traffic. A successful local send only
    proves we wrote to the link; it does not prove the peer is participating.
    """
    best = 0.0
    for key in ("last_rx_at", "established_at"):
        t = state.get(key)
        if isinstance(t, (int, float)):
            best = max(best, float(t))
    return best


def _dedup_has_peer_hash(state: Dict[str, Any], peer_key: str) -> bool:
    return str(state.get("peerPresenceHash") or "").strip().lower() == peer_key


def _overlay_link_pressure_sort_key(item: tuple[str, Dict[str, Any]]) -> tuple[int, float, str]:
    link_id, state = item
    now = time.time()
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_hash) if peer_hash else ""
    active = bool(active_link_id and active_link_id == link_id)
    established = state.get("established") is True
    identified = bool(peer_hash)
    manager_state = str(state.get("manager_state") or "").upper()
    activity = _dedup_activity_ts(state)
    if activity <= 0.0:
        created_at = state.get("created_at")
        activity = float(created_at) if isinstance(created_at, (int, float)) else 0.0
    rx_age = _overlay_link_recent_rx_age_seconds(state, now)
    has_recent_rx = (
        state.get("link") is not None
        and rx_age is not None
        and rx_age <= _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS
    )
    if not identified:
        category = 0
    elif not established:
        category = 1
    elif manager_state in {
        _LINK_STATE_DEGRADED,
        _LINK_STATE_BACKOFF,
        _LINK_STATE_CLOSING,
        _LINK_STATE_DEAD,
    }:
        category = 2
    elif not active:
        category = 3
    elif not has_recent_rx:
        category = 4
    else:
        category = 5
    if category == 5 and _overlay_peer_is_pinned_for_chat(peer_hash):
        category = 6
    return (category, activity, link_id)


def _prune_overlay_link_pressure(reason: str = "link_pressure", reserve_slots: int = 0) -> None:
    budget = max(0, _OVERLAY_MAX_TOTAL_LINKS - max(0, int(reserve_slots)))
    victim_ids: List[str] = []
    with _state_lock:
        excess = len(_overlay_links_by_id) - budget
        if excess <= 0:
            return
        candidates = sorted(_overlay_links_by_id.items(), key=_overlay_link_pressure_sort_key)
        victim_ids = [link_id for link_id, _state in candidates[:excess]]
    for link_id in victim_ids:
        _overlay_enqueue_close(link_id, reason)


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
        if both_est:
            return (link_id_a, link_id_b) if ta < tb else (link_id_b, link_id_a)
        return (link_id_a, link_id_b) if ta > tb else (link_id_b, link_id_a)
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
        "link_pressure",
        "link_pressure_inbound",
        "link_pressure_outbound",
        "route_migrated",
        "migration_candidate_failed",
        "migration_candidate_rejected",
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


def _overlay_link_recent_rx_age_seconds(state: Dict[str, Any], now: float) -> Optional[float]:
    last_rx_at = state.get("last_rx_at")
    if not isinstance(last_rx_at, (int, float)):
        return None
    return max(0.0, now - float(last_rx_at))


def _overlay_link_is_good_outbound_rx(state: Dict[str, Any], now: float) -> bool:
    if state.get("incoming") is True:
        return False
    if not _overlay_link_is_fanout_usable(state):
        return False
    age = _overlay_link_recent_rx_age_seconds(state, now)
    return age is not None and age <= _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS


def _overlay_link_is_fanout_usable(state: Dict[str, Any]) -> bool:
    if state.get("migration_candidate") is True:
        return False
    if state.get("established") is not True:
        return False
    if state.get("link") is None:
        return False
    if state.get("overlay_transport_admitted") is not True:
        return False
    manager_state = str(state.get("manager_state") or "").upper()
    if manager_state in {
        _LINK_STATE_DEGRADED,
        _LINK_STATE_CLOSING,
        _LINK_STATE_BACKOFF,
        _LINK_STATE_DEAD,
    }:
        return False
    return True


def _mark_overlay_peer_admitted_neighbor(peer_key: str, state: Dict[str, Any], now: float) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    with _state_lock:
        _candidate_peers.pop(peer_key, None)
        if state.get("incoming") is True:
            _inbound_overlay_neighbors[peer_key] = now
            return
        if peer_key not in _active_overlay_neighbors and len(_active_overlay_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            evict_peer = ""
            evict_seen_at = float("inf")
            for existing_peer, seen_at in _active_overlay_neighbors.items():
                existing_key = str(existing_peer or "").strip().lower()
                if not existing_key or existing_key == peer_key:
                    continue
                existing_link_id = _active_overlay_link_id_by_peer_hash.get(existing_key) or ""
                existing_state = _overlay_links_by_id.get(existing_link_id) if existing_link_id else None
                if existing_state is not None and _overlay_link_is_fanout_usable(existing_state):
                    continue
                sort_ts = float(seen_at) if isinstance(seen_at, (int, float)) else 0.0
                if sort_ts < evict_seen_at:
                    evict_seen_at = sort_ts
                    evict_peer = existing_key
            if not evict_peer:
                for existing_peer, seen_at in _active_overlay_neighbors.items():
                    existing_key = str(existing_peer or "").strip().lower()
                    if not existing_key or existing_key == peer_key:
                        continue
                    sort_ts = float(seen_at) if isinstance(seen_at, (int, float)) else 0.0
                    if sort_ts < evict_seen_at:
                        evict_seen_at = sort_ts
                        evict_peer = existing_key
            if evict_peer:
                _active_overlay_neighbors.pop(evict_peer, None)
        if peer_key in _active_overlay_neighbors or len(_active_overlay_neighbors) < _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            _active_overlay_neighbors[peer_key] = now


def _overlay_link_peer_hash(state: Dict[str, Any]) -> str:
    return str(state.get("peerPresenceHash") or "").strip().lower()


def _overlay_inbound_full_hint() -> bool:
    with _state_lock:
        return len(_inbound_overlay_neighbors) >= _OVERLAY_MAX_INBOUND_NEIGHBORS


def _valid_overlay_correlation_id(value: Any) -> str:
    candidate = str(value or "").strip().lower()
    if not candidate or len(candidate) > 32:
        return ""
    try:
        bytes.fromhex(candidate)
    except ValueError:
        return ""
    return candidate


def _overlay_peer_supports_route_migration(state: Dict[str, Any]) -> bool:
    capabilities = state.get("peer_capabilities")
    return (
        isinstance(capabilities, set)
        and _OVERLAY_ROUTE_MIGRATION_CAPABILITY in capabilities
    )


def _overlay_link_remote_identity(link: Any) -> Any:
    getter = getattr(link, "get_remote_identity", None)
    if not callable(getter):
        return None
    try:
        return getter()
    except Exception:
        return None


def _overlay_identity_matches_peer(identity: Any, peer_key: str) -> bool:
    if identity is None:
        return False
    derived_peer_hash = derive_presence_destination_hash_for_identity(identity)
    return bool(
        derived_peer_hash
        and derived_peer_hash == str(peer_key or "").strip().lower()
    )


def _make_overlay_transport_wire(
    message_type: str,
    *,
    correlation_id: str = "",
    migration_candidate: bool = False,
) -> bytes:
    if _destination is None:
        raise RuntimeError("Bridge not started")
    wire = {
        "t": message_type,
        "r": destination_hash_hex(_destination.hash),
        "v": PRESENCE_VERSION,
        "b": PRESENCE_BRIDGE_BUILD,
        "f": _overlay_inbound_full_hint(),
    }
    if message_type == _OVERLAY_HELLO_WIRE_TYPE:
        wire["c"] = [_OVERLAY_ROUTE_MIGRATION_CAPABILITY]
        if migration_candidate:
            wire["m"] = _OVERLAY_ROUTE_MIGRATION_MARKER
    correlation_key = _valid_overlay_correlation_id(correlation_id)
    if correlation_key:
        wire["q"] = correlation_key
    return json.dumps(wire, separators=(",", ":")).encode("utf-8")


def _send_overlay_transport_control(
    link: Any,
    state: Dict[str, Any],
    message_type: str,
    reason: str,
    *,
    correlation_id: str = "",
) -> bool:
    peer_key = _overlay_link_peer_hash(state) or "unknown"
    try:
        wire_bytes = _make_overlay_transport_wire(
            message_type,
            correlation_id=correlation_id,
            migration_candidate=state.get("migration_candidate") is True,
        )
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum overlay_transport_send_failed "
            f"type={message_type} peer={peer_key} reason={reason} err={exc}"
        )
        return False
    ok = _send_packet_on_link(
        link,
        wire_bytes,
        f"target=presence-reticulum overlay_transport_send peer={peer_key} type={message_type} reason={reason}",
    )
    if ok:
        now = time.time()
        state["last_send_ok_at"] = now
        state["last_transport_control_sent_at"] = now
        state["last_transport_control_type"] = message_type
        if message_type == _OVERLAY_HELLO_WIRE_TYPE:
            state["hello_sent_at"] = now
            log(
                "[presence_bridge] target=presence-reticulum overlay_hello_sent "
                f"peer={peer_key} reason={reason}"
            )
        elif message_type == _OVERLAY_PING_WIRE_TYPE:
            state["last_ping_sent_at"] = now
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_ping "
                f"peer={peer_key} direction=tx reason={reason}"
            )
        elif message_type == _OVERLAY_PONG_WIRE_TYPE:
            state["last_pong_sent_at"] = now
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_pong "
                f"peer={peer_key} direction=tx reason={reason}"
            )
    else:
        state["last_failure_reason"] = "overlay_transport_packet_send_false"
        link_id = str(state.get("linkId") or "")
        if not link_id:
            with _state_lock:
                link_id = _overlay_link_ids_by_object.get(id(link)) or ""
        if link_id:
            _overlay_enqueue_close(link_id, "overlay_transport_packet_send_false")
        if state.get("migration_candidate") is True:
            return False
        _force_overlay_peer_path_refresh(
            peer_key,
            target="presence-reticulum",
            reason=f"overlay_transport_send:{message_type}:{reason}:packet_send_false",
        )
    return ok


def _send_overlay_rtt_probe(
    link_id: str,
    purpose: str,
) -> Optional[Dict[str, Any]]:
    state = get_overlay_link_state(link_id)
    if state is None or state.get("established") is not True:
        return None
    link = state.get("link")
    if link is None or not _overlay_link_is_current(link_id, link):
        return None
    probe_id = secrets.token_hex(8)
    pending = {
        "id": probe_id,
        "purpose": str(purpose or "liveness"),
        "sent_ns": time.monotonic_ns(),
        "event": threading.Event(),
        "rtt_ms": None,
    }
    with _state_lock:
        probes = state.setdefault("rtt_pending", {})
        cutoff_ns = time.monotonic_ns() - int(
            _OVERLAY_ROUTE_MIGRATION_PROBE_TIMEOUT_SECONDS * 2 * 1_000_000_000
        )
        for stale_id, stale in list(probes.items()):
            if int(stale.get("sent_ns") or 0) < cutoff_ns:
                probes.pop(stale_id, None)
                stale_event = stale.get("event")
                if isinstance(stale_event, threading.Event):
                    stale_event.set()
        probes[probe_id] = pending
    if _send_overlay_transport_control(
        link,
        state,
        _OVERLAY_PING_WIRE_TYPE,
        purpose,
        correlation_id=probe_id,
    ):
        return pending
    with _state_lock:
        state.get("rtt_pending", {}).pop(probe_id, None)
    pending["event"].set()
    return pending


def _resolve_overlay_rtt_probe(state: Dict[str, Any], probe_id: str) -> Optional[float]:
    probe_key = _valid_overlay_correlation_id(probe_id)
    if not probe_key:
        return None
    with _state_lock:
        pending = state.get("rtt_pending", {}).pop(probe_key, None)
    if not isinstance(pending, dict):
        return None
    sent_ns = pending.get("sent_ns")
    if not isinstance(sent_ns, int) or sent_ns <= 0:
        return None
    rtt_ms = max(0.0, (time.monotonic_ns() - sent_ns) / 1_000_000.0)
    pending["rtt_ms"] = rtt_ms
    with _state_lock:
        samples = state.get("rtt_samples_ms")
        if not isinstance(samples, deque):
            samples = deque(maxlen=16)
            state["rtt_samples_ms"] = samples
        samples.append(rtt_ms)
    event = pending.get("event")
    if isinstance(event, threading.Event):
        event.set()
    return rtt_ms


def _overlay_migration_quality_acceptable(
    active_samples: List[float],
    candidate_samples: List[float],
    active_hops: int,
    candidate_hops: int,
) -> Tuple[bool, Dict[str, Any]]:
    active_clean = [float(value) for value in active_samples if isinstance(value, (int, float))]
    candidate_clean = [float(value) for value in candidate_samples if isinstance(value, (int, float))]
    result: Dict[str, Any] = {
        "active_samples": len(active_clean),
        "candidate_samples": len(candidate_clean),
        "active_median_ms": None,
        "candidate_median_ms": None,
        "active_hops": active_hops,
        "candidate_hops": candidate_hops,
    }
    if (
        len(active_clean) < _OVERLAY_ROUTE_MIGRATION_MIN_SAMPLES
        or len(candidate_clean) < _OVERLAY_ROUTE_MIGRATION_MIN_SAMPLES
        or len(candidate_clean) < len(active_clean)
        or candidate_hops >= active_hops
    ):
        return False, result
    active_median = statistics.median(active_clean)
    candidate_median = statistics.median(candidate_clean)
    result["active_median_ms"] = active_median
    result["candidate_median_ms"] = candidate_median
    ratio_ok = candidate_median <= active_median * _OVERLAY_ROUTE_MIGRATION_RTT_RATIO
    absolute_ok = (
        active_median - candidate_median
        >= _OVERLAY_ROUTE_MIGRATION_RTT_MIN_GAIN_MS
    )
    return bool(ratio_ok and absolute_ok), result


def _promote_overlay_migration_candidate(
    peer_key: str,
    candidate_link_id: str,
    reason: str,
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    candidate_link_id = str(candidate_link_id or "").strip()
    if not peer_key or not candidate_link_id:
        return False
    previous_link_id = ""
    candidate_state: Optional[Dict[str, Any]] = None
    with _state_lock:
        candidate_state = _overlay_links_by_id.get(candidate_link_id)
        if candidate_state is None:
            return False
        if candidate_state.get("migration_candidate") is not True:
            return _active_overlay_link_id_by_peer_hash.get(peer_key) == candidate_link_id
        if (
            candidate_state.get("established") is not True
            or candidate_state.get("overlay_transport_admitted") is not True
            or _overlay_link_peer_hash(candidate_state) != peer_key
        ):
            return False
        if (
            candidate_state.get("incoming") is True
            and candidate_state.get("migration_peer_authenticated") is not True
        ):
            return False
        previous_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        source_link_id = str(candidate_state.get("migration_source_link_id") or "")
        if not source_link_id or previous_link_id != source_link_id:
            return False
        previous_state = (
            _overlay_links_by_id.get(previous_link_id) if previous_link_id else None
        )
        if (
            candidate_state.get("incoming") is True
            and (previous_state is None or previous_state.get("incoming") is not True)
        ):
            return False
        if previous_state is not None and previous_link_id != candidate_link_id:
            previous_state["migration_draining"] = True
            previous_state["migration_successor_link_id"] = candidate_link_id
        candidate_state["migration_candidate"] = False
        candidate_state["migration_committed"] = True
        candidate_state["migration_committed_at"] = time.time()
        candidate_state["manager_state"] = _LINK_STATE_ESTABLISHED
        _active_overlay_link_id_by_peer_hash[peer_key] = candidate_link_id
        if candidate_state.get("incoming") is True:
            _active_overlay_neighbors.pop(peer_key, None)
            _inbound_overlay_neighbors[peer_key] = time.time()
        else:
            _inbound_overlay_neighbors.pop(peer_key, None)
            _active_overlay_neighbors[peer_key] = time.time()
    log(
        "[presence_bridge] target=presence-reticulum overlay_route_migration_promoted "
        f"peer={peer_key} previous={previous_link_id or 'none'} "
        f"candidate={candidate_link_id} reason={reason}"
    )
    emit_overlay_link_state(candidate_link_id, candidate_state, "route_migrated")
    _schedule_delayed_presence_announce_replay(
        peer_key,
        candidate_link_id,
        "route_migrated",
    )
    _flush_overlay_link_pending(candidate_link_id)
    return True


def _finalize_overlay_migration(
    peer_key: str,
    candidate_link_id: str,
    transaction_id: str,
    reason: str,
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    candidate_link_id = str(candidate_link_id or "").strip()
    transaction_id = _valid_overlay_correlation_id(transaction_id)
    if not peer_key or not candidate_link_id or not transaction_id:
        return False
    with _state_lock:
        state = _overlay_links_by_id.get(candidate_link_id)
        if (
            state is None
            or _active_overlay_link_id_by_peer_hash.get(peer_key) != candidate_link_id
            or state.get("migration_committed") is not True
            or state.get("migration_transaction_id") != transaction_id
        ):
            return False
        if state.get("migration_finalized") is True:
            return True
        previous_link_id = str(state.get("migration_source_link_id") or "")
        state["migration_finalized"] = True
        state["migration_finalized_at"] = time.time()
    log(
        "[presence_bridge] target=presence-reticulum overlay_route_migration_finalized "
        f"peer={peer_key} previous={previous_link_id or 'none'} "
        f"candidate={candidate_link_id} reason={reason}"
    )
    if previous_link_id and previous_link_id != candidate_link_id:
        _schedule_overlay_duplicate_close(
            peer_key,
            candidate_link_id,
            previous_link_id,
            "route_migrated",
        )
    return True


def _create_overlay_migration_candidate(
    peer_key: str,
    active_link_id: str,
    target_path: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    peer_key = str(peer_key or "").strip().lower()
    with _state_lock:
        if _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id:
            return None
        peer_identity = _known_peers.get(peer_key)
        if peer_identity is None or len(_overlay_links_by_id) >= _OVERLAY_MAX_TOTAL_LINKS:
            return None
    outbound = build_outbound_destination(peer_identity)
    if destination_hash_hex(outbound.hash) != peer_key:
        return None
    link_id = str(uuid.uuid4())
    link = RNS.Link(
        outbound,
        established_callback=on_outgoing_overlay_link_established,
        closed_callback=on_overlay_link_closed,
    )
    now = time.time()
    state: Dict[str, Any] = {
        "linkId": link_id,
        "link": link,
        "rnsLinkId": (_rns_link_id_bytes(link) or b"").hex(),
        "peerPresenceHash": peer_key,
        "incoming": False,
        "established": False,
        "created_at": now,
        "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
        "open_reason": "route_migration_candidate",
        "announce_retry_created": False,
        "manager_kind": "overlay",
        "manager_state": _LINK_STATE_CONNECTING,
        "generation": 0,
        "last_failure_reason": "",
        "backoff_until": 0.0,
        "migration_candidate": True,
        "migration_source_link_id": active_link_id,
        "migration_target_path": dict(target_path),
        # Link establishment authenticates the destination identity for the
        # initiator. Incoming candidates must separately identify themselves.
        "migration_peer_authenticated": True,
        "migration_established_event": threading.Event(),
        "migration_ready_event": threading.Event(),
        "migration_commit_event": threading.Event(),
        "migration_acknowledged": False,
    }
    rejected = False
    with _state_lock:
        if (
            _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id
            or len(_overlay_links_by_id) >= _OVERLAY_MAX_TOTAL_LINKS
        ):
            rejected = True
        else:
            _overlay_links_by_id[link_id] = state
            _overlay_link_ids_by_object[id(link)] = link_id
            _set_link_manager_generation(link, state)
    if rejected:
        _teardown_reticulum_link_bounded(
            link,
            f"target=presence-reticulum route_migration_candidate_raced peer={peer_key}",
        )
        return None
    emit_overlay_link_state(link_id, state, "route_migration_connecting")
    log(
        "[presence_bridge] target=presence-reticulum overlay_route_migration_candidate_opened "
        f"peer={peer_key} active={active_link_id} candidate={link_id} "
        f"target_hops={target_path.get('hops')}"
    )
    return state


def _collect_overlay_migration_rtt_samples(
    active_link_id: str,
    candidate_link_id: str,
) -> Tuple[List[float], List[float]]:
    active_samples: List[float] = []
    candidate_samples: List[float] = []
    for sample_index in range(_OVERLAY_ROUTE_MIGRATION_PROBE_SAMPLES):
        probe_specs = [
            (
                "active",
                active_link_id,
                f"route_migration_active_{sample_index}",
            ),
            (
                "candidate",
                candidate_link_id,
                f"route_migration_candidate_{sample_index}",
            ),
        ]
        if sample_index % 2:
            probe_specs.reverse()
        probes = {
            label: _send_overlay_rtt_probe(link_id, purpose)
            for label, link_id, purpose in probe_specs
        }
        deadline = time.monotonic() + _OVERLAY_ROUTE_MIGRATION_PROBE_TIMEOUT_SECONDS
        for pending, output in (
            (probes.get("active"), active_samples),
            (probes.get("candidate"), candidate_samples),
        ):
            if not isinstance(pending, dict):
                continue
            event = pending.get("event")
            if isinstance(event, threading.Event):
                event.wait(max(0.0, deadline - time.monotonic()))
            rtt_ms = pending.get("rtt_ms")
            if isinstance(rtt_ms, (int, float)):
                output.append(float(rtt_ms))
    return active_samples, candidate_samples


def _overlay_route_migration_job(
    peer_key: str,
    active_link_id: str,
    target_path: Dict[str, Any],
    active_route: Dict[str, Any],
) -> None:
    candidate_link_id = ""
    promoted = False
    try:
        with _state_lock:
            active_state = _overlay_links_by_id.get(active_link_id)
        if (
            active_state is None
            or not _overlay_link_is_fanout_usable(active_state)
            or not _overlay_peer_supports_route_migration(active_state)
        ):
            return
        candidate_state = _create_overlay_migration_candidate(
            peer_key,
            active_link_id,
            target_path,
        )
        if candidate_state is None:
            return
        candidate_link_id = str(candidate_state.get("linkId") or "")
        ready_event = candidate_state.get("migration_ready_event")
        if not isinstance(ready_event, threading.Event) or not ready_event.wait(
            _OVERLAY_ROUTE_MIGRATION_ESTABLISH_TIMEOUT_SECONDS
        ):
            return
        candidate_state = get_overlay_link_state(candidate_link_id)
        if (
            candidate_state is None
            or candidate_state.get("established") is not True
            or candidate_state.get("overlay_transport_admitted") is not True
            or not _overlay_peer_supports_route_migration(candidate_state)
        ):
            return
        active_samples, candidate_samples = _collect_overlay_migration_rtt_samples(
            active_link_id,
            candidate_link_id,
        )
        with _state_lock:
            current_active_state = _overlay_links_by_id.get(active_link_id)
            if _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id:
                return
        current_active_route = (
            _reticulum_link_route_snapshot(current_active_state)
            if current_active_state is not None
            else None
        )
        candidate_route = _reticulum_link_route_snapshot(candidate_state)
        active_hops = (
            current_active_route.get("remote_hops")
            if current_active_route
            else active_route.get("remote_hops")
        )
        candidate_hops = candidate_route.get("remote_hops") if candidate_route else None
        if not isinstance(active_hops, int) or not isinstance(candidate_hops, int):
            return
        acceptable, result = _overlay_migration_quality_acceptable(
            active_samples,
            candidate_samples,
            active_hops,
            candidate_hops,
        )
        log(
            "[presence_bridge] target=presence-reticulum overlay_route_migration_measured "
            f"peer={peer_key} active={active_link_id} candidate={candidate_link_id} "
            f"accepted={str(acceptable).lower()} result={json.dumps(result, separators=(',', ':'))}"
        )
        if not acceptable:
            return
        with _state_lock:
            if _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id:
                return
            transaction_id = secrets.token_hex(8)
            candidate_state["migration_transaction_id"] = transaction_id
            candidate_state["migration_acknowledged"] = False
            commit_event = candidate_state.get("migration_commit_event")
            if not isinstance(commit_event, threading.Event):
                commit_event = threading.Event()
                candidate_state["migration_commit_event"] = commit_event
            else:
                commit_event.clear()
        commit_wait_seconds = (
            _OVERLAY_ROUTE_MIGRATION_COMMIT_TIMEOUT_SECONDS
            / _OVERLAY_ROUTE_MIGRATION_COMMIT_ATTEMPTS
        )
        acknowledged = False
        for attempt in range(_OVERLAY_ROUTE_MIGRATION_COMMIT_ATTEMPTS):
            if not _send_overlay_transport_control(
                candidate_state.get("link"),
                candidate_state,
                _OVERLAY_MIGRATION_COMMIT_WIRE_TYPE,
                f"route_migration_commit_{attempt + 1}",
                correlation_id=transaction_id,
            ):
                return
            if commit_event.wait(commit_wait_seconds):
                acknowledged = True
                break
        if not acknowledged:
            return
        candidate_state = get_overlay_link_state(candidate_link_id)
        if candidate_state is None or candidate_state.get("migration_acknowledged") is not True:
            return
        promoted = _promote_overlay_migration_candidate(
            peer_key,
            candidate_link_id,
            "local_commit_ack",
        )
        if not promoted:
            return
        if not _send_overlay_transport_control(
            candidate_state.get("link"),
            candidate_state,
            _OVERLAY_MIGRATION_FINALIZE_WIRE_TYPE,
            "route_migration_finalize",
            correlation_id=transaction_id,
        ):
            _overlay_enqueue_close(
                candidate_link_id,
                "migration_finalize_send_failed",
            )
            return
        _finalize_overlay_migration(
            peer_key,
            candidate_link_id,
            transaction_id,
            "local_finalize_sent",
        )
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum overlay_route_migration_failed "
            f"peer={peer_key} candidate={candidate_link_id or 'none'} err={exc}"
        )
    finally:
        if candidate_link_id and not promoted:
            state = get_overlay_link_state(candidate_link_id)
            if state is not None and state.get("migration_candidate") is True:
                _overlay_enqueue_close(candidate_link_id, "migration_candidate_rejected")
        with _state_lock:
            _overlay_route_migration_pending_by_peer_hash.discard(peer_key)


def _overlay_route_migration_inspection_job(
    peer_key: str,
    active_link_id: str,
    reason: str,
) -> None:
    peer_key = str(peer_key or "").strip().lower()
    try:
        with _state_lock:
            active_state = _overlay_links_by_id.get(active_link_id)
            if (
                _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id
                or active_state is None
                or active_state.get("incoming") is True
                or not _overlay_link_is_fanout_usable(active_state)
                or not _overlay_peer_supports_route_migration(active_state)
            ):
                return
        try:
            destination_hash = bytes.fromhex(peer_key)
        except ValueError:
            return
        target_path = _reticulum_path_snapshot(destination_hash)
        active_route = _reticulum_link_route_snapshot(active_state)
        target_hops = target_path.get("hops")
        active_hops = active_route.get("remote_hops") if active_route else None
        if (
            target_path.get("has_path") is not True
            or not isinstance(target_hops, int)
            or not isinstance(active_hops, int)
            or target_hops >= active_hops
        ):
            return
        with _state_lock:
            if _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id:
                return
            _overlay_route_migration_last_attempt_at_by_peer_hash[peer_key] = time.time()
        log(
            "[presence_bridge] target=presence-reticulum "
            "overlay_route_migration_scheduled "
            f"peer={peer_key} active={active_link_id} old_hops={active_hops} "
            f"new_hops={target_hops} reason={reason}"
        )
        _overlay_route_migration_job(
            peer_key,
            active_link_id,
            target_path,
            active_route,
        )
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum "
            "overlay_route_migration_inspection_failed "
            f"peer={peer_key or 'unknown'} err={exc}"
        )
    finally:
        with _state_lock:
            _overlay_route_migration_pending_by_peer_hash.discard(peer_key)


def _maybe_schedule_overlay_route_migration(peer_hash: str, reason: str) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer_key):
        return False
    now = time.time()
    with _state_lock:
        if (
            peer_key in _overlay_route_migration_pending_by_peer_hash
            or len(_overlay_route_migration_pending_by_peer_hash)
            >= _OVERLAY_ROUTE_MIGRATION_MAX_CONCURRENT
        ):
            return False
        last_attempt = float(
            _overlay_route_migration_last_attempt_at_by_peer_hash.get(peer_key) or 0.0
        )
        if now - last_attempt < _OVERLAY_ROUTE_MIGRATION_COOLDOWN_SECONDS:
            return False
        active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        active_state = _overlay_links_by_id.get(active_link_id) if active_link_id else None
        if active_state is None or not _overlay_link_is_fanout_usable(active_state):
            return False
        # The initiator of the active Link owns replacement attempts. The remote
        # side sees the replacement as incoming, which prevents competing probes.
        if active_state.get("incoming") is True:
            return False
        if not _overlay_peer_supports_route_migration(active_state):
            return False
        established_at = active_state.get("established_at")
        if (
            not isinstance(established_at, (int, float))
            or now - float(established_at) < _OVERLAY_ROUTE_MIGRATION_MIN_ACTIVE_SECONDS
        ):
            return False
    with _state_lock:
        if _active_overlay_link_id_by_peer_hash.get(peer_key) != active_link_id:
            return False
        _overlay_route_migration_pending_by_peer_hash.add(peer_key)
    queued = _enqueue_scheduler_task(
        f"overlay-migration-{int(peer_key[:8], 16) % _SCHEDULER_OVERLAY_MIGRATION_SHARDS}",
        f"overlay-route-inspection:{peer_key[:8]}",
        _overlay_route_migration_inspection_job,
        peer_key,
        active_link_id,
        reason,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_route_migration_pending_by_peer_hash.discard(peer_key)
        return False
    return True


def _admit_overlay_peer_from_transport(
    peer_key: str,
    link_id: str,
    state: Dict[str, Any],
    reason: str,
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer_key):
        return False
    previous_peer_hash = _overlay_link_peer_hash(state)
    if previous_peer_hash and previous_peer_hash != peer_key:
        log(
            "[presence_bridge] target=presence-reticulum overlay_transport_peer_mismatch "
            f"link={link_id} previous={previous_peer_hash} received={peer_key} reason={reason}"
        )
        _overlay_enqueue_close(link_id, "overlay_transport_peer_mismatch")
        return False
    state["peerPresenceHash"] = peer_key
    now = time.time()
    if state.get("migration_candidate") is True:
        authenticated = (
            state.get("incoming") is not True
            or state.get("migration_peer_authenticated") is True
        )
        state["overlay_transport_admitted"] = authenticated
        if authenticated:
            state["overlay_transport_admitted_at"] = now
            _note_overlay_peer_alive(peer_key, reason)
        log(
            "[presence_bridge] target=presence-reticulum overlay_migration_candidate_admitted "
            f"peer={peer_key} link={link_id} "
            f"incoming={str(state.get('incoming') is True).lower()} "
            f"authenticated={str(authenticated).lower()}"
        )
        return authenticated
    state["overlay_transport_admitted"] = True
    state["overlay_transport_admitted_at"] = now
    _note_overlay_peer_alive(peer_key, reason)
    admitted_state = _register_active_overlay_for_peer(peer_key, link_id)
    if admitted_state is None:
        return False
    _mark_overlay_peer_admitted_neighbor(peer_key, admitted_state, now)
    active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or link_id
    log(
        "[presence_bridge] target=presence-reticulum overlay_peer_admitted "
        f"peer={peer_key} link={active_link_id} incoming={str(admitted_state.get('incoming') is True).lower()} reason={reason}"
    )
    _flush_overlay_link_pending(active_link_id)
    return True


def _handle_overlay_transport_control(
    decoded: Dict[str, Any],
    link: Any,
    link_id: str,
    state: Dict[str, Any],
) -> bool:
    message_type = decoded.get("t")
    if message_type not in _OVERLAY_TRANSPORT_WIRE_TYPES:
        return False
    peer_key = str(decoded.get("r") or "").strip().lower()
    if not _valid_presence_destination_hash_hex(peer_key):
        log(
            "[presence_bridge] target=presence-reticulum overlay_transport_ignored "
            f"type={message_type} reason=invalid_peer_hash"
        )
        return True
    now = time.time()
    state["last_activity_at"] = now
    state["last_rx_at"] = now
    state["last_transport_control_rx_at"] = now
    state["last_transport_control_rx_type"] = message_type
    _ensure_managed_link_fields(state, kind="overlay")
    state["manager_state"] = _LINK_STATE_ESTABLISHED
    state["last_failure_reason"] = ""
    state["backoff_until"] = 0.0
    if not _admit_overlay_peer_from_transport(peer_key, link_id, state, message_type.lower()):
        return True
    _note_peer_inbound_capacity_hint(peer_key, {
        "inboundFull": decoded.get("f") is True,
    })
    if message_type == _OVERLAY_HELLO_WIRE_TYPE:
        raw_capabilities = decoded.get("c")
        capabilities = {
            str(capability).strip()
            for capability in raw_capabilities
            if isinstance(capability, str) and 0 < len(capability.strip()) <= 48
        } if isinstance(raw_capabilities, list) else set()
        state["peer_capabilities"] = capabilities
        log(
            "[presence_bridge] target=presence-reticulum overlay_hello_received "
            f"peer={peer_key} link={link_id} inbound_full={str(decoded.get('f') is True).lower()} "
            f"build={str(decoded.get('b') or '')[:48]}"
        )
        if not isinstance(state.get("hello_sent_at"), (int, float)):
            _send_overlay_transport_control(link, state, _OVERLAY_HELLO_WIRE_TYPE, "hello_reply")
        if (
            state.get("migration_candidate") is True
            and decoded.get("m") == _OVERLAY_ROUTE_MIGRATION_MARKER
            and _OVERLAY_ROUTE_MIGRATION_CAPABILITY in capabilities
            and (
                state.get("incoming") is not True
                or state.get("migration_peer_authenticated") is True
            )
        ):
            ready_event = state.get("migration_ready_event")
            if isinstance(ready_event, threading.Event):
                ready_event.set()
        emit_overlay_link_state(link_id, state, "overlay_hello")
    elif message_type == _OVERLAY_PING_WIRE_TYPE:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_ping "
            f"peer={peer_key} direction=rx"
        )
        _send_overlay_transport_control(
            link,
            state,
            _OVERLAY_PONG_WIRE_TYPE,
            "ping",
            correlation_id=_valid_overlay_correlation_id(decoded.get("q")),
        )
        emit_overlay_link_state(link_id, state, "overlay_ping")
    elif message_type == _OVERLAY_PONG_WIRE_TYPE:
        state["last_pong_rx_at"] = now
        rtt_ms = _resolve_overlay_rtt_probe(state, decoded.get("q"))
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_pong "
            f"peer={peer_key} direction=rx rtt_ms={rtt_ms if rtt_ms is not None else 'na'}"
        )
        emit_overlay_link_state(link_id, state, "overlay_pong")
    elif message_type == _OVERLAY_MIGRATION_COMMIT_WIRE_TYPE:
        transaction_id = _valid_overlay_correlation_id(decoded.get("q"))
        existing_transaction_id = str(state.get("migration_transaction_id") or "")
        transaction_matches = (
            not existing_transaction_id or existing_transaction_id == transaction_id
        )
        commit_eligible = (
            state.get("migration_candidate") is True
            or state.get("migration_committed") is True
        )
        if (
            transaction_id
            and transaction_matches
            and commit_eligible
            and (
                state.get("incoming") is not True
                or state.get("migration_peer_authenticated") is True
            )
        ):
            state["migration_transaction_id"] = transaction_id
        if (
            transaction_id
            and transaction_matches
            and commit_eligible
            and _promote_overlay_migration_candidate(
                peer_key,
                link_id,
                "remote_commit",
            )
        ):
            _send_overlay_transport_control(
                link,
                state,
                _OVERLAY_MIGRATION_ACK_WIRE_TYPE,
                "migration_commit",
                correlation_id=transaction_id,
            )
    elif message_type == _OVERLAY_MIGRATION_ACK_WIRE_TYPE:
        transaction_id = _valid_overlay_correlation_id(decoded.get("q"))
        if transaction_id and transaction_id == state.get("migration_transaction_id"):
            state["migration_acknowledged"] = True
            commit_event = state.get("migration_commit_event")
            if isinstance(commit_event, threading.Event):
                commit_event.set()
    elif message_type == _OVERLAY_MIGRATION_FINALIZE_WIRE_TYPE:
        transaction_id = _valid_overlay_correlation_id(decoded.get("q"))
        if transaction_id:
            _finalize_overlay_migration(
                peer_key,
                link_id,
                transaction_id,
                "remote_finalize",
            )
    if state.get("migration_candidate") is not True:
        _overlay_enqueue_dedup(peer_key, reason="dedup_same_peer")
    return True


def _send_overlay_hello_for_link(link_id: str, reason: str) -> None:
    state = get_overlay_link_state(link_id)
    if state is None or state.get("established") is not True:
        return
    link = state.get("link")
    if link is None or not _overlay_link_is_current(link_id, link):
        return
    _send_overlay_transport_control(link, state, _OVERLAY_HELLO_WIRE_TYPE, reason)


def _ping_established_overlay_links(reason: str) -> int:
    sent = 0
    now = time.time()
    with _state_lock:
        link_items = list(_overlay_links_by_id.items())
    for link_id, state in link_items:
        if state.get("established") is not True:
            continue
        if state.get("migration_candidate") is True:
            continue
        link = state.get("link")
        if link is None or not _overlay_link_is_current(link_id, link):
            continue
        last_ping = state.get("last_ping_sent_at")
        if isinstance(last_ping, (int, float)) and now - float(last_ping) < _OVERLAY_TRANSPORT_PING_INTERVAL_SECONDS:
            continue
        if _overlay_peer_supports_route_migration(state):
            if _send_overlay_rtt_probe(link_id, reason) is not None:
                sent += 1
        elif _send_overlay_transport_control(
            link,
            state,
            _OVERLAY_PING_WIRE_TYPE,
            reason,
        ):
            sent += 1
    return sent


def _retain_recent_rx_outbound_peer(peer_hash: str, state: Dict[str, Any], reason: str, now: float) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key or not _overlay_link_is_good_outbound_rx(state, now):
        return False
    evicted_peer = ""
    if peer_key not in _active_overlay_neighbors and len(_active_overlay_neighbors) >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        candidates: list[tuple[float, str]] = []
        for existing_peer, seen_at in _active_overlay_neighbors.items():
            existing_key = str(existing_peer or "").strip().lower()
            if not existing_key or existing_key == peer_key:
                continue
            existing_link_id = _active_overlay_link_id_by_peer_hash.get(existing_key) or ""
            existing_state = _overlay_links_by_id.get(existing_link_id) if existing_link_id else None
            if existing_state is not None and _overlay_link_is_good_outbound_rx(existing_state, now):
                continue
            sort_ts = float(seen_at) if isinstance(seen_at, (int, float)) else 0.0
            candidates.append((sort_ts, existing_key))
        if candidates:
            candidates.sort(key=lambda item: (item[0], item[1]))
            evicted_peer = candidates[0][1]
            _active_overlay_neighbors.pop(evicted_peer, None)
    if peer_key in _active_overlay_neighbors or len(_active_overlay_neighbors) < _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
        _active_overlay_neighbors[peer_key] = now
    age = _overlay_link_recent_rx_age_seconds(state, now)
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_prune_keep_recent_rx "
        f"peer={peer_key} reason={reason} "
        f"last_rx_age_ms={int((age or 0.0) * 1000.0)} "
        f"outbound={len(_active_overlay_neighbors)}"
        f"{f' evicted_peer={evicted_peer}' if evicted_peer else ''}"
    )
    return True


def _overlay_recent_activity_close_should_keep_peer(
    state: Dict[str, Any], reason: str, now: float
) -> bool:
    return False


def _prune_pinned_chat_overlay_peers(now: Optional[float] = None) -> Set[str]:
    if now is None:
        now = time.time()
    with _state_lock:
        for peer_hash, expires_at in list(_pinned_chat_overlay_peers.items()):
            if not isinstance(expires_at, (int, float)) or float(expires_at) <= now:
                _pinned_chat_overlay_peers.pop(peer_hash, None)
        return set(_pinned_chat_overlay_peers.keys())


def _overlay_peer_is_pinned_for_chat(peer_hash: str) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    return peer_key in _prune_pinned_chat_overlay_peers()


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
    if peer_key in target:
        target[peer_key] = time.time()
        return True
    if incoming:
        limit = _OVERLAY_MAX_INBOUND_NEIGHBORS
    else:
        pinned = _prune_pinned_chat_overlay_peers()
        pinned_active = sum(1 for existing in target if existing in pinned)
        ordinary_active = len(target) - pinned_active
        if peer_key in pinned:
            if pinned_active >= _OVERLAY_MAX_PINNED_CHAT_PEERS:
                return False
        elif ordinary_active >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS:
            return False
        limit = _OVERLAY_MAX_OUTBOUND_NEIGHBORS + _OVERLAY_MAX_PINNED_CHAT_PEERS
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
            _OVERLAY_MAX_OUTBOUND_NEIGHBORS
            + _OVERLAY_MAX_INBOUND_NEIGHBORS
            + _OVERLAY_MAX_PINNED_CHAT_PEERS
        )


def _teardown_overlay_link_id(link_id: str, reason: str) -> None:
    now = time.time()
    state = remove_overlay_link(link_id)
    if state is None:
        return
    migration_candidate = state.get("migration_candidate") is True
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    last_replay_at = state.get("last_replay_at")
    replay_associated = (
        isinstance(last_replay_at, (int, float))
        and now - float(last_replay_at) <= _OVERLAY_REPLAY_CLOSE_ASSOCIATION_SECONDS
    )
    announce_retry_associated = state.get("announce_retry_created") is True
    with _state_lock:
        _overlay_close_diagnostics.append(
            (now, reason, bool(replay_associated), bool(announce_retry_associated))
        )
    verbose_presence_log(_overlay_close_debug_line(link_id, state, reason))
    link = state.get("link")
    if link is not None:
        completed, _result, error = _run_with_timeout(
            f"overlay-link-teardown-{str(link_id or '')[:8]}",
            _OVERLAY_LINK_TEARDOWN_TIMEOUT_SECONDS,
            link.teardown,
        )
        if not completed:
            log(
                "[presence_bridge] target=presence-reticulum overlay_link_teardown_timeout "
                f"link={link_id} reason={reason} "
                f"timeout_ms={int(_OVERLAY_LINK_TEARDOWN_TIMEOUT_SECONDS * 1000)}"
            )
        elif error:
            log(
                "[presence_bridge] target=presence-reticulum overlay_link_teardown_exception "
                f"link={link_id} reason={reason} err={error}"
            )
    state["established"] = False
    emit_overlay_link_state(link_id, state, reason)
    promoted_link_id = str(state.get("_promoted_overlay_link_id") or "")
    if peer_hash and promoted_link_id:
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_backup_promoted "
            f"peer={peer_hash} closed={link_id} promoted={promoted_link_id} reason={reason}"
        )
    if (
        peer_hash
        and not migration_candidate
        and not promoted_link_id
        and _overlay_teardown_should_demote(reason)
    ):
        _demote_overlay_fanout_peer(peer_hash, f"link_teardown:{reason}")
    if (
        peer_hash
        and not migration_candidate
        and not promoted_link_id
        and reason in {"rx_idle_timeout", "unestablished_timeout"}
    ):
        _clear_overlay_peer_failure_for_recovery(peer_hash, f"link_teardown:{reason}")
        if _overlay_enqueue_peer_recovery(
            peer_hash,
            f"link_teardown:{reason}",
            force_refresh=True,
        ):
            log(
                "[presence_bridge] target=presence-reticulum overlay_timeout_recovery_queued "
                f"peer={peer_hash} link={link_id} reason={reason}"
            )


def _overlay_open_job(peer_key: str, reason: str, await_path: bool = False) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    try:
        state = _ensure_overlay_link(peer_key, await_path=await_path, open_reason=reason)
        if state is None:
            _note_overlay_peer_failure(peer_key, f"open_failed:{reason}")
            return
        _ensure_managed_link_fields(state, kind="overlay", desired_state=_LINK_STATE_CONNECTING)
        if state.get("established") is True:
            state["manager_state"] = _LINK_STATE_ESTABLISHED
        else:
            state["manager_state"] = _LINK_STATE_CONNECTING
    finally:
        with _state_lock:
            _overlay_open_pending_by_peer_hash.discard(peer_key)


def _overlay_close_job(link_id: str, reason: str) -> None:
    link_key = str(link_id or "").strip()
    if not link_key:
        return
    try:
        _teardown_overlay_link_id(link_key, reason)
    finally:
        with _state_lock:
            _overlay_close_pending_link_ids.discard(link_key)


def _overlay_dedup_job(peer_key: str, reason: str = "dedup_same_peer") -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    try:
        _dedup_overlay_links_for_peer(peer_key, reason=reason)
    finally:
        with _state_lock:
            _overlay_dedup_pending_by_peer_hash.discard(peer_key)


def _maybe_prune_stale_overlay_links() -> None:
    now = time.time()
    stale_ids = []
    with _state_lock:
        for link_id, state in list(_overlay_links_by_id.items()):
            if state.get("established") is not True:
                created_at = state.get("created_at")
                if (
                    isinstance(created_at, (int, float))
                    and now - float(created_at) > _OVERLAY_UNESTABLISHED_LINK_TIMEOUT_SECONDS
                ):
                    stale_ids.append(link_id)
                continue
            last_rx = state.get("last_rx_at")
            if not isinstance(last_rx, (int, float)):
                last_rx = state.get("established_at") or state.get("created_at")
            if not isinstance(last_rx, (int, float)):
                continue
            if now - float(last_rx) > _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS:
                stale_ids.append(link_id)
    for link_id in stale_ids:
        state = get_overlay_link_state(link_id)
        reason = (
            "unestablished_timeout"
            if state is not None and state.get("established") is not True
            else "rx_idle_timeout"
        )
        _teardown_overlay_link_id(link_id, reason)


def _register_active_overlay_for_peer(peer_key: str, link_id: str) -> Optional[Dict[str, Any]]:
    """One active overlay link per peer hash; teardown duplicate links."""
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or not _valid_presence_destination_hash_hex(peer_key):
        return None
    state_for_direction = get_overlay_link_state(link_id)
    if state_for_direction is not None and state_for_direction.get("migration_candidate") is True:
        return state_for_direction
    incoming = bool(state_for_direction and state_for_direction.get("incoming") is True)
    if not _admit_overlay_peer_if_allowed(peer_key, "register_active", incoming=incoming):
        _overlay_enqueue_close(link_id, "admission_rejected")
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
        if (
            st_new.get("migration_draining") is True
            and st_new.get("migration_successor_link_id") == existing_link_id
        ):
            return st_old
        keep_id, lose_id = _dedup_pick_keep_link(
            peer_key,
            existing_link_id, st_old, link_id, st_new
        )
        _active_overlay_link_id_by_peer_hash[peer_key] = keep_id
        keep_state = _overlay_links_by_id.get(keep_id)
    if lose_id:
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_duplicate_detected "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        if keep_state is not None:
            log(
                "[presence_bridge] target=presence-reticulum overlay_link_canonical_keep "
                f"peer={peer_key} link={keep_id} incoming={str(keep_state.get('incoming') is True).lower()} "
                f"established={str(keep_state.get('established') is True).lower()}"
            )
        _schedule_overlay_duplicate_close(peer_key, keep_id, lose_id, "dedup_same_peer")
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
            and state.get("migration_candidate") is not True
            and state.get("migration_draining") is not True
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
            "[presence_bridge] target=presence-reticulum overlay_link_duplicate_detected "
            f"peer={peer_key} keep={keep_id} teardown={lose_id}"
        )
        _schedule_overlay_duplicate_close(peer_key, keep_id, lose_id, reason)
    return keep_state


def _flush_overlay_link_pending(link_id: str) -> None:
    state = get_overlay_link_state(link_id)
    if state is None or not _overlay_link_is_fanout_usable(state):
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
        queued = pending[0]
        traffic, wire_bytes = queued
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
    open_reason: str = "open",
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
    existing, replaced_link_id = _overlay_get_reusable_or_replace_active(peer_key, open_reason)
    if replaced_link_id:
        _overlay_enqueue_close(replaced_link_id, f"replace_unusable_active:{open_reason}")
    if existing is not None:
        return existing
    if _overlay_peer_inbound_full(peer_key):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_link_skipped "
            f"peer={peer_key} reason=peer_inbound_full"
        )
        return None
    if _overlay_peer_is_suppressed(peer_key):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_link_skipped "
            f"peer={peer_key} reason=peer_suppressed"
        )
        return None
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
        existing, replaced_link_id = _overlay_get_reusable_or_replace_active(
            peer_key,
            open_reason,
        )
        if replaced_link_id:
            _overlay_enqueue_close(replaced_link_id, f"replace_unusable_active:{open_reason}")
        if existing is not None:
            log(
                "[presence_bridge] target=presence-reticulum "
                f"overlay_link_reuse_{'incoming' if existing.get('incoming') is True else 'outgoing'} "
                f"peer={peer_key} link={existing.get('linkId') or ''}"
            )
            return existing
        if outbound is None:
            return None
        with _state_lock:
            if len(_overlay_links_by_id) >= _OVERLAY_MAX_TOTAL_LINKS:
                log(
                    "[presence_bridge] target=presence-reticulum overlay_open_deferred_pressure "
                    f"peer={peer_key} links={len(_overlay_links_by_id)} max={_OVERLAY_MAX_TOTAL_LINKS}"
                )
                _prune_overlay_link_pressure("link_pressure_outbound", reserve_slots=1)
                return None
        link_id = str(uuid.uuid4())
        link = RNS.Link(
            outbound,
            established_callback=on_outgoing_overlay_link_established,
            closed_callback=on_overlay_link_closed,
        )
        teardown_new_link = False
        existing_to_return: Optional[Dict[str, Any]] = None
        existing, replaced_link_id = _overlay_get_reusable_or_replace_active(
            peer_key,
            open_reason,
        )
        if replaced_link_id:
            _overlay_enqueue_close(replaced_link_id, f"replace_unusable_active:{open_reason}")
        if existing is not None:
            log(
                "[presence_bridge] target=presence-reticulum "
                f"overlay_link_reuse_{'incoming' if existing.get('incoming') is True else 'outgoing'} "
                f"peer={peer_key} link={existing.get('linkId') or ''}"
            )
            teardown_new_link = True
            existing_to_return = existing
        with _state_lock:
            if existing_to_return is None and len(_overlay_links_by_id) >= _OVERLAY_MAX_TOTAL_LINKS:
                log(
                    "[presence_bridge] target=presence-reticulum overlay_link_rejected_pressure "
                    f"peer={peer_key} links={len(_overlay_links_by_id)} max={_OVERLAY_MAX_TOTAL_LINKS}"
                )
                teardown_new_link = True
            if teardown_new_link:
                state = existing_to_return
            else:
                now = time.time()
                state = {
                    "linkId": link_id,
                    "link": link,
                    "rnsLinkId": (_rns_link_id_bytes(link) or b"").hex(),
                    "peerPresenceHash": peer_key,
                    "incoming": False,
                    "established": False,
                    "created_at": now,
                    "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
                    "open_reason": str(open_reason or "open"),
                    "announce_retry_created": str(open_reason or "").startswith("announce"),
                    "manager_kind": "overlay",
                    "manager_state": _LINK_STATE_CONNECTING,
                    "generation": 0,
                    "last_failure_reason": "",
                    "backoff_until": 0.0,
                }
                _overlay_links_by_id[link_id] = state
                _overlay_link_ids_by_object[id(link)] = link_id
                _set_link_manager_generation(link, state)
        if teardown_new_link:
            _teardown_reticulum_link_bounded(
                link,
                f"target=presence-reticulum overlay_link_discard_new peer={peer_key}",
            )
            return existing_to_return
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


def _overlay_open_reason_replaces_unusable_active(open_reason: str) -> bool:
    reason = str(open_reason or "").strip().lower()
    return (
        reason.startswith("zero_fanout")
        or reason.startswith("link_teardown:")
        or reason in {
            "announce_retry_stale",
            "unestablished_timeout",
            "rx_idle_timeout",
        }
    )


def _overlay_get_reusable_or_replace_active(
    peer_key: str,
    open_reason: str,
) -> Tuple[Optional[Dict[str, Any]], str]:
    existing_link_id = ""
    replace_link_id = ""
    replace_age_ms = 0
    replaces_unusable = _overlay_open_reason_replaces_unusable_active(open_reason)
    now = time.time()
    with _state_lock:
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        if not existing_link_id:
            return None, ""
        existing = _overlay_links_by_id.get(existing_link_id)
        if existing is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            return None, ""
        _ensure_managed_link_fields(existing, kind="overlay")
        if _overlay_link_is_fanout_usable(existing):
            return existing, ""
        if not replaces_unusable:
            return existing, ""
        created_at = existing.get("created_at")
        age = now - float(created_at) if isinstance(created_at, (int, float)) else 0.0
        if existing.get("established") is not True and age < _OVERLAY_UNESTABLISHED_LINK_TIMEOUT_SECONDS:
            return existing, ""
        if age < _OVERLAY_REPLACE_UNUSABLE_ACTIVE_MIN_AGE_SECONDS:
            return existing, ""
        replace_link_id = existing_link_id
        replace_age_ms = int(max(0.0, age) * 1000.0)
        existing["manager_state"] = _LINK_STATE_CLOSING
        existing["last_failure_reason"] = f"replace_unusable_active:{open_reason}"
        _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
    log(
        "[presence_bridge] target=presence-reticulum overlay_link_replace_unusable_active "
        f"peer={peer_key} link={replace_link_id} reason={open_reason} age_ms={replace_age_ms}"
    )
    return None, replace_link_id


def _retry_pending_overlay_connect_on_announce(peer_hash: str) -> None:
    """If an outbound reverse dial started before path resolution, retry it after announce arrives."""
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return
    local_hex = _local_presence_hash_hex()
    if local_hex and peer_key == local_hex:
        return
    if _overlay_peer_inbound_full(peer_key):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce_suppressed "
            f"peer={peer_key} reason=peer_inbound_full"
        )
        return
    if _overlay_peer_is_suppressed(peer_key):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce_suppressed "
            f"peer={peer_key} reason=peer_suppressed"
        )
        return
    existing_link_id = ""
    existing_age = 0.0
    stale = False
    now = time.time()
    with _state_lock:
        last_retry_at = float(_overlay_announce_retry_last_at_by_peer_hash.get(peer_key) or 0.0)
        if now - last_retry_at < _OVERLAY_ANNOUNCE_RETRY_DEBOUNCE_SECONDS:
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce_suppressed "
                f"peer={peer_key} reason=debounce"
            )
            return
        existing_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        if not existing_link_id:
            return
        existing = _overlay_links_by_id.get(existing_link_id)
        if existing is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_key, None)
            return
        if existing.get("incoming") is True or existing.get("established") is True:
            return
        created_at = existing.get("created_at")
        existing_age = now - float(created_at) if isinstance(created_at, (int, float)) else 0.0
        existing["path_refreshed_at"] = now
        existing["last_announce_retry_at"] = now
        _overlay_announce_retry_last_at_by_peer_hash[peer_key] = now
        stale = existing_age >= _OVERLAY_UNESTABLISHED_LINK_TIMEOUT_SECONDS
    if not stale:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce_kept "
            f"peer={peer_key} link={existing_link_id} age_ms={int(existing_age * 1000.0)}"
        )
        return
    if not _overlay_enqueue_close(existing_link_id, "announce_retry_stale"):
        return
    with _state_lock:
        _overlay_open_pending_by_peer_hash.add(peer_key)
    queued = _enqueue_scheduler_task(
        _overlay_io_lane_for_peer(peer_key),
        f"overlay-reopen-after-announce:{peer_key[:8]}",
        _overlay_open_job,
        peer_key,
        "announce_retry_stale",
        True,
        drop_oldest=False,
    )
    if not queued:
        with _state_lock:
            _overlay_open_pending_by_peer_hash.discard(peer_key)
    log(
        "[presence_bridge] target=presence-reticulum overlay_link_retry_on_announce "
        f"peer={peer_key} previous_link={existing_link_id} age_ms={int(existing_age * 1000.0)} "
        f"queued={str(bool(queued)).lower()}"
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
            _enqueue_scheduler_task(
                "audio-control",
                f"audio-link-raw-teardown:announce:{peer_key[:8]}",
                _teardown_reticulum_link_bounded,
                link,
                f"target=reticulum-audio-link audio_link_retry_previous peer={peer_key}",
            )
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
    started = time.monotonic()
    now = time.time()
    opens = 0
    closes = 0
    dedupes = 0

    def budget_available() -> bool:
        return (time.monotonic() - started) < _OVERLAY_RECONCILE_MAX_SECONDS

    stale_ids: List[Tuple[str, str]] = []
    pressure_ids: List[str] = []
    hard_refresh_peers: List[Tuple[str, str]] = []
    with _state_lock:
        for link_id, state in list(_overlay_links_by_id.items()):
            _ensure_managed_link_fields(state, kind="overlay")
            migration_candidate = state.get("migration_candidate") is True
            created_at = state.get("created_at")
            if (
                migration_candidate
                and isinstance(created_at, (int, float))
                and now - float(created_at)
                > _OVERLAY_ROUTE_MIGRATION_CANDIDATE_MAX_AGE_SECONDS
            ):
                state["manager_state"] = _LINK_STATE_BACKOFF
                state["last_failure_reason"] = "migration_candidate_expired"
                stale_ids.append((link_id, "migration_candidate_rejected"))
                continue
            if state.get("established") is not True:
                if (
                    isinstance(created_at, (int, float))
                    and now - float(created_at) > _OVERLAY_UNESTABLISHED_LINK_TIMEOUT_SECONDS
                ):
                    state["manager_state"] = _LINK_STATE_BACKOFF
                    stale_reason = (
                        "migration_candidate_rejected"
                        if migration_candidate
                        else "unestablished_timeout"
                    )
                    state["last_failure_reason"] = stale_reason
                    stale_ids.append((link_id, stale_reason))
                continue
            last_rx = state.get("last_rx_at")
            if not isinstance(last_rx, (int, float)):
                last_rx = state.get("established_at") or state.get("created_at")
            if isinstance(last_rx, (int, float)) and now - float(last_rx) > _OVERLAY_LINK_RX_IDLE_TIMEOUT_SECONDS:
                state["manager_state"] = _LINK_STATE_DEGRADED
                stale_reason = (
                    "migration_candidate_rejected"
                    if migration_candidate
                    else "rx_idle_timeout"
                )
                state["last_failure_reason"] = stale_reason
                stale_ids.append((link_id, stale_reason))
                peer_hash = _overlay_link_peer_hash(state)
                if peer_hash and not migration_candidate:
                    hard_refresh_peers.append((peer_hash, "rx_idle_timeout"))
        excess = len(_overlay_links_by_id) - _OVERLAY_MAX_TOTAL_LINKS
        if excess > 0:
            candidates = sorted(_overlay_links_by_id.items(), key=_overlay_link_pressure_sort_key)
            pressure_ids = [link_id for link_id, _state in candidates[:excess]]
    for link_id, reason in stale_ids:
        if closes >= _OVERLAY_RECONCILE_MAX_CLOSES or not budget_available():
            break
        if _overlay_enqueue_close(link_id, reason):
            closes += 1
    for peer_hash, reason in hard_refresh_peers:
        if not budget_available():
            break
        _force_overlay_peer_path_refresh(
            peer_hash,
            target="presence-reticulum",
            reason=f"overlay_link_close:{reason}",
        )
    for link_id in pressure_ids:
        if closes >= _OVERLAY_RECONCILE_MAX_CLOSES or not budget_available():
            break
        if _overlay_enqueue_close(link_id, "link_pressure"):
            closes += 1

    _bootstrap_overlay_neighbors_if_degraded("sync")
    _recover_zero_overlay_fanout("sync")
    _prune_candidate_peers()
    pinned_chat_peers = _prune_pinned_chat_overlay_peers(now)
    desired_outbound = set(_active_overlay_neighbors.keys()) | pinned_chat_peers
    desired_ordinary_count = sum(
        1 for peer_hash in desired_outbound if peer_hash not in pinned_chat_peers
    )
    for peer_hash in sorted(_candidate_peers.keys(), key=_overlay_bootstrap_peer_sort_key):
        peer_key = str(peer_hash or "").strip().lower()
        if not _valid_presence_destination_hash_hex(peer_key):
            continue
        if (
            peer_key not in pinned_chat_peers
            and desired_ordinary_count >= _OVERLAY_MAX_OUTBOUND_NEIGHBORS
        ):
            break
        if peer_key in desired_outbound or peer_key in _inbound_overlay_neighbors:
            continue
        if not _overlay_peer_available_for_new_outbound(peer_key):
            continue
        desired_outbound.add(peer_key)
        if peer_key not in pinned_chat_peers:
            desired_ordinary_count += 1
    desired = desired_outbound | set(_inbound_overlay_neighbors.keys())
    target_outbound_links = min(
        _OVERLAY_MAX_OUTBOUND_NEIGHBORS + len(pinned_chat_peers),
        len(desired_outbound),
    )
    maintained_outbound_links = 0
    for peer_hash in desired_outbound:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_hash)
        state = get_overlay_link_state(link_id) if link_id else None
        if state is not None:
            maintained_outbound_links += 1
            continue
        with _state_lock:
            open_pending = peer_hash in _overlay_open_pending_by_peer_hash
        if open_pending:
            maintained_outbound_links += 1
            continue
        if _overlay_peer_inbound_full(peer_hash):
            _active_overlay_neighbors.pop(peer_hash, None)
            _candidate_peers.pop(peer_hash, None)
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_sync_skip_outbound "
                f"peer={peer_hash} reason=peer_inbound_full"
            )
            continue
        if maintained_outbound_links >= target_outbound_links:
            continue
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
        if opens >= _OVERLAY_RECONCILE_MAX_OPENS or not budget_available():
            continue
        if _overlay_enqueue_open(peer_hash, "sync", await_path=True):
            opens += 1
            maintained_outbound_links += 1
    for peer_hash, link_id in list(_active_overlay_link_id_by_peer_hash.items()):
        if peer_hash in desired:
            continue
        state = get_overlay_link_state(link_id)
        if state is None:
            _active_overlay_link_id_by_peer_hash.pop(peer_hash, None)
            continue
        if _retain_recent_rx_outbound_peer(peer_hash, state, "pruned", time.time()):
            continue
        if closes >= _OVERLAY_RECONCILE_MAX_CLOSES or not budget_available():
            continue
        if _overlay_enqueue_close(link_id, "pruned"):
            closes += 1
    for peer_hash in list(desired):
        if dedupes >= _OVERLAY_RECONCILE_MAX_DEDUPES or not budget_available():
            break
        if _overlay_enqueue_dedup(peer_hash, reason="dedup_same_peer"):
            dedupes += 1
    for link_id, state in list(_overlay_links_by_id.items()):
        if closes >= _OVERLAY_RECONCILE_MAX_CLOSES or not budget_available():
            break
        if state.get("migration_candidate") is True:
            continue
        if state.get("migration_draining") is True:
            continue
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if not peer_hash:
            if (
                len(_inbound_overlay_neighbors) >= _OVERLAY_MAX_INBOUND_NEIGHBORS
                or len(_overlay_links_by_id) > (
                    _OVERLAY_MAX_OUTBOUND_NEIGHBORS
                    + _OVERLAY_MAX_INBOUND_NEIGHBORS
                    + _OVERLAY_MAX_PINNED_CHAT_PEERS
                )
            ):
                if _overlay_enqueue_close(link_id, "pruned_unknown_full"):
                    closes += 1
            continue
        active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_hash)
        if active_link_id == link_id:
            continue
        if peer_hash not in desired:
            if _overlay_enqueue_close(link_id, "pruned_orphan"):
                closes += 1
        elif active_link_id:
            if _overlay_enqueue_close(link_id, "dedup_orphan"):
                closes += 1
    if (
        opens >= _OVERLAY_RECONCILE_MAX_OPENS
        or closes >= _OVERLAY_RECONCILE_MAX_CLOSES
        or dedupes >= _OVERLAY_RECONCILE_MAX_DEDUPES
        or not budget_available()
    ):
        _enqueue_scheduler_task(
            "overlay-control",
            "overlay-sync-maintenance-continuation",
            _run_overlay_sync_maintenance,
            "overlay_sync_continuation",
            drop_oldest=True,
        )
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum overlay_manager_reconcile "
        f"reason=sync opens={opens} closes={closes} dedupes={dedupes} "
        f"duration_ms={(time.monotonic() - started) * 1000.0:.3f}"
    )


def _run_overlay_sync_maintenance(reason: str = "overlay_sync_state") -> None:
    try:
        _sync_overlay_links()
        _enqueue_scheduler_task(
            "path-management",
            "overlay-low-health-announce",
            _maybe_announce_local_destination_low_verified_overlay_peers,
            drop_oldest=True,
        )
    except Exception as exc:
        log(
            "[presence_bridge] target=presence-reticulum overlay_sync_maintenance_failed "
            f"reason={reason} err={exc}"
        )


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


def _presence_message_seen_recently(
    message_id: str,
    origin_peer_hash: str,
    sender_hash: str,
    now: float,
) -> bool:
    message_id = str(message_id or "").strip()
    origin_peer_hash = str(origin_peer_hash or "").strip().lower()
    sender_hash = str(sender_hash or "").strip().lower()
    if not message_id:
        return False
    # The same presence envelope can arrive through several overlay peers. Dedupe
    # by the original sender and envelope id before queueing it to Electron.
    cache_key = f"{origin_peer_hash or sender_hash}:{message_id}"
    expired_before = now - _RECENT_PRESENCE_MESSAGE_ID_TTL_SECONDS
    for cached_id, seen_at in list(_recent_presence_message_ids.items()):
        if seen_at < expired_before:
            _recent_presence_message_ids.pop(cached_id, None)
    seen = cache_key in _recent_presence_message_ids
    _recent_presence_message_ids[cache_key] = now
    if len(_recent_presence_message_ids) > _RECENT_PRESENCE_MESSAGE_ID_LIMIT:
        overflow = len(_recent_presence_message_ids) - _RECENT_PRESENCE_MESSAGE_ID_LIMIT
        for cached_id in list(_recent_presence_message_ids.keys())[:overflow]:
            _recent_presence_message_ids.pop(cached_id, None)
    return seen


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
    signed_session_origin = _presence_route_bound_destination_hash(session_id)
    if isinstance(origin_hash, str) and origin_hash.strip():
        candidate_origin_hash = origin_hash.strip().lower()
        if not _valid_presence_destination_hash_hex(candidate_origin_hash):
            log("[presence_bridge] ignored malformed presence packet origin_hash")
            return False
        origin_peer_hash = candidate_origin_hash
    elif signed_session_origin is not None:
        # New clients commit the originating endpoint inside the wallet-signed
        # session id. This avoids the 39-byte `o` field on every relayed frame.
        origin_peer_hash = signed_session_origin

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

    now = time.time()
    if _presence_message_seen_recently(message_id, origin_peer_hash, sender_hash, now):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum duplicate_presence_ignored "
            f"envelope_id={message_id} sender={sender_hash} origin={origin_peer_hash}"
        )
        return False

    _note_presence_pressure("decoded:presence", message_type)
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


def _reticulum_chat_inbound_dedup_key(
    message: Dict[str, Any],
) -> Optional[Tuple[str, float]]:
    message_type = message.get("k")
    if message_type == "identity_req":
        request_id = message.get("rid")
        destination_hash = message.get("d")
        hops = message.get("h")
        max_hops = message.get("m")
        expires_at = message.get("x")
        if not isinstance(request_id, str) or not request_id.strip():
            return None
        if not isinstance(destination_hash, str) or not destination_hash.strip():
            return None
        if (
            isinstance(hops, bool)
            or not isinstance(hops, int)
            or isinstance(max_hops, bool)
            or not isinstance(max_hops, int)
            or hops < 0
            or max_hops < hops
            or max_hops > 5
        ):
            return None
        if (
            isinstance(expires_at, bool)
            or not isinstance(expires_at, (int, float))
            or not math.isfinite(float(expires_at))
            or float(expires_at) <= time.time() * 1000
            or float(expires_at) > (time.time() + 60.0) * 1000
        ):
            return None
        return (
            f"identity_req:{request_id.strip().lower()}:{destination_hash.strip().lower()}",
            _RETICULUM_CHAT_IDENTITY_DEDUP_TTL_SECONDS,
        )
    if message_type == "typing":
        group_id = message.get("g")
        channel_id = message.get("c")
        author = message.get("a")
        timestamp = message.get("ts")
        if (
            isinstance(group_id, bool)
            or not isinstance(group_id, int)
            or group_id <= 0
        ):
            return None
        if (
            not isinstance(channel_id, str)
            or not isinstance(author, str)
            or not author.strip()
        ):
            return None
        if (
            isinstance(timestamp, bool)
            or not isinstance(timestamp, (int, float))
            or not math.isfinite(float(timestamp))
        ):
            return None
        stable_fields = [
            group_id,
            channel_id.strip(),
            author.strip(),
            int(timestamp),
            message.get("active") is True,
        ]
        digest = hashlib.sha256(
            json.dumps(stable_fields, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return (
            f"typing:{digest}",
            _RETICULUM_CHAT_TYPING_DEDUP_TTL_SECONDS,
        )
    return None


def _should_drop_duplicate_reticulum_chat_inbound(
    message: Dict[str, Any],
) -> bool:
    global _reticulum_chat_inbound_dedup_last_log_at
    global _reticulum_chat_inbound_dedup_suppressed_since_log
    keyed_ttl = _reticulum_chat_inbound_dedup_key(message)
    if keyed_ttl is None:
        return False
    key, ttl_seconds = keyed_ttl
    now = time.time()
    with _state_lock:
        expires_at = _reticulum_chat_inbound_dedup.get(key)
        if isinstance(expires_at, (int, float)) and float(expires_at) > now:
            _reticulum_chat_inbound_dedup_suppressed_since_log += 1
            if now - _reticulum_chat_inbound_dedup_last_log_at >= 10.0:
                log(
                    "[presence_bridge] target=reticulum-chat-inbound-dedup "
                    f"suppressed={_reticulum_chat_inbound_dedup_suppressed_since_log} "
                    f"cache={len(_reticulum_chat_inbound_dedup)}"
                )
                _reticulum_chat_inbound_dedup_suppressed_since_log = 0
                _reticulum_chat_inbound_dedup_last_log_at = now
            return True
        _reticulum_chat_inbound_dedup[key] = now + ttl_seconds
        if len(_reticulum_chat_inbound_dedup) > _RETICULUM_CHAT_INBOUND_DEDUP_MAX:
            expired = [
                cached_key
                for cached_key, cached_expiry in _reticulum_chat_inbound_dedup.items()
                if not isinstance(cached_expiry, (int, float))
                or float(cached_expiry) <= now
            ]
            for cached_key in expired:
                _reticulum_chat_inbound_dedup.pop(cached_key, None)
            overflow = (
                len(_reticulum_chat_inbound_dedup)
                - _RETICULUM_CHAT_INBOUND_DEDUP_MAX
            )
            if overflow > 0:
                for cached_key in list(_reticulum_chat_inbound_dedup.keys())[
                    :overflow
                ]:
                    _reticulum_chat_inbound_dedup.pop(cached_key, None)
    return False


def _emit_call_bridge_message(
    message: Dict[str, Any],
    peer_presence_hash: str = "",
    link_id: Optional[str] = None,
    land_state_fast_forwarded: bool = False,
    land_state_forwarding_revision: Optional[int] = None,
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
    if t == _RETICULUM_CHAT_WIRE_TYPE:
        if _should_drop_duplicate_reticulum_chat_inbound(message):
            return True
        _note_presence_pressure("decoded:reticulum_chat", str(message.get("k") or ""))
        payload: Dict[str, Any] = {
            "wire": message,
            "senderDestinationHash": sender_call_hash,
            "peerPresenceHash": resolved_presence_hash,
        }
        if link_id:
            payload["linkId"] = link_id
        if land_state_fast_forwarded and message.get("k") == "land_state":
            payload["landStateFastForwarded"] = True
            if isinstance(land_state_forwarding_revision, int):
                payload["landStateForwardingRevision"] = (
                    land_state_forwarding_revision
                )
        emit_event("reticulum_chat_message", payload)
        chat_details = _reticulum_chat_wire_log_details(message)
        log(
            f"[presence_bridge] received reticulum_chat_message k={message.get('k')} "
            f"sender_r={sender_call_hash[:16] if sender_call_hash else ''} "
            f"size={len(_call_wire_json_bytes(message))} {chat_details}".rstrip()
        )
        return True
    event_name = (
        "group_call_message"
        if isinstance(t, str) and t in _GROUP_CALL_WIRE_TYPES
        else "call_message"
    )
    _note_presence_pressure(
        "decoded:group_call" if event_name == "group_call_message" else "decoded:call",
        str(t or ""),
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


def _call_relay_dedup_key(kind: str, message: Dict[str, Any], wire_bytes: bytes) -> str:
    message_type = message.get("t")
    type_key = message_type if isinstance(message_type, str) and message_type else "?"
    overlay_id = message.get("X")
    if isinstance(overlay_id, str) and overlay_id:
        return f"{kind}:{type_key}:x:{overlay_id}"
    digest = hashlib.sha256(wire_bytes).hexdigest()
    return f"{kind}:{type_key}:h:{digest}"


def _sweep_call_relay_dedup(now: float) -> None:
    expired = [
        key for key, expires_at in _call_relay_dedup.items()
        if not isinstance(expires_at, (int, float)) or float(expires_at) <= now
    ]
    for key in expired:
        _call_relay_dedup.pop(key, None)
    overflow = len(_call_relay_dedup) - _CALL_RELAY_DEDUP_MAX
    if overflow > 0:
        for key in list(_call_relay_dedup.keys())[:overflow]:
            _call_relay_dedup.pop(key, None)


def _filter_new_call_relay_frames(
    kind: str,
    messages: list[Dict[str, Any]],
    encoded_frames: list[bytes],
    message_types: list[str],
) -> tuple[list[Dict[str, Any]], list[bytes], list[str], int]:
    global _call_relay_dedup_last_log_at, _call_relay_dedup_suppressed_since_log
    now = time.time()
    with _state_lock:
        _sweep_call_relay_dedup(now)
        next_messages: list[Dict[str, Any]] = []
        next_frames: list[bytes] = []
        next_types: list[str] = []
        suppressed = 0
        for index, message in enumerate(messages):
            wire_bytes = encoded_frames[index]
            key = _call_relay_dedup_key(kind, message, wire_bytes)
            expires_at = _call_relay_dedup.get(key)
            if isinstance(expires_at, (int, float)) and float(expires_at) > now:
                suppressed += 1
                continue
            _call_relay_dedup[key] = now + _CALL_RELAY_DEDUP_TTL_SECONDS
            next_messages.append(message)
            next_frames.append(wire_bytes)
            next_types.append(message_types[index])
        if suppressed:
            _call_relay_dedup_suppressed_since_log += suppressed
            if now - _call_relay_dedup_last_log_at >= 10.0:
                log(
                    "[presence_bridge] target=reticulum-call-relay-dedup "
                    f"kind={kind} suppressed={_call_relay_dedup_suppressed_since_log} "
                    f"cache={len(_call_relay_dedup)}"
                )
                _call_relay_dedup_suppressed_since_log = 0
                _call_relay_dedup_last_log_at = now
        return next_messages, next_frames, next_types, suppressed


def on_overlay_link_closed(link) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    if not _link_manager_generation_current("overlay", link_id, link):
        return
    teardown_reason = getattr(link, "teardown_reason", None)
    reason = _overlay_teardown_reason_name(teardown_reason)
    now = time.time()
    state = remove_overlay_link(link_id)
    if state is None:
        return
    migration_candidate = state.get("migration_candidate") is True
    promoted_link_id = str(state.get("_promoted_overlay_link_id") or "")
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    last_replay_at = state.get("last_replay_at")
    replay_associated = (
        isinstance(last_replay_at, (int, float))
        and now - float(last_replay_at) <= _OVERLAY_REPLAY_CLOSE_ASSOCIATION_SECONDS
    )
    announce_retry_associated = state.get("announce_retry_created") is True
    with _state_lock:
        _overlay_close_diagnostics.append(
            (now, reason, bool(replay_associated), bool(announce_retry_associated))
        )
    verbose_presence_log(_overlay_close_debug_line(link_id, state, reason))
    if not migration_candidate and not promoted_link_id:
        _maybe_request_path_after_unestablished_link_close(
            state,
            link,
            target="presence-reticulum",
            reason=reason,
        )
    state["established"] = False
    emit_overlay_link_state(
        link_id,
        state,
        reason,
        closed_by_reticulum=True,
    )
    if migration_candidate or promoted_link_id:
        if peer_hash and promoted_link_id:
            log(
                "[presence_bridge] target=presence-reticulum "
                "overlay_link_backup_promoted "
                f"peer={peer_hash} closed={link_id} promoted={promoted_link_id} "
                f"reason={reason}"
            )
        return
    if peer_hash and _overlay_recent_activity_close_should_keep_peer(state, reason, now):
        age = _overlay_link_recent_activity_age_seconds(state, now)
        _note_overlay_peer_alive(peer_hash, "recent_close_activity")
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_close_kept_peer "
            f"peer={peer_hash} recent_activity_age_ms={int((age or 0.0) * 1000.0)}"
        )
        return
    if peer_hash and _overlay_teardown_should_demote(reason):
        _demote_overlay_fanout_peer(peer_hash, f"link_closed:{reason}")


def on_overlay_link_remote_identified(link, identity) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    if not _link_manager_generation_current("overlay", link_id, link):
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    derived_peer_hash = derive_presence_destination_hash_for_identity(identity)
    local_hex = _local_presence_hash_hex()
    migration_candidate = state.get("migration_candidate") is True
    expected = str(state.get("peerPresenceHash") or "").strip().lower()
    if (
        migration_candidate
        and state.get("incoming") is True
        and (
            not expected
            or not derived_peer_hash
            or derived_peer_hash != expected
        )
    ):
        log(
            "[presence_bridge] target=presence-reticulum "
            "overlay_migration_candidate_identity_rejected "
            f"link={link_id} expected={expected or 'unknown'} "
            f"derived={derived_peer_hash or 'unknown'}"
        )
        _overlay_enqueue_close(link_id, "remote_identified_mismatch")
        return
    if derived_peer_hash:
        if local_hex and derived_peer_hash == local_hex:
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified_self "
                f"link={link_id} expected={expected or 'unknown'}"
            )
            _overlay_enqueue_close(link_id, "remote_identified_self")
            return
        if expected and derived_peer_hash != expected:
            log(
                "[presence_bridge] target=presence-reticulum overlay_remote_identified_mismatch "
                f"link={link_id} expected={expected} derived={derived_peer_hash}"
            )
            _overlay_enqueue_close(link_id, "remote_identified_mismatch")
            return
    if migration_candidate and state.get("incoming") is True:
        state["migration_peer_authenticated"] = True
        state["overlay_transport_admitted"] = True
        state["overlay_transport_admitted_at"] = time.time()
        _note_overlay_peer_alive(expected, "migration_remote_identified")
    peer_hash = find_peer_hash_for_identity(identity)
    if (
        migration_candidate
        and state.get("incoming") is True
        and peer_hash
        and peer_hash != expected
    ):
        log(
            "[presence_bridge] target=presence-reticulum "
            "overlay_migration_candidate_identity_rejected "
            f"link={link_id} expected={expected} resolved={peer_hash}"
        )
        _overlay_enqueue_close(link_id, "remote_identified_mismatch")
        return
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
        _overlay_enqueue_dedup(ph_reg, reason="dedup_same_peer")
        if migration_candidate and state.get("incoming") is True:
            _send_overlay_hello_for_link(link_id, "migration_identity_verified")


def _audio_overlay_promotion_allowed(peer_key: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        active_id = _active_audio_link_id_by_peer_hash.get(peer_key) or ""
        if active_id and active_id in _audio_links_by_id:
            return True
        outgoing_id = _outgoing_audio_link_id_by_peer_hash.get(peer_key) or ""
        if outgoing_id and outgoing_id in _audio_links_by_id:
            return True
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
        return bool(desired and desired.get("desired") is True)


def _promote_misclassified_overlay_link_to_audio(
    link,
    overlay_link_id: str,
    peer_key: str,
    sender_destination_hash: str,
) -> str:
    if link is None or not overlay_link_id:
        return ""
    peer_key = str(peer_key or "").strip().lower()
    if not _audio_overlay_promotion_allowed(peer_key):
        return ""
    state = get_overlay_link_state(overlay_link_id)
    if state is None or state.get("incoming") is not True:
        return ""
    overlay_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    removed = remove_overlay_link(overlay_link_id)
    if removed is None:
        return ""
    if overlay_peer_hash and removed.get("_was_active_overlay") is True:
        with _state_lock:
            _active_overlay_neighbors.pop(overlay_peer_hash, None)
            _inbound_overlay_neighbors.pop(overlay_peer_hash, None)
    link_id = str(uuid.uuid4())
    now = time.time()
    created_at = removed.get("created_at")
    audio_state = {
        "link": link,
        "peerPresenceHash": peer_key,
        "peerDestinationHash": str(sender_destination_hash or "").strip().lower(),
        "incoming": True,
        "established": True,
        "established_at": now,
        "created_at": created_at if isinstance(created_at, (int, float)) else now,
        "last_activity_at": now,
        "last_rx_at": now,
        "promoted_from_overlay_link_id": overlay_link_id,
    }
    _ensure_audio_link_lifecycle_fields(audio_state)
    with _state_lock:
        _audio_links_by_id[link_id] = audio_state
    configure_audio_link(link, link_id)
    log(
        "[presence_bridge] target=reticulum-audio-link overlay_link_promoted_to_audio "
        f"overlay_link={overlay_link_id} audio_link={link_id} peer={peer_key}"
    )
    return link_id


def _promote_overlay_audio_sender_if_allowed(
    link,
    overlay_link_id: str,
    sender_destination_hash: str,
) -> str:
    peer_key = _resolve_sender_peer_destination_hash(sender_destination_hash)
    return _promote_misclassified_overlay_link_to_audio(
        link,
        overlay_link_id,
        peer_key,
        sender_destination_hash,
    )


def _qchat_file_overlay_promotion_peer_hash(decoded: Dict[str, Any]) -> str:
    peer_hash = str(
        decoded.get("downloaderReticulumDestinationHash") or ""
    ).strip().lower()
    return peer_hash if _valid_presence_destination_hash_hex(peer_hash) else ""


def _qchat_file_overlay_promotion_allowed(
    transfer_id: str,
    peer_hash: str,
) -> bool:
    transfer_id = str(transfer_id or "").strip()
    peer_hash = str(peer_hash or "").strip().lower()
    if not transfer_id or not _valid_presence_destination_hash_hex(peer_hash):
        return False
    with _state_lock:
        pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
    if not isinstance(pending, dict):
        return False
    return float(pending.get("expires_at") or 0) >= time.time()


def _is_qchat_file_auth_packet(decoded: Dict[str, Any]) -> bool:
    if not isinstance(decoded, dict):
        return False
    decoded_type = decoded.get("type")
    decoded_compact_type = decoded.get("t")
    return decoded_type in (
        "QCHAT_FILE_LINK_AUTH",
        _RETICULUM_CHAT_RESOURCE_AUTH_TYPE,
        _RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_TYPE,
        _RETICULUM_CHAT_HISTORY_PAGE_REQUEST_TYPE,
        _RETICULUM_CHAT_DM_PAGE_REQUEST_TYPE,
        _RETICULUM_GROUP_RESOURCE_AUTH_TYPE,
        _RETICULUM_DM_RESOURCE_AUTH_TYPE,
    ) or decoded_compact_type in (
        _RETICULUM_CHAT_RESOURCE_AUTH_COMPACT_TYPE,
        _RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_COMPACT_TYPE,
    )


def _qchat_file_auth_resource_type(decoded: Dict[str, Any]) -> str:
    decoded_type = decoded.get("type")
    decoded_compact_type = decoded.get("t")
    if decoded_type in (
        _RETICULUM_CHAT_RESOURCE_AUTH_TYPE,
        _RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_TYPE,
        _RETICULUM_CHAT_HISTORY_PAGE_REQUEST_TYPE,
        _RETICULUM_CHAT_DM_PAGE_REQUEST_TYPE,
    ) or decoded_compact_type in (
        _RETICULUM_CHAT_RESOURCE_AUTH_COMPACT_TYPE,
        _RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH_COMPACT_TYPE,
    ):
        return _RETICULUM_CHAT_RESOURCE_TYPE
    if decoded_type == _RETICULUM_GROUP_RESOURCE_AUTH_TYPE:
        return _RETICULUM_RESOURCE_TYPE
    if decoded_type == _RETICULUM_DM_RESOURCE_AUTH_TYPE:
        return f"{_RETICULUM_RESOURCE_TYPE}_dm_range"
    return "qchat-dm-file"


def _promote_overlay_link_to_qchat_file(
    link,
    overlay_link_id: str,
    transfer_id: str,
    peer_hash: str = "",
) -> str:
    if link is None or not overlay_link_id:
        return ""
    transfer_id = str(transfer_id or "").strip()
    peer_hash = str(peer_hash or "").strip().lower()
    state = get_overlay_link_state(overlay_link_id)
    if state is None or state.get("incoming") is not True:
        return ""
    overlay_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    removed = remove_overlay_link(overlay_link_id)
    if removed is None:
        return ""
    if overlay_peer_hash and removed.get("_was_active_overlay") is True:
        with _state_lock:
            _active_overlay_neighbors.pop(overlay_peer_hash, None)
            _inbound_overlay_neighbors.pop(overlay_peer_hash, None)
    link_id = _register_incoming_qchat_file_link(link, peer_hash, transfer_id)
    if link_id:
        log(
            "[presence_bridge] target=qchat-file-reticulum overlay_link_promoted_to_qchat_file "
            f"overlay_link={overlay_link_id} file_link={link_id} peer={peer_hash or 'unknown'} transfer={transfer_id}"
        )
    return link_id


def _promote_misclassified_overlay_link_to_qchat_file(
    link,
    overlay_link_id: str,
    transfer_id: str,
    peer_hash: str,
) -> str:
    if link is None or not overlay_link_id:
        return ""
    transfer_id = str(transfer_id or "").strip()
    peer_hash = str(peer_hash or "").strip().lower()
    if not _qchat_file_overlay_promotion_allowed(transfer_id, peer_hash):
        return ""
    return _promote_overlay_link_to_qchat_file(
        link,
        overlay_link_id,
        transfer_id,
        peer_hash,
    )


def _configure_land_state_forwarding(
    plans: Any,
    sessions: Any,
    revision: Any,
) -> Tuple[int, int, int]:
    global _land_state_forwarding_plans
    global _land_state_auth_sessions
    global _land_state_forwarding_revision

    now = time.time()
    next_plans: Dict[int, Dict[str, float]] = {}
    if isinstance(plans, list):
        for raw_plan in plans[:_LAND_STATE_FORWARDING_MAX_GROUPS]:
            if not isinstance(raw_plan, dict):
                continue
            group_id = raw_plan.get("groupId")
            if isinstance(group_id, bool) or not isinstance(group_id, int) or group_id <= 0:
                continue
            targets: Dict[str, float] = {}
            raw_targets = raw_plan.get("targets")
            if isinstance(raw_targets, list):
                # Never install a partial plan. Electron can safely fall back to
                # its authoritative forwarding path when a group exceeds this cap.
                if len(raw_targets) > _LAND_STATE_FORWARDING_MAX_TARGETS_PER_GROUP:
                    continue
                for raw_target in raw_targets[:_LAND_STATE_FORWARDING_MAX_TARGETS_PER_GROUP]:
                    if not isinstance(raw_target, dict):
                        continue
                    peer_hash = str(raw_target.get("peerPresenceHash") or "").strip().lower()
                    try:
                        expires_at = float(raw_target.get("expiresAt") or 0) / 1000.0
                    except Exception:
                        expires_at = 0.0
                    if not peer_hash or expires_at <= now:
                        continue
                    targets[peer_hash] = max(float(targets.get(peer_hash) or 0.0), expires_at)
            if targets:
                next_plans[group_id] = targets

    with _land_state_forwarding_lock:
        previous_sessions = _land_state_auth_sessions
        next_sessions: Dict[Tuple[int, str, str], Dict[str, Any]] = {}
        if isinstance(sessions, list):
            for raw_session in sessions[:_LAND_STATE_FORWARDING_MAX_SESSIONS]:
                if not isinstance(raw_session, dict):
                    continue
                group_id = raw_session.get("groupId")
                author = str(raw_session.get("authorAddress") or "").strip()
                session_id = str(raw_session.get("sessionId") or "").strip()
                public_key_base58 = str(raw_session.get("ephemeralPublicKey") or "").strip()
                try:
                    expires_at = float(raw_session.get("expiresAt") or 0) / 1000.0
                    public_key = qortal_base58_decode(public_key_base58)
                except Exception:
                    continue
                if (
                    isinstance(group_id, bool)
                    or not isinstance(group_id, int)
                    or group_id <= 0
                    or not author
                    or not session_id
                    or len(session_id) > 16
                    or len(public_key) != 32
                    or expires_at <= now
                ):
                    continue
                key = (group_id, author, session_id)
                previous = previous_sessions.get(key)
                last_sequence = -1
                if previous is not None and previous.get("publicKey") == public_key:
                    previous_sequence = previous.get("lastSequence")
                    if isinstance(previous_sequence, int):
                        last_sequence = previous_sequence
                next_sessions[key] = {
                    "publicKey": public_key,
                    "expiresAt": expires_at,
                    "lastSequence": last_sequence,
                }

        _land_state_forwarding_plans = next_plans
        _land_state_auth_sessions = next_sessions
        try:
            _land_state_forwarding_revision = max(0, int(revision))
        except Exception:
            _land_state_forwarding_revision += 1

    target_count = sum(len(targets) for targets in next_plans.values())
    log(
        "[presence_bridge] target=land-state-forwarding configured "
        f"revision={_land_state_forwarding_revision} groups={len(next_plans)} "
        f"targets={target_count} sessions={len(next_sessions)}"
    )
    return len(next_plans), target_count, len(next_sessions)


def _land_state_normalized_int(value: Any, minimum: int, maximum: int) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    rounded = int(math.floor(numeric + 0.5))
    return max(minimum, min(maximum, rounded))


def _land_state_sequence_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    sequence = int(math.floor(numeric))
    if sequence > 2**32 - 1:
        return None
    return max(0, sequence)


def _land_state_verification_fields(message: Dict[str, Any]) -> Optional[Tuple[Tuple[int, str, str], int, bytes]]:
    group_id = message.get("g")
    author = str(message.get("a") or "").strip()
    session_id = str(message.get("s") or "").strip()
    if (
        isinstance(group_id, bool)
        or not isinstance(group_id, int)
        or group_id <= 0
        or not author
        or not session_id
        or len(session_id) > 16
    ):
        return None
    sequence = _land_state_sequence_int(message.get("q"))
    x = _land_state_normalized_int(message.get("x"), 0, 4095)
    y = _land_state_normalized_int(message.get("y"), 0, 2047)
    if sequence is None or x is None or y is None:
        return None
    availability = message.get("v", 0)
    skin_id = message.get("i")
    if (
        isinstance(availability, bool)
        or not isinstance(availability, int)
        or availability < 0
        or availability > 15
        or isinstance(skin_id, bool)
        or not isinstance(skin_id, int)
        or skin_id < 1
        or skin_id > 31
    ):
        return None
    try:
        timestamp_number = float(message.get("ts"))
    except Exception:
        return None
    if not math.isfinite(timestamp_number):
        return None
    now_ms = time.time() * 1000.0
    if (
        timestamp_number > now_ms + _LAND_STATE_MAX_FUTURE_SKEW_MS
        or timestamp_number < now_ms - _LAND_STATE_MAX_AGE_MS
    ):
        return None
    timestamp: Any = (
        int(timestamp_number) if timestamp_number.is_integer() else timestamp_number
    )
    signed_fields = {
        "afk": bool(availability & 1),
        "authorAddress": author,
        "direction": str(message.get("d") or ""),
        "dnd": bool(availability & 2),
        "groupId": group_id,
        "movement": str(message.get("m") or ""),
        "roomId": str(message.get("u") or ""),
        "sequence": sequence,
        "sessionId": session_id,
        "skinId": skin_id,
        "timestamp": timestamp,
        "type": "QORTAL_LAND_STATE",
        "x": x,
        "y": y,
    }
    if availability & 12:
        signed_fields["voiceEnabled"] = bool(availability & 4)
        signed_fields["voiceMuted"] = bool(availability & 8)
    signed_bytes = json.dumps(
        signed_fields,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return (group_id, author, session_id), sequence, signed_bytes


def _land_state_destination_hash(value: Any) -> str:
    text = str(value or "").strip()
    lowered = text.lower()
    if len(lowered) == 32 and all(ch in "0123456789abcdef" for ch in lowered):
        return lowered
    try:
        padded = text.replace("-", "+").replace("_", "/")
        padded += "=" * ((4 - len(padded) % 4) % 4)
        decoded = base64.b64decode(padded, validate=True)
        return decoded.hex() if len(decoded) == 16 else ""
    except Exception:
        return ""


def _land_state_hash_matches(candidate: str, expected: str) -> bool:
    left = _land_state_destination_hash(candidate)
    right = _land_state_destination_hash(expected)
    return bool(left and right and left == right)


def _process_land_state_fast_path(
    pending_key: Tuple[str, int, str, str, int, str]
) -> None:
    with _land_state_forwarding_lock:
        item = _land_state_forward_pending.pop(pending_key, None)
    if item is None:
        return
    message = item["message"]
    peer_hash = item["peerHash"]
    link_id = item["linkId"]
    parsed = _land_state_verification_fields(message)
    if parsed is None:
        _emit_call_bridge_message(message, peer_hash, link_id)
        return
    session_key, sequence, signed_bytes = parsed
    now = time.time()
    with _land_state_forwarding_lock:
        session = _land_state_auth_sessions.get(session_key)
    if session is None or float(session.get("expiresAt") or 0.0) <= now:
        _emit_call_bridge_message(message, peer_hash, link_id)
        return
    try:
        signature = qortal_base58_decode(str(message.get("z") or ""))
        if len(signature) != 64:
            raise ValueError("bad signature length")
        public_key = bytes(session.get("publicKey") or b"")
        RNS.Cryptography.Ed25519PublicKey.from_public_bytes(public_key).verify(
            signature,
            signed_bytes,
        )
    except Exception:
        # This session key was already authenticated by Electron. A signature
        # failure is terminal and must not enter Electron's coalescing queue,
        # where an invalid high sequence could displace a valid pending state.
        return

    with _land_state_forwarding_lock:
        current = _land_state_auth_sessions.get(session_key)
        if (
            current is None
            or current.get("publicKey") != session.get("publicKey")
            or float(current.get("expiresAt") or 0.0) <= time.time()
        ):
            _emit_call_bridge_message(message, peer_hash, link_id)
            return
        previous_sequence = current.get("lastSequence")
        last_sequence = previous_sequence if isinstance(previous_sequence, int) else -1
        if sequence <= last_sequence:
            return
        current["lastSequence"] = sequence
        forwarding_revision = _land_state_forwarding_revision
        targets = dict(_land_state_forwarding_plans.get(session_key[0]) or {})

    manager = _qortalland_game_manager
    if manager is not None:
        _enqueue_game_control(manager.proximity.on_land_state, (dict(message), peer_hash))

    if not targets:
        _emit_call_bridge_message(message, peer_hash, link_id)
        return

    try:
        hops = max(0, min(_LAND_STATE_MAX_HOPS, int(message.get("h") or 0)))
    except Exception:
        hops = 0
    if hops >= _LAND_STATE_MAX_HOPS:
        _emit_call_bridge_message(message, peer_hash, link_id)
        return
    raw_origin = message.get("o")
    origin_candidate = (
        raw_origin.strip()
        if isinstance(raw_origin, str) and raw_origin.strip()
        else ""
    )
    source_candidate = str(peer_hash or "").strip()
    # Match Electron's route parsing: preserve a valid compact origin exactly,
    # but never propagate arbitrary origin text through the native fast path.
    origin = (
        origin_candidate
        if _land_state_destination_hash(origin_candidate)
        else source_candidate
    )
    if not _land_state_destination_hash(origin):
        _emit_call_bridge_message(message, peer_hash, link_id)
        return
    forwarded = dict(message)
    # The compact Reticulum destination hash is normally 22 characters. It is
    # routing identity, not display text, so truncating it changes the origin.
    forwarded["o"] = origin
    forwarded["h"] = hops + 1
    encoded = _encode_group_signal_wire(forwarded)
    if not encoded.get("ok"):
        _emit_call_bridge_message(message, peer_hash, link_id)
        return

    attempted = 0
    delivered = 0
    for target_hash, expires_at in targets.items():
        if expires_at <= time.time():
            continue
        if _land_state_hash_matches(target_hash, peer_hash) or _land_state_hash_matches(target_hash, origin):
            continue
        attempted += 1
        if _send_wire_to_established_overlay_peer(
            target_hash,
            encoded["wire_bytes"],
            "land_state_forward_fast_path",
        ):
            delivered += 1

    with _land_state_forwarding_lock:
        revision_is_current = (
            forwarding_revision == _land_state_forwarding_revision
        )
    fast_forwarded = (
        attempted > 0
        and delivered == attempted
        and revision_is_current
    )
    _emit_call_bridge_message(
        message,
        peer_hash,
        link_id,
        land_state_fast_forwarded=fast_forwarded,
        land_state_forwarding_revision=(
            forwarding_revision if fast_forwarded else None
        ),
    )


def _queue_land_state_fast_path(
    message: Dict[str, Any],
    peer_hash: str,
    link_id: str,
) -> bool:
    if message.get("t") != _RETICULUM_CHAT_WIRE_TYPE or message.get("k") != "land_state":
        return False
    if not peer_hash:
        return False
    parsed = _land_state_verification_fields(message)
    if parsed is None:
        return False
    session_key, _sequence, _signed_bytes = parsed
    now = time.time()
    manager = _qortalland_game_manager
    proximity_context = manager.proximity.context if manager is not None else None
    proximity_needs_state = bool(
        manager is not None
        and manager.proximity.enabled
        and proximity_context
        and str(proximity_context.get("groupId") or "") == str(session_key[0])
    )
    with _land_state_forwarding_lock:
        session = _land_state_auth_sessions.get(session_key)
        targets = _land_state_forwarding_plans.get(session_key[0])
        if (
            session is None
            or float(session.get("expiresAt") or 0.0) <= now
            or (
                not proximity_needs_state
                and (
                    not targets
                    or not any(float(expires_at or 0.0) > now for expires_at in targets.values())
                )
            )
        ):
            return False
        signature_key = hashlib.sha256(
            str(message.get("z") or "").encode("utf-8")
        ).hexdigest()[:16]
        pending_key = (
            peer_hash,
            session_key[0],
            session_key[1],
            session_key[2],
            _sequence,
            signature_key,
        )
        if pending_key in _land_state_forward_pending:
            return True
        if len(_land_state_forward_pending) >= _LAND_STATE_FORWARDING_MAX_PENDING:
            return False
        _land_state_forward_pending[pending_key] = {
            "message": message,
            "peerHash": peer_hash,
            "linkId": link_id,
        }
    try:
        shard = int(hashlib.sha256(f"{session_key[1]}:{session_key[2]}".encode("utf-8")).hexdigest()[:8], 16) % _SCHEDULER_LAND_STATE_SHARDS
    except Exception:
        shard = 0
    queued = _enqueue_scheduler_task(
        f"land-state-forward-{shard}",
        f"land-state:{session_key[0]}:{session_key[1][:12]}",
        _process_land_state_fast_path,
        pending_key,
    )
    if queued:
        return True
    with _land_state_forwarding_lock:
        _land_state_forward_pending.pop(pending_key, None)
    return False


def _handle_overlay_link_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    link_id = get_overlay_link_id(link) if link is not None else None
    if link_id is None:
        return
    if link is not None and not _link_manager_generation_current("overlay", link_id, link):
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    decoded_audio = _decode_group_audio_wire(message)
    if decoded_audio is not None:
        _room_id, sender_destination_hash, _raw_audio = decoded_audio
        audio_link_id = _promote_overlay_audio_sender_if_allowed(
            link,
            link_id,
            sender_destination_hash,
        )
        if audio_link_id:
            on_audio_link_packet(message, packet)
        return
    compact_proximity = _decode_qortalland_proximity_discovery(message)
    if compact_proximity is not None:
        _note_presence_pressure("source:overlay")
        state["last_activity_at"] = time.time()
        state["last_rx_at"] = time.time()
        _ensure_managed_link_fields(state, kind="overlay")
        state["manager_state"] = _LINK_STATE_ESTABLISHED
        state["last_failure_reason"] = ""
        state["backoff_until"] = 0.0
        source_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        _forward_qortalland_proximity(compact_proximity, source_peer_hash)
        _ensure_qortalland_game_manager().proximity.on_discovery(
            compact_proximity,
            source_peer_hash,
        )
        return
    if isinstance(message, (bytes, bytearray)) and message.startswith(_QORTAL_LAND_PROXIMITY_DISCOVERY_PREFIX):
        return
    try:
        decoded = json.loads(message.decode("utf-8"))
    except Exception as exc:
        log(f"[presence_bridge] invalid overlay link payload: {exc}")
        return
    if not isinstance(decoded, dict):
        return
    if decoded.get("t") in _AUDIO_LINK_WIRE_TYPES:
        sender_destination_hash = str(decoded.get("r") or "").strip().lower()
        audio_link_id = _promote_overlay_audio_sender_if_allowed(
            link,
            link_id,
            sender_destination_hash,
        )
        if audio_link_id:
            on_audio_link_packet(message, packet)
        return
    if decoded.get("type") == _RESOURCE_SESSION_HELLO_TYPE:
        peer_hash = str(decoded.get("r") or "").strip().lower()
        lane = str(decoded.get("lane") or "").strip().lower()
        _register_incoming_resource_session(link, peer_hash, lane)
        return
    if _is_qchat_file_auth_packet(decoded):
        transfer_id = str(decoded.get("transferId") or decoded.get("x") or "").strip()
        if decoded.get("type") == "QCHAT_FILE_LINK_AUTH":
            peer_hash = _qchat_file_overlay_promotion_peer_hash(decoded)
            file_link_id = _promote_misclassified_overlay_link_to_qchat_file(
                link,
                link_id,
                transfer_id,
                peer_hash,
            )
        else:
            file_link_id = _promote_overlay_link_to_qchat_file(
                link,
                link_id,
                transfer_id,
            )
        if file_link_id:
            on_qchat_file_link_packet(message, packet)
        return
    _note_presence_pressure("source:overlay")
    state["last_activity_at"] = time.time()
    state["last_rx_at"] = time.time()
    _ensure_managed_link_fields(state, kind="overlay")
    state["manager_state"] = _LINK_STATE_ESTABLISHED
    state["last_failure_reason"] = ""
    state["backoff_until"] = 0.0
    t = decoded.get("t")
    if _handle_overlay_transport_control(decoded, link, link_id, state):
        return
    if t == "QLPV1":
        source_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        _forward_qortalland_proximity(decoded, source_peer_hash)
        _ensure_qortalland_game_manager().proximity.on_discovery(
            decoded,
            source_peer_hash,
        )
        return
    if isinstance(t, str) and t.startswith("PRESENCE_"):
        if _emit_presence_message(decoded, link_id):
            peer_hash = str(decoded.get("r") or "").strip().lower()
            if peer_hash:
                previous_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
                state["peerPresenceHash"] = peer_hash
                _note_overlay_peer_alive(peer_hash, "rx_presence")
                if state.get("incoming") is not True:
                    _note_good_outbound_overlay_rx(peer_hash)
                _register_active_overlay_for_peer(peer_hash, link_id)
                emit_reason = (
                    "rx_presence_identified"
                    if not previous_peer_hash and previous_peer_hash != peer_hash
                    else "rx_presence"
                )
                emit_overlay_link_state(link_id, state, emit_reason)
                _overlay_enqueue_dedup(peer_hash, reason="dedup_same_peer")
        return
    peer_presence_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if _queue_land_state_fast_path(decoded, peer_presence_hash, link_id):
        return
    _emit_call_bridge_message(
        decoded,
        peer_presence_hash,
        link_id,
    )


def on_overlay_link_packet(message, packet) -> None:
    started_at = time.monotonic()
    try:
        _handle_overlay_link_packet(message, packet)
    finally:
        _note_callback_duration("overlay", started_at, message)

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
    resource_type = str(event_payload.get("resourceType") or "").strip()
    if resource_type == _RETICULUM_CHAT_RESOURCE_TYPE:
        emit_event("reticulum_chat_resource", event_payload)
    elif _qchat_file_is_managed_resource_type(resource_type):
        emit_event("reticulum_resource", event_payload)
    else:
        emit_event("qchat_file_transfer", event_payload)


def _qchat_file_state_event_payload(state: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "transferId": state.get("transferId") or "",
        "peerPresenceHash": state.get("peerPresenceHash") or "",
        "fileName": state.get("fileName") or "",
        "size": int(state.get("size") or 0),
        "resourceType": state.get("resourceType") or "",
    }
    if extra:
        payload.update(extra)
    return payload


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


def _should_log_qchat_file_chunk_progress(
    state: Dict[str, Any],
    key: str,
    progress: float,
) -> bool:
    progress = max(0.0, min(1.0, float(progress)))
    now = time.monotonic()
    diag = state.setdefault("chunk_progress_diag", {})
    if not isinstance(diag, dict):
        diag = {}
        state["chunk_progress_diag"] = diag
    previous = diag.get(key)
    if not isinstance(previous, dict):
        diag[key] = {"at": now, "progress": progress}
        return True
    last_at = float(previous.get("at") or 0)
    last_progress = float(previous.get("progress") or -1)
    if (
        now - last_at >= _QCHAT_FILE_CHUNK_DIAG_MIN_INTERVAL_SECONDS
        or abs(progress - last_progress) >= _QCHAT_FILE_CHUNK_DIAG_MIN_DELTA
        or progress >= 1.0
    ):
        previous["at"] = now
        previous["progress"] = progress
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


def _request_qchat_file_path(
    destination_hash: bytes,
    peer_hash: str,
    *,
    allow_failed_path_refresh: bool = True,
) -> bool:
    if _reticulum_has_path(destination_hash):
        if (
            allow_failed_path_refresh
            and _peer_has_recent_unestablished_link_failure(peer_hash)
        ):
            return _request_fresh_link_path(
                destination_hash,
                peer_hash,
                target="qchat-file-reticulum",
                reason="qchat_file_link_open_after_unestablished_failure",
                await_seconds=_QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS,
                force_refresh=True,
            )
        _nudge_cached_reticulum_path(
            destination_hash,
            peer_hash,
            target="qchat-file-reticulum",
            reason="qchat_file_link_open_cached_path",
            cooldown_seconds=_UNPROVEN_CACHED_PATH_NUDGE_COOLDOWN_SECONDS,
        )
        return True
    return _request_fresh_link_path(
        destination_hash,
        peer_hash,
        target="qchat-file-reticulum",
        reason="qchat_file_link_open",
        await_seconds=_QCHAT_FILE_LINK_OPEN_PATH_AWAIT_SECONDS,
        force_refresh=False,
    )


def get_qchat_file_link_id(link) -> Optional[str]:
    if link is None:
        return None
    with _state_lock:
        return _qchat_file_link_ids_by_object.get(id(link))


def get_qchat_file_link_state(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        return _qchat_file_links_by_id.get(link_id)


def remove_qchat_file_link(link_id: str) -> Optional[Dict[str, Any]]:
    wake_peer_hash = ""
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
                if state.get("incoming") is not True:
                    wake_peer_hash = peer_hash.strip().lower()
    if state is None:
        return None
    if wake_peer_hash:
        _schedule_qchat_file_peer_open_drain(wake_peer_hash)
    return state


class _QChatFilePathPending(RuntimeError):
    pass


def _qchat_file_state_is_inactive(state: Dict[str, Any]) -> bool:
    if state.get("cancelled") is True or state.get("completed") is True:
        return True
    receive_root = state.get("receive_root")
    return isinstance(receive_root, dict) and receive_root.get("cancelled") is True


def _qchat_file_state_is_chat_priority(state: Dict[str, Any]) -> bool:
    return str(state.get("resourceType") or "").strip() == _RETICULUM_CHAT_RESOURCE_TYPE


def _qchat_file_active_outgoing_counts(peer_hash: str) -> Tuple[int, int]:
    peer_key = str(peer_hash or "").strip().lower()
    total = 0
    bulk = 0
    for link_state in _qchat_file_links_by_id.values():
        if (
            link_state.get("manager_kind") == "resource_session"
            or
            link_state.get("incoming") is True
            or _qchat_file_state_is_inactive(link_state)
            or str(link_state.get("peerPresenceHash") or "").strip().lower()
            != peer_key
        ):
            continue
        total += 1
        if not _qchat_file_state_is_chat_priority(link_state):
            bulk += 1
    return total, bulk


def _qchat_file_transfer_has_viable_outgoing_state(
    peer_hash: str,
    transfer_id: str,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    transfer_key = str(transfer_id or "").strip()
    if not peer_key or not transfer_key:
        return False

    def matches(candidate: Any) -> bool:
        return (
            isinstance(candidate, dict)
            and candidate.get("incoming") is not True
            and not _qchat_file_state_is_inactive(candidate)
            and str(candidate.get("peerPresenceHash") or "").strip().lower()
            == peer_key
            and str(candidate.get("transferId") or "").strip() == transfer_key
        )

    with _state_lock:
        if any(matches(candidate) for candidate in _qchat_file_links_by_id.values()):
            return True
        if matches(_qchat_file_opening_state_by_peer.get(peer_key)):
            return True
        return any(
            matches(candidate)
            for candidate in _qchat_file_open_queue_by_peer.get(peer_key, ())
        )


def _qchat_file_transfer_has_active_outgoing_state(
    peer_hash: str,
    transfer_id: str,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    transfer_key = str(transfer_id or "").strip()
    if not peer_key or not transfer_key:
        return False

    def matches(candidate: Any) -> bool:
        return (
            isinstance(candidate, dict)
            and candidate.get("incoming") is not True
            and not _qchat_file_state_is_inactive(candidate)
            and str(candidate.get("peerPresenceHash") or "").strip().lower()
            == peer_key
            and str(candidate.get("transferId") or "").strip() == transfer_key
        )

    with _state_lock:
        if any(matches(candidate) for candidate in _qchat_file_links_by_id.values()):
            return True
        return matches(_qchat_file_opening_state_by_peer.get(peer_key))


def _qchat_file_fail_open_state(
    state: Dict[str, Any],
    reason: str,
    *,
    error: str = "",
    force_transfer_failure: bool = False,
) -> bool:
    state["completed"] = True
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    transfer_id = str(state.get("transferId") or "").strip()
    if (
        not force_transfer_failure
        and _qchat_file_transfer_has_viable_outgoing_state(peer_hash, transfer_id)
    ):
        log(
            "[presence_bridge] qchat resource link exhausted but transfer has sibling "
            f"transfer={transfer_id} peer={peer_hash[:16]} reason={reason}"
        )
        _schedule_qchat_file_peer_open_drain(peer_hash)
        return False

    with _state_lock:
        pending = _qchat_file_accepts_by_transfer.get(transfer_id)
        root = state.get("receive_root")
        if not isinstance(root, dict):
            root = pending
        if isinstance(root, dict):
            if root.get("terminal_failure_emitted") is True:
                return True
            root["terminal_failure_emitted"] = True
            root["cancelled"] = True
        _qchat_file_remove_pending_receive(peer_hash, transfer_id)

    _qchat_file_abort_receive_transfer(peer_hash, transfer_id)
    payload = {
        "transferId": transfer_id,
        "peerPresenceHash": peer_hash,
        "fileName": state.get("fileName") or "",
        "resourceType": state.get("resourceType") or "qchat-dm-file",
        "reason": reason,
    }
    if error:
        payload["error"] = error
    _qchat_file_emit("failed", payload)
    _schedule_qchat_file_peer_open_drain(peer_hash)
    return True


def _release_qchat_file_open_slot(state: Dict[str, Any]) -> None:
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if not peer_hash:
        return
    with _state_lock:
        if _qchat_file_opening_state_by_peer.get(peer_hash) is state:
            _qchat_file_opening_state_by_peer.pop(peer_hash, None)


def _schedule_qchat_file_peer_open_drain(
    peer_hash: str,
    *,
    delay_seconds: float = 0.0,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        if not _qchat_file_open_queue_by_peer.get(peer_key):
            return True
        if peer_key in _qchat_file_open_drain_pending_peers:
            return True
        _qchat_file_open_drain_pending_peers.add(peer_key)

    def enqueue() -> None:
        if _shutdown.is_set():
            with _state_lock:
                _qchat_file_open_drain_pending_peers.discard(peer_key)
            return
        queued = _enqueue_scheduler_task(
            _resource_open_scheduler_lane(peer_key),
            f"qchat-file-open:{peer_key[:12]}",
            _run_qchat_file_peer_open_queue,
            peer_key,
        )
        if queued:
            return
        with _state_lock:
            _qchat_file_open_drain_pending_peers.discard(peer_key)
            has_waiting = bool(_qchat_file_open_queue_by_peer.get(peer_key))
        if has_waiting:
            retry_timer = threading.Timer(
                _QCHAT_FILE_LINK_PATH_POLL_SECONDS,
                _schedule_qchat_file_peer_open_drain,
                args=(peer_key,),
            )
            retry_timer.daemon = True
            retry_timer.start()

    if delay_seconds > 0:
        timer = threading.Timer(delay_seconds, enqueue)
        timer.daemon = True
        timer.start()
    else:
        enqueue()
    return True


def _queue_qchat_file_open_state(
    state: Dict[str, Any],
    *,
    delay_seconds: float = 0.0,
) -> bool:
    if _qchat_file_state_is_inactive(state):
        return False
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if not peer_hash:
        return False
    state_id = id(state)
    if delay_seconds > 0:
        state["open_not_before"] = max(
            float(state.get("open_not_before") or 0),
            time.monotonic() + delay_seconds,
        )
    with _state_lock:
        if state_id not in _qchat_file_open_queue_state_ids:
            peer_queue = _qchat_file_open_queue_by_peer.setdefault(peer_hash, deque())
            if (
                len(peer_queue) >= _QCHAT_FILE_OPEN_QUEUE_MAX_PER_PEER
                or len(_qchat_file_open_queue_state_ids) >= _QCHAT_FILE_OPEN_QUEUE_MAX_TOTAL
            ):
                return False
            if state.get("blocks_peer_open_queue") is True:
                peer_queue.appendleft(state)
            elif _qchat_file_state_is_chat_priority(state):
                insert_at = 0
                while insert_at < len(peer_queue):
                    queued_state = peer_queue[insert_at]
                    if queued_state.get("blocks_peer_open_queue") is True:
                        insert_at += 1
                        continue
                    if not _qchat_file_state_is_chat_priority(queued_state):
                        break
                    insert_at += 1
                peer_queue.insert(insert_at, state)
            else:
                peer_queue.append(state)
            _qchat_file_open_queue_state_ids.add(state_id)
    return _schedule_qchat_file_peer_open_drain(peer_hash)


def _run_qchat_file_peer_open_queue(peer_hash: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    state: Optional[Dict[str, Any]] = None
    next_ready_in = 0.0
    with _state_lock:
        _qchat_file_open_drain_pending_peers.discard(peer_key)
        opening = _qchat_file_opening_state_by_peer.get(peer_key)
        if opening is not None and not _qchat_file_state_is_inactive(opening):
            return
        _qchat_file_opening_state_by_peer.pop(peer_key, None)
        active_total, active_bulk = _qchat_file_active_outgoing_counts(peer_key)
        if active_total >= _QCHAT_FILE_ACTIVE_OUTGOING_MAX_PER_PEER:
            return
        peer_queue = _qchat_file_open_queue_by_peer.get(peer_key)
        queue_items = len(peer_queue) if peer_queue else 0
        now = time.monotonic()
        for _ in range(queue_items):
            candidate = peer_queue.popleft()
            if _qchat_file_state_is_inactive(candidate):
                _qchat_file_open_queue_state_ids.discard(id(candidate))
                continue
            not_before = float(candidate.get("open_not_before") or 0)
            if not_before > now:
                if candidate.get("blocks_peer_open_queue") is True:
                    peer_queue.appendleft(candidate)
                else:
                    peer_queue.append(candidate)
                wait_seconds = not_before - now
                next_ready_in = (
                    wait_seconds
                    if next_ready_in <= 0
                    else min(next_ready_in, wait_seconds)
                )
                if candidate.get("blocks_peer_open_queue") is True:
                    break
                continue
            candidate.pop("open_not_before", None)
            if (
                not _qchat_file_state_is_chat_priority(candidate)
                and active_bulk >= _QCHAT_FILE_BULK_ACTIVE_MAX_PER_PEER
            ):
                peer_queue.append(candidate)
                continue
            _qchat_file_open_queue_state_ids.discard(id(candidate))
            state = candidate
            break
        if not peer_queue:
            _qchat_file_open_queue_by_peer.pop(peer_key, None)
        if state is not None:
            _qchat_file_opening_state_by_peer[peer_key] = state
    if state is not None:
        _run_qchat_file_open_task(state)
    elif next_ready_in > 0:
        _schedule_qchat_file_peer_open_drain(
            peer_key,
            delay_seconds=next_ready_in,
        )


def on_qchat_file_link_closed(link) -> None:
    link_id = get_qchat_file_link_id(link)
    if link_id is None:
        return
    existing_state = get_qchat_file_link_state(link_id)
    if (
        isinstance(existing_state, dict)
        and existing_state.get("manager_kind") == "resource_session"
    ):
        with _state_lock:
            _qchat_file_link_ids_by_object.pop(id(link), None)
            _incoming_unified_peer_hash_by_object.pop(id(link), None)
        existing_state["link"] = None
        if existing_state.get("incoming") is True:
            waiter_prefix = f"{link_id}:"
            with _state_lock:
                waiters = [
                    waiter
                    for key, waiter in _resource_session_provider_waiters.items()
                    if key.startswith(waiter_prefix)
                ]
            for waiter in waiters:
                waiter["authorized"] = False
                waiter["reason"] = "resource_session_link_closed"
                waiter["event"].set()
        _resource_session_fail_state(
            existing_state,
            "resource_session_link_closed",
            refresh_path=existing_state.get("incoming") is not True,
        )
        return
    state = remove_qchat_file_link(link_id)
    if state is not None:
        _release_qchat_file_open_slot(state)
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        _schedule_qchat_file_peer_open_drain(peer_hash)
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
        reason = _overlay_teardown_reason_name(getattr(link, "teardown_reason", None))
        _maybe_request_path_after_unestablished_link_close(
            state,
            link,
            target="qchat-file-reticulum",
            reason=reason,
        )
        transfer_id = str(state.get("transferId") or "")
        resource_type = str(state.get("resourceType") or "qchat-dm-file").strip() or "qchat-dm-file"
        outgoing_unestablished = (
            state.get("incoming") is not True
            and state.get("established") is not True
        )
        open_attempts = int(state.get("open_attempts") or 0)
        if outgoing_unestablished and open_attempts < _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS:
            if _schedule_qchat_file_open_retry(state, reason):
                return
        with _state_lock:
            receive_pending = _qchat_file_get_pending_receive(peer_hash, transfer_id)
            send_pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
        if receive_pending is not None and str(receive_pending.get("transferId") or "") == transfer_id:
            if outgoing_unestablished:
                retry_queue_full = open_attempts < _QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS
                _qchat_file_fail_open_state(
                    state,
                    (
                        "file_link_retry_queue_full"
                        if retry_queue_full
                        else "file_link_open_attempts_exhausted"
                    ),
                    error=reason,
                )
            return
        if state.get("authMessage") is not None:
            state["completed"] = True
            return
        if send_pending is not None:
            return
        if transfer_id:
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": state.get("fileName") or "",
                    "resourceType": resource_type,
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
    allow_failed_path_refresh = state.get("failed_path_refresh_requested") is not True
    if (
        allow_failed_path_refresh
        and _peer_has_recent_unestablished_link_failure(peer_hash)
    ):
        # A path request is asynchronous. Refresh a failed cached path only once
        # for this queued open so polling cannot repeatedly discard the new path.
        state["failed_path_refresh_requested"] = True
    path_ready = _request_qchat_file_path(
        outbound.hash,
        peer_hash,
        allow_failed_path_refresh=allow_failed_path_refresh,
    )
    if not path_ready:
        now = time.monotonic()
        path_wait_started_at = float(state.get("path_wait_started_at") or 0)
        if path_wait_started_at <= 0:
            path_wait_started_at = now
            state["path_wait_started_at"] = path_wait_started_at
        if now - path_wait_started_at >= _QCHAT_FILE_LINK_PATH_WAIT_TIMEOUT_SECONDS:
            raise TimeoutError("Timed out waiting for Reticulum resource path")
        raise _QChatFilePathPending("Waiting for Reticulum resource path")
    state.pop("path_wait_started_at", None)
    state.pop("blocks_peer_open_queue", None)
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
    previous_link = state.get("link")
    if previous_link is not None:
        previous_link_id = get_qchat_file_link_id(previous_link)
        if previous_link_id:
            remove_qchat_file_link(previous_link_id)
        else:
            with _state_lock:
                _qchat_file_link_ids_by_object.pop(id(previous_link), None)
                _incoming_unified_peer_hash_by_object.pop(id(previous_link), None)
        _teardown_reticulum_link_bounded(
            previous_link,
            f"target=qchat-file-reticulum replace_previous_link transfer={state.get('transferId') or ''}",
        )
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
    with _state_lock:
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

    if not _queue_qchat_file_open_state(
        state,
        delay_seconds=_QCHAT_FILE_LINK_RETRY_DELAY_SECONDS,
    ):
        return False
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


def _open_qchat_file_link_async(state: Dict[str, Any]) -> bool:
    return _queue_qchat_file_open_state(state)


def _run_qchat_file_open_task(state: Dict[str, Any]) -> None:
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if _qchat_file_state_is_inactive(state):
        _release_qchat_file_open_slot(state)
        _schedule_qchat_file_peer_open_drain(peer_hash)
        return
    try:
        _open_qchat_file_link_for_state(state)
    except _QChatFilePathPending:
        _release_qchat_file_open_slot(state)
        state["blocks_peer_open_queue"] = True
        if not _queue_qchat_file_open_state(
            state,
            delay_seconds=_QCHAT_FILE_LINK_PATH_POLL_SECONDS,
        ):
            _qchat_file_fail_open_state(
                state,
                "file_link_open_queue_full",
            )
    except TimeoutError as exc:
        _release_qchat_file_open_slot(state)
        has_active_sibling = _qchat_file_transfer_has_active_outgoing_state(
            peer_hash,
            str(state.get("transferId") or ""),
        )
        _qchat_file_fail_open_state(
            state,
            "path_wait_timeout",
            error=str(exc),
            force_transfer_failure=not has_active_sibling,
        )
    except Exception as exc:
        _release_qchat_file_open_slot(state)
        if _schedule_qchat_file_open_retry(state, str(exc)):
            return
        _qchat_file_fail_open_state(
            state,
            "link_open_failed",
            error=str(exc),
        )


def configure_qchat_file_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_qchat_file_link_closed)
    link.set_packet_callback(on_qchat_file_link_packet)
    link.set_resource_strategy(RNS.Link.ACCEPT_APP)
    link.set_resource_callback(on_qchat_file_resource_advertised)
    link.set_resource_started_callback(on_qchat_file_resource_started)
    link.set_resource_concluded_callback(on_qchat_file_resource_concluded)
    _qchat_file_link_ids_by_object[id(link)] = link_id


def _resource_session_cancel_provider_transfer(
    state: Dict[str, Any],
    transfer_id: str,
) -> None:
    transfer_key = str(transfer_id or "").strip()
    if not transfer_key or state.get("incoming") is not True:
        return
    link_id = str(state.get("linkId") or "")
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    waiter_key = _resource_session_waiter_key(link_id, transfer_key)
    handled = False
    with _state_lock:
        now = time.time()
        cancel_key = _resource_session_provider_cancel_key(peer_hash, transfer_key)
        _resource_session_provider_recent_cancellations[cancel_key] = (
            now + _RESOURCE_SESSION_PROVIDER_CANCEL_TTL_SECONDS
        )
        if (
            len(_resource_session_provider_recent_cancellations)
            > _RESOURCE_SESSION_PROVIDER_CANCEL_MAX
        ):
            expired_keys = [
                key
                for key, expires_at in _resource_session_provider_recent_cancellations.items()
                if float(expires_at or 0) <= now
            ]
            for key in expired_keys:
                _resource_session_provider_recent_cancellations.pop(key, None)
            while (
                len(_resource_session_provider_recent_cancellations)
                > _RESOURCE_SESSION_PROVIDER_CANCEL_MAX
            ):
                oldest_key = min(
                    _resource_session_provider_recent_cancellations,
                    key=_resource_session_provider_recent_cancellations.get,
                )
                _resource_session_provider_recent_cancellations.pop(
                    oldest_key,
                    None,
                )
        waiter = _resource_session_provider_waiters.get(waiter_key)
        pending = _qchat_file_pending_sends_by_transfer.get(transfer_key)
        if isinstance(pending, dict):
            allowed_recipient = str(
                pending.get("allowedRecipientAddress") or ""
            ).strip().lower()
            if not allowed_recipient or allowed_recipient == peer_hash:
                pending["cancelled"] = True
                handled = True
        if isinstance(waiter, dict):
            waiter["authorized"] = False
            waiter["reason"] = "resource_requester_cancelled"
            waiter["event"].set()
            handled = True
        _resource_session_provider_capacity_condition.notify_all()
    if handled:
        log(
            "[presence_bridge] resource_session_provider_cancelled "
            f"transfer={transfer_key} peer={peer_hash[:16]}"
        )


def _handle_qchat_file_link_packet(message, packet) -> None:
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
    _note_presence_pressure("source:qchat_file")
    if decoded.get("type") == _RESOURCE_SESSION_CANCEL_TYPE:
        if state.get("manager_kind") != "resource_session":
            return
        _resource_session_cancel_provider_transfer(
            state,
            str(decoded.get("transferId") or ""),
        )
        return
    if decoded.get("type") == _RESOURCE_SESSION_READY_TYPE:
        if (
            state.get("manager_kind") != "resource_session"
            or state.get("incoming") is True
        ):
            return
        peer_hash = str(decoded.get("r") or "").strip().lower()
        expected_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        lane = str(decoded.get("lane") or "").strip().lower()
        if (
            not _valid_presence_destination_hash_hex(peer_hash)
            or peer_hash != expected_peer_hash
            or lane not in {"fast", "bulk"}
            or lane != state.get("sessionLane")
        ):
            _resource_session_fail_state(
                state,
                "resource_session_ready_mismatch",
                refresh_path=False,
            )
            return
        with _state_lock:
            if state.get("closing") is True or state.get("remote_ready") is True:
                return
            try:
                provider_idle_ms = float(decoded.get("providerIdleMs") or 0)
            except Exception:
                provider_idle_ms = 0.0
            if math.isfinite(provider_idle_ms) and provider_idle_ms >= 1000:
                state["remote_provider_idle_seconds"] = provider_idle_ms / 1000.0
            else:
                state["remote_provider_idle_seconds"] = (
                    _RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS
                )
            state["remote_ready"] = True
            state["last_used_at"] = time.time()
            state["activity_generation"] = int(
                state.get("activity_generation") or 0
            ) + 1
        _resource_session_cancel_timer(state, "establish_timer")
        _resource_session_emit_status(state, "ready")
        _resource_session_dispatch_peer_pending(
            expected_peer_hash,
            str(state.get("sessionLane") or "fast"),
        )
        _resource_session_schedule_idle_close(state)
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
            log(
                "[presence_bridge] qchat file chunk ack ignored "
                f"transfer={transfer_id} chunk={chunk_index} reason=not_active"
            )
            return
        chunk_size = int(chunk.get("size") or decoded.get("chunkSize") or 0)
        log(
            "[presence_bridge] qchat file chunk ack received "
            f"transfer={transfer_id} chunk={chunk_index} chunk_size={chunk_size}"
        )
        transfer_complete = _qchat_file_mark_chunk_sent(root, chunk_index, chunk_size)
        if transfer_complete:
            _qchat_file_close_success_link_after_grace(link, state)
            return
        state["resource_started"] = False
        _enqueue_scheduler_task(
            "resource-control",
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
            if state.get("streamMode") is True:
                _qchat_file_start_channel_stream_receiver(state)
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
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum sender_rejected_auth transfer={state.get('transferId') or ''}",
            )
        return
    if not _is_qchat_file_auth_packet(decoded):
        return
    transfer_id = str(decoded.get("transferId") or decoded.get("x") or "").strip()
    state["transferId"] = transfer_id
    if "retryChunkIndex" in decoded:
        try:
            state["requestedChunkIndex"] = int(decoded.get("retryChunkIndex"))
        except Exception:
            state.pop("requestedChunkIndex", None)
    resource_type = _qchat_file_auth_resource_type(decoded)
    state["resourceType"] = resource_type
    state_metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
    _qchat_file_emit(
        "auth",
        {
            "linkId": link_id,
            "transferId": transfer_id,
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "auth": decoded,
            "resourceType": resource_type,
            "eventId": decoded.get("eventId") or decoded.get("id") or state_metadata.get("eventId"),
            "groupId": decoded.get("groupId") or decoded.get("g") or state_metadata.get("groupId"),
            "metadata": state_metadata,
        },
    )


def on_qchat_file_link_packet(message, packet) -> None:
    started_at = time.monotonic()
    try:
        _handle_qchat_file_link_packet(message, packet)
    finally:
        _note_callback_duration("qchat_file", started_at, message)


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
            claimed_peer_hash = str(
                state.get("claimedPeerPresenceHash") or ""
            ).strip().lower()
            if (
                state.get("manager_kind") == "resource_session"
                and state.get("incoming") is True
                and claimed_peer_hash
                and claimed_peer_hash != peer_hash
            ):
                _resource_session_fail_state(
                    state,
                    "resource_session_identity_mismatch",
                )
                return
            with _state_lock:
                state["remoteIdentity"] = identity
                state["peerPresenceHash"] = peer_hash
                state["peerDestinationHash"] = peer_hash
            if (
                state.get("manager_kind") == "resource_session"
                and state.get("incoming") is True
            ):
                _resource_session_maybe_send_provider_ready(state)


def _register_incoming_qchat_file_link(link, peer_hash: str, transfer_id: str) -> str:
    link_id = get_qchat_file_link_id(link)
    if link_id:
        return link_id
    now = time.time()
    link_id = str(uuid.uuid4())
    state = {
        "linkId": link_id,
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


def _resource_session_maybe_send_provider_ready(state: Dict[str, Any]) -> bool:
    if (
        state.get("manager_kind") != "resource_session"
        or state.get("incoming") is not True
        or state.get("hello_received") is not True
        or state.get("closing") is True
    ):
        return False
    link = state.get("link")
    if link is None:
        return False
    remote_identity = state.get("remoteIdentity")
    if remote_identity is None:
        getter = getattr(link, "get_remote_identity", None)
        if callable(getter):
            try:
                remote_identity = getter()
            except Exception:
                remote_identity = None
    if remote_identity is None:
        return False
    try:
        identified_peer_hash = _destination_hash_for_identity(remote_identity)
    except Exception:
        _resource_session_fail_state(state, "resource_session_identity_invalid")
        return False
    claimed_peer_hash = str(
        state.get("claimedPeerPresenceHash") or ""
    ).strip().lower()
    if claimed_peer_hash and claimed_peer_hash != identified_peer_hash:
        _resource_session_fail_state(state, "resource_session_identity_mismatch")
        return False
    with _state_lock:
        if (
            state.get("closing") is True
            or state.get("provider_ready_sent") is True
            or state.get("provider_ready_sending") is True
        ):
            return state.get("provider_ready_sent") is True
        state["provider_ready_sending"] = True
        state["remoteIdentity"] = remote_identity
        state["peerPresenceHash"] = identified_peer_hash
        state["peerDestinationHash"] = identified_peer_hash
    ready = {
        "type": _RESOURCE_SESSION_READY_TYPE,
        "r": destination_hash_hex(_destination.hash) if _destination is not None else "",
        "lane": state.get("sessionLane") or "fast",
        "providerIdleMs": int(_RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS * 1000),
    }
    sent = _send_packet_on_link(
        link,
        json.dumps(ready, separators=(",", ":")).encode("utf-8"),
        f"target=qchat-file-reticulum resource_session_ready peer={identified_peer_hash[:16]}",
    )
    with _state_lock:
        state["provider_ready_sending"] = False
        if sent and state.get("closing") is not True:
            state["provider_ready_sent"] = True
            state["last_used_at"] = time.time()
            state["activity_generation"] = int(
                state.get("activity_generation") or 0
            ) + 1
    if not sent:
        _resource_session_fail_state(state, "resource_session_ready_send_failed")
        return False
    _resource_session_schedule_idle_close(state)
    return True


def _register_incoming_resource_session(
    link,
    claimed_peer_hash: str,
    lane: str,
) -> str:
    peer_hash = str(claimed_peer_hash or "").strip().lower()
    session_lane = str(lane or "").strip().lower()
    if (
        not _valid_presence_destination_hash_hex(peer_hash)
        or session_lane not in {"fast", "bulk"}
    ):
        log(
            "[presence_bridge] resource_session_invalid_hello "
            f"peer={peer_hash[:16] or 'unknown'} lane={session_lane or 'unknown'}"
        )
        _teardown_reticulum_link_bounded(
            link,
            "target=qchat-file-reticulum resource_session_invalid_hello",
        )
        return ""
    overlay_link_id = get_overlay_link_id(link)
    if overlay_link_id:
        overlay_state = get_overlay_link_state(overlay_link_id)
        overlay_peer_hash = str(
            (overlay_state or {}).get("peerPresenceHash") or ""
        ).strip().lower()
        removed_overlay = remove_overlay_link(overlay_link_id)
        if removed_overlay is not None:
            if overlay_peer_hash and removed_overlay.get("_was_active_overlay") is True:
                with _state_lock:
                    _active_overlay_neighbors.pop(overlay_peer_hash, None)
                    _inbound_overlay_neighbors.pop(overlay_peer_hash, None)
            log(
                "[presence_bridge] resource_session_removed_overlay_registration "
                f"overlay_link={overlay_link_id} peer={peer_hash[:16] or 'unknown'}"
            )
    link_id = _register_incoming_qchat_file_link(link, peer_hash, "")
    state = get_qchat_file_link_state(link_id)
    if state is None:
        return ""
    with _state_lock:
        state["linkId"] = link_id
        state["manager_kind"] = "resource_session"
        state["sessionLane"] = session_lane
        state["claimedPeerPresenceHash"] = peer_hash
        state["hello_received"] = True
        state["last_used_at"] = time.time()
        state["active_requests"] = {}
        state["pending_jobs"] = []
        state["provider_active"] = 0
        state["activity_generation"] = int(
            state.get("activity_generation") or 0
        ) + 1
    log(
        "[presence_bridge] resource_session_incoming "
        f"peer={peer_hash[:16] or 'unknown'} lane={state.get('sessionLane')} link={link_id}"
    )
    if not _resource_session_maybe_send_provider_ready(state):
        # Remote identity callbacks can arrive after the hello packet. Ensure
        # a peer which never identifies cannot leave a half-open session in
        # memory indefinitely now that sessions are bounded per peer rather
        # than by one process-wide connection ceiling.
        _resource_session_schedule_idle_close(state)
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
                "resourceType": state.get("resourceType") or "qchat-dm-file",
            },
        )
        return True
    return False


def _qchat_file_cancel_active_send_chunk(
    state: Dict[str, Any],
    chunk_index: int,
) -> None:
    active = state.get("active_chunks")
    if not isinstance(active, dict):
        return
    chunk = active.pop(chunk_index, None)
    if not isinstance(chunk, dict):
        return
    timer = chunk.pop("ack_timeout_timer", None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _qchat_file_requeue_send_chunk(
    state: Dict[str, Any],
    chunk_index: int,
) -> None:
    _qchat_file_cancel_active_send_chunk(state, chunk_index)
    completed = state.get("completed_chunks")
    if isinstance(completed, set) and chunk_index in completed:
        return
    retry_chunks = state.setdefault("retry_chunks", [])
    if isinstance(retry_chunks, list) and chunk_index not in retry_chunks:
        retry_chunks.insert(0, chunk_index)


def _qchat_file_chunked_receive_progress(pending: Dict[str, Any], size: int) -> float:
    received_bytes = int(pending.get("received_bytes") or 0)
    active = pending.get("active_chunks")
    if isinstance(active, dict):
        for chunk in active.values():
            if not isinstance(chunk, dict):
                continue
            try:
                received_bytes += int(chunk.get("size") or 0) * float(chunk.get("progress") or 0)
            except Exception:
                pass
    return min(1.0, max(0.0, received_bytes / float(size))) if size > 0 else 0.0


def _qchat_file_receiver_transfer_done(peer_hash: str, transfer_id: str) -> None:
    for link_id, link_state in list(_qchat_file_links_by_id.items()):
        if (
            str(link_state.get("peerPresenceHash") or "").strip().lower() == peer_hash
            and str(link_state.get("transferId") or "") == transfer_id
        ):
            link = link_state.get("link")
            link_state["completed"] = True
            remove_qchat_file_link(link_id)
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum receiver_transfer_done transfer={transfer_id}",
            )


def _qchat_file_resource_transfer_id(resource) -> str:
    transfer_id = str(getattr(resource, "_qchat_transfer_id", "") or "").strip()
    if transfer_id:
        return transfer_id
    metadata = getattr(resource, "metadata", None)
    if isinstance(metadata, dict):
        return str(metadata.get("transferId") or "").strip()
    return ""


def _qchat_file_store_pending_receive(peer_hash: str, pending: Dict[str, Any]) -> None:
    peer_key = peer_hash.strip().lower()
    transfer_id = str(pending.get("transferId") or "").strip()
    if peer_key:
        _qchat_file_accepts_by_peer[peer_key] = pending
    if transfer_id:
        _qchat_file_accepts_by_transfer[transfer_id] = pending


def _qchat_file_remove_pending_receive(peer_hash: str, transfer_id: str) -> None:
    peer_key = peer_hash.strip().lower()
    transfer_key = transfer_id.strip()
    if transfer_key:
        _qchat_file_accepts_by_transfer.pop(transfer_key, None)
    if peer_key:
        pending = _qchat_file_accepts_by_peer.get(peer_key)
        if pending is None or str(pending.get("transferId") or "") == transfer_key:
            _qchat_file_accepts_by_peer.pop(peer_key, None)


def _qchat_file_get_pending_receive(peer_hash: str, transfer_id: str = "") -> Optional[Dict[str, Any]]:
    transfer_key = transfer_id.strip()
    if transfer_key:
        # An explicit transfer ID must never fall through to a different
        # transfer owned by the same peer.
        return _qchat_file_accepts_by_transfer.get(transfer_key)
    peer_key = peer_hash.strip().lower()
    if peer_key:
        candidates = [
            pending
            for pending in _qchat_file_accepts_by_transfer.values()
            if str(pending.get("peerPresenceHash") or "").strip().lower() == peer_key
        ]
        # The peer-only lookup exists for old Reticulum resources that do not
        # expose transfer metadata. It is safe only when there is one possible
        # receive; parallel ranges must be matched by transfer ID.
        if len(candidates) == 1:
            return candidates[0]
    return None


def _qchat_file_is_resource_session_response(
    resource,
    state: Optional[Dict[str, Any]],
) -> bool:
    return (
        isinstance(state, dict)
        and state.get("manager_kind") == "resource_session"
        and getattr(resource, "request_id", None) is not None
    )


def _qchat_file_expire_pending_receive(peer_hash: str, transfer_id: str = "") -> Optional[Dict[str, Any]]:
    pending = _qchat_file_get_pending_receive(peer_hash, transfer_id)
    if pending is None:
        return None
    if float(pending.get("expires_at") or 0) >= time.time():
        return pending
    _qchat_file_remove_pending_receive(
        str(pending.get("peerPresenceHash") or peer_hash or "").strip().lower(),
        str(pending.get("transferId") or transfer_id or "").strip(),
    )
    return None


def _qchat_file_fail_pending_receive(
    state: Optional[Dict[str, Any]],
    peer_hash: str,
    transfer_id: str,
) -> None:
    if state is not None:
        state["completed"] = True
    with _state_lock:
        _qchat_file_remove_pending_receive(peer_hash, transfer_id)
    _qchat_file_abort_receive_transfer(peer_hash, transfer_id)


def _qchat_file_abort_receive_transfer(peer_hash: str, transfer_id: str) -> None:
    peer_key = peer_hash.strip().lower()
    transfer_key = transfer_id.strip()
    for link_id, link_state in list(_qchat_file_links_by_id.items()):
        if (
            str(link_state.get("peerPresenceHash") or "").strip().lower() == peer_key
            and str(link_state.get("transferId") or "") == transfer_key
            and link_state.get("authMessage") is not None
        ):
            _qchat_file_close_link_now(link_state)


def _resource_session_cancel_request_receipt(receipt: Any, transfer_id: str) -> None:
    if receipt is None:
        return
    try:
        request_resource = getattr(receipt, "resource", None)
        cancel_request_resource = getattr(request_resource, "cancel", None)
        if callable(cancel_request_resource):
            cancel_request_resource()
        link = getattr(receipt, "link", None)
        request_id = getattr(receipt, "request_id", None)
        if link is not None and request_id is not None:
            for response_resource in list(
                getattr(link, "incoming_resources", None) or []
            ):
                if getattr(response_resource, "request_id", None) != request_id:
                    continue
                cancel_response_resource = getattr(response_resource, "cancel", None)
                if callable(cancel_response_resource):
                    cancel_response_resource()
            pending_requests = getattr(link, "pending_requests", None)
            if isinstance(pending_requests, list) and receipt in pending_requests:
                pending_requests.remove(receipt)
        failed_status = getattr(type(receipt), "FAILED", None)
        if failed_status is not None:
            receipt.status = failed_status
        if hasattr(receipt, "concluded_at"):
            receipt.concluded_at = time.time()
    except Exception as exc:
        log(
            "[presence_bridge] resource_session_request_cancel_failed "
            f"transfer={transfer_id} err={exc}"
        )


def _qchat_file_cancel_transfer(transfer_id: str, peer_hash: str = "", reason: str = "cancelled") -> int:
    transfer_key = transfer_id.strip()
    peer_key = peer_hash.strip().lower()
    if not transfer_key:
        return 0
    closed = 0
    with _state_lock:
        session_job = _resource_session_jobs_by_transfer.pop(transfer_key, None)
        cancel_session_job = (
            isinstance(session_job, dict)
            and session_job.get("completed") is not True
        )
        if cancel_session_job:
            session_job["completed"] = True
            session_job["cancelled"] = True
    if cancel_session_job:
        semantic_key = str(session_job.get("semanticKey") or "")
        session = session_job.get("session") if isinstance(session_job.get("session"), dict) else None
        receipt = session_job.get("receipt")
        with _state_lock:
            if semantic_key and _resource_session_jobs_by_semantic_key.get(semantic_key) is session_job:
                _resource_session_jobs_by_semantic_key.pop(semantic_key, None)
            if session is not None:
                active = session.get("active_requests")
                if isinstance(active, dict):
                    active.pop(transfer_key, None)
                pending_jobs = session.get("pending_jobs")
                if isinstance(pending_jobs, list):
                    session["pending_jobs"] = [job for job in pending_jobs if job is not session_job]
        if session is not None:
            link = session.get("link")
            if link is not None:
                _send_packet_on_link(
                    link,
                    json.dumps(
                        {
                            "type": _RESOURCE_SESSION_CANCEL_TYPE,
                            "transferId": transfer_key,
                        },
                        separators=(",", ":"),
                    ).encode("utf-8"),
                    f"target=qchat-file-reticulum resource_session_cancel transfer={transfer_key}",
                )
        _resource_session_cancel_request_receipt(receipt, transfer_key)
        _resource_session_finish_followers(
            session_job,
            False,
            reason="deduplicated_resource_cancelled",
        )
        if session is not None and session.get("closing") is not True:
            # An authorization timeout occurs only after link.request() was
            # dispatched. Receiving no response means this particular
            # requester/provider session can be half-open even when Reticulum
            # still reports it active locally. Do not feed the retry (or the
            # next queued job) back into the same suspect Link. Other pooled
            # sessions stay available and queued jobs are rehomed by
            # _resource_session_fail_state(). Ordinary user cancellation does
            # not imply a bad Link and continues to reuse the session.
            retire_session = (
                reason == "resource_authorization_timeout"
                and receipt is not None
            )
            if retire_session:
                _resource_session_fail_state(
                    session,
                    "resource_authorization_timeout",
                )
                closed += 1
            else:
                _resource_session_dispatch_pending(session)
                _resource_session_schedule_idle_close(session)
    with _state_lock:
        receive_pending = _qchat_file_accepts_by_transfer.get(transfer_key)
        if receive_pending is not None:
            _qchat_file_remove_pending_receive(
                str(receive_pending.get("peerPresenceHash") or peer_key).strip().lower(),
                transfer_key,
            )
        send_pending = _qchat_file_pending_sends_by_transfer.pop(transfer_key, None)
        for pending in (receive_pending, send_pending):
            if not isinstance(pending, dict):
                continue
            pending["cancelled"] = True
            active_chunks = pending.get("active_chunks")
            if isinstance(active_chunks, dict):
                for chunk in list(active_chunks.values()):
                    if not isinstance(chunk, dict):
                        continue
                    timer = chunk.pop("ack_timeout_timer", None) or chunk.pop("timer", None)
                    if timer is not None:
                        try:
                            timer.cancel()
                        except Exception:
                            pass
                active_chunks.clear()
    for link_id, link_state in list(_qchat_file_links_by_id.items()):
        if str(link_state.get("transferId") or "").strip() != transfer_key:
            continue
        if peer_key and str(link_state.get("peerPresenceHash") or "").strip().lower() != peer_key:
            continue
        link_state["cancelled"] = True
        link_state["completed"] = True
        _qchat_file_close_link_now(link_state)
        closed += 1
    log(
        "[presence_bridge] qchat file transfer cancelled "
        f"transfer={transfer_key} peer={peer_key[:16]} closed_links={closed} reason={reason}"
    )
    _qchat_file_emit(
        "cancelled",
        {
            "transferId": transfer_key,
            "peerPresenceHash": peer_key,
            "reason": reason,
        },
    )
    return closed


def _qchat_file_close_link_now(state: Optional[Dict[str, Any]]) -> None:
    if state is None:
        return
    state["completed"] = True
    link = state.get("link")
    link_id = get_qchat_file_link_id(link) if link is not None else None
    if link_id:
        remove_qchat_file_link(link_id)
    try:
        if link is not None:
            link.teardown()
    except Exception:
        pass


def _qchat_file_retry_receive_chunk(
    pending: Dict[str, Any],
    state: Optional[Dict[str, Any]],
    peer_hash: str,
    transfer_id: str,
    metadata: Dict[str, Any],
    reason: str,
) -> bool:
    try:
        chunk_index = int(metadata.get("chunkIndex"))
        chunk_count = int(metadata.get("chunkCount") or 0)
    except Exception:
        return False
    if chunk_index < 0:
        return False
    lock = pending.get("chunk_lock")
    if lock is None:
        lock = threading.RLock()
        pending["chunk_lock"] = lock
    with lock:
        completed_chunks = pending.setdefault("completed_chunks", set())
        if isinstance(completed_chunks, set) and chunk_index in completed_chunks:
            _qchat_file_close_link_now(state)
            return True
        active_chunks = pending.setdefault("active_chunks", {})
        if isinstance(active_chunks, dict):
            active_chunks.pop(chunk_index, None)
        attempts = pending.setdefault("chunk_attempts", {})
        if not isinstance(attempts, dict):
            attempts = {}
            pending["chunk_attempts"] = attempts
        next_attempt = int(attempts.get(chunk_index) or 1) + 1
        attempts[chunk_index] = next_attempt
        if next_attempt > _QCHAT_FILE_CHUNK_MAX_ATTEMPTS:
            log(
                "[presence_bridge] qchat file chunk retry exhausted "
                f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                f"attempts={next_attempt - 1} reason={reason}"
            )
            return False
        auth_message = pending.get("authMessage")
        if not isinstance(auth_message, dict):
            return False
        retry_auth = dict(auth_message)
        retry_auth["retryChunkIndex"] = chunk_index
        retry_state = {
            "peerPresenceHash": peer_hash,
            "peerDestinationHash": "",
            "incoming": False,
            "established": False,
            "transferId": transfer_id,
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "sha256": pending.get("sha256") or "",
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
            "streamMode": False,
            "metadata": pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {},
            "peerIdentity": pending.get("peerIdentity"),
            "authMessage": retry_auth,
            "receive_root": pending,
            "requestedChunkIndex": chunk_index,
            "created_at": time.time(),
            "open_attempts": 0,
        }
    _qchat_file_close_link_now(state)
    log(
        "[presence_bridge] qchat file chunk retry scheduled "
        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
        f"attempt={next_attempt}/{_QCHAT_FILE_CHUNK_MAX_ATTEMPTS} reason={reason}"
    )
    _qchat_file_emit(
        "retrying",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
            "reason": reason,
            "chunkIndex": chunk_index,
            "attempt": next_attempt,
            "maxAttempts": _QCHAT_FILE_CHUNK_MAX_ATTEMPTS,
        },
    )
    return _open_qchat_file_link_async(retry_state)


def _qchat_file_retry_unknown_receive_chunk(
    pending: Dict[str, Any],
    state: Optional[Dict[str, Any]],
    peer_hash: str,
    transfer_id: str,
    reason: str,
) -> bool:
    lock = pending.get("chunk_lock")
    if lock is None:
        lock = threading.RLock()
        pending["chunk_lock"] = lock
    with lock:
        failures = int(pending.get("unknown_chunk_failures") or 0) + 1
        pending["unknown_chunk_failures"] = failures
        if failures > _QCHAT_FILE_UNKNOWN_CHUNK_MAX_FAILURES:
            log(
                "[presence_bridge] qchat file unknown chunk retry exhausted "
                f"transfer={transfer_id} peer={peer_hash[:16]} failures={failures - 1} reason={reason}"
            )
            return False
        auth_message = pending.get("authMessage")
        if not isinstance(auth_message, dict):
            return False
        retry_state = {
            "peerPresenceHash": peer_hash,
            "peerDestinationHash": "",
            "incoming": False,
            "established": False,
            "transferId": transfer_id,
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "sha256": pending.get("sha256") or "",
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
            "streamMode": False,
            "metadata": pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {},
            "peerIdentity": pending.get("peerIdentity"),
            "authMessage": dict(auth_message),
            "receive_root": pending,
            "created_at": time.time(),
            "open_attempts": 0,
        }
    _qchat_file_close_link_now(state)
    log(
        "[presence_bridge] qchat file unknown chunk retry scheduled "
        f"transfer={transfer_id} peer={peer_hash[:16]} failure={failures}/{_QCHAT_FILE_UNKNOWN_CHUNK_MAX_FAILURES} "
        f"reason={reason}"
    )
    _qchat_file_emit(
        "retrying",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
            "reason": reason,
            "attempt": failures,
            "maxAttempts": _QCHAT_FILE_UNKNOWN_CHUNK_MAX_FAILURES,
        },
    )
    return _open_qchat_file_link_async(retry_state)


def _qchat_file_mark_transfer_started(state: Optional[Dict[str, Any]]) -> None:
    if state is None:
        return
    timer = state.pop("auth_timeout_timer", None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass
    state["resource_started"] = True


def _qchat_file_read_chunk(file_path: str, offset: int, chunk_size: int) -> bytes:
    with open(file_path, "rb") as f:
        f.seek(offset)
        return f.read(chunk_size)


def _send_qchat_file_chunk_ack(link, transfer_id: str, chunk_index: int, chunk_size: int) -> bool:
    if link is None:
        log(
            "[presence_bridge] qchat file chunk ack not sent "
            f"transfer={transfer_id} chunk={chunk_index} reason=no_link"
        )
        return False
    try:
        ok = bool(
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
        log(
            "[presence_bridge] qchat file chunk ack sent "
            f"transfer={transfer_id} chunk={chunk_index} chunk_size={chunk_size} ok={ok}"
        )
        return ok
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
        _teardown_reticulum_link_bounded(
            link,
            f"target=qchat-file-reticulum success_grace_close transfer={state.get('transferId') or ''}",
        )

    timer = threading.Timer(_QCHAT_FILE_SUCCESS_LINK_CLOSE_GRACE_SECONDS, close_link)
    timer.daemon = True
    timer.start()


def _qchat_file_start_channel_stream_sender(state: Dict[str, Any]) -> bool:
    link = state.get("link")
    file_path = str(state.get("filePath") or "")
    transfer_id = str(state.get("transferId") or "")
    peer_hash = str(state.get("peerPresenceHash") or "")
    file_name = str(state.get("fileName") or os.path.basename(file_path))
    resource_type = str(state.get("resourceType") or "qchat-dm-file")
    if link is None or not file_path or not transfer_id:
        return False
    if state.get("stream_started") is True:
        return True
    state["stream_started"] = True

    def run() -> None:
        size = 0
        sent = 0
        try:
            size = os.path.getsize(file_path)
            channel = link.get_channel()
            writer = RNS.Buffer.create_writer(1, channel)
            _qchat_file_emit(
                "sending",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": resource_type,
                    "progress": 0,
                    "bytesTransferred": 0,
                },
            )
            with open(file_path, "rb") as source:
                idle_since = time.monotonic()
                while True:
                    chunk = source.read(64 * 1024)
                    if not chunk:
                        break
                    view = memoryview(chunk)
                    offset = 0
                    while offset < len(view):
                        written = writer.write(view[offset:])
                        if written is None:
                            written = 0
                        if written <= 0:
                            if time.monotonic() - idle_since > _QCHAT_FILE_CHANNEL_STREAM_IDLE_TIMEOUT_SECONDS:
                                raise TimeoutError("channel stream send timed out waiting for buffer space")
                            time.sleep(0.02)
                            continue
                        idle_since = time.monotonic()
                        offset += int(written)
                        sent += int(written)
                        writer.flush()
                        progress = min(1.0, sent / float(size)) if size > 0 else 0.0
                        if _should_emit_qchat_file_progress(state, progress, force=progress >= 1.0):
                            _qchat_file_emit(
                                "sending",
                                {
                                    "transferId": transfer_id,
                                    "peerPresenceHash": peer_hash,
                                    "fileName": file_name,
                                    "size": size,
                                    "resourceType": resource_type,
                                    **_qchat_file_progress_payload(state, progress, size),
                                },
                            )
            writer.close()
            state["completed"] = True
            with _state_lock:
                _qchat_file_pending_sends_by_transfer.pop(transfer_id, None)
            _qchat_file_emit(
                "sent",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": resource_type,
                },
            )
            _qchat_file_close_success_link_after_grace(link, state)
        except Exception as exc:
            state["completed"] = True
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": resource_type,
                    "reason": "channel_stream_send_failed",
                    "error": str(exc),
                },
            )
            try:
                link.teardown()
            except Exception:
                pass

    thread = threading.Thread(target=run, name=f"qchat-file-stream-send-{transfer_id[:8]}", daemon=True)
    thread.start()
    return True


def _qchat_file_start_channel_stream_receiver(state: Dict[str, Any]) -> bool:
    link = state.get("link")
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    transfer_id = str(state.get("transferId") or "").strip()
    pending = _qchat_file_get_pending_receive(peer_hash, transfer_id)
    if link is None or not pending or pending.get("stream_started") is True:
        return False
    pending["stream_started"] = True
    _qchat_file_mark_transfer_started(state)

    def run() -> None:
        save_path = str(pending.get("savePath") or "")
        part_path = save_path + ".part"
        expected_hash = str(pending.get("sha256") or "").strip().lower()
        file_name = str(pending.get("fileName") or "")
        size = int(pending.get("size") or 0)
        received = 0
        try:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            channel = link.get_channel()
            reader = RNS.Buffer.create_reader(1, channel)
            _qchat_file_emit(
                "receiving",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": pending.get("resourceType") or "qchat-dm-file",
                    "progress": 0,
                    "bytesTransferred": 0,
                },
            )
            with open(part_path, "wb") as out:
                idle_since = time.monotonic()
                while True:
                    chunk = reader.read(64 * 1024)
                    if chunk is None:
                        if time.monotonic() - idle_since > _QCHAT_FILE_CHANNEL_STREAM_IDLE_TIMEOUT_SECONDS:
                            raise TimeoutError("channel stream receive timed out waiting for data")
                        time.sleep(0.02)
                        continue
                    if chunk == b"":
                        break
                    idle_since = time.monotonic()
                    out.write(chunk)
                    received += len(chunk)
                    progress = min(1.0, received / float(size)) if size > 0 else 0.0
                    if _should_emit_qchat_file_progress(pending, progress, force=progress >= 1.0):
                        _qchat_file_emit(
                            "receiving",
                            {
                                "transferId": transfer_id,
                                "peerPresenceHash": peer_hash,
                                "fileName": file_name,
                                "size": size,
                                "resourceType": pending.get("resourceType") or "qchat-dm-file",
                                **_qchat_file_progress_payload(pending, progress, size),
                            },
                        )
            if size > 0 and received != size:
                raise ValueError(f"stream size mismatch received={received} expected={size}")
            actual_hash = _sha256_file_hex(part_path)
            if expected_hash and actual_hash.lower() != expected_hash:
                raise ValueError(f"stream hash mismatch expected={expected_hash} actual={actual_hash}")
            os.replace(part_path, save_path)
            pending["completed"] = True
            _qchat_file_remove_pending_receive(peer_hash, transfer_id)
            _qchat_file_receiver_transfer_done(peer_hash, transfer_id)
            _qchat_file_emit(
                "received",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "path": save_path,
                    "resourceType": pending.get("resourceType") or "qchat-dm-file",
                },
            )
        except Exception as exc:
            try:
                os.remove(part_path)
            except Exception:
                pass
            _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": pending.get("resourceType") or "qchat-dm-file",
                    "reason": "channel_stream_receive_failed",
                    "error": str(exc),
                },
            )
            try:
                link.teardown()
            except Exception:
                pass

    thread = threading.Thread(target=run, name=f"qchat-file-stream-recv-{transfer_id[:8]}", daemon=True)
    thread.start()
    return True


def _start_qchat_file_resource_for_state(state: Dict[str, Any]) -> bool:
    link = state.get("link")
    file_path = str(state.get("filePath") or "")
    transfer_id = str(state.get("transferId") or "")
    peer_hash = str(state.get("peerPresenceHash") or "")
    file_name = str(state.get("fileName") or os.path.basename(file_path))
    sha256 = str(state.get("sha256") or "").strip().lower()
    resource_type = str(state.get("resourceType") or "qchat-dm-file")
    if link is None or not file_path or not transfer_id:
        return False
    if state.get("resource_started") is True:
        return True
    size = os.path.getsize(file_path)
    if not state.get("send_root"):
        state["send_root"] = state
    root = state.get("send_root") if isinstance(state.get("send_root"), dict) else state
    if not _qchat_file_should_bridge_chunk_resource(resource_type, state.get("streamMode") is True):
        root["transferId"] = transfer_id
        root["peerPresenceHash"] = peer_hash
        root["fileName"] = file_name
        root["size"] = size
        root["resourceType"] = resource_type
        root["active_chunks"] = {
            0: {
                "size": size,
                "progress": 0.0,
                "started_at": time.monotonic(),
            }
        }
        _qchat_file_emit(
            "sending",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": file_name,
                "size": size,
                "resourceType": resource_type,
                **_qchat_file_progress_payload(root, 0.0, size),
            },
        )
        log(
            "[presence_bridge] qchat file resource starting "
            f"transfer={transfer_id} peer={peer_hash[:16]} exact=true "
            f"resource_size={size} resource_type={resource_type}"
        )
        metadata = {
            "kind": resource_type,
            "resourceType": resource_type,
            "transferId": transfer_id,
            "fileName": file_name,
            "size": size,
            "sha256": sha256,
        }
        extra_metadata = root.get("metadata") if isinstance(root.get("metadata"), dict) else state.get("metadata")
        if isinstance(extra_metadata, dict):
            for key, value in extra_metadata.items():
                metadata_key = str(key)
                if metadata_key in _QCHAT_FILE_RESERVED_METADATA_KEYS:
                    metadata[f"app_{metadata_key}"] = value
                else:
                    metadata[metadata_key] = value

        def on_done(resource) -> None:
            status = "sent" if getattr(resource, "status", None) == RNS.Resource.COMPLETE else "failed"
            resource_status = getattr(resource, "status", None)
            elapsed = 0.0
            active_for_elapsed = root.get("active_chunks")
            if isinstance(active_for_elapsed, dict):
                active_chunk = active_for_elapsed.get(0)
                if isinstance(active_chunk, dict):
                    started_at = float(active_chunk.get("started_at") or 0)
                    if started_at > 0:
                        elapsed = max(0.0, time.monotonic() - started_at)
            log(
                "[presence_bridge] qchat file resource send concluded "
                f"transfer={transfer_id} peer={peer_hash[:16]} exact=true "
                f"resource_size={size} status={status} resource_status={resource_status} "
                f"elapsed_ms={int(elapsed * 1000)}"
            )
            if status == "sent":
                root["completed"] = True
                root["sent_bytes"] = size
                active = root.get("active_chunks")
                if isinstance(active, dict):
                    active.pop(0, None)
                with _state_lock:
                    _qchat_file_pending_sends_by_transfer.pop(transfer_id, None)
                _qchat_file_emit(
                    "sent",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "fileName": file_name,
                        "size": size,
                        "resourceType": resource_type,
                        **_qchat_file_progress_payload(root, 1.0, size),
                    },
                )
                _qchat_file_close_success_link_after_grace(link, state)
                return
            active = root.get("active_chunks")
            if isinstance(active, dict):
                active.pop(0, None)
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": file_name,
                    "size": size,
                    "resourceType": resource_type,
                    "reason": "resource_send_failed",
                    "resourceStatus": resource_status,
                },
            )
            link_id_done = get_qchat_file_link_id(link)
            if link_id_done:
                remove_qchat_file_link(link_id_done)
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum send_failed transfer={transfer_id}",
            )

        def on_progress(resource) -> None:
            try:
                progress = float(resource.get_progress())
            except Exception:
                progress = 0.0
            active = root.setdefault("active_chunks", {})
            if isinstance(active, dict):
                chunk = active.setdefault(0, {"size": size, "progress": 0.0})
                if isinstance(chunk, dict):
                    chunk["progress"] = progress
            if _should_log_qchat_file_chunk_progress(root, "send:exact", progress):
                log(
                    "[presence_bridge] qchat file resource send progress "
                    f"transfer={transfer_id} peer={peer_hash[:16]} exact=true "
                    f"resource_size={size} progress={progress:.3f}"
                )
            if _should_emit_qchat_file_progress(root, progress):
                _qchat_file_emit(
                    "sending",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "fileName": file_name,
                        "size": size,
                        "resourceType": resource_type,
                        **_qchat_file_progress_payload(root, progress, size),
                    },
                )

        resource_file = open(file_path, "rb")
        try:
            RNS.Resource(
                resource_file,
                link,
                metadata=metadata,
                auto_compress=False,
                callback=on_done,
                progress_callback=on_progress,
            )
        except Exception:
            try:
                resource_file.close()
            except Exception:
                pass
            raise
        state["resource_started"] = True
        return True

    chunk_count = _qchat_file_chunk_count(size)
    with _state_lock:
        requested_chunk = state.pop("requestedChunkIndex", None)
        if requested_chunk is not None:
            try:
                requested_chunk = int(requested_chunk)
            except Exception:
                requested_chunk = None
        completed_chunks = root.setdefault("completed_chunks", set())
        active_chunks = root.setdefault("active_chunks", {})
        if (
            isinstance(requested_chunk, int)
            and 0 <= requested_chunk < chunk_count
        ):
            _qchat_file_cancel_active_send_chunk(root, requested_chunk)
            chunk_index = requested_chunk
        else:
            retry_chunks = root.setdefault("retry_chunks", [])
            chunk_index = None
            if isinstance(retry_chunks, list):
                while retry_chunks:
                    retry_candidate = retry_chunks.pop(0)
                    try:
                        retry_candidate = int(retry_candidate)
                    except Exception:
                        continue
                    if (
                        0 <= retry_candidate < chunk_count
                        and (not isinstance(completed_chunks, set) or retry_candidate not in completed_chunks)
                        and (not isinstance(active_chunks, dict) or retry_candidate not in active_chunks)
                    ):
                        chunk_index = retry_candidate
                        break
            next_chunk = int(root.get("next_chunk_index") or 0)
            while (
                chunk_index is None
                and
                next_chunk < chunk_count
                and (
                    (isinstance(completed_chunks, set) and next_chunk in completed_chunks)
                    or (isinstance(active_chunks, dict) and next_chunk in active_chunks)
                )
            ):
                next_chunk += 1
            if chunk_index is None and next_chunk >= chunk_count:
                _qchat_file_close_success_link_after_grace(link, state)
                return False
            if chunk_index is None:
                chunk_index = next_chunk
                root["next_chunk_index"] = next_chunk + 1
        send_attempts = root.setdefault("send_attempts", {})
        if isinstance(send_attempts, dict):
            attempt = int(send_attempts.get(chunk_index) or 0) + 1
            send_attempts[chunk_index] = attempt
            if attempt > _QCHAT_FILE_CHUNK_MAX_ATTEMPTS:
                log(
                    "[presence_bridge] qchat file chunk send attempts exhausted "
                    f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                    f"attempts={attempt - 1}"
                )
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": peer_hash,
                        "fileName": file_name,
                        "size": size,
                        "resourceType": resource_type,
                        "reason": "chunk_send_attempts_exhausted",
                        "chunkIndex": chunk_index,
                    },
                )
                return False
        chunk_offset, chunk_size = _qchat_file_chunk_bounds(size, chunk_index)
        root["transferId"] = transfer_id
        root["peerPresenceHash"] = peer_hash
        root["fileName"] = file_name
        root["size"] = size
        root["resourceType"] = resource_type
        root.setdefault("active_chunks", {})[chunk_index] = {
            "size": chunk_size,
            "progress": 0.0,
            "started_at": time.monotonic(),
        }
    _qchat_file_emit(
        "sending",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": file_name,
            "size": size,
            "resourceType": resource_type,
            "chunkIndex": chunk_index,
            "chunkSize": chunk_size,
            "chunkCount": chunk_count,
            **_qchat_file_progress_payload(root, min(1.0, float(root.get("sent_bytes") or 0) / float(size)) if size > 0 else 0.0, size),
        },
    )
    log(
        "[presence_bridge] qchat file resource starting "
        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
        f"chunk_size={chunk_size} total_size={size} resource_type={resource_type}"
    )
    metadata = {
        "kind": resource_type,
        "resourceType": resource_type,
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
    extra_metadata = root.get("metadata") if isinstance(root.get("metadata"), dict) else state.get("metadata")
    if isinstance(extra_metadata, dict):
        for key, value in extra_metadata.items():
            metadata_key = str(key)
            if metadata_key in _QCHAT_FILE_RESERVED_METADATA_KEYS:
                metadata[f"app_{metadata_key}"] = value
            else:
                metadata[metadata_key] = value

    def on_done(resource) -> None:
        status = "sent" if getattr(resource, "status", None) == RNS.Resource.COMPLETE else "failed"
        resource_status = getattr(resource, "status", None)
        elapsed = 0.0
        active_for_elapsed = root.get("active_chunks")
        if isinstance(active_for_elapsed, dict):
            active_chunk = active_for_elapsed.get(chunk_index)
            if isinstance(active_chunk, dict):
                started_at = float(active_chunk.get("started_at") or 0)
                if started_at > 0:
                    elapsed = max(0.0, time.monotonic() - started_at)
        log(
            "[presence_bridge] qchat file chunk send concluded "
            f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
            f"chunk_size={chunk_size} status={status} resource_status={resource_status} "
            f"elapsed_ms={int(elapsed * 1000)}"
        )
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
                    log(
                        "[presence_bridge] qchat file chunk ack timeout "
                        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                        f"chunk_size={chunk_size} timeout_s={_QCHAT_FILE_CHUNK_ACK_TIMEOUT_SECONDS}"
                    )
                    _qchat_file_requeue_send_chunk(root, chunk_index)
                    link_id_done = get_qchat_file_link_id(link)
                    if link_id_done:
                        remove_qchat_file_link(link_id_done)
                    _teardown_reticulum_link_bounded(
                        link,
                        f"target=qchat-file-reticulum chunk_ack_timeout transfer={transfer_id}",
                    )

                timer = threading.Timer(_QCHAT_FILE_CHUNK_ACK_TIMEOUT_SECONDS, ack_timeout)
                timer.daemon = True
                active[chunk_index]["ack_timeout_timer"] = timer
                timer.start()
            state["resource_send_complete"] = True
            _qchat_file_update_sent_progress(root)
            return
        else:
            _qchat_file_requeue_send_chunk(root, chunk_index)
            log(
                "[presence_bridge] qchat file chunk send failed "
                f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                f"chunk_size={chunk_size} resource_status={resource_status}"
            )
            link_id_done = get_qchat_file_link_id(link)
            if link_id_done:
                remove_qchat_file_link(link_id_done)
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum send_failed transfer={transfer_id}",
            )
            return

    def on_progress(resource) -> None:
        try:
            progress = float(resource.get_progress())
        except Exception:
            progress = 0.0
        active = root.setdefault("active_chunks", {})
        if isinstance(active, dict) and chunk_index in active:
            active[chunk_index]["progress"] = progress
        if _should_log_qchat_file_chunk_progress(
            root,
            f"send:{chunk_index}",
            progress,
        ):
            log(
                "[presence_bridge] qchat file chunk send progress "
                f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                f"chunk_size={chunk_size} progress={progress:.3f}"
            )
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
                _qchat_file_state_event_payload(state),
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
                    _qchat_file_state_event_payload(
                        state,
                        {
                            "reason": "sender_auth_timeout",
                            "error": "Sender did not authorize the file transfer",
                        },
                    ),
                )
                _teardown_reticulum_link_bounded(
                    link,
                    f"target=qchat-file-reticulum sender_auth_timeout transfer={state.get('transferId') or ''}",
                )

            timer = threading.Timer(45.0, auth_timeout)
            timer.daemon = True
            state["auth_timeout_timer"] = timer
            timer.start()
            return True
        _qchat_file_emit(
            "failed",
            _qchat_file_state_event_payload(
                state,
                {
                    "reason": "auth_send_failed",
                },
            ),
        )
    except Exception as exc:
        _qchat_file_emit(
            "failed",
            _qchat_file_state_event_payload(
                state,
                {
                    "reason": "auth_send_failed",
                    "error": str(exc),
                },
            ),
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
    _release_qchat_file_open_slot(state)
    _schedule_qchat_file_peer_open_drain(
        str(state.get("peerPresenceHash") or "").strip().lower()
    )
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
        if state.get("streamMode") is True:
            _qchat_file_start_channel_stream_sender(state)
            return
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
        return False
    transfer_id_hint = (
        _qchat_file_resource_transfer_id(resource)
        or str((state or {}).get("transferId") or "").strip()
    )
    with _state_lock:
        pending = _qchat_file_expire_pending_receive(peer_hash, transfer_id_hint)
    if not pending:
        log(
            "[presence_bridge] qchat file resource advertised without pending receive "
            f"peer={peer_hash} transfer={transfer_id_hint}"
        )
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
    log(
        "[presence_bridge] qchat file resource advertised "
        f"transfer={transfer_id} peer={peer_hash[:16]} size={expected_size}"
    )
    _qchat_file_emit(
        "receiving",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": pending.get("fileName"),
            "size": expected_size,
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
        },
    )
    return True


def on_qchat_file_resource_started(resource) -> None:
    link = getattr(resource, "link", None)
    link_id = get_qchat_file_link_id(link) if link is not None else None
    state = get_qchat_file_link_state(link_id) if link_id else None
    if _qchat_file_is_resource_session_response(resource, state):
        # RNS request responses are matched to their exact request receipt and
        # completed by _resource_session_response_received. Running the legacy
        # peer-based callback as well can attach a parallel response to the
        # wrong range.
        return
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
    transfer_id_hint = (
        _qchat_file_resource_transfer_id(resource)
        or str((state or {}).get("transferId") or "").strip()
    )
    with _state_lock:
        pending = _qchat_file_get_pending_receive(peer_hash, transfer_id_hint)
    if state is not None:
        _qchat_file_mark_transfer_started(state)
        state["qchat_file_chunk_completed"] = False
    if not pending:
        log(
            "[presence_bridge] qchat file resource started without pending receive "
            f"peer={peer_hash} transfer={transfer_id_hint}"
        )
        return
    transfer_id = str(pending.get("transferId") or "")
    file_name = str(pending.get("fileName") or "")
    size = int(pending.get("size") or 0)
    try:
        resource_size = int(resource.get_data_size())
    except Exception:
        resource_size = int(getattr(resource, "total_size", 0) or 0)
    resource_type = str(pending.get("resourceType") or "qchat-dm-file").strip() or "qchat-dm-file"
    metadata = getattr(resource, "metadata", None)
    chunk_index = int(metadata.get("chunkIndex") or 0) if isinstance(metadata, dict) else -1
    chunk_count = int(metadata.get("chunkCount") or 0) if isinstance(metadata, dict) else 0
    chunk_size = int(metadata.get("chunkSize") or 0) if isinstance(metadata, dict) else 0
    is_known_chunk = isinstance(metadata, dict) and metadata.get("chunked") is True and chunk_index >= 0
    is_chunked_pending = pending.get("bridgeChunked") is True
    is_managed_resource = _qchat_file_is_managed_resource_type(resource_type)
    if is_known_chunk:
        lock = pending.get("chunk_lock")
        if lock is None:
            lock = threading.RLock()
            pending["chunk_lock"] = lock
        with lock:
            active_chunks = pending.setdefault("active_chunks", {})
            if isinstance(active_chunks, dict):
                active_chunks[chunk_index] = {
                    "size": chunk_size,
                    "progress": 0.0,
                    "started_at": time.monotonic(),
                }
            attempts = pending.setdefault("chunk_attempts", {})
            if isinstance(attempts, dict):
                attempts.setdefault(chunk_index, 1)
    if is_known_chunk:
        log(
            "[presence_bridge] qchat file resource started "
            f"transfer={transfer_id} peer={peer_hash[:16]} size={size} "
            f"chunk={chunk_index}/{chunk_count} chunk_size={chunk_size}"
        )
    else:
        size_label = (
            f"max_size={size} resource_size={resource_size}"
            if pending.get("variableSize") is True
            or (
                isinstance(pending.get("metadata"), dict)
                and pending["metadata"].get("variableSize") is True
            )
            else f"size={size} resource_size={resource_size}"
        )
        log(
            "[presence_bridge] qchat file resource started "
            f"transfer={transfer_id} peer={peer_hash[:16]} {size_label} "
            f"resource_type={resource_type} bridge_chunked={is_chunked_pending}"
        )

    def on_progress(res) -> None:
        try:
            resource_progress = float(res.get_progress())
        except Exception:
            resource_progress = 0.0
        if is_known_chunk:
            lock = pending.get("chunk_lock")
            if lock is None:
                lock = threading.RLock()
                pending["chunk_lock"] = lock
            with lock:
                active_chunks = pending.setdefault("active_chunks", {})
                if isinstance(active_chunks, dict):
                    chunk = active_chunks.setdefault(
                        chunk_index,
                        {
                            "size": chunk_size,
                            "progress": 0.0,
                            "started_at": time.monotonic(),
                        },
                    )
                    if isinstance(chunk, dict):
                        chunk["size"] = chunk_size
                        chunk["progress"] = resource_progress
                progress = _qchat_file_chunked_receive_progress(pending, size)
        elif is_chunked_pending:
            progress = _qchat_file_chunked_receive_progress(pending, size)
        else:
            progress = resource_progress
        if is_known_chunk and _should_log_qchat_file_chunk_progress(
            pending,
            f"recv:{chunk_index}",
            resource_progress,
        ):
            log(
                "[presence_bridge] qchat file chunk receive progress "
                f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                f"chunk_size={chunk_size} progress={resource_progress:.3f}"
            )
        elif (
            not is_chunked_pending
            and not is_managed_resource
            and _should_log_qchat_file_chunk_progress(
                pending,
                "recv:resource",
                resource_progress,
            )
        ):
            log(
                "[presence_bridge] qchat file resource receive progress "
                f"transfer={transfer_id} peer={peer_hash[:16]} resource_type={resource_type} "
                f"size={size} progress={resource_progress:.3f}"
            )
        if not _should_emit_qchat_file_progress(pending, progress):
            return
        _qchat_file_emit(
            "receiving",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": file_name,
                "size": size,
                "resourceType": pending.get("resourceType") or "qchat-dm-file",
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
    if _qchat_file_is_resource_session_response(resource, state):
        return
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
    resource_transfer_id = (
        _qchat_file_resource_transfer_id(resource)
        or str((state or {}).get("transferId") or "").strip()
    )
    with _state_lock:
        pending = _qchat_file_get_pending_receive(peer_hash, resource_transfer_id)
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
        metadata = getattr(resource, "metadata", None)
        is_chunked = isinstance(metadata, dict) and metadata.get("chunked") is True
        managed_resource = _qchat_file_is_managed_resource_type(
            str(pending.get("resourceType") or "")
        )
        if getattr(resource, "status", None) != RNS.Resource.COMPLETE:
            log(
                "[presence_bridge] qchat file resource incomplete "
                f"transfer={transfer_id} peer={peer_hash[:16]} "
                f"resource_status={getattr(resource, 'status', None)}"
            )
            if is_chunked and _qchat_file_retry_receive_chunk(
                pending,
                state,
                peer_hash,
                transfer_id,
                metadata,
                "resource_incomplete",
            ):
                return
            if not is_chunked and not managed_resource and _qchat_file_retry_unknown_receive_chunk(
                pending,
                state,
                peer_hash,
                transfer_id,
                "resource_incomplete_unknown_chunk",
            ):
                return
            _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
            _qchat_file_emit(
                "failed",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "reason": "resource_incomplete",
                },
            )
            return
        if isinstance(metadata, dict):
            metadata_transfer_id = str(metadata.get("transferId") or "")
            metadata_size = int(metadata.get("size") or 0)
            metadata_sha256 = str(metadata.get("sha256") or "").strip().lower()
            expected_size = int(pending.get("size") or 0)
            pending_metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
            allow_variable_size = (
                metadata.get("variableSize") is True
                or pending_metadata.get("variableSize") is True
                or pending_metadata.get("logicalResourceType") == "reticulum_chat_history_page"
            )
            if (
                (metadata_transfer_id and metadata_transfer_id != transfer_id)
                or (
                    metadata_size
                    and expected_size
                    and metadata_size != expected_size
                    and not allow_variable_size
                )
                or (not is_chunked and metadata_sha256 and expected_hash and metadata_sha256 != expected_hash)
            ):
                log(
                    "[presence_bridge] qchat file resource metadata mismatch "
                    f"transfer={transfer_id} peer={peer_hash[:16]} "
                    f"metadata_transfer={metadata_transfer_id} expected_transfer={transfer_id} "
                    f"metadata_size={metadata_size} expected_size={expected_size} "
                    f"is_chunked={is_chunked}"
                )
                _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
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
            log(
                "[presence_bridge] qchat file resource missing file "
                f"transfer={transfer_id} peer={peer_hash[:16]}"
            )
            _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
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
            log(
                "[presence_bridge] qchat file chunk receive concluded "
                f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                f"chunk_size={chunk_size} chunk_offset={chunk_offset} source={source_path}"
            )
            lock = pending.get("chunk_lock")
            if lock is None:
                lock = threading.RLock()
                pending["chunk_lock"] = lock
            with lock:
                active_chunks = pending.setdefault("active_chunks", {})
                if isinstance(active_chunks, dict):
                    active_chunks.pop(chunk_index, None)
                completed_chunks = pending.setdefault("completed_chunks", set())
                if chunk_index not in completed_chunks:
                    _write_chunk_to_part_file(source_path, save_path, chunk_offset)
                    completed_chunks.add(chunk_index)
                    pending["received_bytes"] = int(pending.get("received_bytes") or 0) + chunk_size
                    log(
                        "[presence_bridge] qchat file chunk stored "
                        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count} "
                        f"completed={len(completed_chunks)}/{chunk_count} "
                        f"received_bytes={int(pending.get('received_bytes') or 0)}"
                    )
                else:
                    log(
                        "[presence_bridge] qchat file chunk duplicate "
                        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count}"
                    )
                size = int(pending.get("size") or 0)
                progress = _qchat_file_chunked_receive_progress(pending, size)
                if _should_emit_qchat_file_progress(pending, progress, force=progress >= 1.0):
                    _qchat_file_emit(
                        "receiving",
                        {
                            "transferId": transfer_id,
                            "peerPresenceHash": peer_hash,
                            "fileName": pending.get("fileName"),
                            "size": size,
                            "resourceType": pending.get("resourceType") or "qchat-dm-file",
                            **_qchat_file_progress_payload(pending, progress, size),
                        },
                    )
                done = chunk_count > 0 and len(completed_chunks) >= chunk_count
            if state is not None:
                state["resource_started"] = False
                state["qchat_file_chunk_completed"] = True
            if not done:
                if not _send_qchat_file_chunk_ack(link, transfer_id, chunk_index, chunk_size):
                    log(
                        "[presence_bridge] qchat file chunk ack send failed after store "
                        f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count}"
                    )
                    _qchat_file_close_link_now(state)
                return
            part_path = save_path + ".part"
            actual_hash = _sha256_file_hex(part_path)
            if expected_hash and actual_hash.lower() != expected_hash:
                log(
                    "[presence_bridge] qchat file final hash mismatch "
                    f"transfer={transfer_id} peer={peer_hash[:16]} "
                    f"expected={expected_hash} actual={actual_hash}"
                )
                _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
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
                log(
                    "[presence_bridge] qchat file final chunk ack send failed "
                    f"transfer={transfer_id} peer={peer_hash[:16]} chunk={chunk_index}/{chunk_count}"
                )
            if state is not None:
                state["completed"] = True
            with _state_lock:
                _qchat_file_remove_pending_receive(peer_hash, transfer_id)
            _qchat_file_emit(
                "received",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": pending.get("fileName"),
                    "path": save_path,
                    "sha256": actual_hash,
                    "resourceType": pending.get("resourceType") or "qchat-dm-file",
                    **(pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}),
                },
            )
            _qchat_file_receiver_transfer_done(peer_hash, transfer_id)
            return
        actual_hash = _sha256_file_hex(source_path)
        if expected_hash and actual_hash.lower() != expected_hash:
            _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
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
            _qchat_file_remove_pending_receive(peer_hash, transfer_id)
        _qchat_file_emit(
            "received",
            {
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": pending.get("fileName"),
                "path": save_path,
                "sha256": actual_hash,
                "resourceType": pending.get("resourceType") or "qchat-dm-file",
                **(pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}),
            },
        )
        _qchat_file_receiver_transfer_done(peer_hash, transfer_id)
    except Exception as exc:
        _qchat_file_fail_pending_receive(state, peer_hash, transfer_id)
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
    with _state_lock:
        state = _overlay_links_by_id.get(link_id)
        if state is not None:
            _ensure_managed_link_fields(state, kind="overlay")
            _set_link_manager_generation(link, state)
        _overlay_link_ids_by_object[id(link)] = link_id


def _run_delayed_presence_announce_replay(peer_hash: str, link_id: str, generation: int, reason: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    link_key = str(link_id or "").strip()
    skip_reason = ""
    with _state_lock:
        state = _overlay_links_by_id.get(link_key)
        active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) if peer_key else ""
        if state is None:
            skip_reason = "missing_link"
        elif not _managed_link_generation_matches("overlay", link_key, generation):
            skip_reason = "stale_generation"
        elif active_link_id != link_key:
            skip_reason = "not_active_link"
        elif state.get("established") is not True:
            skip_reason = "not_established"
        elif not _overlay_link_is_fanout_usable(state):
            skip_reason = "not_usable"
        elif _overlay_peer_is_suppressed(peer_key):
            skip_reason = "peer_suppressed"
        elif str(state.get("last_failure_reason") or "").lower() == "destination_closed":
            skip_reason = "destination_closed"
        else:
            state["replay_pending"] = False
            state["last_replay_reason"] = reason
    if skip_reason:
        with _state_lock:
            state = _overlay_links_by_id.get(link_key)
            if state is not None:
                state["replay_pending"] = False
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum presence_announce_replay_skipped "
            f"peer={peer_key or 'unknown'} link={link_key or 'unknown'} "
            f"generation={generation} reason={skip_reason}"
        )
        return
    queued = _enqueue_latest_presence_announce_replay(peer_key, reason)
    if queued:
        with _state_lock:
            state = _overlay_links_by_id.get(link_key)
            if state is not None and int(state.get("generation") or 0) == int(generation):
                state["last_replay_at"] = time.time()
                state["last_replay_reason"] = reason
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum presence_announce_replay_delayed "
        f"peer={peer_key} link={link_key} generation={generation} "
        f"queued={str(bool(queued)).lower()} reason={reason}"
    )


def _schedule_delayed_presence_announce_replay(peer_hash: str, link_id: str, reason: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    link_key = str(link_id or "").strip()
    if not peer_key or not link_key:
        return
    with _state_lock:
        state = _overlay_links_by_id.get(link_key)
        if state is None:
            return
        _ensure_managed_link_fields(state, kind="overlay")
        generation = int(state.get("generation") or 0)
        state["replay_pending"] = True
        state["replay_scheduled_at"] = time.time()
        state["replay_scheduled_reason"] = reason

    def fire() -> None:
        _enqueue_scheduler_task(
            "overlay-control",
            f"presence-replay-delayed:{peer_key[:8]}",
            _run_delayed_presence_announce_replay,
            peer_key,
            link_key,
            generation,
            reason,
            drop_oldest=False,
        )

    timer = threading.Timer(_OVERLAY_ESTABLISHED_REPLAY_DELAY_SECONDS, fire)
    timer.daemon = True
    timer.start()
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum presence_announce_replay_scheduled "
        f"peer={peer_key} link={link_key} generation={generation} "
        f"delay_ms={int(_OVERLAY_ESTABLISHED_REPLAY_DELAY_SECONDS * 1000)} reason={reason}"
    )


def on_outgoing_overlay_link_established(link) -> None:
    link_id = get_overlay_link_id(link)
    if link_id is None:
        return
    state = get_overlay_link_state(link_id)
    if state is None:
        return
    if not _link_manager_generation_current("overlay", link_id, link):
        return
    if not _overlay_link_is_current(link_id, link):
        return
    configure_overlay_link(link, link_id)
    now = time.time()
    _ensure_managed_link_fields(state, kind="overlay")
    state["established"] = True
    state["established_at"] = now
    state["manager_state"] = _LINK_STATE_ESTABLISHED
    state["rnsLinkId"] = (_rns_link_id_bytes(link) or b"").hex()
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] overlay link identify failed link={link_id}: {exc}")
    if not _overlay_link_is_current(link_id, link):
        return
    emit_overlay_link_state(link_id, state, "established")
    ph_out = str(state.get("peerPresenceHash") or "").strip().lower()
    if state.get("migration_candidate") is True:
        _send_overlay_hello_for_link(link_id, "migration_candidate_established")
        established_event = state.get("migration_established_event")
        if isinstance(established_event, threading.Event):
            established_event.set()
        return
    if ph_out and _valid_presence_destination_hash_hex(ph_out):
        _register_active_overlay_for_peer(ph_out, link_id)
    _send_overlay_hello_for_link(link_id, "link_established")
    if ph_out and _valid_presence_destination_hash_hex(ph_out):
        _schedule_delayed_presence_announce_replay(ph_out, link_id, "link_established")
    if not _overlay_link_is_current(link_id, link):
        return
    _flush_overlay_link_pending(link_id)


def _send_wire_to_overlay_peer(
    peer_hash: str,
    wire_bytes: bytes,
    traffic: str,
    queue_if_pending: bool = True,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        state = _overlay_links_by_id.get(link_id) if link_id else None
        if state is not None:
            _ensure_managed_link_fields(state, kind="overlay")
    if state is None:
        _overlay_enqueue_open(peer_key, f"send:{traffic}", await_path=False)
        log(
            f"[presence_bridge] target=presence-reticulum overlay_link_missing peer={peer_key} traffic={traffic}"
        )
        return False
    link = state.get("link")
    if _overlay_link_is_fanout_usable(state) and link is not None:
        ok = _send_packet_on_link(
            link,
            wire_bytes,
            f"target=presence-reticulum overlay_link_send peer={peer_key} traffic={traffic}",
        )
        if ok:
            now = time.time()
            state["last_send_ok_at"] = now
        else:
            if queue_if_pending:
                _queue_overlay_packet(state, traffic, wire_bytes)
            emit_overlay_link_state(get_overlay_link_id(link) or "", state, traffic)
            return False
        emit_overlay_link_state(get_overlay_link_id(link) or "", state, traffic)
        return True
    if state.get("established") is True and state.get("overlay_transport_admitted") is not True:
        emit_overlay_link_state(
            _active_overlay_link_id_by_peer_hash.get(peer_key, ""),
            state,
            f"not_admitted:{traffic}",
        )
        return False
    emit_overlay_link_state(
        _active_overlay_link_id_by_peer_hash.get(peer_key, ""),
        state,
        f"not_ready:{traffic}",
    )
    return False


def _send_wire_to_established_overlay_peer(
    peer_hash: str,
    wire_bytes: bytes,
    traffic: str,
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    with _state_lock:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        state = _overlay_links_by_id.get(link_id) if link_id else None
        link = state.get("link") if state is not None else None
        usable = state is not None and _overlay_link_is_fanout_usable(state)
    if not link_id or state is None or link is None or not usable:
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_not_established "
            f"peer={peer_key} traffic={traffic}"
        )
        return False
    if not _overlay_link_is_current(link_id, link):
        log(
            "[presence_bridge] target=presence-reticulum overlay_link_not_current "
            f"peer={peer_key} link={link_id} traffic={traffic}"
        )
        return False
    ok = _send_packet_on_link(
        link,
        wire_bytes,
        f"target=presence-reticulum overlay_link_send peer={peer_key} traffic={traffic}",
    )
    if ok and _overlay_link_is_current(link_id, link):
        now = time.time()
        state["last_send_ok_at"] = now
        emit_overlay_link_state(link_id, state, traffic)
        return True
    if _overlay_link_is_current(link_id, link):
        emit_overlay_link_state(link_id, state, traffic)
    return False


def _enqueue_latest_presence_announce_replay(peer_hash: str, reason: str) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return False
    wire_bytes = _last_presence_announce_wire
    if not wire_bytes:
        return False
    lane = _presence_fanout_lane_for_peer(peer_key)
    queued = _enqueue_scheduler_task(
        lane,
        f"presence_announce_replay:{_last_presence_announce_id or 'unknown'}:{peer_key[:8]}",
        _fanout_presence_wire_to_peer,
        peer_key,
        wire_bytes,
        "presence_announce_replay",
        _last_presence_announce_id,
        drop_oldest=True,
    )
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum presence_announce_replay_queued "
        f"peer={peer_key} reason={reason} envelope_id={_last_presence_announce_id or 'n/a'} "
        f"queued={str(bool(queued)).lower()}"
    )
    return bool(queued)


def handle_clear_presence_cache(req_id: str, payload: Dict[str, Any]) -> None:
    global _last_presence_wire, _last_presence_announce_wire, _last_presence_announce_id
    _last_presence_wire = None
    _last_presence_announce_wire = None
    _last_presence_announce_id = ""
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum presence_cache_cleared "
        f"reason={str(payload.get('reason') or 'unspecified')}"
    )
    emit_resp(req_id, True, payload={"cleared": True})


def _presence_fanout_lane_for_peer(peer_hash: str) -> str:
    try:
        shard = int(str(peer_hash or "")[:8], 16) % _SCHEDULER_PRESENCE_FANOUT_SHARDS
    except Exception:
        shard = 0
    return f"presence-fanout-{shard}"


def _mark_presence_peer_send_timeout(peer_hash: str, envelope_id: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    if not peer_key:
        return
    link_id = ""
    with _state_lock:
        link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
        state = _overlay_links_by_id.get(link_id) if link_id else None
        if state is not None:
            _ensure_managed_link_fields(state, kind="overlay")
            state["manager_state"] = _LINK_STATE_DEGRADED
            state["last_failure_reason"] = "presence_peer_send_timeout"
            state["last_failure_at"] = time.time()
    _note_overlay_peer_failure(peer_key, "presence_peer_send_timeout")
    log(
        "[presence_bridge] target=presence-reticulum presence_peer_send_timeout "
        f"peer={peer_key} envelope_id={envelope_id or 'n/a'} "
        f"timeout_ms={int(_PRESENCE_PEER_SEND_TIMEOUT_SECONDS * 1000)} "
        f"link={link_id or 'none'}"
    )


def _send_presence_wire_to_peer_bounded(
    peer_hash: str,
    wire_bytes: bytes,
    traffic: str,
    envelope_id: str = "",
) -> Optional[bool]:
    done = threading.Event()
    result: Dict[str, Any] = {"ok": False}

    def run() -> None:
        try:
            result["ok"] = _send_wire_to_established_overlay_peer(
                peer_hash,
                wire_bytes,
                traffic,
            )
        except Exception as exc:
            result["ok"] = False
            result["error"] = str(exc)
        finally:
            done.set()

    thread = threading.Thread(
        target=run,
        name=f"presence-send-{str(peer_hash or '')[:8]}",
        daemon=True,
    )
    thread.start()
    if not done.wait(_PRESENCE_PEER_SEND_TIMEOUT_SECONDS):
        _mark_presence_peer_send_timeout(peer_hash, envelope_id)
        return None
    if result.get("error"):
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum presence_peer_send_exception "
            f"peer={peer_hash} envelope_id={envelope_id or 'n/a'} err={result.get('error')}"
        )
    return bool(result.get("ok"))


def _fanout_presence_wire_to_peer(
    peer_hash: str,
    wire_bytes: bytes,
    traffic: str,
    envelope_id: str = "",
) -> None:
    ok = _send_presence_wire_to_peer_bounded(peer_hash, wire_bytes, traffic, envelope_id)
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum async_presence_peer_done "
        f"traffic={traffic} envelope_id={envelope_id or 'n/a'} "
        f"peer={peer_hash} sent={str(ok is True).lower()} "
        f"timed_out={str(ok is None).lower()}"
    )


def _enqueue_presence_fanout_tasks(
    peer_hashes: List[str],
    wire_bytes: bytes,
    traffic: str,
    envelope_id: str = "",
) -> Tuple[bool, int]:
    queued_count = 0
    for peer_hash in peer_hashes:
        lane = _presence_fanout_lane_for_peer(peer_hash)
        if _enqueue_scheduler_task(
            lane,
            f"{traffic}:{envelope_id or 'unknown'}:{peer_hash[:8]}",
            _fanout_presence_wire_to_peer,
            peer_hash,
            wire_bytes,
            traffic,
            envelope_id,
            drop_oldest=True,
        ):
            queued_count += 1
    verbose_presence_log(
        "[presence_bridge] target=presence-reticulum async_presence_fanout_queued "
        f"traffic={traffic} envelope_id={envelope_id or 'n/a'} "
        f"peers={len(peer_hashes)} queued={queued_count} "
        f"fanout_hashes={','.join(peer_hashes)}"
    )
    return queued_count == len(peer_hashes), queued_count


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
    signed_session_origin = _presence_route_bound_destination_hash(
        payload.get("sessionId")
    )

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
            if (
                signed_session_origin is not None
                and signed_session_origin != origin_peer_hash
            ):
                raise RuntimeError("Signed presence route does not match originalSenderHash")
            if (
                origin_peer_hash != local_sender_hash
                and signed_session_origin != origin_peer_hash
            ):
                wire["o"] = origin_peer_hash
    elif (
        signed_session_origin is not None
        and signed_session_origin != local_sender_hash
    ):
        raise RuntimeError("Signed presence route does not match local destination")
    if "status" in payload:
        wire["s"] = payload.get("status")
    if "clientVersion" in payload:
        wire["c"] = payload.get("clientVersion")
    if isinstance(overlay_hops_remaining, int) and overlay_hops_remaining >= 0:
        wire["q"] = overlay_hops_remaining
    wire_bytes = json.dumps(wire, separators=(",", ":")).encode("utf-8")
    if len(wire_bytes) > _MAX_ENCRYPTED_WIRE_BYTES:
        raise RuntimeError(
            f"Presence wire size {len(wire_bytes)} exceeds encrypted MDU "
            f"{_MAX_ENCRYPTED_WIRE_BYTES}"
        )
    return wire_bytes


def announce_local_destination(reason: str = "unspecified") -> None:
    if _destination is None:
        return
    with _state_lock:
        inbound_full = len(_inbound_overlay_neighbors) >= _OVERLAY_MAX_INBOUND_NEIGHBORS
    app_data = (
        _PRESENCE_ANNOUNCE_APP_DATA_FULL
        if inbound_full
        else _PRESENCE_ANNOUNCE_APP_DATA_OPEN
    )
    _destination.announce(app_data=app_data)
    log(
        "[presence_bridge] rns destination announce "
        f"at={_log_clock_time()} "
        f"reason={reason} inbound_full={'yes' if inbound_full else 'no'} "
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
        result, _send_duration_ms = _send_packet_to_destination_bounded(
            outbound,
            wire_bytes,
            f"target=presence-reticulum direct_presence_send peer={peer_hash}",
        )
        if peer_hash not in _peer_lifecycle:
            _peer_lifecycle[peer_hash] = {
                "last_seen_inbound": None,
                "last_send_ok": None,
                "last_request_path_at": None,
                "ts_seed_until": None,
            }
        st = _peer_lifecycle[peer_hash]
        if result is not True:
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
    _ensure_managed_link_fields(state, kind="audio", desired_state=_LINK_STATE_CONNECTING)
    if "send_lock" not in state:
        state["send_lock"] = threading.RLock()
    if "closing" not in state:
        state["closing"] = False
    if "consecutive_send_timeouts" not in state:
        state["consecutive_send_timeouts"] = 0
    if "send_timeout_backoff_until" not in state:
        state["send_timeout_backoff_until"] = 0.0
    if "media_send_seq" not in state:
        state["media_send_seq"] = 0
    if "media_rx_seq" not in state:
        state["media_rx_seq"] = 0
    if "last_media_send_trace_at" not in state:
        state["last_media_send_trace_at"] = 0.0
    if "last_media_rx_trace_at" not in state:
        state["last_media_rx_trace_at"] = 0.0
    if "rtt_next_probe_at" not in state:
        state["rtt_next_probe_at"] = 0.0
    if "rtt_probe_queued" not in state:
        state["rtt_probe_queued"] = False
    if not isinstance(state.get("rtt_pending"), dict):
        state["rtt_pending"] = {}
    if not isinstance(state.get("rtt_samples_ms"), deque):
        state["rtt_samples_ms"] = deque(maxlen=_AUDIO_RTT_SAMPLE_LIMIT)
    if "rtt_consecutive_timeouts" not in state:
        state["rtt_consecutive_timeouts"] = 0
    if "rtt_last_ack_at" not in state:
        state["rtt_last_ack_at"] = 0.0
    if "control_channel_supported" not in state:
        state["control_channel_supported"] = False
    if "control_channel_configured" not in state:
        state["control_channel_configured"] = False
    if "control_channel_last_probe_at" not in state:
        state["control_channel_last_probe_at"] = 0.0
    if "control_channel_probe_failed_until" not in state:
        state["control_channel_probe_failed_until"] = 0.0
    return state


def _reticulum_link_status_name(link: Any) -> str:
    if link is None:
        return "none"
    status = getattr(link, "status", None)
    try:
        status_int = int(status)
    except Exception:
        return str(status or "unknown")
    labels = {
        getattr(RNS.Link, "PENDING", object()): "PENDING",
        getattr(RNS.Link, "HANDSHAKE", object()): "HANDSHAKE",
        getattr(RNS.Link, "ACTIVE", object()): "ACTIVE",
        getattr(RNS.Link, "STALE", object()): "STALE",
        getattr(RNS.Link, "CLOSED", object()): "CLOSED",
    }
    return str(labels.get(status_int) or status_int)


def _audio_link_trace_should_log(state: Dict[str, Any], key: str, seq: int) -> bool:
    if seq <= 3 or seq % _AUDIO_LINK_TRACE_EVERY_FRAMES == 0:
        return True
    now = time.time()
    last = state.get(key)
    if not isinstance(last, (int, float)) or now - float(last) >= 10.0:
        state[key] = now
        return True
    return False


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


def _audio_link_state_is_viable(state: Optional[Dict[str, Any]], now: Optional[float] = None) -> bool:
    if state is None:
        return False
    if state.get("closing") is True or state.get("link") is None:
        return False
    if state.get("established") is True:
        return True
    created_at = state.get("created_at")
    if now is None:
        now = time.time()
    return isinstance(created_at, (int, float)) and (
        now - float(created_at)
    ) < _AUDIO_LINK_ESTABLISH_TIMEOUT_SECONDS


def _promote_audio_fallback_locked(peer_key: str, exclude_link_id: str = "") -> str:
    peer_key = str(peer_key or "").strip().lower()
    exclude_link_id = str(exclude_link_id or "").strip()
    if not peer_key:
        return ""
    best_link_id = ""
    best_state: Optional[Dict[str, Any]] = None
    for candidate_link_id, state in list(_audio_links_by_id.items()):
        if candidate_link_id == exclude_link_id:
            continue
        if str(state.get("peerPresenceHash") or "").strip().lower() != peer_key:
            continue
        if state.get("closing") is True or state.get("link") is None:
            continue
        if state.get("established") is not True:
            continue
        if not best_link_id or best_state is None:
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


def _teardown_audio_link_id(link_id: str, reason: str) -> None:
    state = get_audio_link_state(link_id)
    link = state.get("link") if state is not None else None
    if link is not None:
        try:
            link.set_link_closed_callback(None)
        except Exception:
            pass
        if state is not None:
            with _state_lock:
                _ensure_audio_link_lifecycle_fields(state)
                state["manager_state"] = _LINK_STATE_CLOSING
                state["last_failure_reason"] = reason
        completed, _result, error = _run_with_timeout(
            f"audio-link-teardown-{str(link_id or '')[:8]}",
            _AUDIO_LINK_TEARDOWN_TIMEOUT_SECONDS,
            link.teardown,
        )
        if not completed:
            log(
                "[presence_bridge] target=reticulum-audio-link audio_link_teardown_timeout "
                f"link={link_id} reason={reason} "
                f"timeout_ms={int(_AUDIO_LINK_TEARDOWN_TIMEOUT_SECONDS * 1000)}"
            )
        elif error:
            log(
                "[presence_bridge] target=reticulum-audio-link audio_link_teardown_exception "
                f"link={link_id} reason={reason} err={error}"
            )
    emit_audio_link_closed(link_id, reason)


def _enqueue_audio_link_teardown(link_id: str, reason: str) -> bool:
    link_key = str(link_id or "").strip()
    if not link_key:
        return False
    peer_key = ""
    detached = False
    promoted_link_id = ""
    already_closing = False
    with _state_lock:
        state = _audio_links_by_id.get(link_key)
        if state is None:
            return False
        _ensure_audio_link_lifecycle_fields(state)
        peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
        if peer_key:
            if _active_audio_link_id_by_peer_hash.get(peer_key) == link_key:
                _active_audio_link_id_by_peer_hash.pop(peer_key, None)
                detached = True
            if _outgoing_audio_link_id_by_peer_hash.get(peer_key) == link_key:
                _outgoing_audio_link_id_by_peer_hash.pop(peer_key, None)
                detached = True
            if detached:
                promoted_link_id = _promote_audio_fallback_locked(peer_key, link_key)
        if state.get("closing") is True:
            already_closing = True
        else:
            state["closing"] = True
            state["manager_state"] = _LINK_STATE_CLOSING
            state["last_failure_reason"] = reason
    if detached:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_active_detached "
            f"peer={peer_key} link={link_key} reason={reason} "
            f"promoted={promoted_link_id or 'none'}"
        )
    if already_closing:
        return True
    queued = bool(
        _enqueue_scheduler_task(
            "audio-control",
            f"audio-link-close:{reason}:{link_key[:8]}",
            _teardown_audio_link_id,
            link_key,
            reason,
            drop_oldest=False,
        )
    )
    if not queued:
        with _state_lock:
            state = _audio_links_by_id.get(link_key)
            if state is not None:
                state["closing"] = False
                state["manager_state"] = (
                    _LINK_STATE_ESTABLISHED
                    if state.get("established") is True
                    else _LINK_STATE_CONNECTING
                )
    return queued


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
        if state.get("established") is not True or state.get("closing") is True:
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            return state
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
        _enqueue_audio_link_teardown(lose_id, "dedup_same_peer")
    return keep_state


def _canonical_audio_link_id_for_peer(peer_key: str) -> str:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return ""
    with _state_lock:
        active = _active_audio_link_id_by_peer_hash.get(peer_key) or ""
        active_state = _audio_links_by_id.get(active) if active else None
        if (
            active_state is not None
            and active_state.get("closing") is not True
            and active_state.get("established") is True
        ):
            return active
        if active:
            _active_audio_link_id_by_peer_hash.pop(peer_key, None)
        outgoing = _outgoing_audio_link_id_by_peer_hash.get(peer_key) or ""
        outgoing_state = _audio_links_by_id.get(outgoing) if outgoing else None
        if (
            outgoing_state is not None
            and outgoing_state.get("closing") is not True
            and outgoing_state.get("established") is True
        ):
            _active_audio_link_id_by_peer_hash[peer_key] = outgoing
            return outgoing
    return ""


def _best_established_audio_link_id_for_peer(peer_key: str) -> str:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return ""
    best_link_id = ""
    best_state: Optional[Dict[str, Any]] = None
    with _state_lock:
        for candidate_link_id, state in list(_audio_links_by_id.items()):
            if str(state.get("peerPresenceHash") or "").strip().lower() != peer_key:
                continue
            if state.get("closing") is True or state.get("link") is None:
                continue
            if state.get("established") is not True:
                continue
            if not best_link_id or best_state is None:
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
            _outgoing_audio_link_id_by_peer_hash[peer_key] = best_link_id
            if best_state is not None and best_state.get("established") is True:
                _active_audio_link_id_by_peer_hash[peer_key] = best_link_id
    return best_link_id


def _snapshot_audio_link_for_send(
    link_id: str,
    peer_key_hint: str = "",
) -> Optional[Dict[str, Any]]:
    with _state_lock:
        requested_link_id = str(link_id or "")
        state = _audio_links_by_id.get(link_id)
        peer_key_hint = str(peer_key_hint or "").strip().lower()
        if state is None:
            canonical_id = _best_established_audio_link_id_for_peer(peer_key_hint)
            if not canonical_id:
                canonical_id = _active_audio_link_id_by_peer_hash.get(peer_key_hint) if peer_key_hint else ""
            if not canonical_id:
                canonical_id = _outgoing_audio_link_id_by_peer_hash.get(peer_key_hint) if peer_key_hint else ""
            if not canonical_id:
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_send_route_lookup_failed "
                    f"requested={requested_link_id or 'none'} peer_hint={_short_route(peer_key_hint)} "
                    "reason=no_canonical_link"
                )
                return None
            state = _audio_links_by_id.get(canonical_id)
            if state is None:
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_send_route_lookup_failed "
                    f"requested={requested_link_id or 'none'} peer_hint={_short_route(peer_key_hint)} "
                    f"canonical={canonical_id} reason=canonical_missing"
                )
                return None
            log(
                "[presence_bridge] target=reticulum-audio-link audio_send_route_substituted "
                f"requested={requested_link_id or 'none'} replacement={canonical_id} "
                f"peer_hint={_short_route(peer_key_hint)} reason=requested_missing"
            )
            link_id = canonical_id
        _ensure_audio_link_lifecycle_fields(state)
        if state.get("closing") is True:
            fallback_peer_key = str(state.get("peerPresenceHash") or peer_key_hint).strip().lower()
            fallback_id = _best_established_audio_link_id_for_peer(fallback_peer_key)
            if not fallback_id or fallback_id == link_id:
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_send_route_lookup_failed "
                    f"requested={requested_link_id or link_id or 'none'} peer_hint={_short_route(fallback_peer_key)} "
                    f"reason=closing_no_fallback closing={link_id}"
                )
                return None
            fallback_state = _audio_links_by_id.get(fallback_id)
            if fallback_state is None:
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_send_route_lookup_failed "
                    f"requested={requested_link_id or link_id or 'none'} peer_hint={_short_route(fallback_peer_key)} "
                    f"fallback={fallback_id} reason=fallback_missing"
                )
                return None
            log(
                "[presence_bridge] target=reticulum-audio-link audio_send_route_substituted "
                f"requested={requested_link_id or link_id or 'none'} replacement={fallback_id} "
                f"peer_hint={_short_route(fallback_peer_key)} reason=requested_closing"
            )
            state = fallback_state
            link_id = fallback_id
            _ensure_audio_link_lifecycle_fields(state)
        peer_key = str(state.get("peerPresenceHash") or peer_key_hint).strip().lower()
        canonical_id = _active_audio_link_id_by_peer_hash.get(peer_key) if peer_key else ""
        if canonical_id and canonical_id != link_id:
            canonical_state = _audio_links_by_id.get(canonical_id)
            if (
                canonical_state is not None
                and canonical_state.get("closing") is not True
                and canonical_state.get("established") is True
            ):
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_send_route_substituted "
                    f"requested={requested_link_id or link_id or 'none'} replacement={canonical_id} "
                    f"peer={_short_route(peer_key)} reason=active_canonical"
                )
                state = canonical_state
                link_id = canonical_id
                _ensure_audio_link_lifecycle_fields(state)
        if state.get("established") is not True:
            fallback_id = _best_established_audio_link_id_for_peer(peer_key)
            if fallback_id and fallback_id != link_id:
                fallback_state = _audio_links_by_id.get(fallback_id)
                if fallback_state is not None:
                    log(
                        "[presence_bridge] target=reticulum-audio-link audio_send_route_substituted "
                        f"requested={requested_link_id or link_id or 'none'} replacement={fallback_id} "
                        f"peer={_short_route(peer_key)} reason=requested_unestablished"
                    )
                    state = fallback_state
                    link_id = fallback_id
                    _ensure_audio_link_lifecycle_fields(state)
        if state.get("established") is not True:
            log(
                "[presence_bridge] target=reticulum-audio-link audio_send_route_not_ready "
                f"requested={requested_link_id or link_id or 'none'} link={link_id} "
                f"peer={_short_route(state.get('peerPresenceHash'))} "
                f"manager_state={state.get('manager_state') or 'unknown'} "
                f"established={str(state.get('established') is True).lower()} "
                f"closing={str(state.get('closing') is True).lower()}"
            )
            return {
                "ready": False,
                "linkId": link_id,
                "peerPresenceHash": str(state.get("peerPresenceHash") or ""),
                "reason": "audio_link_not_ready",
            }
        link = state.get("link")
        if link is None:
            log(
                "[presence_bridge] target=reticulum-audio-link audio_send_route_lookup_failed "
                f"requested={requested_link_id or link_id or 'none'} link={link_id} "
                f"peer={_short_route(state.get('peerPresenceHash'))} reason=missing_link_object"
            )
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


def _mark_audio_link_send_timeout(link_id: str, reason: str) -> None:
    link_key = str(link_id or "").strip()
    if not link_key:
        return
    now = time.time()
    peer_key = ""
    timeout_count = 1
    recent_rx = False
    with _state_lock:
        state = _audio_links_by_id.get(link_key)
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
            peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
            timeout_count = int(state.get("consecutive_send_timeouts") or 0) + 1
            state["consecutive_send_timeouts"] = timeout_count
            state["last_send_timeout_at"] = now
            state["send_timeout_backoff_until"] = now + _AUDIO_LINK_SEND_TIMEOUT_BACKOFF_SECONDS
            last_rx_at = state.get("last_rx_at")
            recent_rx = (
                isinstance(last_rx_at, (int, float))
                and now - float(last_rx_at) <= _AUDIO_LINK_SEND_TIMEOUT_RECENT_RX_GRACE_SECONDS
            )
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_send_timeout "
        f"link={link_key} peer={peer_key or 'unknown'} reason={reason} "
        f"timeout_ms={int(_AUDIO_LINK_PACKET_SEND_TIMEOUT_SECONDS * 1000)} "
        f"consecutive={timeout_count} recent_rx={str(recent_rx).lower()}"
    )
    if timeout_count >= _AUDIO_LINK_SEND_TIMEOUTS_BEFORE_TEARDOWN and not recent_rx:
        _enqueue_audio_link_teardown(link_key, f"{reason}_timeout")


def _run_with_timeout(name: str, timeout_seconds: float, fn: Callable[[], Any]) -> Tuple[bool, Any, Optional[str]]:
    done = threading.Event()
    result: Dict[str, Any] = {}

    def run() -> None:
        try:
            result["value"] = fn()
        except Exception as exc:
            result["error"] = str(exc)
        finally:
            done.set()

    thread = threading.Thread(target=run, name=name[:64], daemon=True)
    thread.start()
    if not done.wait(timeout_seconds):
        return False, None, None
    return True, result.get("value"), result.get("error")


def _teardown_reticulum_link_bounded(
    link: Any,
    log_target: str,
    timeout_seconds: float = _LINK_TEARDOWN_TIMEOUT_SECONDS,
) -> bool:
    if link is None:
        return True
    completed, _result, error = _run_with_timeout(
        f"link-teardown-{str(id(link))[-8:]}",
        timeout_seconds,
        link.teardown,
    )
    if not completed:
        log(
            f"[presence_bridge] {log_target} link_teardown_timeout "
            f"timeout_ms={int(timeout_seconds * 1000)}"
        )
        return False
    if error:
        log(f"[presence_bridge] {log_target} link_teardown_exception err={error}")
        return False
    return True


def _send_packet_to_destination_bounded(
    destination: Any,
    wire_bytes: bytes,
    log_target: str,
    timeout_seconds: float = _LINK_PACKET_SEND_TIMEOUT_SECONDS,
) -> Tuple[Optional[bool], float]:
    packet = RNS.Packet(destination, wire_bytes, create_receipt=False)
    send_start = time.monotonic()
    completed, result, error = _run_with_timeout(
        f"destination-packet-send-{str(id(destination))[-8:]}",
        timeout_seconds,
        packet.send,
    )
    send_duration_ms = _note_rns_send_duration(send_start)
    if not completed:
        log(
            f"[presence_bridge] {log_target} packet_send_timeout "
            f"timeout_ms={int(timeout_seconds * 1000)}"
        )
        return None, send_duration_ms
    if error:
        log(f"[presence_bridge] {log_target} packet_send_exception err={error}")
        return False, send_duration_ms
    return bool(result is not False), send_duration_ms


def _send_packet_on_audio_link_bounded(
    link_id: str,
    link: Any,
    wire_bytes: bytes,
    reason: str,
) -> Tuple[Optional[bool], float]:
    now = time.time()
    seq = 0
    peer_key = ""
    destination_key = ""
    incoming = False
    generation = 0
    should_trace = False
    with _state_lock:
        state = _audio_links_by_id.get(str(link_id or ""))
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
            backoff_until = state.get("send_timeout_backoff_until")
            if isinstance(backoff_until, (int, float)) and now < float(backoff_until):
                log(
                    "[presence_bridge] target=reticulum-audio-link audio_media_send_blocked "
                    f"link={link_id} reason=send_backoff status={_reticulum_link_status_name(link)} "
                    f"backoff_ms={int(max(0.0, float(backoff_until) - now) * 1000)}"
                )
                return None, 0.0
            state["media_send_seq"] = int(state.get("media_send_seq") or 0) + 1
            seq = int(state.get("media_send_seq") or 0)
            peer_key = str(state.get("peerPresenceHash") or "")
            destination_key = str(state.get("peerDestinationHash") or "")
            incoming = state.get("incoming") is True
            generation = int(state.get("generation") or 0)
            should_trace = _audio_link_trace_should_log(state, "last_media_send_trace_at", seq)
    packet = RNS.Packet(link, wire_bytes, create_receipt=False)
    packet_hash = getattr(packet, "packet_hash", None)
    packet_hash_hex = bytes(packet_hash).hex() if isinstance(packet_hash, (bytes, bytearray)) else ""
    if should_trace:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_send_attempt "
            f"link={link_id} seq={seq} bytes={len(wire_bytes)} reason={reason} "
            f"status={_reticulum_link_status_name(link)} incoming={str(incoming).lower()} "
            f"generation={generation} peer={_short_route(peer_key)} dest={_short_route(destination_key)} "
            f"packet={_short_route(packet_hash_hex)}"
        )
    send_start = time.monotonic()
    completed, result, error = _run_with_timeout(
        f"audio-packet-send-{str(link_id or '')[:8]}",
        _AUDIO_LINK_PACKET_SEND_TIMEOUT_SECONDS,
        packet.send,
    )
    send_duration_ms = _note_rns_send_duration(send_start)
    if not completed:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_send_timeout "
            f"link={link_id} seq={seq} duration_ms={send_duration_ms:.3f} "
            f"status={_reticulum_link_status_name(link)} packet={_short_route(packet_hash_hex)}"
        )
        _mark_audio_link_send_timeout(link_id, reason)
        return None, send_duration_ms
    if error:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_send_exception "
            f"link={link_id} seq={seq} duration_ms={send_duration_ms:.3f} "
            f"status={_reticulum_link_status_name(link)} packet={_short_route(packet_hash_hex)} "
            f"err={error}"
        )
        raise RuntimeError(error)
    if should_trace or result is False:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_send_result "
            f"link={link_id} seq={seq} ok={str(result is not False).lower()} "
            f"duration_ms={send_duration_ms:.3f} status={_reticulum_link_status_name(link)} "
            f"packet={_short_route(packet_hash_hex)}"
        )
    return bool(result is not False), send_duration_ms


def _send_audio_rtt_control(
    link_id: str,
    generation: int,
    command: str,
    correlation_id: str,
) -> bool:
    probe_id = _valid_overlay_correlation_id(correlation_id)
    if command not in (_GROUP_AUDIO_RTT_PROBE_COMMAND, _GROUP_AUDIO_RTT_ACK_COMMAND) or not probe_id:
        return False
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is None:
            return False
        _ensure_audio_link_lifecycle_fields(state)
        if (
            state.get("established") is not True
            or state.get("closing") is True
            or int(state.get("generation") or 0) != generation
        ):
            return False
        link = state.get("link")
        send_lock = state.get("send_lock")
    if link is None or send_lock is None or _destination is None:
        return False
    encoded = _encode_group_signal_wire(
        {
            "t": _GROUP_AUDIO_RTT_WIRE_TYPE,
            "c": command,
            "q": probe_id,
        }
    )
    if not encoded.get("ok"):
        return False
    with send_lock:
        if not _audio_link_generation_matches(link_id, generation):
            return False
        result, _send_duration_ms = _send_packet_to_destination_bounded(
            link,
            encoded["wire_bytes"],
            "target=reticulum-audio-link audio_rtt_control",
            timeout_seconds=_AUDIO_LINK_PACKET_SEND_TIMEOUT_SECONDS,
        )
    if result is True:
        with _state_lock:
            current = _audio_links_by_id.get(link_id)
            if current is not None and int(current.get("generation") or 0) == generation:
                current["last_activity_at"] = time.time()
        return True
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_rtt_send_failed "
        f"link={link_id} command={command} peer={_short_route(state.get('peerPresenceHash'))}"
    )
    return False


def _process_audio_rtt_probe(link_id: str, generation: int) -> None:
    now_ns = time.monotonic_ns()
    expired_probe_ids: List[Tuple[str, int]] = []
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is None:
            return
        _ensure_audio_link_lifecycle_fields(state)
        state["rtt_probe_queued"] = False
        if (
            state.get("established") is not True
            or state.get("closing") is True
            or int(state.get("generation") or 0) != generation
        ):
            return
        pending = state.get("rtt_pending")
        timeout_ns = int(_AUDIO_RTT_PROBE_TIMEOUT_SECONDS * 1_000_000_000)
        for pending_id, pending_state in list(pending.items()):
            sent_ns = int(pending_state.get("sent_ns") or 0)
            if sent_ns <= 0 or now_ns - sent_ns >= timeout_ns:
                pending.pop(pending_id, None)
                state["rtt_consecutive_timeouts"] = int(
                    state.get("rtt_consecutive_timeouts") or 0
                ) + 1
                expired_probe_ids.append(
                    (pending_id, int(state["rtt_consecutive_timeouts"]))
                )
        if pending:
            state["rtt_next_probe_at"] = time.monotonic() + 1.0
            return
        probe_id = secrets.token_hex(8)
        pending[probe_id] = {"sent_ns": now_ns}
        state["rtt_next_probe_at"] = time.monotonic() + _AUDIO_RTT_PROBE_INTERVAL_SECONDS
        peer_key = str(state.get("peerPresenceHash") or "")
    for expired_probe_id, timeout_count in expired_probe_ids:
        if timeout_count <= 3 or timeout_count % 12 == 0:
            log(
                "[presence_bridge] target=reticulum-audio-link audio_link_rtt_timeout "
                f"link={link_id} peer={_short_route(peer_key)} probe={expired_probe_id} "
                f"consecutive={timeout_count}"
            )
    if _send_audio_rtt_control(
        link_id,
        generation,
        _GROUP_AUDIO_RTT_PROBE_COMMAND,
        probe_id,
    ):
        return
    with _state_lock:
        current = _audio_links_by_id.get(link_id)
        if current is not None and int(current.get("generation") or 0) == generation:
            current.get("rtt_pending", {}).pop(probe_id, None)


def _resolve_audio_rtt_probe(
    link_id: str,
    state: Dict[str, Any],
    correlation_id: Any,
) -> Optional[float]:
    probe_id = _valid_overlay_correlation_id(correlation_id)
    if not probe_id:
        return None
    with _state_lock:
        pending = state.get("rtt_pending", {}).pop(probe_id, None)
        if not isinstance(pending, dict):
            return None
        sent_ns = int(pending.get("sent_ns") or 0)
        if sent_ns <= 0:
            return None
        rtt_ms = max(0.0, (time.monotonic_ns() - sent_ns) / 1_000_000.0)
        samples = state.get("rtt_samples_ms")
        if not isinstance(samples, deque):
            samples = deque(maxlen=_AUDIO_RTT_SAMPLE_LIMIT)
            state["rtt_samples_ms"] = samples
        samples.append(rtt_ms)
        sample_values = list(samples)
        state["rtt_latest_ms"] = rtt_ms
        state["rtt_median_ms"] = float(statistics.median(sample_values))
        state["rtt_consecutive_timeouts"] = 0
        peer_key = str(state.get("peerPresenceHash") or "")
        handshake_ms = state.get("rtt_handshake_ms")
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_rtt "
        f"link={link_id} peer={_short_route(peer_key)} rtt_ms={rtt_ms:.3f} "
        f"median_ms={statistics.median(sample_values):.3f} samples={len(sample_values)} "
        f"handshake_ms={f'{float(handshake_ms):.3f}' if isinstance(handshake_ms, (int, float)) else 'na'}"
    )
    return rtt_ms


def _activate_audio_rtt_sampling(link_id: str) -> None:
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is None or state.get("established") is not True or state.get("closing") is True:
            return
        _ensure_audio_link_lifecycle_fields(state)
        if float(state.get("rtt_next_probe_at") or 0.0) <= 0.0:
            state["rtt_next_probe_at"] = time.monotonic() + _AUDIO_RTT_PROBE_INTERVAL_SECONDS
        link = state.get("link")
        link_rtt = getattr(link, "rtt", None) if link is not None else None
        if isinstance(link_rtt, (int, float)) and link_rtt >= 0:
            state["rtt_handshake_ms"] = float(link_rtt) * 1000.0


def audio_rtt_monitor_loop() -> None:
    while not _shutdown.is_set():
        now = time.monotonic()
        due: List[Tuple[str, int]] = []
        with _state_lock:
            for link_id, state in list(_audio_links_by_id.items()):
                _ensure_audio_link_lifecycle_fields(state)
                if state.get("established") is not True or state.get("closing") is True:
                    continue
                next_probe_at = float(state.get("rtt_next_probe_at") or 0.0)
                if next_probe_at <= 0.0:
                    state["rtt_next_probe_at"] = now + _AUDIO_RTT_PROBE_INTERVAL_SECONDS
                    continue
                if now < next_probe_at or state.get("rtt_probe_queued") is True:
                    continue
                state["rtt_probe_queued"] = True
                due.append((link_id, int(state.get("generation") or 0)))
        for link_id, generation in due:
            if _enqueue_scheduler_task(
                "audio-rtt",
                f"audio-rtt-probe:{link_id[:8]}",
                _process_audio_rtt_probe,
                link_id,
                generation,
            ):
                continue
            with _state_lock:
                state = _audio_links_by_id.get(link_id)
                if state is not None and int(state.get("generation") or 0) == generation:
                    state["rtt_probe_queued"] = False
                    state["rtt_next_probe_at"] = now + 1.0
        _shutdown.wait(_AUDIO_RTT_MONITOR_INTERVAL_SECONDS)


def ensure_audio_rtt_monitor_started() -> None:
    global _audio_rtt_monitor_thread
    if _audio_rtt_monitor_thread is not None and _audio_rtt_monitor_thread.is_alive():
        return
    _audio_rtt_monitor_thread = threading.Thread(
        target=audio_rtt_monitor_loop,
        daemon=True,
        name="reticulum-audio-rtt-monitor",
    )
    _audio_rtt_monitor_thread.start()


def remove_audio_link(link_id: str) -> Optional[Dict[str, Any]]:
    with _state_lock:
        state = _audio_links_by_id.pop(link_id, None)
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
            state["closing"] = True
            state["manager_state"] = _LINK_STATE_DEAD
            state["generation"] = int(state.get("generation") or 0) + 1
            state["rtt_probe_queued"] = False
            state.get("rtt_pending", {}).clear()
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
    link = state.get("link")
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_removed "
        f"link={link_id} peer={_short_route(state.get('peerPresenceHash'))} "
        f"dest={_short_route(state.get('peerDestinationHash'))} "
        f"incoming={str(state.get('incoming') is True).lower()} "
        f"established={str(state.get('established') is True).lower()} "
        f"closing={str(state.get('closing') is True).lower()} "
        f"manager_state={state.get('manager_state') or 'unknown'} "
        f"generation={int(state.get('generation') or 0)} "
        f"media_send_seq={int(state.get('media_send_seq') or 0)} "
        f"media_rx_seq={int(state.get('media_rx_seq') or 0)} "
        f"rns_status={_reticulum_link_status_name(link)} "
        f"teardown_reason={getattr(link, 'teardown_reason', None)}"
    )
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
            "last_recovery_rearm_at": 0.0,
            "max_attempts_emitted": False,
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
        was_desired = state.get("desired") is True
        state["desired"] = desired
        if desired and not was_desired:
            state["max_attempts_emitted"] = False
        elif not desired:
            state["attempts"] = 0
            state["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
            state["last_failure_reason"] = ""
            state["max_attempts_emitted"] = False
    if desired:
        return state
    _cancel_audio_link_retry_timer(peer_key)
    return state


def _audio_link_attempts_exhausted(desired: Optional[Dict[str, Any]]) -> bool:
    if desired is None:
        return False
    return int(desired.get("attempts") or 0) >= _AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS


def _maybe_rearm_audio_link_attempts_for_active_call(
    peer_key: str,
    desired: Dict[str, Any],
    reason: str,
) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key or desired.get("desired") is not True:
        return False
    now = time.time()
    with _state_lock:
        attempts = int(desired.get("attempts") or 0)
        if attempts < _AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS:
            return False
        last_open_attempt_at = desired.get("last_open_attempt_at")
        if isinstance(last_open_attempt_at, (int, float)) and (
            now - float(last_open_attempt_at)
        ) < _AUDIO_LINK_ACTIVE_CALL_REARM_SECONDS:
            return False
        desired["attempts"] = 0
        desired["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
        desired["last_failure_reason"] = reason
        desired["max_attempts_emitted"] = False
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_active_call_rearmed "
        f"peer={peer_key} reason={reason} previous_attempts={attempts}"
    )
    return True


def _rearm_audio_link_recovery(peer_key: str, reason: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    if _has_viable_audio_link_for_peer(peer_key):
        return False
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
        if desired is None or desired.get("desired") is not True:
            return False
        now = time.time()
        last_rearm_at = desired.get("last_recovery_rearm_at")
        if isinstance(last_rearm_at, (int, float)) and (
            now - float(last_rearm_at)
        ) < _AUDIO_LINK_RECOVERY_REARM_DEBOUNCE_SECONDS:
            return False
        attempts = int(desired.get("attempts") or 0)
        was_exhausted = attempts >= _AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS
        desired["attempts"] = 0
        desired["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
        desired["last_failure_reason"] = reason
        desired["max_attempts_emitted"] = False
        desired["last_recovery_rearm_at"] = now
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_recovery_rearmed "
        f"peer={peer_key} reason={reason} previous_attempts={attempts} "
        f"was_exhausted={str(was_exhausted).lower()}"
    )
    _schedule_audio_link_retry(peer_key, reason, immediate=True)
    return True


def _audio_link_should_force_path_refresh(peer_key: str, retry_reason: str) -> bool:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return False
    reason = str(retry_reason or "").strip().lower()
    if reason in {
        "establish_timeout",
        "send_timeout_teardown",
        "audio_link_send_timeout",
    }:
        return True
    state = _get_call_media_state(peer_key)
    path_state = str(state.get("path_state") or "").strip().lower()
    if path_state in {"failing", "recovering"}:
        return True
    return int(state.get("consecutive_timeouts") or 0) >= _AUDIO_LINK_FORCE_PATH_REFRESH_TIMEOUTS


def _emit_audio_link_attempts_exhausted(peer_key: str, reason: str, desired: Dict[str, Any]) -> None:
    attempts = int(desired.get("attempts") or 0)
    with _state_lock:
        if desired.get("max_attempts_emitted") is True:
            return
        desired["last_failure_reason"] = "max_establish_attempts"
        desired["retry_timer"] = None
        desired["max_attempts_emitted"] = True
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_max_establish_attempts "
        f"peer={peer_key} attempts={attempts} max={_AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS} reason={reason}"
    )
    emit_event(
        "group_audio_send_failed",
        {
            "linkId": "",
            "peerPresenceHash": peer_key,
            "reason": "max_establish_attempts",
            "code": "max_establish_attempts",
            "transport": "link",
            "attempts": attempts,
            "maxAttempts": _AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS,
        },
    )


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
            _outgoing_audio_link_id_by_peer_hash[peer_key] = best_link_id
            if best_state is not None and best_state.get("established") is True:
                _active_audio_link_id_by_peer_hash[peer_key] = best_link_id
    return best_link_id


def _schedule_audio_link_retry(peer_key: str, reason: str, immediate: bool = False) -> None:
    peer_key = str(peer_key or "").strip().lower()
    if not peer_key:
        return
    with _state_lock:
        desired = _audio_link_desired_by_peer_hash.get(peer_key)
    if desired is None or desired.get("desired") is not True:
        return
    if _audio_link_attempts_exhausted(desired):
        _emit_audio_link_attempts_exhausted(peer_key, reason, desired)
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
        if _audio_link_attempts_exhausted(desired_state):
            _emit_audio_link_attempts_exhausted(peer_key, reason, desired_state)
            return
        if _has_viable_audio_link_for_peer(peer_key):
            return
        _enqueue_scheduler_task(
            "audio-control",
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
            "audio-control",
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
    _teardown_audio_link_id(link_id, "establish_timeout")
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_establish_timeout "
        f"peer={peer_key} link={link_id}"
    )
    _schedule_audio_link_retry(peer_key, "establish_timeout")


def _open_group_audio_link_for_peer(
    peer_key: str,
    *,
    retry_reason: str = "open",
    active_call: bool = False,
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
        if _audio_link_state_is_viable(existing):
            return True, {
                "linkId": existing_link_id,
                "established": existing.get("established") is True,
            }, ""
        should_close_existing = False
        with _state_lock:
            if _outgoing_audio_link_id_by_peer_hash.get(peer_key) == existing_link_id:
                _outgoing_audio_link_id_by_peer_hash.pop(peer_key, None)
            if _active_audio_link_id_by_peer_hash.get(peer_key) == existing_link_id:
                _active_audio_link_id_by_peer_hash.pop(peer_key, None)
            existing = _audio_links_by_id.get(existing_link_id)
            if existing is not None:
                _ensure_audio_link_lifecycle_fields(existing)
                should_close_existing = existing.get("closing") is not True
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_reuse_rejected "
            f"peer={peer_key} link={existing_link_id} reason={retry_reason} "
            f"closing={str(existing.get('closing') is True if existing is not None else False).lower()} "
            f"established={str(existing.get('established') is True if existing is not None else False).lower()}"
        )
        if should_close_existing:
            _enqueue_audio_link_teardown(existing_link_id, f"replace_nonviable:{retry_reason}")
    viable_link_id = _best_viable_audio_link_id_for_peer(peer_key)
    if viable_link_id:
        existing = get_audio_link_state(viable_link_id)
        return True, {
            "linkId": viable_link_id,
            "established": existing.get("established") is True if existing is not None else False,
        }, ""
    if _audio_link_attempts_exhausted(desired) and not (
        active_call
        and _maybe_rearm_audio_link_attempts_for_active_call(
            peer_key,
            desired,
            f"active_call:{retry_reason}",
        )
    ):
        _emit_audio_link_attempts_exhausted(peer_key, retry_reason, desired)
        return False, {
            "code": "max_establish_attempts",
            "attempts": int(desired.get("attempts") or 0),
            "maxAttempts": _AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS,
        }, "Max group audio link establish attempts reached"
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
        force_path_refresh = _audio_link_should_force_path_refresh(peer_key, retry_reason)
        if force_path_refresh:
            media_state = _get_call_media_state(peer_key)
            log(
                "[presence_bridge] target=reticulum-audio-link audio_link_force_path_refresh "
                f"peer={peer_key} reason={retry_reason} "
                f"path_state={media_state.get('path_state') or 'unknown'} "
                f"consecutive_timeouts={int(media_state.get('consecutive_timeouts') or 0)}"
            )
        path_state, path_ready = _ensure_call_media_path(
            peer_key,
            outbound.hash,
            active_call=True,
            allow_wait=True,
            reason=f"open_link:{retry_reason}",
            await_seconds_override=_AUDIO_LINK_OPEN_PATH_AWAIT_SECONDS,
            force_refresh_cached_path=force_path_refresh,
            nudge_cached_path=not force_path_refresh,
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
        try:
            link = RNS.Link(
                outbound,
                established_callback=on_outgoing_audio_link_established,
                closed_callback=on_audio_link_closed,
            )
        except TypeError:
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
            "manager_kind": "audio",
            "manager_state": _LINK_STATE_CONNECTING,
            "generation": 0,
            "last_failure_reason": "",
            "backoff_until": 0.0,
        }
        _ensure_audio_link_lifecycle_fields(audio_state)
        with _state_lock:
            _audio_links_by_id[link_id] = audio_state
            _audio_link_ids_by_object[id(link)] = link_id
            _outgoing_audio_link_id_by_peer_hash[peer_key] = link_id
            _set_link_manager_generation(link, audio_state)
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
            "managerState": str(state.get("manager_state") or ""),
            "generation": int(state.get("generation") or 0),
        },
    )


def emit_audio_link_closed(link_id: str, reason: str = "") -> None:
    state = remove_audio_link(link_id)
    if state is None:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_closed_unknown "
            f"link={link_id} reason={reason}"
        )
        return
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_closed_emit "
        f"link={link_id} reason={reason} peer={_short_route(state.get('peerPresenceHash'))} "
        f"dest={_short_route(state.get('peerDestinationHash'))} "
        f"incoming={str(state.get('incoming') is True).lower()} "
        f"media_send_seq={int(state.get('media_send_seq') or 0)} "
        f"media_rx_seq={int(state.get('media_rx_seq') or 0)}"
    )
    emit_event(
        "group_audio_link_closed",
        {
            "linkId": link_id,
            "peerPresenceHash": state.get("peerPresenceHash") or "",
            "peerDestinationHash": state.get("peerDestinationHash") or "",
            "incoming": state.get("incoming") is True,
            "reason": reason,
            "managerState": str(state.get("manager_state") or ""),
            "generation": int(state.get("generation") or 0),
        },
    )


def on_audio_link_closed(link) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_closed_unmapped "
            f"rns_status={_reticulum_link_status_name(link)} "
            f"teardown_reason={getattr(link, 'teardown_reason', None)}"
        )
        return
    if not _link_manager_generation_current("audio", link_id, link):
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_closed_stale_generation "
            f"link={link_id} rns_status={_reticulum_link_status_name(link)} "
            f"teardown_reason={getattr(link, 'teardown_reason', None)}"
        )
        return
    state = get_audio_link_state(link_id)
    peer_key = ""
    incoming = False
    was_established = False
    if state is not None:
        peer_key = str(state.get("peerPresenceHash") or "").strip().lower()
        incoming = state.get("incoming") is True
        was_established = state.get("established") is True
    teardown_reason = getattr(link, "teardown_reason", None)
    reason = str(teardown_reason) if teardown_reason is not None else "closed"
    _maybe_request_path_after_unestablished_link_close(
        state,
        link,
        target="reticulum-audio-link",
        reason=reason,
    )
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_closed_callback "
        f"link={link_id} reason={reason} peer={_short_route(peer_key)} "
        f"incoming={str(incoming).lower()} rns_status={_reticulum_link_status_name(link)}"
    )
    emit_audio_link_closed(link_id, reason)
    if reason not in ("local_close", "peer_state_reset") and not _has_viable_audio_link_for_peer(peer_key):
        recovery_reason = f"closed:{reason}"
        if was_established:
            _rearm_audio_link_recovery(peer_key, recovery_reason)
        elif not incoming:
            _schedule_audio_link_retry(peer_key, recovery_reason)


def on_audio_link_remote_identified(link, identity) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    if not _link_manager_generation_current("audio", link_id, link):
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


def _handle_audio_link_packet(message, packet) -> None:
    received_at_wall_ms = _now_wall_ms()
    callback_started_monotonic = time.monotonic()
    link = getattr(packet, "link", None)
    link_id = get_audio_link_id(link) if link is not None else None
    if link_id is None:
        packet_hash = getattr(packet, "packet_hash", None)
        packet_hash_hex = bytes(packet_hash).hex() if isinstance(packet_hash, (bytes, bytearray)) else ""
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_rx_unmapped "
            f"status={_reticulum_link_status_name(link)} packet={_short_route(packet_hash_hex)} "
            f"bytes={len(message) if isinstance(message, (bytes, bytearray)) else 0}"
        )
        return
    if link is not None and not _link_manager_generation_current("audio", link_id, link):
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_rx_stale_generation "
            f"link={link_id} status={_reticulum_link_status_name(link)}"
        )
        return
    state = get_audio_link_state(link_id)
    if state is None:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_media_rx_unknown_state "
            f"link={link_id} status={_reticulum_link_status_name(link)}"
        )
        return
    probe = _audio_link_receive_probe_by_packet_id.pop(id(packet), None)
    if isinstance(probe, dict):
        _note_audio_stage_counter(
            "callback_start",
            link_id=link_id,
            destination_hash=str(state.get("peerDestinationHash") or ""),
            packet_hash=str(probe.get("packetHash") or ""),
            byte_count=len(message) if isinstance(message, (bytes, bytearray)) else 0,
            wall_ms=received_at_wall_ms,
        )
        stats = _get_audio_route_stats_for_link_id(
            link_id,
            incoming=state.get("incoming") is True,
        )
        if stats is not None:
            dispatch_mono = float(probe.get("callbackDispatchMonotonic") or 0.0)
            enter_mono = float(probe.get("receiveEnterMonotonic") or 0.0)
            probe_packet_hash = str(probe.get("packetHash") or "")
            if dispatch_mono > 0:
                dispatch_to_start_ms = (callback_started_monotonic - dispatch_mono) * 1000.0
                if dispatch_to_start_ms >= _AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS:
                    _log_audio_timing_anomaly(
                        "rns-link-callback-start-delay",
                        link_id,
                        f"link={_short_route(link_id)} delay_ms={dispatch_to_start_ms:.3f} "
                        f"peer={_short_route(state.get('peerPresenceHash'))} "
                        f"dest={_short_route(state.get('peerDestinationHash'))} "
                        f"packet={_short_route(probe_packet_hash)}",
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
                        f"dest={_short_route(state.get('peerDestinationHash'))} "
                        f"packet={_short_route(probe_packet_hash)}",
                    )
                _note_audio_route_bucketed_duration(
                    stats,
                    duration_ms=receive_to_start_ms,
                    max_key="linkReceiveToCallbackStartMsMax",
                )
            _mark_audio_queue_state_dirty()
    else:
        packet_hash = getattr(packet, "packet_hash", None)
        packet_hash_hex = bytes(packet_hash).hex() if isinstance(packet_hash, (bytes, bytearray)) else ""
        _note_audio_stage_counter(
            "callback_start",
            link_id=link_id,
            destination_hash=str(state.get("peerDestinationHash") or ""),
            packet_hash=packet_hash_hex,
            byte_count=len(message) if isinstance(message, (bytes, bytearray)) else 0,
            wall_ms=received_at_wall_ms,
        )
    decoded_audio = _decode_group_audio_wire(message)
    if decoded_audio is not None:
        room_id, sender_call_hash, raw_audio = decoded_audio
        with _state_lock:
            state_for_trace = _audio_links_by_id.get(link_id)
            if state_for_trace is not None:
                _ensure_audio_link_lifecycle_fields(state_for_trace)
                state_for_trace["media_rx_seq"] = int(state_for_trace.get("media_rx_seq") or 0) + 1
                rx_seq = int(state_for_trace.get("media_rx_seq") or 0)
                rx_should_trace = _audio_link_trace_should_log(
                    state_for_trace,
                    "last_media_rx_trace_at",
                    rx_seq,
                )
            else:
                rx_seq = 0
                rx_should_trace = True
        if rx_should_trace:
            packet_hash = getattr(packet, "packet_hash", None)
            packet_hash_hex = bytes(packet_hash).hex() if isinstance(packet_hash, (bytes, bytearray)) else ""
            log(
                "[presence_bridge] target=reticulum-audio-link audio_media_rx_callback "
                f"link={link_id} seq={rx_seq} room={room_id or 'n/a'} "
                f"bytes={len(raw_audio)} status={_reticulum_link_status_name(link)} "
                f"incoming={str(state.get('incoming') is True).lower()} "
                f"generation={int(state.get('generation') or 0)} "
                f"peer={_short_route(state.get('peerPresenceHash'))} "
                f"dest={_short_route(sender_call_hash or state.get('peerDestinationHash'))} "
                f"packet={_short_route(packet_hash_hex)}"
            )
        if sender_call_hash:
            peer_presence_hash = _resolve_sender_peer_destination_hash(sender_call_hash)
            with _state_lock:
                state["peerDestinationHash"] = sender_call_hash
                if peer_presence_hash:
                    state["peerPresenceHash"] = peer_presence_hash
                state["last_rx_at"] = time.time()
                state["last_activity_at"] = state["last_rx_at"]
                state["consecutive_send_timeouts"] = 0
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
            frame_kind, _control_type = _inspect_gcall_audio_payload(raw_audio)
            direct_ok = False
            if frame_kind == "media":
                direct_ok = _try_group_audio_forward_fast_path(
                    room_id,
                    link_id,
                    str(state.get("peerPresenceHash") or ""),
                    str(state.get("peerDestinationHash") or sender_call_hash or ""),
                    received_at_wall_ms,
                    raw_audio,
                    chunk,
                )
                if not direct_ok and _audio_data_plane_should_take_inbound_media(room_id):
                    direct_ok = _audio_data_plane_broadcast_inbound_audio(chunk)
            fd4_ok = direct_ok or _emit_binary_audio(chunk)
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
    command = str(decoded.get("c") or "")
    if (
        decoded.get("t") == _GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE
        and command
        in (
            _GROUP_AUDIO_CONTROL_CAPABILITY_HELLO,
            _GROUP_AUDIO_CONTROL_CAPABILITY_ACK,
        )
    ):
        with _state_lock:
            state["control_channel_supported"] = True
            state["control_channel_probe_failed_until"] = 0.0
            state["last_rx_at"] = time.time()
            state["last_activity_at"] = state["last_rx_at"]
        if command == _GROUP_AUDIO_CONTROL_CAPABILITY_HELLO:
            _enqueue_scheduler_task(
                _gcall_control_scheduler_lane(link_id),
                f"gcall-control-capability-ack:{link_id}",
                _send_group_audio_control_capability,
                link_id,
                _GROUP_AUDIO_CONTROL_CAPABILITY_ACK,
            )
        return
    if (
        decoded.get("t") == _GROUP_AUDIO_RTT_WIRE_TYPE
        and command in (_GROUP_AUDIO_RTT_PROBE_COMMAND, _GROUP_AUDIO_RTT_ACK_COMMAND)
    ):
        probe_id = _valid_overlay_correlation_id(decoded.get("q"))
        if not probe_id:
            return
        sender_call_hash = str(decoded.get("r") or "").strip().lower()
        peer_presence_hash = _resolve_sender_peer_destination_hash(sender_call_hash)
        with _state_lock:
            if sender_call_hash:
                state["peerDestinationHash"] = sender_call_hash
            if peer_presence_hash:
                state["peerPresenceHash"] = peer_presence_hash
            state["last_rx_at"] = time.time()
            state["last_activity_at"] = state["last_rx_at"]
            generation = int(state.get("generation") or 0)
            if command == _GROUP_AUDIO_RTT_PROBE_COMMAND:
                now_monotonic = time.monotonic()
                last_ack_at = float(state.get("rtt_last_ack_at") or 0.0)
                if now_monotonic - last_ack_at < _AUDIO_RTT_ACK_MIN_INTERVAL_SECONDS:
                    return
                state["rtt_last_ack_at"] = now_monotonic
        if peer_presence_hash:
            _register_active_audio_for_peer(peer_presence_hash, link_id)
        if command == _GROUP_AUDIO_RTT_ACK_COMMAND:
            _resolve_audio_rtt_probe(link_id, state, probe_id)
            return
        if not _enqueue_scheduler_task(
            "audio-rtt",
            f"audio-rtt-ack:{link_id[:8]}",
            _send_audio_rtt_control,
            link_id,
            generation,
            _GROUP_AUDIO_RTT_ACK_COMMAND,
            probe_id,
        ):
            log(
                "[presence_bridge] target=reticulum-audio-link audio_link_rtt_ack_queue_full "
                f"link={link_id} peer={_short_route(state.get('peerPresenceHash'))}"
            )
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
                state["consecutive_send_timeouts"] = 0
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


def on_audio_link_packet(message, packet) -> None:
    started_at = time.monotonic()
    try:
        _handle_audio_link_packet(message, packet)
    finally:
        _note_callback_duration("audio", started_at, message)


class _GroupAudioControlPacketProxy:
    def __init__(self, link: Any):
        self.link = link
        self.packet_hash = None


def _send_group_audio_control_capability(
    link_id: str,
    command: str = _GROUP_AUDIO_CONTROL_CAPABILITY_HELLO,
) -> bool:
    if command not in (
        _GROUP_AUDIO_CONTROL_CAPABILITY_HELLO,
        _GROUP_AUDIO_CONTROL_CAPABILITY_ACK,
    ):
        return False
    deadline = time.monotonic() + 2.0
    while not _shutdown.is_set():
        state = get_audio_link_state(link_id)
        if state is None or state.get("closing") is True:
            return False
        if state.get("established") is not True:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.01)
            continue
        link = state.get("link")
        if link is None or not _link_manager_generation_current("audio", link_id, link):
            return False
        encoded = _encode_group_signal_wire(
            {
                "t": _GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE,
                "c": command,
            }
        )
        if not encoded.get("ok"):
            return False
        try:
            result, _duration_ms = _send_packet_on_audio_link_bounded(
                link_id,
                link,
                encoded["wire_bytes"],
                "gcall_control_capability",
            )
            return result is True
        except Exception:
            return False
    return False


def _send_group_audio_control_channel_message(
    link_id: str,
    kind: int,
    data: bytes = b"",
    wait_seconds: float = 2.0,
) -> bool:
    deadline = time.monotonic() + max(0.05, wait_seconds)
    while not _shutdown.is_set():
        state = get_audio_link_state(link_id)
        if state is None or state.get("closing") is True:
            return False
        if state.get("established") is not True:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.01)
            continue
        link = state.get("link")
        channel = state.get("control_channel")
        if link is None or channel is None or not _link_manager_generation_current("audio", link_id, link):
            return False
        try:
            if channel.is_ready_to_send():
                message = GroupAudioControlChannelMessage(kind, data)
                if len(message.pack()) > int(channel.mdu):
                    return False
                channel.send(message)
                return True
        except Exception as exc:
            log(
                "[presence_bridge] target=gcall-control-channel send_failed "
                f"link={link_id} kind={kind} err={str(exc)[:160]}"
            )
            return False
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.01)
    return False


def _send_group_audio_control_bundle(
    link_id: str,
    room_id: str,
    payload: bytes,
    signal_type: str,
    signal_id: str,
) -> None:
    state = get_audio_link_state(link_id)
    channel = (state or {}).get("control_channel")
    if state is None or channel is None:
        return
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    digest = hashlib.sha256(payload).hexdigest()

    def encode_frame(frame: Dict[str, Any]) -> Optional[bytes]:
        raw = _GC_LINK_CONTROL_MAGIC + _call_wire_json_bytes(frame)
        try:
            wire = make_group_audio_wire(room_id, raw)
            message = GroupAudioControlChannelMessage(
                _GROUP_AUDIO_CONTROL_CHANNEL_DATA,
                wire,
            )
            return raw if len(message.pack()) <= int(channel.mdu) else None
        except Exception:
            return None

    # Use the real negotiated Channel MDU instead of the conservative packet
    # JSON limit used by the legacy lossy path. A worst-case fragment/count is
    # used for the search so every generated GO1 frame is guaranteed to fit.
    low = 1
    high = min(_GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENT_CHARS, len(encoded))
    chunk_chars = 0
    while low <= high:
        middle = (low + high) // 2
        probe = encode_frame(
            {
                "t": "GO1",
                "R": room_id,
                "z": digest,
                "n": _GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENTS,
                "x": _GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENTS - 1,
                "p": "A" * middle,
            }
        )
        if probe is not None:
            chunk_chars = middle
            low = middle + 1
        else:
            high = middle - 1
    if chunk_chars <= 0:
        log(
            "[presence_bridge] target=gcall-control-channel fragment_budget_failed "
            f"link={link_id} room={room_id} signal={signal_type}"
        )
        return
    part_count = (len(encoded) + chunk_chars - 1) // chunk_chars
    if part_count < 1 or part_count > _GROUP_AUDIO_CONTROL_CHANNEL_MAX_FRAGMENTS:
        log(
            "[presence_bridge] target=gcall-control-channel fragment_count_invalid "
            f"link={link_id} room={room_id} signal={signal_type} parts={part_count}"
        )
        return
    frames: List[bytes] = []
    start_frame = encode_frame(
        {"t": "GO0", "R": room_id, "z": digest, "n": part_count}
    )
    if start_frame is None:
        return
    frames.append(start_frame)
    for index in range(part_count):
        frame = encode_frame(
            {
                "t": "GO1",
                "R": room_id,
                "z": digest,
                "n": part_count,
                "x": index,
                "p": encoded[
                    index * chunk_chars : (index + 1) * chunk_chars
                ],
            }
        )
        if frame is None:
            log(
                "[presence_bridge] target=gcall-control-channel fragment_encode_failed "
                f"link={link_id} room={room_id} signal={signal_type} index={index}"
            )
            return
        frames.append(frame)

    sent = 0
    started_at = time.monotonic()
    for frame in frames:
        wire = make_group_audio_wire(room_id, frame)
        if not _send_group_audio_control_channel_message(
            link_id,
            _GROUP_AUDIO_CONTROL_CHANNEL_DATA,
            wire,
            wait_seconds=6.0,
        ):
            log(
                "[presence_bridge] target=gcall-control-channel bundle_send_failed "
                f"link={link_id} room={room_id} signal={signal_type} "
                f"id={signal_id[:12]} sent={sent} total={len(frames)}"
            )
            return
        sent += 1
    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    log(
        "[presence_bridge] target=gcall-control-channel bundle_queued "
        f"link={link_id} room={room_id} signal={signal_type} id={signal_id[:12]} "
        f"frames={sent} chunk_chars={chunk_chars} duration_ms={elapsed_ms}"
    )


def _send_group_audio_control_bundle_task(
    link_id: str,
    room_id: str,
    payload: bytes,
    signal_type: str,
    signal_id: str,
    dedupe_key: str,
) -> None:
    try:
        _send_group_audio_control_bundle(
            link_id,
            room_id,
            payload,
            signal_type,
            signal_id,
        )
    finally:
        if dedupe_key:
            with _state_lock:
                _group_audio_control_pending_dedupe.discard(dedupe_key)


def _handle_group_audio_control_channel_message(link: Any, message: Any) -> bool:
    if not isinstance(message, GroupAudioControlChannelMessage):
        return False
    link_id = get_audio_link_id(link)
    if link_id is None or not _link_manager_generation_current("audio", link_id, link):
        return True
    state = get_audio_link_state(link_id)
    if state is None:
        return True
    with _state_lock:
        state["last_activity_at"] = time.time()
    if message.kind != _GROUP_AUDIO_CONTROL_CHANNEL_DATA or not message.data:
        return True
    # Reuse the existing authenticated-link receive path. Signature, account,
    # room and selected-device validation still happens in GroupCallManager.
    _handle_audio_link_packet(
        message.data,
        _GroupAudioControlPacketProxy(link),
    )
    return True


def _configure_group_audio_control_channel(link: Any, link_id: str) -> None:
    state = get_audio_link_state(link_id)
    if state is None:
        return
    with _state_lock:
        _ensure_audio_link_lifecycle_fields(state)
        if state.get("control_channel_configured") is True:
            return
    try:
        channel = link.get_channel()
        channel.register_message_type(GroupAudioControlChannelMessage)

        def handler(message: Any) -> bool:
            return _handle_group_audio_control_channel_message(link, message)

        channel.add_message_handler(handler)
        with _state_lock:
            current = _audio_links_by_id.get(link_id)
            if current is not state:
                channel.remove_message_handler(handler)
                return
            state["control_channel"] = channel
            state["control_channel_handler"] = handler
            state["control_channel_configured"] = True
    except Exception as exc:
        log(
            "[presence_bridge] target=gcall-control-channel configure_failed "
            f"link={link_id} err={str(exc)[:160]}"
        )


def configure_audio_link(link, link_id: str) -> None:
    link.set_link_closed_callback(on_audio_link_closed)
    link.set_packet_callback(on_audio_link_packet)
    link.set_remote_identified_callback(on_audio_link_remote_identified)
    with _state_lock:
        state = _audio_links_by_id.get(link_id)
        if state is not None:
            _ensure_audio_link_lifecycle_fields(state)
            _set_link_manager_generation(link, state)
        _audio_link_ids_by_object[id(link)] = link_id
    _configure_group_audio_control_channel(link, link_id)
    _enqueue_scheduler_task(
        _gcall_control_scheduler_lane(link_id),
        f"gcall-control-capability:{link_id}",
        _send_group_audio_control_capability,
        link_id,
    )
    _activate_audio_rtt_sampling(link_id)


def on_outgoing_audio_link_established(link) -> None:
    link_id = get_audio_link_id(link)
    if link_id is None:
        return
    state = get_audio_link_state(link_id)
    if state is None:
        return
    if not _link_manager_generation_current("audio", link_id, link):
        return
    configure_audio_link(link, link_id)
    with _state_lock:
        _ensure_audio_link_lifecycle_fields(state)
        state["established"] = True
        state["established_at"] = time.time()
        state["manager_state"] = _LINK_STATE_ESTABLISHED
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
            desired["attempts"] = 0
            desired["retry_delay"] = _AUDIO_LINK_RETRY_MIN_SECONDS
            desired["last_failure_reason"] = ""
            desired["max_attempts_emitted"] = False
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] audio link identify failed link={link_id}: {exc}")
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_established "
        f"peer={peer_key} link={link_id}"
    )
    _activate_audio_rtt_sampling(link_id)
    emit_audio_link_established(link_id)


def _cancel_inbound_classify_timer(link_key: int) -> None:
    timer = _inbound_classify_timers.pop(link_key, None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _register_incoming_overlay_link(
    link,
    peer_hash: str = "",
    reason: str = "incoming",
    *,
    migration_candidate: bool = False,
) -> str:
    peer_key = str(peer_hash or "").strip().lower()
    migration_source_link_id = ""
    migration_peer_authenticated = False
    if migration_candidate:
        remote_identity = _overlay_link_remote_identity(link)
        if remote_identity is not None:
            migration_peer_authenticated = _overlay_identity_matches_peer(
                remote_identity,
                peer_key,
            )
            if not migration_peer_authenticated:
                log(
                    "[presence_bridge] target=presence-reticulum "
                    "overlay_migration_candidate_rejected "
                    f"peer={peer_key or 'unknown'} reason=remote_identity_mismatch"
                )
                _enqueue_scheduler_task(
                    _overlay_io_lane_for_peer(peer_key or "unknown"),
                    f"overlay-migration-reject:{peer_key[:8] or 'unknown'}",
                    _teardown_reticulum_link_bounded,
                    link,
                    "target=presence-reticulum route_migration_identity_mismatch "
                    f"peer={peer_key or 'unknown'}",
                )
                return ""
        with _state_lock:
            active_link_id = _active_overlay_link_id_by_peer_hash.get(peer_key) or ""
            active_state = (
                _overlay_links_by_id.get(active_link_id) if active_link_id else None
            )
            has_existing_candidate = any(
                state.get("migration_candidate") is True
                and _overlay_link_peer_hash(state) == peer_key
                for state in _overlay_links_by_id.values()
            )
            migration_allowed = (
                _valid_presence_destination_hash_hex(peer_key)
                and active_state is not None
                and _overlay_link_is_fanout_usable(active_state)
                and active_state.get("incoming") is True
                and _overlay_peer_supports_route_migration(active_state)
                and not has_existing_candidate
            )
            has_capacity = len(_overlay_links_by_id) < _OVERLAY_MAX_TOTAL_LINKS
            if migration_allowed:
                migration_source_link_id = active_link_id
        if not migration_allowed or not has_capacity:
            reject_reason = (
                "route_migration_no_active_capable_link"
                if not migration_allowed
                else "route_migration_link_pressure"
            )
            log(
                "[presence_bridge] target=presence-reticulum "
                "overlay_migration_candidate_rejected "
                f"peer={peer_key or 'unknown'} reason={reject_reason}"
            )
            _enqueue_scheduler_task(
                _overlay_io_lane_for_peer(peer_key or "unknown"),
                f"overlay-migration-reject:{peer_key[:8] or 'unknown'}",
                _teardown_reticulum_link_bounded,
                link,
                f"target=presence-reticulum {reject_reason} peer={peer_key or 'unknown'}",
            )
            return ""
    else:
        _prune_overlay_link_pressure("link_pressure_inbound", reserve_slots=1)
    with _state_lock:
        pressure_links = len(_overlay_links_by_id)
    if pressure_links >= _OVERLAY_MAX_TOTAL_LINKS:
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_inbound_pressure_cleanup "
            f"peer={peer_key or 'unknown'} reason={reason} "
            f"links={pressure_links} max={_OVERLAY_MAX_TOTAL_LINKS}"
        )
    if peer_key:
        if not _admit_overlay_peer_if_allowed(peer_key, f"inbound:{reason}", incoming=True):
            verbose_presence_log(
                "[presence_bridge] target=presence-reticulum overlay_inbound_rejected "
                f"peer={peer_key} reason={reason}"
            )
            _enqueue_scheduler_task(
                _overlay_io_lane_for_peer(peer_key),
                f"overlay-inbound-reject:admission:{peer_key[:8]}",
                _teardown_reticulum_link_bounded,
                link,
                f"target=presence-reticulum overlay_inbound_reject peer={peer_key} reason={reason}",
            )
            return ""
    elif not _overlay_unknown_inbound_allowed():
        verbose_presence_log(
            "[presence_bridge] target=presence-reticulum overlay_inbound_rejected "
            f"peer=unknown reason={reason} active={len(_inbound_overlay_neighbors)}"
        )
        _enqueue_scheduler_task(
            _overlay_io_lane_for_peer("unknown"),
            "overlay-inbound-reject:unknown",
            _teardown_reticulum_link_bounded,
            link,
            f"target=presence-reticulum overlay_inbound_reject peer=unknown reason={reason}",
        )
        return ""
    link_id = str(uuid.uuid4())
    now = time.time()
    state = {
        "linkId": link_id,
        "link": link,
        "rnsLinkId": (_rns_link_id_bytes(link) or b"").hex(),
        "peerPresenceHash": peer_key,
        "incoming": True,
        "established": True,
        "established_at": now,
        "created_at": now,
        "pending_packets": deque(maxlen=_OVERLAY_PENDING_PACKET_LIMIT),
        "last_activity_at": now,
        "last_rx_at": None,
        "open_reason": f"inbound:{reason}",
        "announce_retry_created": False,
        "manager_kind": "overlay",
        "manager_state": _LINK_STATE_ESTABLISHED,
        "generation": 0,
        "last_failure_reason": "",
        "backoff_until": 0.0,
        "migration_candidate": bool(migration_candidate),
        "migration_source_link_id": migration_source_link_id,
        "migration_peer_authenticated": bool(migration_peer_authenticated),
        "migration_ready_event": threading.Event() if migration_candidate else None,
    }
    with _state_lock:
        _overlay_links_by_id[link_id] = state
    configure_overlay_link(link, link_id)
    if peer_key and not migration_candidate:
        _register_active_overlay_for_peer(peer_key, link_id)
    emit_overlay_link_state(link_id, state, "incoming")
    if not migration_candidate or migration_peer_authenticated:
        _send_overlay_hello_for_link(link_id, f"incoming:{reason}")
    else:
        log(
            "[presence_bridge] target=presence-reticulum "
            "overlay_migration_candidate_waiting_identity "
            f"peer={peer_key} link={link_id}"
        )
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
        peer_hash = str(_incoming_unified_peer_hash_by_object.get(link_key) or "").strip().lower()
        if not _valid_presence_destination_hash_hex(peer_hash):
            peer_hash = ""
        reason = "classify_timeout_identity" if peer_hash else "classify_timeout"
        log(
            "[presence_bridge] WARNING inbound_link_classify_timeout defaulting_to_overlay "
            f"link_obj={link_key} peer={peer_hash or 'unknown'} reason={reason}"
        )
        try:
            _register_incoming_overlay_link(
                link,
                peer_hash,
                reason,
            )
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
    if _qortalland_game_manager is not None and _qortalland_game_manager.proximity.owns_link(link):
        _qortalland_game_manager.proximity._link_closed(link)
    elif _qortalland_game_manager is not None and _qortalland_game_manager.owns_link(link):
        _qortalland_game_manager._link_closed(link)
    elif get_overlay_link_id(link):
        on_overlay_link_closed(link)
    elif get_audio_link_id(link):
        on_audio_link_closed(link)
    elif get_qchat_file_link_id(link):
        on_qchat_file_link_closed(link)
    else:
        _incoming_unified_peer_hash_by_object.pop(id(link), None)


def _handle_inbound_link_first_packet(message, packet) -> None:
    link = getattr(packet, "link", None)
    if link is None:
        return
    link_key = id(link)
    with _state_lock:
        if link_key not in _pending_inbound_classify_link_ids:
            return
        _pending_inbound_classify_link_ids.discard(link_key)
    _cancel_inbound_classify_timer(link_key)
    manager = _ensure_qortalland_game_manager()
    if manager.proximity.handle_classifier(link, message):
        return
    if manager.handle_classifier(link, message):
        return
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
    if decoded.get("type") == _RESOURCE_SESSION_HELLO_TYPE:
        _register_incoming_resource_session(
            link,
            str(decoded.get("r") or "").strip().lower(),
            str(decoded.get("lane") or "").strip().lower(),
        )
        return
    if _is_qchat_file_auth_packet(decoded):
        link_id = _register_incoming_qchat_file_link(
            link,
            "",
            str(decoded.get("transferId") or decoded.get("x") or ""),
        )
        on_qchat_file_link_packet(message, packet)
        return
    peer_hash = ""
    if isinstance(decoded.get("t"), str) and str(decoded.get("t")).startswith("PRESENCE_"):
        peer_hash = str(decoded.get("r") or "").strip().lower()
    elif decoded.get("t") in _OVERLAY_TRANSPORT_WIRE_TYPES:
        peer_hash = str(decoded.get("r") or "").strip().lower()
    migration_candidate = (
        decoded.get("t") == _OVERLAY_HELLO_WIRE_TYPE
        and decoded.get("m") == _OVERLAY_ROUTE_MIGRATION_MARKER
        and isinstance(decoded.get("c"), list)
        and _OVERLAY_ROUTE_MIGRATION_CAPABILITY in decoded.get("c")
    )
    link_id = _register_incoming_overlay_link(
        link,
        peer_hash if _valid_presence_destination_hash_hex(peer_hash) else "",
        "first_packet",
        migration_candidate=migration_candidate,
    )
    if link_id:
        on_overlay_link_packet(message, packet)


def on_inbound_link_first_packet(message, packet) -> None:
    started_at = time.monotonic()
    try:
        _handle_inbound_link_first_packet(message, packet)
    finally:
        _note_callback_duration("inbound_first", started_at, message)


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


def _handle_hub_packet_received(data, packet) -> None:
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
            frame_kind, _control_type = _inspect_gcall_audio_payload(raw_audio)
            direct_ok = False
            if frame_kind == "media":
                direct_ok = _try_group_audio_forward_fast_path(
                    room_id,
                    "",
                    peer_presence_hash,
                    sender_dest,
                    received_at_wall_ms,
                    raw_audio,
                    chunk,
                )
                if not direct_ok and _audio_data_plane_should_take_inbound_media(room_id):
                    direct_ok = _audio_data_plane_broadcast_inbound_audio(chunk)
            fd4_ok = direct_ok or _emit_binary_audio(chunk)
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
    _note_presence_pressure("source:hub")
    t = message.get("t")
    if t == _GROUP_AUDIO_WIRE_TYPE:
        log("[presence_bridge] ignored legacy json/base64 hub audio payload")
        return
    if isinstance(t, str) and t.startswith("PRESENCE_"):
        _emit_presence_message(message)
        return
    _emit_call_bridge_message(message)


def on_hub_packet_received(data, packet) -> None:
    started_at = time.monotonic()
    try:
        _handle_hub_packet_received(data, packet)
    finally:
        _note_callback_duration("hub", started_at, data)


def ensure_started(config_dir: str):
    global _reticulum, _identity, _destination
    global _announce_handler, _reticulum_config_dir

    with _state_lock:
        if _destination is not None:
            return _destination

        os.makedirs(config_dir, exist_ok=True)
        _reticulum_config_dir = config_dir
        configured_log_file = str(os.environ.get("QORTAL_RNS_LOG_FILE") or "").strip()
        RNS.logfile = configured_log_file or os.path.join(
            config_dir,
            f"logfile.bridge.{os.getpid()}",
        )
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
        _destination.register_request_handler(
            _RESOURCE_SESSION_REQUEST_PATH,
            response_generator=_resource_session_response_generator,
            allow=RNS.Destination.ALLOW_ALL,
            auto_compress=False,
        )
        _announce_handler = PresenceAnnounceHandler(_destination.hash)
        RNS.Transport.register_announce_handler(_announce_handler)
        ensure_transport_monitor_started()
        ensure_rns_callback_scheduler_monitor_started()
        ensure_audio_rtt_monitor_started()
        ensure_overlay_transport_maintenance_started()
        if _RNS_INTERNAL_TIMING_PROBES_ENABLED:
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
        _seed_overlay_good_outbound_cache_candidates()
        game_manager = _ensure_qortalland_game_manager()
        game_port = game_manager.start_server() if game_manager is not None else None
        if game_port is not None:
            emit_event(
                "qortalland_game_ws_ready",
                {
                    "port": game_port,
                    "instanceId": os.environ.get("QORTAL_LAND_REALTIME_INSTANCE_ID") or os.environ.get("QORTAL_LAND_GAMES_INSTANCE_ID", ""),
                },
            )
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
        global _last_presence_wire, _last_presence_announce_wire, _last_presence_announce_id
        global _rns_auth_announced, _last_no_verified_peers_announce_at
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
        if env_type == "PRESENCE_ANNOUNCE":
            _last_presence_announce_wire = wire_bytes
            _last_presence_announce_id = str(envelope.get("id") or "")
        elif env_type == "PRESENCE_OFFLINE":
            _last_presence_announce_wire = None
            _last_presence_announce_id = ""
        peer_hashes = _snapshot_established_overlay_neighbor_hashes()
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
        envelope_id = str(envelope.get("id") or "")
        queued, queued_count = _enqueue_presence_fanout_tasks(
            peer_hashes,
            wire_bytes,
            "presence_publish",
            envelope_id,
        )
        if not queued:
            emit_resp(
                req_id,
                False,
                payload={
                    "code": "scheduler_queue_full",
                    "lane": "presence-fanout",
                    "queuedPeers": queued_count,
                    "fanoutPeers": len(peer_hashes),
                },
                error="Reticulum scheduler lane is full: presence-fanout",
            )
            return
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(peer_hashes),
                "fanoutHashes": peer_hashes,
                "localPresenceHash": local_hex,
                "fanoutQueued": True,
                "queuedPeers": queued_count,
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
        peer_hashes = _snapshot_established_overlay_neighbor_hashes(exclude_hashes)
        envelope_id = str(envelope.get("id") or "")
        queued, queued_count = _enqueue_presence_fanout_tasks(
            peer_hashes,
            wire_bytes,
            "presence_forward",
            envelope_id,
        )
        if not queued:
            emit_resp(
                req_id,
                False,
                payload={
                    "code": "scheduler_queue_full",
                    "lane": "presence-fanout",
                    "queuedPeers": queued_count,
                    "fanoutPeers": len(peer_hashes),
                },
                error="Reticulum scheduler lane is full: presence-fanout",
            )
            return
        emit_resp(
            req_id,
            True,
            payload={
                "fanoutPeers": len(peer_hashes),
                "fanoutHashes": peer_hashes,
                "fanoutQueued": True,
                "queuedPeers": queued_count,
            },
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_configure_reticulum_chat_pinned_peers(
    req_id: str, payload: Dict[str, Any]
) -> None:
    peers_raw = payload.get("peers")
    requested = peers_raw if isinstance(peers_raw, list) else []
    if len(requested) > _OVERLAY_MAX_PINNED_CHAT_PEERS:
        emit_resp(
            req_id,
            False,
            payload={"code": "too_many_pinned_chat_peers"},
            error="Too many pinned Reticulum chat peers",
        )
        return
    now = time.time()
    next_pinned: Dict[str, float] = {}
    rejected = 0
    with _state_lock:
        lease_snapshots = {
            address: dict(by_destination)
            for address, by_destination in _account_endpoint_leases.items()
        }
    for candidate in requested:
        if not isinstance(candidate, dict):
            rejected += 1
            continue
        account_address = str(candidate.get("accountAddress") or "").strip()
        peer_hash = str(candidate.get("destinationHash") or "").strip().lower()
        requested_expiry = _coerce_epoch_seconds(candidate.get("expiresAt"))
        account_leases = lease_snapshots.get(account_address) or {}
        matching_lease = account_leases.get(peer_hash)
        lease_expiry = (
            _coerce_epoch_seconds(matching_lease.get("expires_at"))
            if isinstance(matching_lease, dict)
            else None
        )
        if (
            not account_address
            or not _valid_presence_destination_hash_hex(peer_hash)
            or requested_expiry is None
            or requested_expiry <= now
            or lease_expiry is None
            or lease_expiry <= now
        ):
            rejected += 1
            continue
        next_pinned[peer_hash] = min(requested_expiry, lease_expiry)
    if rejected > 0:
        emit_resp(
            req_id,
            False,
            payload={"code": "unverified_pinned_chat_peer", "rejected": rejected},
            error="Pinned Reticulum chat peer has no current account endpoint lease",
        )
        return
    with _state_lock:
        previous = set(_pinned_chat_overlay_peers.keys())
        _pinned_chat_overlay_peers.clear()
        _pinned_chat_overlay_peers.update(next_pinned)
    added = set(next_pinned.keys()) - previous
    for peer_hash in added:
        if peer_hash not in _known_peers:
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
    queued = _enqueue_scheduler_task(
        "overlay-control",
        "overlay-pinned-chat-maintenance",
        _run_overlay_sync_maintenance,
        "pinned_chat_peers",
        drop_oldest=True,
    )
    emit_resp(
        req_id,
        True,
        payload={
            "pinnedPeers": len(next_pinned),
            "maintenanceQueued": bool(queued),
        },
    )


def handle_overlay_sync_state(req_id: str, payload: Dict[str, Any]) -> None:
    verified_raw = payload.get("verifiedPeers")
    active_raw = payload.get("activeNeighborHashes")
    leases_raw = payload.get("accountEndpointLeases")
    verified = verified_raw if isinstance(verified_raw, list) else []
    active = active_raw if isinstance(active_raw, list) else []
    leases = leases_raw if isinstance(leases_raw, list) else []
    _set_verified_overlay_peers(verified, [str(h) for h in active], leases)
    queued = _enqueue_scheduler_task(
        "overlay-control",
        "overlay-sync-maintenance",
        _run_overlay_sync_maintenance,
        "overlay_sync_state",
        drop_oldest=True,
    )
    emit_resp(
        req_id,
        True,
        payload={"maintenanceQueued": bool(queued)},
    )


def handle_overlay_note_candidate_failure(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerHash") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip() or "unknown"
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerHash")
        return
    _note_candidate_failure(peer_hash, reason)
    emit_resp(req_id, True)


def handle_stop(req_id: str) -> None:
    global _land_state_forwarding_plans
    global _land_state_auth_sessions
    global _land_state_forward_pending
    with _land_state_forwarding_lock:
        _land_state_forwarding_plans = {}
        _land_state_auth_sessions = {}
        _land_state_forward_pending = {}
    with _state_lock:
        _pinned_chat_overlay_peers.clear()
        resource_sessions = [
            state
            for state in _qchat_file_links_by_id.values()
            if isinstance(state, dict)
            and state.get("manager_kind") == "resource_session"
        ]
        resource_waiters = list(_resource_session_provider_waiters.values())
    for waiter in resource_waiters:
        if not isinstance(waiter, dict):
            continue
        waiter["reason"] = "resource_session_stopped"
        event = waiter.get("event")
        if event is not None:
            event.set()
    for state in resource_sessions:
        _resource_session_fail_state(state, "resource_session_stopped")
    _flush_overlay_good_outbound_cache(force=True)
    _rns_announce_on_auth_session_end()
    if _qortalland_game_manager is not None:
        _qortalland_game_manager.stop()
    emit_resp(req_id, True)


def _encode_group_signal_wire(msg: Dict[str, Any]) -> Dict[str, Any]:
    out = _normalize_json_numbers(dict(msg))
    # `r` identifies the original endpoint. Relays must preserve it; replacing
    # it with each transport hop makes calls and media bind to the relay.
    origin = str(out.get("r") or "").strip().lower()
    out["r"] = (
        origin
        if _valid_presence_destination_hash_hex(origin)
        else destination_hash_hex(_destination.hash)
    )
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
        _overlay_enqueue_open(peer_key, "group_signal_prepare", await_path=True)
    if peer_key not in _known_peers:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    return None


def _send_group_signal_wire_to_peer(peer_hash: str, wire_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not _send_wire_to_overlay_peer(
        peer_hash,
        wire_bytes,
        "group_signal",
        queue_if_pending=False,
    ):
        # Group/call signaling is latency-sensitive and intentionally does not
        # queue behind a pending overlay link. A miss here only means "not
        # established at this instant"; it should not globally suppress the peer
        # for chat/presence fanout.
        return {
            "payload": {"code": "packet_send_false"},
            "error": "Packet send returned False",
        }
    return None


def _encode_call_signal_wire(msg: Dict[str, Any]) -> Dict[str, Any]:
    out = _normalize_json_numbers(dict(msg))
    origin = str(out.get("r") or "").strip().lower()
    out["r"] = (
        origin
        if _valid_presence_destination_hash_hex(origin)
        else destination_hash_hex(_destination.hash)
    )
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
        _overlay_enqueue_open(peer_key, "call_signal_prepare", await_path=True)
    if peer_key not in _known_peers:
        return {
            "payload": {"code": "unknown_peer_presence_hash"},
            "error": "Unknown peer presence hash",
        }
    return None


def _send_call_signal_wire_to_peer(peer_hash: str, wire_bytes: bytes) -> Optional[Dict[str, Any]]:
    if not _send_wire_to_overlay_peer(
        peer_hash,
        wire_bytes,
        "call_signal",
        queue_if_pending=False,
    ):
        # Like group signaling, a direct call signal miss only says the overlay
        # link was not established at this instant. Do not suppress the peer for
        # unrelated chat/presence fanout.
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

def _resource_session_lane(resource_type: str, logical_resource_type: str = "") -> str:
    normalized = str(resource_type or "").strip().lower()
    logical_type = str(logical_resource_type or "").strip().lower()
    # DM pages carry the live message bodies after a compact dm_notify. Keep
    # them off the bulk/history pool so an idle or recovering history link
    # cannot delay delivery of an active conversation.
    if logical_type == "reticulum_chat_dm_page":
        return "fast"
    if logical_type in {
        "reticulum_chat_history_page",
        "reticulum_chat_metadata_snapshot",
        "reticulum_chat_event_page",
        "reticulum_chat_calendar",
    }:
        return "bulk"
    return "fast" if normalized == _RETICULUM_CHAT_RESOURCE_TYPE else "bulk"


def _resource_session_provider_class(
    resource_type: str,
    logical_resource_type: str = "",
) -> str:
    normalized = str(resource_type or "").strip().lower()
    logical_type = str(logical_resource_type or "").strip().lower()
    if logical_type == "reticulum_chat_dm_page":
        return "live"
    if (
        logical_type == "reticulum_resource_range"
        or logical_type.endswith("_resource_range")
        or normalized == "reticulum_resource_range"
        or normalized.endswith("_resource_range")
    ):
        return "attachment"
    if logical_type in {
        "reticulum_chat_metadata_snapshot",
        "reticulum_chat_calendar",
    }:
        return "metadata"
    if logical_type in {
        "reticulum_chat_history_page",
        "reticulum_chat_event_page",
    }:
        return "history"
    return "live" if normalized == _RETICULUM_CHAT_RESOURCE_TYPE else "history"


def _resource_session_provider_has_capacity_locked(
    provider_class: str,
    peer_hash: str = "",
) -> bool:
    peer_key = str(peer_hash or "").strip().lower()
    active_total = sum(_resource_session_provider_active_by_class.values())
    if active_total >= _RESOURCE_SESSION_PROVIDER_CONCURRENCY:
        return False
    if (
        peer_key
        and int(_resource_session_provider_active_by_peer.get(peer_key) or 0)
        >= _RESOURCE_SESSION_PROVIDER_ACTIVE_MAX_PER_PEER
    ):
        return False
    if provider_class != "live":
        active_non_live = (
            _resource_session_provider_active_by_class["metadata"]
            + _resource_session_provider_active_by_class["history"]
            + _resource_session_provider_active_by_class["attachment"]
        )
        if active_non_live >= _RESOURCE_SESSION_PROVIDER_NON_LIVE_CONCURRENCY:
            return False
    if (
        provider_class == "attachment"
        and _resource_session_provider_active_by_class["attachment"]
        >= _RESOURCE_SESSION_PROVIDER_ATTACHMENT_CONCURRENCY
    ):
        return False
    if (
        provider_class == "metadata"
        and _resource_session_provider_active_by_class["metadata"]
        >= _RESOURCE_SESSION_PROVIDER_METADATA_CONCURRENCY
    ):
        return False
    if (
        provider_class == "attachment"
        and peer_key
        and int(
            _resource_session_provider_active_attachments_by_peer.get(peer_key)
            or 0
        )
        >= _RESOURCE_SESSION_PROVIDER_ATTACHMENT_MAX_PER_PEER
    ):
        return False
    return True


def _resource_session_provider_can_start_locked(
    provider_class: str,
    peer_hash: str = "",
    waiter: Optional[Dict[str, Any]] = None,
) -> bool:
    if not _resource_session_provider_has_capacity_locked(
        provider_class,
        peer_hash,
    ):
        return False
    if waiter is None:
        return True
    priorities = {
        "live": 0,
        "metadata": 1,
        "history": 2,
        "attachment": 3,
    }
    waiter_priority = priorities.get(provider_class, 3)
    try:
        waiter_index = _resource_session_provider_capacity_queue.index(waiter)
    except ValueError:
        return False
    for queued_index, queued in enumerate(
        _resource_session_provider_capacity_queue
    ):
        if queued is waiter:
            continue
        queued_class = str(queued.get("providerClass") or "attachment")
        queued_priority = priorities.get(queued_class, 3)
        if queued_priority > waiter_priority:
            continue
        if queued_priority == waiter_priority and queued_index > waiter_index:
            continue
        queued_peer = str(queued.get("peerPresenceHash") or "").strip().lower()
        if _resource_session_provider_has_capacity_locked(
            queued_class,
            queued_peer,
        ):
            return False
    return True


def _resource_session_provider_acquire_capacity(
    provider_class: str,
    transfer_id: str,
    pending: Dict[str, Any],
    state: Dict[str, Any],
) -> bool:
    deadline = time.monotonic() + _RESOURCE_SESSION_PROVIDER_CAPACITY_WAIT_SECONDS
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    waiter = {
        "providerClass": provider_class,
        "peerPresenceHash": peer_hash,
        "transferId": transfer_id,
    }
    with _resource_session_provider_capacity_condition:
        total_waiters = len(_resource_session_provider_capacity_queue)
        peer_waiters = int(
            _resource_session_provider_capacity_waiters_by_peer.get(peer_hash) or 0
        )
        if (
            total_waiters >= _RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX
            or (
                peer_hash
                and peer_waiters
                >= _RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX_PER_PEER
            )
        ):
            return False
        _resource_session_provider_capacity_waiters[provider_class] += 1
        _resource_session_provider_capacity_queue.append(waiter)
        if peer_hash:
            _resource_session_provider_capacity_waiters_by_peer[peer_hash] = (
                peer_waiters + 1
            )
        try:
            while True:
                if (
                    pending.get("cancelled") is True
                    or _shutdown.is_set()
                    or state.get("closing") is True
                ):
                    return False
                if _resource_session_provider_can_start_locked(
                    provider_class,
                    peer_hash,
                    waiter,
                ):
                    _resource_session_provider_active_by_class[provider_class] += 1
                    if peer_hash:
                        _resource_session_provider_active_by_peer[peer_hash] = (
                            int(
                                _resource_session_provider_active_by_peer.get(
                                    peer_hash
                                )
                                or 0
                            )
                            + 1
                        )
                        if provider_class == "attachment":
                            _resource_session_provider_active_attachments_by_peer[
                                peer_hash
                            ] = (
                                int(
                                    _resource_session_provider_active_attachments_by_peer.get(
                                        peer_hash
                                    )
                                    or 0
                                )
                                + 1
                            )
                    return True
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    log(
                        "[presence_bridge] resource_provider_capacity_timeout "
                        f"transfer={transfer_id} class={provider_class}"
                    )
                    return False
                _resource_session_provider_capacity_condition.wait(
                    timeout=min(0.25, remaining)
                )
        finally:
            if waiter in _resource_session_provider_capacity_queue:
                _resource_session_provider_capacity_queue.remove(waiter)
            _resource_session_provider_capacity_waiters[provider_class] = max(
                0,
                _resource_session_provider_capacity_waiters[provider_class] - 1,
            )
            if peer_hash:
                remaining_peer_waiters = max(
                    0,
                    int(
                        _resource_session_provider_capacity_waiters_by_peer.get(
                            peer_hash
                        )
                        or 0
                    )
                    - 1,
                )
                if remaining_peer_waiters > 0:
                    _resource_session_provider_capacity_waiters_by_peer[
                        peer_hash
                    ] = remaining_peer_waiters
                else:
                    _resource_session_provider_capacity_waiters_by_peer.pop(
                        peer_hash,
                        None,
                    )
            _resource_session_provider_capacity_condition.notify_all()


def _resource_session_provider_release_capacity(
    provider_class: str,
    peer_hash: str = "",
) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    with _resource_session_provider_capacity_condition:
        _resource_session_provider_active_by_class[provider_class] = max(
            0,
            _resource_session_provider_active_by_class[provider_class] - 1,
        )
        if peer_key:
            remaining = max(
                0,
                int(_resource_session_provider_active_by_peer.get(peer_key) or 0)
                - 1,
            )
            if remaining > 0:
                _resource_session_provider_active_by_peer[peer_key] = remaining
            else:
                _resource_session_provider_active_by_peer.pop(peer_key, None)
            if provider_class == "attachment":
                remaining_attachments = max(
                    0,
                    int(
                        _resource_session_provider_active_attachments_by_peer.get(
                            peer_key
                        )
                        or 0
                    )
                    - 1,
                )
                if remaining_attachments > 0:
                    _resource_session_provider_active_attachments_by_peer[
                        peer_key
                    ] = remaining_attachments
                else:
                    _resource_session_provider_active_attachments_by_peer.pop(
                        peer_key,
                        None,
                    )
        _resource_session_provider_capacity_condition.notify_all()


def _resource_session_provider_release_auth_admission(
    waiter_key: str,
    waiter: Optional[Dict[str, Any]],
) -> None:
    if not waiter_key or not isinstance(waiter, dict):
        return
    with _state_lock:
        if _resource_session_provider_waiters.get(waiter_key) is not waiter:
            return
        _resource_session_provider_waiters.pop(waiter_key, None)
        peer_hash = str(waiter.get("peerPresenceHash") or "").strip().lower()
        if peer_hash:
            remaining = max(
                0,
                int(_resource_session_provider_pending_auth_by_peer.get(peer_hash) or 0)
                - 1,
            )
            if remaining > 0:
                _resource_session_provider_pending_auth_by_peer[peer_hash] = remaining
            else:
                _resource_session_provider_pending_auth_by_peer.pop(peer_hash, None)


def _resource_session_provider_acquire_link_slot(
    state: Dict[str, Any],
    transfer_id: str,
    peer_hash: str,
) -> str:
    """Reserve a provider Link after its previous Resource fully concludes.

    The receiver can invoke its response callback before the sender has
    processed the final Resource proof. That makes immediate Link reuse race
    the provider's completion watcher. Keep one bounded successor waiting on
    the provider's own completion condition and reserve the slot atomically
    when it becomes free. A non-empty return value is the rejection reason.
    """
    transfer_key = str(transfer_id or "").strip()
    peer_key = str(peer_hash or "").strip().lower()
    deadline = (
        time.monotonic()
        + _RESOURCE_SESSION_PROVIDER_LINK_HANDOFF_WAIT_SECONDS
    )
    waited = False
    owns_waiter = False
    with _resource_session_provider_capacity_condition:
        link_id = str(state.get("linkId") or "")
        if (
            state.get("incoming") is not True
            or state.get("closing") is True
            or state.get("provider_ready_sent") is not True
            or _qchat_file_links_by_id.get(link_id) is not state
        ):
            return "resource_session_unavailable"
        if _resource_session_provider_was_cancelled_locked(
            peer_key,
            transfer_key,
        ):
            return "resource_requester_cancelled"
        existing_waiter = str(
            state.get("provider_link_waiter_transfer") or ""
        ).strip()
        if existing_waiter:
            return (
                "duplicate_resource_request"
                if existing_waiter == transfer_key
                else "resource_session_busy"
            )
        while int(state.get("provider_active") or 0) > 0:
            existing_waiter = str(
                state.get("provider_link_waiter_transfer") or ""
            ).strip()
            if existing_waiter and not owns_waiter:
                return (
                    "duplicate_resource_request"
                    if existing_waiter == transfer_key
                    else "resource_session_busy"
                )
            if not owns_waiter:
                handoff_waiters = [
                    item
                    for item in _qchat_file_links_by_id.values()
                    if isinstance(item, dict)
                    and item.get("manager_kind") == "resource_session"
                    and item.get("incoming") is True
                    and item.get("provider_link_waiter_transfer")
                ]
                peer_handoff_waiters = sum(
                    1
                    for item in handoff_waiters
                    if str(
                        item.get("peerPresenceHash") or ""
                    ).strip().lower() == peer_key
                )
                pending_auth_total = len(
                    _resource_session_provider_waiters
                )
                peer_pending_auth = int(
                    _resource_session_provider_pending_auth_by_peer.get(
                        peer_key,
                        0,
                    )
                    or 0
                )
                if (
                    pending_auth_total + len(handoff_waiters)
                    >= _RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX
                    or peer_pending_auth + peer_handoff_waiters
                    >= _RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX_PER_PEER
                ):
                    return "resource_provider_busy"
                state["provider_link_waiter_transfer"] = transfer_key
                owns_waiter = True
            waited = True
            if state.get("closing") is True or _shutdown.is_set():
                if (
                    owns_waiter
                    and state.get("provider_link_waiter_transfer") == transfer_key
                ):
                    state.pop("provider_link_waiter_transfer", None)
                return "resource_session_unavailable"
            if _resource_session_provider_was_cancelled_locked(
                peer_key,
                transfer_key,
            ):
                if (
                    owns_waiter
                    and state.get("provider_link_waiter_transfer") == transfer_key
                ):
                    state.pop("provider_link_waiter_transfer", None)
                return "resource_requester_cancelled"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if (
                    owns_waiter
                    and state.get("provider_link_waiter_transfer") == transfer_key
                ):
                    state.pop("provider_link_waiter_transfer", None)
                log(
                    "[presence_bridge] resource_session_link_handoff_timeout "
                    f"transfer={transfer_key} peer={peer_key[:16]}"
                )
                return "resource_session_busy"
            _resource_session_provider_capacity_condition.wait(
                timeout=min(0.1, remaining)
            )
        if (
            owns_waiter
            and state.get("provider_link_waiter_transfer") == transfer_key
        ):
            state.pop("provider_link_waiter_transfer", None)
        if (
            state.get("closing") is True
            or _shutdown.is_set()
            or _qchat_file_links_by_id.get(link_id) is not state
        ):
            return "resource_session_unavailable"
        if _resource_session_provider_was_cancelled_locked(
            peer_key,
            transfer_key,
        ):
            return "resource_requester_cancelled"
        # Reservation and the zero-to-one transition are atomic under the
        # shared condition lock, so two request threads cannot both start an
        # outgoing Resource on this Link.
        state["provider_active"] = 1
        state["last_used_at"] = time.time()
        state["activity_generation"] = int(
            state.get("activity_generation") or 0
        ) + 1
        if waited:
            state["provider_link_handoffs"] = int(
                state.get("provider_link_handoffs") or 0
            ) + 1
        return ""


def _resource_session_provider_cancel_key(peer_hash: str, transfer_id: str) -> str:
    return f"{str(peer_hash or '').strip().lower()}:{str(transfer_id or '').strip()}"


def _resource_session_provider_was_cancelled_locked(
    peer_hash: str,
    transfer_id: str,
) -> bool:
    now = time.time()
    cancel_key = _resource_session_provider_cancel_key(peer_hash, transfer_id)
    expires_at = float(
        _resource_session_provider_recent_cancellations.get(cancel_key) or 0
    )
    if expires_at > now:
        return True
    if expires_at > 0:
        _resource_session_provider_recent_cancellations.pop(cancel_key, None)
    return False


def _resource_session_key(peer_hash: str, lane: str, slot: int = 0) -> str:
    peer_key = str(peer_hash or "").strip().lower()
    session_lane = "bulk" if lane == "bulk" else "fast"
    return f"{peer_key}:{session_lane}:{max(0, int(slot))}"


def _resource_session_waiter_key(link_id: str, transfer_id: str) -> str:
    return f"{link_id}:{transfer_id}"


def _resource_session_job_priority(job: Dict[str, Any]) -> int:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    auth = pending.get("authMessage") if isinstance(pending.get("authMessage"), dict) else {}
    logical = str(
        metadata.get("logicalResourceType")
        or metadata.get("resourceType")
        or pending.get("resourceType")
        or ""
    ).lower()
    if metadata.get("eventId") or auth.get("eventId") or auth.get("id"):
        return 0
    if (
        "metadata_snapshot" in logical
        or "reticulum_chat_calendar" in logical
        or metadata.get("snapshotHash")
    ):
        return 1
    if "history_page" in logical or "dm_page" in logical:
        return 2
    return 3


def _resource_session_job_class(job: Dict[str, Any]) -> str:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    return _resource_session_provider_class(
        str(pending.get("resourceType") or ""),
        str(metadata.get("logicalResourceType") or ""),
    )


def _resource_session_job_fairness_group(job: Dict[str, Any]) -> str:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    file_hash = str(metadata.get("fileHash") or pending.get("sha256") or "").strip().lower()
    if file_hash:
        return f"file:{file_hash}"
    return str(job.get("semanticKey") or pending.get("transferId") or "")


def _resource_session_active_attachment_count_locked(peer_hash: str) -> int:
    peer_key = str(peer_hash or "").strip().lower()
    total = 0
    for state in _qchat_file_links_by_id.values():
        if (
            not isinstance(state, dict)
            or state.get("manager_kind") != "resource_session"
            or state.get("incoming") is True
            or state.get("closing") is True
            or str(state.get("peerPresenceHash") or "").strip().lower() != peer_key
        ):
            continue
        for active_job in (state.get("active_requests") or {}).values():
            if isinstance(active_job, dict) and _resource_session_job_class(active_job) == "attachment":
                total += 1
    return total


def _resource_session_pop_next_job_locked(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    pending_jobs = state.get("pending_jobs")
    if not isinstance(pending_jobs, list) or not pending_jobs:
        return None
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    attachment_capacity = (
        _resource_session_active_attachment_count_locked(peer_hash)
        < _RESOURCE_SESSION_BULK_ATTACHMENT_CONCURRENCY_PER_PEER
    )
    eligible = [
        (index, job)
        for index, job in enumerate(pending_jobs)
        if isinstance(job, dict)
        and job.get("completed") is not True
        and (attachment_capacity or _resource_session_job_class(job) != "attachment")
    ]
    if not eligible:
        return None
    best_priority = min(_resource_session_job_priority(job) for _, job in eligible)
    priority_jobs = [
        (index, job)
        for index, job in eligible
        if _resource_session_job_priority(job) == best_priority
    ]
    last_group = str(state.get("last_dispatched_fairness_group") or "")
    selected_index, selected_job = next(
        (
            (index, job)
            for index, job in priority_jobs
            if _resource_session_job_fairness_group(job) != last_group
        ),
        priority_jobs[0],
    )
    pending_jobs.pop(selected_index)
    state["last_dispatched_fairness_group"] = _resource_session_job_fairness_group(
        selected_job
    )
    return selected_job


def _resource_session_semantic_key(pending: Dict[str, Any]) -> str:
    metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    auth = pending.get("authMessage") if isinstance(pending.get("authMessage"), dict) else {}
    peer_hash = str(pending.get("peerPresenceHash") or "").strip().lower()
    group_id = str(metadata.get("groupId") or auth.get("groupId") or auth.get("g") or "")
    expected_hash = str(pending.get("sha256") or metadata.get("fileHash") or "").strip().lower()
    file_hash = str(metadata.get("fileHash") or auth.get("fileHash") or "").strip().lower()
    byte_ranges = metadata.get("byteRanges") or auth.get("byteRanges")
    if file_hash and isinstance(byte_ranges, list):
        encoded_ranges = json.dumps(byte_ranges, separators=(",", ":"), sort_keys=True)
        return f"range:{file_hash}:{encoded_ranges}"
    event_id = str(metadata.get("eventId") or auth.get("eventId") or auth.get("id") or "").strip()
    if event_id and expected_hash:
        return f"event:{group_id}:{event_id}:{expected_hash}"
    snapshot_hash = str(metadata.get("snapshotHash") or "").strip().lower()
    if snapshot_hash and expected_hash:
        return f"snapshot:{group_id}:{snapshot_hash}:{expected_hash}"
    logical = str(metadata.get("logicalResourceType") or "").strip().lower()
    if "history_page" in logical:
        cursor = auth.get("before") if auth.get("before") is not None else auth.get("after")
        semantic = {
            "peer": peer_hash,
            "group": group_id,
            "channel": metadata.get("channelId") or auth.get("c"),
            "direction": metadata.get("direction") or ("before" if auth.get("before") is not None else "after"),
            "cursor": cursor,
            "include": auth.get("inc"),
            "priority": metadata.get("p") or auth.get("p"),
        }
        digest = hashlib.sha256(
            json.dumps(semantic, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()
        return f"history:{digest}"
    if "dm_page" in logical:
        return (
            f"dm-page:{peer_hash}:"
            f"{metadata.get('conversationId') or auth.get('conversationId') or auth.get('c') or ''}:"
            f"{auth.get('a') if auth.get('a') is not None else auth.get('after') or 0}"
        )
    message_id = str(metadata.get("messageId") or auth.get("messageId") or "").strip()
    if message_id and expected_hash:
        return f"land-chat:{group_id}:{message_id}:{expected_hash}"
    return f"transfer:{pending.get('transferId') or uuid.uuid4()}"


def _resource_session_auth_timestamp_seconds(job: Dict[str, Any]) -> float:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    auth = pending.get("authMessage") if isinstance(pending.get("authMessage"), dict) else {}
    for key in ("ts", "n", "timestamp"):
        try:
            value = float(auth.get(key) or 0)
        except Exception:
            continue
        if value > 0:
            return value / 1000.0 if value > 10_000_000_000 else value
    return float(job.get("created_at") or time.time())


def _resource_session_queue_counts() -> Tuple[int, int, int, float]:
    sessions = 0
    active = 0
    queued = 0
    oldest_age = 0.0
    now = time.time()
    with _state_lock:
        # Include provider-side incoming sessions as well as locally opened
        # sessions. The old counter only covered the latter and hid the actual
        # number of live Reticulum resource links under load.
        for state in list(_qchat_file_links_by_id.values()):
            if not isinstance(state, dict) or state.get("manager_kind") != "resource_session":
                continue
            sessions += 1
            active += len(state.get("active_requests") or {})
            for job in list(state.get("pending_jobs") or []):
                if not isinstance(job, dict) or job.get("completed") is True:
                    continue
                queued += 1
                oldest_age = max(oldest_age, now - float(job.get("created_at") or now))
    return sessions, active, queued, oldest_age


def _resource_session_total_queue_depth() -> int:
    return _resource_session_queue_counts()[2]


def _resource_session_idle_timeout_seconds(state: Dict[str, Any]) -> float:
    if state.get("incoming") is True:
        return _RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS
    local_timeout = (
        _RESOURCE_SESSION_OVERFLOW_IDLE_TIMEOUT_SECONDS
        if state.get("sessionLane") == "bulk"
        and int(state.get("sessionSlot") or 0) > 0
        else _RESOURCE_SESSION_PRIMARY_IDLE_TIMEOUT_SECONDS
    )
    try:
        provider_timeout = float(
            state.get("remote_provider_idle_seconds")
            or _RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS
        )
    except Exception:
        provider_timeout = _RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS
    if not math.isfinite(provider_timeout) or provider_timeout <= 0:
        provider_timeout = _RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS
    return min(
        local_timeout,
        max(1.0, provider_timeout - _RESOURCE_SESSION_PROVIDER_IDLE_GUARD_SECONDS),
    )


def _resource_session_cancel_timer(state: Dict[str, Any], key: str) -> None:
    with _state_lock:
        timer = state.pop(key, None)
    if timer is not None:
        try:
            timer.cancel()
        except Exception:
            pass


def _resource_session_remove_state(state: Dict[str, Any]) -> None:
    link = state.get("link")
    _resource_session_cancel_timer(state, "path_timer")
    _resource_session_cancel_timer(state, "establish_timer")
    _resource_session_cancel_timer(state, "idle_timer")
    with _state_lock:
        session_id = str(state.get("linkId") or "")
        if not session_id and link is not None:
            session_id = str(_qchat_file_link_ids_by_object.get(id(link)) or "")
            if session_id:
                state["linkId"] = session_id
        session_key = str(state.get("sessionKey") or "")
        if session_key and _resource_sessions_by_key.get(session_key) == session_id:
            _resource_sessions_by_key.pop(session_key, None)
        if session_id:
            _qchat_file_links_by_id.pop(session_id, None)
        if link is not None:
            _qchat_file_link_ids_by_object.pop(id(link), None)
            _incoming_unified_peer_hash_by_object.pop(id(link), None)


def _resource_session_emit_status(
    state: Dict[str, Any],
    status: str,
    reason: str = "",
) -> None:
    payload = {
        "status": status,
        "peerPresenceHash": str(state.get("peerPresenceHash") or "").strip().lower(),
        "lane": str(state.get("sessionLane") or "fast"),
        "linkId": str(state.get("linkId") or ""),
    }
    if reason:
        payload["reason"] = reason
    emit_event("reticulum_resource_session", payload)


def _resource_session_emit_failure(job: Dict[str, Any], reason: str, error: str = "") -> None:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    transfer_id = str(pending.get("transferId") or job.get("transferId") or "")
    peer_hash = str(pending.get("peerPresenceHash") or job.get("peerPresenceHash") or "").strip().lower()
    with _state_lock:
        _qchat_file_remove_pending_receive(peer_hash, transfer_id)
    pending["cancelled"] = True
    payload = {
        "transferId": transfer_id,
        "peerPresenceHash": peer_hash,
        "fileName": pending.get("fileName") or "",
        "size": int(pending.get("size") or 0),
        "resourceType": pending.get("resourceType") or "",
        "reason": reason,
    }
    if error:
        payload["error"] = error
    _qchat_file_emit("failed", payload)


def _resource_session_finish_followers(
    job: Dict[str, Any],
    success: bool,
    source_path: str = "",
    actual_hash: str = "",
    reason: str = "",
) -> None:
    followers = list(job.get("followers") or [])
    job["followers"] = []
    for follower in followers:
        if not isinstance(follower, dict) or follower.get("completed") is True:
            continue
        follower["completed"] = True
        pending = follower.get("pending") if isinstance(follower.get("pending"), dict) else {}
        transfer_id = str(pending.get("transferId") or "")
        peer_hash = str(pending.get("peerPresenceHash") or "").strip().lower()
        _resource_session_jobs_by_transfer.pop(transfer_id, None)
        if not success:
            _resource_session_emit_failure(follower, reason or "deduplicated_resource_failed")
            continue
        save_path = str(pending.get("savePath") or "")
        try:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            shutil.copyfile(source_path, save_path)
            with _state_lock:
                _qchat_file_remove_pending_receive(peer_hash, transfer_id)
            _qchat_file_emit(
                "received",
                {
                    **(pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}),
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": pending.get("fileName") or "",
                    "path": save_path,
                    "sha256": actual_hash,
                    "payloadHash": actual_hash,
                    "resourceType": pending.get("resourceType") or "",
                },
            )
        except Exception as exc:
            _resource_session_emit_failure(follower, "deduplicated_save_failed", str(exc))


def _resource_session_dispatch_peer_pending(peer_hash: str, lane: str) -> None:
    peer_key = str(peer_hash or "").strip().lower()
    session_lane = "bulk" if lane == "bulk" else "fast"
    with _state_lock:
        states = [
            state
            for state in _qchat_file_links_by_id.values()
            if isinstance(state, dict)
            and state.get("manager_kind") == "resource_session"
            and state.get("incoming") is not True
            and state.get("closing") is not True
            and str(state.get("peerPresenceHash") or "").strip().lower() == peer_key
            and state.get("sessionLane") == session_lane
        ]
    for state in sorted(
        states,
        key=lambda item: int(item.get("sessionSlot") or 0),
    ):
        _resource_session_dispatch_pending(state)


def _resource_session_schedule_idle_close(state: Dict[str, Any]) -> None:
    with _state_lock:
        _resource_session_cancel_timer(state, "idle_timer")
        if (
            state.get("closing") is True
            or state.get("active_requests")
            or state.get("pending_jobs")
            or int(state.get("provider_active") or 0) > 0
        ):
            return
        generation = int(state.get("activity_generation") or 0)
        idle_age = max(0.0, time.time() - float(state.get("last_used_at") or 0))
        idle_timeout = _resource_session_idle_timeout_seconds(state)
        delay = max(0.1, idle_timeout - idle_age)

    def close_idle() -> None:
        reschedule = False
        with _state_lock:
            if state.get("closing") is True:
                return
            if int(state.get("activity_generation") or 0) != generation:
                reschedule = True
            elif (
                state.get("active_requests")
                or state.get("pending_jobs")
                or int(state.get("provider_active") or 0) > 0
            ):
                return
            else:
                idle_timeout = _resource_session_idle_timeout_seconds(state)
                if time.time() - float(state.get("last_used_at") or 0) < idle_timeout:
                    reschedule = True
                else:
                    state["closing"] = True
        if reschedule:
            _resource_session_schedule_idle_close(state)
            return
        log(
            "[presence_bridge] resource_session_idle_close "
            f"peer={str(state.get('peerPresenceHash') or '')[:16]} lane={state.get('sessionLane')}"
        )
        _resource_session_remove_state(state)
        link = state.get("link")
        if link is not None:
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum resource_session_idle lane={state.get('sessionLane')}",
            )

    timer = threading.Timer(delay, close_idle)
    timer.daemon = True
    with _state_lock:
        if state.get("closing") is True:
            return
        state["idle_timer"] = timer
    timer.start()


def _resource_session_finish_job(
    job: Dict[str, Any],
    success: bool,
    *,
    source_path: str = "",
    actual_hash: str = "",
    reason: str = "",
    error: str = "",
) -> None:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    transfer_id = str(pending.get("transferId") or job.get("transferId") or "")
    semantic_key = str(job.get("semanticKey") or "")
    session = job.get("session") if isinstance(job.get("session"), dict) else None
    with _state_lock:
        if job.get("completed") is True:
            return
        job["completed"] = True
        _resource_session_jobs_by_transfer.pop(transfer_id, None)
        if semantic_key and _resource_session_jobs_by_semantic_key.get(semantic_key) is job:
            _resource_session_jobs_by_semantic_key.pop(semantic_key, None)
        if session is not None:
            active = session.get("active_requests")
            if isinstance(active, dict):
                active.pop(transfer_id, None)
            session["last_used_at"] = time.time()
            session["activity_generation"] = int(
                session.get("activity_generation") or 0
            ) + 1
    if not success:
        _resource_session_emit_failure(job, reason or "resource_request_failed", error)
    _resource_session_finish_followers(
        job,
        success,
        source_path=source_path,
        actual_hash=actual_hash,
        reason=reason,
    )
    if session is not None and session.get("closing") is not True:
        _resource_session_dispatch_peer_pending(
            str(session.get("peerPresenceHash") or ""),
            str(session.get("sessionLane") or "fast"),
        )
        _resource_session_schedule_idle_close(session)


def _resource_session_response_progress(job: Dict[str, Any], receipt) -> None:
    if job.get("completed") is True:
        return
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    try:
        progress = float(receipt.get_progress())
    except Exception:
        progress = 0.0
    if not _should_emit_qchat_file_progress(pending, progress):
        return
    _qchat_file_emit(
        "receiving",
        {
            "transferId": pending.get("transferId") or "",
            "peerPresenceHash": pending.get("peerPresenceHash") or "",
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "resourceType": pending.get("resourceType") or "",
            **_qchat_file_progress_payload(pending, progress, int(pending.get("size") or 0)),
        },
    )


def _resource_session_response_received(job: Dict[str, Any], receipt) -> None:
    if job.get("completed") is True:
        try:
            abandoned_response = receipt.get_response()
            if hasattr(abandoned_response, "close"):
                abandoned_response.close()
        except Exception:
            pass
        return
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    response = receipt.get_response()
    metadata = receipt.metadata if isinstance(getattr(receipt, "metadata", None), dict) else {}
    if not hasattr(response, "read"):
        reason = "resource_request_rejected"
        error = "Provider returned no resource"
        if isinstance(response, dict):
            reason = str(response.get("reason") or response.get("error") or reason)
            error = str(response.get("message") or response.get("error") or error)
        _resource_session_finish_job(job, False, reason=reason, error=error)
        return
    source_path = str(getattr(response, "name", "") or "")
    try:
        response.close()
    except Exception:
        pass
    transfer_id = str(pending.get("transferId") or "")
    expected_hash = str(pending.get("sha256") or "").strip().lower()
    expected_size = int(pending.get("size") or 0)
    pending_metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    variable_size = metadata.get("variableSize") is True or pending_metadata.get("variableSize") is True
    try:
        if not source_path or not os.path.isfile(source_path):
            raise RuntimeError("Reticulum response resource file is missing")
        metadata_transfer_id = str(metadata.get("transferId") or "")
        if metadata_transfer_id and metadata_transfer_id != transfer_id:
            raise RuntimeError("Reticulum response transfer id mismatch")
        actual_size = os.path.getsize(source_path)
        if expected_size > 0 and actual_size != expected_size and not variable_size:
            raise RuntimeError(
                f"Reticulum response size mismatch expected={expected_size} actual={actual_size}"
            )
        actual_hash = _sha256_file_hex(source_path)
        metadata_hash = str(metadata.get("sha256") or "").strip().lower()
        if metadata_hash and (
            len(metadata_hash) != 64
            or any(character not in "0123456789abcdef" for character in metadata_hash)
        ):
            raise RuntimeError("Reticulum response payload hash is invalid")
        if metadata_hash and actual_hash.lower() != metadata_hash:
            raise RuntimeError("Reticulum response metadata hash mismatch")
        if expected_hash and actual_hash.lower() != expected_hash:
            raise RuntimeError("Reticulum response hash mismatch")
        save_path = str(pending.get("savePath") or "")
        _move_file_to_save_path(source_path, save_path)
        peer_hash = str(pending.get("peerPresenceHash") or "").strip().lower()
        with _state_lock:
            _qchat_file_remove_pending_receive(peer_hash, transfer_id)
        _qchat_file_emit(
            "received",
            {
                **pending_metadata,
                "transferId": transfer_id,
                "peerPresenceHash": peer_hash,
                "fileName": pending.get("fileName") or "",
                "path": save_path,
                "sha256": actual_hash,
                "payloadHash": metadata_hash or actual_hash,
                "resourceType": pending.get("resourceType") or "",
            },
        )
        _resource_session_finish_job(
            job,
            True,
            source_path=save_path,
            actual_hash=actual_hash,
        )
    except Exception as exc:
        _resource_session_finish_job(job, False, reason="resource_response_invalid", error=str(exc))


def _resource_session_request_failed(job: Dict[str, Any], _receipt=None) -> None:
    _resource_session_finish_job(job, False, reason="resource_request_timeout")


def _resource_session_dispatch_job(state: Dict[str, Any], job: Dict[str, Any]) -> bool:
    if job.get("completed") is True:
        return False
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    transfer_id = str(pending.get("transferId") or "")
    link = state.get("link")
    if (
        link is None
        or state.get("established") is not True
        or state.get("remote_ready") is not True
        or state.get("closing") is True
    ):
        return False
    auth_age = max(0.0, time.time() - _resource_session_auth_timestamp_seconds(job))
    if auth_age > _RESOURCE_SESSION_AUTH_MAX_QUEUE_SECONDS:
        _resource_session_finish_job(
            job,
            False,
            reason="resource_auth_refresh_required",
            error=f"Authorization waited {int(auth_age)} seconds before dispatch",
        )
        return False
    request_data = {
        "version": 1,
        "transferId": transfer_id,
        "resourceType": pending.get("resourceType") or "",
        "metadata": pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {},
        "authMessage": pending.get("authMessage") if isinstance(pending.get("authMessage"), dict) else {},
    }
    job["session"] = state
    job["dispatched_at"] = time.time()
    with _state_lock:
        if (
            state.get("closing") is True
            or state.get("remote_ready") is not True
        ):
            return False
        active_requests = state.setdefault("active_requests", {})
        if transfer_id not in active_requests:
            active_requests[transfer_id] = job
        state["last_used_at"] = time.time()
        state["activity_generation"] = int(
            state.get("activity_generation") or 0
        ) + 1
    try:
        receipt = link.request(
            _RESOURCE_SESSION_REQUEST_PATH,
            data=request_data,
            response_callback=lambda value: _resource_session_response_received(job, value),
            failed_callback=lambda value: _resource_session_request_failed(job, value),
            progress_callback=lambda value: _resource_session_response_progress(job, value),
            timeout=_RESOURCE_SESSION_REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        _resource_session_finish_job(
            job,
            False,
            reason="resource_request_send_failed",
            error=str(exc),
        )
        return False
    if receipt is False:
        _resource_session_finish_job(job, False, reason="resource_request_send_failed")
        return False
    with _state_lock:
        cancelled_during_dispatch = job.get("cancelled") is True
        if not cancelled_during_dispatch:
            job["receipt"] = receipt
    if cancelled_during_dispatch:
        _resource_session_cancel_request_receipt(receipt, transfer_id)
        return False
    _qchat_file_emit(
        "auth_sent",
        {
            "transferId": transfer_id,
            "peerPresenceHash": pending.get("peerPresenceHash") or "",
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "resourceType": pending.get("resourceType") or "",
            "sessionLane": state.get("sessionLane") or "",
            "authAgeMs": int(auth_age * 1000),
        },
    )
    return True


def _resource_session_dispatch_pending(state: Dict[str, Any]) -> None:
    limit = (
        _RESOURCE_SESSION_FAST_CONCURRENCY
        if state.get("sessionLane") == "fast"
        else _RESOURCE_SESSION_BULK_CONCURRENCY
    )
    while True:
        with _state_lock:
            if (
                state.get("established") is not True
                or state.get("remote_ready") is not True
                or state.get("closing") is True
            ):
                return
            active_requests = state.setdefault("active_requests", {})
            if len(active_requests) >= limit:
                return
            job = _resource_session_pop_next_job_locked(state)
            if job is None:
                break
            if not isinstance(job, dict) or job.get("completed") is True:
                continue
            pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
            transfer_id = str(pending.get("transferId") or "")
            if not transfer_id:
                job["completed"] = True
                continue
            job["session"] = state
            active_requests[transfer_id] = job
        dispatched = _resource_session_dispatch_job(state, job)
        if not dispatched and job.get("completed") is not True:
            _resource_session_finish_job(
                job,
                False,
                reason="resource_session_unavailable",
            )


def _resource_session_note_failure(state: Dict[str, Any], reason: str) -> None:
    if state.get("incoming") is True:
        return
    session_key = str(state.get("sessionKey") or "")
    if not session_key:
        return
    with _state_lock:
        record = _resource_session_failures_by_key.setdefault(
            session_key,
            {"failures": 0, "backoff_until": 0.0},
        )
        failures = int(record.get("failures") or 0) + 1
        delay = _RESOURCE_SESSION_FAILURE_BACKOFF_SECONDS[
            min(failures - 1, len(_RESOURCE_SESSION_FAILURE_BACKOFF_SECONDS) - 1)
        ]
        record.update(
            {
                "failures": failures,
                "backoff_until": time.time() + delay,
                "last_reason": reason,
                "updated_at": time.time(),
            }
        )
        while len(_resource_session_failures_by_key) > _RESOURCE_SESSION_FAILURE_RECORD_MAX:
            oldest_key = min(
                _resource_session_failures_by_key,
                key=lambda key: float(
                    _resource_session_failures_by_key[key].get("updated_at") or 0
                ),
            )
            _resource_session_failures_by_key.pop(oldest_key, None)
    log(
        "[presence_bridge] resource_session_backoff "
        f"peer={str(state.get('peerPresenceHash') or '')[:16]} lane={state.get('sessionLane')} "
        f"failures={failures} retry_in_ms={int(delay * 1000)} reason={reason}"
    )


def _resource_session_fail_state(
    state: Dict[str, Any],
    reason: str,
    *,
    refresh_path: bool = False,
) -> None:
    with _state_lock:
        if state.get("closing") is True:
            return
        state["closing"] = True
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        pending_jobs = list(state.get("pending_jobs") or [])
        active_jobs = list((state.get("active_requests") or {}).values())
        state["pending_jobs"] = []
        state["active_requests"] = {}
        _resource_session_provider_capacity_condition.notify_all()
    _resource_session_note_failure(state, reason)
    _resource_session_emit_status(state, "failed", reason)
    _resource_session_remove_state(state)
    # Requests already handed to Reticulum are failed so their receipt cannot
    # race a replacement request. Higher layers retain completed byte ranges
    # and retry those in-flight jobs normally. Jobs which never left our queue
    # are safe to move to another pooled session without surfacing a failure.
    for job in active_jobs:
        if isinstance(job, dict):
            _resource_session_finish_job(job, False, reason=reason)
    requeued = 0
    for job in pending_jobs:
        if not isinstance(job, dict):
            continue
        attempts = int(job.get("sessionRequeues") or 0)
        can_requeue = (
            reason != "resource_session_stopped"
            and attempts < 2
            and time.time() - _resource_session_auth_timestamp_seconds(job)
            < _RESOURCE_SESSION_AUTH_MAX_QUEUE_SECONDS
        )
        if can_requeue:
            job["sessionRequeues"] = attempts + 1
            job.pop("session", None)
            queued, _queue_reason = _resource_session_enqueue_job(job)
            if queued:
                requeued += 1
                continue
        _resource_session_finish_job(job, False, reason=reason)
    if requeued:
        log(
            "[presence_bridge] resource_session_jobs_requeued "
            f"peer={peer_hash[:16]} lane={state.get('sessionLane')} jobs={requeued} reason={reason}"
        )
    if refresh_path and peer_hash:
        try:
            _force_overlay_peer_path_refresh(
                peer_hash,
                target="qchat-file-reticulum",
                reason=reason,
                cooldown_seconds=15.0,
                await_seconds=0.0,
            )
        except Exception as exc:
            log(
                "[presence_bridge] resource_session_path_refresh_failed "
                f"peer={peer_hash[:16]} reason={reason} err={exc}"
            )
    link = state.get("link")
    if link is not None:
        _teardown_reticulum_link_bounded(
            link,
            f"target=qchat-file-reticulum resource_session_fail reason={reason}",
        )


def _resource_session_open_timeout(state: Dict[str, Any]) -> None:
    if state.get("remote_ready") is True or state.get("closing") is True:
        return
    log(
        "[presence_bridge] resource_session_establish_timeout "
        f"peer={str(state.get('peerPresenceHash') or '')[:16]} lane={state.get('sessionLane')} "
        f"age_ms={int((time.time() - float(state.get('link_created_at') or time.time())) * 1000)}"
    )
    _resource_session_fail_state(
        state,
        "resource_session_establish_timeout",
        refresh_path=True,
    )


def _resource_session_create_link(state: Dict[str, Any], outbound) -> None:
    if state.get("closing") is True or state.get("link") is not None:
        return
    try:
        link = RNS.Link(
            outbound,
            established_callback=on_outgoing_resource_session_established,
            closed_callback=on_qchat_file_link_closed,
        )
        state["link"] = link
        state["link_created_at"] = time.time()
        state["peerDestinationHash"] = destination_hash_hex(outbound.hash)
        with _state_lock:
            _qchat_file_link_ids_by_object[id(link)] = str(state.get("linkId") or "")
        remaining_establish_seconds = max(
            1.0,
            _RESOURCE_SESSION_ESTABLISH_TIMEOUT_SECONDS
            - (time.time() - float(state.get("created_at") or time.time())),
        )
        timer = threading.Timer(
            remaining_establish_seconds,
            _resource_session_open_timeout,
            args=(state,),
        )
        timer.daemon = True
        state["establish_timer"] = timer
        timer.start()
        log(
            "[presence_bridge] resource_session_connecting "
            f"peer={str(state.get('peerPresenceHash') or '')[:16]} lane={state.get('sessionLane')}"
        )
    except Exception as exc:
        _resource_session_fail_state(state, "resource_session_open_failed")
        log(
            "[presence_bridge] resource_session_open_failed "
            f"peer={str(state.get('peerPresenceHash') or '')[:16]} err={exc}"
        )


def _resource_session_poll_path(state: Dict[str, Any]) -> None:
    if state.get("closing") is True or state.get("link") is not None:
        return
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    peer_identity = state.get("peerIdentity")
    try:
        outbound = build_outbound_destination(peer_identity)
        if destination_hash_hex(outbound.hash) != peer_hash:
            raise RuntimeError("Reticulum public key does not match destination hash")
        allow_refresh = state.get("failed_path_refresh_requested") is not True
        if allow_refresh and _peer_has_recent_unestablished_link_failure(peer_hash):
            state["failed_path_refresh_requested"] = True
        if _request_qchat_file_path(
            outbound.hash,
            peer_hash,
            allow_failed_path_refresh=allow_refresh,
        ):
            state.pop("path_timer", None)
            _resource_session_create_link(state, outbound)
            return
        if time.time() - float(state.get("path_wait_started_at") or time.time()) >= _RESOURCE_SESSION_PATH_WAIT_TIMEOUT_SECONDS:
            _resource_session_fail_state(
                state,
                "resource_session_path_timeout",
                refresh_path=True,
            )
            return
    except Exception as exc:
        _resource_session_fail_state(state, "resource_session_path_failed")
        log(
            "[presence_bridge] resource_session_path_failed "
            f"peer={peer_hash[:16]} err={exc}"
        )
        return
    timer = threading.Timer(
        _RESOURCE_SESSION_PATH_POLL_SECONDS,
        _resource_session_poll_path,
        args=(state,),
    )
    timer.daemon = True
    state["path_timer"] = timer
    timer.start()


def _resource_session_get_or_create(
    peer_hash: str,
    peer_identity,
    lane: str,
) -> Tuple[Optional[Dict[str, Any]], str]:
    peer_key = str(peer_hash or "").strip().lower()
    session_lane = "bulk" if lane == "bulk" else "fast"
    if not _valid_presence_destination_hash_hex(peer_key):
        return None, "unknown_peer_presence_hash"
    pool_size = _RESOURCE_SESSION_BULK_POOL_SIZE if session_lane == "bulk" else 1
    now = time.time()
    existing_states: List[Dict[str, Any]] = []
    available_slots: List[int] = []
    with _state_lock:
        for slot in range(pool_size):
            session_key = _resource_session_key(peer_key, session_lane, slot)
            session_id = _resource_sessions_by_key.get(session_key)
            state = _qchat_file_links_by_id.get(session_id) if session_id else None
            if isinstance(state, dict) and state.get("closing") is not True:
                existing_states.append(state)
                continue
            failure = _resource_session_failures_by_key.get(session_key)
            backoff_until = float((failure or {}).get("backoff_until") or 0)
            if backoff_until <= now:
                available_slots.append(slot)

        least_loaded = min(
            existing_states,
            key=lambda item: (
                len(item.get("active_requests") or {})
                + len(item.get("pending_jobs") or []),
                int(item.get("sessionSlot") or 0),
            ),
            default=None,
        )
        least_loaded_count = (
            len(least_loaded.get("active_requests") or {})
            + len(least_loaded.get("pending_jobs") or [])
            if isinstance(least_loaded, dict)
            else 0
        )
        if isinstance(least_loaded, dict) and (
            least_loaded_count == 0 or not available_slots
        ):
            if not least_loaded.get("peerIdentity") and peer_identity:
                least_loaded["peerIdentity"] = peer_identity
            least_loaded["last_used_at"] = now
            least_loaded["activity_generation"] = int(
                least_loaded.get("activity_generation") or 0
            ) + 1
            return least_loaded, ""

    if not available_slots:
        return None, "resource_session_backoff"
    session_slot = available_slots[0]
    session_key = _resource_session_key(peer_key, session_lane, session_slot)
    session_id = str(uuid.uuid4())
    state = {
        "linkId": session_id,
        "manager_kind": "resource_session",
        "sessionKey": session_key,
        "sessionLane": session_lane,
        "sessionSlot": session_slot,
        "peerPresenceHash": peer_key,
        "peerDestinationHash": peer_key,
        "peerIdentity": peer_identity,
        "incoming": False,
        "established": False,
        "remote_ready": False,
        "created_at": now,
        "last_used_at": now,
        "path_wait_started_at": now,
        "pending_jobs": [],
        "active_requests": {},
        "provider_active": 0,
        "generation": 1,
        "activity_generation": 1,
    }
    with _state_lock:
        existing_id = _resource_sessions_by_key.get(session_key)
        existing = _qchat_file_links_by_id.get(existing_id) if existing_id else None
        if isinstance(existing, dict) and existing.get("closing") is not True:
            return existing, ""
        _qchat_file_links_by_id[session_id] = state
        _resource_sessions_by_key[session_key] = session_id
    _resource_session_poll_path(state)
    return state, ""


def _resource_session_enqueue_job(job: Dict[str, Any]) -> Tuple[bool, str]:
    pending = job.get("pending") if isinstance(job.get("pending"), dict) else {}
    peer_hash = str(pending.get("peerPresenceHash") or "").strip().lower()
    metadata = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    lane = _resource_session_lane(
        str(pending.get("resourceType") or ""),
        str(metadata.get("logicalResourceType") or ""),
    )
    state, reason = _resource_session_get_or_create(
        peer_hash,
        pending.get("peerIdentity"),
        lane,
    )
    if not isinstance(state, dict):
        return False, reason or "resource_session_open_failed"
    with _state_lock:
        if state.get("closing") is True:
            return False, "resource_session_unavailable"
        session_key = str(state.get("sessionKey") or "")
        session_id = str(state.get("linkId") or "")
        if (
            not session_key
            or _resource_sessions_by_key.get(session_key) != session_id
            or _qchat_file_links_by_id.get(session_id) is not state
        ):
            return False, "resource_session_unavailable"
        pending_jobs = state.setdefault("pending_jobs", [])
        if (
            len(pending_jobs) >= _RESOURCE_SESSION_MAX_QUEUE_PER_LANE
            or _resource_session_total_queue_depth() >= _RESOURCE_SESSION_MAX_QUEUE_TOTAL
        ):
            return False, "resource_session_queue_full"
        job["session"] = state
        pending_jobs.append(job)
        state["last_used_at"] = time.time()
        state["activity_generation"] = int(
            state.get("activity_generation") or 0
        ) + 1
        _resource_session_cancel_timer(state, "idle_timer")
        pending_jobs.sort(
            key=lambda item: (
                _resource_session_job_priority(item),
                float(item.get("created_at") or 0),
            )
        )
    if state.get("remote_ready") is True:
        _resource_session_dispatch_peer_pending(peer_hash, lane)
    return True, ""


def _resource_session_accept(
    req_id: str,
    pending_receive: Dict[str, Any],
) -> None:
    transfer_id = str(pending_receive.get("transferId") or "")
    semantic_key = _resource_session_semantic_key(pending_receive)
    job = {
        "transferId": transfer_id,
        "peerPresenceHash": pending_receive.get("peerPresenceHash") or "",
        "pending": pending_receive,
        "semanticKey": semantic_key,
        "created_at": time.time(),
        "followers": [],
    }
    with _state_lock:
        if len(_resource_session_jobs_by_transfer) >= _RESOURCE_SESSION_MAX_QUEUE_TOTAL:
            _qchat_file_remove_pending_receive(
                str(pending_receive.get("peerPresenceHash") or "").strip().lower(),
                transfer_id,
            )
            emit_resp(
                req_id,
                False,
                payload={"code": "resource_session_queue_full"},
                error="Reticulum resource session queue is full",
            )
            return
        existing = _resource_session_jobs_by_semantic_key.get(semantic_key)
        if isinstance(existing, dict) and existing.get("completed") is not True:
            if len(existing.get("followers") or []) >= 32:
                _qchat_file_remove_pending_receive(
                    str(pending_receive.get("peerPresenceHash") or "").strip().lower(),
                    transfer_id,
                )
                emit_resp(
                    req_id,
                    False,
                    payload={"code": "resource_session_queue_full"},
                    error="Too many duplicate Reticulum resource requests",
                )
                return
            existing.setdefault("followers", []).append(job)
            _resource_session_jobs_by_transfer[transfer_id] = job
            _qchat_file_store_pending_receive(
                str(pending_receive.get("peerPresenceHash") or "").strip().lower(),
                pending_receive,
            )
            _qchat_file_emit(
                "accepted",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": pending_receive.get("peerPresenceHash") or "",
                    "fileName": pending_receive.get("fileName") or "",
                    "size": int(pending_receive.get("size") or 0),
                    "resourceType": pending_receive.get("resourceType") or "",
                    "deduplicated": True,
                },
            )
            emit_resp(req_id, True, payload={"queuedLinks": 0, "deduplicated": True})
            return
        _resource_session_jobs_by_semantic_key[semantic_key] = job
        _resource_session_jobs_by_transfer[transfer_id] = job
    queued, reason = _resource_session_enqueue_job(job)
    if not queued:
        with _state_lock:
            _resource_session_jobs_by_transfer.pop(transfer_id, None)
            if _resource_session_jobs_by_semantic_key.get(semantic_key) is job:
                _resource_session_jobs_by_semantic_key.pop(semantic_key, None)
            _qchat_file_remove_pending_receive(
                str(pending_receive.get("peerPresenceHash") or "").strip().lower(),
                transfer_id,
            )
        emit_resp(
            req_id,
            False,
            payload={"code": reason},
            error=reason.replace("_", " "),
        )
        return
    _qchat_file_emit(
        "accepted",
        {
            "transferId": transfer_id,
            "peerPresenceHash": pending_receive.get("peerPresenceHash") or "",
            "fileName": pending_receive.get("fileName") or "",
            "size": int(pending_receive.get("size") or 0),
            "resourceType": pending_receive.get("resourceType") or "",
            "sessionLane": _resource_session_lane(
                str(pending_receive.get("resourceType") or ""),
                str(
                    (
                        pending_receive.get("metadata")
                        if isinstance(pending_receive.get("metadata"), dict)
                        else {}
                    ).get("logicalResourceType")
                    or ""
                ),
            ),
            "queuedLinks": 1,
        },
    )
    emit_resp(req_id, True, payload={"queuedLinks": 1, "session": True})


def on_outgoing_resource_session_established(link) -> None:
    link_id = get_qchat_file_link_id(link)
    state = get_qchat_file_link_state(link_id) if link_id else None
    if not isinstance(state, dict) or state.get("manager_kind") != "resource_session":
        return
    configure_qchat_file_link(link, str(link_id))
    link.set_remote_identified_callback(on_qchat_file_link_remote_identified)
    with _state_lock:
        state["established"] = True
        state["remote_ready"] = False
        state["established_at"] = time.time()
        state["last_used_at"] = time.time()
        state["generation"] = int(state.get("generation") or 0) + 1
        state["activity_generation"] = int(
            state.get("activity_generation") or 0
        ) + 1
    session_key = str(state.get("sessionKey") or "")
    with _state_lock:
        _resource_session_failures_by_key.pop(session_key, None)
    try:
        if _identity is not None:
            link.identify(_identity)
    except Exception as exc:
        log(f"[presence_bridge] resource session identify failed link={link_id}: {exc}")
    hello = {
        "type": _RESOURCE_SESSION_HELLO_TYPE,
        "r": destination_hash_hex(_destination.hash) if _destination is not None else "",
        "lane": state.get("sessionLane") or "fast",
    }
    if not _send_packet_on_link(
        link,
        json.dumps(hello, separators=(",", ":")).encode("utf-8"),
        f"target=qchat-file-reticulum resource_session_hello peer={str(state.get('peerPresenceHash') or '')[:16]}",
    ):
        _resource_session_fail_state(state, "resource_session_hello_failed")
        return
    log(
        "[presence_bridge] resource_session_established "
        f"peer={str(state.get('peerPresenceHash') or '')[:16]} lane={state.get('sessionLane')} link={link_id}"
    )


def _resource_session_state_for_rns_link_id(rns_link_id: Any) -> Optional[Dict[str, Any]]:
    with _state_lock:
        for state in _qchat_file_links_by_id.values():
            if not isinstance(state, dict) or state.get("manager_kind") != "resource_session":
                continue
            link = state.get("link")
            if link is not None and getattr(link, "link_id", None) == rns_link_id:
                return state
    return None


def _resource_session_response_metadata(pending: Dict[str, Any]) -> Dict[str, Any]:
    resource_type = str(pending.get("resourceType") or "")
    metadata: Dict[str, Any] = {
        "kind": resource_type,
        "resourceType": resource_type,
        "transferId": pending.get("transferId") or "",
        "fileName": pending.get("fileName") or "",
        "size": int(pending.get("size") or 0),
        "sha256": pending.get("sha256") or "",
    }
    extra = pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {}
    for key, value in extra.items():
        metadata_key = str(key)
        if metadata_key in _QCHAT_FILE_RESERVED_METADATA_KEYS:
            metadata[f"app_{metadata_key}"] = value
        else:
            metadata[metadata_key] = value
    return metadata


def _resource_session_watch_provider_file(
    file_handle,
    transfer_id: str,
    pending: Dict[str, Any],
    state: Dict[str, Any],
    request_id: Any,
    provider_class: str,
) -> None:
    transfer_id = str(transfer_id or "").strip()
    peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    link = state.get("link")

    def watch() -> None:
        completed = False
        failure_reason = "resource_response_not_started"
        tracked_resource = None
        transfer_started = False
        last_progress = 0.0
        last_progress_at = time.monotonic()
        response_start_deadline = (
            last_progress_at
            + _RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS
        )
        try:
            while True:
                if tracked_resource is None and link is not None:
                    try:
                        outgoing_resources = list(
                            getattr(link, "outgoing_resources", None) or []
                        )
                    except Exception:
                        outgoing_resources = []
                    tracked_resource = next(
                        (
                            resource
                            for resource in outgoing_resources
                            if getattr(resource, "request_id", None) == request_id
                        ),
                        None,
                    )
                cancelled = pending.get("cancelled") is True
                session_closed = _shutdown.is_set() or state.get("closing") is True
                if (cancelled or session_closed) and tracked_resource is None:
                    if time.monotonic() < response_start_deadline:
                        time.sleep(0.01)
                        continue
                if cancelled:
                    failure_reason = "resource_response_cancelled"
                    break
                if session_closed:
                    failure_reason = "resource_session_closed"
                    break
                if tracked_resource is not None:
                    status = getattr(tracked_resource, "status", None)
                    if status == getattr(RNS.Resource, "COMPLETE", object()):
                        try:
                            segment_index = int(
                                getattr(tracked_resource, "segment_index", 1) or 1
                            )
                            total_segments = int(
                                getattr(tracked_resource, "total_segments", 1) or 1
                            )
                        except Exception:
                            segment_index = 1
                            total_segments = 1
                        if segment_index >= total_segments:
                            completed = True
                            break
                        next_segment = getattr(
                            tracked_resource,
                            "next_segment",
                            None,
                        )
                        if next_segment is not None:
                            tracked_resource = next_segment
                            transfer_started = True
                            try:
                                next_progress = float(
                                    tracked_resource.get_progress()
                                )
                            except Exception:
                                next_progress = 0.0
                            last_progress = (
                                max(0.0, next_progress)
                                if math.isfinite(next_progress)
                                else 0.0
                            )
                            last_progress_at = time.monotonic()
                            continue
                    if status in {
                        getattr(RNS.Resource, "FAILED", object()),
                        getattr(RNS.Resource, "CORRUPT", object()),
                        getattr(RNS.Resource, "REJECTED", object()),
                    }:
                        failure_reason = "resource_response_failed"
                        break
                    try:
                        progress = float(tracked_resource.get_progress())
                    except Exception:
                        progress = last_progress
                    if not math.isfinite(progress):
                        progress = last_progress
                    if progress > last_progress:
                        transfer_started = True
                        last_progress = progress
                        last_progress_at = time.monotonic()
                        with _state_lock:
                            state["last_used_at"] = time.time()
                            state["activity_generation"] = int(
                                state.get("activity_generation") or 0
                            ) + 1
                no_progress_timeout = (
                    _RESOURCE_SESSION_RESPONSE_STALL_TIMEOUT_SECONDS
                    if transfer_started
                    else _RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS
                )
                if time.monotonic() - last_progress_at >= no_progress_timeout:
                    failure_reason = (
                        "resource_response_stalled"
                        if transfer_started
                        else "resource_response_not_started"
                    )
                    break
                time.sleep(0.1)
        finally:
            cancelled = pending.get("cancelled") is True
            if not completed and tracked_resource is not None:
                try:
                    tracked_resource.cancel()
                except Exception:
                    pass
            if not completed and not getattr(file_handle, "closed", True):
                try:
                    file_handle.close()
                except Exception:
                    pass
            with _state_lock:
                current = _qchat_file_pending_sends_by_transfer.get(transfer_id)
                if current is pending:
                    _qchat_file_pending_sends_by_transfer.pop(transfer_id, None)
                # This watcher owns the in-flight admission even if a newer
                # registration replaced the pending metadata for a retry.
                _resource_session_provider_inflight_transfers.discard(transfer_id)
                state["provider_active"] = max(
                    0,
                    int(state.get("provider_active") or 0) - 1,
                )
                state["last_used_at"] = time.time()
                state["activity_generation"] = int(
                    state.get("activity_generation") or 0
                ) + 1
                _resource_session_provider_capacity_condition.notify_all()
            _resource_session_provider_release_capacity(
                provider_class,
                peer_hash,
            )
            _resource_session_schedule_idle_close(state)
            if not cancelled:
                _qchat_file_emit(
                    "sent" if completed else "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": pending.get("allowedRecipientAddress") or "",
                        "fileName": pending.get("fileName") or "",
                        "size": int(pending.get("size") or 0),
                        "resourceType": pending.get("resourceType") or "",
                        **({} if completed else {"reason": failure_reason}),
                    },
                )

    thread = threading.Thread(
        target=watch,
        name=f"resource-response-{transfer_id[:8]}",
        daemon=True,
    )
    thread.start()


def _resource_session_response_generator(
    _path,
    request_data,
    request_id,
    rns_link_id,
    remote_identity,
    _requested_at,
):
    provider_capacity_acquired = False
    provider_capacity_transferred = False
    provider_session_active = False
    provider_session_active_transferred = False
    provider_class = "history"
    waiter: Optional[Dict[str, Any]] = None
    waiter_key = ""
    try:
        if not isinstance(request_data, dict):
            return {"ok": False, "reason": "invalid_resource_request"}
        if request_data.get("version") != 1:
            return {"ok": False, "reason": "unsupported_resource_request_version"}
        transfer_id = str(request_data.get("transferId") or "").strip()
        auth = request_data.get("authMessage")
        metadata = request_data.get("metadata") if isinstance(request_data.get("metadata"), dict) else {}
        resource_type = str(request_data.get("resourceType") or "").strip()
        if not transfer_id or not isinstance(auth, dict) or not _qchat_file_is_managed_resource_type(resource_type):
            return {"ok": False, "reason": "invalid_resource_request"}
        try:
            encoded_size = len(json.dumps(request_data, separators=(",", ":")).encode("utf-8"))
        except Exception:
            return {"ok": False, "reason": "invalid_resource_request"}
        if encoded_size > 64 * 1024:
            return {"ok": False, "reason": "resource_request_too_large"}
        state = _resource_session_state_for_rns_link_id(rns_link_id)
        if state is None:
            return {"ok": False, "reason": "unknown_resource_session"}
        expected_lane = _resource_session_lane(
            resource_type,
            str(metadata.get("logicalResourceType") or ""),
        )
        if state.get("sessionLane") != expected_lane:
            return {"ok": False, "reason": "resource_session_lane_mismatch"}
        if remote_identity is None:
            return {"ok": False, "reason": "resource_peer_unidentified"}
        try:
            identified_peer_hash = _destination_hash_for_identity(remote_identity)
        except Exception:
            return {"ok": False, "reason": "resource_peer_identity_invalid"}
        claimed_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if claimed_peer_hash and claimed_peer_hash != identified_peer_hash:
            return {"ok": False, "reason": "resource_peer_identity_mismatch"}
        link_slot_reason = _resource_session_provider_acquire_link_slot(
            state,
            transfer_id,
            identified_peer_hash,
        )
        if link_slot_reason:
            return {"ok": False, "reason": link_slot_reason}
        provider_session_active = True
        waiter_key = _resource_session_waiter_key(
            str(state.get("linkId") or ""),
            transfer_id,
        )
        provider_class = _resource_session_provider_class(
            resource_type,
            str(metadata.get("logicalResourceType") or ""),
        )
        waiter = {
            "event": threading.Event(),
            "authorized": False,
            "reason": "resource_authorization_timeout",
            "linkId": str(state.get("linkId") or ""),
            "transferId": transfer_id,
            "peerPresenceHash": identified_peer_hash,
            "providerClass": provider_class,
        }
        with _state_lock:
            link_id = str(state.get("linkId") or "")
            if (
                state.get("incoming") is not True
                or state.get("closing") is True
                or state.get("provider_ready_sent") is not True
                or _qchat_file_links_by_id.get(link_id) is not state
            ):
                return {"ok": False, "reason": "resource_session_unavailable"}
            if _resource_session_provider_was_cancelled_locked(
                identified_peer_hash,
                transfer_id,
            ):
                return {"ok": False, "reason": "resource_requester_cancelled"}
            if (
                waiter_key in _resource_session_provider_waiters
                or transfer_id in _resource_session_provider_inflight_transfers
            ):
                return {"ok": False, "reason": "duplicate_resource_request"}
            peer_pending_auth = int(
                _resource_session_provider_pending_auth_by_peer.get(
                    identified_peer_hash,
                    0,
                )
                or 0
            )
            if (
                len(_resource_session_provider_waiters)
                >= _RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX
                or peer_pending_auth
                >= _RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX_PER_PEER
            ):
                return {"ok": False, "reason": "resource_provider_busy"}
            state["peerPresenceHash"] = identified_peer_hash
            state["peerDestinationHash"] = identified_peer_hash
            _resource_session_provider_waiters[waiter_key] = waiter
            _resource_session_provider_inflight_transfers.add(transfer_id)
            _resource_session_provider_pending_auth_by_peer[identified_peer_hash] = (
                peer_pending_auth + 1
            )
        _resource_session_cancel_timer(state, "idle_timer")
        _qchat_file_emit(
            "auth",
            {
                "linkId": link_id,
                "transferId": transfer_id,
                "peerPresenceHash": state.get("peerPresenceHash") or "",
                "auth": auth,
                "resourceType": resource_type,
                "eventId": auth.get("eventId") or auth.get("id") or metadata.get("eventId"),
                "groupId": auth.get("groupId") or auth.get("g") or metadata.get("groupId"),
                "metadata": metadata,
                "sessionLane": state.get("sessionLane") or "",
            },
        )
        if not waiter["event"].wait(_RESOURCE_SESSION_PROVIDER_AUTH_TIMEOUT_SECONDS):
            return {"ok": False, "reason": "resource_authorization_timeout"}
        if waiter.get("authorized") is not True:
            return {"ok": False, "reason": str(waiter.get("reason") or "resource_request_rejected")}
        _resource_session_provider_release_auth_admission(waiter_key, waiter)
        with _state_lock:
            pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
        if not isinstance(pending, dict):
            return {"ok": False, "reason": "resource_not_registered"}
        pending_metadata = (
            pending.get("metadata")
            if isinstance(pending.get("metadata"), dict)
            else {}
        )
        provider_class = _resource_session_provider_class(
            str(pending.get("resourceType") or ""),
            str(pending_metadata.get("logicalResourceType") or ""),
        )
        allowed_recipient = str(pending.get("allowedRecipientAddress") or "").strip().lower()
        peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
        if allowed_recipient and peer_hash and allowed_recipient != peer_hash:
            return {"ok": False, "reason": "resource_recipient_mismatch"}
        if float(pending.get("expires_at") or 0) < time.time():
            return {"ok": False, "reason": "resource_transfer_expired"}
        file_path = str(pending.get("filePath") or "")
        if not os.path.isfile(file_path):
            return {"ok": False, "reason": "resource_file_missing"}
        provider_capacity_acquired = _resource_session_provider_acquire_capacity(
            provider_class,
            transfer_id,
            pending,
            state,
        )
        if not provider_capacity_acquired:
            return {"ok": False, "reason": "resource_provider_busy"}
        if pending.get("cancelled") is True:
            return {"ok": False, "reason": "resource_requester_cancelled"}
        if state.get("closing") is True:
            return {"ok": False, "reason": "resource_session_unavailable"}
        file_handle = open(file_path, "rb")
        try:
            response_metadata = _resource_session_response_metadata(pending)
            _qchat_file_emit(
                "sending",
                {
                    "transferId": transfer_id,
                    "peerPresenceHash": peer_hash,
                    "fileName": pending.get("fileName") or "",
                    "size": int(pending.get("size") or 0),
                    "resourceType": pending.get("resourceType") or "",
                    "sessionLane": state.get("sessionLane") or "",
                },
            )
            _resource_session_watch_provider_file(
                file_handle,
                transfer_id,
                pending,
                state,
                request_id,
                provider_class,
            )
        except Exception:
            file_handle.close()
            raise
        provider_capacity_transferred = True
        provider_session_active_transferred = True
        waiter["response_started"] = True
        return (file_handle, response_metadata)
    except Exception as exc:
        log(f"[presence_bridge] resource_session_provider_error err={exc}")
        return {"ok": False, "reason": "resource_provider_error"}
    finally:
        if (
            isinstance(waiter, dict)
            and waiter.get("authorized") is True
            and waiter.get("response_started") is not True
        ):
            transfer_id = str(waiter.get("transferId") or "")
            with _state_lock:
                abandoned = _qchat_file_pending_sends_by_transfer.pop(
                    transfer_id,
                    None,
                )
            if isinstance(abandoned, dict):
                _qchat_file_emit(
                    "failed",
                    {
                        "transferId": transfer_id,
                        "peerPresenceHash": abandoned.get("allowedRecipientAddress") or "",
                        "fileName": abandoned.get("fileName") or "",
                        "size": int(abandoned.get("size") or 0),
                        "resourceType": abandoned.get("resourceType") or "",
                        "reason": "resource_response_not_started",
                    },
                )
        _resource_session_provider_release_auth_admission(waiter_key, waiter)
        if (
            provider_session_active
            and "state" in locals()
            and isinstance(state, dict)
            and not provider_session_active_transferred
        ):
            with _state_lock:
                state["provider_active"] = max(
                    0,
                    int(state.get("provider_active") or 0) - 1,
                )
                state["last_used_at"] = time.time()
                state["activity_generation"] = int(
                    state.get("activity_generation") or 0
                ) + 1
                _resource_session_provider_capacity_condition.notify_all()
            _resource_session_schedule_idle_close(state)
        if provider_capacity_acquired and not provider_capacity_transferred:
            _resource_session_provider_release_capacity(
                provider_class,
                str(state.get("peerPresenceHash") or "").strip().lower()
                if "state" in locals() and isinstance(state, dict)
                else "",
            )
        if not provider_session_active_transferred:
            with _state_lock:
                _resource_session_provider_inflight_transfers.discard(
                    str(waiter.get("transferId") or "")
                    if isinstance(waiter, dict)
                    else ""
                )


def handle_prepare_reticulum_resource_session(
    req_id: str,
    payload: Dict[str, Any],
) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    peer_identity_public_key = payload.get("reticulumIdentityPublicKeyBase64")
    resource_type = str(payload.get("resourceType") or "").strip()
    logical_resource_type = str(payload.get("logicalResourceType") or "").strip()
    if not _qchat_file_is_managed_resource_type(resource_type):
        emit_resp(
            req_id,
            False,
            payload={"code": "unsupported_resource_type"},
            error="Unsupported Reticulum resource session type",
        )
        return
    try:
        if (
            not isinstance(peer_identity_public_key, str)
            or not peer_identity_public_key.strip()
        ):
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
            peer_identity = _known_peers.get(peer_hash)
            if peer_identity is None:
                raise ValueError("Missing Reticulum identity for resource session peer")
        else:
            peer_identity = _parse_qchat_file_peer_identity(
                peer_hash,
                peer_identity_public_key,
            )
    except Exception as exc:
        emit_resp(
            req_id,
            False,
            payload={"code": "bad_reticulum_identity"},
            error=str(exc),
        )
        return
    lane = _resource_session_lane(resource_type, logical_resource_type)
    state, reason = _resource_session_get_or_create(
        peer_hash,
        peer_identity,
        lane,
    )
    if not isinstance(state, dict):
        emit_resp(
            req_id,
            False,
            payload={"code": reason or "resource_session_open_failed"},
            error="Unable to prepare Reticulum resource session",
        )
        return
    emit_resp(
        req_id,
        True,
        payload={
            "status": "ready" if state.get("remote_ready") is True else "pending",
            "peerPresenceHash": peer_hash,
            "lane": lane,
            "linkId": str(state.get("linkId") or ""),
        },
    )


def handle_accept_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    pk_b64 = payload.get("reticulumIdentityPublicKeyBase64")
    auth_message = payload.get("authMessage")
    transfer_id = str(payload.get("transferId") or "").strip()
    save_path = str(payload.get("savePath") or "").strip()
    file_name = str(payload.get("fileName") or "").strip()
    sha256 = str(payload.get("sha256") or "").strip().lower()
    resource_type = str(payload.get("resourceType") or "qchat-dm-file").strip() or "qchat-dm-file"
    stream_mode = (payload.get("streamMode") is True) and not _qchat_file_is_managed_resource_type(resource_type)
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
    use_resource_session = _qchat_file_is_managed_resource_type(resource_type)
    bridge_chunked = (
        False
        if use_resource_session
        else _qchat_file_should_bridge_chunk_resource(resource_type, stream_mode)
    )
    try:
        if (
            (
                resource_type == _RETICULUM_CHAT_RESOURCE_TYPE
                or _qchat_file_is_managed_resource_type(resource_type)
            )
            and (not isinstance(pk_b64, str) or not pk_b64.strip())
        ):
            ensure_known_peer_from_recall(peer_hash, "ts_seed")
            peer_identity = _known_peers.get(peer_hash)
            if peer_identity is None:
                raise ValueError("Missing Reticulum identity for chat resource peer")
        else:
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
        pending_receive = {
            "peerPresenceHash": peer_hash,
            "transferId": transfer_id,
            "savePath": save_path,
            "fileName": file_name,
            "size": size,
            "sha256": sha256,
            "resourceType": resource_type,
            "streamMode": stream_mode,
            "bridgeChunked": bridge_chunked,
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
            "peerIdentity": peer_identity,
            "authMessage": auth_message,
            "received_bytes": 0,
            "active_chunks": {},
            "completed_chunks": set(),
            "chunk_attempts": {},
            "chunk_lock": threading.RLock(),
            "expires_at": time.time() + 15 * 60,
        }
        _qchat_file_store_pending_receive(peer_hash, pending_receive)
    if use_resource_session:
        _resource_session_accept(req_id, pending_receive)
        return
    links_to_open = 1 if not bridge_chunked else min(_QCHAT_FILE_PARALLEL_LINKS, max(1, _qchat_file_chunk_count(size)))
    queued_links = 0
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
            "resourceType": resource_type,
            "streamMode": stream_mode,
            "bridgeChunked": bridge_chunked,
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
            "peerIdentity": peer_identity,
            "authMessage": auth_message,
            "receive_root": pending_receive,
            "created_at": time.time(),
        }
        if _open_qchat_file_link_async(state):
            queued_links += 1
    if queued_links <= 0:
        with _state_lock:
            _qchat_file_remove_pending_receive(peer_hash, transfer_id)
        emit_resp(
            req_id,
            False,
            payload={"code": "resource_open_queue_full"},
            error="Reticulum resource open queue is full",
        )
        return
    _qchat_file_emit(
        "accepted",
        {
            "transferId": transfer_id,
            "peerPresenceHash": peer_hash,
            "fileName": file_name,
            "size": size,
            "resourceType": resource_type,
            "queuedLinks": queued_links,
        },
    )
    emit_resp(req_id, True, payload={"queuedLinks": queued_links})


def handle_send_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    transfer_id = str(payload.get("transferId") or "").strip()
    allowed_recipient = str(payload.get("allowedRecipientAddress") or "").strip()
    file_path = str(payload.get("filePath") or "").strip()
    file_name = str(payload.get("fileName") or os.path.basename(file_path)).strip()
    sha256 = str(payload.get("sha256") or "").strip().lower()
    resource_type = str(payload.get("resourceType") or "qchat-dm-file").strip() or "qchat-dm-file"
    stream_mode = (payload.get("streamMode") is True) and not _qchat_file_is_managed_resource_type(resource_type)
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
                "transferId": transfer_id,
                "allowedRecipientAddress": allowed_recipient,
                "filePath": file_path,
                "fileName": file_name,
                "size": size,
                "sha256": sha256,
                "resourceType": resource_type,
                "streamMode": stream_mode,
                "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
                "created_at": time.time(),
                "expires_at": expires_at,
                "next_chunk_index": 0,
                "sent_bytes": 0,
                "active_chunks": {},
                "completed_chunks": set(),
                "retry_chunks": [],
                "send_attempts": {},
            }
        _qchat_file_emit(
            "registered",
            {
                "transferId": transfer_id,
                "fileName": file_name,
                "size": size,
                "resourceType": resource_type,
            },
        )
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def _resource_session_abandon_late_pending_send(
    transfer_id: str,
    reason: str,
) -> bool:
    """Discard a send registered after its resource request already ended."""
    with _state_lock:
        if transfer_id in _resource_session_provider_inflight_transfers:
            return False
        pending = _qchat_file_pending_sends_by_transfer.pop(transfer_id, None)
        if not isinstance(pending, dict):
            return False
        pending["cancelled"] = True
    _qchat_file_emit(
        "failed",
        {
            "transferId": transfer_id,
            "peerPresenceHash": pending.get("allowedRecipientAddress") or "",
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "resourceType": pending.get("resourceType") or "",
            "reason": reason,
        },
    )
    return True


def handle_authorize_qchat_file_resource(req_id: str, payload: Dict[str, Any]) -> None:
    link_id = str(payload.get("linkId") or "").strip()
    transfer_id = str(payload.get("transferId") or "").strip()
    if not link_id or not transfer_id:
        emit_resp(req_id, False, error="Missing linkId or transferId")
        return
    state = get_qchat_file_link_state(link_id)
    if state is None:
        _resource_session_abandon_late_pending_send(
            transfer_id,
            "resource_authorization_session_closed",
        )
        emit_resp(req_id, False, payload={"code": "unknown_link_id"}, error="Unknown link id")
        return
    with _state_lock:
        pending = _qchat_file_pending_sends_by_transfer.get(transfer_id)
    if not pending:
        emit_resp(req_id, False, payload={"code": "unknown_transfer_id"}, error="Unknown transfer id")
        return
    allowed_recipient = str(pending.get("allowedRecipientAddress") or "").strip().lower()
    link_peer_hash = str(state.get("peerPresenceHash") or "").strip().lower()
    if allowed_recipient and link_peer_hash and allowed_recipient != link_peer_hash:
        emit_resp(
            req_id,
            False,
            payload={"code": "recipient_mismatch"},
            error="Resource recipient mismatch",
        )
        return
    if float(pending.get("expires_at") or 0) < time.time():
        emit_resp(req_id, False, payload={"code": "transfer_expired"}, error="Transfer expired")
        return
    if state.get("manager_kind") == "resource_session":
        waiter_key = _resource_session_waiter_key(link_id, transfer_id)
        with _state_lock:
            waiter = _resource_session_provider_waiters.get(waiter_key)
        if not isinstance(waiter, dict):
            _resource_session_abandon_late_pending_send(
                transfer_id,
                "resource_authorization_no_longer_active",
            )
            emit_resp(
                req_id,
                False,
                payload={"code": "unknown_resource_request"},
                error="Unknown resource session request",
            )
            return
        waiter["authorized"] = True
        waiter["reason"] = ""
        waiter["event"].set()
        _qchat_file_emit(
            "authorized",
            {
                "transferId": transfer_id,
                "peerPresenceHash": link_peer_hash,
                "fileName": pending.get("fileName") or "",
                "size": int(pending.get("size") or 0),
                "resourceType": pending.get("resourceType") or "",
                "sessionLane": state.get("sessionLane") or "",
            },
        )
        emit_resp(req_id, True)
        return
    state.update(
        {
            "filePath": pending.get("filePath") or "",
            "fileName": pending.get("fileName") or "",
            "size": int(pending.get("size") or 0),
            "sha256": pending.get("sha256") or "",
            "resourceType": pending.get("resourceType") or "qchat-dm-file",
            "streamMode": pending.get("streamMode") is True,
            "metadata": pending.get("metadata") if isinstance(pending.get("metadata"), dict) else {},
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
        if state.get("streamMode") is True:
            _qchat_file_start_channel_stream_sender(state)
        else:
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
    if state.get("manager_kind") == "resource_session":
        waiter_key = _resource_session_waiter_key(link_id, transfer_id)
        with _state_lock:
            waiter = _resource_session_provider_waiters.get(waiter_key)
        if not isinstance(waiter, dict):
            emit_resp(
                req_id,
                False,
                payload={"code": "unknown_resource_request"},
                error="Unknown resource session request",
            )
            return
        waiter["authorized"] = False
        waiter["reason"] = reason
        waiter["event"].set()
        emit_resp(req_id, True)
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
            _teardown_reticulum_link_bounded(
                link,
                f"target=qchat-file-reticulum auth_result_reject_close transfer={transfer_id}",
            )
        emit_resp(req_id, True)
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_accept_reticulum_chat_resource(req_id: str, payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["resourceType"] = _RETICULUM_CHAT_RESOURCE_TYPE
    metadata = next_payload.get("metadata") if isinstance(next_payload.get("metadata"), dict) else {}
    next_payload["metadata"] = {**metadata, "resourceType": _RETICULUM_CHAT_RESOURCE_TYPE}
    handle_accept_qchat_file_resource(req_id, next_payload)


def handle_send_reticulum_chat_resource(req_id: str, payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["resourceType"] = _RETICULUM_CHAT_RESOURCE_TYPE
    metadata = next_payload.get("metadata") if isinstance(next_payload.get("metadata"), dict) else {}
    next_payload["metadata"] = {**metadata, "resourceType": _RETICULUM_CHAT_RESOURCE_TYPE}
    handle_send_qchat_file_resource(req_id, next_payload)


def handle_authorize_reticulum_chat_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_authorize_qchat_file_resource(req_id, payload)


def handle_reject_reticulum_chat_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_reject_qchat_file_resource(req_id, payload)


def _generic_reticulum_resource_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    next_payload = dict(payload)
    logical_resource_type = str(next_payload.get("resourceType") or "").strip()
    effective_resource_type = logical_resource_type or _RETICULUM_RESOURCE_TYPE
    next_payload["resourceType"] = effective_resource_type
    metadata = next_payload.get("metadata") if isinstance(next_payload.get("metadata"), dict) else {}
    next_metadata = {
        **metadata,
        "resourceType": effective_resource_type,
        "wireResourceType": _RETICULUM_RESOURCE_TYPE,
    }
    if effective_resource_type != _RETICULUM_RESOURCE_TYPE:
        next_metadata["logicalResourceType"] = logical_resource_type
    next_payload["metadata"] = next_metadata
    return next_payload


def handle_accept_reticulum_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_accept_qchat_file_resource(req_id, _generic_reticulum_resource_payload(payload))


def handle_send_reticulum_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_send_qchat_file_resource(req_id, _generic_reticulum_resource_payload(payload))


def handle_authorize_reticulum_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_authorize_qchat_file_resource(req_id, payload)


def handle_reject_reticulum_resource(req_id: str, payload: Dict[str, Any]) -> None:
    handle_reject_qchat_file_resource(req_id, payload)


def handle_cancel_reticulum_resource(req_id: str, payload: Dict[str, Any]) -> None:
    transfer_id = str(payload.get("transferId") or "").strip()
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    reason = str(payload.get("reason") or "cancelled").strip() or "cancelled"
    if not transfer_id:
        emit_resp(req_id, False, error="Missing transferId")
        return
    try:
        closed_links = _qchat_file_cancel_transfer(transfer_id, peer_hash, reason)
        emit_resp(req_id, True, payload={"closedLinks": closed_links})
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

        messages, encoded_frames, message_types, suppressed_relay_duplicates = (
            _filter_new_call_relay_frames(
                "call", messages, encoded_frames, message_types
            )
        )
        if not encoded_frames:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": 0,
                    "fanoutHashes": [],
                    "suppressedDuplicateRelay": suppressed_relay_duplicates,
                },
            )
            return

        peer_hashes = _snapshot_established_overlay_neighbor_hashes(exclude_hashes)
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
            f"message_types={','.join(t or '?' for t in message_types)} "
            f"suppressed_duplicate_relay={suppressed_relay_duplicates}"
        )

        any_peer_full_delivery = False
        last_failure_payload = {"code": "packet_send_false"}
        last_failure_error = "Packet send returned False"
        saw_failure = False
        delivered_peer_hashes: list[str] = []

        for peer_hash in peer_hashes:
            peer_delivered_all_frames = True
            for index, wire_bytes in enumerate(encoded_frames):
                if not _send_wire_to_established_overlay_peer(
                    peer_hash,
                    wire_bytes,
                    "call_signal_fanout",
                ):
                    saw_failure = True
                    peer_delivered_all_frames = False
                    last_failure_payload = {"code": "packet_send_false"}
                    last_failure_error = "Packet send returned False"
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
                delivered_peer_hashes.append(peer_hash)

        if any_peer_full_delivery:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": len(delivered_peer_hashes),
                    "fanoutHashes": delivered_peer_hashes,
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

        messages, encoded_frames, message_types, suppressed_relay_duplicates = (
            _filter_new_call_relay_frames(
                "group", messages, encoded_frames, message_types
            )
        )
        if not encoded_frames:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": 0,
                    "fanoutHashes": [],
                    "suppressedDuplicateRelay": suppressed_relay_duplicates,
                },
            )
            return

        peer_hashes = _snapshot_established_overlay_neighbor_hashes(exclude_hashes)
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
            f"message_types={','.join(t or '?' for t in message_types)} "
            f"suppressed_duplicate_relay={suppressed_relay_duplicates}"
        )

        any_peer_full_delivery = False
        last_failure_payload = {"code": "packet_send_false"}
        last_failure_error = "Packet send returned False"
        saw_failure = False
        delivered_peer_hashes: list[str] = []

        for peer_hash in peer_hashes:
            peer_delivered_all_frames = True
            for index, wire_bytes in enumerate(encoded_frames):
                if not _send_wire_to_established_overlay_peer(
                    peer_hash,
                    wire_bytes,
                    "group_signal_fanout",
                ):
                    saw_failure = True
                    peer_delivered_all_frames = False
                    last_failure_payload = {"code": "packet_send_false"}
                    last_failure_error = "Packet send returned False"
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
                delivered_peer_hashes.append(peer_hash)

        if any_peer_full_delivery:
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": len(delivered_peer_hashes),
                    "fanoutHashes": delivered_peer_hashes,
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


def handle_send_reticulum_chat(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "")
    msg = payload.get("message")
    if not peer_hash or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHash or message")
        return
    if msg.get("t") != _RETICULUM_CHAT_WIRE_TYPE:
        emit_resp(req_id, False, error="Invalid Reticulum chat wire type")
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
        failure = _send_group_signal_wire_to_peer(peer_key, encoded["wire_bytes"])
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


def handle_send_reticulum_chat_targets(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hashes_raw = payload.get("peerPresenceHashes")
    msg = payload.get("message")
    if not isinstance(peer_hashes_raw, list) or not isinstance(msg, dict):
        emit_resp(req_id, False, error="Missing peerPresenceHashes or message")
        return
    peer_hashes = list(
        dict.fromkeys(
            str(peer_hash).strip().lower()
            for peer_hash in peer_hashes_raw[:_RETICULUM_CHAT_TARGET_BATCH_MAX]
            if isinstance(peer_hash, str) and peer_hash.strip()
        )
    )
    if not peer_hashes:
        emit_resp(req_id, False, error="Missing peerPresenceHashes")
        return
    if msg.get("t") != _RETICULUM_CHAT_WIRE_TYPE:
        emit_resp(req_id, False, error="Invalid Reticulum chat wire type")
        return
    if _destination is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "bridge_not_started"},
            error="Bridge not started",
        )
        return
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
        delivered: List[str] = []
        failures: List[Dict[str, str]] = []
        for peer_hash in peer_hashes:
            failure = _prepare_group_signal_peer(peer_hash)
            if failure is None:
                failure = _send_group_signal_wire_to_peer(
                    peer_hash,
                    encoded["wire_bytes"],
                )
            if failure is None:
                delivered.append(peer_hash)
                continue
            failure_payload = failure.get("payload")
            code = (
                str(failure_payload.get("code") or "packet_send_false")
                if isinstance(failure_payload, dict)
                else "packet_send_false"
            )
            failures.append(
                {
                    "peerPresenceHash": peer_hash,
                    "code": code,
                    "error": str(failure.get("error") or "Packet send returned False"),
                }
            )
        emit_resp(
            req_id,
            True,
            payload={
                "deliveredPeerHashes": delivered,
                "failures": failures,
            },
        )
    except Exception as exc:
        emit_resp(req_id, False, error=str(exc))


def handle_fanout_reticulum_chat(req_id: str, payload: Dict[str, Any]) -> None:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or any(
        not isinstance(msg, dict) for msg in messages
    ):
        emit_resp(req_id, False, error="Missing messages")
        return
    if any(msg.get("t") != _RETICULUM_CHAT_WIRE_TYPE for msg in messages):
        emit_resp(req_id, False, error="Invalid Reticulum chat wire type")
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
        message_keys = []
        message_digest_fingerprints = []
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
            message_type = str(msg.get("k") or "?")
            message_types.append(message_type)
            digest_fingerprint = _reticulum_chat_digest_fingerprint(msg)
            message_digest_fingerprints.append(digest_fingerprint)
            if message_type == "group_digest":
                latest = msg.get("latest")
                latest_id = (
                    str(latest.get("id") or "")[:12]
                    if isinstance(latest, dict)
                    else ""
                )
                digest_hash = str(msg.get("digestHash") or "")[:12]
                message_keys.append(
                    "group_digest:"
                    f"g={msg.get('g')}:"
                    f"h={digest_hash or '-'}:"
                    f"latest={latest_id or '-'}"
                )
            elif message_type == "group_sub":
                groups = msg.get("groups")
                group_ids = (
                    ",".join(str(group_id) for group_id in groups[:8])
                    if isinstance(groups, list)
                    else ""
                )
                more = (
                    "+"
                    if isinstance(groups, list) and len(groups) > 8
                    else ""
                )
                message_keys.append(
                    f"group_sub:mode={msg.get('mode')}:groups={group_ids}{more}"
                )
            elif "g" in msg:
                message_keys.append(f"{message_type}:g={msg.get('g')}")
            else:
                message_keys.append(message_type)

        soft_peer_hashes = _resolve_overlay_neighbor_hashes(
            exclude_hashes,
            established_only=False,
        )
        if not soft_peer_hashes:
            _promote_recent_verified_overlay_neighbors(
                "reticulum_chat_fanout",
                set(exclude_hashes),
            )
            soft_peer_hashes = _resolve_overlay_neighbor_hashes(
                exclude_hashes,
                established_only=False,
            )
        reliable_peer_hashes = _resolve_overlay_neighbor_hashes(
            exclude_hashes,
            established_only=True,
        )

        reliable_indices = [
            index
            for index, message_type in enumerate(message_types)
            if message_type not in _RETICULUM_CHAT_SOFT_FANOUT_TYPES
        ]
        soft_indices = [
            index
            for index, message_type in enumerate(message_types)
            if message_type in _RETICULUM_CHAT_SOFT_FANOUT_TYPES
        ]

        if soft_indices and not soft_peer_hashes:
            emit_resp(
                req_id,
                False,
                payload={"code": "no_route"},
                error="No overlay route",
            )
            return
        if reliable_indices and not reliable_peer_hashes:
            log(
                "[presence_bridge] target=reticulum-chat reliable_fanout_no_established_route "
                f"exclude_hashes={','.join(exclude_hashes)} "
                f"message_types={','.join(message_types)} "
                f"message_keys={','.join(message_keys)}"
            )
            emit_resp(
                req_id,
                False,
                payload={"code": "no_established_route"},
                error="No established overlay route",
            )
            return

        now_mono = time.monotonic()
        _reticulum_chat_prune_digest_fanout_recent(now_mono)
        fanout_hashes = list(dict.fromkeys(soft_peer_hashes + reliable_peer_hashes))
        log(
            "[presence_bridge] target=reticulum-chat fanout "
            f"peers={len(fanout_hashes)} soft_peers={len(soft_peer_hashes)} "
            f"reliable_peers={len(reliable_peer_hashes)} "
            f"exclude_hashes={','.join(exclude_hashes)} "
            f"fanout_hashes={','.join(fanout_hashes)} "
            f"message_types={','.join(message_types)} "
            f"message_keys={','.join(message_keys)}"
        )

        soft_delivered_peer_hashes: list[str] = []
        reliable_delivered_peer_hashes: list[str] = []
        suppressed_duplicate_digests = 0
        suppressed_digest_keys: list[str] = []
        for peer_hash in soft_peer_hashes:
            peer_delivered_all_frames = True
            for index in soft_indices:
                wire_bytes = encoded_frames[index]
                digest_fingerprint = (
                    message_digest_fingerprints[index]
                    if index < len(message_digest_fingerprints)
                    else None
                )
                dedupe_key: Optional[Tuple[str, str, str]] = None
                if digest_fingerprint is not None:
                    group_id, fingerprint = digest_fingerprint
                    dedupe_key = (peer_hash, group_id, fingerprint)
                    last_sent_at = _reticulum_chat_digest_fanout_recent.get(dedupe_key)
                    if (
                        last_sent_at is not None
                        and now_mono - last_sent_at < _RETICULUM_CHAT_DIGEST_DEDUPE_TTL_SECONDS
                    ):
                        suppressed_duplicate_digests += 1
                        if len(suppressed_digest_keys) < 12:
                            suppressed_digest_keys.append(f"{peer_hash[:8]}:g={group_id}")
                        continue
                if not _send_wire_to_overlay_peer(
                    peer_hash,
                    wire_bytes,
                    "reticulum_chat_fanout",
                    queue_if_pending=message_types[index] != "land_state",
                ):
                    peer_delivered_all_frames = False
                elif dedupe_key is not None:
                    _reticulum_chat_digest_fanout_recent[dedupe_key] = now_mono
            if peer_delivered_all_frames:
                soft_delivered_peer_hashes.append(peer_hash)

        for peer_hash in reliable_peer_hashes:
            peer_delivered_all_frames = True
            for index in reliable_indices:
                wire_bytes = encoded_frames[index]
                if not _send_wire_to_established_overlay_peer(
                    peer_hash,
                    wire_bytes,
                    "reticulum_chat_reliable_fanout",
                ):
                    peer_delivered_all_frames = False
                    message_type = (
                        message_types[index]
                        if index < len(message_types) and message_types[index]
                        else "?"
                    )
                    log(
                        "[presence_bridge] target=reticulum-chat reliable_fanout_send_failed "
                        f"peer_hash={peer_hash} message_type={message_type} "
                        "error=Packet send returned False"
                    )
            if peer_delivered_all_frames:
                reliable_delivered_peer_hashes.append(peer_hash)

        if suppressed_duplicate_digests:
            log(
                "[presence_bridge] target=reticulum-chat fanout_duplicate_digest_suppressed "
                f"count={suppressed_duplicate_digests} "
                f"peer_groups={','.join(suppressed_digest_keys)}"
            )

        soft_ok = not soft_indices or bool(soft_delivered_peer_hashes)
        reliable_ok = not reliable_indices or bool(reliable_delivered_peer_hashes)
        if soft_ok and reliable_ok:
            delivered_peer_hashes = list(
                dict.fromkeys(soft_delivered_peer_hashes + reliable_delivered_peer_hashes)
            )
            emit_resp(
                req_id,
                True,
                payload={
                    "fanoutPeers": len(delivered_peer_hashes),
                    "fanoutHashes": delivered_peer_hashes,
                    "softFanoutPeers": len(soft_delivered_peer_hashes),
                    "reliableFanoutPeers": len(reliable_delivered_peer_hashes),
                },
            )
            return

        if reliable_indices and not reliable_delivered_peer_hashes:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_false"},
                error="Reliable overlay fanout had no successful delivery",
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
        active_call=payload.get("activeCall") is True,
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
    queued = _enqueue_audio_link_teardown(link_id, close_reason or "local_close")
    if queued:
        log(
            "[presence_bridge] target=reticulum-audio-link audio_link_close_queued "
            f"peer={peer_key or 'unknown'} link={link_id} reason={close_reason or 'local_close'}"
        )
        emit_resp(req_id, True, payload={"queued": True})
        return
    emit_resp(
        req_id,
        False,
        payload={"code": "audio_control_queue_full"},
        error="Unable to queue audio link close",
    )


def handle_reset_group_audio_peer_state(req_id: str, payload: Dict[str, Any]) -> None:
    peer_key = str(payload.get("peerPresenceHash") or "").strip().lower()
    if not peer_key:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return

    closed = 0
    _set_audio_link_desired(peer_key, False)
    with _state_lock:
        links_to_close = [
            link_id
            for link_id, state in list(_audio_links_by_id.items())
            if str(state.get("peerPresenceHash") or "").strip().lower() == peer_key
        ]
    for link_id in links_to_close:
        if _enqueue_audio_link_teardown(link_id, "peer_state_reset"):
            closed += 1

    with _state_lock:
        _call_media_path_state.pop(peer_key, None)
        _peer_lifecycle.pop(peer_key, None)
    _mark_audio_queue_state_dirty()
    log(
        "[presence_bridge] target=reticulum-audio-link audio_link_reset_queued "
        f"peer={peer_key} links={len(links_to_close)} queued={closed}"
    )
    emit_resp(req_id, True, payload={"closedLinks": closed, "queued": closed})


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


def handle_ensure_peer_identity(req_id: str, payload: Dict[str, Any]) -> None:
    peer_hash = str(payload.get("peerPresenceHash") or "").strip().lower()
    if not peer_hash:
        emit_resp(req_id, False, error="Missing peerPresenceHash")
        return
    if peer_hash in _known_peers:
        emit_resp(req_id, True, payload={"source": "known"})
        return
    if ensure_known_peer_from_recall(peer_hash, "ts_seed"):
        emit_resp(req_id, True, payload={"source": "recall"})
        return
    emit_resp(
        req_id,
        False,
        payload={"code": "unknown_peer_identity"},
        error="Unknown peer identity",
    )


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


def handle_send_group_audio_link_control(req_id: str, payload: Dict[str, Any]) -> None:
    room_id = str(payload.get("roomId") or "")
    encoded_payload = payload.get("payload")
    signal_type = str(payload.get("signalType") or "")
    signal_id = str(payload.get("signalId") or "")
    call_session_id = str(payload.get("callSessionId") or "")
    if (
        not room_id
        or len(room_id.encode("utf-8")) > AUDIO_MAX_ROOM_ID_LEN
        or not isinstance(encoded_payload, str)
        or not encoded_payload
        or signal_type
        not in {"capability", "offer", "answer", "candidate", "candidates", "reconnect"}
        or not signal_id
        or len(signal_id) > 128
        or not call_session_id
        or len(call_session_id) > 128
    ):
        emit_resp(
            req_id,
            False,
            payload={"code": "invalid_control_payload"},
            error="Missing roomId or invalid control payload",
        )
        return

    link_id = str(payload.get("linkId") or "").strip()
    peer_key = str(payload.get("peerPresenceHash") or "").strip().lower()
    resolved_link_id = link_id
    state = get_audio_link_state(resolved_link_id) if resolved_link_id else None
    fallback_peer_key = str(
        (state or {}).get("peerPresenceHash") or peer_key
    ).strip().lower()
    state_is_ready = (
        state is not None
        and state.get("established") is True
        and state.get("link") is not None
        and state.get("closing") is not True
        and _link_manager_generation_current(
            "audio", resolved_link_id, state.get("link")
        )
    )
    if not state_is_ready and fallback_peer_key:
        candidate = _best_established_audio_link_id_for_peer(fallback_peer_key)
        if candidate:
            candidate_state = get_audio_link_state(candidate)
            candidate_link = (candidate_state or {}).get("link")
            if (
                candidate_state is not None
                and candidate_state.get("established") is True
                and candidate_link is not None
                and candidate_state.get("closing") is not True
                and _link_manager_generation_current(
                    "audio", candidate, candidate_link
                )
            ):
                resolved_link_id = candidate
                state = candidate_state
    if state is None:
        emit_resp(
            req_id,
            False,
            payload={"code": "audio_link_not_ready"},
            error="Audio link not ready",
        )
        return
    link = state.get("link")
    if (
        state.get("established") is not True
        or link is None
        or state.get("closing") is True
        or not _link_manager_generation_current("audio", resolved_link_id, link)
    ):
        emit_resp(
            req_id,
            False,
            payload={"code": "audio_link_not_ready"},
            error="Audio link not ready",
        )
        return
    if (
        state.get("control_channel_supported") is not True
        or state.get("control_channel_configured") is not True
        or state.get("control_channel") is None
    ):
        now_monotonic = time.monotonic()
        with _state_lock:
            probe_failed_until = float(
                state.get("control_channel_probe_failed_until") or 0.0
            )
            last_probe_at = float(state.get("control_channel_last_probe_at") or 0.0)
            should_probe = now_monotonic - last_probe_at >= 0.5
            if should_probe:
                state["control_channel_last_probe_at"] = now_monotonic
        if now_monotonic < probe_failed_until:
            emit_resp(
                req_id,
                False,
                payload={"code": "control_channel_not_ready"},
                error="Peer control channel is not ready",
            )
            return
        if should_probe:
            _enqueue_scheduler_task(
                _gcall_control_scheduler_lane(resolved_link_id),
                f"gcall-control-capability-retry:{resolved_link_id}",
                _send_group_audio_control_capability,
                resolved_link_id,
            )
        # The first offer can race the capability round trip immediately after
        # link classification. This command runs on its per-peer command shard,
        # while the probe and ACK use the separate transport shard, so waiting
        # briefly cannot block link lifecycle or the capability exchange.
        ready_deadline = time.monotonic() + 0.75
        while time.monotonic() < ready_deadline and not _shutdown.is_set():
            current = get_audio_link_state(resolved_link_id)
            if current is not state or current.get("closing") is True:
                break
            if (
                current.get("control_channel_supported") is True
                and current.get("control_channel_configured") is True
                and current.get("control_channel") is not None
            ):
                break
            time.sleep(0.01)
    if (
        state.get("control_channel_supported") is not True
        or state.get("control_channel_configured") is not True
        or state.get("control_channel") is None
    ):
        with _state_lock:
            state["control_channel_probe_failed_until"] = time.monotonic() + 1.0
        emit_resp(
            req_id,
            False,
            payload={"code": "control_channel_not_ready"},
            error="Peer control channel is not ready",
        )
        return

    try:
        raw_payload = base64.b64decode(encoded_payload, validate=True)
        if not raw_payload or len(raw_payload) > _GROUP_AUDIO_CONTROL_CHANNEL_MAX_BYTES:
            raise ValueError("Control payload is too large")
    except Exception as exc:
        emit_resp(
            req_id,
            False,
            payload={"code": "invalid_control_payload"},
            error=str(exc),
        )
        return

    dedupe_key = (
        f"{resolved_link_id}:{room_id}:{call_session_id}:{signal_type}"
        if signal_type in {"capability", "reconnect"}
        else ""
    )
    if dedupe_key:
        with _state_lock:
            if dedupe_key in _group_audio_control_pending_dedupe:
                emit_resp(
                    req_id,
                    True,
                    payload={
                        "linkId": resolved_link_id,
                        "payloadBytes": len(raw_payload),
                        "coalesced": True,
                    },
                )
                return
            _group_audio_control_pending_dedupe.add(dedupe_key)

    queued = _enqueue_scheduler_task(
        _gcall_control_scheduler_lane(resolved_link_id),
        f"gcall-control-bundle:{signal_type}:{resolved_link_id}:{room_id}:{signal_id[:12]}",
        _send_group_audio_control_bundle_task,
        resolved_link_id,
        room_id,
        raw_payload,
        signal_type,
        signal_id,
        dedupe_key,
    )
    if not queued:
        if dedupe_key:
            with _state_lock:
                _group_audio_control_pending_dedupe.discard(dedupe_key)
        emit_resp(
            req_id,
            False,
            payload={"code": "scheduler_queue_full"},
            error="Group call control queue is full",
        )
        return
    emit_resp(
        req_id,
        True,
        payload={"linkId": resolved_link_id, "payloadBytes": len(raw_payload)},
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
        fallback_peer_key = str(
            (state or {}).get("peerPresenceHash") or peer_key
        ).strip().lower()
        if (
            state is None
            or state.get("established") is not True
            or state.get("link") is None
        ):
            fallback_id = _best_established_audio_link_id_for_peer(fallback_peer_key)
            if fallback_id and fallback_id != resolved_link_id:
                fallback_state = get_audio_link_state(fallback_id)
                if fallback_state is not None:
                    state = fallback_state
                    resolved_link_id = fallback_id
        if state is None:
            code = "audio_link_not_ready" if fallback_peer_key else "unknown_link_id"
            emit_resp(
                req_id,
                False,
                payload={"code": code},
                error=(
                    "Audio link not ready"
                    if code == "audio_link_not_ready"
                    else "Unknown audio link id"
                ),
            )
            return
    else:
        if not peer_key:
            emit_resp(req_id, False, error="Missing linkId or peerPresenceHash")
            return
        candidate = _best_established_audio_link_id_for_peer(peer_key)
        if not candidate:
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
        result, _send_duration_ms = _send_packet_on_audio_link_bounded(
            resolved_link_id,
            link,
            encoded["wire_bytes"],
            "audio_heartbeat",
        )
        if result is None:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_timeout"},
                error="Packet send timed out",
            )
            return
        if result is False:
            emit_resp(
                req_id,
                False,
                payload={"code": "packet_send_false"},
                error="Packet send returned False",
            )
            return
        state["last_activity_at"] = time.time()
        state["consecutive_send_timeouts"] = 0
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
    elif action == "clear_presence_cache":
        handle_clear_presence_cache(req_id, payload)
    elif action == "forward_presence":
        handle_forward_presence(req_id, payload)
    elif action == "overlay_sync_state":
        handle_overlay_sync_state(req_id, payload)
    elif action == "configure_reticulum_chat_pinned_peers":
        handle_configure_reticulum_chat_pinned_peers(req_id, payload)
    elif action == "overlay_note_candidate_failure":
        handle_overlay_note_candidate_failure(req_id, payload)
    elif action == "stop":
        handle_stop(req_id)
    elif action == "send_call":
        handle_send_call(req_id, payload)
    elif action == "prepare_reticulum_resource_session":
        handle_prepare_reticulum_resource_session(req_id, payload)
    elif action == "accept_qchat_file_resource":
        handle_accept_qchat_file_resource(req_id, payload)
    elif action == "send_qchat_file_resource":
        handle_send_qchat_file_resource(req_id, payload)
    elif action == "authorize_qchat_file_resource":
        handle_authorize_qchat_file_resource(req_id, payload)
    elif action == "reject_qchat_file_resource":
        handle_reject_qchat_file_resource(req_id, payload)
    elif action == "accept_reticulum_chat_resource":
        handle_accept_reticulum_chat_resource(req_id, payload)
    elif action == "send_reticulum_chat_resource":
        handle_send_reticulum_chat_resource(req_id, payload)
    elif action == "authorize_reticulum_chat_resource":
        handle_authorize_reticulum_chat_resource(req_id, payload)
    elif action == "reject_reticulum_chat_resource":
        handle_reject_reticulum_chat_resource(req_id, payload)
    elif action == "accept_reticulum_resource":
        handle_accept_reticulum_resource(req_id, payload)
    elif action == "send_reticulum_resource":
        handle_send_reticulum_resource(req_id, payload)
    elif action == "authorize_reticulum_resource":
        handle_authorize_reticulum_resource(req_id, payload)
    elif action == "reject_reticulum_resource":
        handle_reject_reticulum_resource(req_id, payload)
    elif action == "cancel_reticulum_resource":
        handle_cancel_reticulum_resource(req_id, payload)
    elif action == "fanout_call":
        handle_fanout_call(req_id, payload)
    elif action == "send_group_call":
        handle_send_group_call(req_id, payload)
    elif action == "fanout_group_call":
        handle_fanout_group_call(req_id, payload)
    elif action == "send_reticulum_chat":
        handle_send_reticulum_chat(req_id, payload)
    elif action == "send_reticulum_chat_targets":
        handle_send_reticulum_chat_targets(req_id, payload)
    elif action == "fanout_reticulum_chat":
        handle_fanout_reticulum_chat(req_id, payload)
    elif action == "open_group_audio_link":
        handle_open_group_audio_link(req_id, payload)
    elif action == "close_group_audio_link":
        handle_close_group_audio_link(req_id, payload)
    elif action == "reset_group_audio_peer_state":
        handle_reset_group_audio_peer_state(req_id, payload)
    elif action == "warm_group_audio_path":
        handle_warm_group_audio_path(req_id, payload)
    elif action == "send_group_audio_link_control":
        handle_send_group_audio_link_control(req_id, payload)
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
    elif action == "configure_group_audio_forwarding":
        room_count, rule_count = _configure_audio_forwarding_plans(payload.get("plans"))
        emit_resp(
            req_id,
            True,
            payload={"roomCount": room_count, "ruleCount": rule_count},
        )
    elif action == "configure_land_state_forwarding":
        group_count, target_count, session_count = _configure_land_state_forwarding(
            payload.get("plans"),
            payload.get("sessions"),
            payload.get("revision"),
        )
        emit_resp(
            req_id,
            True,
            payload={
                "groupCount": group_count,
                "targetCount": target_count,
                "sessionCount": session_count,
            },
        )
    elif action == "get_local_identity_public_key":
        handle_get_local_identity_public_key(req_id, payload)
    elif action == "ensure_peer_identity":
        handle_ensure_peer_identity(req_id, payload)
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
        _notify_rns_work_available()

    _cmd_queue_bounded.put(None)
    _notify_rns_work_available()


def _wake_bridge_shutdown() -> None:
    """Wake the RNS owner loop without allowing a full queue to block exit."""
    _shutdown.set()
    try:
        _cmd_queue_bounded.put_nowait(None)
    except queue.Full:
        try:
            _cmd_queue_bounded.get_nowait()
            _cmd_queue_bounded.put_nowait(None)
        except Exception:
            pass
    _notify_rns_work_available()


def _owner_pid_from_environment() -> int:
    try:
        owner_pid = int(str(os.environ.get("QORTAL_RETICULUM_OWNER_PID") or "0"))
    except (TypeError, ValueError):
        return 0
    return owner_pid if owner_pid > 1 else 0


def _posix_pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (ProcessLookupError, OSError):
        return False


def _linux_process_start_token(pid: int) -> Optional[str]:
    """Return the kernel start tick for a PID, protecting fallback checks from PID reuse."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
            raw = handle.read()
    except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
        return None
    # comm is parenthesized and may itself contain spaces or closing parentheses.
    closing = raw.rfind(")")
    if closing < 0:
        return None
    fields_after_comm = raw[closing + 1 :].strip().split()
    # fields_after_comm[0] is field 3 (state); process start time is field 22.
    if len(fields_after_comm) <= 19:
        return None
    return fields_after_comm[19]


def _open_posix_owner_monitor(
    owner_pid: int,
) -> Tuple[Callable[[], bool], Callable[[], None], str]:
    """Bind to the Electron owner itself, independent of frozen bridge wrappers."""
    if sys.platform.startswith("linux") and hasattr(os, "pidfd_open"):
        try:
            owner_fd = os.pidfd_open(owner_pid, 0)
            poller = select.poll()
            poller.register(owner_fd, select.POLLIN | select.POLLHUP | select.POLLERR)

            def pidfd_alive() -> bool:
                return not bool(poller.poll(0))

            def close_pidfd() -> None:
                try:
                    os.close(owner_fd)
                except OSError:
                    pass

            return pidfd_alive, close_pidfd, "pidfd"
        except ProcessLookupError:
            return lambda: False, lambda: None, "pidfd"
        except (AttributeError, OSError):
            # Older kernels can expose os.pidfd_open without supporting it.
            pass

    if sys.platform == "darwin" and hasattr(select, "kqueue"):
        kqueue = None
        try:
            kqueue = select.kqueue()
            process_event = select.kevent(
                owner_pid,
                filter=select.KQ_FILTER_PROC,
                flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
                fflags=select.KQ_NOTE_EXIT,
            )
            kqueue.control([process_event], 0, 0)

            def kqueue_alive() -> bool:
                return not bool(kqueue.control(None, 1, 0))

            return kqueue_alive, kqueue.close, "kqueue"
        except (AttributeError, OSError):
            if kqueue is not None:
                try:
                    kqueue.close()
                except OSError:
                    pass

    if sys.platform.startswith("linux"):
        start_token = _linux_process_start_token(owner_pid)
        if start_token is None:
            return lambda: False, lambda: None, "proc-start"
        return (
            lambda: _linux_process_start_token(owner_pid) == start_token,
            lambda: None,
            "proc-start",
        )

    # Portable last resort for POSIX platforms without pidfd or kqueue. The
    # check targets Electron's PID rather than assuming a direct parent.
    return (
        lambda: _posix_pid_exists(owner_pid),
        lambda: None,
        "pid-exists",
    )


def _owner_watchdog_loop(owner_pid: int) -> None:
    """Terminate this per-app bridge when its exact Electron owner disappears."""
    owner_lost = False
    owner_handle = None
    kernel32 = None
    owner_alive = None
    owner_monitor_close = lambda: None

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.windll.kernel32
            kernel32.OpenProcess.argtypes = [
                wintypes.DWORD,
                wintypes.BOOL,
                wintypes.DWORD,
            ]
            kernel32.OpenProcess.restype = ctypes.c_void_p
            kernel32.WaitForSingleObject.argtypes = [
                ctypes.c_void_p,
                wintypes.DWORD,
            ]
            kernel32.WaitForSingleObject.restype = wintypes.DWORD
            kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel32.CloseHandle.restype = wintypes.BOOL
            # SYNCHRONIZE gives us an exact process handle, avoiding PID-reuse
            # ambiguity while waiting for the Electron owner to terminate.
            owner_handle = kernel32.OpenProcess(0x00100000, False, owner_pid)
        except Exception as exc:
            log(
                "[presence_bridge] target=owner-watchdog "
                f"state=disabled owner_pid={owner_pid} err={exc}"
            )
            return
        if not owner_handle:
            log(
                "[presence_bridge] target=owner-watchdog "
                f"state=owner-missing owner_pid={owner_pid}"
            )
            owner_lost = True
        else:
            wait_result = kernel32.WaitForSingleObject(owner_handle, 0)
            if wait_result == 0:
                owner_lost = True
            elif wait_result != 0x00000102:  # WAIT_TIMEOUT
                log(
                    "[presence_bridge] target=owner-watchdog "
                    f"state=monitor-failed owner_pid={owner_pid} result={wait_result}"
                )
                kernel32.CloseHandle(owner_handle)
                return
    else:
        # A PyInstaller one-file executable inserts a bootloader process
        # between Electron and the actual Python bridge. Monitor Electron
        # itself rather than requiring it to remain our direct parent.
        owner_alive, owner_monitor_close, monitor_kind = _open_posix_owner_monitor(
            owner_pid
        )
        try:
            owner_lost = not owner_alive()
        except Exception as exc:
            log(
                "[presence_bridge] target=owner-watchdog "
                f"state=monitor-failed owner_pid={owner_pid} monitor={monitor_kind} err={exc}"
            )
            try:
                owner_monitor_close()
            except Exception:
                pass
            return
        log(
            "[presence_bridge] target=owner-watchdog "
            f"state=monitor-active owner_pid={owner_pid} monitor={monitor_kind}"
        )

    try:
        while not owner_lost and not _shutdown.wait(_OWNER_WATCH_INTERVAL_SECONDS):
            if os.name == "nt":
                # WAIT_OBJECT_0 means the exact owner handle was signalled.
                wait_result = kernel32.WaitForSingleObject(owner_handle, 0)
                if wait_result == 0:
                    owner_lost = True
                elif wait_result != 0x00000102:  # WAIT_TIMEOUT
                    log(
                        "[presence_bridge] target=owner-watchdog "
                        f"state=monitor-failed owner_pid={owner_pid} result={wait_result}"
                    )
                    return
            else:
                try:
                    owner_lost = not owner_alive()
                except Exception as exc:
                    log(
                        "[presence_bridge] target=owner-watchdog "
                        f"state=monitor-failed owner_pid={owner_pid} err={exc}"
                    )
                    return
    finally:
        if owner_handle and kernel32:
            try:
                kernel32.CloseHandle(owner_handle)
            except Exception:
                pass
        if os.name != "nt":
            try:
                owner_monitor_close()
            except Exception as exc:
                log(
                    "[presence_bridge] target=owner-watchdog "
                    f"state=monitor-close-failed owner_pid={owner_pid} err={exc}"
                )

    if not owner_lost:
        return

    log(
        "[presence_bridge] target=owner-watchdog "
        f"state=owner-exited owner_pid={owner_pid}"
    )
    _wake_bridge_shutdown()

    # stdin EOF normally lets main() finish. A Reticulum call can, however,
    # hold the non-daemon owner thread indefinitely. This bridge is private to
    # the dead Electron process, so a bounded hard exit is safe and prevents
    # it from loading the shared daemon forever.
    time.sleep(_OWNER_EXIT_GRACE_SECONDS)
    os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Qortal Hub Reticulum presence bridge")
    parser.add_argument("--config", action="store", default=None, help="Reticulum config directory")
    args = parser.parse_args()

    _shutdown.clear()
    owner_pid = _owner_pid_from_environment()
    if owner_pid:
        log(
            "[presence_bridge] target=owner-watchdog "
            f"state=monitoring owner_pid={owner_pid}"
        )
        threading.Thread(
            target=_owner_watchdog_loop,
            args=(owner_pid,),
            name="reticulum-owner-watchdog",
            daemon=True,
        ).start()

    # Start owner monitoring before attaching to the shared Reticulum daemon.
    # If Electron dies while that attach is blocked, the bounded watchdog must
    # still be able to terminate this per-app process.
    if args.config:
        os.environ["QORTAL_RETICULUM_CONFIG_DIR"] = args.config
        ensure_started(args.config)

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
    if _qortalland_game_manager is not None:
        _qortalland_game_manager.stop()
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
    try:
        _json_priority_event_queue.put_nowait(None)
    except queue.Full:
        pass
    stdout_thread.join(timeout=10.0)
    try:
        _audio_binary_out_queue.put_nowait(None)
    except queue.Full:
        pass
    try:
        _audio_data_plane_inbound_queue.put_nowait(None)
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

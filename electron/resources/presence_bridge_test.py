import base64
import ctypes
import importlib.util
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

import RNS


BRIDGE_PATH = Path(__file__).with_name("presence_bridge.py")
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_encode(data):
    leading_zeroes = len(data) - len(data.lstrip(b"\x00"))
    value = int.from_bytes(data, "big")
    encoded = ""
    while value > 0:
        value, remainder = divmod(value, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    return ("1" * leading_zeroes) + (encoded or ("1" if not data else ""))


def load_bridge():
    spec = importlib.util.spec_from_file_location("presence_bridge_under_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class PresenceBridgeOwnerLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()

    def tearDown(self):
        self.bridge._shutdown.clear()

    def test_owner_pid_environment_is_strictly_validated(self):
        with mock.patch.dict(os.environ, {"QORTAL_RETICULUM_OWNER_PID": "4321"}):
            self.assertEqual(self.bridge._owner_pid_from_environment(), 4321)
        for invalid in ("", "not-a-pid", "0", "1", "-5"):
            with self.subTest(invalid=invalid), mock.patch.dict(
                os.environ,
                {"QORTAL_RETICULUM_OWNER_PID": invalid},
            ):
                self.assertEqual(self.bridge._owner_pid_from_environment(), 0)

    @unittest.skipIf(os.name == "nt", "POSIX parent-reparenting behavior")
    def test_owner_watchdog_forces_exit_after_owner_is_lost(self):
        owner_pid = 4321
        self.bridge._shutdown.clear()
        close_monitor = mock.Mock()
        with mock.patch.object(
            self.bridge,
            "_open_posix_owner_monitor",
            return_value=(lambda: False, close_monitor, "test"),
        ), mock.patch.object(self.bridge.time, "sleep") as sleep_mock, mock.patch.object(
            self.bridge.os, "_exit", side_effect=SystemExit(0)
        ) as exit_mock:
            with self.assertRaises(SystemExit):
                self.bridge._owner_watchdog_loop(owner_pid)

        self.assertTrue(self.bridge._shutdown.is_set())
        close_monitor.assert_called_once_with()
        sleep_mock.assert_called_once_with(self.bridge._OWNER_EXIT_GRACE_SECONDS)
        exit_mock.assert_called_once_with(0)

    @unittest.skipIf(os.name == "nt", "POSIX parent-reparenting behavior")
    def test_owner_loss_still_forces_exit_when_stdin_already_started_shutdown(self):
        owner_pid = 4321
        self.bridge._shutdown.set()
        with mock.patch.object(
            self.bridge,
            "_open_posix_owner_monitor",
            return_value=(lambda: False, lambda: None, "test"),
        ), mock.patch.object(self.bridge.time, "sleep"), mock.patch.object(
            self.bridge.os, "_exit", side_effect=SystemExit(0)
        ) as exit_mock:
            with self.assertRaises(SystemExit):
                self.bridge._owner_watchdog_loop(owner_pid)

        exit_mock.assert_called_once_with(0)

    @unittest.skipIf(os.name == "nt", "POSIX parent-reparenting behavior")
    def test_owner_watchdog_leaves_a_live_owner_alone_during_shutdown(self):
        owner_pid = 4321
        self.bridge._shutdown.set()
        close_monitor = mock.Mock()
        with mock.patch.object(
            self.bridge,
            "_open_posix_owner_monitor",
            return_value=(lambda: True, close_monitor, "test"),
        ), mock.patch.object(self.bridge.os, "_exit") as exit_mock:
            self.bridge._owner_watchdog_loop(owner_pid)
        close_monitor.assert_called_once_with()
        exit_mock.assert_not_called()

    @unittest.skipIf(os.name == "nt", "POSIX process monitor")
    def test_owner_monitor_accepts_a_live_process_that_is_not_the_direct_parent(self):
        owner_alive, close_monitor, _kind = self.bridge._open_posix_owner_monitor(
            os.getpid()
        )
        try:
            self.assertTrue(owner_alive())
        finally:
            close_monitor()

    @unittest.skipIf(os.name == "nt", "POSIX process monitor")
    def test_owner_monitor_detects_the_exact_process_exiting(self):
        owner = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(0.1)"]
        )
        owner_alive, close_monitor, _kind = self.bridge._open_posix_owner_monitor(
            owner.pid
        )
        try:
            self.assertTrue(owner_alive())
            owner.wait(timeout=2.0)
            deadline = time.monotonic() + 1.0
            while owner_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(owner_alive())
        finally:
            if owner.poll() is None:
                owner.terminate()
                owner.wait(timeout=2.0)
            close_monitor()

    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux fallback monitor")
    def test_linux_owner_monitor_fallback_rejects_a_reused_pid(self):
        with mock.patch.object(
            self.bridge.os, "pidfd_open", side_effect=OSError("unsupported")
        ), mock.patch.object(
            self.bridge,
            "_linux_process_start_token",
            side_effect=["original-start", "original-start", "replacement-start"],
        ):
            owner_alive, close_monitor, kind = self.bridge._open_posix_owner_monitor(
                4321
            )
            try:
                self.assertEqual(kind, "proc-start")
                self.assertTrue(owner_alive())
                self.assertFalse(owner_alive())
            finally:
                close_monitor()

    def test_macos_owner_monitor_uses_process_exit_events(self):
        class FakeKqueue:
            def __init__(self):
                self.exited = False
                self.closed = False
                self.changes = []

            def control(self, changes, _max_events, _timeout):
                if changes is not None:
                    self.changes.extend(changes)
                    return []
                return ["exit"] if self.exited else []

            def close(self):
                self.closed = True

        fake_kqueue = FakeKqueue()
        with mock.patch.object(self.bridge.sys, "platform", "darwin"), mock.patch.object(
            self.bridge.select, "kqueue", return_value=fake_kqueue, create=True
        ), mock.patch.object(
            self.bridge.select, "kevent", return_value="process-event", create=True
        ), mock.patch.object(
            self.bridge.select, "KQ_FILTER_PROC", 1, create=True
        ), mock.patch.object(
            self.bridge.select, "KQ_EV_ADD", 2, create=True
        ), mock.patch.object(
            self.bridge.select, "KQ_EV_ENABLE", 4, create=True
        ), mock.patch.object(
            self.bridge.select, "KQ_EV_CLEAR", 8, create=True
        ), mock.patch.object(
            self.bridge.select, "KQ_NOTE_EXIT", 16, create=True
        ):
            owner_alive, close_monitor, kind = self.bridge._open_posix_owner_monitor(
                4321
            )
            self.assertEqual(kind, "kqueue")
            self.assertTrue(owner_alive())
            fake_kqueue.exited = True
            self.assertFalse(owner_alive())
            close_monitor()

        self.assertEqual(fake_kqueue.changes, ["process-event"])
        self.assertTrue(fake_kqueue.closed)

    def test_windows_owner_watchdog_uses_the_exact_process_handle(self):
        kernel32 = mock.Mock()
        kernel32.OpenProcess.return_value = 99
        kernel32.WaitForSingleObject.return_value = 0
        fake_windll = mock.Mock(kernel32=kernel32)
        self.bridge._shutdown.clear()

        with mock.patch.object(self.bridge.os, "name", "nt"), mock.patch.object(
            ctypes, "windll", fake_windll, create=True
        ), mock.patch.object(
            self.bridge._shutdown, "wait", return_value=False
        ), mock.patch.object(self.bridge.time, "sleep"), mock.patch.object(
            self.bridge.os, "_exit", side_effect=SystemExit(0)
        ) as exit_mock:
            with self.assertRaises(SystemExit):
                self.bridge._owner_watchdog_loop(4321)

        kernel32.OpenProcess.assert_called_once_with(0x00100000, False, 4321)
        kernel32.WaitForSingleObject.assert_called_once()
        kernel32.CloseHandle.assert_called_once_with(99)
        exit_mock.assert_called_once_with(0)


class ReticulumPathVisibilityTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.destination_hash = bytes.fromhex("11" * 16)

    def test_shared_daemon_path_is_authoritative_when_local_table_misses(self):
        daemon = mock.Mock()
        daemon.is_connected_to_shared_instance = True
        daemon.get_path_snapshot.return_value = {
            "hops": 2,
            "timestamp": time.time(),
        }
        self.bridge._reticulum = daemon

        with mock.patch.object(RNS.Transport, "has_path", return_value=False):
            self.assertTrue(self.bridge._reticulum_has_path(self.destination_hash))
            self.assertTrue(self.bridge._reticulum_has_path(self.destination_hash))

        daemon.get_path_snapshot.assert_called_once_with(self.destination_hash)

    def test_embedded_instance_uses_local_path_without_rpc(self):
        reticulum = mock.Mock()
        reticulum.is_connected_to_shared_instance = False
        self.bridge._reticulum = reticulum

        with mock.patch.object(RNS.Transport, "has_path", return_value=False):
            self.assertFalse(self.bridge._reticulum_has_path(self.destination_hash))

        reticulum.get_path_snapshot.assert_not_called()

    def test_dropping_path_invalidates_shared_availability_cache(self):
        daemon = mock.Mock()
        daemon.is_connected_to_shared_instance = True
        daemon.get_path_snapshot.side_effect = [
            {"hops": 2, "timestamp": time.time()},
            None,
        ]
        daemon.drop_path.return_value = True
        self.bridge._reticulum = daemon

        with mock.patch.object(RNS.Transport, "has_path", return_value=False), mock.patch.object(
            RNS.Transport, "expire_path", return_value=False
        ), mock.patch.object(RNS.Transport, "mark_path_unresponsive"):
            self.assertTrue(self.bridge._reticulum_has_path(self.destination_hash))
            self.assertTrue(self.bridge._drop_reticulum_path(self.destination_hash))
            self.assertFalse(self.bridge._reticulum_has_path(self.destination_hash))

        self.assertEqual(daemon.get_path_snapshot.call_count, 2)

    def test_game_discovery_miss_nudges_without_dropping_path(self):
        peer_hash = self.destination_hash.hex()
        with mock.patch.object(
            self.bridge,
            "_nudge_cached_reticulum_path",
            return_value=True,
        ) as nudge, mock.patch.object(
            self.bridge,
            "_force_overlay_peer_path_refresh",
        ) as force_refresh:
            self.assertTrue(
                self.bridge._refresh_qortalland_game_path(
                    peer_hash,
                    "game_link_no_path",
                )
            )

        nudge.assert_called_once()
        force_refresh.assert_not_called()

    def test_game_failed_link_can_still_replace_bad_path(self):
        peer_hash = self.destination_hash.hex()
        with mock.patch.object(
            self.bridge,
            "_nudge_cached_reticulum_path",
        ) as nudge, mock.patch.object(
            self.bridge,
            "_force_overlay_peer_path_refresh",
            return_value=True,
        ) as force_refresh:
            self.assertTrue(
                self.bridge._refresh_qortalland_game_path(
                    peer_hash,
                    "game_link_attempt_closed",
                )
            )

        force_refresh.assert_called_once_with(
            peer_hash,
            target="qortalland-game",
            reason="game_link_attempt_closed",
            await_seconds=0.0,
        )
        nudge.assert_not_called()

    def test_recent_media_success_avoids_route_rpc(self):
        peer_hash = self.destination_hash.hex()
        state = self.bridge._get_call_media_state(peer_hash)
        state.update({
            "destination_hash_hex": peer_hash,
            "path_state": "fresh",
            "last_send_ok": time.time(),
            "last_send_fail": None,
            "last_inbound_at": None,
        })
        with mock.patch.object(
            self.bridge,
            "_reticulum_has_path",
            side_effect=AssertionError("route lookup should not run for recent traffic"),
        ):
            self.assertEqual(
                self.bridge._classify_call_media_path_state(
                    peer_hash,
                    self.destination_hash,
                ),
                "fresh",
            )


class FakeLink:
    def __init__(self):
        self.closed_callback = None
        self.packet_callback = None
        self.remote_identified_callback = None
        self.resource_strategy = None
        self.resource_callback = None
        self.resource_started_callback = None
        self.resource_concluded_callback = None
        self.teardown_called = False
        self.remote_identity = None

    def get_mdu(self):
        return 4096

    def set_link_closed_callback(self, callback):
        self.closed_callback = callback

    def set_packet_callback(self, callback):
        self.packet_callback = callback

    def set_remote_identified_callback(self, callback):
        self.remote_identified_callback = callback

    def get_remote_identity(self):
        return self.remote_identity

    def set_resource_strategy(self, strategy):
        self.resource_strategy = strategy

    def set_resource_callback(self, callback):
        self.resource_callback = callback

    def set_resource_started_callback(self, callback):
        self.resource_started_callback = callback

    def set_resource_concluded_callback(self, callback):
        self.resource_concluded_callback = callback

    def teardown(self):
        self.teardown_called = True


class FakeChannel:
    def __init__(self):
        self.mdu = 4096
        self.message_types = []
        self.handlers = []
        self.sent = []

    def register_message_type(self, message_type):
        self.message_types.append(message_type)

    def add_message_handler(self, handler):
        self.handlers.append(handler)

    def remove_message_handler(self, handler):
        if handler in self.handlers:
            self.handlers.remove(handler)

    def is_ready_to_send(self):
        return True

    def send(self, message):
        self.sent.append(message)
        return object()


class FakeChannelLink(FakeLink):
    def __init__(self):
        super().__init__()
        self.channel = FakeChannel()

    def get_channel(self):
        return self.channel


class FakeSessionReceipt:
    FAILED = 0
    SENT = 1

    def __init__(self):
        self.progress = 0.0
        self.metadata = None
        self.response = None
        self.cancelled = False
        self.status = self.SENT
        self.concluded_at = None
        self.resource = None
        self.link = None
        self.request_id = None

    def get_progress(self):
        return self.progress

    def get_response(self):
        return self.response

    def cancel(self):
        self.cancelled = True


class FakeSessionLink(FakeLink):
    def __init__(self, link_id=None):
        super().__init__()
        self.link_id = link_id or bytes.fromhex("77" * 16)
        self.requests = []
        self.identified_with = None
        self.remote_identity = None
        self.outgoing_resources = []

    def identify(self, identity):
        self.identified_with = identity

    def get_remote_identity(self):
        return self.remote_identity

    def request(self, path, data=None, **callbacks):
        receipt = FakeSessionReceipt()
        self.requests.append((path, data, callbacks, receipt))
        return receipt


class FakePacket:
    def __init__(self, link):
        self.link = link


class FakeRnsPacket:
    MDU = 500
    ENCRYPTED_MDU = 500
    sent_links = []
    sent_payloads = []

    def __init__(self, link, data, create_receipt=False):
        self.link = link
        self.data = data
        self.create_receipt = create_receipt

    def send(self):
        self.__class__.sent_links.append(self.link)
        self.__class__.sent_payloads.append(self.data)
        return True


class FakeDestination:
    def __init__(self):
        self.hash = bytes.fromhex("44" * 16)


class PresenceBridgeWireEncodingTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.bridge._destination = FakeDestination()

    def test_group_signal_stamps_transport_sender_without_overwriting_payload(self):
        read_state = {
            "y": "d",
            "q": "Q-peer",
            "u": 123,
            "n": 124,
            "p": "public-key",
            "z": "signature",
        }
        encoded = self.bridge._encode_group_signal_wire(
            {"t": "RCHAT", "k": "read_sync", "w": read_state}
        )

        self.assertTrue(encoded["ok"])
        wire = json.loads(encoded["wire_bytes"].decode("utf-8"))
        self.assertEqual(wire["r"], "44" * 16)
        self.assertEqual(wire["w"], read_state)

    def test_group_signal_relay_preserves_original_sender(self):
        encoded = self.bridge._encode_group_signal_wire(
            {"t": "GJ", "r": "11" * 16}
        )

        self.assertTrue(encoded["ok"])
        wire = json.loads(encoded["wire_bytes"].decode("utf-8"))
        self.assertEqual(wire["r"], "11" * 16)

    def test_call_signal_relay_preserves_original_sender(self):
        encoded = self.bridge._encode_call_signal_wire(
            {"t": "CR", "r": "22" * 16}
        )

        self.assertTrue(encoded["ok"])
        wire = json.loads(encoded["wire_bytes"].decode("utf-8"))
        self.assertEqual(wire["r"], "22" * 16)

    def test_route_bound_presence_fits_encrypted_mdu_direct_and_relayed(self):
        origin_raw = bytes.fromhex("55" * 16)
        origin_route = base64.urlsafe_b64encode(origin_raw).decode("ascii").rstrip("=")
        local_route = base64.urlsafe_b64encode(bytes.fromhex("44" * 16)).decode(
            "ascii"
        ).rstrip("=")
        envelope = {
            "type": "PRESENCE_ANNOUNCE",
            "id": "x" * 16,
            "timestamp": 9_999_999_999_999,
            "signature": "z" * 88,
            "payload": {
                "address": "Q" + ("a" * 33),
                "publicKey": "k" * 44,
                "sessionId": "P" + local_route + ("e" * 13),
                "status": "online",
                "clientVersion": "1.0.0",
            },
        }

        direct = self.bridge.make_presence_wire(envelope, 4)
        relayed_envelope = {
            **envelope,
            "payload": {
                **envelope["payload"],
                "sessionId": "P" + origin_route + ("e" * 13),
            },
        }
        relayed = self.bridge.make_presence_wire(
            relayed_envelope,
            3,
            origin_sender_hash="55" * 16,
        )

        self.assertLessEqual(len(direct), self.bridge._MAX_ENCRYPTED_WIRE_BYTES)
        self.assertLessEqual(len(relayed), self.bridge._MAX_ENCRYPTED_WIRE_BYTES)
        self.assertNotIn("o", json.loads(relayed.decode("utf-8")))

    def test_oversized_legacy_presence_is_rejected_before_packet_send(self):
        envelope = {
            "type": "PRESENCE_ANNOUNCE",
            "id": "x" * 36,
            "timestamp": 9_999_999_999_999,
            "signature": "z" * 88,
            "payload": {
                "address": "Q" + ("a" * 33),
                "publicKey": "k" * 44,
                "sessionId": "legacy-session-id".ljust(36, "x"),
                "status": "online",
                "clientVersion": "1.0.0",
            },
        }

        with self.assertRaisesRegex(RuntimeError, "exceeds encrypted MDU"):
            self.bridge.make_presence_wire(envelope, 4)

    def test_stale_route_bound_presence_is_not_republished_after_route_change(self):
        stale_route = base64.urlsafe_b64encode(bytes.fromhex("55" * 16)).decode(
            "ascii"
        ).rstrip("=")
        envelope = {
            "type": "PRESENCE_HEARTBEAT",
            "id": "x" * 16,
            "timestamp": 9_999_999_999_999,
            "signature": "z" * 88,
            "payload": {
                "address": "Q" + ("a" * 33),
                "publicKey": "k" * 44,
                "sessionId": "P" + stale_route + ("e" * 13),
                "status": "online",
            },
        }

        with self.assertRaisesRegex(RuntimeError, "local destination"):
            self.bridge.make_presence_wire(envelope, 4)

    def test_presence_route_binding_decoder_rejects_noncanonical_ids(self):
        route = base64.urlsafe_b64encode(bytes.fromhex("55" * 16)).decode("ascii").rstrip("=")
        session_id = "P" + route + ("e" * 13)
        self.assertEqual(
            self.bridge._presence_route_bound_destination_hash(session_id),
            "55" * 16,
        )
        self.assertIsNone(
            self.bridge._presence_route_bound_destination_hash("P" + ("!" * 35))
        )

    def test_route_bound_presence_recovers_signed_origin_from_relay(self):
        origin_raw = bytes.fromhex("55" * 16)
        route = base64.urlsafe_b64encode(origin_raw).decode("ascii").rstrip("=")
        emitted = []
        message = {
            "t": "PRESENCE_HEARTBEAT",
            "i": "x" * 16,
            "a": "Q" + ("a" * 33),
            "k": "k" * 44,
            "n": "P" + route + ("e" * 13),
            "m": 9_999_999_999_999,
            "g": "z" * 88,
            "r": "44" * 16,
            "s": "online",
            "q": 3,
        }

        with mock.patch.object(
            self.bridge,
            "emit_event",
            side_effect=lambda event, payload: emitted.append((event, payload)),
        ):
            accepted = self.bridge._emit_presence_message(message, "relay-link")

        self.assertTrue(accepted)
        self.assertEqual(emitted[0][0], "presence_message")
        self.assertEqual(
            emitted[0][1]["route"],
            {
                "kind": "reticulum",
                "destinationHash": "55" * 16,
                "viaDestinationHash": "44" * 16,
                "overlayHopsRemaining": 3,
                "linkId": "relay-link",
            },
        )


class PresenceBridgeReticulumChatInboundDedupTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()

    def test_identity_request_dedup_ignores_route_fields(self):
        request = {
            "t": "RCHAT",
            "k": "identity_req",
            "d": "dd" * 16,
            "rid": "11" * 12,
            "h": 0,
            "m": 5,
            "x": int((time.time() + 30) * 1000),
        }

        self.assertFalse(
            self.bridge._should_drop_duplicate_reticulum_chat_inbound(request)
        )
        self.assertTrue(
            self.bridge._should_drop_duplicate_reticulum_chat_inbound(
                {**request, "h": 3, "r": "aa" * 16}
            )
        )

    def test_typing_dedup_ignores_origin_hops_and_ingress_sender(self):
        typing = {
            "t": "RCHAT",
            "k": "typing",
            "g": 73,
            "c": "general",
            "a": "Qsender",
            "ts": 123_456,
            "active": True,
            "o": "aa" * 16,
            "h": 1,
            "r": "bb" * 16,
        }

        self.assertFalse(
            self.bridge._should_drop_duplicate_reticulum_chat_inbound(typing)
        )
        self.assertTrue(
            self.bridge._should_drop_duplicate_reticulum_chat_inbound(
                {**typing, "o": "cc" * 16, "h": 4, "r": "dd" * 16}
            )
        )
        self.assertFalse(
            self.bridge._should_drop_duplicate_reticulum_chat_inbound(
                {**typing, "ts": 123_457}
            )
        )


class PresenceBridgeLandStateFastPathTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.bridge._destination = FakeDestination()
        self.group_id = 73
        self.author = "Q-land-author"
        self.session_id = "land-session"
        self.source_hash = "11" * 16
        self.target_hash = "22" * 16
        self.origin = "AQIDBAUGBwgJCgsMDQ4PEA"
        self.private_key = RNS.Cryptography.Ed25519PrivateKey.generate()
        public_key = self.private_key.public_key().public_bytes()
        expires_at = int((time.time() + 60) * 1000)
        self.bridge._configure_land_state_forwarding(
            [
                {
                    "groupId": self.group_id,
                    "targets": [
                        {
                            "peerPresenceHash": self.target_hash,
                            "expiresAt": expires_at,
                        }
                    ],
                }
            ],
            [
                {
                    "groupId": self.group_id,
                    "authorAddress": self.author,
                    "sessionId": self.session_id,
                    "ephemeralPublicKey": base58_encode(public_key),
                    "expiresAt": expires_at,
                }
            ],
            7,
        )

    def state(self, sequence=1, signature=None):
        timestamp = int(time.time() * 1000)
        fields = {
            "afk": True,
            "authorAddress": self.author,
            "direction": "r",
            "dnd": True,
            "groupId": self.group_id,
            "movement": "walk",
            "roomId": "room",
            "sequence": sequence,
            "sessionId": self.session_id,
            "skinId": 4,
            "timestamp": timestamp,
            "type": "QORTAL_LAND_STATE",
            "x": 50,
            "y": 60,
        }
        signed_bytes = json.dumps(
            fields,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        encoded_signature = signature
        if encoded_signature is None:
            encoded_signature = base58_encode(
                self.private_key.sign(signed_bytes)
            )
        return {
            "t": "RCHAT",
            "k": "land_state",
            "g": self.group_id,
            "a": self.author,
            "s": self.session_id,
            "q": sequence,
            "x": 50,
            "y": 60,
            "u": "room",
            "d": "r",
            "m": "walk",
            "v": 3,
            "i": 4,
            "ts": timestamp,
            "z": encoded_signature,
            "o": self.origin,
            "h": 1,
        }

    def queue_without_scheduler(self, message):
        with mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            return_value=True,
        ):
            queued = self.bridge._queue_land_state_fast_path(
                message,
                self.source_hash,
                "source-link",
            )
        self.assertTrue(queued)
        return next(reversed(self.bridge._land_state_forward_pending))

    def test_preserves_full_origin_and_reports_the_forwarding_revision(self):
        message = self.state()
        pending_key = self.queue_without_scheduler(message)
        emitted = []
        sent = []
        with mock.patch.object(
            self.bridge,
            "_send_wire_to_established_overlay_peer",
            side_effect=lambda peer, wire, _traffic: sent.append((peer, wire)) or True,
        ), mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            side_effect=lambda *args, **kwargs: emitted.append((args, kwargs)) or True,
        ):
            self.bridge._process_land_state_fast_path(pending_key)

        self.assertEqual(len(sent), 1)
        forwarded = json.loads(sent[0][1].decode("utf-8"))
        self.assertEqual(forwarded["o"], self.origin)
        self.assertEqual(forwarded["v"], 3)
        self.assertEqual(forwarded["i"], 4)
        self.assertTrue(emitted[0][1]["land_state_fast_forwarded"])
        self.assertEqual(emitted[0][1]["land_state_forwarding_revision"], 7)

    def test_destination_hash_matching_requires_exact_hash_equivalence(self):
        full_hash = "0102030405060708090a0b0c0d0e0f10"
        same_prefix = "01020304" + ("ff" * 12)

        self.assertTrue(
            self.bridge._land_state_hash_matches(self.origin, full_hash)
        )
        self.assertFalse(
            self.bridge._land_state_hash_matches(full_hash, same_prefix)
        )

    def test_invalid_origin_is_replaced_with_the_verified_ingress_peer(self):
        message = self.state()
        message["o"] = "invalid"
        pending_key = self.queue_without_scheduler(message)
        sent = []
        with mock.patch.object(
            self.bridge,
            "_send_wire_to_established_overlay_peer",
            side_effect=lambda peer, wire, _traffic: sent.append((peer, wire)) or True,
        ), mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            return_value=True,
        ):
            self.bridge._process_land_state_fast_path(pending_key)

        self.assertEqual(len(sent), 1)
        forwarded = json.loads(sent[0][1].decode("utf-8"))
        self.assertEqual(forwarded["o"], self.source_hash)

    def test_route_revision_change_forces_electron_fallback(self):
        pending_key = self.queue_without_scheduler(self.state())
        emitted = []

        def send_and_change_revision(_peer, _wire, _traffic):
            self.bridge._land_state_forwarding_revision = 8
            return True

        with mock.patch.object(
            self.bridge,
            "_send_wire_to_established_overlay_peer",
            side_effect=send_and_change_revision,
        ), mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            side_effect=lambda *args, **kwargs: emitted.append((args, kwargs)) or True,
        ):
            self.bridge._process_land_state_fast_path(pending_key)

        self.assertFalse(emitted[0][1]["land_state_fast_forwarded"])
        self.assertIsNone(emitted[0][1]["land_state_forwarding_revision"])

    def test_unverified_higher_sequence_does_not_replace_pending_valid_state(self):
        valid_key = self.queue_without_scheduler(self.state(sequence=1))
        invalid_key = self.queue_without_scheduler(
            self.state(sequence=999, signature="invalid")
        )
        self.assertEqual(len(self.bridge._land_state_forward_pending), 2)
        emitted = []
        with mock.patch.object(
            self.bridge,
            "_send_wire_to_established_overlay_peer",
            return_value=True,
        ) as send, mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            side_effect=lambda *args, **kwargs: emitted.append((args, kwargs)) or True,
        ):
            self.bridge._process_land_state_fast_path(valid_key)
            self.bridge._process_land_state_fast_path(invalid_key)

        self.assertEqual(send.call_count, 1)
        self.assertEqual(len(emitted), 1)

    def test_oversized_target_plan_falls_back_instead_of_installing_part_of_it(self):
        expires_at = int((time.time() + 60) * 1000)
        targets = [
            {
                "peerPresenceHash": f"{index:032x}",
                "expiresAt": expires_at,
            }
            for index in range(
                1,
                self.bridge._LAND_STATE_FORWARDING_MAX_TARGETS_PER_GROUP + 2,
            )
        ]
        self.bridge._configure_land_state_forwarding(
            [{"groupId": self.group_id, "targets": targets}],
            [],
            8,
        )
        self.assertNotIn(
            self.group_id,
            self.bridge._land_state_forwarding_plans,
        )

    def test_sequence_zero_is_forwarded_only_once(self):
        message = self.state(sequence=0)
        emitted = []
        with mock.patch.object(
            self.bridge,
            "_send_wire_to_established_overlay_peer",
            return_value=True,
        ) as send, mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            side_effect=lambda *args, **kwargs: emitted.append((args, kwargs)) or True,
        ):
            self.bridge._process_land_state_fast_path(
                self.queue_without_scheduler(message)
            )
            self.bridge._process_land_state_fast_path(
                self.queue_without_scheduler(message)
            )

        self.assertEqual(send.call_count, 1)
        self.assertEqual(len(emitted), 1)


class PresenceBridgeAudioForwardFastPathTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.room_id = "gcall-qortal-716"
        self.source_hash = "11" * 16
        self.target_hash = "22" * 16

    def plan(self, ingress_link="source-link", target_link="target-link"):
        return {
            "roomId": self.room_id,
            "topologyEpoch": 7,
            "rules": [
                {
                    "sourceAddress": "Q-source",
                    "ingress": {
                        "address": "Q-source",
                        "transport": "link",
                        "linkId": ingress_link,
                        "peerPresenceHash": self.source_hash,
                        "peerDestinationHash": self.source_hash,
                    },
                    "targets": [
                        {
                            "address": "Q-target",
                            "transport": "link",
                            "linkId": target_link,
                            "peerPresenceHash": self.target_hash,
                            "peerDestinationHash": self.target_hash,
                        }
                    ],
                }
            ],
        }

    def test_exact_verified_ingress_forwards_unchanged_media(self):
        rooms, rules = self.bridge._configure_audio_forwarding_plans([self.plan()])
        self.assertEqual((rooms, rules), (1, 1))
        captured = []
        with mock.patch.object(
            self.bridge,
            "_audio_data_plane_broadcast_inbound_audio",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_put_audio_decoded_batch_keep_newest",
            side_effect=lambda frames: captured.extend(frames) or True,
        ):
            handled = self.bridge._try_group_audio_forward_fast_path(
                self.room_id,
                "source-link",
                self.source_hash,
                self.source_hash,
                1234,
                b"encrypted-media",
                b"inbound-batch",
            )
        self.assertTrue(handled)
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][0], "target-link")
        self.assertEqual(captured[0][1], self.room_id)
        self.assertEqual(captured[0][5], b"encrypted-media")

    def test_link_media_does_not_fall_back_to_hash_matching(self):
        self.bridge._configure_audio_forwarding_plans([self.plan()])
        with mock.patch.object(
            self.bridge,
            "_audio_data_plane_broadcast_inbound_audio",
        ) as broadcast:
            handled = self.bridge._try_group_audio_forward_fast_path(
                self.room_id,
                "unverified-link",
                self.source_hash,
                self.source_hash,
                1234,
                b"encrypted-media",
                b"inbound-batch",
            )
        self.assertFalse(handled)
        broadcast.assert_not_called()

    def test_packet_media_matches_only_the_configured_peer_hash(self):
        plan = self.plan()
        ingress = plan["rules"][0]["ingress"]
        ingress["transport"] = "packet"
        ingress["linkId"] = ""
        self.bridge._configure_audio_forwarding_plans([plan])
        captured = []
        with mock.patch.object(
            self.bridge,
            "_audio_data_plane_broadcast_inbound_audio",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_put_audio_decoded_batch_keep_newest",
            side_effect=lambda frames: captured.extend(frames) or True,
        ):
            handled = self.bridge._try_group_audio_forward_fast_path(
                self.room_id,
                "",
                self.source_hash,
                "",
                1234,
                b"encrypted-media",
                b"inbound-batch",
            )
            rejected = self.bridge._try_group_audio_forward_fast_path(
                self.room_id,
                "",
                "33" * 16,
                "",
                1235,
                b"other-media",
                b"other-batch",
            )
        self.assertTrue(handled)
        self.assertFalse(rejected)
        self.assertEqual(len(captured), 1)

    def test_forward_queue_rejection_does_not_duplicate_local_delivery(self):
        self.bridge._configure_audio_forwarding_plans([self.plan()])
        with mock.patch.object(
            self.bridge,
            "_audio_data_plane_broadcast_inbound_audio",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_put_audio_decoded_batch_keep_newest",
            return_value=False,
        ):
            handled = self.bridge._try_group_audio_forward_fast_path(
                self.room_id,
                "source-link",
                self.source_hash,
                self.source_hash,
                1234,
                b"encrypted-media",
                b"inbound-batch",
            )
        self.assertTrue(handled)

    def test_plan_replacement_removes_stale_room_and_loop_target(self):
        loop_plan = self.plan(target_link="source-link")
        rooms, rules = self.bridge._configure_audio_forwarding_plans([loop_plan])
        self.assertEqual((rooms, rules), (1, 1))
        stored_rule = self.bridge._audio_forwarding_plans_by_room[self.room_id][
            "rules"
        ][0]
        self.assertEqual(stored_rule["targets"], [])

        rooms, rules = self.bridge._configure_audio_forwarding_plans([])
        self.assertEqual((rooms, rules), (0, 0))
        self.assertNotIn(self.room_id, self.bridge._audio_forwarding_plans_by_room)


class PresenceBridgeOverlayAudioPromotionTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.sender_peer_hash = "22" * 16
        self.original_rns_packet = RNS.Packet

    def tearDown(self):
        RNS.Packet = self.original_rns_packet

    def drain_audio_queue(self):
        while True:
            try:
                self.bridge._audio_binary_out_queue.get_nowait()
            except queue.Empty:
                return

    def group_audio_wire(self):
        room = b"gcall-qortal-1"
        sender_hash = bytes.fromhex(self.sender_peer_hash)
        payload = b"opus"
        return (
            self.bridge._GROUP_AUDIO_BINARY_MAGIC
            + bytes(
                (
                    self.bridge._GROUP_AUDIO_BINARY_VERSION,
                    len(room),
                    len(sender_hash),
                )
            )
            + len(payload).to_bytes(2, "big")
            + room
            + sender_hash
            + payload
        )

    def group_audio_heartbeat_wire(self):
        return self.bridge.json.dumps(
            {
                "t": self.bridge._GROUP_AUDIO_HEARTBEAT_WIRE_TYPE,
                "R": "gcall-qortal-1",
                "c": "PING",
                "m": int(time.time() * 1000),
                "r": self.sender_peer_hash,
            }
        ).encode("utf-8")

    def group_audio_heartbeat_wire_without_sender(self):
        return self.bridge.json.dumps(
            {
                "t": self.bridge._GROUP_AUDIO_HEARTBEAT_WIRE_TYPE,
                "R": "gcall-qortal-1",
                "c": "PING",
                "m": int(time.time() * 1000),
            }
        ).encode("utf-8")

    def qchat_file_auth_wire(self, transfer_id="transfer-1", peer_hash=None):
        return self.bridge.json.dumps(
            {
                "type": "QCHAT_FILE_LINK_AUTH",
                "transferId": transfer_id,
                "senderAddress": "Q-sender",
                "downloaderAddress": "Q-downloader",
                "downloaderPublicKey": "pub-downloader",
                "downloaderReticulumDestinationHash": peer_hash
                or self.sender_peer_hash,
                "downloaderReticulumIdentityPublicKeyBase64": "identity",
                "timestamp": int(time.time() * 1000),
                "signature": "sig",
            }
        ).encode("utf-8")

    def install_overlay_state(self, incoming=True):
        link = FakeLink()
        link_id = "overlay-test-link"
        peer_hash = "11" * 16
        now = time.time()
        self.bridge._overlay_links_by_id[link_id] = {
            "link": link,
            "peerPresenceHash": peer_hash,
            "incoming": incoming,
            "established": True,
            "established_at": now,
            "created_at": now,
            "pending_packets": self.bridge.deque(maxlen=4),
            "last_activity_at": now,
            "last_rx_at": None,
        }
        self.bridge._overlay_link_ids_by_object[id(link)] = link_id
        self.bridge._active_overlay_link_id_by_peer_hash[peer_hash] = link_id
        if incoming:
            self.bridge._inbound_overlay_neighbors[peer_hash] = now
        else:
            self.bridge._active_overlay_neighbors[peer_hash] = now
        return link, link_id, peer_hash

    def install_audio_state(
        self,
        link_id,
        peer_hash=None,
        established=True,
        link=None,
        last_activity_at=None,
    ):
        peer_hash = peer_hash or self.sender_peer_hash
        link = link or FakeLink()
        now = time.time()
        self.bridge._audio_links_by_id[link_id] = {
            "link": link,
            "peerPresenceHash": peer_hash,
            "peerDestinationHash": peer_hash,
            "incoming": False,
            "established": established,
            "established_at": now if established else None,
            "created_at": now - 10,
            "last_activity_at": last_activity_at if last_activity_at is not None else now,
            "last_rx_at": None,
            "last_send_ok_at": None,
            "send_lock": self.bridge.threading.RLock(),
            "generation": 0,
            "closing": False,
        }
        self.bridge._audio_link_ids_by_object[id(link)] = link_id
        return link

    def drain_json_events(self):
        events = []
        for event_queue in (
            self.bridge._json_priority_event_queue,
            self.bridge._json_event_queue,
        ):
            while True:
                try:
                    frame = event_queue.get_nowait()
                    if frame is not None:
                        events.append(frame)
                except queue.Empty:
                    break
        while True:
            frame = self.bridge._pop_coalesced_json_event_line()
            if frame is None:
                return events
            events.append(frame)

    def drain_json_responses(self):
        responses = []
        while True:
            try:
                responses.append(self.bridge._json_resp_queue.get_nowait())
            except queue.Empty:
                return responses

    def install_fake_rns_packet(self):
        FakeRnsPacket.sent_links = []
        FakeRnsPacket.sent_payloads = []
        RNS.Packet = FakeRnsPacket
        self.bridge.RNS.Packet = FakeRnsPacket
        self.bridge._destination = FakeDestination()

    def test_incoming_overlay_group_audio_promotes_link_without_teardown(self):
        self.drain_audio_queue()
        link, overlay_link_id, overlay_peer_hash = self.install_overlay_state(
            incoming=True
        )
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
        }

        self.bridge.on_overlay_link_packet(self.group_audio_wire(), packet)

        self.assertNotIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertNotIn(id(link), self.bridge._overlay_link_ids_by_object)
        self.assertNotIn(
            overlay_peer_hash,
            self.bridge._active_overlay_link_id_by_peer_hash,
        )
        self.assertNotIn(overlay_peer_hash, self.bridge._inbound_overlay_neighbors)
        self.assertFalse(link.teardown_called)

        audio_link_id = self.bridge.get_audio_link_id(link)
        self.assertIsInstance(audio_link_id, str)
        audio_state = self.bridge.get_audio_link_state(audio_link_id)
        self.assertIsNotNone(audio_state)
        self.assertTrue(audio_state["incoming"])
        self.assertEqual(audio_state["peerPresenceHash"], self.sender_peer_hash)
        self.assertEqual(audio_state["peerDestinationHash"], self.sender_peer_hash)
        self.assertEqual(audio_state["promoted_from_overlay_link_id"], overlay_link_id)
        self.assertIs(link.packet_callback, self.bridge.on_audio_link_packet)
        self.assertGreater(self.bridge._audio_binary_out_queue.qsize(), 0)

    def test_incoming_overlay_group_audio_without_desired_audio_is_not_promoted(self):
        self.drain_audio_queue()
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()

        self.bridge.on_overlay_link_packet(self.group_audio_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_audio_link_id(link))
        self.assertFalse(link.teardown_called)
        self.assertEqual(self.bridge._audio_binary_out_queue.qsize(), 0)

    def test_incoming_overlay_gac_promotes_link_when_audio_is_desired(self):
        self.drain_audio_queue()
        link, overlay_link_id, _overlay_peer_hash = self.install_overlay_state(
            incoming=True
        )
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
        }

        self.bridge.on_overlay_link_packet(self.group_audio_heartbeat_wire(), packet)

        self.assertNotIn(overlay_link_id, self.bridge._overlay_links_by_id)
        audio_link_id = self.bridge.get_audio_link_id(link)
        self.assertIsInstance(audio_link_id, str)
        audio_state = self.bridge.get_audio_link_state(audio_link_id)
        self.assertIsNotNone(audio_state)
        self.assertTrue(audio_state["incoming"])
        self.assertEqual(audio_state["peerPresenceHash"], self.sender_peer_hash)
        self.assertEqual(audio_state["peerDestinationHash"], self.sender_peer_hash)
        self.assertIs(link.packet_callback, self.bridge.on_audio_link_packet)

    def test_incoming_overlay_gac_without_desired_audio_is_not_promoted(self):
        self.drain_audio_queue()
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()

        self.bridge.on_overlay_link_packet(self.group_audio_heartbeat_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_audio_link_id(link))
        self.assertFalse(link.teardown_called)

    def test_incoming_overlay_gac_without_sender_is_not_promoted(self):
        self.drain_audio_queue()
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
        }

        self.bridge.on_overlay_link_packet(
            self.group_audio_heartbeat_wire_without_sender(),
            packet,
        )

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_audio_link_id(link))
        self.assertFalse(link.teardown_called)

    def test_stale_audio_mapping_does_not_allow_overlay_promotion(self):
        self.drain_audio_queue()
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()
        self.bridge._active_audio_link_id_by_peer_hash[self.sender_peer_hash] = "stale-link"

        self.bridge.on_overlay_link_packet(self.group_audio_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_audio_link_id(link))
        self.assertFalse(link.teardown_called)
        self.assertEqual(self.bridge._audio_binary_out_queue.qsize(), 0)

    def test_audio_send_with_stale_link_id_uses_established_peer_link(self):
        self.install_fake_rns_packet()
        current_link = self.install_audio_state("current-audio-link")
        self.bridge._active_audio_link_id_by_peer_hash[self.sender_peer_hash] = "stale-audio-link"
        self.bridge._outgoing_audio_link_id_by_peer_hash[self.sender_peer_hash] = "stale-audio-link"

        self.bridge._process_audio_batch(
            [
                (
                    "stale-audio-link",
                    "gcall-qortal-1",
                    self.sender_peer_hash,
                    "",
                    int(time.time() * 1000),
                    b"opus",
                )
            ]
        )

        self.assertEqual(FakeRnsPacket.sent_links, [current_link])
        self.assertEqual(
            self.bridge._active_audio_link_id_by_peer_hash[self.sender_peer_hash],
            "current-audio-link",
        )
        failures = [
            frame
            for frame in self.drain_json_events()
            if frame.get("event") == "group_audio_send_failed"
        ]
        self.assertEqual(failures, [])

    def test_audio_heartbeat_with_stale_link_id_uses_established_peer_link(self):
        self.install_fake_rns_packet()
        current_link = self.install_audio_state("current-audio-link")
        self.bridge._active_audio_link_id_by_peer_hash[self.sender_peer_hash] = "stale-audio-link"
        self.bridge._outgoing_audio_link_id_by_peer_hash[self.sender_peer_hash] = "stale-audio-link"

        self.bridge.handle_send_group_audio_link_heartbeat(
            "req-1",
            {
                "linkId": "stale-audio-link",
                "peerPresenceHash": self.sender_peer_hash,
                "roomId": "gcall-qortal-1",
                "command": "PING",
            },
        )

        self.assertEqual(FakeRnsPacket.sent_links, [current_link])
        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0].get("ok"))
        self.assertEqual(
            responses[0].get("payload", {}).get("linkId"),
            "current-audio-link",
        )

    def test_reliable_control_requires_peer_channel_handshake(self):
        self.install_audio_state("current-audio-link", link=FakeChannelLink())

        self.bridge.handle_send_group_audio_link_control(
            "req-control",
            {
                "linkId": "current-audio-link",
                "roomId": "gcall-qortal-1",
                "payload": base64.b64encode(b"control").decode("ascii"),
                "signalType": "offer",
                "callSessionId": "call-session-1",
                "signalId": "signal-1",
            },
        )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertFalse(responses[0].get("ok"))
        self.assertEqual(
            responses[0].get("payload", {}).get("code"),
            "control_channel_not_ready",
        )

    def test_control_capability_enables_channel_and_queues_ack(self):
        link = self.install_audio_state("current-audio-link")
        capability = json.dumps(
            {
                "t": self.bridge._GROUP_AUDIO_CONTROL_CAPABILITY_WIRE_TYPE,
                "c": self.bridge._GROUP_AUDIO_CONTROL_CAPABILITY_HELLO,
                "r": self.sender_peer_hash,
            }
        ).encode("utf-8")
        queued = []

        def capture(lane, task_name, callback, *args, **kwargs):
            queued.append((lane, task_name, callback, args, kwargs))
            return True

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", side_effect=capture
        ):
            self.bridge.on_audio_link_packet(capability, FakePacket(link))

        state = self.bridge.get_audio_link_state("current-audio-link")
        self.assertTrue(state.get("control_channel_supported"))
        self.assertEqual(len(queued), 1)
        self.assertIs(queued[0][2], self.bridge._send_group_audio_control_capability)
        self.assertEqual(
            queued[0][3][1],
            self.bridge._GROUP_AUDIO_CONTROL_CAPABILITY_ACK,
        )

    def test_reliable_control_uses_dedicated_scheduler_after_handshake(self):
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True
        queued = []

        def capture(lane, task_name, callback, *args, **kwargs):
            queued.append((lane, task_name, callback, args, kwargs))
            return True

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", side_effect=capture
        ):
            self.bridge.handle_send_group_audio_link_control(
                "req-control",
                {
                    "linkId": "current-audio-link",
                    "roomId": "gcall-qortal-1",
                    "payload": base64.b64encode(b"control").decode("ascii"),
                    "signalType": "offer",
                    "callSessionId": "call-session-1",
                    "signalId": "signal-1",
                },
            )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0].get("ok"))
        self.assertEqual(len(queued), 1)
        self.assertTrue(queued[0][0].startswith("gcall-control-"))
        self.assertIs(
            queued[0][2], self.bridge._send_group_audio_control_bundle_task
        )
        self.assertEqual(queued[0][3][2], b"control")
        self.assertEqual(queued[0][3][3:], ("offer", "signal-1", ""))

    def test_reliable_control_coalesces_pending_capability(self):
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", return_value=True
        ) as enqueue:
            for signal_id in ("signal-1", "signal-2"):
                self.bridge.handle_send_group_audio_link_control(
                    signal_id,
                    {
                        "linkId": "current-audio-link",
                        "roomId": "gcall-qortal-1",
                        "payload": base64.b64encode(b"capability").decode("ascii"),
                        "signalType": "capability",
                        "callSessionId": "call-session-1",
                        "signalId": signal_id,
                    },
                )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 2)
        self.assertTrue(all(response.get("ok") for response in responses))
        self.assertIsNone(responses[0].get("payload", {}).get("coalesced"))
        self.assertTrue(responses[1].get("payload", {}).get("coalesced"))
        self.assertEqual(enqueue.call_count, 1)

    def test_reliable_control_accepts_full_payload_budget(self):
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True
        raw_payload = b"x" * self.bridge._GROUP_AUDIO_CONTROL_CHANNEL_MAX_BYTES

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", return_value=True
        ):
            self.bridge.handle_send_group_audio_link_control(
                "req-control",
                {
                    "linkId": "current-audio-link",
                    "roomId": "gcall-qortal-1",
                    "payload": base64.b64encode(raw_payload).decode("ascii"),
                    "signalType": "answer",
                    "callSessionId": "call-session-1",
                    "signalId": "signal-max",
                },
            )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0].get("ok"))
        self.assertEqual(
            responses[0].get("payload", {}).get("payloadBytes"),
            len(raw_payload),
        )

    def test_reliable_control_queue_full_returns_structured_failure(self):
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", return_value=False
        ):
            self.bridge.handle_send_group_audio_link_control(
                "req-control",
                {
                    "linkId": "current-audio-link",
                    "roomId": "gcall-qortal-1",
                    "payload": base64.b64encode(b"control").decode("ascii"),
                    "signalType": "offer",
                    "callSessionId": "call-session-1",
                    "signalId": "signal-1",
                },
            )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertFalse(responses[0].get("ok"))
        self.assertEqual(
            responses[0].get("payload", {}).get("code"),
            "scheduler_queue_full",
        )

    def test_reliable_control_replaces_stale_link_for_same_peer(self):
        self.install_audio_state("stale-audio-link", established=False)
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True

        with mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", return_value=True
        ) as enqueue:
            self.bridge.handle_send_group_audio_link_control(
                "req-control",
                {
                    "linkId": "stale-audio-link",
                    "peerPresenceHash": self.sender_peer_hash,
                    "roomId": "gcall-qortal-1",
                    "payload": base64.b64encode(b"control").decode("ascii"),
                    "signalType": "offer",
                    "callSessionId": "call-session-1",
                    "signalId": "signal-1",
                },
            )

        responses = self.drain_json_responses()
        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0].get("ok"))
        self.assertEqual(
            responses[0].get("payload", {}).get("linkId"),
            "current-audio-link",
        )
        self.assertEqual(enqueue.call_args.args[3], "current-audio-link")

    def test_reliable_control_fragments_against_live_channel_mdu(self):
        self.bridge._destination = FakeDestination()
        link = FakeChannelLink()
        link.channel.mdu = 441
        self.install_audio_state("current-audio-link", link=link)
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["control_channel"] = link.channel
        state["control_channel_configured"] = True
        state["control_channel_supported"] = True
        raw_payload = bytes(range(256)) * 4

        self.bridge._send_group_audio_control_bundle(
            "current-audio-link",
            "gcall-qortal-1",
            raw_payload,
            "answer",
            "signal-compact",
        )

        self.assertGreater(len(link.channel.sent), 1)
        self.assertLessEqual(len(link.channel.sent), 7)
        frames = []
        for message in link.channel.sent:
            self.assertLessEqual(len(message.pack()), link.channel.mdu)
            decoded = self.bridge._decode_group_audio_wire(message.data)
            self.assertIsNotNone(decoded)
            frame_payload = decoded[2]
            self.assertTrue(frame_payload.startswith(self.bridge._GC_LINK_CONTROL_MAGIC))
            frames.append(
                json.loads(
                    frame_payload[len(self.bridge._GC_LINK_CONTROL_MAGIC) :].decode(
                        "utf-8"
                    )
                )
            )
        start = frames[0]
        self.assertEqual(start.get("t"), "GO0")
        parts = sorted(
            (frame for frame in frames[1:] if frame.get("t") == "GO1"),
            key=lambda frame: frame["x"],
        )
        encoded = "".join(frame["p"] for frame in parts)
        padding = "=" * ((4 - len(encoded) % 4) % 4)
        self.assertEqual(base64.urlsafe_b64decode(encoded + padding), raw_payload)

    def test_reliable_channel_data_reuses_authenticated_audio_receive_path(self):
        link = FakeChannelLink()
        self.install_audio_state("current-audio-link", link=link)
        message = self.bridge.GroupAudioControlChannelMessage(
            self.bridge._GROUP_AUDIO_CONTROL_CHANNEL_DATA,
            b"reliable-wire",
        )

        with mock.patch.object(self.bridge, "_handle_audio_link_packet") as receive:
            handled = self.bridge._handle_group_audio_control_channel_message(
                link, message
            )

        self.assertTrue(handled)
        receive.assert_called_once()
        self.assertEqual(receive.call_args.args[0], b"reliable-wire")
        self.assertIs(receive.call_args.args[1].link, link)

    def test_audio_rtt_probe_uses_established_audio_link(self):
        self.install_fake_rns_packet()
        current_link = self.install_audio_state("current-audio-link")
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)

        self.bridge._process_audio_rtt_probe("current-audio-link", 0)

        self.assertEqual(FakeRnsPacket.sent_links, [current_link])
        wire = json.loads(FakeRnsPacket.sent_payloads[0].decode("utf-8"))
        self.assertEqual(wire.get("t"), self.bridge._GROUP_AUDIO_RTT_WIRE_TYPE)
        self.assertEqual(wire.get("c"), self.bridge._GROUP_AUDIO_RTT_PROBE_COMMAND)
        self.assertRegex(str(wire.get("q") or ""), r"^[0-9a-f]{16}$")
        self.assertIn(wire["q"], state["rtt_pending"])

    def test_audio_rtt_ack_resolves_probe_with_monotonic_clock(self):
        self.install_audio_state("current-audio-link")
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        probe_id = "a1" * 8
        state["rtt_pending"][probe_id] = {"sent_ns": 1_000_000_000}

        with mock.patch.object(
            self.bridge.time,
            "monotonic_ns",
            return_value=1_025_000_000,
        ):
            rtt_ms = self.bridge._resolve_audio_rtt_probe(
                "current-audio-link",
                state,
                probe_id,
            )

        self.assertEqual(rtt_ms, 25.0)
        self.assertEqual(state.get("rtt_latest_ms"), 25.0)
        self.assertEqual(state.get("rtt_median_ms"), 25.0)
        self.assertNotIn(probe_id, state["rtt_pending"])

    def test_audio_rtt_probe_is_acknowledged_inside_bridge(self):
        self.install_fake_rns_packet()
        current_link = self.install_audio_state("current-audio-link")
        probe_id = "b2" * 8
        wire = json.dumps(
            {
                "t": self.bridge._GROUP_AUDIO_RTT_WIRE_TYPE,
                "c": self.bridge._GROUP_AUDIO_RTT_PROBE_COMMAND,
                "q": probe_id,
                "r": self.sender_peer_hash,
            }
        ).encode("utf-8")

        def run_immediately(_lane, _name, func, *args, **kwargs):
            func(*args, **kwargs)
            return True

        with mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            side_effect=run_immediately,
        ):
            self.bridge.on_audio_link_packet(wire, FakePacket(current_link))

        self.assertEqual(FakeRnsPacket.sent_links, [current_link])
        ack = json.loads(FakeRnsPacket.sent_payloads[0].decode("utf-8"))
        self.assertEqual(ack.get("t"), self.bridge._GROUP_AUDIO_RTT_WIRE_TYPE)
        self.assertEqual(ack.get("c"), self.bridge._GROUP_AUDIO_RTT_ACK_COMMAND)
        self.assertEqual(ack.get("q"), probe_id)

    def test_audio_rtt_commands_do_not_intercept_call_heartbeat(self):
        current_link = self.install_audio_state("current-audio-link")
        heartbeat = json.dumps(
            {
                "t": self.bridge._GROUP_AUDIO_HEARTBEAT_WIRE_TYPE,
                "R": "gcall-qortal-1",
                "c": "PING",
                "m": int(time.time() * 1000),
                "r": self.sender_peer_hash,
            }
        ).encode("utf-8")

        with mock.patch.object(
            self.bridge,
            "_emit_call_bridge_message",
            return_value=True,
        ) as emit_call_message:
            self.bridge.on_audio_link_packet(heartbeat, FakePacket(current_link))

        emit_call_message.assert_called_once()

    def test_removing_audio_link_discards_pending_rtt_probe(self):
        self.install_audio_state("current-audio-link")
        state = self.bridge.get_audio_link_state("current-audio-link")
        self.bridge._ensure_audio_link_lifecycle_fields(state)
        state["rtt_probe_queued"] = True
        state["rtt_pending"]["c3" * 8] = {"sent_ns": time.monotonic_ns()}

        removed = self.bridge.remove_audio_link("current-audio-link")

        self.assertIsNotNone(removed)
        self.assertFalse(removed.get("rtt_probe_queued"))
        self.assertEqual(removed.get("rtt_pending"), {})

    def test_audio_open_stops_after_max_establish_attempts(self):
        self.bridge._destination = FakeDestination()
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
            "attempts": self.bridge._AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS,
            "retry_delay": self.bridge._AUDIO_LINK_RETRY_MIN_SECONDS,
            "retry_timer": None,
            "last_failure_reason": "establish_timeout",
        }

        ok, payload, error = self.bridge._open_group_audio_link_for_peer(
            self.sender_peer_hash,
            retry_reason="establish_timeout",
        )

        self.assertFalse(ok)
        self.assertEqual(payload.get("code"), "max_establish_attempts")
        self.assertEqual(error, "Max group audio link establish attempts reached")
        events = [
            frame
            for frame in self.drain_json_events()
            if frame.get("event") == "group_audio_send_failed"
        ]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].get("payload", {}).get("reason"), "max_establish_attempts")
        self.assertEqual(events[0].get("payload", {}).get("code"), "max_establish_attempts")

    def test_audio_retry_not_scheduled_after_max_establish_attempts(self):
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
            "attempts": self.bridge._AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS,
            "retry_delay": self.bridge._AUDIO_LINK_RETRY_MIN_SECONDS,
            "retry_timer": None,
            "last_failure_reason": "establish_timeout",
        }

        self.bridge._schedule_audio_link_retry(self.sender_peer_hash, "establish_timeout")
        self.bridge._schedule_audio_link_retry(self.sender_peer_hash, "establish_timeout")

        desired = self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash]
        self.assertIsNone(desired.get("retry_timer"))
        self.assertEqual(desired.get("last_failure_reason"), "max_establish_attempts")
        events = [
            frame
            for frame in self.drain_json_events()
            if frame.get("event") == "group_audio_send_failed"
        ]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].get("payload", {}).get("reason"), "max_establish_attempts")
        self.assertEqual(events[0].get("payload", {}).get("code"), "max_establish_attempts")

    def test_audio_retry_timer_callback_does_not_enqueue_after_max_attempts(self):
        enqueued = []
        original_enqueue = self.bridge._enqueue_scheduler_task
        original_timer = self.bridge.threading.Timer

        class FakeTimer:
            def __init__(self, delay, function):
                self.delay = delay
                self.function = function
                self.daemon = False
                self.started = False

            def start(self):
                self.started = True

            def cancel(self):
                self.started = False

        try:
            self.bridge._enqueue_scheduler_task = lambda *args, **kwargs: enqueued.append(
                (args, kwargs)
            )
            self.bridge.threading.Timer = FakeTimer
            self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
                "desired": True,
                "attempts": self.bridge._AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS - 1,
                "retry_delay": self.bridge._AUDIO_LINK_RETRY_MIN_SECONDS,
                "retry_timer": None,
                "last_failure_reason": "establish_timeout",
            }

            self.bridge._schedule_audio_link_retry(
                self.sender_peer_hash,
                "establish_timeout",
                immediate=True,
            )
            desired = self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash]
            timer = desired.get("retry_timer")
            self.assertIsNotNone(timer)
            desired["attempts"] = self.bridge._AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS

            timer.function()

            self.assertEqual(enqueued, [])
            events = [
                frame
                for frame in self.drain_json_events()
                if frame.get("event") == "group_audio_send_failed"
            ]
            self.assertEqual(len(events), 1)
            self.assertEqual(
                events[0].get("payload", {}).get("code"),
                "max_establish_attempts",
            )
        finally:
            self.bridge._enqueue_scheduler_task = original_enqueue
            self.bridge.threading.Timer = original_timer

    def test_audio_established_resets_establish_attempts(self):
        link = self.install_audio_state("current-audio-link", established=False)
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
            "attempts": self.bridge._AUDIO_LINK_MAX_ESTABLISH_ATTEMPTS,
            "retry_delay": self.bridge._AUDIO_LINK_RETRY_MAX_SECONDS,
            "retry_timer": None,
            "last_failure_reason": "establish_timeout",
            "max_attempts_emitted": True,
        }

        self.bridge.on_outgoing_audio_link_established(link)

        desired = self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash]
        self.assertEqual(desired.get("attempts"), 0)
        self.assertEqual(desired.get("retry_delay"), self.bridge._AUDIO_LINK_RETRY_MIN_SECONDS)
        self.assertEqual(desired.get("last_failure_reason"), "")
        self.assertFalse(desired.get("max_attempts_emitted"))

    def test_outbound_overlay_group_audio_is_not_promoted(self):
        self.drain_audio_queue()
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=False)
        packet = FakePacket(link)
        self.bridge._known_peers[self.sender_peer_hash] = object()
        self.bridge._audio_link_desired_by_peer_hash[self.sender_peer_hash] = {
            "desired": True,
        }

        self.bridge.on_overlay_link_packet(self.group_audio_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_audio_link_id(link))
        self.assertFalse(link.teardown_called)
        self.assertEqual(self.bridge._audio_binary_out_queue.qsize(), 0)

    def test_incoming_overlay_qchat_auth_promotes_when_transfer_is_pending(self):
        link, overlay_link_id, overlay_peer_hash = self.install_overlay_state(
            incoming=True
        )
        packet = FakePacket(link)
        self.bridge._qchat_file_pending_sends_by_transfer["transfer-1"] = {
            "expires_at": time.time() + 60,
        }

        self.bridge.on_overlay_link_packet(self.qchat_file_auth_wire(), packet)

        self.assertNotIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertNotIn(id(link), self.bridge._overlay_link_ids_by_object)
        self.assertNotIn(
            overlay_peer_hash,
            self.bridge._active_overlay_link_id_by_peer_hash,
        )
        self.assertNotIn(overlay_peer_hash, self.bridge._inbound_overlay_neighbors)
        self.assertFalse(link.teardown_called)

        file_link_id = self.bridge.get_qchat_file_link_id(link)
        self.assertIsInstance(file_link_id, str)
        file_state = self.bridge.get_qchat_file_link_state(file_link_id)
        self.assertIsNotNone(file_state)
        self.assertTrue(file_state["incoming"])
        self.assertEqual(file_state["peerPresenceHash"], self.sender_peer_hash)
        self.assertEqual(file_state["transferId"], "transfer-1")
        self.assertIs(link.packet_callback, self.bridge.on_qchat_file_link_packet)

    def test_incoming_overlay_qchat_auth_without_pending_transfer_is_not_promoted(self):
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)

        self.bridge.on_overlay_link_packet(self.qchat_file_auth_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_qchat_file_link_id(link))
        self.assertFalse(link.teardown_called)

    def test_incoming_overlay_qchat_auth_with_expired_transfer_is_not_promoted(self):
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._qchat_file_pending_sends_by_transfer["transfer-1"] = {
            "expires_at": time.time() - 1,
        }

        self.bridge.on_overlay_link_packet(self.qchat_file_auth_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_qchat_file_link_id(link))
        self.assertFalse(link.teardown_called)

    def test_incoming_overlay_qchat_auth_with_invalid_peer_hash_is_not_promoted(self):
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=True)
        packet = FakePacket(link)
        self.bridge._qchat_file_pending_sends_by_transfer["transfer-1"] = {
            "expires_at": time.time() + 60,
        }

        self.bridge.on_overlay_link_packet(
            self.qchat_file_auth_wire(peer_hash="not-a-hash"),
            packet,
        )

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_qchat_file_link_id(link))
        self.assertFalse(link.teardown_called)

    def test_outbound_overlay_qchat_auth_is_not_promoted(self):
        link, overlay_link_id, _peer_hash = self.install_overlay_state(incoming=False)
        packet = FakePacket(link)
        self.bridge._qchat_file_pending_sends_by_transfer["transfer-1"] = {
            "expires_at": time.time() + 60,
        }

        self.bridge.on_overlay_link_packet(self.qchat_file_auth_wire(), packet)

        self.assertIn(overlay_link_id, self.bridge._overlay_links_by_id)
        self.assertIsNone(self.bridge.get_qchat_file_link_id(link))
        self.assertFalse(link.teardown_called)


class PresenceBridgeOverlayRouteMigrationTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.bridge._destination = FakeDestination()
        self.peer_hash = "ab" * 16
        self.active_link = FakeLink()
        self.active_link_id = "active-overlay"
        self.active_state = {
            "linkId": self.active_link_id,
            "link": self.active_link,
            "peerPresenceHash": self.peer_hash,
            "incoming": False,
            "established": True,
            "established_at": time.time() - 120,
            "created_at": time.time() - 120,
            "overlay_transport_admitted": True,
            "manager_kind": "overlay",
            "manager_state": self.bridge._LINK_STATE_ESTABLISHED,
            "generation": 0,
            "peer_capabilities": {
                self.bridge._OVERLAY_ROUTE_MIGRATION_CAPABILITY,
            },
        }
        self.bridge._overlay_links_by_id[self.active_link_id] = self.active_state
        self.bridge._overlay_link_ids_by_object[id(self.active_link)] = self.active_link_id
        self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash] = self.active_link_id

    def test_migration_uses_real_bounded_scheduler_lanes(self):
        for shard in range(self.bridge._SCHEDULER_OVERLAY_MIGRATION_SHARDS):
            lane = f"overlay-migration-{shard}"
            self.assertIn(lane, self.bridge._SCHEDULER_QUEUE_MAX_BY_LANE)
            self.assertGreater(self.bridge._SCHEDULER_QUEUE_MAX_BY_LANE[lane], 0)

    def test_hello_advertises_route_migration_and_marks_only_candidates(self):
        regular = json.loads(
            self.bridge._make_overlay_transport_wire(
                self.bridge._OVERLAY_HELLO_WIRE_TYPE,
            ).decode("utf-8")
        )
        candidate = json.loads(
            self.bridge._make_overlay_transport_wire(
                self.bridge._OVERLAY_HELLO_WIRE_TYPE,
                migration_candidate=True,
            ).decode("utf-8")
        )

        self.assertIn(
            self.bridge._OVERLAY_ROUTE_MIGRATION_CAPABILITY,
            regular["c"],
        )
        self.assertNotIn("m", regular)
        self.assertEqual(
            candidate["m"],
            self.bridge._OVERLAY_ROUTE_MIGRATION_MARKER,
        )

    def test_rtt_probe_resolution_requires_the_exact_nonce(self):
        event = threading.Event()
        state = {
            "rtt_pending": {
                "11" * 8: {
                    "sent_ns": 1_000_000_000,
                    "event": event,
                    "rtt_ms": None,
                }
            }
        }

        with mock.patch.object(
            self.bridge.time,
            "monotonic_ns",
            return_value=1_025_000_000,
        ):
            self.assertIsNone(
                self.bridge._resolve_overlay_rtt_probe(state, "22" * 8)
            )
            self.assertEqual(
                self.bridge._resolve_overlay_rtt_probe(state, "11" * 8),
                25.0,
            )

        self.assertTrue(event.is_set())
        self.assertEqual(list(state["rtt_samples_ms"]), [25.0])

    def test_ping_echoes_the_same_rtt_nonce(self):
        nonce = "33" * 8
        wire = {
            "t": self.bridge._OVERLAY_PING_WIRE_TYPE,
            "r": self.peer_hash,
            "q": nonce,
        }
        with mock.patch.object(
            self.bridge,
            "_admit_overlay_peer_from_transport",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_send_overlay_transport_control",
            return_value=True,
        ) as send, mock.patch.object(
            self.bridge,
            "_overlay_enqueue_dedup",
        ):
            handled = self.bridge._handle_overlay_transport_control(
                wire,
                self.active_link,
                self.active_link_id,
                self.active_state,
            )

        self.assertTrue(handled)
        self.assertEqual(
            send.call_args.kwargs["correlation_id"],
            nonce,
        )

    def test_quality_gate_requires_lower_hops_and_clear_rtt_gain(self):
        accepted, result = self.bridge._overlay_migration_quality_acceptable(
            [120, 125, 130, 135, 140],
            [55, 60, 65, 70, 75],
            8,
            3,
        )
        self.assertTrue(accepted)
        self.assertEqual(result["active_median_ms"], 130.0)
        self.assertEqual(result["candidate_median_ms"], 65.0)

        cases = (
            ([120] * 5, [60] * 5, 4, 4),
            ([100] * 5, [85] * 5, 4, 2),
            ([120] * 5, [60] * 3, 4, 2),
        )
        for active, candidate, active_hops, candidate_hops in cases:
            with self.subTest(
                active_hops=active_hops,
                candidate_hops=candidate_hops,
                candidate_samples=len(candidate),
            ):
                accepted, _result = self.bridge._overlay_migration_quality_acceptable(
                    active,
                    candidate,
                    active_hops,
                    candidate_hops,
                )
                self.assertFalse(accepted)

    def test_rtt_rounds_alternate_probe_order(self):
        calls = []

        def probe(link_id, purpose):
            calls.append((link_id, purpose))
            event = threading.Event()
            event.set()
            return {
                "event": event,
                "rtt_ms": 100.0 if link_id == self.active_link_id else 40.0,
            }

        with mock.patch.object(
            self.bridge,
            "_send_overlay_rtt_probe",
            side_effect=probe,
        ):
            active, candidate = self.bridge._collect_overlay_migration_rtt_samples(
                self.active_link_id,
                "candidate-overlay",
            )

        self.assertEqual(
            [link_id for link_id, _purpose in calls[:4]],
            [
                self.active_link_id,
                "candidate-overlay",
                "candidate-overlay",
                self.active_link_id,
            ],
        )
        self.assertEqual(
            len(active),
            self.bridge._OVERLAY_ROUTE_MIGRATION_PROBE_SAMPLES,
        )
        self.assertEqual(
            len(candidate),
            self.bridge._OVERLAY_ROUTE_MIGRATION_PROBE_SAMPLES,
        )

    def test_only_active_link_initiator_schedules_a_better_route_probe(self):
        with mock.patch.object(
            self.bridge,
            "_reticulum_path_snapshot",
            return_value={"has_path": True, "hops": 2},
        ) as path_snapshot, mock.patch.object(
            self.bridge,
            "_reticulum_link_route_snapshot",
            return_value={"remote_hops": 7},
        ) as route_snapshot, mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            return_value=True,
        ) as enqueue:
            self.assertTrue(
                self.bridge._maybe_schedule_overlay_route_migration(
                    self.peer_hash,
                    "test_announce",
                )
            )

        self.assertEqual(enqueue.call_count, 1)
        self.assertIs(
            enqueue.call_args.args[2],
            self.bridge._overlay_route_migration_inspection_job,
        )
        path_snapshot.assert_not_called()
        route_snapshot.assert_not_called()
        self.assertIn(
            self.peer_hash,
            self.bridge._overlay_route_migration_pending_by_peer_hash,
        )

        self.bridge._overlay_route_migration_pending_by_peer_hash.clear()
        self.bridge._overlay_route_migration_last_attempt_at_by_peer_hash.clear()
        self.active_state["incoming"] = True
        with mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            return_value=True,
        ) as enqueue:
            self.assertFalse(
                self.bridge._maybe_schedule_overlay_route_migration(
                    self.peer_hash,
                    "test_announce",
                )
            )
        enqueue.assert_not_called()

    def test_route_inspection_starts_migration_only_for_a_better_path(self):
        self.bridge._overlay_route_migration_pending_by_peer_hash.add(self.peer_hash)
        target_path = {"has_path": True, "hops": 2}
        active_route = {"remote_hops": 7}
        with mock.patch.object(
            self.bridge,
            "_reticulum_path_snapshot",
            return_value=target_path,
        ), mock.patch.object(
            self.bridge,
            "_reticulum_link_route_snapshot",
            return_value=active_route,
        ), mock.patch.object(
            self.bridge,
            "_overlay_route_migration_job",
        ) as migrate:
            self.bridge._overlay_route_migration_inspection_job(
                self.peer_hash,
                self.active_link_id,
                "test_announce",
            )

        migrate.assert_called_once_with(
            self.peer_hash,
            self.active_link_id,
            target_path,
            active_route,
        )
        self.assertIn(
            self.peer_hash,
            self.bridge._overlay_route_migration_last_attempt_at_by_peer_hash,
        )
        self.assertNotIn(
            self.peer_hash,
            self.bridge._overlay_route_migration_pending_by_peer_hash,
        )

    def test_dedup_does_not_select_or_close_a_migration_candidate(self):
        candidate_link_id = "candidate-overlay"
        candidate_state = dict(self.active_state)
        candidate_state.update(
            {
                "linkId": candidate_link_id,
                "link": FakeLink(),
                "migration_candidate": True,
            }
        )
        self.bridge._overlay_links_by_id[candidate_link_id] = candidate_state

        with mock.patch.object(
            self.bridge,
            "_schedule_overlay_duplicate_close",
        ) as close:
            kept = self.bridge._dedup_overlay_links_for_peer(self.peer_hash)

        self.assertIs(kept, self.active_state)
        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            self.active_link_id,
        )
        close.assert_not_called()

    def test_promoted_candidate_keeps_old_link_as_non_reclaiming_backup(self):
        candidate_link_id = "candidate-overlay"
        transaction_id = "44" * 8
        candidate_state = dict(self.active_state)
        candidate_state.update(
            {
                "linkId": candidate_link_id,
                "link": FakeLink(),
                "migration_candidate": True,
                "migration_source_link_id": self.active_link_id,
                "overlay_transport_admitted": True,
                "migration_transaction_id": transaction_id,
            }
        )
        self.bridge._overlay_links_by_id[candidate_link_id] = candidate_state

        with mock.patch.object(
            self.bridge,
            "emit_overlay_link_state",
        ), mock.patch.object(
            self.bridge,
            "_schedule_delayed_presence_announce_replay",
        ), mock.patch.object(
            self.bridge,
            "_flush_overlay_link_pending",
        ), mock.patch.object(
            self.bridge,
            "_schedule_overlay_duplicate_close",
        ) as delayed_close:
            self.assertTrue(
                self.bridge._promote_overlay_migration_candidate(
                    self.peer_hash,
                    candidate_link_id,
                    "test_commit",
                )
            )

            self.assertEqual(
                self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
                candidate_link_id,
            )
            self.assertTrue(self.active_state["migration_draining"])
            delayed_close.assert_not_called()
            self.assertIs(
                self.bridge._dedup_overlay_links_for_peer(self.peer_hash),
                candidate_state,
            )
            delayed_close.assert_not_called()

            self.assertTrue(
                self.bridge._finalize_overlay_migration(
                    self.peer_hash,
                    candidate_link_id,
                    transaction_id,
                    "test_finalize",
                )
            )
            delayed_close.assert_called_once_with(
                self.peer_hash,
                candidate_link_id,
                self.active_link_id,
                "route_migrated",
            )

        kept = self.bridge._register_active_overlay_for_peer(
            self.peer_hash,
            self.active_link_id,
        )
        self.assertIs(kept, candidate_state)
        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            candidate_link_id,
        )

        removed = self.bridge.remove_overlay_link(candidate_link_id)
        self.assertIs(removed, candidate_state)
        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            self.active_link_id,
        )
        self.assertNotIn("migration_draining", self.active_state)

    def test_candidate_send_failure_does_not_refresh_active_peer_path(self):
        state = {
            "linkId": "candidate-overlay",
            "link": FakeLink(),
            "peerPresenceHash": self.peer_hash,
            "migration_candidate": True,
        }
        with mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=False,
        ), mock.patch.object(
            self.bridge,
            "_overlay_enqueue_close",
            return_value=True,
        ) as close, mock.patch.object(
            self.bridge,
            "_force_overlay_peer_path_refresh",
        ) as refresh:
            self.assertFalse(
                self.bridge._send_overlay_transport_control(
                    state["link"],
                    state,
                    self.bridge._OVERLAY_PING_WIRE_TYPE,
                    "candidate_test",
                )
            )

        close.assert_called_once_with(
            "candidate-overlay",
            "overlay_transport_packet_send_false",
        )
        refresh.assert_not_called()

    def test_candidate_teardown_leaves_active_link_and_peer_state_untouched(self):
        candidate_link = FakeLink()
        candidate_link_id = "candidate-overlay"
        self.bridge._overlay_links_by_id[candidate_link_id] = {
            "linkId": candidate_link_id,
            "link": candidate_link,
            "peerPresenceHash": self.peer_hash,
            "migration_candidate": True,
            "manager_kind": "overlay",
            "manager_state": self.bridge._LINK_STATE_CONNECTING,
            "generation": 0,
        }
        self.bridge._overlay_link_ids_by_object[id(candidate_link)] = candidate_link_id

        with mock.patch.object(
            self.bridge,
            "_run_with_timeout",
            return_value=(True, None, None),
        ), mock.patch.object(
            self.bridge,
            "emit_overlay_link_state",
        ), mock.patch.object(
            self.bridge,
            "_demote_overlay_fanout_peer",
        ) as demote, mock.patch.object(
            self.bridge,
            "_overlay_enqueue_peer_recovery",
        ) as recovery:
            self.bridge._teardown_overlay_link_id(
                candidate_link_id,
                "overlay_transport_packet_send_false",
            )

        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            self.active_link_id,
        )
        self.assertIn(self.active_link_id, self.bridge._overlay_links_by_id)
        demote.assert_not_called()
        recovery.assert_not_called()

    def test_unsolicited_incoming_candidate_is_rejected(self):
        self.bridge._overlay_links_by_id.clear()
        self.bridge._active_overlay_link_id_by_peer_hash.clear()
        incoming = FakeLink()
        with mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            return_value=True,
        ) as enqueue:
            link_id = self.bridge._register_incoming_overlay_link(
                incoming,
                self.peer_hash,
                "test_candidate",
                migration_candidate=True,
            )

        self.assertEqual(link_id, "")
        self.assertEqual(self.bridge._overlay_links_by_id, {})
        self.assertEqual(enqueue.call_count, 1)

    def test_capable_active_peer_can_register_protected_incoming_candidate(self):
        self.active_state["incoming"] = True
        self.bridge._inbound_overlay_neighbors[self.peer_hash] = time.time()
        incoming = FakeLink()
        incoming.remote_identity = object()
        with mock.patch.object(
            self.bridge,
            "_send_overlay_hello_for_link",
        ) as send_hello, mock.patch.object(
            self.bridge,
            "derive_presence_destination_hash_for_identity",
            return_value=self.peer_hash,
        ):
            link_id = self.bridge._register_incoming_overlay_link(
                incoming,
                self.peer_hash,
                "test_candidate",
                migration_candidate=True,
            )

        self.assertTrue(link_id)
        self.assertTrue(
            self.bridge._overlay_links_by_id[link_id]["migration_candidate"]
        )
        self.assertTrue(
            self.bridge._overlay_links_by_id[link_id]["migration_peer_authenticated"]
        )
        send_hello.assert_called_once_with(link_id, "incoming:test_candidate")
        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            self.active_link_id,
        )

    def test_unidentified_incoming_candidate_cannot_replace_active_link(self):
        self.active_state["incoming"] = True
        self.bridge._inbound_overlay_neighbors[self.peer_hash] = time.time()
        incoming = FakeLink()
        with mock.patch.object(
            self.bridge,
            "_send_overlay_hello_for_link",
        ) as send_hello, mock.patch.object(
            self.bridge,
            "_send_overlay_transport_control",
            return_value=True,
        ) as send_control:
            link_id = self.bridge._register_incoming_overlay_link(
                incoming,
                self.peer_hash,
                "test_candidate",
                migration_candidate=True,
            )

        self.assertTrue(link_id)
        candidate = self.bridge._overlay_links_by_id[link_id]
        self.assertFalse(candidate["migration_peer_authenticated"])
        self.assertFalse(candidate.get("overlay_transport_admitted") is True)
        send_hello.assert_not_called()
        self.assertTrue(
            self.bridge._handle_overlay_transport_control(
                {
                    "t": self.bridge._OVERLAY_HELLO_WIRE_TYPE,
                    "r": self.peer_hash,
                    "c": [self.bridge._OVERLAY_ROUTE_MIGRATION_CAPABILITY],
                    "m": self.bridge._OVERLAY_ROUTE_MIGRATION_MARKER,
                },
                incoming,
                link_id,
                candidate,
            )
        )
        send_control.assert_not_called()
        self.assertFalse(candidate["migration_ready_event"].is_set())
        self.assertFalse(
            self.bridge._promote_overlay_migration_candidate(
                self.peer_hash,
                link_id,
                "unauthenticated_commit",
            )
        )
        self.assertEqual(
            self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
            self.active_link_id,
        )

    def test_mismatched_incoming_candidate_identity_is_rejected(self):
        self.active_state["incoming"] = True
        self.bridge._inbound_overlay_neighbors[self.peer_hash] = time.time()
        incoming = FakeLink()
        incoming.remote_identity = object()
        with mock.patch.object(
            self.bridge,
            "derive_presence_destination_hash_for_identity",
            return_value="cd" * 16,
        ), mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            return_value=True,
        ) as enqueue:
            link_id = self.bridge._register_incoming_overlay_link(
                incoming,
                self.peer_hash,
                "test_candidate",
                migration_candidate=True,
            )

        self.assertEqual(link_id, "")
        self.assertNotIn(id(incoming), self.bridge._overlay_link_ids_by_object)
        enqueue.assert_called_once()

    def test_remote_commit_retains_old_link_until_finalize(self):
        self.active_state["incoming"] = True
        self.bridge._inbound_overlay_neighbors[self.peer_hash] = time.time()
        candidate_link_id = "candidate-overlay"
        transaction_id = "55" * 8
        candidate = dict(self.active_state)
        candidate.update(
            {
                "linkId": candidate_link_id,
                "link": FakeLink(),
                "incoming": True,
                "migration_candidate": True,
                "migration_source_link_id": self.active_link_id,
                "migration_peer_authenticated": True,
                "overlay_transport_admitted": True,
            }
        )
        self.bridge._overlay_links_by_id[candidate_link_id] = candidate

        with mock.patch.object(
            self.bridge,
            "emit_overlay_link_state",
        ), mock.patch.object(
            self.bridge,
            "_schedule_delayed_presence_announce_replay",
        ), mock.patch.object(
            self.bridge,
            "_flush_overlay_link_pending",
        ), mock.patch.object(
            self.bridge,
            "_send_overlay_transport_control",
            return_value=True,
        ) as send, mock.patch.object(
            self.bridge,
            "_schedule_overlay_duplicate_close",
        ) as delayed_close, mock.patch.object(
            self.bridge,
            "_overlay_enqueue_dedup",
        ):
            commit = {
                "t": self.bridge._OVERLAY_MIGRATION_COMMIT_WIRE_TYPE,
                "r": self.peer_hash,
                "q": transaction_id,
            }
            self.assertTrue(
                self.bridge._handle_overlay_transport_control(
                    commit,
                    candidate["link"],
                    candidate_link_id,
                    candidate,
                )
            )
            self.assertEqual(
                self.bridge._active_overlay_link_id_by_peer_hash[self.peer_hash],
                candidate_link_id,
            )
            delayed_close.assert_not_called()
            self.assertEqual(
                send.call_args.args[2],
                self.bridge._OVERLAY_MIGRATION_ACK_WIRE_TYPE,
            )
            self.assertTrue(
                self.bridge._handle_overlay_transport_control(
                    commit,
                    candidate["link"],
                    candidate_link_id,
                    candidate,
                )
            )
            self.assertEqual(send.call_count, 2)
            delayed_close.assert_not_called()

            finalize = {
                "t": self.bridge._OVERLAY_MIGRATION_FINALIZE_WIRE_TYPE,
                "r": self.peer_hash,
                "q": transaction_id,
            }
            self.assertTrue(
                self.bridge._handle_overlay_transport_control(
                    finalize,
                    candidate["link"],
                    candidate_link_id,
                    candidate,
                )
            )
            delayed_close.assert_called_once_with(
                self.peer_hash,
                candidate_link_id,
                self.active_link_id,
                "route_migrated",
            )

    def test_delayed_remote_identity_unlocks_incoming_candidate(self):
        self.active_state["incoming"] = True
        self.bridge._inbound_overlay_neighbors[self.peer_hash] = time.time()
        incoming = FakeLink()
        with mock.patch.object(
            self.bridge,
            "_send_overlay_hello_for_link",
        ) as send_hello:
            link_id = self.bridge._register_incoming_overlay_link(
                incoming,
                self.peer_hash,
                "test_candidate",
                migration_candidate=True,
            )
            send_hello.assert_not_called()

            identity = object()
            incoming.remote_identity = identity
            with mock.patch.object(
                self.bridge,
                "derive_presence_destination_hash_for_identity",
                return_value=self.peer_hash,
            ), mock.patch.object(
                self.bridge,
                "find_peer_hash_for_identity",
                return_value=self.peer_hash,
            ), mock.patch.object(
                self.bridge,
                "emit_overlay_link_state",
            ), mock.patch.object(
                self.bridge,
                "_note_overlay_peer_alive",
            ), mock.patch.object(
                self.bridge,
                "_register_active_overlay_for_peer",
            ), mock.patch.object(
                self.bridge,
                "_overlay_enqueue_dedup",
            ):
                self.bridge.on_overlay_link_remote_identified(incoming, identity)

        candidate = self.bridge._overlay_links_by_id[link_id]
        self.assertTrue(candidate["migration_peer_authenticated"])
        self.assertTrue(candidate["overlay_transport_admitted"])
        send_hello.assert_called_once_with(link_id, "migration_identity_verified")


class PresenceBridgeResourceSchedulingTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.peer_hash = "ab" * 16

    def test_resource_commands_use_fast_control_lane(self):
        actions = (
            "accept_reticulum_chat_resource",
            "send_reticulum_chat_resource",
            "authorize_reticulum_chat_resource",
            "reject_reticulum_chat_resource",
            "cancel_reticulum_resource",
        )
        for action in actions:
            with self.subTest(action=action):
                self.assertEqual(
                    self.bridge._scheduler_lane_for_command(action),
                    "resource-control",
                )

    def test_resource_open_shard_is_stable_for_a_peer(self):
        lane = self.bridge._resource_open_scheduler_lane(self.peer_hash)
        self.assertEqual(
            lane,
            self.bridge._resource_open_scheduler_lane(self.peer_hash.upper()),
        )
        self.assertIn(lane, self.bridge._SCHEDULER_QUEUE_MAX_BY_LANE)
        self.assertTrue(lane.startswith("resource-open-"))

    def test_only_one_link_handshake_starts_per_peer(self):
        first = {"peerPresenceHash": self.peer_hash, "transferId": "first"}
        second = {"peerPresenceHash": self.peer_hash, "transferId": "second"}
        scheduled = []
        started = []
        with mock.patch.object(
            self.bridge,
            "_enqueue_scheduler_task",
            side_effect=lambda lane, name, fn, *args, **kwargs: scheduled.append(
                (lane, name, fn, args, kwargs)
            )
            or True,
        ), mock.patch.object(
            self.bridge,
            "_run_qchat_file_open_task",
            side_effect=lambda state: started.append(state),
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(first))
            self.assertTrue(self.bridge._queue_qchat_file_open_state(second))
            self.assertEqual(len(scheduled), 1)

            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)
            self.assertEqual(started, [first])

            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)
            self.assertEqual(started, [first])

            self.bridge._release_qchat_file_open_slot(first)
            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)
            self.assertEqual(started, [first, second])

    def test_chat_opens_are_queued_before_bulk_resources(self):
        bulk = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "bulk",
            "resourceType": "reticulum_group_resource",
        }
        chat = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "chat",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(bulk))
            self.assertTrue(self.bridge._queue_qchat_file_open_state(chat))

        queued = list(self.bridge._qchat_file_open_queue_by_peer[self.peer_hash])
        self.assertEqual([item["transferId"] for item in queued], ["chat", "bulk"])

    def test_active_resource_links_are_bounded_per_peer(self):
        waiting = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "waiting",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        started = []
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(waiting))
        for index in range(self.bridge._QCHAT_FILE_ACTIVE_OUTGOING_MAX_PER_PEER):
            self.bridge._qchat_file_links_by_id[f"active-{index}"] = {
                "peerPresenceHash": self.peer_hash,
                "incoming": False,
                "transferId": f"active-{index}",
            }
        with mock.patch.object(
            self.bridge,
            "_run_qchat_file_open_task",
            side_effect=lambda state: started.append(state),
        ):
            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)
            self.assertEqual(started, [])
            self.bridge._qchat_file_links_by_id.pop("active-0")
            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)
            self.assertEqual(started, [waiting])

    def test_chat_can_use_reserved_slot_while_bulk_is_at_its_limit(self):
        bulk_waiting = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "bulk-waiting",
            "resourceType": "reticulum_group_resource",
        }
        chat_waiting = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "chat-waiting",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(bulk_waiting))
            self.assertTrue(self.bridge._queue_qchat_file_open_state(chat_waiting))
        for index in range(self.bridge._QCHAT_FILE_BULK_ACTIVE_MAX_PER_PEER):
            self.bridge._qchat_file_links_by_id[f"bulk-active-{index}"] = {
                "peerPresenceHash": self.peer_hash,
                "incoming": False,
                "transferId": f"bulk-active-{index}",
                "resourceType": "reticulum_group_resource",
            }
        started = []
        with mock.patch.object(
            self.bridge,
            "_run_qchat_file_open_task",
            side_effect=lambda state: started.append(state),
        ):
            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)

        self.assertEqual(started, [chat_waiting])
        self.assertIn(
            bulk_waiting,
            self.bridge._qchat_file_open_queue_by_peer[self.peer_hash],
        )

    def test_successful_link_removal_wakes_waiting_peer_queue(self):
        waiting = {"peerPresenceHash": self.peer_hash, "transferId": "waiting"}
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(waiting))
        link = FakeLink()
        active = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "completed",
            "incoming": False,
            "link": link,
        }
        self.bridge._qchat_file_links_by_id["completed-link"] = active
        self.bridge._qchat_file_link_ids_by_object[id(link)] = "completed-link"

        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ) as schedule, mock.patch.object(
            self.bridge,
            "_teardown_reticulum_link_bounded",
        ):
            self.bridge._qchat_file_receiver_transfer_done(
                self.peer_hash,
                "completed",
            )

        schedule.assert_any_call(self.peer_hash)
        self.assertIn(
            waiting,
            self.bridge._qchat_file_open_queue_by_peer[self.peer_hash],
        )

    def test_final_unestablished_link_failure_cleans_pending_transfer(self):
        transfer_id = "max-attempts"
        link = FakeLink()
        pending = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
        }
        state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "established": False,
            "open_attempts": self.bridge._QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS,
            "authMessage": {"type": "test"},
            "receive_root": pending,
            "link": link,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)
        self.bridge._qchat_file_links_by_id["max-link"] = state
        self.bridge._qchat_file_link_ids_by_object[id(link)] = "max-link"

        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge.on_qchat_file_link_closed(link)

        failed = [
            call
            for call in emit.call_args_list
            if call.args and call.args[0] == "failed"
        ]
        self.assertEqual(len(failed), 1)
        self.assertEqual(
            failed[0].args[1]["reason"],
            "file_link_open_attempts_exhausted",
        )
        self.assertNotIn(
            transfer_id,
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertTrue(pending.get("cancelled"))

    def test_exhausted_parallel_link_keeps_viable_sibling_transfer(self):
        transfer_id = "parallel-transfer"
        failed_link = FakeLink()
        pending = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
        }
        failed_state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "established": False,
            "open_attempts": self.bridge._QCHAT_FILE_LINK_MAX_OPEN_ATTEMPTS,
            "authMessage": {"type": "test"},
            "receive_root": pending,
            "link": failed_link,
        }
        sibling = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "established": True,
            "receive_root": pending,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)
        self.bridge._qchat_file_links_by_id["failed-link"] = failed_state
        self.bridge._qchat_file_link_ids_by_object[id(failed_link)] = "failed-link"
        self.bridge._qchat_file_links_by_id["sibling-link"] = sibling

        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge.on_qchat_file_link_closed(failed_link)

        self.assertFalse(
            any(call.args and call.args[0] == "failed" for call in emit.call_args_list)
        )
        self.assertIn(
            transfer_id,
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertFalse(pending.get("cancelled", False))

    def test_path_timeout_cleans_pending_transfer(self):
        transfer_id = "path-timeout"
        pending = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
        }
        state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "receive_root": pending,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

        with mock.patch.object(
            self.bridge,
            "_open_qchat_file_link_for_state",
            side_effect=TimeoutError("no path"),
        ), mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge._run_qchat_file_open_task(state)

        emit.assert_any_call(
            "failed",
            mock.ANY,
        )
        self.assertNotIn(
            transfer_id,
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertTrue(pending.get("cancelled"))

    def test_path_timeout_keeps_viable_parallel_sibling(self):
        transfer_id = "parallel-path-timeout"
        pending = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
        }
        timed_out_state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "receive_root": pending,
        }
        sibling = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "established": True,
            "receive_root": pending,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)
        self.bridge._qchat_file_links_by_id["path-sibling"] = sibling

        with mock.patch.object(
            self.bridge,
            "_open_qchat_file_link_for_state",
            side_effect=TimeoutError("no path"),
        ), mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge._run_qchat_file_open_task(timed_out_state)

        self.assertFalse(
            any(call.args and call.args[0] == "failed" for call in emit.call_args_list)
        )
        self.assertIn(
            transfer_id,
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertFalse(pending.get("cancelled", False))

    def test_path_timeout_fails_once_when_only_queued_siblings_remain(self):
        transfer_id = "queued-path-timeout"
        pending = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
        }
        timed_out_state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "receive_root": pending,
        }
        queued_sibling = {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "incoming": False,
            "receive_root": pending,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(
                self.bridge._queue_qchat_file_open_state(queued_sibling)
            )

        with mock.patch.object(
            self.bridge,
            "_open_qchat_file_link_for_state",
            side_effect=TimeoutError("no path"),
        ), mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge._run_qchat_file_open_task(timed_out_state)

        failed = [
            call
            for call in emit.call_args_list
            if call.args and call.args[0] == "failed"
        ]
        self.assertEqual(len(failed), 1)
        self.assertNotIn(
            transfer_id,
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertTrue(pending.get("cancelled"))

    def test_terminal_cleanup_does_not_cancel_another_peer_transfer(self):
        current = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "current-transfer",
        }
        stale_state = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "stale-transfer",
            "incoming": False,
        }
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, current)

        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit"):
            self.bridge._qchat_file_fail_open_state(
                stale_state,
                "link_open_failed",
                force_transfer_failure=True,
            )

        self.assertIn(
            "current-transfer",
            self.bridge._qchat_file_accepts_by_transfer,
        )
        self.assertFalse(current.get("cancelled", False))

    def test_cancelled_transfer_is_removed_from_open_queue(self):
        receive_root = {"cancelled": False}
        waiting = {
            "peerPresenceHash": self.peer_hash,
            "transferId": "cancelled",
            "receive_root": receive_root,
        }
        with mock.patch.object(
            self.bridge,
            "_schedule_qchat_file_peer_open_drain",
            return_value=True,
        ):
            self.assertTrue(self.bridge._queue_qchat_file_open_state(waiting))
        receive_root["cancelled"] = True

        with mock.patch.object(
            self.bridge,
            "_run_qchat_file_open_task",
        ) as open_task:
            self.bridge._run_qchat_file_peer_open_queue(self.peer_hash)

        open_task.assert_not_called()
        self.assertNotIn(
            self.peer_hash,
            self.bridge._qchat_file_open_queue_by_peer,
        )
        self.assertNotIn(id(waiting), self.bridge._qchat_file_open_queue_state_ids)

    def test_waiting_for_path_does_not_consume_link_attempt(self):
        state = {
            "peerPresenceHash": self.peer_hash,
            "peerIdentity": object(),
            "transferId": "waiting-for-path",
        }
        outbound = FakeDestination()
        outbound.hash = bytes.fromhex(self.peer_hash)
        with mock.patch.object(
            self.bridge,
            "build_outbound_destination",
            return_value=outbound,
        ), mock.patch.object(
            self.bridge,
            "_request_qchat_file_path",
            return_value=False,
        ):
            with self.assertRaises(self.bridge._QChatFilePathPending):
                self.bridge._open_qchat_file_link_for_state(state)

        self.assertEqual(int(state.get("open_attempts") or 0), 0)
        self.assertGreater(float(state.get("path_wait_started_at") or 0), 0)

    def test_failed_cached_path_is_refreshed_only_once_while_polling(self):
        state = {
            "peerPresenceHash": self.peer_hash,
            "peerIdentity": object(),
            "transferId": "refresh-once",
        }
        outbound = FakeDestination()
        outbound.hash = bytes.fromhex(self.peer_hash)
        refresh_permissions = []

        def request_path(_destination_hash, _peer_hash, **kwargs):
            refresh_permissions.append(kwargs.get("allow_failed_path_refresh"))
            return False

        with mock.patch.object(
            self.bridge,
            "build_outbound_destination",
            return_value=outbound,
        ), mock.patch.object(
            self.bridge,
            "_peer_has_recent_unestablished_link_failure",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_request_qchat_file_path",
            side_effect=request_path,
        ):
            for _ in range(2):
                with self.assertRaises(self.bridge._QChatFilePathPending):
                    self.bridge._open_qchat_file_link_for_state(state)

        self.assertEqual(refresh_permissions, [True, False])
        self.assertTrue(state.get("failed_path_refresh_requested"))
        self.assertEqual(int(state.get("open_attempts") or 0), 0)


class PresenceBridgeReusableResourceSessionTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.peer_hash = "ab" * 16

    def pending(
        self,
        transfer_id,
        *,
        resource_type=None,
        event_id="",
        sha256="",
        timestamp=None,
    ):
        resource_type = resource_type or self.bridge._RETICULUM_CHAT_RESOURCE_TYPE
        auth = {
            "type": "RCR",
            "transferId": transfer_id,
            "ts": timestamp if timestamp is not None else int(time.time() * 1000),
        }
        if event_id:
            auth["eventId"] = event_id
        return {
            "peerPresenceHash": self.peer_hash,
            "transferId": transfer_id,
            "savePath": f"/tmp/{transfer_id}.recv",
            "fileName": f"{transfer_id}.bin",
            "size": 128,
            "sha256": sha256,
            "resourceType": resource_type,
            "metadata": {
                "groupId": 716,
                **({"eventId": event_id} if event_id else {}),
            },
            "peerIdentity": object(),
            "authMessage": auth,
        }

    def session(self, lane="fast", established=True, slot=0):
        session_id = f"session-{lane}-{slot}"
        link = FakeSessionLink()
        state = {
            "linkId": session_id,
            "manager_kind": "resource_session",
            "sessionKey": self.bridge._resource_session_key(self.peer_hash, lane, slot),
            "sessionLane": lane,
            "sessionSlot": slot,
            "peerPresenceHash": self.peer_hash,
            "incoming": False,
            "established": established,
            "remote_ready": established,
            "provider_ready_sent": established,
            "created_at": time.time(),
            "last_used_at": time.time(),
            "pending_jobs": [],
            "active_requests": {},
            "provider_active": 0,
            "link": link,
            "generation": 1,
            "activity_generation": 1,
        }
        self.bridge._qchat_file_links_by_id[session_id] = state
        self.bridge._qchat_file_link_ids_by_object[id(link)] = session_id
        self.bridge._resource_sessions_by_key[state["sessionKey"]] = session_id
        return state, link

    def test_parallel_peer_lookup_requires_an_exact_transfer_id(self):
        first = self.pending("first-range", resource_type="reticulum_group_resource_range")
        second = self.pending("second-range", resource_type="reticulum_group_resource_range")
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, first)
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, second)

        self.assertIs(
            self.bridge._qchat_file_get_pending_receive(self.peer_hash, "first-range"),
            first,
        )
        self.assertIs(
            self.bridge._qchat_file_get_pending_receive(self.peer_hash, "second-range"),
            second,
        )
        self.assertIsNone(
            self.bridge._qchat_file_get_pending_receive(self.peer_hash, "unknown-range")
        )
        self.assertIsNone(self.bridge._qchat_file_get_pending_receive(self.peer_hash))

        self.bridge._qchat_file_remove_pending_receive(self.peer_hash, "second-range")
        self.assertIs(self.bridge._qchat_file_get_pending_receive(self.peer_hash), first)

    def test_parallel_ranges_with_same_event_have_distinct_semantic_keys(self):
        first = self.pending(
            "first-range",
            resource_type="reticulum_group_resource_range",
            event_id="shared-event",
        )
        second = self.pending(
            "second-range",
            resource_type="reticulum_group_resource_range",
            event_id="shared-event",
        )
        file_hash = "ab" * 32
        first["metadata"].update(
            {"fileHash": file_hash, "byteRanges": [[0, 1048576]]}
        )
        second["metadata"].update(
            {"fileHash": file_hash, "byteRanges": [[1048576, 2097152]]}
        )

        self.assertNotEqual(
            self.bridge._resource_session_semantic_key(first),
            self.bridge._resource_session_semantic_key(second),
        )

    def test_session_response_skips_legacy_peer_fallback_callbacks(self):
        _state, link = self.session(lane="bulk")
        first = self.pending("first-range", resource_type="reticulum_group_resource_range")
        second = self.pending("second-range", resource_type="reticulum_group_resource_range")
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, first)
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, second)

        class ResponseResource:
            request_id = bytes.fromhex("33" * 16)

            def __init__(self, response_link):
                self.link = response_link

        resource = ResponseResource(link)
        with mock.patch.object(
            self.bridge,
            "_qchat_file_get_pending_receive",
        ) as get_pending, mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge.on_qchat_file_resource_started(resource)
            self.bridge.on_qchat_file_resource_concluded(resource)

        get_pending.assert_not_called()
        emit.assert_not_called()
        self.assertIn("first-range", self.bridge._qchat_file_accepts_by_transfer)
        self.assertIn("second-range", self.bridge._qchat_file_accepts_by_transfer)

    def test_range_response_is_bound_to_its_transfer_and_payload_hash(self):
        contents = b"verified range response"
        payload_hash = self.bridge.hashlib.sha256(contents).hexdigest()
        transfer_id = "verified-range"
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.bin"
            save_path = Path(directory) / "received.bin"
            source_path.write_bytes(contents)
            response = open(source_path, "rb")
            receipt = FakeSessionReceipt()
            receipt.response = response
            receipt.metadata = {
                "transferId": transfer_id,
                "size": len(contents),
                "sha256": payload_hash,
            }
            pending = self.pending(
                transfer_id,
                resource_type="reticulum_group_resource_range",
            )
            pending.update(
                {
                    "savePath": str(save_path),
                    "size": len(contents),
                }
            )
            job = {
                "transferId": transfer_id,
                "pending": pending,
                "created_at": time.time(),
                "followers": [],
            }
            self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

            with mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_response_received(job, receipt)

            self.assertTrue(job["completed"])
            self.assertEqual(save_path.read_bytes(), contents)
            received = [
                call
                for call in emit.call_args_list
                if call.args and call.args[0] == "received"
            ]
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0].args[1]["transferId"], transfer_id)
            self.assertEqual(received[0].args[1]["payloadHash"], payload_hash)

    def test_range_response_from_legacy_peer_uses_request_receipt_identity(self):
        contents = b"legacy range response"
        payload_hash = self.bridge.hashlib.sha256(contents).hexdigest()
        transfer_id = "expected-range"
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.bin"
            save_path = Path(directory) / "received.bin"
            source_path.write_bytes(contents)
            receipt = FakeSessionReceipt()
            receipt.response = open(source_path, "rb")
            receipt.metadata = {"size": len(contents)}
            pending = self.pending(
                transfer_id,
                resource_type="reticulum_group_resource_range",
            )
            pending.update(
                {
                    "savePath": str(save_path),
                    "size": len(contents),
                }
            )
            job = {
                "transferId": transfer_id,
                "pending": pending,
                "created_at": time.time(),
                "followers": [],
            }
            self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

            with mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_response_received(job, receipt)

            self.assertTrue(job["completed"])
            self.assertEqual(save_path.read_bytes(), contents)
            received = [
                call
                for call in emit.call_args_list
                if call.args and call.args[0] == "received"
            ]
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0].args[1]["transferId"], transfer_id)
            self.assertEqual(received[0].args[1]["payloadHash"], payload_hash)

    def test_range_response_rejects_mismatched_metadata_identity(self):
        contents = b"wrong transfer response"
        transfer_id = "expected-range"
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.bin"
            save_path = Path(directory) / "received.bin"
            source_path.write_bytes(contents)
            receipt = FakeSessionReceipt()
            receipt.response = open(source_path, "rb")
            receipt.metadata = {"transferId": "different-range"}
            pending = self.pending(
                transfer_id,
                resource_type="reticulum_group_resource_range",
            )
            pending.update({"savePath": str(save_path), "size": len(contents)})
            job = {
                "transferId": transfer_id,
                "pending": pending,
                "created_at": time.time(),
                "followers": [],
            }
            self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

            with mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_response_received(job, receipt)

            self.assertFalse(save_path.exists())
            failures = [
                call
                for call in emit.call_args_list
                if call.args and call.args[0] == "failed"
            ]
            self.assertEqual(len(failures), 1)
            self.assertEqual(failures[0].args[1]["reason"], "resource_response_invalid")
            self.assertIn("transfer id mismatch", failures[0].args[1]["error"])

    def test_managed_accept_uses_reusable_session_instead_of_link_queue(self):
        payload = {
            "peerPresenceHash": self.peer_hash,
            "reticulumIdentityPublicKeyBase64": "identity",
            "authMessage": {"type": "RCR", "ts": int(time.time() * 1000)},
            "transferId": "managed",
            "savePath": "/tmp/managed.recv",
            "fileName": "managed.bin",
            "size": 128,
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "expires_at": time.time() + 60,
        }
        with mock.patch.object(
            self.bridge,
            "_parse_qchat_file_peer_identity",
            return_value=object(),
        ), mock.patch.object(
            self.bridge,
            "_resource_session_accept",
        ) as accept_session, mock.patch.object(
            self.bridge,
            "_open_qchat_file_link_async",
        ) as open_legacy:
            self.bridge.handle_accept_qchat_file_resource("req", payload)

        accept_session.assert_called_once()
        open_legacy.assert_not_called()

    def test_fast_and_bulk_resources_use_separate_peer_sessions(self):
        fast_job = {
            "pending": self.pending("fast"),
            "created_at": time.time(),
        }
        bulk_job = {
            "pending": self.pending(
                "bulk",
                resource_type="reticulum_group_resource_range",
            ),
            "created_at": time.time(),
        }
        with mock.patch.object(self.bridge, "_resource_session_poll_path"):
            self.assertTrue(self.bridge._resource_session_enqueue_job(fast_job)[0])
            self.assertTrue(self.bridge._resource_session_enqueue_job(bulk_job)[0])

        self.assertIn(
            self.bridge._resource_session_key(self.peer_hash, "fast"),
            self.bridge._resource_sessions_by_key,
        )
        self.assertIn(
            self.bridge._resource_session_key(self.peer_hash, "bulk"),
            self.bridge._resource_sessions_by_key,
        )
        self.assertEqual(len(self.bridge._resource_sessions_by_key), 2)

    def test_live_event_and_history_use_separate_priority_lanes(self):
        history_pending = self.pending("history")
        history_pending["metadata"].update(
            {
                "logicalResourceType": "reticulum_chat_history_page",
                "channelId": "general",
                "direction": "before",
            }
        )
        history_pending["authMessage"].update({"before": {"id": "cursor"}})
        live_pending = self.pending(
            "live",
            event_id="event-live",
            sha256="11" * 32,
        )
        history_job = {"pending": history_pending, "created_at": time.time()}
        live_job = {"pending": live_pending, "created_at": time.time() + 0.01}

        with mock.patch.object(self.bridge, "_resource_session_poll_path"):
            self.assertTrue(self.bridge._resource_session_enqueue_job(history_job)[0])
            self.assertTrue(self.bridge._resource_session_enqueue_job(live_job)[0])

        fast_id = self.bridge._resource_sessions_by_key[
            self.bridge._resource_session_key(self.peer_hash, "fast")
        ]
        bulk_id = self.bridge._resource_sessions_by_key[
            self.bridge._resource_session_key(self.peer_hash, "bulk")
        ]
        self.assertEqual(
            [
                job["pending"]["transferId"]
                for job in self.bridge._qchat_file_links_by_id[fast_id]["pending_jobs"]
            ],
            ["live"],
        )
        self.assertEqual(
            [
                job["pending"]["transferId"]
                for job in self.bridge._qchat_file_links_by_id[bulk_id]["pending_jobs"]
            ],
            ["history"],
        )

    def test_dm_page_uses_fast_lane_for_live_delivery(self):
        self.assertEqual(
            self.bridge._resource_session_lane(
                self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                "reticulum_chat_dm_page",
            ),
            "fast",
        )

    def test_prepare_command_reuses_pending_session_and_reports_state(self):
        peer_identity = object()
        payload = {
            "peerPresenceHash": self.peer_hash,
            "reticulumIdentityPublicKeyBase64": "identity",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "logicalResourceType": "reticulum_chat_history_page",
        }
        with mock.patch.object(
            self.bridge,
            "_resource_session_poll_path",
        ) as poll_path, mock.patch.object(self.bridge, "emit_resp") as emit_resp:
            with mock.patch.object(
                self.bridge,
                "_parse_qchat_file_peer_identity",
                return_value=peer_identity,
            ) as parse_identity:
                self.bridge.handle_prepare_reticulum_resource_session("one", payload)
                self.bridge.handle_prepare_reticulum_resource_session("two", payload)

        poll_path.assert_called_once()
        parse_identity.assert_has_calls(
            [
                mock.call(self.peer_hash, "identity"),
                mock.call(self.peer_hash, "identity"),
            ]
        )
        self.assertEqual(len(self.bridge._resource_sessions_by_key), 1)
        session_id = next(iter(self.bridge._resource_sessions_by_key.values()))
        self.assertIs(
            self.bridge._qchat_file_links_by_id[session_id]["peerIdentity"],
            peer_identity,
        )
        self.assertEqual(emit_resp.call_count, 2)
        self.assertTrue(all(call.args[1] for call in emit_resp.call_args_list))
        self.assertTrue(
            all(
                call.kwargs["payload"]["status"] == "pending"
                and call.kwargs["payload"]["lane"] == "bulk"
                for call in emit_resp.call_args_list
            )
        )

    def test_prepare_command_recalls_identity_when_public_key_is_omitted(self):
        peer_identity = object()
        payload = {
            "peerPresenceHash": self.peer_hash,
            "reticulumIdentityPublicKeyBase64": "",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }

        def recall(peer_hash, source):
            self.assertEqual(peer_hash, self.peer_hash)
            self.assertEqual(source, "ts_seed")
            self.bridge._known_peers[peer_hash] = peer_identity
            return True

        with mock.patch.object(
            self.bridge,
            "ensure_known_peer_from_recall",
            side_effect=recall,
        ), mock.patch.object(
            self.bridge,
            "_resource_session_poll_path",
        ) as poll_path, mock.patch.object(self.bridge, "emit_resp") as emit_resp:
            self.bridge.handle_prepare_reticulum_resource_session("req", payload)

        poll_path.assert_called_once()
        session_id = next(iter(self.bridge._resource_sessions_by_key.values()))
        self.assertIs(
            self.bridge._qchat_file_links_by_id[session_id]["peerIdentity"],
            peer_identity,
        )
        emit_resp.assert_called_once_with(
            "req",
            True,
            payload=mock.ANY,
        )

    def test_prepare_command_rejects_unverified_peer_identity(self):
        payload = {
            "peerPresenceHash": self.peer_hash,
            "reticulumIdentityPublicKeyBase64": "bad-identity",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        with mock.patch.object(
            self.bridge,
            "_parse_qchat_file_peer_identity",
            side_effect=ValueError("identity mismatch"),
        ), mock.patch.object(
            self.bridge,
            "_resource_session_poll_path",
        ) as poll_path, mock.patch.object(self.bridge, "emit_resp") as emit_resp:
            self.bridge.handle_prepare_reticulum_resource_session("req", payload)

        poll_path.assert_not_called()
        emit_resp.assert_called_once_with(
            "req",
            False,
            payload={"code": "bad_reticulum_identity"},
            error="identity mismatch",
        )

    def test_prepare_command_parses_real_reticulum_identity(self):
        peer_identity = RNS.Identity()
        peer_hash = self.bridge.destination_hash_hex(
            self.bridge.build_outbound_destination(peer_identity).hash
        )
        public_key = base64.b64encode(peer_identity.get_public_key()).decode("ascii")
        payload = {
            "peerPresenceHash": peer_hash,
            "reticulumIdentityPublicKeyBase64": public_key,
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }

        with mock.patch.object(
            self.bridge,
            "_resource_session_poll_path",
        ) as poll_path, mock.patch.object(self.bridge, "emit_resp") as emit_resp:
            self.bridge.handle_prepare_reticulum_resource_session("req", payload)

        poll_path.assert_called_once()
        session_id = next(iter(self.bridge._resource_sessions_by_key.values()))
        parsed_identity = self.bridge._qchat_file_links_by_id[session_id]["peerIdentity"]
        self.assertEqual(parsed_identity.get_public_key(), peer_identity.get_public_key())
        emit_resp.assert_called_once_with("req", True, payload=mock.ANY)

    def test_sessions_are_bounded_per_peer_without_a_global_connection_cap(self):
        with mock.patch.object(self.bridge, "_resource_session_poll_path"):
            for index in range(24):
                peer_hash = f"{index + 1:032x}"
                state, reason = self.bridge._resource_session_get_or_create(
                    peer_hash,
                    object(),
                    "fast",
                )
                self.assertEqual(reason, "")
                self.assertIsInstance(state, dict)

        self.assertEqual(len(self.bridge._resource_sessions_by_key), 24)

    def test_bulk_pool_uses_one_resource_per_link_and_reserves_history(self):
        sessions = [
            self.session(lane="bulk", slot=index)
            for index in range(self.bridge._RESOURCE_SESSION_BULK_POOL_SIZE)
        ]
        for index, (state, _link) in enumerate(sessions[:5]):
            state["pending_jobs"] = [
                {
                    "pending": self.pending(
                        f"range-{index}",
                        resource_type="reticulum_group_resource_range",
                    ),
                    "created_at": time.time() + index / 1000,
                    "followers": [],
                }
            ]
        history = self.pending("visible-history")
        history["metadata"]["logicalResourceType"] = "reticulum_chat_history_page"
        sessions[5][0]["pending_jobs"] = [
            {
                "pending": history,
                "created_at": time.time() + 1,
                "followers": [],
            }
        ]

        for state, _link in sessions:
            self.bridge._resource_session_dispatch_pending(state)

        active = [
            job
            for state, _link in sessions
            for job in state["active_requests"].values()
        ]
        self.assertEqual(sum(len(link.requests) for _state, link in sessions), 6)
        self.assertTrue(all(len(link.requests) == 1 for _state, link in sessions))
        self.assertEqual(
            sum(
                self.bridge._resource_session_job_class(job) == "attachment"
                for job in active
            ),
            5,
        )
        self.assertTrue(
            any(
                job["pending"]["transferId"] == "visible-history"
                for job in active
            )
        )

    def test_session_waits_for_provider_ready_before_dispatch(self):
        state, link = self.session(established=False)
        self.bridge._destination = FakeDestination()
        with mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_resource_session_dispatch_pending",
        ), mock.patch.object(
            self.bridge,
            "_resource_session_schedule_idle_close",
        ), mock.patch.object(self.bridge, "emit_event") as emit_event:
            self.bridge.on_outgoing_resource_session_established(link)
            self.assertTrue(state["established"])
            self.assertFalse(state["remote_ready"])
            self.assertFalse(
                any(
                    call.args[0] == "reticulum_resource_session"
                    and call.args[1].get("status") == "ready"
                    for call in emit_event.call_args_list
                )
            )
            self.bridge._handle_qchat_file_link_packet(
                json.dumps(
                    {
                        "type": self.bridge._RESOURCE_SESSION_READY_TYPE,
                        "r": self.peer_hash,
                        "lane": "fast",
                        "providerIdleMs": 180000,
                    }
                ).encode("utf-8"),
                FakePacket(link),
            )

        self.assertTrue(state["remote_ready"])
        self.assertEqual(state["remote_provider_idle_seconds"], 180.0)
        emit_event.assert_any_call(
            "reticulum_resource_session",
            {
                "status": "ready",
                "peerPresenceHash": self.peer_hash,
                "lane": "fast",
                "linkId": state["linkId"],
            },
        )

    def test_first_packet_classifies_incoming_resource_session_without_overlay(self):
        link = FakeSessionLink()
        remote_identity = object()
        link.remote_identity = remote_identity
        self.bridge._destination = FakeDestination()
        hello = json.dumps(
            {
                "type": self.bridge._RESOURCE_SESSION_HELLO_TYPE,
                "r": self.peer_hash,
                "lane": "fast",
            }
        ).encode("utf-8")

        with mock.patch.object(
            self.bridge,
            "_schedule_inbound_classify_fallback",
        ), mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=True,
        ) as send_packet, mock.patch.object(
            self.bridge,
            "_resource_session_schedule_idle_close",
        ), mock.patch.object(
            self.bridge,
            "_teardown_reticulum_link_bounded",
        ):
            self.bridge.on_incoming_unified_link_established(link)
            link.packet_callback(hello, FakePacket(link))

            link_id = self.bridge.get_qchat_file_link_id(link)
            self.assertIsInstance(link_id, str)
            self.assertIsNone(self.bridge.get_overlay_link_id(link))
            state = self.bridge.get_qchat_file_link_state(link_id)
            self.assertEqual(state["linkId"], link_id)
            self.assertEqual(state["manager_kind"], "resource_session")
            self.assertEqual(state["peerPresenceHash"], self.peer_hash)
            self.assertTrue(state["provider_ready_sent"])
            send_packet.assert_called_once()
            ready_wire = json.loads(send_packet.call_args.args[1].decode("utf-8"))
            self.assertEqual(
                ready_wire["providerIdleMs"],
                int(
                    self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS
                    * 1000
                ),
            )

            link.closed_callback(link)

        self.assertIsNone(self.bridge.get_qchat_file_link_id(link))
        self.assertNotIn(link_id, self.bridge._qchat_file_links_by_id)

    def test_unidentified_incoming_resource_session_gets_idle_cleanup(self):
        link = FakeSessionLink()
        link.remote_identity = None

        with mock.patch.object(
            self.bridge,
            "_resource_session_schedule_idle_close",
        ) as schedule_idle, mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
        ) as send_packet:
            link_id = self.bridge._register_incoming_resource_session(
                link,
                self.peer_hash,
                "bulk",
            )

        self.assertIsInstance(link_id, str)
        state = self.bridge.get_qchat_file_link_state(link_id)
        self.assertIsInstance(state, dict)
        self.assertFalse(state.get("provider_ready_sent", False))
        send_packet.assert_not_called()
        schedule_idle.assert_called_once_with(state)

    def test_parallel_dispatch_never_exceeds_lane_limit(self):
        for lane, limit in (
            ("fast", self.bridge._RESOURCE_SESSION_FAST_CONCURRENCY),
            ("bulk", self.bridge._RESOURCE_SESSION_BULK_CONCURRENCY),
        ):
            with self.subTest(lane=lane):
                state, link = self.session(lane=lane)
                job_count = limit + 6
                state["pending_jobs"] = [
                    {
                        "pending": self.pending(f"{lane}-parallel-{index}"),
                        "created_at": time.time(),
                        "followers": [],
                    }
                    for index in range(job_count)
                ]

                threads = [
                    threading.Thread(
                        target=self.bridge._resource_session_dispatch_pending,
                        args=(state,),
                    )
                    for _ in range(4)
                ]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=2)

                self.assertEqual(len(state["active_requests"]), limit)
                self.assertEqual(len(link.requests), limit)
                self.assertEqual(len(state["pending_jobs"]), job_count - limit)

    def test_bulk_jobs_are_balanced_across_independent_session_pool(self):
        selected_states = []
        with mock.patch.object(self.bridge, "_resource_session_poll_path"):
            for index in range(self.bridge._RESOURCE_SESSION_BULK_POOL_SIZE * 2):
                state, reason = self.bridge._resource_session_get_or_create(
                    self.peer_hash,
                    object(),
                    "bulk",
                )
                self.assertEqual(reason, "")
                self.assertIsInstance(state, dict)
                state["pending_jobs"].append({"index": index})
                selected_states.append(state)

        unique_states = {state["linkId"]: state for state in selected_states}
        self.assertEqual(
            len(unique_states),
            self.bridge._RESOURCE_SESSION_BULK_POOL_SIZE,
        )
        self.assertEqual(
            sorted(len(state["pending_jobs"]) for state in unique_states.values()),
            [2] * self.bridge._RESOURCE_SESSION_BULK_POOL_SIZE,
        )
        self.assertEqual(
            sorted(state["sessionSlot"] for state in unique_states.values()),
            list(range(self.bridge._RESOURCE_SESSION_BULK_POOL_SIZE)),
        )

    def test_identical_event_downloads_share_one_network_job(self):
        first = self.pending("first", event_id="event-1", sha256="22" * 32)
        second = self.pending("second", event_id="event-1", sha256="22" * 32)
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, first)
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, second)

        with mock.patch.object(
            self.bridge,
            "_resource_session_enqueue_job",
            return_value=(True, ""),
        ) as enqueue, mock.patch.object(self.bridge, "emit_resp"):
            self.bridge._resource_session_accept("req-1", first)
            self.bridge._resource_session_accept("req-2", second)

        self.assertEqual(enqueue.call_count, 1)
        canonical = self.bridge._resource_session_jobs_by_transfer["first"]
        self.assertEqual(len(canonical["followers"]), 1)
        self.assertIs(
            self.bridge._resource_session_jobs_by_transfer["second"],
            canonical["followers"][0],
        )

    def test_stale_authorization_is_not_dispatched(self):
        state, link = self.session()
        job = {
            "pending": self.pending(
                "stale",
                timestamp=int(
                    (time.time() - self.bridge._RESOURCE_SESSION_AUTH_MAX_QUEUE_SECONDS - 1)
                    * 1000
                ),
            ),
            "created_at": time.time() - 100,
            "followers": [],
        }
        with mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            dispatched = self.bridge._resource_session_dispatch_job(state, job)

        self.assertFalse(dispatched)
        self.assertEqual(link.requests, [])
        self.assertTrue(job["completed"])
        self.assertTrue(
            any(
                call.args[0] == "failed"
                and call.args[1]["reason"] == "resource_auth_refresh_required"
                for call in emit.call_args_list
            )
        )

    def test_request_exception_fails_job_instead_of_leaving_it_active(self):
        state, link = self.session()
        job = {
            "pending": self.pending("request-exception"),
            "created_at": time.time(),
            "followers": [],
            "session": state,
        }
        with mock.patch.object(
            link,
            "request",
            side_effect=RuntimeError("request failed"),
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            dispatched = self.bridge._resource_session_dispatch_job(state, job)

        self.assertFalse(dispatched)
        self.assertTrue(job["completed"])
        self.assertNotIn("request-exception", state["active_requests"])
        self.assertTrue(
            any(
                call.args[0] == "failed"
                and call.args[1]["reason"] == "resource_request_send_failed"
                for call in emit.call_args_list
            )
        )

    def test_late_response_after_cancellation_closes_response_file(self):
        job = {
            "completed": True,
            "pending": self.pending("late-response"),
        }
        receipt = FakeSessionReceipt()
        receipt.response = tempfile.TemporaryFile()

        self.bridge._resource_session_response_received(job, receipt)

        self.assertTrue(receipt.response.closed)

    def test_establishment_timeout_fails_jobs_once_and_refreshes_path(self):
        state, link = self.session(established=False)
        state["link_created_at"] = time.time() - 31
        jobs = [
            {
                "pending": self.pending(f"job-{index}"),
                "created_at": time.time(),
                "followers": [],
                "session": state,
            }
            for index in range(2)
        ]
        state["pending_jobs"] = jobs
        with mock.patch.object(
            self.bridge,
            "_force_overlay_peer_path_refresh",
        ) as refresh, mock.patch.object(
            self.bridge,
            "_teardown_reticulum_link_bounded",
        ) as teardown, mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge._resource_session_open_timeout(state)

        refresh.assert_called_once()
        teardown.assert_called_once_with(link, mock.ANY)
        self.assertTrue(all(job["completed"] for job in jobs))
        self.assertEqual(
            len([call for call in emit.call_args_list if call.args[0] == "failed"]),
            2,
        )
        self.assertNotIn(state["sessionKey"], self.bridge._resource_sessions_by_key)

    def test_session_failure_requeues_jobs_that_were_never_dispatched(self):
        failed, failed_link = self.session(lane="bulk", slot=0)
        surviving, _surviving_link = self.session(lane="bulk", slot=1)
        job = {
            "pending": self.pending(
                "queued-range",
                resource_type="reticulum_group_resource_range",
            ),
            "created_at": time.time(),
            "followers": [],
            "session": failed,
        }
        failed["pending_jobs"] = [job]

        with mock.patch.object(
            self.bridge,
            "_teardown_reticulum_link_bounded",
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            self.bridge._resource_session_fail_state(
                failed,
                "resource_session_link_closed",
            )

        self.assertFalse(job.get("completed", False))
        self.assertIs(job.get("session"), surviving)
        self.assertIs(surviving["active_requests"].get("queued-range"), job)
        self.assertFalse(
            any(call.args and call.args[0] == "failed" for call in emit.call_args_list)
        )
        self.assertNotIn(failed["sessionKey"], self.bridge._resource_sessions_by_key)
        self.assertFalse(failed_link.teardown_called)

    def test_provider_session_outlives_requester_idle_leases(self):
        primary, _ = self.session(lane="bulk", slot=0)
        overflow, _ = self.session(lane="bulk", slot=1)
        incoming = dict(primary)
        incoming["incoming"] = True
        primary["remote_provider_idle_seconds"] = (
            self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS
        )
        overflow["remote_provider_idle_seconds"] = (
            self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS
        )

        self.assertEqual(
            self.bridge._resource_session_idle_timeout_seconds(primary),
            self.bridge._RESOURCE_SESSION_PRIMARY_IDLE_TIMEOUT_SECONDS,
        )
        self.assertEqual(
            self.bridge._resource_session_idle_timeout_seconds(overflow),
            self.bridge._RESOURCE_SESSION_OVERFLOW_IDLE_TIMEOUT_SECONDS,
        )
        self.assertEqual(
            self.bridge._resource_session_idle_timeout_seconds(incoming),
            self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS,
        )
        self.assertGreater(
            self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS,
            self.bridge._RESOURCE_SESSION_PRIMARY_IDLE_TIMEOUT_SECONDS,
        )
        self.assertGreater(
            self.bridge._RESOURCE_SESSION_INCOMING_IDLE_TIMEOUT_SECONDS,
            self.bridge._RESOURCE_SESSION_OVERFLOW_IDLE_TIMEOUT_SECONDS,
        )

    def test_legacy_provider_session_closes_before_its_unadvertised_lease(self):
        primary, _ = self.session(lane="bulk", slot=0)
        overflow, _ = self.session(lane="bulk", slot=1)

        self.assertEqual(
            self.bridge._resource_session_idle_timeout_seconds(primary),
            self.bridge._RESOURCE_SESSION_LEGACY_PROVIDER_IDLE_TIMEOUT_SECONDS
            - self.bridge._RESOURCE_SESSION_PROVIDER_IDLE_GUARD_SECONDS,
        )
        self.assertEqual(
            self.bridge._resource_session_idle_timeout_seconds(overflow),
            self.bridge._RESOURCE_SESSION_OVERFLOW_IDLE_TIMEOUT_SECONDS,
        )

    def test_provider_request_waits_for_existing_electron_authorization(self):
        state, link = self.session()
        state["incoming"] = True
        transfer_id = "provider"
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"resource-response")
            file_path = temp_file.name
        pending = {
            "allowedRecipientAddress": "",
            "transferId": transfer_id,
            "filePath": file_path,
            "fileName": "provider.bin",
            "size": len(b"resource-response"),
            "sha256": "",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "metadata": {"eventId": "event-provider"},
            "expires_at": time.time() + 60,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending

        def authorize_on_event(status, payload):
            if status != "auth":
                return
            key = self.bridge._resource_session_waiter_key(
                state["linkId"],
                transfer_id,
            )
            waiter = self.bridge._resource_session_provider_waiters[key]
            waiter["authorized"] = True
            waiter["event"].set()

        try:
            remote_identity = object()
            with mock.patch.object(
                self.bridge,
                "_qchat_file_emit",
                side_effect=authorize_on_event,
            ), mock.patch.object(self.bridge, "_resource_session_watch_provider_file"):
                with mock.patch.object(
                    self.bridge,
                    "_destination_hash_for_identity",
                    return_value=self.peer_hash,
                ):
                    response = self.bridge._resource_session_response_generator(
                        self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                        {
                            "version": 1,
                            "transferId": transfer_id,
                            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                            "metadata": {"eventId": "event-provider"},
                            "authMessage": {"type": "RCR"},
                        },
                        b"request",
                        link.link_id,
                        remote_identity,
                        time.time(),
                    )
            self.assertIsInstance(response, tuple)
            self.assertEqual(response[1]["transferId"], transfer_id)
            self.assertEqual(state["provider_active"], 1)
            self.assertEqual(response[0].read(), b"resource-response")
            response[0].close()
        finally:
            Path(file_path).unlink(missing_ok=True)

    def test_provider_rejects_unidentified_resource_session(self):
        _state, link = self.session()
        with mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            response = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": "unidentified",
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-unidentified"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                None,
                time.time(),
            )

        self.assertEqual(response["reason"], "resource_peer_unidentified")
        emit.assert_not_called()

    def test_provider_rejects_request_after_idle_close_commits(self):
        state, link = self.session()
        state["incoming"] = True
        state["closing"] = True
        remote_identity = object()
        with mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            response = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": "closing",
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-closing"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                remote_identity,
                time.time(),
            )

        self.assertEqual(response["reason"], "resource_session_unavailable")
        self.assertEqual(state["provider_active"], 0)
        emit.assert_not_called()

    def test_provider_waits_for_previous_resource_before_reusing_link(self):
        state, _link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        result = {}

        def acquire():
            result["reason"] = (
                self.bridge._resource_session_provider_acquire_link_slot(
                    state,
                    "next-resource",
                    self.peer_hash,
                )
            )

        thread = threading.Thread(target=acquire)
        thread.start()
        deadline = time.time() + 1
        while (
            state.get("provider_link_waiter_transfer") != "next-resource"
            and time.time() < deadline
        ):
            time.sleep(0.01)
        self.assertEqual(
            state.get("provider_link_waiter_transfer"),
            "next-resource",
        )

        with self.bridge._resource_session_provider_capacity_condition:
            state["provider_active"] = 0
            self.bridge._resource_session_provider_capacity_condition.notify_all()
        thread.join(timeout=1)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result["reason"], "")
        self.assertEqual(state["provider_active"], 1)
        self.assertEqual(state["provider_link_handoffs"], 1)
        self.assertNotIn("provider_link_waiter_transfer", state)

    def test_provider_response_waits_for_link_handoff_then_starts_resource(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "handoff-response"
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"handoff-resource")
            file_path = temp_file.name
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = {
            "allowedRecipientAddress": self.peer_hash,
            "transferId": transfer_id,
            "filePath": file_path,
            "fileName": "handoff.bin",
            "size": len(b"handoff-resource"),
            "sha256": "",
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "metadata": {"eventId": "event-handoff"},
            "expires_at": time.time() + 60,
        }
        auth_emitted = threading.Event()
        result = {}

        def authorize_on_event(status, _payload):
            if status != "auth":
                return
            waiter_key = self.bridge._resource_session_waiter_key(
                state["linkId"],
                transfer_id,
            )
            waiter = self.bridge._resource_session_provider_waiters[waiter_key]
            waiter["authorized"] = True
            waiter["event"].set()
            auth_emitted.set()

        def request():
            result["response"] = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": transfer_id,
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-handoff"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                object(),
                time.time(),
            )

        try:
            with mock.patch.object(
                self.bridge,
                "_destination_hash_for_identity",
                return_value=self.peer_hash,
            ), mock.patch.object(
                self.bridge,
                "_qchat_file_emit",
                side_effect=authorize_on_event,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_watch_provider_file",
            ):
                thread = threading.Thread(target=request)
                thread.start()
                deadline = time.time() + 1
                while (
                    state.get("provider_link_waiter_transfer") != transfer_id
                    and time.time() < deadline
                ):
                    time.sleep(0.01)
                self.assertEqual(
                    state.get("provider_link_waiter_transfer"),
                    transfer_id,
                )
                self.assertFalse(auth_emitted.is_set())

                with self.bridge._resource_session_provider_capacity_condition:
                    state["provider_active"] = 0
                    self.bridge._resource_session_provider_capacity_condition.notify_all()
                thread.join(timeout=1)

            self.assertFalse(thread.is_alive())
            self.assertTrue(auth_emitted.is_set())
            response = result["response"]
            self.assertIsInstance(response, tuple)
            self.assertEqual(response[1]["transferId"], transfer_id)
            self.assertEqual(response[0].read(), b"handoff-resource")
            response[0].close()
            self.assertEqual(state["provider_active"], 1)
            self.assertEqual(state["provider_link_handoffs"], 1)
        finally:
            Path(file_path).unlink(missing_ok=True)

    def test_provider_allows_only_one_waiting_link_handoff(self):
        state, _link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        result = {}

        def acquire():
            result["reason"] = (
                self.bridge._resource_session_provider_acquire_link_slot(
                    state,
                    "first-waiter",
                    self.peer_hash,
                )
            )

        thread = threading.Thread(target=acquire)
        thread.start()
        deadline = time.time() + 1
        while (
            state.get("provider_link_waiter_transfer") != "first-waiter"
            and time.time() < deadline
        ):
            time.sleep(0.01)

        self.assertEqual(
            self.bridge._resource_session_provider_acquire_link_slot(
                state,
                "first-waiter",
                self.peer_hash,
            ),
            "duplicate_resource_request",
        )
        self.assertEqual(
            self.bridge._resource_session_provider_acquire_link_slot(
                state,
                "second-waiter",
                self.peer_hash,
            ),
            "resource_session_busy",
        )

        with self.bridge._resource_session_provider_capacity_condition:
            state["provider_active"] = 0
            self.bridge._resource_session_provider_capacity_condition.notify_all()
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result["reason"], "")
        self.assertEqual(state["provider_active"], 1)

    def test_provider_cancel_wakes_waiting_link_handoff(self):
        state, _link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        result = {}

        def acquire():
            result["reason"] = (
                self.bridge._resource_session_provider_acquire_link_slot(
                    state,
                    "cancelled-waiter",
                    self.peer_hash,
                )
            )

        thread = threading.Thread(target=acquire)
        thread.start()
        deadline = time.time() + 1
        while (
            state.get("provider_link_waiter_transfer") != "cancelled-waiter"
            and time.time() < deadline
        ):
            time.sleep(0.01)

        self.bridge._resource_session_cancel_provider_transfer(
            state,
            "cancelled-waiter",
        )
        thread.join(timeout=1)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result["reason"], "resource_requester_cancelled")
        self.assertEqual(state["provider_active"], 1)
        self.assertNotIn("provider_link_waiter_transfer", state)

    def test_provider_times_out_when_previous_resource_never_releases(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        with mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(
            self.bridge,
            "_RESOURCE_SESSION_PROVIDER_LINK_HANDOFF_WAIT_SECONDS",
            0.02,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            response = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": "same-link-second-resource",
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-second-resource"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                object(),
                time.time(),
            )

        self.assertEqual(response["reason"], "resource_session_busy")
        self.assertEqual(state["provider_active"], 1)
        self.assertNotIn("provider_link_waiter_transfer", state)
        emit.assert_not_called()

    def test_provider_pending_auth_limit_rejects_without_emitting_auth(self):
        state, link = self.session()
        state["incoming"] = True
        for index in range(self.bridge._RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX):
            self.bridge._resource_session_provider_waiters[f"existing:{index}"] = {
                "peerPresenceHash": f"{index:032x}",
            }
        with mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            response = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": "capacity",
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-capacity"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                object(),
                time.time(),
            )
        self.assertEqual(response["reason"], "resource_provider_busy")
        self.assertEqual(state["provider_active"], 0)
        emit.assert_not_called()

    def test_provider_handoff_shares_pending_authorization_limit(self):
        state, _link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        for index in range(self.bridge._RESOURCE_SESSION_PROVIDER_PENDING_AUTH_MAX):
            self.bridge._resource_session_provider_waiters[f"existing:{index}"] = {
                "peerPresenceHash": f"{index:032x}",
            }

        self.assertEqual(
            self.bridge._resource_session_provider_acquire_link_slot(
                state,
                "bounded-handoff",
                self.peer_hash,
            ),
            "resource_provider_busy",
        )
        self.assertEqual(state["provider_active"], 1)
        self.assertNotIn("provider_link_waiter_transfer", state)

    def test_provider_waiting_for_auth_does_not_consume_transfer_capacity(self):
        state, link = self.session()
        state["incoming"] = True
        auth_emitted = threading.Event()
        result = {}

        def on_emit(status, _payload):
            if status == "auth":
                auth_emitted.set()

        def request():
            result["response"] = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": "waiting-auth",
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "event-waiting-auth"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                object(),
                time.time(),
            )

        with mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(
            self.bridge,
            "_qchat_file_emit",
            side_effect=on_emit,
        ):
            thread = threading.Thread(target=request)
            thread.start()
            self.assertTrue(auth_emitted.wait(1.0))
            self.assertEqual(
                sum(self.bridge._resource_session_provider_active_by_class.values()),
                0,
            )
            waiter = next(
                iter(self.bridge._resource_session_provider_waiters.values())
            )
            waiter["reason"] = "test_rejected"
            waiter["event"].set()
            thread.join(1.0)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result["response"]["reason"], "test_rejected")
        self.assertEqual(state["provider_active"], 0)
        self.assertFalse(self.bridge._resource_session_provider_waiters)
        self.assertFalse(
            self.bridge._resource_session_provider_pending_auth_by_peer
        )

    def test_late_authorization_discards_abandoned_registered_send(self):
        state, _link = self.session()
        state["incoming"] = True
        transfer_id = "late-authorization"
        pending = {
            "allowedRecipientAddress": self.peer_hash,
            "transferId": transfer_id,
            "fileName": "late.bin",
            "size": 128,
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "expires_at": time.time() + 60,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending

        with mock.patch.object(self.bridge, "_qchat_file_emit") as emit, mock.patch.object(
            self.bridge,
            "emit_resp",
        ) as emit_resp:
            self.bridge.handle_authorize_qchat_file_resource(
                "req",
                {"linkId": state["linkId"], "transferId": transfer_id},
            )

        self.assertNotIn(
            transfer_id,
            self.bridge._qchat_file_pending_sends_by_transfer,
        )
        self.assertTrue(pending["cancelled"])
        emit.assert_called_once_with("failed", mock.ANY)
        self.assertEqual(
            emit.call_args.args[1]["reason"],
            "resource_authorization_no_longer_active",
        )
        emit_resp.assert_called_once_with(
            "req",
            False,
            payload={"code": "unknown_resource_request"},
            error="Unknown resource session request",
        )

    def test_late_authorization_cannot_discard_inflight_send(self):
        state, _link = self.session()
        state["incoming"] = True
        transfer_id = "inflight-authorization"
        pending = {
            "allowedRecipientAddress": self.peer_hash,
            "transferId": transfer_id,
            "fileName": "active.bin",
            "size": 128,
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_inflight_transfers.add(transfer_id)

        with mock.patch.object(self.bridge, "_qchat_file_emit") as emit, mock.patch.object(
            self.bridge,
            "emit_resp",
        ):
            self.bridge.handle_authorize_qchat_file_resource(
                "req",
                {"linkId": state["linkId"], "transferId": transfer_id},
            )

        self.assertIs(
            self.bridge._qchat_file_pending_sends_by_transfer[transfer_id],
            pending,
        )
        self.assertNotIn("cancelled", pending)
        emit.assert_not_called()

    def test_provider_capacity_preserves_live_and_sync_slots(self):
        active = self.bridge._resource_session_provider_active_by_class
        active["attachment"] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_ATTACHMENT_CONCURRENCY
        )
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked("attachment")
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked("history")
        )
        active["history"] = 1
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked("history")
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked("live")
        )
        active["attachment"] = 0
        active["history"] = 0
        active["metadata"] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_METADATA_CONCURRENCY
        )
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked("metadata")
        )
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                "reticulum_chat_calendar",
                "reticulum_chat_calendar",
            ),
            "metadata",
        )

    def test_provider_capacity_waiters_are_prioritized(self):
        live_waiter = {
            "providerClass": "live",
            "peerPresenceHash": self.peer_hash,
        }
        metadata_waiter = {
            "providerClass": "metadata",
            "peerPresenceHash": "cd" * 16,
        }
        history_waiter = {
            "providerClass": "history",
            "peerPresenceHash": "ef" * 16,
        }
        queue = self.bridge._resource_session_provider_capacity_queue
        queue.extend([history_waiter, metadata_waiter, live_waiter])
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked(
                "metadata",
                "cd" * 16,
                metadata_waiter,
            )
        )
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked(
                "history",
                "ef" * 16,
                history_waiter,
            )
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked(
                "live",
                self.peer_hash,
                live_waiter,
            )
        )

    def test_ineligible_priority_waiter_does_not_block_other_peers(self):
        blocked_peer = self.peer_hash
        available_peer = "cd" * 16
        live_waiter = {
            "providerClass": "live",
            "peerPresenceHash": blocked_peer,
        }
        history_waiter = {
            "providerClass": "history",
            "peerPresenceHash": available_peer,
        }
        self.bridge._resource_session_provider_capacity_queue.extend(
            [live_waiter, history_waiter]
        )
        self.bridge._resource_session_provider_active_by_peer[blocked_peer] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_ACTIVE_MAX_PER_PEER
        )

        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked(
                "history",
                available_peer,
                history_waiter,
            )
        )

    def test_provider_active_capacity_is_bounded_per_peer(self):
        self.bridge._resource_session_provider_active_by_peer[self.peer_hash] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_ACTIVE_MAX_PER_PEER
        )
        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked(
                "live",
                self.peer_hash,
            )
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked(
                "live",
                "cd" * 16,
            )
        )

    def test_attachment_capacity_reserves_two_slots_for_same_peer_chat(self):
        self.bridge._resource_session_provider_active_by_class["attachment"] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_ATTACHMENT_MAX_PER_PEER
        )
        self.bridge._resource_session_provider_active_by_peer[self.peer_hash] = (
            self.bridge._RESOURCE_SESSION_PROVIDER_ATTACHMENT_MAX_PER_PEER
        )
        self.bridge._resource_session_provider_active_attachments_by_peer[
            self.peer_hash
        ] = self.bridge._RESOURCE_SESSION_PROVIDER_ATTACHMENT_MAX_PER_PEER

        self.assertFalse(
            self.bridge._resource_session_provider_can_start_locked(
                "attachment",
                self.peer_hash,
            )
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked(
                "history",
                self.peer_hash,
            )
        )
        self.assertTrue(
            self.bridge._resource_session_provider_can_start_locked(
                "live",
                self.peer_hash,
            )
        )

    def test_provider_post_auth_wait_queue_is_bounded(self):
        state, _link = self.session()
        self.bridge._resource_session_provider_capacity_queue.extend(
            {
                "providerClass": "attachment",
                "peerPresenceHash": f"{index:032x}",
                "transferId": f"queued-{index}",
            }
            for index in range(
                self.bridge._RESOURCE_SESSION_PROVIDER_CAPACITY_QUEUE_MAX
            )
        )

        acquired = self.bridge._resource_session_provider_acquire_capacity(
            "live",
            "queue-full",
            {},
            state,
        )

        self.assertFalse(acquired)
        self.assertFalse(
            self.bridge._resource_session_provider_capacity_waiters_by_peer
        )

    def test_provider_classifies_attachment_ranges_separately(self):
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                "reticulum_group_resource_range",
                "reticulum_group_resource_range",
            ),
            "attachment",
        )
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                "reticulum_chat_history_page",
            ),
            "history",
        )
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                "reticulum_chat_dm_page",
            ),
            "live",
        )
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                "reticulum_chat_metadata_snapshot",
            ),
            "metadata",
        )
        self.assertEqual(
            self.bridge._resource_session_provider_class(
                self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                "qortalland_chat",
            ),
            "live",
        )

    def test_provider_uses_registered_resource_for_capacity_class(self):
        state, link = self.session()
        state["incoming"] = True
        transfer_id = "authoritative-class"
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"range-response")
            file_path = temp_file.name
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = {
            "allowedRecipientAddress": self.peer_hash,
            "transferId": transfer_id,
            "filePath": file_path,
            "fileName": "range.bin",
            "size": len(b"range-response"),
            "sha256": "",
            "resourceType": "reticulum_group_resource_range",
            "metadata": {
                "logicalResourceType": "reticulum_group_resource_range",
            },
            "expires_at": time.time() + 60,
        }
        captured_classes = []

        def authorize(status, _payload):
            if status != "auth":
                return
            waiter = next(
                iter(self.bridge._resource_session_provider_waiters.values())
            )
            waiter["authorized"] = True
            waiter["event"].set()

        def watch(
            _file,
            _transfer_id,
            _pending,
            _state,
            _request_id,
            provider_class,
        ):
            captured_classes.append(provider_class)

        try:
            with mock.patch.object(
                self.bridge,
                "_destination_hash_for_identity",
                return_value=self.peer_hash,
            ), mock.patch.object(
                self.bridge,
                "_qchat_file_emit",
                side_effect=authorize,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_watch_provider_file",
                side_effect=watch,
            ):
                response = self.bridge._resource_session_response_generator(
                    self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                    {
                        "version": 1,
                        "transferId": transfer_id,
                        "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                        "metadata": {"eventId": "mislabelled-range"},
                        "authMessage": {"type": "RCR"},
                    },
                    b"request",
                    link.link_id,
                    object(),
                    time.time(),
                )
            self.assertIsInstance(response, tuple)
            self.assertEqual(captured_classes, ["attachment"])
            response[0].close()
        finally:
            Path(file_path).unlink(missing_ok=True)

    def test_provider_slot_is_held_until_progressing_response_completes(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "provider-progress"
        request_id = bytes.fromhex("88" * 16)

        class ProviderResource:
            def __init__(self):
                self.request_id = request_id
                self.status = RNS.Resource.TRANSFERRING
                self.progress = 0.0

            def get_progress(self):
                return self.progress

        resource = ProviderResource()
        link.outgoing_resources.append(resource)
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"progressing-resource")
            file_path = temp_file.name
        file_handle = open(file_path, "rb")
        pending = {
            "transferId": transfer_id,
            "fileName": "progress.bin",
            "size": len(b"progressing-resource"),
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_active_by_class["live"] = 1

        try:
            with mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_STALL_TIMEOUT_SECONDS",
                0.25,
            ), mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS",
                0.25,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_schedule_idle_close",
            ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_watch_provider_file(
                    file_handle,
                    transfer_id,
                    pending,
                    state,
                    request_id,
                    "live",
                )
                for progress in (0.1, 0.2, 0.3, 0.4):
                    time.sleep(0.11)
                    resource.progress = progress
                resource.status = RNS.Resource.COMPLETE
                deadline = time.time() + 2
                while state["provider_active"] > 0 and time.time() < deadline:
                    time.sleep(0.02)

            self.assertEqual(state["provider_active"], 0)
            self.assertNotIn(
                transfer_id,
                self.bridge._qchat_file_pending_sends_by_transfer,
            )
            self.assertTrue(
                any(
                    call.args[0] == "sent"
                    and call.args[1]["transferId"] == transfer_id
                    for call in emit.call_args_list
                )
            )
            self.assertEqual(
                self.bridge._resource_session_provider_active_by_class["live"],
                0,
            )
        finally:
            if not file_handle.closed:
                file_handle.close()
            Path(file_path).unlink(missing_ok=True)

    def test_provider_zero_progress_uses_initial_progress_timeout(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "provider-no-progress"
        request_id = bytes.fromhex("89" * 16)

        resource = mock.Mock()
        resource.request_id = request_id
        resource.status = RNS.Resource.TRANSFERRING
        resource.get_progress.return_value = 0.0
        link.outgoing_resources.append(resource)
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"no-progress-resource")
            file_path = temp_file.name
        file_handle = open(file_path, "rb")
        pending = {
            "transferId": transfer_id,
            "fileName": "no-progress.bin",
            "size": len(b"no-progress-resource"),
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_active_by_class["live"] = 1

        try:
            with mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS",
                0.12,
            ), mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_STALL_TIMEOUT_SECONDS",
                1.0,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_schedule_idle_close",
            ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_watch_provider_file(
                    file_handle,
                    transfer_id,
                    pending,
                    state,
                    request_id,
                    "live",
                )
                deadline = time.time() + 1
                while state["provider_active"] > 0 and time.time() < deadline:
                    time.sleep(0.01)

            self.assertEqual(state["provider_active"], 0)
            resource.cancel.assert_called_once_with()
            self.assertTrue(
                any(
                    call.args[0] == "failed"
                    and call.args[1]["reason"] == "resource_response_not_started"
                    for call in emit.call_args_list
                )
            )
        finally:
            if not file_handle.closed:
                file_handle.close()
            Path(file_path).unlink(missing_ok=True)

    def test_provider_watcher_follows_all_resource_segments(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "provider-segments"
        request_id = bytes.fromhex("99" * 16)

        class ProviderSegment:
            def __init__(self, index, status, progress):
                self.request_id = request_id
                self.segment_index = index
                self.total_segments = 2
                self.status = status
                self.progress = progress
                self.next_segment = None

            def get_progress(self):
                return self.progress

        second = ProviderSegment(2, RNS.Resource.TRANSFERRING, 0.5)
        first = ProviderSegment(1, RNS.Resource.COMPLETE, 0.5)
        first.next_segment = second
        link.outgoing_resources.append(first)
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"segmented-resource")
            file_path = temp_file.name
        file_handle = open(file_path, "rb")
        pending = {
            "transferId": transfer_id,
            "fileName": "segments.bin",
            "size": len(b"segmented-resource"),
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_active_by_class["live"] = 1

        try:
            with mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_STALL_TIMEOUT_SECONDS",
                1.0,
            ), mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_RESPONSE_INITIAL_PROGRESS_TIMEOUT_SECONDS",
                1.0,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_schedule_idle_close",
            ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
                self.bridge._resource_session_watch_provider_file(
                    file_handle,
                    transfer_id,
                    pending,
                    state,
                    request_id,
                    "live",
                )
                time.sleep(0.15)
                self.assertEqual(state["provider_active"], 1)
                self.assertFalse(
                    any(call.args[0] == "sent" for call in emit.call_args_list)
                )
                second.progress = 1.0
                second.status = RNS.Resource.COMPLETE
                deadline = time.time() + 2
                while time.time() < deadline:
                    sent = any(
                        call.args[0] == "sent"
                        for call in emit.call_args_list
                    )
                    if state["provider_active"] == 0 and sent:
                        break
                    time.sleep(0.02)

            self.assertEqual(state["provider_active"], 0)
            self.assertTrue(
                any(call.args[0] == "sent" for call in emit.call_args_list)
            )
        finally:
            if not file_handle.closed:
                file_handle.close()
            Path(file_path).unlink(missing_ok=True)

    def test_provider_watcher_releases_inflight_admission_after_pending_replacement(self):
        state, link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "provider-replaced-pending"
        request_id = bytes.fromhex("aa" * 16)
        resource = mock.Mock()
        resource.request_id = request_id
        resource.status = RNS.Resource.TRANSFERRING
        resource.get_progress.return_value = 0.5
        link.outgoing_resources.append(resource)
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"replacement-resource")
            file_path = temp_file.name
        file_handle = open(file_path, "rb")
        pending = {
            "transferId": transfer_id,
            "fileName": "original.bin",
            "size": len(b"replacement-resource"),
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
        }
        replacement = {**pending, "fileName": "retry.bin"}
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_inflight_transfers.add(transfer_id)
        self.bridge._resource_session_provider_active_by_class["live"] = 1

        try:
            with mock.patch.object(
                self.bridge,
                "_resource_session_schedule_idle_close",
            ):
                self.bridge._resource_session_watch_provider_file(
                    file_handle,
                    transfer_id,
                    pending,
                    state,
                    request_id,
                    "live",
                )
                self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = (
                    replacement
                )
                resource.status = RNS.Resource.COMPLETE
                deadline = time.time() + 1
                while state["provider_active"] > 0 and time.time() < deadline:
                    time.sleep(0.01)

            self.assertIs(
                self.bridge._qchat_file_pending_sends_by_transfer[transfer_id],
                replacement,
            )
            self.assertNotIn(
                transfer_id,
                self.bridge._resource_session_provider_inflight_transfers,
            )
        finally:
            if not file_handle.closed:
                file_handle.close()
            Path(file_path).unlink(missing_ok=True)

    def test_provider_watcher_preserves_file_during_response_handoff(self):
        state, _link = self.session()
        state["incoming"] = True
        state["provider_active"] = 1
        transfer_id = "provider-handoff-cancel"
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(b"handoff-resource")
            file_path = temp_file.name
        file_handle = open(file_path, "rb")
        pending = {
            "transferId": transfer_id,
            "fileName": "handoff.bin",
            "size": len(b"handoff-resource"),
            "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
            "cancelled": True,
        }
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending
        self.bridge._resource_session_provider_active_by_class["live"] = 1

        try:
            with mock.patch.object(
                self.bridge,
                "_RESOURCE_SESSION_PROVIDER_RESPONSE_START_GRACE_SECONDS",
                0.1,
            ), mock.patch.object(
                self.bridge,
                "_resource_session_schedule_idle_close",
            ):
                self.bridge._resource_session_watch_provider_file(
                    file_handle,
                    transfer_id,
                    pending,
                    state,
                    b"request",
                    "live",
                )
                time.sleep(0.03)
                self.assertFalse(file_handle.closed)
                deadline = time.time() + 1
                while state["provider_active"] > 0 and time.time() < deadline:
                    time.sleep(0.01)

            self.assertTrue(file_handle.closed)
            self.assertEqual(state["provider_active"], 0)
            self.assertEqual(
                self.bridge._resource_session_provider_active_by_class["live"],
                0,
            )
        finally:
            if not file_handle.closed:
                file_handle.close()
            Path(file_path).unlink(missing_ok=True)

    def test_provider_cancel_wakes_auth_and_marks_registered_send(self):
        state, _link = self.session()
        state["incoming"] = True
        transfer_id = "provider-cancel"
        waiter = {
            "event": threading.Event(),
            "authorized": False,
            "reason": "resource_authorization_timeout",
        }
        waiter_key = self.bridge._resource_session_waiter_key(
            state["linkId"],
            transfer_id,
        )
        pending = {
            "transferId": transfer_id,
            "allowedRecipientAddress": self.peer_hash,
        }
        self.bridge._resource_session_provider_waiters[waiter_key] = waiter
        self.bridge._qchat_file_pending_sends_by_transfer[transfer_id] = pending

        self.bridge._resource_session_cancel_provider_transfer(
            state,
            transfer_id,
        )

        self.assertTrue(waiter["event"].is_set())
        self.assertEqual(waiter["reason"], "resource_requester_cancelled")
        self.assertTrue(pending["cancelled"])

    def test_provider_remembers_cancel_that_arrives_before_request(self):
        state, link = self.session()
        state["incoming"] = True
        transfer_id = "cancel-before-request"
        self.bridge._resource_session_cancel_provider_transfer(
            state,
            transfer_id,
        )

        with mock.patch.object(
            self.bridge,
            "_destination_hash_for_identity",
            return_value=self.peer_hash,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            response = self.bridge._resource_session_response_generator(
                self.bridge._RESOURCE_SESSION_REQUEST_PATH,
                {
                    "version": 1,
                    "transferId": transfer_id,
                    "resourceType": self.bridge._RETICULUM_CHAT_RESOURCE_TYPE,
                    "metadata": {"eventId": "cancelled-event"},
                    "authMessage": {"type": "RCR"},
                },
                b"request",
                link.link_id,
                object(),
                time.time(),
            )

        self.assertEqual(response["reason"], "resource_requester_cancelled")
        self.assertEqual(state["provider_active"], 0)
        emit.assert_not_called()

    def test_cancelled_request_does_not_close_reusable_session(self):
        state, link = self.session()
        pending = self.pending("cancel-me")
        receipt = FakeSessionReceipt()
        receipt.resource = mock.Mock()
        job = {
            "pending": pending,
            "created_at": time.time(),
            "followers": [],
            "session": state,
            "semanticKey": "cancel-key",
            "receipt": receipt,
        }
        state["active_requests"]["cancel-me"] = job
        self.bridge._resource_session_jobs_by_transfer["cancel-me"] = job
        self.bridge._resource_session_jobs_by_semantic_key["cancel-key"] = job
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

        with mock.patch.object(
            self.bridge,
            "_qchat_file_emit",
        ), mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=True,
        ) as send_packet:
            closed = self.bridge._qchat_file_cancel_transfer(
                "cancel-me",
                self.peer_hash,
                "test-cancel",
            )

        self.assertEqual(closed, 0)
        self.assertFalse(link.teardown_called)
        receipt.resource.cancel.assert_called_once_with()
        self.assertEqual(receipt.status, FakeSessionReceipt.FAILED)
        cancel_wire = json.loads(send_packet.call_args.args[1].decode("utf-8"))
        self.assertEqual(
            cancel_wire,
            {
                "type": self.bridge._RESOURCE_SESSION_CANCEL_TYPE,
                "transferId": "cancel-me",
            },
        )
        self.assertIn(state["sessionKey"], self.bridge._resource_sessions_by_key)
        self.assertTrue(job["completed"])

    def test_authorization_timeout_retires_only_the_suspect_session(self):
        state, link = self.session(lane="bulk", slot=0)
        surviving, surviving_link = self.session(lane="bulk", slot=1)
        pending = self.pending(
            "authorization-timeout",
            resource_type="reticulum_group_resource_range",
        )
        receipt = FakeSessionReceipt()
        receipt.resource = mock.Mock()
        job = {
            "pending": pending,
            "created_at": time.time(),
            "followers": [],
            "session": state,
            "semanticKey": "authorization-timeout-key",
            "receipt": receipt,
        }
        queued = {
            "pending": self.pending(
                "queued-after-timeout",
                resource_type="reticulum_group_resource_range",
            ),
            "created_at": time.time(),
            "followers": [],
            "session": state,
            "semanticKey": "queued-after-timeout-key",
        }
        state["active_requests"]["authorization-timeout"] = job
        state["pending_jobs"].append(queued)
        self.bridge._resource_session_jobs_by_transfer["authorization-timeout"] = job
        self.bridge._resource_session_jobs_by_transfer["queued-after-timeout"] = queued
        self.bridge._resource_session_jobs_by_semantic_key[
            "authorization-timeout-key"
        ] = job
        self.bridge._resource_session_jobs_by_semantic_key[
            "queued-after-timeout-key"
        ] = queued
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)

        with mock.patch.object(
            self.bridge,
            "_qchat_file_emit",
        ), mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=True,
        ), mock.patch.object(
            self.bridge,
            "_teardown_reticulum_link_bounded",
        ) as teardown:
            closed = self.bridge._qchat_file_cancel_transfer(
                "authorization-timeout",
                self.peer_hash,
                "resource_authorization_timeout",
            )

        self.assertEqual(closed, 1)
        self.assertTrue(state["closing"])
        self.assertNotIn(state["sessionKey"], self.bridge._resource_sessions_by_key)
        teardown.assert_called_once()
        self.assertIs(teardown.call_args.args[0], link)
        receipt.resource.cancel.assert_called_once_with()
        self.assertEqual(receipt.status, FakeSessionReceipt.FAILED)
        self.assertFalse(surviving.get("closing", False))
        self.assertFalse(surviving_link.teardown_called)
        self.assertIs(queued.get("session"), surviving)
        self.assertIs(
            surviving["active_requests"].get("queued-after-timeout"),
            queued,
        )

    def test_cancel_during_request_handoff_cancels_late_receipt(self):
        state, link = self.session()
        pending = self.pending("handoff-cancel")
        job = {
            "pending": pending,
            "created_at": time.time(),
            "followers": [],
            "session": state,
            "semanticKey": "handoff-key",
        }
        self.bridge._resource_session_jobs_by_transfer["handoff-cancel"] = job
        self.bridge._resource_session_jobs_by_semantic_key["handoff-key"] = job
        self.bridge._qchat_file_store_pending_receive(self.peer_hash, pending)
        receipt = FakeSessionReceipt()
        receipt.resource = mock.Mock()

        def request_then_cancel(*_args, **_kwargs):
            self.bridge._qchat_file_cancel_transfer(
                "handoff-cancel",
                self.peer_hash,
                "test-handoff-cancel",
            )
            return receipt

        with mock.patch.object(
            link,
            "request",
            side_effect=request_then_cancel,
        ), mock.patch.object(
            self.bridge,
            "_send_packet_on_link",
            return_value=True,
        ), mock.patch.object(self.bridge, "_qchat_file_emit") as emit:
            dispatched = self.bridge._resource_session_dispatch_job(state, job)

        self.assertFalse(dispatched)
        self.assertTrue(job["completed"])
        self.assertTrue(job["cancelled"])
        self.assertEqual(receipt.status, FakeSessionReceipt.FAILED)
        receipt.resource.cancel.assert_called_once_with()
        self.assertNotIn("receipt", job)
        self.assertFalse(
            any(call.args[0] == "auth_sent" for call in emit.call_args_list)
        )


class PresenceBridgeAccountEndpointLeaseTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()
        self.bridge._destination = FakeDestination()

    def lease(self, address, destination, session, verification="direct-bound", offset=0):
        now_ms = int(time.time() * 1000)
        return {
            "address": address,
            "destinationHash": destination,
            "sessionId": session,
            "lastSeen": now_ms + offset,
            "expiresAt": now_ms + 45_000 + offset,
            "verification": verification,
        }

    def test_one_transport_can_serve_multiple_signed_account_leases(self):
        destination = "aa" * 16
        self.bridge._set_verified_overlay_peers(
            [{"destinationHash": destination, "lastSeen": int(time.time() * 1000)}],
            [destination],
            [
                self.lease("Q-account-a", destination, "session-a"),
                self.lease("Q-account-b", destination, "session-b"),
            ],
        )

        self.assertNotIn("address", self.bridge._verified_overlay_peers[destination])
        self.assertEqual(
            self.bridge._resolve_verified_game_peer("Q-account-a", destination),
            destination,
        )
        self.assertEqual(
            self.bridge._resolve_verified_game_peer("Q-account-b", destination),
            destination,
        )

    def test_account_switch_removes_only_the_ended_lease(self):
        destination = "aa" * 16
        self.bridge._set_verified_overlay_peers(
            [{"destinationHash": destination, "lastSeen": int(time.time() * 1000)}],
            [destination],
            [
                self.lease("Q-account-a", destination, "session-a"),
                self.lease("Q-account-b", destination, "session-b"),
            ],
        )
        self.bridge._set_verified_overlay_peers(
            [{"destinationHash": destination, "lastSeen": int(time.time() * 1000)}],
            [destination],
            [self.lease("Q-account-b", destination, "session-b", offset=1)],
        )

        self.assertIsNone(
            self.bridge._resolve_verified_game_peer("Q-account-a", destination)
        )
        self.assertEqual(
            self.bridge._resolve_verified_game_peer("Q-account-b", destination),
            destination,
        )
        self.assertIn(destination, self.bridge._verified_overlay_peers)

    def test_expired_account_lease_is_never_resolved(self):
        destination = "aa" * 16
        expired = self.lease("Q-account-a", destination, "session-a")
        expired["expiresAt"] = int(time.time() * 1000) - 1
        self.bridge._set_verified_overlay_peers(
            [{"destinationHash": destination, "lastSeen": int(time.time() * 1000)}],
            [destination],
            [expired],
        )

        self.assertIsNone(
            self.bridge._resolve_verified_game_peer("Q-account-a", destination)
        )
        self.assertIn(destination, self.bridge._verified_overlay_peers)

    def test_unpreferred_resolution_uses_strongest_fresh_lease(self):
        relayed = "aa" * 16
        direct = "bb" * 16
        self.bridge._set_verified_overlay_peers(
            [
                {"destinationHash": relayed, "lastSeen": int(time.time() * 1000)},
                {"destinationHash": direct, "lastSeen": int(time.time() * 1000)},
            ],
            [relayed, direct],
            [
                self.lease(
                    "Q-account", relayed, "session-relayed", "relayed-bound", 10
                ),
                self.lease(
                    "Q-account", direct, "session-direct", "direct-bound", 0
                ),
            ],
        )

        self.assertEqual(
            self.bridge._resolve_verified_game_peer("Q-account"), direct
        )


class PresenceBridgePinnedChatPeersTest(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()

    def tearDown(self):
        self.bridge._shutdown.clear()

    def test_pins_only_current_account_endpoint_leases_and_clears_them(self):
        peer_hash = "aa" * 16
        expires_at = time.time() + 60
        self.bridge._account_endpoint_leases = {
            "Q-account": {
                peer_hash: {
                    "destination_hash": peer_hash,
                    "expires_at": expires_at,
                }
            }
        }
        responses = []
        with mock.patch.object(
            self.bridge,
            "emit_resp",
            side_effect=lambda *args, **kwargs: responses.append((args, kwargs)),
        ), mock.patch.object(
            self.bridge, "_enqueue_scheduler_task", return_value=True
        ), mock.patch.object(
            self.bridge, "ensure_known_peer_from_recall", return_value=True
        ):
            self.bridge.handle_configure_reticulum_chat_pinned_peers(
                "pin",
                {
                    "peers": [
                        {
                            "accountAddress": "Q-account",
                            "destinationHash": peer_hash,
                            "expiresAt": int((expires_at + 30) * 1000),
                        }
                    ]
                },
            )

            self.assertEqual(
                self.bridge._pinned_chat_overlay_peers,
                {peer_hash: expires_at},
            )
            self.assertTrue(responses[-1][1]["payload"]["maintenanceQueued"])

            self.bridge.handle_configure_reticulum_chat_pinned_peers(
                "clear", {"peers": []}
            )
            self.assertEqual(self.bridge._pinned_chat_overlay_peers, {})

    def test_rejects_a_pin_without_a_current_endpoint_lease(self):
        responses = []
        with mock.patch.object(
            self.bridge,
            "emit_resp",
            side_effect=lambda *args, **kwargs: responses.append((args, kwargs)),
        ):
            self.bridge.handle_configure_reticulum_chat_pinned_peers(
                "pin",
                {
                    "peers": [
                        {
                            "accountAddress": "Q-account",
                            "destinationHash": "bb" * 16,
                            "expiresAt": int((time.time() + 60) * 1000),
                        }
                    ]
                },
            )

        self.assertFalse(responses[-1][0][1])
        self.assertEqual(self.bridge._pinned_chat_overlay_peers, {})

    def test_expired_pin_keeps_an_otherwise_valid_overlay_neighbor(self):
        peer_hash = "cc" * 16
        self.bridge._pinned_chat_overlay_peers[peer_hash] = time.time() - 1
        self.bridge._active_overlay_neighbors[peer_hash] = time.time()
        self.bridge._candidate_peers[peer_hash] = {
            "last_seen": time.time(),
            "source": "test",
        }

        self.assertEqual(self.bridge._prune_pinned_chat_overlay_peers(), set())
        self.assertIn(peer_hash, self.bridge._active_overlay_neighbors)
        self.assertIn(peer_hash, self.bridge._candidate_peers)


if __name__ == "__main__":
    unittest.main()

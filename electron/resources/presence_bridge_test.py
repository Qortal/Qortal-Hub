import importlib.util
import queue
import time
import unittest
from pathlib import Path

import RNS


BRIDGE_PATH = Path(__file__).with_name("presence_bridge.py")


def load_bridge():
    spec = importlib.util.spec_from_file_location("presence_bridge_under_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


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

    def get_mdu(self):
        return 4096

    def set_link_closed_callback(self, callback):
        self.closed_callback = callback

    def set_packet_callback(self, callback):
        self.packet_callback = callback

    def set_remote_identified_callback(self, callback):
        self.remote_identified_callback = callback

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
        while True:
            try:
                events.append(self.bridge._json_event_queue.get_nowait())
            except queue.Empty:
                return events

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


if __name__ == "__main__":
    unittest.main()

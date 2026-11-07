import base64
import json
import importlib.util
from pathlib import Path
import queue
import threading
import unittest
from unittest import mock
from presence_bridge_test import load_bridge

class QAppTransportReliability(unittest.TestCase):
    def setUp(self):
        self.bridge = load_bridge()

    def test_rpc_response_bound_is_enforced_by_rns_before_download(self):
        bridge = self.bridge
        options_seen = {}
        class Link:
            def request(self, path, **options):
                options_seen.update(options)
                options['failed_callback']()
                return False
        entry = {'link': Link(), 'active_requests': 0}
        with mock.patch.object(bridge, '_qapp_rns_entry', return_value=entry), \
             mock.patch.object(bridge, '_qapp_rns_open_link', return_value=True), \
             mock.patch.object(bridge, '_qapp_rns_schedule_idle'), \
             mock.patch.object(bridge, 'emit_resp'):
            bridge.handle_qapp_rns_request('audit', {'managerKey':'audit', 'destination':'ab'*16,
                'path':'/status','maxResponseBytes':4096})
        self.assertEqual(options_seen.get('max_response_size'), 4096 + 1024)

    def test_failed_rpc_link_establishment_schedules_idle_cleanup(self):
        bridge = self.bridge
        with mock.patch.object(bridge, '_qapp_rns_open_link', return_value=False), \
             mock.patch.object(bridge, '_qapp_rns_schedule_idle') as idle, \
             mock.patch.object(bridge, 'emit_resp'):
            for index in range(100):
                bridge.handle_qapp_rns_request(str(index), {'managerKey':str(index),
                    'destination':f'{index:032x}', 'path':'/status'})
        self.assertEqual(idle.call_count, 100)

    def test_reliable_data_is_not_acknowledged_and_lost_when_output_queue_is_full(self):
        bridge = self.bridge
        bridge._json_event_queue = queue.Queue(maxsize=1)
        bridge._json_event_queue.put({'type':'event','event':'unrelated'})
        entry = bridge._qapp_rns_entry('audit','ab'*16)
        entry['connections'].add('rns-audit')
        payload=json.dumps({'connectionId':'rns-audit','encoding':'json',
            'payloadBase64':base64.b64encode(b'{"update":1}').decode()}).encode()
        with mock.patch.object(bridge,'_qapp_rns_write',return_value=True) as write, \
             mock.patch.object(bridge,'_QAPP_RNS_EVENT_ADMISSION_SECONDS',0.01):
            with self.assertRaisesRegex(RuntimeError, 'RNS_RECEIVE_QUEUE_FULL'):
                bridge._qapp_rns_handle_frame(entry,bridge._QAPP_RNS_DATA,1,payload)
            write.assert_not_called()
            self.assertNotIn(1, entry['received_set'])
            bridge._json_event_queue.get_nowait()
            bridge._qapp_rns_handle_frame(entry,bridge._QAPP_RNS_DATA,1,payload)
            bridge._qapp_rns_handle_frame(entry,bridge._QAPP_RNS_DATA,1,payload)
        self.assertEqual(write.call_count,2)
        self.assertEqual(bridge._json_event_queue.qsize(), 1)
        self.assertFalse(bridge._json_event_queue.empty(), 'Both copies were ACKed, neither delivered')

    def test_peer_close_is_a_valid_v1_control_and_only_closes_its_logical_connection(self):
        bridge = self.bridge
        entry=bridge._qapp_rns_entry('audit','ab'*16)
        entry['connections'].update(['rns-audit','rns-other'])
        with mock.patch.object(bridge,'_qapp_rns_write',return_value=True), \
             mock.patch.object(bridge,'_qapp_rns_schedule_idle'):
            bridge._qapp_rns_handle_frame(entry,bridge._QAPP_RNS_CONTROL,2,
                json.dumps({'type':'CLOSE','connectionId':'rns-audit'}).encode())
        self.assertEqual(entry['connections'],{'rns-other'})

    def test_entry_limit_bounds_failed_destination_churn_and_returns_backpressure(self):
        bridge = self.bridge
        with mock.patch.object(bridge, '_QAPP_RNS_MAX_ENTRIES', 2), \
             mock.patch.object(bridge, '_qapp_rns_open_link', return_value=False), \
             mock.patch.object(bridge, '_qapp_rns_schedule_idle'), \
             mock.patch.object(bridge, '_qapp_rns_error') as error:
            for index in range(3):
                bridge.handle_qapp_rns_request(str(index), {'managerKey': str(index),
                    'destination': f'{index:032x}', 'path': '/status'})
            self.assertEqual(len(bridge._qapp_rns_entries), 2)
            error.assert_called_with('2', 'RNS_SEND_QUEUE_FULL')
            bridge.handle_qapp_rns_connect('connect', {'managerKey': 'new',
                'destination': 'ab'*16, 'connectionId': 'rns-new'})
            error.assert_called_with('connect', 'RNS_SEND_QUEUE_FULL')

    def test_close_releases_only_its_pending_sends_and_cancels_reconnect_when_last(self):
        bridge = self.bridge
        entry = bridge._qapp_rns_entry('close', 'ab'*16)
        entry['connections'].update(['one', 'two'])
        first, second, reconnect = mock.Mock(), mock.Mock(), mock.Mock()
        entry['unacked'] = {
            1: {'connectionId': 'one', 'frame': b'first', 'timer': first},
            2: {'connectionId': 'two', 'frame': b'second', 'timer': second}}
        entry['queued_bytes'] = 11
        entry['reconnect_timer'] = reconnect
        with mock.patch.object(bridge, '_qapp_rns_schedule_idle'):
            bridge._qapp_rns_remove_logical(entry, 'one')
            self.assertEqual(entry['queued_bytes'], 6)
            self.assertEqual(set(entry['unacked']), {2})
            first.cancel.assert_called_once()
            reconnect.cancel.assert_not_called()
            bridge._qapp_rns_remove_logical(entry, 'two')
            self.assertEqual(entry['queued_bytes'], 0)
            reconnect.cancel.assert_called_once()

    def test_overlapping_readers_admit_only_one_copy_before_acking_both(self):
        bridge = self.bridge
        entry = bridge._qapp_rns_entry('overlap', 'ab'*16)
        entry['connections'].add('one')
        entered, release = threading.Event(), threading.Event()
        payload = json.dumps({'connectionId': 'one', 'encoding': 'json',
            'payloadBase64': base64.b64encode(b'1').decode()}).encode()
        def admit(_payload):
            entered.set()
            self.assertTrue(release.wait(1))
        with mock.patch.object(bridge, '_qapp_rns_admit_event', side_effect=admit) as admitted, \
             mock.patch.object(bridge, '_qapp_rns_write', return_value=True) as write:
            readers = [threading.Thread(target=bridge._qapp_rns_handle_frame,
                args=(entry, bridge._QAPP_RNS_DATA, 1, payload)) for _ in range(2)]
            try:
                readers[0].start()
                self.assertTrue(entered.wait(1))
                readers[1].start()
                write.assert_not_called()
            finally:
                release.set()
                for reader in readers:
                    if reader.ident is not None:
                        reader.join(2)
                        self.assertFalse(reader.is_alive())
            admitted.assert_called_once()
            self.assertEqual(write.call_count, 2)

    def test_example_keeps_shared_link_alive_for_ping_pong_and_logical_close(self):
        path = Path(__file__).resolve().parents[2] / 'examples/qapp-reticulum/backend.py'
        spec = importlib.util.spec_from_file_location('qapp_backend_example', path)
        example = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(example)
        def data(connection):
            return json.dumps({'connectionId': connection, 'encoding': 'json',
                'payloadBase64': base64.b64encode(b'1').decode()}).encode()
        incoming = b''.join([
            example.frame(example.CONTROL, 1, b'{"type":"PING"}'),
            example.frame(example.CONTROL, 2, b'{"type":"PONG"}'),
            example.frame(example.CONTROL, 3, b'{"type":"CLOSE","connectionId":"one"}'),
            example.frame(example.DATA, 4, data('one')),
            example.frame(example.DATA, 5, data('two')),
        ])
        link, reader, writer = mock.Mock(), mock.Mock(), mock.Mock()
        reader.read.side_effect = [incoming, b'']
        writer.write.side_effect = len
        example.PENDING[99] = {'connectionId': 'one', 'frame': b'old'}
        with mock.patch.object(example.RNS.Buffer, 'create_reader', return_value=reader), \
             mock.patch.object(example.RNS.Buffer, 'create_writer', return_value=writer):
            example.serve_link(link)
        link.teardown.assert_not_called()
        writes = [call.args[0] for call in writer.write.call_args_list]
        self.assertEqual(writes[0], example.frame(example.CONTROL, 1, b'{"type":"PONG"}'))
        self.assertEqual(len(writes), 4)  # PONG, two ACKs, one live connection's echo.
        self.assertEqual({item['connectionId'] for item in example.PENDING.values()}, {'two'})

if __name__ == '__main__':
    unittest.main()

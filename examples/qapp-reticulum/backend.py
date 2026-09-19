#!/usr/bin/env python3
"""Minimal Q-App Reticulum backend for protocol version 1."""

import argparse
import base64
from collections import deque
import json
import os
import secrets
import struct
import threading
import time

import RNS

HEADER = struct.Struct(">BBQI")
VERSION, DATA, ACK, STREAM_ID = 1, 1, 2, 7
MAX_FRAME = 256 * 1024
STATE_LOCK = threading.Lock()
SEEN_ORDER, SEEN = deque(), set()
PENDING = {}
NEXT_MESSAGE_ID = secrets.randbits(63) or 1


def frame(kind, message_id, payload=b""):
    if len(payload) > MAX_FRAME:
        raise ValueError("frame too large")
    return HEADER.pack(VERSION, kind, message_id, len(payload)) + payload


def write_all(writer, data):
    offset = 0
    while offset < len(data):
        written = int(writer.write(data[offset:]) or 0)
        if written <= 0:
            time.sleep(0.01)
            continue
        offset += written
    writer.flush()


def serve_link(link):
    global NEXT_MESSAGE_ID
    channel = link.get_channel()
    reader = RNS.Buffer.create_reader(STREAM_ID, channel)
    writer = RNS.Buffer.create_writer(STREAM_ID, channel)
    buffered = bytearray()
    while True:
        chunk = reader.read(64 * 1024)
        if chunk is None:
            time.sleep(0.01)
            continue
        if chunk == b"":
            return
        buffered.extend(chunk)
        if len(buffered) > MAX_FRAME * 2:
            link.teardown()
            return
        while len(buffered) >= HEADER.size:
            version, kind, message_id, length = HEADER.unpack_from(buffered)
            if version != VERSION or length > MAX_FRAME:
                link.teardown()
                return
            total = HEADER.size + length
            if len(buffered) < total:
                break
            payload = bytes(buffered[HEADER.size:total])
            del buffered[:total]
            if kind == ACK:
                with STATE_LOCK:
                    PENDING.pop(message_id, None)
                continue
            if kind != DATA:
                link.teardown()
                return
            write_all(writer, frame(ACK, message_id))
            envelope = json.loads(payload.decode("utf-8"))
            connection_id = envelope["connectionId"]
            with STATE_LOCK:
                pending_for_connection = [
                    item["frame"]
                    for _, item in sorted(PENDING.items())
                    if item["connectionId"] == connection_id
                ]
            for pending_frame in pending_for_connection:
                write_all(writer, pending_frame)
            with STATE_LOCK:
                duplicate = message_id in SEEN
                if not duplicate:
                    if len(SEEN_ORDER) >= 512:
                        SEEN.discard(SEEN_ORDER.popleft())
                    SEEN_ORDER.append(message_id)
                    SEEN.add(message_id)
            if duplicate:
                continue
            decoded = base64.b64decode(envelope["payloadBase64"])
            response = {
                "type": "echo",
                "received": (
                    json.loads(decoded.decode("utf-8"))
                    if envelope.get("encoding") == "json"
                    else envelope["payloadBase64"]
                ),
            }
            response_envelope = {
                "connectionId": connection_id,
                "encoding": "json",
                "payloadBase64": base64.b64encode(
                    json.dumps(response, separators=(",", ":")).encode("utf-8")
                ).decode("ascii"),
            }
            body = json.dumps(response_envelope, separators=(",", ":")).encode("utf-8")
            with STATE_LOCK:
                outgoing_id = NEXT_MESSAGE_ID
                NEXT_MESSAGE_ID = (NEXT_MESSAGE_ID + 1) & 0xFFFFFFFFFFFFFFFF
                outgoing_frame = frame(DATA, outgoing_id, body)
                PENDING[outgoing_id] = {
                    "connectionId": connection_id,
                    "frame": outgoing_frame,
                }
            write_all(writer, outgoing_frame)


def hello(_path, data, _request_id, _link_id, _remote_identity, _requested_at):
    payload = base64.b64decode(str(data.get("payloadBase64") or ""))
    name = "world"
    if data.get("encoding") == "json":
        name = str(json.loads(payload.decode("utf-8")).get("name") or name)
    return {"message": f"Hello, {name}", "requestId": data.get("requestId")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=None)
    parser.add_argument("--identity", default="qapp-backend.identity")
    args = parser.parse_args()
    RNS.Reticulum(configdir=args.config)
    identity = (
        RNS.Identity.from_file(args.identity)
        if os.path.exists(args.identity)
        else RNS.Identity()
    )
    if not os.path.exists(args.identity):
        identity.to_file(args.identity)
    destination = RNS.Destination(
        identity,
        RNS.Destination.IN,
        RNS.Destination.SINGLE,
        "qortal-hub-v3",
        "qapp-backend",
        "v1",
    )
    destination.register_request_handler(
        "/hello", response_generator=hello, allow=RNS.Destination.ALLOW_ALL
    )
    destination.set_link_established_callback(
        lambda link: threading.Thread(target=serve_link, args=(link,), daemon=True).start()
    )
    destination.announce()
    print(f"Destination: {RNS.prettyhexrep(destination.hash)}")
    while True:
        time.sleep(60)
        destination.announce()


if __name__ == "__main__":
    main()

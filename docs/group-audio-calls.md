# Group Audio Calls

This document explains how group audio calls currently work in Qortal Desktop, with emphasis on the audio transport path and the exact way audio bytes are sent.

## High-Level Model

Group calls are decentralized and role-based.

- Up to 10 participants: one `root-forwarder`.
- 11 to 50 participants: one `root-forwarder` plus per-cluster forwarders.
- A `standby-forwarder` exists for failover.

The renderer decides topology and captures/plays audio. The Electron main process owns Reticulum transport state. A Python bridge process handles Reticulum link I/O.

At a high level:

```text
Mic -> capture worklet -> Opus encoder -> encrypted group-audio packet
-> renderer sendAudio IPC -> Electron GroupCallManager
-> ReticulumBridge fd3 binary IPC -> Python presence_bridge.py
-> RNS link packet -> remote Python bridge -> Electron bridge
-> renderer decrypt/decode/jitter/playout
```

## Main Pieces

Renderer:

- `src/hooks/useGroupVoiceCall.ts`
- `src/lib/group-call/audioPacketCodec.ts`
- `public/worklets/capture-processor.js`
- `public/worklets/group-playout-processor.js`

Electron main:

- `electron/src/setup.ts`
- `electron/src/group-call.ts`
- `electron/src/reticulum-bridge.ts`
- `electron/src/reticulum-audio-ipc.ts`

Python bridge:

- `electron/resources/presence_bridge.py`

## Security And Session Model

Each call has a room media key.

- The initiator/root generates the media key.
- The key is distributed per recipient with `window.groupCall.sendKey()`.
- Audio packets are encrypted with `nacl.secretbox` using that room key.
- Forwarders normally route opaque encrypted audio bytes. They do not need to decrypt and re-encrypt just to forward.

The hook also tracks:

- `callSessionId`
- `mediaSessionGeneration`
- `keyCommitment`

Those are used to keep audio/key state aligned during rejoins, recovery, and key rotation.

## Audio Capture And Encoding

The renderer capture pipeline lives in `useGroupVoiceCall.ts`.

1. Microphone audio is read into an `AudioContext`.
2. `capture-processor.js` frames mic audio into 960-sample chunks and computes VAD.
3. The worklet posts `{ frame, vad }` back to the main thread.
4. The main thread converts `Float32` PCM to `Int16`.
5. A WebCodecs `AudioEncoder` encodes the frame as Opus.

Current encoder behavior:

- Codec: `opus`
- Sample rate: `48000`
- Channels: `1`
- Frame duration: `20ms` (`960` samples)
- Bitrate: controlled by `OPUS_BITRATE`
- Expected packet loss: controlled by `OPUS_EXPECTED_PACKETLOSS_PERCENT`
- In-band FEC is requested when supported by the Electron build

## What We Actually Send

The Opus frame is not sent raw. It is wrapped in the group-call audio codec first.

Current primary packet format is v2:

```text
nonce[24] || secretbox(inner)
```

Where `inner` is:

```text
version | sourceAddrLen | sourceAddr | vad | seq | timestampMs | opusFrame
```

There is also support for:

- v3: one encrypted packet carrying multiple Opus frames
- v1: legacy decode fallback

This codec is implemented in `src/lib/group-call/audioPacketCodec.ts`.

Important fields inside the encrypted payload:

- `sourceAddr`: Qortal address of the original speaker
- `vad`: whether the sender was speaking for this frame
- `seq`: 16-bit audio sequence
- `timestampMs`: relative call timestamp
- `opusFrame`: encoded voice payload

## Renderer Send Path

When the encoder outputs a chunk:

1. `sendEncodedFrame()` runs in `useGroupVoiceCall.ts`.
2. It drops immediately if:
   - no room key is installed
   - mic is muted
   - key distribution is still pending
   - the session key for the active media generation is missing
3. It increments the local audio sequence.
4. It encrypts the Opus frame with `encodeAudioPacketV2()`.
5. It calls `dispatchEncodedPacket()`.

`dispatchEncodedPacket()` decides who to send to:

- If this node is the `root-forwarder`, it sends to each downstream cluster member it currently serves.
- Otherwise, it sends to its assigned forwarder.

Today `sendPacketToPeer()` routes through Reticulum, and that path calls:

```text
window.groupCall.sendAudio(roomId, address, payload)
```

## Renderer To Electron IPC

The preload layer exposes:

```text
window.groupCall.sendAudio(roomId, toAddress, data)
```

That maps to Electron IPC handler `gcall:sendAudio` in `electron/src/setup.ts`.

The IPC handler:

- normalizes the payload to a `Buffer`
- rejects oversized sends above `12,288` bytes
- calls `GroupCallManager.sendAudio()`
- returns `success/error` plus send-path diagnostics

## Electron Send Path

`GroupCallManager.sendAudio()` in `electron/src/group-call.ts` is the main-process entry point for group audio sends.

It does the following:

1. Validates the payload with `isValidGcAudioBuffer()`.
2. If the target address is local, it short-circuits and emits `gcall:audio` locally.
3. Resolves or creates per-peer Reticulum audio state.
4. Queues the frame in that peer's `pending` queue.
5. Schedules a fair flush across peers.
6. If the audio link is already established, it tries to flush immediately.

Important behavior here:

- Pending audio is stored per destination peer, not in one shared unsorted queue.
- The manager drops stale and overloaded pending frames before they pile up indefinitely.
- Flush is fair/round-robin so one busy downstream leg cannot dominate the send path.
- Diagnostics record whether pressure came from pending overflow, stale dropping, link-unready state, or later bridge pressure.

## Electron Bridge IPC Format

`ReticulumBridge.enqueueGroupAudio()` moves frames into a binary IPC format defined in `electron/src/reticulum-audio-ipc.ts`.

Electron -> Python uses extra stdio `fd 3`.
Python -> Electron uses extra stdio `fd 4`.

The binary message format starts with:

```text
magic: "QAUD"
version: 1
bodyLen: uint32
```

The body contains one or more frames:

```text
frame_count
  linkIdLen | linkId
  roomIdLen | roomId
  peerPresenceHashLen | peerPresenceHash
  peerCallHashLen | peerCallHash
  payloadLen | payload
```

For outbound Electron -> Python audio:

- `linkId` identifies the Reticulum audio link
- `roomId` identifies the group call
- `payload` is the encrypted group audio packet from the renderer
- `peerPresenceHash` and `peerCallHash` are empty on the outbound side

The bridge batches multiple frames into one QAUD message to reduce overhead, but it now also applies fairness and pressure control.

## Python Bridge Send Path

In `presence_bridge.py`:

1. `_audio_in_reader_loop()` reads QAUD batches from `fd 3`.
2. It parses the batch and pushes decoded items into `_audio_decoded_queue`.
3. `_rns_executor_loop()` drains `_audio_decoded_queue`.
4. `_process_audio_batch()` builds the Reticulum wire payload and calls `RNS.Packet.send()`.

The actual Reticulum payload is JSON, produced by `make_group_audio_wire()`:

```json
{
  "t": "<group-audio-wire-type>",
  "R": "<roomId>",
  "d": "<base64 encrypted audio packet>",
  "r": "<sender call destination hash>"
}
```

Important detail:

- `d` is base64 of the already-encrypted group audio packet from the renderer.
- The Reticulum layer is transporting that encrypted payload; it is not the layer that defines the call's media encryption.

## Reticulum Link Layer

Group audio is sent over dedicated Reticulum audio links, separate from the higher-level JSON control message flow.

The main process opens and tracks these audio links by peer:

- open link
- wait for establishment
- enqueue audio frames against the link id
- reopen when a link becomes unready or closes

This is why group audio send diagnostics can distinguish:

- pending-queue pressure in Electron
- bridge queue pressure
- Python-side decoded queue buildup
- actual Reticulum packet send failures
- link-not-ready conditions

## Receive Path

On the receiving side, the reverse happens:

1. Reticulum delivers an audio packet to the Python bridge.
2. `on_audio_link_packet()` parses the Reticulum JSON wire.
3. It base64-decodes `d` back to raw encrypted group-audio bytes.
4. It wraps that in QAUD binary format and writes it to `fd 4`.
5. `ReticulumBridge` in Electron decodes the QAUD message.
6. Electron emits `group-audio-packet`.
7. `GroupCallManager` maps the audio link back to a Qortal address and emits `gcall:audio`.
8. The renderer receives that packet and runs decrypt + decode + jitter + playout.

## Renderer Receive, Decrypt, And Playback

After the renderer gets `gcall:audio`:

1. It decrypts the packet with the room media key.
2. It decodes v3, v2, or legacy v1 audio packet format.
3. It extracts one or more Opus frames plus source metadata.
4. It tracks per-source sequence gaps and timing.
5. It places Opus frames into a per-source jitter buffer.
6. `gcall-jitter-scheduler` drains jitter buffers on a steady audio clock.
7. `AudioDecoder` turns Opus back into PCM.
8. `group-playout-processor.js` performs adaptive playout from a PCM ring buffer.
9. Audio is mixed into the output graph.

The adaptive playout path can raise target latency when a source is starving, but it keeps that separate from transport diagnostics so sender overload and receiver compensation are both visible.

## How Forwarding Works

Forwarders route encrypted group audio packets based on topology.

- Non-root participants normally send one encrypted packet upstream to their assigned forwarder.
- The root forwarder fans that same encrypted payload out to its downstream recipients.
- Because the payload already contains the original `sourceAddr`, the receiver still knows who actually spoke.

This means forwarding is mostly about transport fanout, not about re-encoding audio.

## Diagnostics We Export

The send path exposes diagnostics back to the renderer on every `sendAudio()` result.

Useful fields include:

- `pendingFrames`
- `bridgeQueuedFrames`
- `decodedQueueDepth`
- `binaryOutQueueDepth`
- `queuePressureDrops`
- `queuePressureDropsLast5s`
- `staleDrops`
- `staleDropsLast5s`
- `linkUnreadyDrops`
- `packetSendFailures`

These are then folded into group-call metrics and diagnostic exports so we can tell whether a bad call was caused mainly by:

- sender-side overload
- stale backlog cleanup
- transport/link failure
- or receiver starvation

## Important Current Design Choices

- Audio is encoded once as Opus in the renderer.
- The room key encrypts the actual media payload before transport.
- Reticulum transports that encrypted payload over dedicated audio links.
- Electron and Python maintain separate bounded queues to avoid unlimited catch-up.
- Current work focuses on preferring fresh speech over delayed backlog during overload.

## Relevant Files

- `src/hooks/useGroupVoiceCall.ts`
- `src/lib/group-call/audioPacketCodec.ts`
- `electron/src/preload.ts`
- `electron/src/setup.ts`
- `electron/src/group-call.ts`
- `electron/src/reticulum-bridge.ts`
- `electron/src/reticulum-audio-ipc.ts`
- `electron/resources/presence_bridge.py`
- `public/worklets/capture-processor.js`
- `public/worklets/group-playout-processor.js`

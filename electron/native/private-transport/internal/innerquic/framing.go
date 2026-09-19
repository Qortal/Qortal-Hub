package innerquic

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

const (
	ALPN                    = "qortal-private/1"
	ProtocolVersion         = 1
	MaxReliablePayloadBytes = 1024 * 1024
	MaxMetadataBytes        = 4 * 1024
	MaxDatagramPayloadBytes = 1024
	InnerPacketSize         = 1200

	FrameAttach   byte = 1
	FrameAttached byte = 2
	FrameReliable byte = 3
)

var streamMagic = [4]byte{'Q', 'P', '3', 'F'}
var datagramMagic = [4]byte{'Q', 'P', '3', 'D'}

type Frame struct {
	Type     byte
	Metadata []byte
	Payload  []byte
}

func WriteFrame(w io.Writer, frame Frame) error {
	if len(frame.Metadata) > MaxMetadataBytes || len(frame.Payload) > MaxReliablePayloadBytes {
		return errors.New("inner frame exceeds limit")
	}
	header := make([]byte, 12)
	copy(header[:4], streamMagic[:])
	header[4] = ProtocolVersion
	header[5] = frame.Type
	binary.BigEndian.PutUint16(header[6:8], uint16(len(frame.Metadata)))
	binary.BigEndian.PutUint32(header[8:12], uint32(len(frame.Payload)))
	if err := writeFull(w, header); err != nil {
		return err
	}
	if err := writeFull(w, frame.Metadata); err != nil {
		return err
	}
	return writeFull(w, frame.Payload)
}

func writeFull(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func ReadFrame(r io.Reader) (Frame, error) {
	header := make([]byte, 12)
	if _, err := io.ReadFull(r, header); err != nil {
		return Frame{}, err
	}
	if string(header[:4]) != string(streamMagic[:]) {
		return Frame{}, errors.New("invalid inner frame magic")
	}
	if header[4] != ProtocolVersion {
		return Frame{}, errors.New("unsupported inner protocol version")
	}
	metadataLen := int(binary.BigEndian.Uint16(header[6:8]))
	payloadLen := int(binary.BigEndian.Uint32(header[8:12]))
	if metadataLen > MaxMetadataBytes || payloadLen > MaxReliablePayloadBytes {
		return Frame{}, errors.New("inner frame exceeds limit")
	}
	frame := Frame{Type: header[5], Metadata: make([]byte, metadataLen), Payload: make([]byte, payloadLen)}
	if _, err := io.ReadFull(r, frame.Metadata); err != nil {
		return Frame{}, err
	}
	if _, err := io.ReadFull(r, frame.Payload); err != nil {
		return Frame{}, err
	}
	return frame, nil
}

func Metadata(value interface{}) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil || len(data) > MaxMetadataBytes {
		return nil, errors.New("invalid frame metadata")
	}
	return data, nil
}

func EncodeDatagram(messageID string, payload []byte) ([]byte, error) {
	if len(messageID) == 0 || len(messageID) > 128 || len(payload) > MaxDatagramPayloadBytes {
		return nil, errors.New("invalid inner datagram")
	}
	result := make([]byte, 7+len(messageID)+len(payload))
	copy(result[:4], datagramMagic[:])
	result[4] = ProtocolVersion
	binary.BigEndian.PutUint16(result[5:7], uint16(len(messageID)))
	copy(result[7:], messageID)
	copy(result[7+len(messageID):], payload)
	return result, nil
}

func DecodeDatagram(data []byte) (string, []byte, error) {
	if len(data) < 7 || string(data[:4]) != string(datagramMagic[:]) || data[4] != ProtocolVersion {
		return "", nil, errors.New("invalid inner datagram")
	}
	idLen := int(binary.BigEndian.Uint16(data[5:7]))
	if idLen < 1 || idLen > 128 || 7+idLen > len(data) || len(data)-(7+idLen) > MaxDatagramPayloadBytes {
		return "", nil, errors.New("invalid inner datagram lengths")
	}
	return string(data[7 : 7+idLen]), append([]byte(nil), data[7+idLen:]...), nil
}

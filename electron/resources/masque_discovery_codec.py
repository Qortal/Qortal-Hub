"""Bounded, signed MASQUE discovery wire format, shared with Hub."""
import ipaddress
import struct
import time
import RNS

DOMAIN = b"Qortal-MASQUE-Discovery-v2\x00"
MAX_PAYLOAD = 316

def encode(identity, host, port, name, pin, expiry, mode, groups, ticket_key=None):
    address = ipaddress.ip_address(host)
    groups = sorted(groups)
    if mode not in ("public", "groups") or len(groups) > 16 or len(set(groups)) != len(groups):
        raise ValueError("invalid relay access policy")
    if (mode == "groups") != bool(groups) or any(type(g) is not int or not 0 < g < 2**31 for g in groups):
        raise ValueError("invalid relay group IDs")
    label = name.encode("ascii")
    if not 1 <= len(label) <= 128 or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for ch in name):
        raise ValueError("invalid relay name")
    if not 0 < port <= 65535 or len(bytes.fromhex(pin)) != 32:
        raise ValueError("invalid relay endpoint")
    packed_groups = bytearray()
    for group in groups:
        while group >= 128:
            packed_groups.append((group & 127) | 128)
            group >>= 7
        packed_groups.append(group)
    version = 3 if ticket_key is not None else 2
    header = bytes([3, (len(label)-1) | (128 if address.version == 6 else 0), len(groups)]) if version == 3 else bytes([2, address.version, len(label), len(groups)])
    data = header + address.packed
    data += struct.pack(">HI", port, expiry) + bytes.fromhex(pin) + label + bytes(packed_groups)
    if version == 3:
        if len(bytes.fromhex(ticket_key)) != 32: raise ValueError("invalid ticket key")
        data += identity.get_public_key() + bytes.fromhex(ticket_key)
    else:
        data += identity.get_public_key()[32:]
    domain = b"Qortal-MASQUE-Discovery-v3\x00" if version == 3 else DOMAIN
    result = data + identity.sign(domain + data)
    if len(result) > MAX_PAYLOAD:
        raise ValueError("relay announcement exceeds Reticulum packet budget; shorten server name or group list")
    return result

def decode(raw):
    if not 108 <= len(raw) <= MAX_PAYLOAD or raw[0] not in (2, 3) or (raw[0] == 2 and raw[1] not in (4, 6)):
        raise ValueError("invalid relay advertisement")
    version = raw[0]
    if version == 3:
        family, name_len, count = (6 if raw[1] & 128 else 4), (raw[1] & 127)+1, raw[2]
    else:
        _, family, name_len, count = raw[:4]
    if not 1 <= name_len <= 128 or count > 16:
        raise ValueError("invalid relay advertisement")
    tail = 160 if version == 3 else 96
    identity = raw[-160:-96] if version == 3 else None
    key = identity[32:] if identity else raw[-96:-64]
    domain = b"Qortal-MASQUE-Discovery-v3\x00" if version == 3 else DOMAIN
    RNS.Cryptography.Ed25519PublicKey.from_public_bytes(key).verify(raw[-64:], domain + raw[:-64])
    offset = 3 if version == 3 else 4
    length = 4 if family == 4 else 16
    host = str(ipaddress.ip_address(raw[offset:offset + length])); offset += length
    port, expiry = struct.unpack(">HI", raw[offset:offset + 6]); offset += 6
    pin = raw[offset:offset + 32].hex(); offset += 32
    name = raw[offset:offset + name_len].decode("ascii"); offset += name_len
    groups = []
    for _ in range(count):
        value = 0
        for shift in range(0, 35, 7):
            if offset >= len(raw) - tail: raise ValueError("truncated group ID")
            byte = raw[offset]; offset += 1; value |= (byte & 127) << shift
            if byte < 128:
                if shift and byte == 0: raise ValueError("non-canonical group ID")
                break
        else: raise ValueError("invalid group ID")
        if not 0 < value < 2**31: raise ValueError("invalid group ID")
        groups.append(value)
    if offset != len(raw) - tail or groups != sorted(set(groups)):
        raise ValueError("invalid group list")
    if expiry <= int(time.time()) or expiry > int(time.time()) + 3600:
        raise ValueError("expired relay advertisement")
    return {"v": version, "h": host, "p": port, "s": name, "c": pin, "x": expiry,
            "ticketIdentity": identity.hex() if identity else None,
            "ticketKeyId": raw[-96:-64].hex() if identity else None,
            "relayIdentity": key.hex(), "accessMode": "groups" if groups else "public",
            "allowedGroupIds": groups}

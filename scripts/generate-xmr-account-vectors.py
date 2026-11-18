#!/usr/bin/env python3
"""Independent public, unfunded fixtures. Requires PyNaCl and PyCryptodome.

Uses Python HMAC/SHA-512, libsodium scalar multiplication and PyCryptodome
Keccak, independent of the production Noble/scure implementation.
"""
import argparse
import hashlib
import hmac
import json
from pathlib import Path

from Crypto.Hash import keccak
from nacl.bindings import crypto_scalarmult_ed25519_base_noclamp

ROOT = Path(__file__).resolve().parents[1]
ORDER = 2**252 + 27742317777372353535851937790883648493
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BLOCK_LENGTHS = (0, 2, 3, 5, 6, 7, 9, 10, 11)


def fast_hash(data):
    return keccak.new(digest_bits=256, data=data).digest()


def block58(data):
    result = ""
    for offset in range(0, len(data), 8):
        block = data[offset:offset + 8]
        value = int.from_bytes(block, "big")
        encoded = ""
        while value:
            value, digit = divmod(value, 58)
            encoded = ALPHABET[digit] + encoded
        result += encoded.rjust(BLOCK_LENGTHS[len(block)], "1")
    return result


def account_keys(seed, version, nonce, network):
    domain = b"QortalHub/XMR/spend/v1\0" + network.encode("ascii") + b"\0"
    context = domain + version.to_bytes(4, "big") + nonce.to_bytes(4, "big")
    for counter in range(2**32):
        material = hmac.new(seed, context + counter.to_bytes(4, "big"), hashlib.sha512).digest()
        spend = int.from_bytes(material, "little") % ORDER
        spend_bytes = spend.to_bytes(32, "little")
        view = int.from_bytes(fast_hash(spend_bytes), "little") % ORDER
        if spend and view:
            break
    else:
        raise ValueError("No nonzero fixture scalar")
    view_bytes = view.to_bytes(32, "little")
    public_spend = crypto_scalarmult_ed25519_base_noclamp(spend_bytes)
    public_view = crypto_scalarmult_ed25519_base_noclamp(view_bytes)
    payload = bytes([18 if network == "mainnet" else 24]) + public_spend + public_view
    return {
        "derivationVersion": 1, "network": network,
        "address": block58(payload + fast_hash(payload)[:4]),
        "publicSpendKey": public_spend.hex(), "publicViewKey": public_view.hex(),
        "privateSpendKey": spend_bytes.hex(), "privateViewKey": view_bytes.hex(),
    }


def vectors():
    legacy = json.loads((ROOT / "src/utils/generateWallet/fixtures/pre-xmr-wallets.json").read_text())
    cases = []
    for case in legacy:
        root = bytes.fromhex(case["seedHex"])
        version, nonce = case["version"], case["nonce"]
        if version == 1:
            address_seed = root
        else:
            nonce_bytes = nonce.to_bytes(4, "big")
            material = nonce_bytes + root + nonce_bytes
            address_seed = hashlib.sha512(hashlib.sha512(material).digest() + material).digest()[:32]
        cases.append({
            "seedHex": case["seedHex"], "version": version, "nonce": nonce,
            "addressSeedHex": address_seed.hex(),
            "wallet": {network: account_keys(address_seed, version, nonce, network)
                       for network in ("mainnet", "stagenet")},
        })
    return {"warning": "Public synthetic keys. Never fund these wallets.", "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write frozen fixtures instead of checking")
    args = parser.parse_args()
    path = ROOT / "src/lib/monero/fixtures/account-v1.json"
    generated = vectors()
    if args.write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(generated, indent=2) + "\n")
    else:
        assert generated == json.loads(path.read_text()), "XMR recovery vectors changed"
    print(f"Verified {len(generated['cases']) * 2} public XMR account/network vectors")

# docs/test_vectors.json (backend ile ortak vektör) üzerinden crypto.py'yi doğrular.
import json
from pathlib import Path

import crypto

VECTOR = json.loads((Path(__file__).resolve().parents[2] / "docs" / "test_vectors.json").read_text())


def test_hash():
    assert crypto.sha256_hex(VECTOR["file_content_ascii"].encode()) == VECTOR["document_hash"]


def test_message():
    v = VECTOR
    assert crypto.build_message(v["document_hash"], v["sender"], v["receiver"], v["timestamp"]) == v["signed_message"]
    assert v["signed_message"].startswith("notary:v1|")


def test_signature_verifies():
    v = VECTOR
    assert crypto.verify_signature(v["public_key_b64"], v["signed_message"], v["signature_b64"])


def test_signature_matches_backend_vector():
    """Aynı private key + mesaj -> aynı imza (Ed25519 deterministik)."""
    v = VECTOR
    assert crypto.sign(v["private_key_b64"], v["signed_message"]) == v["signature_b64"]


def test_seed_keypair_matches_vector():
    priv, pub = crypto.keypair_from_seed(bytes([0x42]) * 32)
    assert (priv, pub) == (VECTOR["private_key_b64"], VECTOR["public_key_b64"])


def test_tampered_message_fails():
    v = VECTOR
    assert not crypto.verify_signature(v["public_key_b64"], v["signed_message"] + "x", v["signature_b64"])


def test_save_load_roundtrip(tmp_path):
    priv, pub = crypto.generate_keypair()
    crypto.save_keys("agent_a", priv, pub, keys_dir=tmp_path)
    assert crypto.load_keys("agent_a", keys_dir=tmp_path) == (priv, pub)

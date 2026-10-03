# docs/test_vectors.json vektörünü doğrular.
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import crypto  # noqa: E402

VECTOR = json.loads((Path(__file__).resolve().parents[2] / "docs" / "test_vectors.json").read_text())


def test_hash():
    assert crypto.sha256_hex(b"hello notara") == VECTOR["document_hash"]


def test_message():
    v = VECTOR
    assert crypto.build_message(v["document_hash"], v["sender"], v["receiver"], v["timestamp"]) == v["message"]


def test_signature_verifies():
    v = VECTOR
    assert crypto.verify_signature(v["public_key"], v["message"], v["signature"])


def test_signature_deterministic_from_seed():
    priv, pub = crypto.keypair_from_seed(bytes([1]) * 32)
    assert pub == VECTOR["public_key"]
    assert crypto.sign(priv, VECTOR["message"]) == VECTOR["signature"]


def test_tampered_message_fails():
    v = VECTOR
    assert not crypto.verify_signature(v["public_key"], v["message"] + "x", v["signature"])


def test_save_load_roundtrip(tmp_path):
    priv, pub = crypto.generate_keypair()
    crypto.save_keys("agent_a", priv, pub, keys_dir=tmp_path)
    assert crypto.load_keys("agent_a", keys_dir=tmp_path) == (priv, pub)

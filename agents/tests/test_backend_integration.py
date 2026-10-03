# Gerçek backend'e karşı uçtan uca test. Sadece NOTARY_TEST_API_URL tanımlıysa çalışır:
#   NOTARY_TEST_API_URL=http://127.0.0.1:8000 pytest tests/test_backend_integration.py
import os

import pytest

import client
import crypto
import receiver_agent
import sender_agent

API = os.environ.get("NOTARY_TEST_API_URL")
pytestmark = pytest.mark.skipif(not API, reason="NOTARY_TEST_API_URL tanımlı değil")


def test_full_flow_against_backend(tmp_path):
    out = sender_agent.run("integration", outbox=tmp_path / "box", api_url=API, keys_dir=tmp_path / "k",
                           log=lambda *_: None)
    proof = out["proof"]
    assert crypto.verify_signature(
        crypto.load_keys("agent_a", keys_dir=tmp_path / "k")[1],
        crypto.build_message(proof["document_hash"], proof["sender"], proof["receiver"], proof["timestamp"]),
        proof["signature"],
    )
    assert receiver_agent.receive_from_inbox(tmp_path / "box", api_url=API, log=lambda *_: None)["status"] == "VERIFIED"
    out["file"].write_bytes(out["file"].read_bytes() + b"\x00")
    assert receiver_agent.receive_from_inbox(tmp_path / "box", api_url=API, log=lambda *_: None)["status"] == "INVALID"
    assert client.get_proof(proof["proof_id"], api_url=API)["document_hash"] == proof["document_hash"]


def test_bad_signature_rejected(tmp_path):
    client.ensure_agent("agent_a", keys_dir=tmp_path, api_url=API)
    f = tmp_path / "x.bin"
    f.write_bytes(b"x")
    # farklı bir anahtarla imzalanmış istek: backend 400 dönmeli
    crypto.save_keys("agent_a", *crypto.generate_keypair(), keys_dir=tmp_path)
    with pytest.raises(client.ApiError) as e:
        client.notarize(f, "agent_a", "agent_b", keys_dir=tmp_path, api_url=API)
    assert e.value.status_code == 400

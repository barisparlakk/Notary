# client.py'yi gerçek bir mock_server (uvicorn, rastgele port) karşısında test eder.
import socket
import threading
import time

import pytest
import uvicorn

import client
import mock_server


@pytest.fixture(scope="module")
def api_url():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(mock_server.app, port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def agents(tmp_path, api_url):
    for agent in ("agent_a", "agent_b"):
        client.ensure_agent(agent, keys_dir=tmp_path, api_url=api_url)
    return tmp_path


def test_health(api_url):
    assert client.health(api_url) == {"status": "ok"}


def test_notarize_then_verify(agents, api_url, tmp_path):
    f = tmp_path / "report.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    proof = client.notarize(f, "agent_a", "agent_b", keys_dir=agents, api_url=api_url)
    assert set(proof) == {"proof_id", "document_hash", "sender", "receiver", "timestamp",
                          "signature", "tx_signature", "explorer_url"}
    res = client.verify(f, proof["proof_id"], api_url=api_url)
    assert res["status"] == "VERIFIED"
    assert res["original_hash"] == res["received_hash"] == proof["document_hash"]
    assert client.get_proof(proof["proof_id"], api_url=api_url) == proof


def test_tampered_file_is_invalid(agents, api_url, tmp_path):
    f = tmp_path / "report.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    proof = client.notarize(f, "agent_a", "agent_b", keys_dir=agents, api_url=api_url)
    f.write_bytes(f.read_bytes() + b"\x00")
    res = client.verify(f, proof["proof_id"], api_url=api_url)
    assert res["status"] == "INVALID"
    assert res["original_hash"] != res["received_hash"]


def test_unknown_proof_is_invalid(api_url, tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"x")
    assert client.verify(f, "proof_yok", api_url=api_url)["status"] == "INVALID"


def test_unregistered_sender_rejected(api_url, tmp_path):
    import crypto
    crypto.save_keys("agent_x", *crypto.generate_keypair(), keys_dir=tmp_path)
    f = tmp_path / "x.bin"
    f.write_bytes(b"x")
    with pytest.raises(client.ApiError) as e:
        client.notarize(f, "agent_x", "agent_b", keys_dir=tmp_path, api_url=api_url)
    assert e.value.status_code == 400


def test_get_unknown_proof_404(api_url):
    with pytest.raises(client.ApiError) as e:
        client.get_proof("proof_yok", api_url=api_url)
    assert e.value.status_code == 404

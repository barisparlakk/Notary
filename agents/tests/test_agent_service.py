# n8n servisi: sahte zincire karşı; yetkilendirme, dosya sınırı, agent adı doğrulaması ve tüm akışlar.
import pytest
from fastapi.testclient import TestClient

import agent_service
import onchain

KEY = {"X-API-Key": "s3cret"}


@pytest.fixture
def api(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    funder = onchain.Keypair()
    rpc.airdrop(funder.pubkey(), 1)
    app = agent_service.create_app(rpc=rpc, program_id=program, keys_dir=tmp_path / "keys", funder=funder, token="s3cret")
    return TestClient(app), rpc, program


def f(content=b"hello contract"):
    return {"file": ("doc.pdf", content)}


def test_requires_api_key(api):
    c, *_ = api
    assert c.post("/agent/notarize", files=f()).status_code == 401
    assert c.post("/agent/notarize", files=f(), headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.get("/health").status_code == 200  # sağlık kontrolü açık


def test_unconfigured_token_refuses(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    c = TestClient(agent_service.create_app(rpc=rpc, program_id=program, keys_dir=tmp_path, token=""))
    assert c.post("/agent/notarize", files=f(), headers=KEY).status_code == 503


def test_notarize_then_verify_roundtrip(api):
    c, rpc, program = api
    res = c.post("/agent/notarize", files=f(), data={"agent": "agent_a"}, headers=KEY)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["certificate"]["version"] == "notary.cert.v1" and body["proof_pda"]
    ok = c.post("/agent/verify", files=f(), data={"proof_pda": body["proof_pda"]}, headers=KEY).json()
    assert ok["status"] == "VERIFIED"
    bad = c.post("/agent/verify", files=f(b"hello contract!"), data={"proof_pda": body["proof_pda"]}, headers=KEY).json()
    assert bad["status"] == "INVALID"
    by_hash = c.post("/agent/verify", files=f(), headers=KEY).json()
    assert by_hash["status"] == "VERIFIED"


def test_duplicate_notarize_is_a_conflict(api):
    c, *_ = api
    assert c.post("/agent/notarize", files=f(b"same"), headers=KEY).status_code == 200
    again = c.post("/agent/notarize", files=f(b"same"), headers=KEY)
    assert again.status_code == 409 and "already in use" in again.json()["detail"]


def test_input_validation(api):
    c, *_ = api
    assert c.post("/agent/notarize", files=f(), data={"agent": "../etc/passwd"}, headers=KEY).status_code == 400
    assert c.post("/agent/notarize", files=f(), data={"parents": "nothex"}, headers=KEY).status_code == 400
    assert c.post("/agent/notarize", files={"file": ("e.bin", b"")}, headers=KEY).status_code == 400
    big = c.post("/agent/notarize", files={"file": ("big.bin", b"x" * (agent_service.MAX_BYTES + 1))}, headers=KEY)
    assert big.status_code == 413


def test_parents_are_recorded(api):
    c, rpc, _ = api
    parent = c.post("/agent/notarize", files=f(b"parent"), headers=KEY).json()
    child = c.post("/agent/notarize", files=f(b"child"), data={"parents": parent["document_hash"]}, headers=KEY).json()
    assert onchain.get_proof(rpc, child["proof_pda"])["parents"] == [parent["document_hash"]]


def test_agreement_flow(api):
    c, *_ = api
    # agent_b'nin adresini servise ilk imzalatarak öğren
    first = c.post("/agent/notarize", files=f(b"warmup"), data={"agent": "agent_b"}, headers=KEY).json()
    b_pub = first["signer"]
    created = c.post("/agent/agreement", files=f(b"two party contract"), data={"agent": "agent_a", "parties": f"self,{b_pub}"}, headers=KEY)
    assert created.status_code == 200, created.text
    pda = created.json()["agreement_pda"]
    assert c.post("/agent/verify", files=f(b"two party contract"), data={"proof_pda": pda}, headers=KEY).json()["status"] == "PENDING"
    assert c.get(f"/agent/agreement/{pda}", headers=KEY).json()["signed_count"] == 1
    assert c.post("/agent/agreement/sign", data={"agreement_pda": pda, "agent": "agent_b"}, headers=KEY).status_code == 200
    assert c.post("/agent/verify", files=f(b"two party contract"), data={"proof_pda": pda}, headers=KEY).json()["status"] == "VERIFIED"
    again = c.post("/agent/agreement/sign", data={"agreement_pda": pda, "agent": "agent_b"}, headers=KEY)
    assert again.status_code == 409 and "AlreadySigned" in again.json()["detail"]
    assert c.get("/agent/agreement/" + onchain.Keypair().pubkey().__str__(), headers=KEY).status_code == 404


def test_funder_can_come_from_env(chain_rpc, tmp_path, monkeypatch):
    rpc, program = chain_rpc
    funder = onchain.Keypair()
    rpc.airdrop(funder.pubkey(), 1)
    onchain.save_keypair(funder, tmp_path / "funder.json")
    monkeypatch.setenv("AGENT_FUNDER_KEYPAIR", str(tmp_path / "funder.json"))
    c = TestClient(agent_service.create_app(rpc=rpc, program_id=program, keys_dir=tmp_path / "k", token="s3cret"))
    assert c.post("/agent/notarize", files=f(b"funded from env"), headers=KEY).status_code == 200

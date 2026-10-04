"""v2 relayer testleri: zincire gitmeden (RPC sahte), kural denetimleri ve imza akışı."""
import base64
import hashlib
import struct

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction

from app import relay

PROGRAM = Keypair.from_seed(bytes([7]) * 32).pubkey()
RELAYER = Keypair.from_seed(bytes([9]) * 32)
DISC = hashlib.sha256(b"global:notarize").digest()[:8]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("PROGRAM_ID", str(PROGRAM))
    monkeypatch.setattr(relay, "get_or_create_keypair", lambda: RELAYER)
    relay._hits.clear()
    sent = []

    async def fake_rpc(method, params):
        if method == "sendTransaction":
            sent.append(params[0])
            return "5" * 87 + "A"
        if method == "getSignatureStatuses":
            return {"value": [{"err": None, "confirmationStatus": "confirmed"}]}
        raise AssertionError(method)

    monkeypatch.setattr(relay, "_rpc", fake_rpc)
    return sent


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(relay.router)
    return TestClient(app)


def build_tx(signer, *, fee_payer=RELAYER.pubkey(), payer=RELAYER.pubkey(), program=PROGRAM, data=None,
             sign=True, extra_ix=False):
    h = hashlib.sha256(b"doc").digest()
    data = data if data is not None else DISC + h + b"\x00" + struct.pack("<I", 0)
    pda, _ = Pubkey.find_program_address([b"proof", bytes(signer.pubkey()), h], program)
    ix = Instruction(program, data, [
        AccountMeta(signer.pubkey(), True, False), AccountMeta(payer, True, True),
        AccountMeta(pda, False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)])
    ixs = [ix, ix] if extra_ix else [ix]
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash(ixs, fee_payer, bh))
    if sign:
        tx.partial_sign([signer], bh)
    return tx, pda


def post(client, tx):
    return client.post("/relay", json={"tx_base64": base64.b64encode(bytes(tx)).decode()})


def test_info(client):
    body = client.get("/relay/info").json()
    assert body == {"enabled": True, "program_id": str(PROGRAM), "relayer_pubkey": str(RELAYER.pubkey()), "cluster": "devnet"}


def test_happy_path_relayer_adds_its_signature(client, env):
    signer = Keypair()
    tx, pda = build_tx(signer)
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["proof_pda"] == str(pda)
    sent = Transaction.from_bytes(base64.b64decode(env[0]))
    sent.verify()  # iki imza da geçerli


@pytest.mark.parametrize("kwargs,why", [
    ({"program": Keypair().pubkey()}, "wrong program"),
    ({"data": b"\x00" * 8 + b"x" * 40}, "wrong discriminator"),
    ({"fee_payer": Keypair().pubkey()}, "fee payer is not the relayer"),
    ({"payer": Keypair().pubkey()}, "payer account is not the relayer"),
    ({"extra_ix": True}, "two instructions"),
    ({"data": DISC + b"\x00" * 400}, "oversized data"),
])
def test_rejects_tampered_transactions(client, kwargs, why):
    tx, _ = build_tx(Keypair(), **kwargs)
    assert post(client, tx).status_code == 400, why


def test_rejects_relayer_as_signer(client):
    """Relayer adına sahte kayıt: signer = relayer olamaz."""
    h = hashlib.sha256(b"x").digest()
    pda, _ = Pubkey.find_program_address([b"proof", bytes(RELAYER.pubkey()), h], PROGRAM)
    ix = Instruction(PROGRAM, DISC + h + b"\x00" + struct.pack("<I", 0), [
        AccountMeta(RELAYER.pubkey(), True, False), AccountMeta(RELAYER.pubkey(), True, True),
        AccountMeta(pda, False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)])
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], RELAYER.pubkey(), Hash.new_unique()))
    res = post(client, tx)
    assert res.status_code == 400 and "relayer" in res.json()["detail"].lower()


def test_rejects_missing_signer_signature(client):
    tx, _ = build_tx(Keypair(), sign=False)
    assert post(client, tx).status_code == 400


def test_rejects_garbage(client):
    assert client.post("/relay", json={"tx_base64": "not-base64!!"}).status_code == 400
    assert client.post("/relay", json={"tx_base64": base64.b64encode(b"junk").decode()}).status_code == 400


def test_disabled_without_program_id(client, monkeypatch):
    monkeypatch.delenv("PROGRAM_ID")
    tx, _ = build_tx(Keypair())
    assert post(client, tx).status_code == 503
    assert client.get("/relay/info").json()["enabled"] is False


def test_rate_limit(client, monkeypatch):
    monkeypatch.setenv("RELAY_RATE_LIMIT", "2")
    codes = [post(client, build_tx(Keypair())[0]).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_onchain_failure_is_reported(client, monkeypatch):
    async def failing(method, params):
        if method == "sendTransaction":
            return "sig"
        return {"value": [{"err": {"InstructionError": [0, "Custom"]}}]}
    monkeypatch.setattr(relay, "_rpc", failing)
    assert post(client, build_tx(Keypair())[0]).status_code == 409

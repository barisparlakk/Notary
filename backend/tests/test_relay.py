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
        if method == "getBalance":
            return {"value": 1_000_000_000}
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
             sign=True, extra_ix=False, pre=()):
    h = hashlib.sha256(b"doc").digest()
    data = data if data is not None else DISC + h + b"\x00" + struct.pack("<I", 0)
    pda, _ = Pubkey.find_program_address([b"proof", bytes(signer.pubkey()), h], program)
    ix = Instruction(program, data, [
        AccountMeta(signer.pubkey(), True, False), AccountMeta(payer, True, True),
        AccountMeta(pda, False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)])
    ixs = [*pre, ix, ix] if extra_ix else [*pre, ix]
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash(ixs, fee_payer, bh))
    if sign:
        tx.partial_sign([signer], bh)
    return tx, pda


def post(client, tx):
    return client.post("/relay", json={"tx_base64": base64.b64encode(bytes(tx)).decode()})


AG_DISC = hashlib.sha256(b"global:create_agreement").digest()[:8]
COSIGN_DISC = hashlib.sha256(b"global:co_sign").digest()[:8]


def agreement_tx(creator, parties, *, relayer=RELAYER.pubkey(), program=PROGRAM, sign=True):
    h = hashlib.sha256(b"agreement").digest()
    pda, _ = Pubkey.find_program_address([b"agreement", bytes(creator.pubkey()), h], program)
    data = AG_DISC + h + struct.pack("<I", len(parties)) + b"".join(bytes(p) for p in parties)
    ix = Instruction(program, data, [
        AccountMeta(creator.pubkey(), True, False), AccountMeta(relayer, True, True),
        AccountMeta(pda, False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)])
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], RELAYER.pubkey(), bh))
    if sign:
        tx.partial_sign([creator], bh)
    return tx, pda


def cosign_tx(signer, agreement=None, *, data=COSIGN_DISC, sign=True):
    agreement = agreement or Keypair().pubkey()
    ix = Instruction(PROGRAM, data, [AccountMeta(signer.pubkey(), True, False), AccountMeta(agreement, False, True)])
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], RELAYER.pubkey(), bh))
    if sign:
        tx.partial_sign([signer], bh)
    return tx, agreement


def test_relays_create_agreement(client, env):
    creator, other = Keypair(), Keypair()
    tx, pda = agreement_tx(creator, [creator.pubkey(), other.pubkey()])
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "create_agreement" and res.json()["account"] == str(pda) == res.json()["proof_pda"]
    Transaction.from_bytes(base64.b64decode(env[0])).verify()


def test_relays_co_sign(client, env):
    signer = Keypair()
    tx, agreement = cosign_tx(signer)
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "co_sign" and res.json()["account"] == str(agreement)
    Transaction.from_bytes(base64.b64decode(env[0])).verify()


def test_agreement_instructions_reject_abuse(client):
    me = Keypair()
    # relayer imza atan taraf olamaz
    ix = Instruction(PROGRAM, COSIGN_DISC, [AccountMeta(RELAYER.pubkey(), True, False), AccountMeta(Keypair().pubkey(), False, True)])
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], RELAYER.pubkey(), Hash.new_unique()))
    assert post(client, tx).status_code == 400
    # co_sign'a fazladan veri eklenemez
    assert post(client, cosign_tx(me, data=COSIGN_DISC + b"\x01")[0]).status_code == 400
    # yanlış program, imzasız, yanlış payer
    other_prog = Keypair().pubkey()
    assert post(client, agreement_tx(me, [me.pubkey(), Keypair().pubkey()], program=other_prog)[0]).status_code == 400
    assert post(client, cosign_tx(me, sign=False)[0]).status_code == 400
    assert post(client, agreement_tx(me, [me.pubkey(), Keypair().pubkey()], relayer=Keypair().pubkey())[0]).status_code == 400
    # taraf sayısı sınırı ölçüde veri uzunluğuyla da korunur
    big = [Keypair().pubkey() for _ in range(9)]
    assert post(client, agreement_tx(me, [me.pubkey(), *big])[0]).status_code == 400


def test_info(client):
    body = client.get("/relay/info").json()
    assert body == {"enabled": True, "program_id": str(PROGRAM), "relayer_pubkey": str(RELAYER.pubkey()), "cluster": "devnet",
                    "balance_lamports": 1_000_000_000, "low_balance": False}


def test_happy_path_relayer_adds_its_signature(client, env):
    signer = Keypair()
    tx, pda = build_tx(signer)
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["proof_pda"] == str(pda) and res.json()["kind"] == "notarize"
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
        if method == "getBalance":
            return {"value": 1_000_000_000}
        if method == "sendTransaction":
            return "sig"
        return {"value": [{"err": {"InstructionError": [0, "Custom"]}}]}
    monkeypatch.setattr(relay, "_rpc", failing)
    assert post(client, build_tx(Keypair())[0]).status_code == 409


def test_low_balance_disables_relay(client, monkeypatch):
    async def poor(method, params):
        assert method == "getBalance"
        return {"value": 1000}
    monkeypatch.setattr(relay, "_rpc", poor)
    info = client.get("/relay/info").json()
    assert info["enabled"] is False and info["low_balance"] is True
    assert post(client, build_tx(Keypair())[0]).status_code == 503


def test_info_survives_rpc_failure(client, monkeypatch):
    async def down(method, params):
        raise RuntimeError("rpc down")
    monkeypatch.setattr(relay, "_rpc", down)
    info = client.get("/relay/info").json()
    assert info["enabled"] is True and info["balance_lamports"] is None


def test_shared_counter_is_used_when_configured(client, monkeypatch):
    """Upstash REST yapılandırılınca sayaç oradan gelir (HTTP sahte)."""
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://upstash.test")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "t")
    monkeypatch.setenv("RELAY_RATE_LIMIT", "2")
    counts = iter([1, 2, 3])
    calls = []

    class FakeResp:
        def __init__(self, n): self.n = n
        def json(self): return [{"result": self.n}, {"result": 1}]

    class FakeHttp:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None):
            calls.append((url, headers, json))
            return FakeResp(next(counts))

    monkeypatch.setattr(relay.httpx, "AsyncClient", FakeHttp)
    codes = [post(client, build_tx(Keypair())[0]).status_code for _ in range(3)]
    # getBalance/sendTransaction sahte _rpc üzerinden gider; AsyncClient yalnızca sayaçta kullanılır
    assert codes == [200, 200, 429]
    assert calls[0][0] == "https://upstash.test/pipeline" and calls[0][1]["Authorization"] == "Bearer t"


def test_shared_counter_failure_falls_back_to_memory(client, monkeypatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://upstash.test")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "t")
    monkeypatch.setenv("RELAY_RATE_LIMIT", "1")

    class Boom:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise RuntimeError("upstash down")

    monkeypatch.setattr(relay.httpx, "AsyncClient", Boom)
    codes = [post(client, build_tx(Keypair())[0]).status_code for _ in range(2)]
    assert codes == [200, 429]  # bellek içi sayaç devreye girdi


# ---------------------------------------------------------------- kimlik ve iptal talimatları
ATTEST_DISC = hashlib.sha256(b"global:attest_identity").digest()[:8]
REVOKE_ATT_DISC = hashlib.sha256(b"global:revoke_attestation").digest()[:8]
REVOKE_PROOF_DISC = hashlib.sha256(b"global:revoke_proof").digest()[:8]


def attest_data(label=b"Ahmet"):
    return ATTEST_DISC + bytes(Keypair().pubkey()) + struct.pack("<I", len(label)) + label + b"\x00" * 32 + struct.pack("<q", 0)


def generic_tx(signer, data, accounts, *, sign=True, fee_payer=RELAYER.pubkey()):
    ix = Instruction(PROGRAM, data, accounts)
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], fee_payer, bh))
    if sign:
        tx.partial_sign([signer], bh)
    return tx


def attest_tx(issuer, data=None, payer=RELAYER.pubkey()):
    pda = Keypair().pubkey()
    return generic_tx(issuer, data or attest_data(), [
        AccountMeta(issuer.pubkey(), True, False), AccountMeta(payer, True, True),
        AccountMeta(pda, False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)]), pda


def revoke_proof_tx(signer, *, with_system=True, payer=RELAYER.pubkey()):
    proof, rev = Keypair().pubkey(), Keypair().pubkey()
    accts = [AccountMeta(signer.pubkey(), True, False), AccountMeta(payer, True, True),
             AccountMeta(proof, False, False), AccountMeta(rev, False, True)]
    if with_system:
        accts.append(AccountMeta(SYSTEM_PROGRAM_ID, False, False))
    return generic_tx(signer, REVOKE_PROOF_DISC, accts), rev


def test_relays_attest_identity(client, env):
    issuer = Keypair()
    tx, pda = attest_tx(issuer)
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "attest_identity" and res.json()["account"] == str(pda)
    Transaction.from_bytes(base64.b64decode(env[0])).verify()


def test_relays_revoke_attestation(client, env):
    issuer, att = Keypair(), Keypair().pubkey()
    tx = generic_tx(issuer, REVOKE_ATT_DISC, [AccountMeta(issuer.pubkey(), True, False), AccountMeta(att, False, True)])
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "revoke_attestation" and res.json()["account"] == str(att)


def test_relays_revoke_proof_and_targets_the_revocation_account(client, env):
    signer = Keypair()
    tx, rev = revoke_proof_tx(signer)
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "revoke_proof" and res.json()["account"] == str(rev)
    Transaction.from_bytes(base64.b64decode(env[0])).verify()


def test_identity_and_revocation_instructions_reject_abuse(client):
    me = Keypair()
    assert post(client, attest_tx(me, payer=me.pubkey())[0]).status_code == 400  # payer relayer değil
    assert post(client, attest_tx(me, data=attest_data(b"x" * 33))[0]).status_code == 400  # etiket çok uzun
    assert post(client, attest_tx(me, data=attest_data(b"")[:-1])[0]).status_code == 400  # kısa/bozuk veri
    unsigned = generic_tx(me, attest_data(), [AccountMeta(me.pubkey(), True, False), AccountMeta(RELAYER.pubkey(), True, True),
                                             AccountMeta(Keypair().pubkey(), False, True), AccountMeta(SYSTEM_PROGRAM_ID, False, False)], sign=False)
    assert post(client, unsigned).status_code == 400  # signer imzası yok
    assert post(client, revoke_proof_tx(me, with_system=False)[0]).status_code == 400  # hesap sayısı eksik
    assert post(client, revoke_proof_tx(me, payer=me.pubkey())[0]).status_code == 400  # payer relayer değil
    extra = generic_tx(me, REVOKE_ATT_DISC + b"\x01", [AccountMeta(me.pubkey(), True, False), AccountMeta(Keypair().pubkey(), False, True)])
    assert post(client, extra).status_code == 400  # fazladan veri
    as_relayer = Instruction(PROGRAM, REVOKE_ATT_DISC, [AccountMeta(RELAYER.pubkey(), True, False), AccountMeta(Keypair().pubkey(), False, True)])
    tx = Transaction.new_unsigned(Message.new_with_blockhash([as_relayer], RELAYER.pubkey(), Hash.new_unique()))
    assert post(client, tx).status_code == 400  # relayer imzalayan olamaz


# ---------------------------------------------------------------- RPC hız sınırında yeniden deneme
REAL_RPC = relay._rpc  # `env` fixture'ı testlerde relay._rpc'yi değiştirir; gerçek işlevi modül yüklenirken sakla
LIMITED = {"jsonrpc": "2.0", "error": {"code": 429, "message": "Too many requests for a specific RPC call"}}


def run_real_rpc(monkeypatch, responses):
    import asyncio
    import httpx

    calls = {"n": 0}

    def handler(request):
        status, body = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        return httpx.Response(status, json=body)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(relay.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))

    async def no_sleep(_):
        return None

    monkeypatch.setattr(relay.asyncio, "sleep", no_sleep)
    return calls, lambda: asyncio.run(REAL_RPC("getBalance", ["x"]))


def test_rpc_retries_on_rate_limit_then_succeeds(monkeypatch):
    calls, run = run_real_rpc(monkeypatch, [(429, LIMITED), (200, LIMITED), (200, {"jsonrpc": "2.0", "result": {"value": 7}})])
    assert run() == {"value": 7} and calls["n"] == 3


def test_rpc_gives_up_after_bounded_attempts(monkeypatch):
    calls, run = run_real_rpc(monkeypatch, [(429, LIMITED)])
    with pytest.raises(RuntimeError, match="Too many requests"):
        run()
    assert calls["n"] == relay.RPC_ATTEMPTS


def test_rpc_does_not_retry_instruction_errors(monkeypatch):
    calls, run = run_real_rpc(monkeypatch, [(200, {"jsonrpc": "2.0", "error": {"code": -32002, "message": "Transaction simulation failed"}})])
    with pytest.raises(RuntimeError, match="simulation failed"):
        run()
    assert calls["n"] == 1


# ---------------------------------------------------------------- cüzdanın eklediği öncelik ücreti talimatları (Phantom)
CB = relay.COMPUTE_BUDGET_PROGRAM


def cb_price(micro):
    return Instruction(CB, bytes([3]) + micro.to_bytes(8, "little"), [])


def cb_limit(units):
    return Instruction(CB, bytes([2]) + units.to_bytes(4, "little"), [])


def test_relays_the_exact_shape_phantom_produces(client, env):
    """Gerçek bir Phantom işlemi: SetComputeUnitPrice(375000) + SetComputeUnitLimit(200000) + notarize."""
    signer = Keypair()
    tx, pda = build_tx(signer, pre=(cb_price(375_000), cb_limit(200_000)))
    res = post(client, tx)
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "notarize" and res.json()["account"] == str(pda)
    Transaction.from_bytes(base64.b64decode(env[0])).verify()


@pytest.mark.parametrize("pre", [
    (cb_limit(200_000),),
    (cb_price(1_000),),
    (cb_limit(200_000), cb_price(375_000)),  # sıra önemsiz
])
def test_relays_with_optional_compute_budget_in_any_order(client, pre):
    assert post(client, build_tx(Keypair(), pre=pre)[0]).status_code == 200


@pytest.mark.parametrize("pre, why", [
    ((cb_price(10_000_000), cb_limit(200_000)), "priority fee far above the cap"),
    ((cb_price(2_000_000_000),), "huge price with the default unit limit"),
    ((cb_price(375_000), cb_price(1)), "two price instructions"),
    ((cb_limit(1), cb_limit(2)), "two limit instructions"),
    ((Instruction(CB, bytes([1]) + (0).to_bytes(4, "little"), []),), "RequestHeapFrame is not allowed"),
    ((Instruction(CB, bytes([3]) + (1).to_bytes(8, "little"), [AccountMeta(Keypair().pubkey(), False, False)]),), "compute-budget with accounts"),
    ((Instruction(CB, bytes([3]) + (1).to_bytes(4, "little"), []),), "truncated price data"),
    ((Instruction(Pubkey.from_string("11111111111111111111111111111111"), b"\x00", []),), "some other program is not allowed"),
])
def test_rejects_unsafe_compute_budget_and_extra_instructions(client, pre, why):
    assert post(client, build_tx(Keypair(), pre=pre)[0]).status_code == 400, why


def test_priority_fee_cap_is_configurable_and_boundary_is_inclusive(client, monkeypatch):
    # 375000 µlamport/CU * 200000 CU = 75000 lamport
    monkeypatch.setenv("RELAY_MAX_PRIORITY_LAMPORTS", "75000")
    assert post(client, build_tx(Keypair(), pre=(cb_price(375_000), cb_limit(200_000)))[0]).status_code == 200
    monkeypatch.setenv("RELAY_MAX_PRIORITY_LAMPORTS", "74999")
    res = post(client, build_tx(Keypair(), pre=(cb_price(375_000), cb_limit(200_000)))[0])
    assert res.status_code == 400 and "Priority fee too high" in res.text


def test_compute_budget_alone_is_not_a_notary_transaction(client):
    signer = Keypair()
    ix = cb_limit(200_000)
    bh = Hash.new_unique()
    tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], RELAYER.pubkey(), bh))
    assert post(client, tx).status_code == 400


def test_agreement_and_identity_transactions_also_accept_phantom_prefix(client):
    creator, other = Keypair(), Keypair()
    tx, _ = agreement_tx(creator, [creator.pubkey(), other.pubkey()])
    # aynı talimatı öncelik ücretiyle yeniden kur
    ix = tx.message.instructions[0]
    keys = list(tx.message.account_keys)
    real = Instruction(PROGRAM, bytes(ix.data), [AccountMeta(keys[i], i < 2, i in (1, 2)) for i in ix.accounts])
    bh = Hash.new_unique()
    wrapped = Transaction.new_unsigned(Message.new_with_blockhash([cb_price(375_000), cb_limit(200_000), real], RELAYER.pubkey(), bh))
    wrapped.partial_sign([creator], bh)
    assert post(client, wrapped).status_code == 200

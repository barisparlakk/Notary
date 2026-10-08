# Gerçek bir Solana doğrulayıcısına (solana-test-validator ya da devnet) karşı sınama. Yalnızca env verilirse çalışır:
#   NOTARY_TEST_RPC=http://127.0.0.1:8899 NOTARY_TEST_PROGRAM=<id> NOTARY_TEST_FUNDER=<fonlu.json> pytest tests/test_realchain.py
import os

import pytest

import onchain

RPC, PROGRAM, FUNDER = (os.environ.get(k) for k in ("NOTARY_TEST_RPC", "NOTARY_TEST_PROGRAM", "NOTARY_TEST_FUNDER"))
pytestmark = pytest.mark.skipif(not (RPC and PROGRAM and FUNDER), reason="NOTARY_TEST_RPC/PROGRAM/FUNDER tanımlı değil")


@pytest.fixture(scope="module")
def rpc():
    return onchain.Rpc(RPC)


def fresh(rpc, n):
    funder = onchain.load_keypair(FUNDER)
    kps = [onchain.Keypair() for _ in range(n)]
    for k in kps:
        onchain.fund_from(rpc, funder, k.pubkey(), 30_000_000)
    return kps


def test_real_agreement_flow(rpc):
    a, b, c = fresh(rpc, 3)
    data = f"real agreement {os.urandom(4).hex()}".encode()
    h = onchain.sha256_bytes(data)
    out = onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey(), c.pubkey()], program_id=PROGRAM)

    raw = rpc.get_account(out["agreement_pda"])["data"]
    assert len(raw) == onchain.AGREEMENT_SIZE and raw[:8] == onchain.AGREEMENT_DISC  # gerçek hesap boyutu ve discriminator
    pda_expected, bump = onchain.derive_agreement_pda(PROGRAM, a.pubkey(), h)
    assert out["agreement_pda"] == str(pda_expected) and onchain.get_agreement(rpc, out["agreement_pda"])["bump"] == bump

    assert onchain.verify(rpc, data, pda=out["agreement_pda"], program_id=PROGRAM)["status"] == "PENDING"
    onchain.co_sign(rpc, b, out["agreement_pda"], program_id=PROGRAM)
    onchain.co_sign(rpc, c, out["agreement_pda"], program_id=PROGRAM)
    res = onchain.verify(rpc, data, pda=out["agreement_pda"], program_id=PROGRAM)
    assert res["status"] == "VERIFIED" and res["agreement"]["signed_count"] == 3
    assert onchain.verify(rpc, data + b"x", pda=out["agreement_pda"], program_id=PROGRAM)["status"] == "INVALID"
    assert onchain.verify(rpc, data, program_id=PROGRAM)["status"] == "VERIFIED"  # hash araması (dataSize süzgeci gerçek RPC'de)
    assert out["agreement_pda"] in {x["agreement_pda"] for x in onchain.list_agreements_for(rpc, c.pubkey(), PROGRAM)}


def test_real_agreement_rules_rejected_by_program(rpc):
    a, b, outsider = fresh(rpc, 3)
    h = onchain.sha256_bytes(os.urandom(8))
    with pytest.raises(onchain.ChainError):  # oluşturan taraf listede değil
        onchain.create_agreement(rpc, a, h, [b.pubkey(), outsider.pubkey()], program_id=PROGRAM)
    out = onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey()], program_id=PROGRAM)
    with pytest.raises(onchain.ChainError):  # taraf olmayan imzalayamaz
        onchain.co_sign(rpc, outsider, out["agreement_pda"], program_id=PROGRAM)
    onchain.co_sign(rpc, b, out["agreement_pda"], program_id=PROGRAM)
    with pytest.raises(onchain.ChainError):  # ikinci imza reddedilir
        onchain.co_sign(rpc, b, out["agreement_pda"], program_id=PROGRAM)
    with pytest.raises(onchain.ChainError):  # aynı (creator, hash) tekrar açılamaz
        onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey()], program_id=PROGRAM)


def test_real_relayer_pays_agreement_fees(rpc):
    a, b = fresh(rpc, 2)
    (relayer,) = fresh(rpc, 1)
    h = onchain.sha256_bytes(os.urandom(8))
    broke_a, broke_b = onchain.Keypair(), onchain.Keypair()  # SOL'ü hiç yok
    out = onchain.create_agreement(rpc, broke_a, h, [broke_a.pubkey(), broke_b.pubkey()], program_id=PROGRAM, payer=relayer)
    onchain.co_sign(rpc, broke_b, out["agreement_pda"], program_id=PROGRAM, payer=relayer)
    assert onchain.get_agreement(rpc, out["agreement_pda"])["complete"]

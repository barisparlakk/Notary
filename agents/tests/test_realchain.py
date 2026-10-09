# Gerçek bir Solana doğrulayıcısına (solana-test-validator ya da devnet) karşı sınama. Yalnızca env verilirse çalışır:
#   NOTARY_TEST_RPC=http://127.0.0.1:8899 NOTARY_TEST_PROGRAM=<id> NOTARY_TEST_FUNDER=<fonlu.json> pytest tests/test_realchain.py
import os
import time

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


# ---------------------------------------------------------------- iptal ve kimlik (CONTRACT.md 4a)
def test_real_revoke_proof(rpc):
    owner, other = fresh(rpc, 2)
    data = f"revoke me {os.urandom(4).hex()}".encode()
    out = onchain.notarize(rpc, owner, onchain.sha256_bytes(data), program_id=PROGRAM)
    assert onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM)["status"] == "VERIFIED"

    with pytest.raises(onchain.ChainError):  # başkası iptal edemez
        onchain.revoke_proof(rpc, other, out["proof_pda"], program_id=PROGRAM)
    assert onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM)["status"] == "VERIFIED"

    rev = onchain.revoke_proof(rpc, owner, out["proof_pda"], program_id=PROGRAM)
    raw = rpc.get_account(rev["revocation_pda"])["data"]
    assert len(raw) == onchain.REVOCATION_SIZE and raw[:8] == onchain.REVOCATION_DISC
    res = onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM)
    assert res["status"] == "REVOKED" and res["revocation"]["signer"] == str(owner.pubkey())
    assert onchain.verify(rpc, data + b"x", pda=out["proof_pda"], program_id=PROGRAM)["status"] == "INVALID"  # değişmiş dosya yine INVALID
    assert onchain.get_proof(rpc, out["proof_pda"])["document_hash"] == onchain.sha256_bytes(data).hex()  # kayıt zincirde kalır
    with pytest.raises(onchain.ChainError):  # ikinci iptal açılamaz
        onchain.revoke_proof(rpc, owner, out["proof_pda"], program_id=PROGRAM)


def test_real_identity_levels_expiry_and_revocation(rpc):
    person, issuer = fresh(rpc, 2)
    p = str(person.pubkey())
    trust = {str(issuer.pubkey()): {"pubkey": str(issuer.pubkey()), "label": "Test Issuer"}}
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "none"

    onchain.attest_identity(rpc, person, person.pubkey(), "Ahmet (self)", b"i am ahmet", program_id=PROGRAM)  # kayıt: kendi beyanı
    ident = onchain.resolve_identity(rpc, p, PROGRAM, trust)
    assert (ident["level"], ident["label"]) == ("self_declared", "Ahmet (self)")

    att = onchain.attest_identity(rpc, issuer, person.pubkey(), "Ahmet Yilmaz", b"id-check-2026-10", program_id=PROGRAM)
    raw = rpc.get_account(att["attestation_pda"])["data"]
    assert len(raw) == onchain.ATTESTATION_SIZE and raw[:8] == onchain.ATTESTATION_DISC
    ident = onchain.resolve_identity(rpc, p, PROGRAM, trust)
    assert (ident["level"], ident["label"], ident["best"]["issuer_label"]) == ("trusted", "Ahmet Yilmaz", "Test Issuer")
    assert ident["best"]["claim_hash"] == onchain.claim_hash(b"id-check-2026-10").hex()
    assert onchain.resolve_identity(rpc, p, PROGRAM, {})["level"] == "unrecognized_issuer"  # yayıncıya güvenmeyen

    # kişi, yayıncının beyanını geri çekmeye çalışır: program reddetmeli (istemci fonksiyonu PDA'yı imzalayandan türettiği için ham talimat)
    att_pda = onchain.Pubkey.from_string(att["attestation_pda"])
    steal = onchain.Instruction(
        onchain.Pubkey.from_string(PROGRAM), onchain.REVOKE_ATTESTATION_DISC,
        [onchain.AccountMeta(person.pubkey(), True, False), onchain.AccountMeta(att_pda, False, True)])
    with pytest.raises(onchain.ChainError):
        onchain._send_ix(rpc, steal, [person], person)
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "trusted"  # beyan yerinde
    onchain.revoke_attestation(rpc, issuer, person.pubkey(), program_id=PROGRAM)
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "self_declared"  # onay düştü, kendi beyanı kaldı
    with pytest.raises(onchain.ChainError):  # ikinci geri çekme
        onchain.revoke_attestation(rpc, issuer, person.pubkey(), program_id=PROGRAM)

    onchain.attest_identity(rpc, issuer, person.pubkey(), "Ahmet Yilmaz", b"renewed", program_id=PROGRAM)  # yenileme
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "trusted"

    soon = int(time.time()) + 4
    onchain.attest_identity(rpc, issuer, person.pubkey(), "Ahmet Yilmaz", b"short", expires_at=soon, program_id=PROGRAM)
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "trusted"
    time.sleep(6)
    assert onchain.resolve_identity(rpc, p, PROGRAM, trust)["level"] == "self_declared"  # süre doldu


def test_real_identity_rules_rejected_by_program(rpc):
    person, = fresh(rpc, 1)
    pid = onchain.Pubkey.from_string(PROGRAM)
    pda, _ = onchain.derive_attestation_pda(PROGRAM, person.pubkey(), person.pubkey())

    def raw_attest(label_bytes, expires_at):
        data = (onchain.ATTEST_IDENTITY_DISC + bytes(person.pubkey()) + len(label_bytes).to_bytes(4, "little") + label_bytes
                + b"\x00" * 32 + expires_at.to_bytes(8, "little", signed=True))
        ix = onchain.Instruction(pid, data, [
            onchain.AccountMeta(person.pubkey(), True, False), onchain.AccountMeta(person.pubkey(), True, True),
            onchain.AccountMeta(pda, False, True), onchain.AccountMeta(onchain.SYSTEM_PROGRAM_ID, False, False)])
        return onchain._send_ix(rpc, ix, [person], person)

    with pytest.raises(onchain.ChainError):  # boş etiket
        raw_attest(b"", 0)
    with pytest.raises(onchain.ChainError):  # 33 bayt etiket
        raw_attest(b"x" * 33, 0)
    with pytest.raises(onchain.ChainError):  # geçmişte bitiş
        raw_attest(b"ok", 1)
    raw_attest(b"x" * 32, 0)  # 32 bayt sınırda geçerli
    assert onchain.resolve_identity(rpc, str(person.pubkey()), PROGRAM, {})["label"] == "x" * 32


def test_real_verify_reports_identity_and_revocation_together(rpc):
    person, issuer = fresh(rpc, 2)
    trust = {str(issuer.pubkey()): {"pubkey": str(issuer.pubkey()), "label": "Test Issuer"}}
    onchain.attest_identity(rpc, issuer, person.pubkey(), "Mehmet", b"kyc", program_id=PROGRAM)
    data = f"identity doc {os.urandom(4).hex()}".encode()
    out = onchain.notarize(rpc, person, onchain.sha256_bytes(data), program_id=PROGRAM)
    res = onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM, trust=trust)
    assert res["status"] == "VERIFIED" and res["identity"]["level"] == "trusted" and res["identity"]["label"] == "Mehmet"
    assert "identity" not in onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM, identity=False)


# ------------------------------------------------------------------ relayer ile (kullanıcının SOL'ü yok)
RELAY = os.environ.get("NOTARY_TEST_RELAY")


@pytest.mark.skipif(not RELAY, reason="NOTARY_TEST_RELAY tanımlı değil")
def test_real_relay_pays_for_identity_notarize_and_revoke(rpc):
    person, issuer = onchain.Keypair(), onchain.Keypair()  # ikisinin de bakiyesi sıfır
    assert rpc.balance(person.pubkey()) == 0 and rpc.balance(issuer.pubkey()) == 0
    payer = onchain.RelayPayer(RELAY)
    trust = {str(issuer.pubkey()): {"pubkey": str(issuer.pubkey()), "label": "Relay Issuer"}}

    onchain.attest_identity(rpc, person, person.pubkey(), "Mehmet", b"self", program_id=PROGRAM, payer=payer)
    onchain.attest_identity(rpc, issuer, person.pubkey(), "Mehmet Demir", b"kyc", program_id=PROGRAM, payer=payer)
    data = f"relayed {os.urandom(4).hex()}".encode()
    out = onchain.notarize(rpc, person, onchain.sha256_bytes(data), program_id=PROGRAM, payer=payer)
    res = onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM, trust=trust)
    assert res["status"] == "VERIFIED" and res["identity"]["level"] == "trusted" and res["identity"]["label"] == "Mehmet Demir"

    onchain.revoke_proof(rpc, person, out["proof_pda"], program_id=PROGRAM, payer=payer)
    assert onchain.verify(rpc, data, pda=out["proof_pda"], program_id=PROGRAM, trust=trust)["status"] == "REVOKED"
    onchain.revoke_attestation(rpc, issuer, person.pubkey(), program_id=PROGRAM, payer=payer)
    assert onchain.resolve_identity(rpc, str(person.pubkey()), PROGRAM, trust)["level"] == "self_declared"
    assert rpc.balance(person.pubkey()) == 0 and rpc.balance(issuer.pubkey()) == 0  # kullanıcılar hiç SOL harcamadı

    with pytest.raises(onchain.ChainError):  # relayer yalnızca izinli talimatları imzalar: sistem transferi reddedilir
        from solders.system_program import TransferParams, transfer
        ix = transfer(TransferParams(from_pubkey=person.pubkey(), to_pubkey=issuer.pubkey(), lamports=1))
        onchain._send_ix(rpc, ix, [person], payer)

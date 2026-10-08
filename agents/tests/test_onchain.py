# v2 zincir istemcisi: docs/test_vectors_v2.json vektörü + sahte RPC'ye karşı uçtan uca (API yok).
import json
from pathlib import Path

import pytest
from solders.keypair import Keypair

import mock_rpc
import onchain

V = json.loads((Path(__file__).resolve().parents[2] / "docs" / "test_vectors_v2.json").read_text())


@pytest.fixture
def chain():
    url, state, server = mock_rpc.start(V["program_id"])
    yield onchain.Rpc(url), state
    server.shutdown()


def kp(seed_byte):
    return Keypair.from_seed(bytes([seed_byte]) * 32)


def test_vector_pda_matches():
    signer = Keypair.from_seed(bytes.fromhex(V["signer_seed_hex"]))
    assert str(signer.pubkey()) == V["signer"]
    h = onchain.sha256_bytes(V["file_content_ascii"].encode())
    assert h.hex() == V["document_hash"]
    pda, bump = onchain.derive_proof_pda(V["program_id"], signer.pubkey(), h)
    assert (str(pda), bump) == (V["proof_pda"], V["bump"])


def test_discriminators_and_layout_constants():
    assert onchain.NOTARIZE_DISC.hex() == V["notarize_discriminator_hex"]
    assert onchain.PROOF_DISC.hex() == V["proof_account_discriminator_hex"]
    assert (onchain.SIGNER_OFFSET, onchain.HASH_OFFSET) == (V["memcmp_offsets"]["signer"], V["memcmp_offsets"]["document_hash"])


def test_instruction_data_layout():
    h = bytes(range(32))
    none = onchain.encode_notarize_data(h)
    assert none == onchain.NOTARIZE_DISC + h + b"\x00" + b"\x00\x00\x00\x00"
    p = [b"\x01" * 32, b"\x02" * 32]
    some = onchain.encode_notarize_data(h, str(kp(9).pubkey()), p)
    assert len(some) == 8 + 32 + 33 + 4 + 64 and some[40] == 1
    with pytest.raises(onchain.ChainError):
        onchain.encode_notarize_data(h, None, [bytes(32)] * 5)


def test_notarize_then_verify_all_modes(chain):
    rpc, _ = chain
    signer = kp(0x42)
    data = b"%PDF-1.4 contract"
    h = onchain.sha256_bytes(data)
    out = onchain.notarize(rpc, signer, h, receiver=kp(0x43).pubkey(), program_id=V["program_id"])

    proof = onchain.get_proof(rpc, out["proof_pda"])
    assert proof["signer"] == str(signer.pubkey()) and proof["document_hash"] == h.hex()
    assert proof["receiver"] == str(kp(0x43).pubkey()) and proof["parents"] == []

    by_pda = onchain.verify(rpc, data, pda=out["proof_pda"], program_id=V["program_id"])
    by_signer = onchain.verify(rpc, data, signer=signer.pubkey(), program_id=V["program_id"])
    by_hash = onchain.verify(rpc, data, program_id=V["program_id"])
    assert by_pda["status"] == by_signer["status"] == by_hash["status"] == "VERIFIED"
    assert by_hash["proof_pda"] == out["proof_pda"]


def test_tampered_file(chain):
    rpc, _ = chain
    signer, data = kp(1), b"original"
    out = onchain.notarize(rpc, signer, onchain.sha256_bytes(data), program_id=V["program_id"])
    tampered = data + b"\x00"
    with_pda = onchain.verify(rpc, tampered, pda=out["proof_pda"], program_id=V["program_id"])
    assert with_pda["status"] == "INVALID" and with_pda["original_hash"] == onchain.sha256_bytes(data).hex()
    assert with_pda["original_hash"] != with_pda["received_hash"]
    assert onchain.verify(rpc, tampered, signer=signer.pubkey(), program_id=V["program_id"])["status"] == "NOT_FOUND"
    assert onchain.verify(rpc, tampered, program_id=V["program_id"])["status"] == "NOT_FOUND"


def test_duplicate_is_rejected_but_other_signer_may_notarize(chain):
    rpc, _ = chain
    h = onchain.sha256_bytes(b"doc")
    onchain.notarize(rpc, kp(1), h, program_id=V["program_id"])
    with pytest.raises(onchain.ChainError, match="already in use"):
        onchain.notarize(rpc, kp(1), h, program_id=V["program_id"])
    onchain.notarize(rpc, kp(2), h, program_id=V["program_id"])
    assert len(onchain.find_by_hash(rpc, h, V["program_id"])) == 2


def test_payer_can_differ_from_signer(chain):
    rpc, _ = chain
    out = onchain.notarize(rpc, kp(1), onchain.sha256_bytes(b"x"), payer=kp(2), program_id=V["program_id"])
    assert onchain.get_proof(rpc, out["proof_pda"])["signer"] == str(kp(1).pubkey())


def test_too_many_and_duplicate_parents_rejected_by_program(chain):
    rpc, state = chain
    # istemci doğrulamasını aşıp programın kendi kontrolünü sına
    signer, h = kp(1), onchain.sha256_bytes(b"x")
    dup = [b"\x07" * 32, b"\x07" * 32]
    with pytest.raises(onchain.ChainError, match="DuplicateParent"):
        onchain.notarize(rpc, signer, h, parents=dup, program_id=V["program_id"])


def test_lineage_walks_parents_on_chain(chain):
    rpc, _ = chain
    a, b = kp(1), kp(2)
    research, analysis, decision = b"research", b"analysis", b"decision"
    hr, ha, hd = (onchain.sha256_bytes(x) for x in (research, analysis, decision))
    onchain.notarize(rpc, a, hr, program_id=V["program_id"])
    onchain.notarize(rpc, b, ha, parents=[hr], program_id=V["program_id"])
    out = onchain.notarize(rpc, a, hd, parents=[ha], program_id=V["program_id"])
    chain_list = onchain.lineage(rpc, out["proof_pda"], V["program_id"])
    assert [n["document_hash"] for n in chain_list] == [hr.hex(), ha.hex()]  # kökler önce
    assert chain_list[0]["signer"] == str(a.pubkey()) and chain_list[1]["signer"] == str(b.pubkey())


def test_lineage_marks_missing_parent(chain):
    rpc, _ = chain
    ghost = onchain.sha256_bytes(b"never notarized")
    out = onchain.notarize(rpc, kp(1), onchain.sha256_bytes(b"child"), parents=[ghost], program_id=V["program_id"])
    nodes = onchain.lineage(rpc, out["proof_pda"], V["program_id"])
    assert nodes == [{"document_hash": ghost.hex(), "proof_pda": None, "missing": True, "parents": []}]


def test_decoder_ignores_padding_and_handles_none_receiver(chain):
    rpc, state = chain
    out = onchain.notarize(rpc, kp(1), onchain.sha256_bytes(b"x"), program_id=V["program_id"])
    raw = state.accounts[out["proof_pda"]]
    assert len(raw) == 247
    p = onchain.decode_proof(raw)
    assert p["receiver"] is None and p["version"] == 1 and p["bump"] == onchain.derive_proof_pda(
        V["program_id"], kp(1).pubkey(), onchain.sha256_bytes(b"x"))[1]


def test_list_by_signer_and_certificate(chain):
    rpc, _ = chain
    s = kp(5)
    a = onchain.notarize(rpc, s, onchain.sha256_bytes(b"1"), program_id=V["program_id"])
    onchain.notarize(rpc, s, onchain.sha256_bytes(b"2"), program_id=V["program_id"])
    onchain.notarize(rpc, kp(6), onchain.sha256_bytes(b"3"), program_id=V["program_id"])
    assert len(onchain.list_by_signer(rpc, s.pubkey(), V["program_id"])) == 2
    cert = onchain.build_certificate(a["proof_pda"], onchain.get_proof(rpc, a["proof_pda"]), a["tx_signature"], V["program_id"])
    assert cert["version"] == "notary.cert.v1" and cert["proof_pda"] == a["proof_pda"] and cert["created_at"].endswith("Z")


def test_keypair_roundtrip(tmp_path):
    k = onchain.agent_keypair("agent_a", keys_dir=tmp_path)
    assert onchain.agent_keypair("agent_a", keys_dir=tmp_path).pubkey() == k.pubkey()
    assert len(json.loads((tmp_path / "agent_a.keypair.json").read_text())) == 64  # Solana CLI biçimi


def test_standalone_cli_exit_codes(chain, tmp_path, capsys):
    import verify_standalone

    rpc, _ = chain
    f = tmp_path / "doc.bin"
    f.write_bytes(b"hello")
    out = onchain.notarize(rpc, kp(1), onchain.sha256_bytes(b"hello"), program_id=V["program_id"])
    base = [str(f), "--rpc", rpc.url, "--program", V["program_id"]]
    assert verify_standalone.main(base + ["--pda", out["proof_pda"]]) == 0
    f.write_bytes(b"hellO")
    assert verify_standalone.main(base + ["--pda", out["proof_pda"]]) == 1
    assert verify_standalone.main(base) == 2  # hash'i hiç kaydedilmemiş


def test_demo_v2_mock_passes(monkeypatch):
    import demo_v2

    monkeypatch.setattr("sys.argv", ["demo_v2.py", "--mock", "--delay", "0"])
    assert demo_v2.main() == 0


def test_golden_vectors_decode_and_encode():
    g = V["golden"]
    h = bytes.fromhex(V["document_hash"])
    parent = bytes.fromhex(V["parent_document_hash"])
    assert onchain.encode_notarize_data(h, V["receiver"], [parent]).hex() == g["notarize_data_receiver_one_parent_hex"]
    assert onchain.encode_notarize_data(h, None, []).hex() == g["notarize_data_no_receiver_no_parents_hex"]
    full = onchain.decode_proof(bytes.fromhex(g["proof_account_receiver_one_parent_hex"]))
    assert (full["receiver"], full["parents"], full["created_at"], full["created_at_iso"], full["bump"]) == (
        V["receiver"], [V["parent_document_hash"]], g["created_at_unix"], g["created_at_iso"], V["bump"])
    bare = onchain.decode_proof(bytes.fromhex(g["proof_account_no_receiver_no_parents_hex"]))
    assert (bare["receiver"], bare["parents"], bare["created_at"], bare["bump"]) == (None, [], g["created_at_unix"], V["bump"])


# ---------------------------------------------------------------- çok imzalı sözleşme (create_agreement / co_sign)
def _party_kps(n, base=0x60):
    return [Keypair.from_seed(bytes([base + i]) * 32) for i in range(n)]


def test_agreement_lifecycle_pending_then_verified(chain):
    rpc, _ = chain
    a, b, c = _party_kps(3)
    data = b"service agreement v1"
    h = onchain.sha256_bytes(data)
    out = onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey(), c.pubkey()], program_id=V["program_id"])

    ag = onchain.get_agreement(rpc, out["agreement_pda"])
    assert ag["signed_count"] == 1 and not ag["complete"]
    assert ag["parties"][0]["signer"] == str(a.pubkey()) and ag["parties"][0]["signed_at"] > 0  # oluşturan imzalı
    assert all(p["signed_at"] == 0 for p in ag["parties"][1:])
    assert ag["document_hash"] == h.hex() and ag["creator"] == str(a.pubkey())

    pending = onchain.verify(rpc, data, pda=out["agreement_pda"], program_id=V["program_id"])
    assert pending["status"] == "PENDING" and pending["agreement"]["signed_count"] == 1

    onchain.co_sign(rpc, b, out["agreement_pda"], program_id=V["program_id"])
    assert onchain.verify(rpc, data, pda=out["agreement_pda"], program_id=V["program_id"])["status"] == "PENDING"
    onchain.co_sign(rpc, c, out["agreement_pda"], program_id=V["program_id"])

    done = onchain.verify(rpc, data, pda=out["agreement_pda"], program_id=V["program_id"])
    assert done["status"] == "VERIFIED" and done["agreement"]["complete"]
    # imzalayan ve hash ile arama aynı sonucu verir
    assert onchain.verify(rpc, data, signer=a.pubkey(), program_id=V["program_id"])["status"] == "VERIFIED"
    assert onchain.verify(rpc, data, program_id=V["program_id"])["status"] == "VERIFIED"
    # değişmiş dosya
    assert onchain.verify(rpc, data + b"!", pda=out["agreement_pda"], program_id=V["program_id"])["status"] == "INVALID"


def test_agreement_rules_enforced(chain):
    rpc, _ = chain
    a, b, c, outsider = _party_kps(4)
    h = onchain.sha256_bytes(b"rules")
    pid = V["program_id"]
    with pytest.raises(onchain.ChainError):  # istemci: tek taraf
        onchain.create_agreement(rpc, a, h, [a.pubkey()], program_id=pid)
    with pytest.raises(onchain.ChainError, match="CreatorNotParty"):
        onchain.create_agreement(rpc, a, h, [b.pubkey(), c.pubkey()], program_id=pid)
    out = onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey()], program_id=pid)
    with pytest.raises(onchain.ChainError, match="already in use"):
        onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey()], program_id=pid)
    with pytest.raises(onchain.ChainError, match="NotAParty"):
        onchain.co_sign(rpc, outsider, out["agreement_pda"], program_id=pid)
    onchain.co_sign(rpc, b, out["agreement_pda"], program_id=pid)
    with pytest.raises(onchain.ChainError, match="AlreadySigned"):
        onchain.co_sign(rpc, b, out["agreement_pda"], program_id=pid)
    with pytest.raises(onchain.ChainError, match="AlreadySigned"):  # oluşturan zaten imzalı
        onchain.co_sign(rpc, a, out["agreement_pda"], program_id=pid)


def test_agreement_and_proof_share_hash_but_do_not_collide(chain):
    """Aynı hash'in hem tekil kaydı hem sözleşmesi olabilir; arama dataSize ile türleri ayırır."""
    rpc, _ = chain
    a, b = _party_kps(2)
    h = onchain.sha256_bytes(b"both")
    onchain.notarize(rpc, a, h, program_id=V["program_id"])
    onchain.create_agreement(rpc, a, h, [a.pubkey(), b.pubkey()], program_id=V["program_id"])
    assert len(onchain.find_by_hash(rpc, h, V["program_id"])) == 1
    assert len(onchain.find_agreements_by_hash(rpc, h, V["program_id"])) == 1
    assert len(onchain.list_by_signer(rpc, a.pubkey(), V["program_id"])) == 1  # sözleşme, kayıt listesine karışmaz


def test_list_agreements_for_party(chain):
    rpc, _ = chain
    a, b, c = _party_kps(3, 0x70)
    pid = V["program_id"]
    onchain.create_agreement(rpc, a, onchain.sha256_bytes(b"1"), [a.pubkey(), b.pubkey()], program_id=pid)
    onchain.create_agreement(rpc, c, onchain.sha256_bytes(b"2"), [c.pubkey(), a.pubkey(), b.pubkey()], program_id=pid)
    onchain.create_agreement(rpc, c, onchain.sha256_bytes(b"3"), [c.pubkey(), a.pubkey()], program_id=pid)
    assert len(onchain.list_agreements_for(rpc, a.pubkey(), pid)) == 3
    assert len(onchain.list_agreements_for(rpc, b.pubkey(), pid)) == 2
    mine = onchain.list_agreements_for(rpc, c.pubkey(), pid)
    assert len(mine) == 2 and all(x["creator"] == str(c.pubkey()) for x in mine)


def test_agreement_relayer_can_pay(chain):
    rpc, _ = chain
    a, b, relayer = _party_kps(3, 0x80)
    pid = V["program_id"]
    out = onchain.create_agreement(rpc, a, onchain.sha256_bytes(b"paid"), [a.pubkey(), b.pubkey()], program_id=pid, payer=relayer)
    onchain.co_sign(rpc, b, out["agreement_pda"], program_id=pid, payer=relayer)
    assert onchain.get_agreement(rpc, out["agreement_pda"])["complete"]


def test_agreement_encoding_constants():
    assert onchain.AGREEMENT_SIZE == 250 and onchain.AGREEMENT_PARTY_OFFSET == 85
    h = bytes(range(32))
    ks = [str(k.pubkey()) for k in _party_kps(2)]
    data = onchain.encode_create_agreement_data(h, ks)
    assert data[:8] == onchain.CREATE_AGREEMENT_DISC and len(data) == 8 + 32 + 4 + 64
    assert onchain.CO_SIGN_DISC != onchain.NOTARIZE_DISC

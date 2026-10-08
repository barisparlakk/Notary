# Research -> Analysis -> Decision zinciri ve provenance sorgusu (v2: parents zincirde, sahte zincire karşı).
import pytest

import chain
import onchain


@pytest.fixture
def env(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    out = chain.run_chain("Adopt notarized handoffs?", workdir=tmp_path / "chain", rpc=rpc, program_id=program,
                          keys_dir=tmp_path / "keys", log=lambda *_: None)
    return rpc, program, out, tmp_path / "chain"


def test_chain_links_proofs_on_chain(env):
    rpc, program, out, _ = env
    assert list(out["proofs"]) == ["research", "analysis", "decision"]
    m = {e["role"]: e for e in out["manifest"]}
    on_chain = {r: onchain.get_proof(rpc, out["proofs"][r]["proof_pda"]) for r in m}
    assert on_chain["research"]["parents"] == []
    assert on_chain["analysis"]["parents"] == [m["research"]["document_hash"]]
    assert on_chain["decision"]["parents"] == [m["analysis"]["document_hash"]]
    # farklı agent'lar farklı anahtarlarla imzaladı
    assert on_chain["research"]["signer"] != on_chain["analysis"]["signer"]
    assert on_chain["research"]["signer"] == on_chain["decision"]["signer"]


def test_explain_reads_lineage_from_chain(env):
    rpc, program, out, workdir = env
    rows = chain.explain(rpc, out["decision"], workdir, program)
    assert [r["role"] for r in rows] == ["research", "analysis"]  # kökler önce
    assert all(r["status"] == "VERIFIED" for r in rows)


def test_explain_works_without_local_manifest(env):
    """Yerel dosya yoksa bile ataların kendisi zincirden gelir (doğruluk kaynağı zincir)."""
    rpc, program, out, workdir = env
    (workdir / "chain.json").unlink()
    rows = chain.explain(rpc, out["decision"], workdir, program)
    assert len(rows) == 2 and all(r["status"] == "MISSING" and r["signer"] for r in rows)


def test_explain_flags_tampered_source(env):
    rpc, program, out, workdir = env
    f = workdir / out["manifest"][0]["file"]
    f.write_bytes(f.read_bytes() + b"\x00")
    status = {r["role"]: r["status"] for r in chain.explain(rpc, out["decision"], workdir, program)}
    assert status == {"research": "INVALID", "analysis": "VERIFIED"}


def test_explain_missing_file(env):
    import os
    rpc, program, out, workdir = env
    os.remove(workdir / out["manifest"][1]["file"])
    status = {r["role"]: r["status"] for r in chain.explain(rpc, out["decision"], workdir, program)}
    assert status["analysis"] == "MISSING"


def test_chain_stops_if_input_tampered(chain_rpc, tmp_path, monkeypatch):
    rpc, program = chain_rpc
    real = chain.onchain.notarize

    def tamper_after_research(rpc_, kp, h, **kw):
        out = real(rpc_, kp, h, **kw)
        pdf = tmp_path / "chain" / "01_research.pdf"
        if pdf.exists() and not kw.get("parents"):
            pdf.write_bytes(pdf.read_bytes() + b"\x00")  # kayıttan sonra bozulur
        return out

    monkeypatch.setattr(chain.onchain, "notarize", tamper_after_research)
    with pytest.raises(chain.ChainError):
        chain.run_chain("x", workdir=tmp_path / "chain", rpc=rpc, program_id=program, keys_dir=tmp_path / "keys",
                        log=lambda *_: None)


def test_explain_marks_parent_without_proof(chain_rpc, tmp_path):
    rpc, program = chain_rpc
    kp = onchain.agent_keypair("agent_a", keys_dir=tmp_path)
    onchain.ensure_funded(rpc, kp)
    ghost = onchain.sha256_bytes(b"never notarized")
    out = onchain.notarize(rpc, kp, onchain.sha256_bytes(b"child"), parents=[ghost], program_id=program)
    rows = chain.explain(rpc, out["proof_pda"], tmp_path, program)
    assert rows[0]["status"] == "NO_PROOF" and rows[0]["document_hash"] == ghost.hex()

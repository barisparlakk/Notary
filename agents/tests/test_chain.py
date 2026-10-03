# Research -> Analysis -> Decision zinciri ve provenance sorgusu (mock sunucuya karşı).
import pytest

import chain


@pytest.fixture
def env(api_url, tmp_path):
    led = chain.Ledger(tmp_path / "prov.json")
    out = chain.run_chain("Adopt notarized handoffs?", workdir=tmp_path / "chain", ledger=led,
                          api_url=api_url, keys_dir=tmp_path / "keys", log=lambda *_: None)
    return led, out, api_url


def test_chain_creates_three_linked_proofs(env):
    led, out, _ = env
    assert list(out["proofs"]) == ["research", "analysis", "decision"]
    p = {r: out["proofs"][r]["proof_id"] for r in out["proofs"]}
    assert led.get(p["research"])["depends_on"] == []
    assert led.get(p["analysis"])["depends_on"] == [p["research"]]
    assert led.get(p["decision"])["depends_on"] == [p["analysis"]]
    assert led.latest("decision") == out["decision"]


def test_explain_lists_all_sources_verified(env):
    led, out, url = env
    rows = chain.explain(out["decision"], led, api_url=url)
    assert [r["role"] for r in rows] == ["research", "analysis"]  # kökler önce
    assert all(r["status"] == "VERIFIED" for r in rows)


def test_explain_flags_tampered_source(env):
    led, out, url = env
    research = led.get(out["proofs"]["research"]["proof_id"])
    with open(research["file"], "ab") as f:
        f.write(b"\x00")
    status = {r["role"]: r["status"] for r in chain.explain(out["decision"], led, api_url=url)}
    assert status == {"research": "INVALID", "analysis": "VERIFIED"}


def test_explain_missing_file(env):
    import os
    led, out, url = env
    os.remove(led.get(out["proofs"]["analysis"]["proof_id"])["file"])
    status = {r["role"]: r["status"] for r in chain.explain(out["decision"], led, api_url=url)}
    assert status["analysis"] == "MISSING"


def test_chain_stops_if_input_tampered(api_url, tmp_path, monkeypatch):
    led = chain.Ledger(tmp_path / "prov.json")
    real_notarize = chain.client.notarize

    def tamper_after_research(pdf, sender, receiver, **kw):
        proof = real_notarize(pdf, sender, receiver, **kw)
        if pdf.name.endswith("research.pdf"):
            pdf.write_bytes(pdf.read_bytes() + b"\x00")  # notarize'dan sonra bozulur
        return proof

    monkeypatch.setattr(chain.client, "notarize", tamper_after_research)
    with pytest.raises(chain.ChainError):
        chain.run_chain("x", workdir=tmp_path / "chain", ledger=led, api_url=api_url,
                        keys_dir=tmp_path / "keys", log=lambda *_: None)
    assert len(led.data["artifacts"]) == 1  # yalnızca research kaydedildi


def test_unknown_proof_raises(tmp_path):
    with pytest.raises(chain.ChainError):
        chain.Ledger(tmp_path / "p.json").lineage("proof_yok")

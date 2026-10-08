# Zincir provenance: Research -> Analysis -> Decision. Her çıktı zincire kaydedilir ve bir öncekinin hash'ini `parents`
# olarak taşır; "bu karar hangi belgelere dayandı?" sorusu doğrudan zincirden yanıtlanır (onchain.lineage).
# Yerel `chain.json` yalnızca dosyaların nerede durduğunu gösterir (doğruluk kaynağı değil).
import json
from pathlib import Path

import llm
import onchain
from sender_agent import SHARED_DIR, write_pdf

CHAIN_DIR = SHARED_DIR / "chain"
MANIFEST = "chain.json"

# (rol, agent etiketi). Kimlik her agent'ın Solana anahtarıdır.
STAGES = [("research", "agent_a"), ("analysis", "agent_b"), ("decision", "agent_a")]


class ChainError(Exception):
    pass


STAGE_PROMPTS = {
    "research": "Write a short research note (plain text, 8-12 lines) on: {topic}.",
    "analysis": "Write a short analysis (plain text, 8-12 lines) that builds on this research:\n\n{upstream}",
    "decision": "Write a short decision memo (plain text, 8-12 lines) with a clear recommendation, based on this analysis:\n\n{upstream}",
}


def _stage_text(role, topic, upstream, based_on, llm_client):
    if llm_client:
        body = llm.complete_text(
            llm_client, "You write concise business documents in plain text. No markdown.",
            STAGE_PROMPTS[role].format(topic=topic, upstream=upstream),
        )
    else:
        body = f"{role.capitalize()}: {topic}\n" + (f"Builds on the previous {upstream.splitlines()[0]}\n" if upstream else "")
    refs = "\n".join(f"Based on notarized proof account: {p}" for p in based_on)
    return body + ("\n\n" + refs if refs else "")


def run_chain(topic, workdir=CHAIN_DIR, use_llm=False, rpc=None, program_id=None, keys_dir=None, funder=None, log=print):
    """Üç aşamalı zinciri çalıştırır. Her aşama, bir önceki dosyayı zincirden VERIFIED görmeden başlamaz.
    -> {"decision": proof_pda, "proofs": {rol: proof}, "manifest": [...]}"""
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    rpc = rpc or onchain.Rpc()
    program_id = program_id or onchain.PROGRAM_ID
    kd = {"keys_dir": keys_dir} if keys_dir is not None else {}
    llm_client = llm.get_client() if use_llm else None

    keys = {}
    for _, agent in STAGES:
        if agent not in keys:
            keys[agent] = onchain.agent_keypair(agent, **kd)
            onchain.ensure_funded(rpc, keys[agent], funder)

    manifest, proofs, prev = [], {}, None
    for i, (role, agent) in enumerate(STAGES, 1):
        based_on = []
        upstream_text = ""
        if prev:
            res = onchain.verify(rpc, (workdir / prev["file"]).read_bytes(), pda=prev["proof_pda"], program_id=program_id)
            if res["status"] != "VERIFIED":
                raise ChainError(f"{agent}: '{prev['role']}' girdisi zincirde doğrulanamadı ({res['status']}), zincir durduruldu")
            log(f"[{agent}] girdi zincirden doğrulandı ({prev['role']}: VERIFIED)")
            based_on = [prev["proof_pda"]]
            upstream_text = (workdir / prev["file"]).with_suffix(".txt").read_text()
        text = _stage_text(role, topic, upstream_text, based_on, llm_client)
        pdf = write_pdf(text, workdir / f"{i:02d}_{role}.pdf")
        pdf.with_suffix(".txt").write_text(text)
        h = onchain.sha256_bytes(pdf.read_bytes())
        parents = [bytes.fromhex(prev["document_hash"])] if prev else []
        proof = onchain.notarize(rpc, keys[agent], h, parents=parents, program_id=program_id)
        log(f"[{agent}] {role} zincire kaydedildi: {proof['proof_pda']}")
        entry = {"role": role, "agent": agent, "file": pdf.name, "proof_pda": proof["proof_pda"], "document_hash": h.hex()}
        manifest.append(entry)
        proofs[role] = proof
        prev = entry
    (workdir / MANIFEST).write_text(json.dumps(manifest, indent=2))
    return {"decision": proofs["decision"]["proof_pda"], "proofs": proofs, "manifest": manifest}


def explain(rpc, proof_pda, workdir=CHAIN_DIR, program_id=None, check_files=True):
    """'Bu karar hangi dosyalara dayandı?' Atalar zincirden okunur (kökler önce). Dosya bütünlüğü için yerel dosya, zincirdeki
    hash ile karşılaştırılır. Her kayıt: lineage alanları + rol + "status" (VERIFIED / INVALID / MISSING / NO_PROOF / UNCHECKED)."""
    workdir = Path(workdir)
    program_id = program_id or onchain.PROGRAM_ID
    manifest = json.loads((workdir / MANIFEST).read_text()) if (workdir / MANIFEST).exists() else []
    by_hash = {m["document_hash"]: m for m in manifest}
    rows = []
    for node in onchain.lineage(rpc, proof_pda, program_id):
        row = dict(node)
        loc = by_hash.get(node["document_hash"])
        row["role"] = loc["role"] if loc else "?"
        if node.get("missing"):
            row["status"] = "NO_PROOF"
        elif not check_files:
            row["status"] = "UNCHECKED"
        elif not loc or not (workdir / loc["file"]).is_file():
            row["status"] = "MISSING"
        else:
            now = onchain.sha256_bytes((workdir / loc["file"]).read_bytes()).hex()
            row["status"] = "VERIFIED" if now == node["document_hash"] else "INVALID"
        rows.append(row)
    return rows


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--topic", default="Should we adopt notarized agent handoffs?")
    r.add_argument("--llm", action="store_true")
    r.add_argument("--funder", default=None)
    w = sub.add_parser("why", help="Bir karar hangi dosyalara dayandı?")
    w.add_argument("proof_pda", nargs="?", help="boşsa son çalıştırmanın decision'ı")
    a = ap.parse_args()
    if a.cmd == "run":
        out = run_chain(a.topic, use_llm=a.llm, funder=onchain.load_keypair(a.funder) if a.funder else None)
        print("decision:", out["decision"])
    else:
        pda = a.proof_pda or json.loads((CHAIN_DIR / MANIFEST).read_text())[-1]["proof_pda"]
        for row in explain(onchain.Rpc(), pda):
            print(f"{row['status']:9} {row['role']:9} {row['document_hash'][:16]}  {row.get('proof_pda')}")

# Zincir provenance: Research -> Analysis -> Decision. Her çıktı notarize edilir; bağımlılıklar yerel
# bir ledger'da (provenance.json) tutulur. "Bu karar hangi dosyalara dayandı?" sorgusu: explain().
# Agent ID'leri sözleşmeye göre agent_a / agent_b; rol (research/analysis/decision) ledger'da saklanır.
import json
from pathlib import Path

import client
import llm
from sender_agent import SHARED_DIR, write_pdf

LEDGER_PATH = Path(__file__).parent / "provenance.json"
CHAIN_DIR = SHARED_DIR / "chain"

# (rol, gönderen, alıcı)
STAGES = [("research", "agent_a", "agent_b"), ("analysis", "agent_b", "agent_a"), ("decision", "agent_a", "agent_b")]


class ChainError(Exception):
    pass


class Ledger:
    def __init__(self, path=LEDGER_PATH):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {"artifacts": {}}

    def add(self, proof, file_path, role, depends_on=(), text=""):
        self.data["artifacts"][proof["proof_id"]] = {
            "proof_id": proof["proof_id"],
            "role": role,
            "file": str(Path(file_path).resolve()),
            "document_hash": proof["document_hash"],
            "sender": proof["sender"],
            "receiver": proof["receiver"],
            "tx_signature": proof["tx_signature"],
            "explorer_url": proof["explorer_url"],
            "timestamp": proof["timestamp"],
            "depends_on": list(depends_on),
            "text": text,
        }
        self.path.write_text(json.dumps(self.data, indent=2))

    def get(self, proof_id):
        try:
            return self.data["artifacts"][proof_id]
        except KeyError:
            raise ChainError(f"'{proof_id}' ledger'da yok") from None

    def latest(self, role):
        found = [a for a in self.data["artifacts"].values() if a["role"] == role]
        if not found:
            raise ChainError(f"ledger'da '{role}' kaydı yok")
        return found[-1]["proof_id"]  # ledger ekleme sırasını korur

    def lineage(self, proof_id):
        """proof_id'nin dayandığı tüm atalar (kökler önce, tekrarsız). proof_id'nin kendisi dahil değil."""
        order, seen = [], set()

        def visit(pid):
            for dep in self.get(pid)["depends_on"]:
                if dep not in seen:
                    seen.add(dep)
                    visit(dep)
                    order.append(dep)

        visit(proof_id)
        return order


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
    refs = "\n".join(f"Based on notarized proof: {p}" for p in based_on)
    return body + ("\n\n" + refs if refs else "")


def run_chain(topic, workdir=CHAIN_DIR, ledger=None, use_llm=False, api_url=None, keys_dir=None, log=print):
    """Üç aşamalı zinciri çalıştırır. Her aşama, bir önceki dosyayı VERIFIED görmeden başlamaz.
    -> {"decision": proof_id, "proofs": {rol: proof}}"""
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    ledger = ledger or Ledger()
    kw = {"api_url": api_url}
    if keys_dir is not None:
        kw["keys_dir"] = keys_dir
    llm_client = llm.get_client() if use_llm else None
    for agent in ("agent_a", "agent_b"):
        client.ensure_agent(agent, **kw)

    proofs, prev = {}, None
    for i, (role, sender, receiver) in enumerate(STAGES, 1):
        based_on = []
        if prev:
            prev_entry = ledger.get(prev["proof_id"])
            res = client.verify(prev_entry["file"], prev["proof_id"], api_url=api_url)
            if res["status"] != "VERIFIED":
                raise ChainError(f"{sender}: '{prev_entry['role']}' girdisi doğrulanamadı, zincir durduruldu")
            log(f"[{sender}] girdi doğrulandı ({prev_entry['role']}: VERIFIED)")
            based_on = [prev["proof_id"]]
        text = _stage_text(role, topic, prev_entry["text"] if prev else "", based_on, llm_client)
        pdf = write_pdf(text, workdir / f"{i:02d}_{role}.pdf")
        proof = client.notarize(pdf, sender, receiver, **kw)
        ledger.add(proof, pdf, role, depends_on=based_on, text=text)
        log(f"[{sender}] {role} notarize edildi: {proof['proof_id']}")
        proofs[role] = proof
        prev = proof
    return {"decision": proofs["decision"]["proof_id"], "proofs": proofs}


def explain(proof_id, ledger=None, api_url=None, check_files=True):
    """'Bu karar hangi dosyalara dayandı?' -> atalar listesi (kökler önce), her biri için dosya bütünlüğü.
    Her kayıt: ledger alanları + "status" (VERIFIED/INVALID/MISSING/UNCHECKED)."""
    ledger = ledger or Ledger()
    rows = []
    for pid in ledger.lineage(proof_id):
        entry = dict(ledger.get(pid))
        if not check_files:
            entry["status"] = "UNCHECKED"
        elif not Path(entry["file"]).is_file():
            entry["status"] = "MISSING"
        else:
            entry["status"] = client.verify(entry["file"], pid, api_url=api_url)["status"]
        rows.append(entry)
    return rows


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--topic", default="Should we adopt notarized agent handoffs?")
    r.add_argument("--llm", action="store_true")
    w = sub.add_parser("why", help="Bir karar hangi dosyalara dayandı?")
    w.add_argument("proof_id", nargs="?", help="boşsa son 'decision'")
    a = ap.parse_args()
    if a.cmd == "run":
        out = run_chain(a.topic, use_llm=a.llm)
        print("decision:", out["decision"])
    else:
        led = Ledger()
        pid = a.proof_id or led.latest("decision")
        for row in explain(pid, led):
            print(f"{row['status']:9} {row['role']:9} {row['proof_id']}  {row['file']}")

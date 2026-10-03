# Gönderen agent (agent_a): rapor PDF'i üretir, notarize eder, dosya + proof_id'yi ortak klasöre bırakır.
import json
from pathlib import Path

import client
import llm

SHARED_DIR = Path(__file__).parent / "shared"
SENDER_ID = "agent_a"
RECEIVER_ID = "agent_b"
HANDOFF_NAME = "handoff.json"

FALLBACK_REPORT = (
    "Quarterly Integrity Report\n\n"
    "This report documents the verified state of the delivery pipeline.\n"
    "All artifacts exchanged between agents are hashed with SHA-256,\n"
    "signed with ed25519 and anchored on Solana devnet.\n"
)

NOTARIZE_TOOL = {
    "name": "notarize",
    "description": "Notarize a file from the outbox: hashes it, signs it as the sender and records the proof. "
                   "Returns proof_id, document_hash, tx_signature and explorer_url.",
    "input_schema": {
        "type": "object",
        "properties": {"file_name": {"type": "string", "description": "File name inside the outbox directory"}},
        "required": ["file_name"],
    },
}


def write_pdf(text, path):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=A4)
    y = 800
    for line in text.splitlines():
        c.drawString(50, y, line[:100])
        y -= 16
        if y < 50:
            c.showPage()
            y = 800
    c.save()
    return path


def generate_report_text(topic, llm_client=None):
    if llm_client is None:
        return FALLBACK_REPORT if not topic else f"{topic}\n\n{FALLBACK_REPORT}"
    return llm.complete_text(
        llm_client,
        "You write concise, factual one-page business reports in plain text. No markdown.",
        f"Write a short report about: {topic or 'delivery pipeline integrity'}",
    )


def run(topic="", receiver=RECEIVER_ID, outbox=SHARED_DIR, use_llm=False, api_url=None, keys_dir=None, log=print):
    """Raporu üretir, notarize eder, handoff.json yazar. -> {"file", "proof", "handoff"}"""
    outbox = Path(outbox)
    kw = {"api_url": api_url}
    if keys_dir is not None:
        kw["keys_dir"] = keys_dir
    llm_client = llm.get_client() if use_llm else None

    client.ensure_agent(SENDER_ID, **kw)
    log(f"[{SENDER_ID}] anahtar hazır ve backend'e kayıtlı")

    text = generate_report_text(topic, llm_client)
    pdf = write_pdf(text, outbox / "report.pdf")
    log(f"[{SENDER_ID}] {pdf.name} üretildi ({pdf.stat().st_size} byte)")

    def notarize_tool(file_name):
        target = (outbox / file_name).resolve()
        if target.parent != outbox.resolve() or not target.is_file():
            raise ValueError("file_name outbox içinde olmalı")
        return client.notarize(target, SENDER_ID, receiver, **kw)

    if llm_client is None:
        proof = notarize_tool(pdf.name)
    else:
        _, calls = llm.run_tool_loop(
            llm_client,
            f"You are {SENDER_ID}. Notarize the finished report with the notarize tool, then confirm briefly.",
            f"The report is saved as {pdf.name}. Notarize it.",
            [NOTARIZE_TOOL],
            {"notarize": notarize_tool},
        )
        ok = [c for c in calls if c["name"] == "notarize" and "proof_id" in c["output"]]
        if not ok:
            raise RuntimeError("LLM notarize tool'unu başarıyla çağırmadı")
        proof = ok[-1]["output"]
    log(f"[{SENDER_ID}] notarize edildi: {proof['proof_id']}")

    handoff = {"file": pdf.name, "proof_id": proof["proof_id"], "sender": SENDER_ID, "receiver": receiver}
    (outbox / HANDOFF_NAME).write_text(json.dumps(handoff, indent=2))
    return {"file": pdf, "proof": proof, "handoff": handoff}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="")
    ap.add_argument("--llm", action="store_true", help="Anthropic LLM kullan (ANTHROPIC_API_KEY gerekir)")
    a = ap.parse_args()
    run(a.topic, use_llm=a.llm)

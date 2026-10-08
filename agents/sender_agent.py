# Gönderen agent (agent_a): rapor PDF'i üretir, hash'ini zincire (PDA) kaydeder, dosya + sertifikayı ortak klasöre bırakır.
# Kimlik = agent'ın Solana anahtarı; "agent_a" yalnızca etiket. Backend gerekmez.
import json
from pathlib import Path

import llm
import onchain

SHARED_DIR = Path(__file__).parent / "shared"
SENDER_ID = "agent_a"
RECEIVER_ID = "agent_b"
HANDOFF_NAME = "handoff.json"

FALLBACK_REPORT = (
    "Quarterly Integrity Report\n\n"
    "This report documents the verified state of the delivery pipeline.\n"
    "Every artifact exchanged between agents is hashed with SHA-256 and anchored\n"
    "in a program-derived account on Solana.\n"
)

NOTARIZE_TOOL = {
    "name": "notarize",
    "description": "Anchor a file from the outbox on Solana as the sender. The file is hashed and a proof account (PDA) "
                   "is created. Returns proof_pda, tx_signature and document_hash.",
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


def run(topic="", receiver=None, outbox=SHARED_DIR, use_llm=False, rpc=None, program_id=None,
        keys_dir=None, funder=None, log=print):
    """Raporu üretir, zincire kaydeder, handoff.json + certificate.json yazar.
    receiver: alıcının public key'i (opsiyonel). -> {"file", "proof", "handoff", "certificate"}"""
    outbox = Path(outbox)
    rpc = rpc or onchain.Rpc()
    program_id = program_id or onchain.PROGRAM_ID
    kd = {"keys_dir": keys_dir} if keys_dir is not None else {}
    llm_client = llm.get_client() if use_llm else None

    kp = onchain.agent_keypair(SENDER_ID, **kd)
    onchain.ensure_funded(rpc, kp, funder)
    log(f"[{SENDER_ID}] kimlik: {kp.pubkey()}")

    text = generate_report_text(topic, llm_client)
    pdf = write_pdf(text, outbox / "report.pdf")
    log(f"[{SENDER_ID}] {pdf.name} üretildi ({pdf.stat().st_size} byte)")

    def notarize_tool(file_name):
        target = (outbox / file_name).resolve()
        if target.parent != outbox.resolve() or not target.is_file():
            raise ValueError("file_name outbox içinde olmalı")
        return onchain.notarize(rpc, kp, onchain.sha256_bytes(target.read_bytes()), receiver=receiver, program_id=program_id)

    if llm_client is None:
        proof = notarize_tool(pdf.name)
    else:
        _, calls = llm.run_tool_loop(
            llm_client,
            f"You are {SENDER_ID}. Anchor the finished report with the notarize tool, then confirm briefly.",
            f"The report is saved as {pdf.name}. Anchor it.",
            [NOTARIZE_TOOL],
            {"notarize": notarize_tool},
        )
        ok = [c for c in calls if c["name"] == "notarize" and "proof_pda" in c["output"]]
        if not ok:
            raise RuntimeError("LLM notarize tool'unu başarıyla çağırmadı")
        proof = ok[-1]["output"]
    log(f"[{SENDER_ID}] zincire kaydedildi: {proof['proof_pda']}")

    certificate = onchain.build_certificate(proof["proof_pda"], onchain.get_proof(rpc, proof["proof_pda"]),
                                            proof["tx_signature"], program_id)
    handoff = {"file": pdf.name, "proof_pda": proof["proof_pda"], "signer": proof["signer"],
               "receiver": str(receiver) if receiver else None, "tx_signature": proof["tx_signature"]}
    (outbox / HANDOFF_NAME).write_text(json.dumps(handoff, indent=2))
    (outbox / "certificate.json").write_text(json.dumps(certificate, indent=2))
    return {"file": pdf, "proof": proof, "handoff": handoff, "certificate": certificate}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="")
    ap.add_argument("--llm", action="store_true", help="LLM function calling kullan (varsayılan: yerel Ollama; bkz. llm.py)")
    ap.add_argument("--funder", default=None, help="fon cüzdanı (Solana CLI JSON)")
    a = ap.parse_args()
    run(a.topic, use_llm=a.llm, funder=onchain.load_keypair(a.funder) if a.funder else None)

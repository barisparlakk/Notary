# Alıcı agent (agent_b): ortak klasörden dosya + PDA'yı alır ve doğrulamayı zincirden okur (API'siz).
import json
from pathlib import Path

import llm
import onchain
from sender_agent import HANDOFF_NAME, SHARED_DIR

RECEIVER_ID = "agent_b"

VERIFY_TOOL = {
    "name": "verify",
    "description": "Verify a received file against its proof account (PDA) on Solana. Returns status VERIFIED, INVALID or "
                   "NOT_FOUND, plus original_hash and received_hash.",
    "input_schema": {
        "type": "object",
        "properties": {
            "file_name": {"type": "string", "description": "File name inside the inbox directory"},
            "proof_pda": {"type": "string"},
        },
        "required": ["file_name", "proof_pda"],
    },
}


def receive(file_path, proof_pda, use_llm=False, rpc=None, program_id=None, log=print):
    """Doğrulama sonucunu döndürür ({status, original_hash, received_hash, proof_pda, proof}).
    LLM modunda yanıta 'summary' eklenir."""
    file_path = Path(file_path)
    rpc = rpc or onchain.Rpc()
    program_id = program_id or onchain.PROGRAM_ID

    def verify_tool(file_name, proof_pda):
        target = (file_path.parent / file_name).resolve()
        if target.parent != file_path.parent.resolve() or not target.is_file():
            raise ValueError("file_name inbox içinde olmalı")
        return onchain.verify(rpc, target.read_bytes(), pda=proof_pda, program_id=program_id)

    if not use_llm:
        result = verify_tool(file_path.name, proof_pda)
        log(f"[{RECEIVER_ID}] {file_path.name}: {result['status']}")
        return result

    summary, calls = llm.run_tool_loop(
        llm.get_client(),
        f"You are {RECEIVER_ID}. Always verify the received file with the verify tool and report the "
        "status (VERIFIED, INVALID or NOT_FOUND) in one sentence. Never claim a status the tool did not return.",
        f"I received {file_path.name} with proof account {proof_pda}. Is it authentic?",
        [VERIFY_TOOL],
        {"verify": verify_tool},
    )
    ok = [c for c in calls if c["name"] == "verify" and "status" in c["output"]]
    if not ok:
        raise RuntimeError("LLM verify tool'unu başarıyla çağırmadı")
    result = dict(ok[-1]["output"])
    result["summary"] = summary
    log(f"[{RECEIVER_ID}] {file_path.name}: {result['status']}")
    return result


def receive_from_inbox(inbox=SHARED_DIR, use_llm=False, rpc=None, program_id=None, log=print):
    inbox = Path(inbox)
    handoff = json.loads((inbox / HANDOFF_NAME).read_text())
    return receive(inbox / handoff["file"], handoff["proof_pda"], use_llm=use_llm, rpc=rpc, program_id=program_id, log=log)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true")
    a = ap.parse_args()
    print(receive_from_inbox(use_llm=a.llm))

# Backend hazır olmadan test için sahte sunucu (CONTRACT.md'ye uygun, bellekte çalışır).
# Çalıştır: uvicorn mock_server:app --port 8000   (agents/ klasöründen)
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import crypto

app = FastAPI(title="Notary Mock")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

AGENTS: dict[str, str] = {}
PROOFS: dict[str, dict] = {}


class RegisterBody(BaseModel):
    agent_id: str
    public_key: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/agents/register", status_code=201)
async def register(body: RegisterBody):
    AGENTS[body.agent_id] = body.public_key
    return {"agent_id": body.agent_id, "public_key": body.public_key}


@app.post("/notarize", status_code=201)
async def notarize(
    file: UploadFile = File(...),
    sender: str = Form(...),
    receiver: str = Form(...),
    timestamp: str = Form(...),
    signature: str = Form(...),
):
    document_hash = crypto.sha256_hex(await file.read())
    if sender not in AGENTS:
        raise HTTPException(400, f"agent '{sender}' kayıtlı değil")
    message = crypto.build_message(document_hash, sender, receiver, timestamp)
    if not crypto.verify_signature(AGENTS[sender], message, signature):
        raise HTTPException(400, "imza doğrulama başarısız")

    tx_signature = "MOCK" + uuid.uuid4().hex + uuid.uuid4().hex[:44]
    proof = {
        "proof_id": f"proof_{uuid.uuid4().hex}",
        "document_hash": document_hash,
        "sender": sender,
        "receiver": receiver,
        "timestamp": timestamp,
        "signature": signature,
        "tx_signature": tx_signature,
        "explorer_url": f"https://explorer.solana.com/tx/{tx_signature}?cluster=devnet",
    }
    PROOFS[proof["proof_id"]] = proof
    return proof


@app.post("/verify")
async def verify(file: UploadFile = File(...), proof_id: str = Form(...)):
    received_hash = crypto.sha256_hex(await file.read())
    proof = PROOFS.get(proof_id)
    if proof is None:
        return {"status": "INVALID", "original_hash": "", "received_hash": received_hash, "proof": None}
    ok = received_hash == proof["document_hash"]
    return {
        "status": "VERIFIED" if ok else "INVALID",
        "original_hash": proof["document_hash"],
        "received_hash": received_hash,
        "proof": proof,
    }


@app.get("/proofs/{proof_id}")
async def get_proof(proof_id: str):
    if proof_id not in PROOFS:
        raise HTTPException(404, f"'{proof_id}' bulunamadı")
    return PROOFS[proof_id]

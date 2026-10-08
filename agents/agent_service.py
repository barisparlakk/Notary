# n8n (ve herhangi bir HTTP istemcisi) için ince servis: agent anahtarları BU sunucuda kalır, istemci yalnızca dosya gönderir.
#   AGENT_SERVICE_TOKEN=<gizli> PROGRAM_ID=<id> SOLANA_RPC_URL=<rpc> uvicorn agent_service:app --port 8800
# Her istek `X-API-Key` başlığında AGENT_SERVICE_TOKEN'ı taşımalıdır. Token tanımlı değilse servis 503 döner.
# Agent cüzdanlarına SOL: AGENT_FUNDER_KEYPAIR (Solana CLI JSON) verilirse bakiye düşünce oradan aktarılır.
import hmac
import os
import re
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

import onchain

MAX_BYTES = 25 * 1024 * 1024
AGENT_ID = re.compile(r"^[a-z0-9_-]{1,32}$")  # anahtar dosya adında kullanılır: yol gezintisini engeller
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def create_app(rpc=None, program_id=None, keys_dir=None, funder=None, token=None):
    app = FastAPI(title="Notary agent service", description="agents/onchain.py üzerinde ince HTTP katmanı (n8n için)")
    state = {
        "rpc": rpc or onchain.Rpc(),
        "program": program_id or onchain.PROGRAM_ID,
        "keys_dir": Path(keys_dir) if keys_dir else onchain.KEYS_DIR,
        "funder": funder or (onchain.load_keypair(os.environ["AGENT_FUNDER_KEYPAIR"]) if os.environ.get("AGENT_FUNDER_KEYPAIR") else None),
        "token": token if token is not None else os.environ.get("AGENT_SERVICE_TOKEN", ""),
    }

    def auth(x_api_key: str = Header(default="")):
        if not state["token"]:
            raise HTTPException(503, "AGENT_SERVICE_TOKEN is not configured")
        if not hmac.compare_digest(x_api_key.encode(), state["token"].encode()):
            raise HTTPException(401, "invalid API key")

    def keypair(agent: str):
        if not AGENT_ID.match(agent):
            raise HTTPException(400, "agent must match [a-z0-9_-]{1,32}")
        kp = onchain.agent_keypair(agent, keys_dir=state["keys_dir"])
        try:
            onchain.ensure_funded(state["rpc"], kp, state["funder"])
        except onchain.ChainError as exc:
            raise HTTPException(502, f"could not fund the agent wallet: {exc}") from exc
        return kp

    def program():
        if not state["program"]:
            raise HTTPException(503, "PROGRAM_ID is not configured")
        return state["program"]

    async def read(file: UploadFile) -> bytes:
        data = await file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "file too large (25 MB max)")
        if not data:
            raise HTTPException(400, "empty file")
        return data

    def chain_call(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except onchain.ChainError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/health")
    async def health():
        return {"status": "ok", "program_id": state["program"] or None, "configured": bool(state["token"])}

    @app.post("/agent/notarize", dependencies=[Depends(auth)])
    async def notarize(file: UploadFile = File(...), agent: str = Form("agent_a"), receiver: str = Form(""), parents: str = Form("")):
        data = await read(file)
        parent_list = [p.strip().lower() for p in parents.split(",") if p.strip()]
        if any(not HEX64.match(p) for p in parent_list):
            raise HTTPException(400, "parents must be comma-separated SHA-256 hex digests")
        kp = keypair(agent)
        h = onchain.sha256_bytes(data)
        out = chain_call(onchain.notarize, state["rpc"], kp, h, receiver=receiver or None,
                         parents=[bytes.fromhex(p) for p in parent_list], program_id=program())
        proof = onchain.get_proof(state["rpc"], out["proof_pda"])
        out["certificate"] = onchain.build_certificate(out["proof_pda"], proof, out["tx_signature"], program())
        return out

    @app.post("/agent/verify", dependencies=[Depends(auth)])
    async def verify(file: UploadFile = File(...), proof_pda: str = Form(""), signer: str = Form("")):
        data = await read(file)
        return chain_call(onchain.verify, state["rpc"], data, pda=proof_pda or None, signer=signer or None, program_id=program())

    @app.post("/agent/agreement", dependencies=[Depends(auth)])
    async def create_agreement(file: UploadFile = File(...), agent: str = Form("agent_a"), parties: str = Form("self")):
        """parties: virgülle ayrılmış public key'ler; `self` agent'ın kendi adresi (oluşturan taraf listede olmalı)."""
        data = await read(file)
        kp = keypair(agent)
        keys = [str(kp.pubkey()) if p.strip() == "self" else p.strip() for p in parties.split(",") if p.strip()]
        if str(kp.pubkey()) not in keys:
            keys.insert(0, str(kp.pubkey()))
        return chain_call(onchain.create_agreement, state["rpc"], kp, onchain.sha256_bytes(data), keys, program_id=program())

    @app.post("/agent/agreement/sign", dependencies=[Depends(auth)])
    async def sign_agreement(agreement_pda: str = Form(...), agent: str = Form("agent_b")):
        return chain_call(onchain.co_sign, state["rpc"], keypair(agent), agreement_pda, program_id=program())

    @app.get("/agent/agreement/{agreement_pda}", dependencies=[Depends(auth)])
    async def agreement_status(agreement_pda: str):
        found = chain_call(onchain.get_agreement, state["rpc"], agreement_pda)
        if found is None:
            raise HTTPException(404, "agreement not found")
        return found

    return app


app = create_app()

"""
v2 relayer (CONTRACT.md v2, Bölüm 7): kullanıcının SOL'ü olmasa da `notarize` işlemini gönderir.

Güvenlik: kayıt doğruluk kaynağı DEĞİLDİR; yalnızca ücreti öder. Bu yüzden yalnızca şu işlemleri imzalar:
  - tek talimat, hedef program = PROGRAM_ID, talimat = notarize
  - ücret ödeyen (fee payer) = relayer, `signer` = relayer DEĞİL (aksi halde relayer adına sahte kayıt atılırdı)
  - `signer`'ın imzası geçerli
Hız sınırı IP başına dakikada RELAY_RATE_LIMIT (varsayılan 10).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction

from .solana_client import DEVNET_RPC, get_or_create_keypair

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/relay", tags=["relay"])

NOTARIZE_DISC = hashlib.sha256(b"global:notarize").digest()[:8]
MAX_DATA_LEN = 8 + 32 + 33 + 4 + 32 * 4  # discriminator + hash + Some(receiver) + vec len + 4 parent
CLUSTER = os.getenv("SOLANA_CLUSTER", "devnet")

_hits: dict[str, deque] = defaultdict(deque)


def program_id() -> str:
    return os.getenv("PROGRAM_ID", "")


def _rate_limit(client: str) -> None:
    limit = int(os.getenv("RELAY_RATE_LIMIT", "10"))
    now = time.time()
    q = _hits[client]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Too many relay requests; try again in a minute.")
    q.append(now)


async def _rpc(method: str, params: list):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(DEVNET_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    body = resp.json()
    if "error" in body:
        raise RuntimeError(body["error"].get("message", str(body["error"])))
    return body["result"]


class RelayRequest(BaseModel):
    tx_base64: str


class RelayResponse(BaseModel):
    tx_signature: str
    proof_pda: str
    explorer_url: str


def _validate(tx: Transaction, relayer: Pubkey, prog: Pubkey) -> Pubkey:
    """Kuralları denetler; kayıt edilecek proof PDA'sını döner."""
    msg = tx.message
    keys = list(msg.account_keys)
    if keys[0] != relayer:
        raise HTTPException(400, "Fee payer must be the relayer (see GET /relay/info).")
    if msg.header.num_required_signatures != 2 or len(msg.instructions) != 1:
        raise HTTPException(400, "Expected exactly one notarize instruction signed by the signer and the relayer.")
    ix = msg.instructions[0]
    if keys[ix.program_id_index] != prog:
        raise HTTPException(400, "Instruction does not target the Notary program.")
    data = bytes(ix.data)
    if data[:8] != NOTARIZE_DISC or len(data) > MAX_DATA_LEN:
        raise HTTPException(400, "Only the notarize instruction is relayed.")
    accounts = [keys[i] for i in ix.accounts]
    if len(accounts) != 4:
        raise HTTPException(400, "notarize takes 4 accounts.")
    signer, payer, proof, system = accounts
    if payer != relayer:
        raise HTTPException(400, "Payer account must be the relayer.")
    if signer == relayer:
        raise HTTPException(400, "Signer must be your own wallet, not the relayer.")
    if system != SYSTEM_PROGRAM_ID:
        raise HTTPException(400, "System program account mismatch.")
    if signer not in keys[: msg.header.num_required_signatures]:
        raise HTTPException(400, "Signer must sign the transaction.")
    return proof


@router.get("/info", summary="Relayer adresi ve program")
async def relay_info() -> dict:
    return {
        "enabled": bool(program_id()),
        "program_id": program_id() or None,
        "relayer_pubkey": str(get_or_create_keypair().pubkey()),
        "cluster": CLUSTER,
    }


@router.post("", response_model=RelayResponse, summary="Kısmen imzalı notarize işlemini gönder")
async def relay(req: RelayRequest, request: Request) -> RelayResponse:
    if not program_id():
        raise HTTPException(503, "Relay disabled: PROGRAM_ID is not configured.")
    _rate_limit(request.client.host if request.client else "unknown")

    try:
        tx = Transaction.from_bytes(base64.b64decode(req.tx_base64, validate=True))
    except Exception:
        raise HTTPException(400, "tx_base64 is not a valid serialized transaction.") from None

    relayer_kp = get_or_create_keypair()
    proof_pda = _validate(tx, relayer_kp.pubkey(), Pubkey.from_string(program_id()))

    tx.partial_sign([relayer_kp], tx.message.recent_blockhash)
    try:
        tx.verify()
    except Exception:
        raise HTTPException(400, "Signer signature is missing or invalid.") from None

    try:
        sig = await _rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64"}])
        for _ in range(40):  # ~20 sn
            st = (await _rpc("getSignatureStatuses", [[sig]]))["value"][0]
            if st and st.get("err"):
                raise HTTPException(409, f"Transaction failed on-chain: {st['err']}")
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                break
            await asyncio.sleep(0.5)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("relay failed: %s", exc)
        raise HTTPException(502, f"Solana RPC error: {exc}") from exc

    logger.info("relayed notarize sig=%s pda=%s", sig, proof_pda)
    return RelayResponse(
        tx_signature=sig,
        proof_pda=str(proof_pda),
        explorer_url=f"https://explorer.solana.com/address/{proof_pda}?cluster={CLUSTER}",
    )

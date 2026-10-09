"""
v2 relayer (CONTRACT.md v2, Bölüm 7): kullanıcının SOL'ü olmasa da `notarize` işlemini gönderir.

Güvenlik: kayıt doğruluk kaynağı DEĞİLDİR; yalnızca ücreti öder. Bu yüzden yalnızca şu işlemleri imzalar:
  - tek talimat, hedef program = PROGRAM_ID, talimat = notarize | create_agreement | co_sign | attest_identity | revoke_attestation | revoke_proof
  - ücret ödeyen (fee payer) = relayer, `signer` = relayer DEĞİL (aksi halde relayer adına sahte kayıt atılırdı)
  - `signer`'ın imzası geçerli
Hız sınırı IP başına dakikada RELAY_RATE_LIMIT (varsayılan 10). Vercel'de her örnek ayrı bellektir; örnekler arası
ortak sayaç için UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN verilirse sayaç Upstash'te tutulur.
Relayer bakiyesi RELAY_MIN_LAMPORTS'ın (varsayılan 0.01 SOL) altına inerse /relay 503 döner.
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
CREATE_AGREEMENT_DISC = hashlib.sha256(b"global:create_agreement").digest()[:8]
CO_SIGN_DISC = hashlib.sha256(b"global:co_sign").digest()[:8]
ATTEST_IDENTITY_DISC = hashlib.sha256(b"global:attest_identity").digest()[:8]
REVOKE_ATTESTATION_DISC = hashlib.sha256(b"global:revoke_attestation").digest()[:8]
REVOKE_PROOF_DISC = hashlib.sha256(b"global:revoke_proof").digest()[:8]
MIN_ATTEST_DATA_LEN = 8 + 32 + 4 + 1 + 32 + 8  # discriminator + subject + etiket uzunluğu + en az 1 bayt etiket + claim + expires_at
MAX_ATTEST_DATA_LEN = 8 + 32 + 4 + 32 + 32 + 8  # etiket en çok 32 bayt
MAX_DATA_LEN = 8 + 32 + 33 + 4 + 32 * 4  # discriminator + hash + Some(receiver) + vec len + 4 parent
MAX_AGREEMENT_DATA_LEN = 8 + 32 + 4 + 32 * 4  # discriminator + hash + vec len + 4 taraf
RELAYED = ("notarize", "create_agreement", "co_sign", "attest_identity", "revoke_attestation", "revoke_proof")
CLUSTER = os.getenv("SOLANA_CLUSTER", "devnet")

_hits: dict[str, deque] = defaultdict(deque)


def program_id() -> str:
    return os.getenv("PROGRAM_ID", "")


async def _shared_hit(client: str) -> int | None:
    """Upstash REST üzerinden dakikalık sayaç. Yapılandırılmamışsa ya da erişilemezse None (bellek içi sayaca düşülür)."""
    url, token = os.getenv("UPSTASH_REDIS_REST_URL"), os.getenv("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        return None
    key = f"notary:relay:{client}:{int(time.time() // 60)}"
    try:
        async with httpx.AsyncClient(timeout=3) as http:
            resp = await http.post(
                f"{url.rstrip('/')}/pipeline",
                headers={"Authorization": f"Bearer {token}"},
                json=[["INCR", key], ["EXPIRE", key, 90]],
            )
        return int(resp.json()[0]["result"])
    except Exception as exc:  # sayaç servisi çökerse relay'i kapatma, bellek içine düş
        logger.warning("shared rate limit unavailable: %s", exc)
        return None


async def _rate_limit(client: str) -> None:
    limit = int(os.getenv("RELAY_RATE_LIMIT", "10"))
    shared = await _shared_hit(client)
    if shared is not None:
        if shared > limit:
            raise HTTPException(status_code=429, detail="Too many relay requests; try again in a minute.")
        return
    now = time.time()
    q = _hits[client]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Too many relay requests; try again in a minute.")
    q.append(now)


RPC_ATTEMPTS = 5


def _rate_limited(resp: httpx.Response, body: dict | None) -> bool:
    msg = str((body or {}).get("error", {}).get("message", "")) if isinstance(body, dict) else ""
    return resp.status_code in (429, 502, 503, 504) or "too many requests" in msg.lower()


async def _rpc(method: str, params: list):
    """Solana JSON-RPC. Genel RPC'ler (api.devnet.solana.com) hızlı sorguda 429 döner: üstel geri çekilmeyle yeniden dener.
    Yalnızca hız sınırı ve geçici sunucu hatalarında yeniden denenir; talimat hataları (ör. simülasyon) hemen iletilir."""
    for attempt in range(RPC_ATTEMPTS):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(DEVNET_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        try:
            body = resp.json()
        except ValueError:
            body = None
        if _rate_limited(resp, body) and attempt < RPC_ATTEMPTS - 1:
            await asyncio.sleep(min(2**attempt, 8) * 0.5)
            continue
        if body is None:
            raise RuntimeError(f"RPC returned HTTP {resp.status_code} without JSON")
        if "error" in body:
            raise RuntimeError(body["error"].get("message", str(body["error"])))
        return body["result"]


class RelayRequest(BaseModel):
    tx_base64: str


class RelayResponse(BaseModel):
    tx_signature: str
    proof_pda: str  # geriye uyumluluk: `account` ile aynı değer
    account: str  # oluşan/etkilenen hesap (Proof ya da Agreement PDA'sı)
    kind: str  # notarize | create_agreement | co_sign | attest_identity | revoke_attestation | revoke_proof
    explorer_url: str


def _validate(tx: Transaction, relayer: Pubkey, prog: Pubkey) -> tuple[str, Pubkey]:
    """Kuralları denetler; (talimat türü, hedef hesap) döner."""
    msg = tx.message
    keys = list(msg.account_keys)
    if keys[0] != relayer:
        raise HTTPException(400, "Fee payer must be the relayer (see GET /relay/info).")
    if msg.header.num_required_signatures != 2 or len(msg.instructions) != 1:
        raise HTTPException(400, "Expected exactly one instruction signed by the signer and the relayer.")
    ix = msg.instructions[0]
    if keys[ix.program_id_index] != prog:
        raise HTTPException(400, "Instruction does not target the Notary program.")
    data = bytes(ix.data)
    accounts = [keys[i] for i in ix.accounts]
    required = keys[: msg.header.num_required_signatures]

    if data[:8] == NOTARIZE_DISC and len(data) <= MAX_DATA_LEN:
        kind = "notarize"
    elif data[:8] == CREATE_AGREEMENT_DISC and len(data) <= MAX_AGREEMENT_DATA_LEN:
        kind = "create_agreement"
    elif data[:8] == CO_SIGN_DISC and len(data) == 8:
        kind = "co_sign"
    elif data[:8] == ATTEST_IDENTITY_DISC and MIN_ATTEST_DATA_LEN <= len(data) <= MAX_ATTEST_DATA_LEN:
        kind = "attest_identity"
    elif data[:8] == REVOKE_ATTESTATION_DISC and len(data) == 8:
        kind = "revoke_attestation"
    elif data[:8] == REVOKE_PROOF_DISC and len(data) == 8:
        kind = "revoke_proof"
    else:
        raise HTTPException(400, f"Only {', '.join(RELAYED)} are relayed.")

    if kind in ("co_sign", "revoke_attestation"):  # ücret ödeyen yok: imzalayan + hedef hesap
        if len(accounts) != 2:
            raise HTTPException(400, f"{kind} takes 2 accounts.")
        signer, target = accounts
    else:  # signer, payer, ...hedefler, system_program
        want = 5 if kind == "revoke_proof" else 4
        if len(accounts) != want:
            raise HTTPException(400, f"{kind} takes {want} accounts.")
        signer, payer, system = accounts[0], accounts[1], accounts[-1]
        target = accounts[3] if kind == "revoke_proof" else accounts[2]  # revoke_proof: [signer, payer, proof, revocation, system]
        if payer != relayer:
            raise HTTPException(400, "Payer account must be the relayer.")
        if system != SYSTEM_PROGRAM_ID:
            raise HTTPException(400, "System program account mismatch.")
    if signer == relayer:
        raise HTTPException(400, "Signer must be your own wallet, not the relayer.")
    if signer not in required:
        raise HTTPException(400, "Signer must sign the transaction.")
    return kind, target


def min_lamports() -> int:
    return int(os.getenv("RELAY_MIN_LAMPORTS", "10000000"))


async def _balance(pubkey: Pubkey) -> int | None:
    try:
        return (await _rpc("getBalance", [str(pubkey), {"commitment": "confirmed"}]))["value"]
    except Exception:
        return None


@router.get("/info", summary="Relayer adresi, program ve bakiye durumu")
async def relay_info() -> dict:
    relayer = get_or_create_keypair().pubkey()
    balance = await _balance(relayer)
    low = balance is not None and balance < min_lamports()
    return {
        "enabled": bool(program_id()) and not low,
        "program_id": program_id() or None,
        "relayer_pubkey": str(relayer),
        "cluster": CLUSTER,
        "balance_lamports": balance,
        "low_balance": low,
    }


@router.post("", response_model=RelayResponse, summary="Kısmen imzalı notarize işlemini gönder")
async def relay(req: RelayRequest, request: Request) -> RelayResponse:
    if not program_id():
        raise HTTPException(503, "Relay disabled: PROGRAM_ID is not configured.")
    await _rate_limit(request.client.host if request.client else "unknown")

    try:
        tx = Transaction.from_bytes(base64.b64decode(req.tx_base64, validate=True))
    except Exception:
        raise HTTPException(400, "tx_base64 is not a valid serialized transaction.") from None

    relayer_kp = get_or_create_keypair()
    balance = await _balance(relayer_kp.pubkey())
    if balance is not None and balance < min_lamports():
        logger.error("relayer balance low: %s lamports", balance)
        raise HTTPException(503, "Relayer is out of funds; try again later.")
    kind, target = _validate(tx, relayer_kp.pubkey(), Pubkey.from_string(program_id()))

    tx.partial_sign([relayer_kp], tx.message.recent_blockhash)
    try:
        tx.verify()
    except Exception:
        raise HTTPException(400, "Signer signature is missing or invalid.") from None

    try:
        sig = await _rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64", "preflightCommitment": "confirmed"}])
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

    logger.info("relayed %s sig=%s account=%s", kind, sig, target)
    return RelayResponse(
        tx_signature=sig,
        proof_pda=str(target),
        account=str(target),
        kind=kind,
        explorer_url=f"https://explorer.solana.com/address/{target}?cluster={CLUSTER}",
    )

"""
FastAPI route'ları – CONTRACT.md endpoint sözleşmesi.

POST /agents/register
POST /notarize
POST /verify
GET  /proofs/{proof_id}

Her route:
  - Girdi doğrulama (Pydantic + elle)
  - İş mantığı (crypto, db, solana)
  - Anlamlı HTTP hata kodları (400, 404, 409, 422)
  - Loglama
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from .crypto import build_signed_message, sha256_hex, verify_ed25519
from .db import get_agent, get_proof, insert_proof, upsert_agent
from .models import AgentRecord, AgentRegisterRequest, NotarizeResponse, VerifyResponse
from .solana_client import notarize_on_chain

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# POST /agents/register
# ---------------------------------------------------------------------------


@router.post(
    "/agents/register",
    response_model=AgentRecord,
    status_code=status.HTTP_201_CREATED,
    summary="Agent kaydı",
    description="Bir AI ajanının Ed25519 açık anahtarını sisteme kaydeder ya da günceller.",
)
async def register_agent(req: AgentRegisterRequest) -> AgentRecord:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    record = AgentRecord(
        agent_id=req.agent_id,
        public_key=req.public_key,
        registered_at=now,
    )
    await upsert_agent(record)
    logger.info("Agent kaydedildi: %s", req.agent_id)
    return record


# ---------------------------------------------------------------------------
# POST /notarize
# ---------------------------------------------------------------------------


@router.post(
    "/notarize",
    response_model=NotarizeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Dosyayı noterle",
    description=(
        "Yüklenen dosyanın SHA-256 hash'ini alır, gönderici agent'ın Ed25519 imzasını "
        "doğrular ve Solana Devnet'e memo transaction kaydeder."
    ),
)
async def notarize(
    file: UploadFile = File(..., description="Noterlenecek dosya (herhangi format)"),
    sender: str = Form(..., description="Gönderici agent ID"),
    receiver: str = Form(..., description="Alıcı agent ID"),
    timestamp: str = Form(..., description="ISO 8601 UTC  örn. 2026-10-03T18:30:00Z"),
    signature: str = Form(..., description="Ed25519 Base64 imza"),
) -> NotarizeResponse:
    # ---- 1. Dosya içeriğini oku ----
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Yüklenen dosya boş.",
        )

    # ---- 2. SHA-256 hash ----
    document_hash = sha256_hex(content)

    # ---- 3. Gönderici agent'ı veritabanında ara ----
    agent = await get_agent(sender)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Gönderici agent '{sender}' kayıtlı değil. "
                "Önce POST /agents/register ile kayıt yapın."
            ),
        )

    # ---- 4. Ed25519 imza doğrulama ----
    message = build_signed_message(document_hash, sender, receiver, timestamp)
    if not verify_ed25519(agent.public_key, message, signature):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"İmza doğrulama başarısız. "
                f"Beklenen mesaj formatı: 'notary:v1|<hash>|{sender}|{receiver}|{timestamp}'"
            ),
        )

    # ---- 5. Solana Devnet memo TX ----
    try:
        tx_signature, explorer_url = await notarize_on_chain(
            document_hash, sender, receiver, timestamp
        )
    except Exception as exc:
        logger.exception("Solana TX hatası")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Solana işlemi başarısız: {exc}",
        ) from exc

    # ---- 6. Proof kaydını veritabanına yaz ----
    proof_id = f"proof_{uuid.uuid4().hex}"
    proof = NotarizeResponse(
        proof_id=proof_id,
        document_hash=document_hash,
        sender=sender,
        receiver=receiver,
        timestamp=timestamp,
        signature=signature,
        tx_signature=tx_signature,
        explorer_url=explorer_url,
    )
    await insert_proof(proof)

    logger.info(
        "Notarize tamamlandı | proof=%s hash=%s sender=%s receiver=%s",
        proof_id,
        document_hash,
        sender,
        receiver,
    )
    return proof


# ---------------------------------------------------------------------------
# POST /verify
# ---------------------------------------------------------------------------


@router.post(
    "/verify",
    response_model=VerifyResponse,
    summary="Dosya bütünlüğünü doğrula",
    description=(
        "Alınan dosyanın SHA-256 hash'ini hesaplar ve Solana'ya kaydedilmiş "
        "orijinal proof kaydıyla karşılaştırır."
    ),
)
async def verify(
    file: UploadFile = File(..., description="Doğrulanacak dosya"),
    proof_id: str = Form(..., description="Eşleştirilecek proof_id"),
) -> VerifyResponse:
    # ---- 1. Alınan dosyanın hash'i ----
    content = await file.read()
    received_hash = sha256_hex(content)

    # ---- 2. Proof'u veritabanında ara ----
    proof = await get_proof(proof_id)
    if proof is None:
        # Proof bulunamadı → INVALID döndür (HTTP 200, status="INVALID")
        logger.warning("Proof bulunamadı: %s", proof_id)
        return VerifyResponse(
            status="INVALID",
            original_hash="",
            received_hash=received_hash,
            proof=None,
            detail=f"'{proof_id}' ID'li proof noter defterinde bulunamadı.",
        )

    # ---- 3. Hash karşılaştırması ----
    is_match = received_hash == proof.document_hash
    result_status = "VERIFIED" if is_match else "INVALID"
    detail = (
        "Dosya Solana noter mührüyle tam eşleşiyor."
        if is_match
        else (
            "Dosya içeriği değiştirilmiş ya da farklı bir dosya gönderilmiş. "
            "Hash uyuşmazlığı tespit edildi."
        )
    )

    logger.info(
        "Verify | proof=%s status=%s orig=%s recv=%s",
        proof_id,
        result_status,
        proof.document_hash,
        received_hash,
    )
    return VerifyResponse(
        status=result_status,
        original_hash=proof.document_hash,
        received_hash=received_hash,
        proof=proof,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# GET /proofs/{proof_id}
# ---------------------------------------------------------------------------


@router.get(
    "/proofs/{proof_id}",
    response_model=NotarizeResponse,
    summary="Proof detayı",
    description="Belirli bir proof_id'ye ait tüm noter kaydını döner.",
)
async def get_proof_detail(proof_id: str) -> NotarizeResponse:
    proof = await get_proof(proof_id)
    if proof is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{proof_id}' bulunamadı.",
        )
    return proof

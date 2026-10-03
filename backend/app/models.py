"""
Pydantic v2 data models – CONTRACT.md sözleşmesine birebir uyumlu.

Sabitlenen formatlar:
- document_hash : SHA-256 küçük harf hex (64 karakter)
- signature     : Ed25519 Base64
- tx_signature  : Solana işlem imzası (Base58, 88 karakter)
- timestamp     : ISO 8601 UTC  örn. 2026-10-03T18:30:00Z
"""

from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Regex sabitleri
# ---------------------------------------------------------------------------
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
_ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


# ---------------------------------------------------------------------------
# Agent modelleri
# ---------------------------------------------------------------------------

class AgentRegisterRequest(BaseModel):
    """POST /agents/register isteği."""

    agent_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_\-]+$",
        description="Ajan kimliği (örn. agent_a, research_bot_01)",
        examples=["agent_a"],
    )
    public_key: str = Field(
        ...,
        description="Ed25519 açık anahtar – Base64 kodlanmış 32 bayt",
        examples=["47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="],
    )

    @field_validator("public_key")
    @classmethod
    def validate_public_key(cls, v: str) -> str:
        import base64

        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception:
            raise ValueError("public_key geçerli bir Base64 değil")
        if len(decoded) != 32:
            raise ValueError(
                f"Ed25519 açık anahtarı 32 bayt olmalı; alınan: {len(decoded)} bayt"
            )
        return v


class AgentRecord(BaseModel):
    """Veritabanından ya da kayıt yanıtından dönen agent kaydı."""

    agent_id: str
    public_key: str
    registered_at: str = Field(description="ISO 8601 UTC kayıt zamanı")


# ---------------------------------------------------------------------------
# Notarize yanıtı
# ---------------------------------------------------------------------------

class NotarizeResponse(BaseModel):
    """POST /notarize başarılı yanıtı – CONTRACT.md §Endpoint'ler."""

    proof_id: str = Field(description="UUID4 proof kimliği")
    document_hash: str = Field(description="SHA-256 küçük harf hex")
    sender: str
    receiver: str
    timestamp: str = Field(description="ISO 8601 UTC")
    signature: str = Field(description="Ed25519 Base64 imza (sender'dan)")
    tx_signature: str = Field(description="Solana işlem imzası (Base58)")
    explorer_url: str = Field(description="Solana Explorer URL")

    @field_validator("document_hash")
    @classmethod
    def validate_hash(cls, v: str) -> str:
        if not _HEX64_RE.match(v):
            raise ValueError("document_hash 64 karakterlik küçük harf hex olmalı")
        return v


# ---------------------------------------------------------------------------
# Verify yanıtı
# ---------------------------------------------------------------------------

class VerifyResponse(BaseModel):
    """POST /verify yanıtı."""

    status: Literal["VERIFIED", "INVALID"]
    original_hash: str = Field(description="Kayıtlı noter hash'i")
    received_hash: str = Field(description="Gelen dosyadan hesaplanan hash")
    proof: Optional[NotarizeResponse] = Field(
        default=None,
        description="Eşleşen proof kaydı; bulunamazsa null",
    )
    detail: Optional[str] = Field(
        default=None,
        description="İnsan okunabilir açıklama (hata veya başarı notu)",
    )

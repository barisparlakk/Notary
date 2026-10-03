"""
Asenkron SQLite veritabanı katmanı (aiosqlite).

Tablolar:
  agents  : Kayıtlı agent'lar (agent_id PK, public_key, registered_at)
  proofs  : Noterlenmiş transferler (proof_id PK + tüm sözleşme alanları)

Tüm fonksiyonlar async'tir; FastAPI'nin asyncio döngüsünde güvenle çalışır.
DB dosyası: notary.db (uygulama kök dizininde, Docker volume bağlayabilirsin)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import aiosqlite

from .models import AgentRecord, NotarizeResponse

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("DB_PATH", "notary.db")

# ---------------------------------------------------------------------------
# DDL – tablo şemaları
# ---------------------------------------------------------------------------

_DDL_AGENTS = """
CREATE TABLE IF NOT EXISTS agents (
    agent_id       TEXT PRIMARY KEY,
    public_key     TEXT NOT NULL,
    registered_at  TEXT NOT NULL
);
"""

_DDL_PROOFS = """
CREATE TABLE IF NOT EXISTS proofs (
    proof_id        TEXT PRIMARY KEY,
    document_hash   TEXT NOT NULL,
    sender          TEXT NOT NULL,
    receiver        TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    signature       TEXT NOT NULL,
    tx_signature    TEXT NOT NULL,
    explorer_url    TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


# ---------------------------------------------------------------------------
# Başlatma
# ---------------------------------------------------------------------------

async def init_db() -> None:
    """
    Veritabanı tablolarını oluşturur (zaten varsa dokunmaz).
    FastAPI lifespan içinde tek seferlik çağrılır.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(_DDL_AGENTS)
        await db.execute(_DDL_PROOFS)
        await db.commit()
    logger.info("DB hazır: %s", DB_PATH)


# ---------------------------------------------------------------------------
# Agent CRUD
# ---------------------------------------------------------------------------

async def upsert_agent(record: AgentRecord) -> AgentRecord:
    """
    Agent'ı kaydeder ya da public_key'i günceller (UPSERT).
    Aynı agent_id tekrar register edilebilir (yeni anahtar rotasyonu senaryosu).
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO agents (agent_id, public_key, registered_at)
            VALUES (?, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
                public_key    = excluded.public_key,
                registered_at = excluded.registered_at
            """,
            (record.agent_id, record.public_key, record.registered_at),
        )
        await db.commit()
    return record


async def get_agent(agent_id: str) -> Optional[AgentRecord]:
    """agent_id'ye göre agent döner; bulunamazsa None."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT agent_id, public_key, registered_at FROM agents WHERE agent_id = ?",
            (agent_id,),
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return None
    return AgentRecord(
        agent_id=row["agent_id"],
        public_key=row["public_key"],
        registered_at=row["registered_at"],
    )


# ---------------------------------------------------------------------------
# Proof CRUD
# ---------------------------------------------------------------------------

async def insert_proof(proof: NotarizeResponse) -> None:
    """Proof kaydını veritabanına yazar."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO proofs
                (proof_id, document_hash, sender, receiver,
                 timestamp, signature, tx_signature, explorer_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proof.proof_id,
                proof.document_hash,
                proof.sender,
                proof.receiver,
                proof.timestamp,
                proof.signature,
                proof.tx_signature,
                proof.explorer_url,
            ),
        )
        await db.commit()


async def get_proof(proof_id: str) -> Optional[NotarizeResponse]:
    """proof_id'ye göre proof döner; bulunamazsa None."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT proof_id, document_hash, sender, receiver,
                   timestamp, signature, tx_signature, explorer_url
            FROM proofs WHERE proof_id = ?
            """,
            (proof_id,),
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return None
    return NotarizeResponse(**dict(row))

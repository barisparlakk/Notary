"""
FastAPI uygulama giriş noktası.

Başlatma:
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Özellikler:
  - Lifespan: uygulama ayağa kalkarken DB tablolarını oluşturur
  - CORS: tüm origin'lere açık (geliştirme); production'da daraltılmalı
  - /health: frontend + agent'lar için yaşam kontrolü uç noktası
  - Yapılandırılmış JSON loglama (uvicorn access log + uygulama logu)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routes import router

# ---------------------------------------------------------------------------
# Loglama yapılandırması
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Uygulama ömrü boyunca DB init ve temizlik."""
    logger.info("Notary Backend başlıyor…")
    await init_db()
    logger.info("DB hazır. Servis talepleri alınıyor.")
    yield
    logger.info("Notary Backend kapanıyor.")


# ---------------------------------------------------------------------------
# FastAPI uygulaması
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Notary API",
    description=(
        "AI ajanları arası dijital artifact güven katmanı. "
        "Ed25519 imzalama + SHA-256 hash + Solana Devnet memo kanıtı."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # production'da frontend origin ile daralt
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

app.include_router(router)

# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


@app.get("/health", tags=["system"], summary="Servis sağlık kontrolü")
async def health() -> dict:
    """Frontend ve agent'ların backend'in ayakta olup olmadığını kontrol ettiği uç nokta."""
    return {"status": "ok"}

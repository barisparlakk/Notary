"""
FastAPI giriş noktası (CONTRACT.md v2): yardımcı servis. Doğrulama ve kayıt bu servise bağlı DEĞİLDİR; kanıt zincirdedir.

Başlatma:
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Uç noktalar:
  - GET  /health
  - GET  /relay/info, POST /relay   (ücreti relayer öder; bkz. app/relay.py)
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .relay import router as relay_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)

app = FastAPI(
    title="Notary relayer",
    description="Notary v2 yardımcı servisi: kullanıcının SOL'ü olmadan notarize/sözleşme işlemlerinin ücretini öder.",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # production'da frontend origin ile daralt
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(relay_router)


@app.get("/health", tags=["system"], summary="Servis sağlık kontrolü")
async def health() -> dict:
    return {"status": "ok"}

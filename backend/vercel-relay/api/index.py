# Vercel serverless giriş noktası: yalnızca /relay ve /health (veritabanı yok, durumsuz).
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.relay import router

app = FastAPI(title="Notary relayer")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "notary-relay"}

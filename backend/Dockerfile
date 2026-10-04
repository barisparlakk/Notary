# ==============================================================================
# Notary Backend - Production Dockerfile
# ==============================================================================
FROM python:3.11-slim as builder

# Sistem gereksinimleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bağımlılıkları kur
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ------------------------------------------------------------------------------
# Final Runtime Container
# ------------------------------------------------------------------------------
FROM python:3.11-slim as runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root servis kullanıcısı oluştur
RUN useradd -m -u 1000 -s /bin/bash notaryuser

WORKDIR /app

# Bağımlılıkları builder'dan kopyala
COPY --from=builder /install /usr/local

# Kodları kopyala
COPY . .

# Veritabanı ve anahtar dizinleri izinleri
RUN mkdir -p /app/data /app/keys && chown -R notaryuser:notaryuser /app

USER notaryuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DB_PATH=/app/data/notary.db \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

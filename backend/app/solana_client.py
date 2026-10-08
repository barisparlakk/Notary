"""
Solana yapılandırması ve relayer anahtarı (CONTRACT.md v2).

Backend artık zincire kendisi kayıt yazmaz; ücreti ödeyen cüzdan (relayer) `app/relay.py` içinde kullanılır.
Anahtar sırası: SOLANA_PRIVATE_KEY env (Base58 ya da JSON bayt dizisi) > backend/keys/solana_devnet.json > yeni üretilir.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com"
DEVNET_RPC = os.getenv("SOLANA_RPC_URL", DEFAULT_DEVNET_RPC)

_KEY_DIR = Path(__file__).parent.parent / "keys"
_KEY_FILE = _KEY_DIR / "solana_devnet.json"
_PRIVATE_KEY_ENV = "SOLANA_PRIVATE_KEY"


def get_or_create_keypair():
    """
    Solana Devnet işlem imzalayıcı anahtar çiftini döner:
      1. SOLANA_PRIVATE_KEY env (Base58 veya JSON bayt dizisi)
      2. backend/keys/solana_devnet.json dosyasından
      3. Yoksa otomatik üretip kaydeder.
    """
    from solders.keypair import Keypair  # type: ignore

    env_key = os.getenv("SOLANA_PRIVATE_KEY")
    if env_key:
        try:
            if env_key.startswith("[") and env_key.endswith("]"):
                secret_bytes = bytes(json.loads(env_key))
                return Keypair.from_bytes(secret_bytes)
            return Keypair.from_base58_string(env_key)
        except Exception as e:
            logger.warning("SOLANA_PRIVATE_KEY env okunamadı: %s", e)

    if _KEY_FILE.exists():
        try:
            with open(_KEY_FILE, "r") as f:
                data = json.load(f)
            return Keypair.from_bytes(bytes(data))
        except Exception as e:
            logger.warning("Anahtar dosyasından yüklenemedi: %s", e)

    # Yeni Devnet anahtarı oluştur ve sakla
    keypair = Keypair()
    try:
        _KEY_DIR.mkdir(parents=True, exist_ok=True)
        with open(_KEY_FILE, "w") as f:
            json.dump(list(bytes(keypair)), f)
        logger.info("Yeni Solana Devnet cüzdanı oluşturuldu: %s", keypair.pubkey())
    except Exception as e:
        logger.warning("Cüzdan diske yazılamadı: %s", e)

    return keypair


def get_wallet_pubkey() -> str:
    """Aktif Solana cüzdan açık adresini döner."""
    try:
        kp = get_or_create_keypair()
        return str(kp.pubkey())
    except Exception:
        return "NotaryDevnetNotConfigured"

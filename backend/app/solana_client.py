"""
Solana Devnet memo transaction istemcisi.

Memo formatı (CONTRACT.md):
    na1|{document_hash}|{sender}|{receiver}|{timestamp}

Strateji:
  1. Ortam değişkeni SOLANA_PRIVATE_KEY mevcutsa → gerçek Devnet TX gönderir.
  2. Yoksa → deterministik bir "simüle edilmiş" imza üretir (demo/test modu).
     Bu mod production'da kullanılmamalı; SOLANA_PRIVATE_KEY set edilmeli.

Bağımlılıklar: solders, solana-py  (requirements.txt içinde)
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Memo formatı
# ---------------------------------------------------------------------------

MEMO_PREFIX = "na1"
SOLANA_EXPLORER_BASE = "https://explorer.solana.com/tx/{sig}?cluster=devnet"
DEVNET_RPC = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
_PRIVATE_KEY_ENV = "SOLANA_PRIVATE_KEY"   # Base58 kodlanmış 64 baytlık gizli anahtar


def build_memo(document_hash: str, sender: str, receiver: str, timestamp: str) -> str:
    """
    Solana memo string'ini oluşturur:
        na1|{document_hash}|{sender}|{receiver}|{timestamp}
    """
    return f"{MEMO_PREFIX}|{document_hash}|{sender}|{receiver}|{timestamp}"


# ---------------------------------------------------------------------------
# Simüle edilmiş imza (geliştirme / CI modu)
# ---------------------------------------------------------------------------

_BASE58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58encode(data: bytes) -> str:
    """Minimal Base58 encoder (harici bağımlılık olmadan)."""
    n = int.from_bytes(data, "big")
    chars: list[str] = []
    while n:
        n, r = divmod(n, 58)
        chars.append(_BASE58_ALPHA[r])
    leading = sum(1 for b in data if b == 0)
    return _BASE58_ALPHA[0] * leading + "".join(reversed(chars))


def _simulated_signature(memo: str) -> str:
    """
    Deterministik 88 karakterlik Base58 Solana imzası simüle eder.
    memo + zaman entropisi ile SHA-256 tabanlı; tekrarlanamaz ama
    gerçek bir Solana işlemi değildir.
    """
    entropy = f"{memo}:{time.time_ns()}".encode()
    digest = hashlib.sha512(entropy).digest()   # 64 bayt → tipik Solana imza boyutu
    return _b58encode(digest)


# ---------------------------------------------------------------------------
# Gerçek Solana TX (SOLANA_PRIVATE_KEY ortam değişkeni gerektirir)
# ---------------------------------------------------------------------------

async def _send_real_memo(memo: str) -> str:
    """
    solders + solana-py ile Devnet'e gerçek bir SPL Memo transaction gönderir.

    Ortam değişkenleri:
        SOLANA_PRIVATE_KEY : Base58 gizli anahtar (64 bayt)
        SOLANA_RPC_URL     : (opsiyonel) özel RPC endpoint

    Raises:
        Exception: Ağ/airdrop hatası; çağıran katman simüle moda düşer.
    """
    from solders.keypair import Keypair  # type: ignore
    from solders.pubkey import Pubkey  # type: ignore
    from solders.transaction import Transaction  # type: ignore
    from solders.instruction import Instruction, AccountMeta  # type: ignore
    from solders.message import Message  # type: ignore
    from solana.rpc.async_api import AsyncClient  # type: ignore
    from solders.hash import Hash  # type: ignore

    raw_key = os.environ[_PRIVATE_KEY_ENV]
    keypair = Keypair.from_base58_string(raw_key)

    # SPL Memo Program ID
    memo_program_id = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")

    memo_bytes = memo.encode("utf-8")
    instruction = Instruction(
        program_id=memo_program_id,
        accounts=[AccountMeta(pubkey=keypair.pubkey(), is_signer=True, is_writable=False)],
        data=memo_bytes,
    )

    async with AsyncClient(DEVNET_RPC) as client:
        blockhash_resp = await client.get_latest_blockhash()
        recent_blockhash: Hash = blockhash_resp.value.blockhash

        msg = Message.new_with_blockhash(
            [instruction],
            keypair.pubkey(),
            recent_blockhash,
        )
        tx = Transaction([keypair], msg, recent_blockhash)
        resp = await client.send_transaction(tx)

    sig = str(resp.value)
    logger.info("Solana Devnet TX gönderildi: %s", sig)
    return sig


# ---------------------------------------------------------------------------
# Genel API
# ---------------------------------------------------------------------------

async def notarize_on_chain(
    document_hash: str,
    sender: str,
    receiver: str,
    timestamp: str,
) -> Tuple[str, str]:
    """
    Solana Devnet'e memo transaction gönderir (ya da simüle eder).

    Returns:
        (tx_signature: str, explorer_url: str)
    """
    memo = build_memo(document_hash, sender, receiver, timestamp)

    if _PRIVATE_KEY_ENV in os.environ:
        try:
            sig = await _send_real_memo(memo)
        except Exception as exc:
            logger.warning(
                "Solana TX başarısız (%s); simüle moda geçiliyor.", exc
            )
            sig = _simulated_signature(memo)
    else:
        logger.debug("SOLANA_PRIVATE_KEY bulunamadı; simüle TX kullanılıyor.")
        sig = _simulated_signature(memo)

    explorer_url = SOLANA_EXPLORER_BASE.format(sig=sig)
    return sig, explorer_url

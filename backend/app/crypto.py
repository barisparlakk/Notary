"""
Kriptografik yardımcı fonksiyonlar.

Sabitler (CONTRACT.md):
  - Hash    : SHA-256, küçük harf hex
  - İmza    : Ed25519, Base64
  - Mesaj   : chainnotary:v1|{document_hash}|{sender}|{receiver}|{timestamp}

Sadece PyNaCl ve standart kütüphane kullanılır; ek bağımlılık yok.
"""

from __future__ import annotations

import base64
import hashlib

import nacl.exceptions
import nacl.signing

# ---------------------------------------------------------------------------
# Sabitler
# ---------------------------------------------------------------------------

_MESSAGE_PREFIX = "chainnotary:v1"


# ---------------------------------------------------------------------------
# Hash
# ---------------------------------------------------------------------------


def sha256_hex(data: bytes) -> str:
    """Verinin SHA-256 özetini küçük harf hex olarak döner (64 karakter)."""
    return hashlib.sha256(data).hexdigest()   # hexdigest() zaten küçük harf


# ---------------------------------------------------------------------------
# İmza mesajı formatı
# ---------------------------------------------------------------------------


def build_signed_message(
    document_hash: str,
    sender: str,
    receiver: str,
    timestamp: str,
) -> str:
    """
    Sözleşmeye göre imzalanacak kanonik mesaj dizesi:
        chainnotary:v1|{document_hash}|{sender}|{receiver}|{timestamp}

    Tüm alanlar ham string; herhangi bir encoding yapılmaz.
    """
    return f"{_MESSAGE_PREFIX}|{document_hash}|{sender}|{receiver}|{timestamp}"


# ---------------------------------------------------------------------------
# İmza doğrulama
# ---------------------------------------------------------------------------


def verify_ed25519(
    public_key_b64: str,
    message: str,
    signature_b64: str,
) -> bool:
    """
    Ed25519 imzasını doğrular.

    Args:
        public_key_b64: Base64 kodlanmış 32 baytlık açık anahtar.
        message:        İmzalanmış ham mesaj (build_signed_message çıktısı).
        signature_b64:  Base64 kodlanmış 64 baytlık imza.

    Returns:
        True  → imza geçerli
        False → imza geçersiz veya herhangi bir parsing hatası
    """
    try:
        pub_bytes = base64.b64decode(public_key_b64, validate=True)
        sig_bytes = base64.b64decode(signature_b64, validate=True)

        # PyNaCl: VerifyKey (32 bayt) + verify (mesaj, imza)
        verify_key = nacl.signing.VerifyKey(pub_bytes)
        verify_key.verify(message.encode("utf-8"), sig_bytes)
        return True

    except (nacl.exceptions.BadSignatureError, Exception):
        return False


# ---------------------------------------------------------------------------
# Anahtar üretimi (test / seed yardımcısı)
# ---------------------------------------------------------------------------


def generate_keypair() -> tuple[str, str]:
    """
    Yeni bir Ed25519 anahtar çifti üretir.

    Returns:
        (private_key_b64, public_key_b64) – Her ikisi de Base64 kodlanmış.

    Kullanım: Yalnızca testlerde ve agent tarafında; backend üretimde
    çağrılmaz (public key dışarıdan registration ile gelir).
    """
    signing_key = nacl.signing.SigningKey.generate()
    priv_b64 = base64.b64encode(bytes(signing_key)).decode()
    pub_b64 = base64.b64encode(bytes(signing_key.verify_key)).decode()
    return priv_b64, pub_b64


def sign_message(private_key_b64: str, message: str) -> str:
    """
    Verilen özel anahtarla mesajı imzalar ve Base64 imzayı döner.

    Kullanım: Yalnızca testlerde ve agent tarafında.
    """
    priv_bytes = base64.b64decode(private_key_b64, validate=True)
    signing_key = nacl.signing.SigningKey(priv_bytes)
    signed = signing_key.sign(message.encode("utf-8"))
    return base64.b64encode(signed.signature).decode()

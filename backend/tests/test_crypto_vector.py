"""
Kriptografik test vektörleri.

docs/test_vectors.json dosyasına yazılmış deterministik vektörlerle
crypto.py fonksiyonlarını çapraz doğrular.

Ayrıca live entegrasyon testleri: FastAPI TestClient üzerinden
/agents/register → /notarize → /verify (VERIFIED + INVALID) akışını
uçtan uca koşar.

Çalıştırma:
    cd backend
    pytest tests/ -v
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

import nacl.signing
import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Test vektörü dosya yolu
# ---------------------------------------------------------------------------

VECTORS_PATH = Path(__file__).parent.parent.parent / "docs" / "test_vectors.json"


# ---------------------------------------------------------------------------
# Test vektörü üretici (ilk çalıştırmada dosyayı doldurur)
# ---------------------------------------------------------------------------


def _generate_vectors() -> dict:
    """
    Deterministik test vektörü üretir ve docs/test_vectors.json'a yazar.
    Sabit seed → her çalıştırmada aynı sonuç.
    """
    seed = b"\x42" * 32   # 32 bayt sabit seed
    signing_key = nacl.signing.SigningKey(seed)
    pub_b64 = base64.b64encode(bytes(signing_key.verify_key)).decode()
    priv_b64 = base64.b64encode(bytes(signing_key)).decode()

    file_content = b"Notary Test Vector Document v1"
    document_hash = hashlib.sha256(file_content).hexdigest()
    sender = "agent_a"
    receiver = "agent_b"
    timestamp = "2026-10-03T18:30:00Z"
    message = f"notary:v1|{document_hash}|{sender}|{receiver}|{timestamp}"

    signed = signing_key.sign(message.encode("utf-8"))
    signature_b64 = base64.b64encode(signed.signature).decode()

    vectors = {
        "private_key_b64": priv_b64,
        "public_key_b64": pub_b64,
        "file_content_ascii": file_content.decode(),
        "document_hash": document_hash,
        "sender": sender,
        "receiver": receiver,
        "timestamp": timestamp,
        "signed_message": message,
        "signature_b64": signature_b64,
    }

    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(VECTORS_PATH, "w") as f:
        json.dump(vectors, f, indent=2)

    return vectors


def _load_vectors() -> dict:
    """Vektör dosyası varsa yükle, yoksa üret ve kaydet."""
    if VECTORS_PATH.exists():
        with open(VECTORS_PATH) as f:
            data = json.load(f)
        # Dosya boş ya da eski format ise yeniden üret
        if not data or "document_hash" not in data or not data.get("signed_message", "").startswith("notary:v1|"):
            return _generate_vectors()
        return data
    return _generate_vectors()


# ---------------------------------------------------------------------------
# crypto.py birim testleri (vektör tabanlı)
# ---------------------------------------------------------------------------


class TestCryptoVectors:
    """crypto.py fonksiyonlarını deterministik vektörlerle test eder."""

    @classmethod
    def setup_class(cls):
        cls.v = _load_vectors()

    def test_sha256_hex_format(self):
        """SHA-256 çıktısı 64 karakterlik küçük harf hex olmalı."""
        from app.crypto import sha256_hex

        content = self.v["file_content_ascii"].encode()
        result = sha256_hex(content)

        assert len(result) == 64
        assert result == result.lower()
        assert all(c in "0123456789abcdef" for c in result)

    def test_sha256_hex_value_matches_vector(self):
        """Hash değeri kayıtlı vektörle birebir uyuşmalı."""
        from app.crypto import sha256_hex

        content = self.v["file_content_ascii"].encode()
        assert sha256_hex(content) == self.v["document_hash"]

    def test_build_signed_message(self):
        """Mesaj formatı: notary:v1|hash|sender|receiver|timestamp"""
        from app.crypto import build_signed_message

        msg = build_signed_message(
            self.v["document_hash"],
            self.v["sender"],
            self.v["receiver"],
            self.v["timestamp"],
        )
        assert msg == self.v["signed_message"]
        assert msg.startswith("notary:v1|")

    def test_solana_memo_format_and_parse(self):
        """Solana memo formatı na1|... oluşturulmalı ve çözümlenebilmeli."""
        from app.solana_client import build_memo, parse_memo

        memo = build_memo(
            self.v["document_hash"],
            self.v["sender"],
            self.v["receiver"],
            self.v["timestamp"],
        )
        assert memo.startswith("na1|")
        assert self.v["document_hash"] in memo

        parsed = parse_memo(memo)
        assert parsed is not None
        assert parsed.version == "na1"
        assert parsed.document_hash == self.v["document_hash"]
        assert parsed.sender == self.v["sender"]
        assert parsed.receiver == self.v["receiver"]
        assert parsed.timestamp == self.v["timestamp"]

        # Geçersiz memo ayrıştırma testi
        assert parse_memo("invalid_memo_without_pipes") is None
        assert parse_memo("na2|only|three|parts") is None

    def test_verify_ed25519_valid(self):
        """Geçerli imza DOĞRULANMALI."""
        from app.crypto import verify_ed25519

        assert verify_ed25519(
            self.v["public_key_b64"],
            self.v["signed_message"],
            self.v["signature_b64"],
        ) is True

    def test_verify_ed25519_tampered_message(self):
        """Mesaj değiştirilirse imza REDDEDİLMELİ."""
        from app.crypto import verify_ed25519

        tampered = self.v["signed_message"] + "_TAMPERED"
        assert verify_ed25519(
            self.v["public_key_b64"],
            tampered,
            self.v["signature_b64"],
        ) is False

    def test_verify_ed25519_wrong_key(self):
        """Yanlış açık anahtarla imza REDDEDİLMELİ."""
        from app.crypto import verify_ed25519, generate_keypair

        _, other_pub = generate_keypair()
        assert verify_ed25519(
            other_pub,
            self.v["signed_message"],
            self.v["signature_b64"],
        ) is False

    def test_verify_ed25519_corrupted_signature(self):
        """Bozuk Base64 imza False dönmeli, exception fırlatmamalı."""
        from app.crypto import verify_ed25519

        assert verify_ed25519(
            self.v["public_key_b64"],
            self.v["signed_message"],
            "YWJj",  # geçerli base64 ama yanlış imza
        ) is False

    def test_avalanche_effect(self):
        """
        SHA-256 çığ etkisi: 1 bayt değişikliği tamamen farklı hash üretmeli.
        Uygulamanın INVALID tespitinin temel matematiksel garantisi.
        """
        from app.crypto import sha256_hex

        original = b"Notary Test Vector Document v1"
        tampered = b"Notary Test Vector Document v2"   # sadece son karakter farklı

        h1 = sha256_hex(original)
        h2 = sha256_hex(tampered)

        assert h1 != h2
        # İki hash arasında ortak karakter oranı < %50 olmalı (çığ etkisi kanıtı)
        diff_chars = sum(a != b for a, b in zip(h1, h2))
        assert diff_chars > 20, f"Çığ etkisi zayıf: yalnızca {diff_chars} karakter farklı"


# ---------------------------------------------------------------------------
# Uçtan uca entegrasyon testleri (TestClient)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """
    Her test modülü için izole bir SQLite DB ile TestClient başlatır.
    DB_PATH env değişkeni ile geçici dizine yönlendirilir.
    """
    tmp = tmp_path_factory.mktemp("db")
    db_file = str(tmp / "test_notary.db")
    os.environ["DB_PATH"] = db_file

    from app.main import app

    with TestClient(app) as c:
        yield c

    # Temizlik
    if os.path.exists(db_file):
        os.remove(db_file)
    os.environ.pop("DB_PATH", None)


@pytest.fixture(scope="module")
def vectors():
    return _load_vectors()


class TestEndpointsE2E:
    """CONTRACT.md endpoint'lerini uçtan uca test eder."""

    # -----------------------------------------------------------------------
    # /health
    # -----------------------------------------------------------------------

    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    # -----------------------------------------------------------------------
    # /agents/register
    # -----------------------------------------------------------------------

    def test_register_agent(self, client, vectors):
        resp = client.post(
            "/agents/register",
            json={"agent_id": "agent_a", "public_key": vectors["public_key_b64"]},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["agent_id"] == "agent_a"
        assert body["public_key"] == vectors["public_key_b64"]
        assert "registered_at" in body

    def test_register_invalid_public_key(self, client):
        """32 bayt olmayan public key reddedilmeli."""
        resp = client.post(
            "/agents/register",
            json={"agent_id": "bad_agent", "public_key": "bm90YWtleQ=="},  # "notakey"
        )
        assert resp.status_code == 422

    # -----------------------------------------------------------------------
    # /notarize
    # -----------------------------------------------------------------------

    def test_notarize_success(self, client, vectors):
        """Geçerli imzayla notarize → 201 + proof alanları mevcut."""
        resp = client.post(
            "/notarize",
            data={
                "sender": vectors["sender"],
                "receiver": vectors["receiver"],
                "timestamp": vectors["timestamp"],
                "signature": vectors["signature_b64"],
            },
            files={"file": ("report.pdf", vectors["file_content_ascii"].encode(), "text/plain")},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["document_hash"] == vectors["document_hash"]
        assert body["sender"] == vectors["sender"]
        assert body["receiver"] == vectors["receiver"]
        assert "proof_id" in body
        assert "tx_signature" in body
        assert "explorer_url" in body
        # proof_id'yi sonraki testlerde kullanmak için sınıf değişkenine sakla
        TestEndpointsE2E._proof_id = body["proof_id"]

    def test_notarize_unknown_sender(self, client, vectors):
        """Kayıtsız sender → 400."""
        resp = client.post(
            "/notarize",
            data={
                "sender": "ghost_agent",
                "receiver": vectors["receiver"],
                "timestamp": vectors["timestamp"],
                "signature": vectors["signature_b64"],
            },
            files={"file": ("x.txt", b"content", "text/plain")},
        )
        assert resp.status_code == 400

    def test_notarize_bad_signature(self, client, vectors):
        """Yanlış imza → 400."""
        resp = client.post(
            "/notarize",
            data={
                "sender": vectors["sender"],
                "receiver": vectors["receiver"],
                "timestamp": vectors["timestamp"],
                "signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            },
            files={"file": ("report.pdf", vectors["file_content_ascii"].encode(), "text/plain")},
        )
        assert resp.status_code == 400

    # -----------------------------------------------------------------------
    # /verify
    # -----------------------------------------------------------------------

    def test_verify_verified(self, client, vectors):
        """Orijinal dosya → VERIFIED."""
        resp = client.post(
            "/verify",
            data={"proof_id": TestEndpointsE2E._proof_id},
            files={"file": ("report.pdf", vectors["file_content_ascii"].encode(), "text/plain")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "VERIFIED"
        assert body["original_hash"] == body["received_hash"]
        assert body["proof"] is not None

    def test_verify_invalid_tampered(self, client, vectors):
        """1 bayt değiştirilmiş dosya → INVALID (çığ etkisi)."""
        tampered = vectors["file_content_ascii"].encode() + b"_TAMPERED"
        resp = client.post(
            "/verify",
            data={"proof_id": TestEndpointsE2E._proof_id},
            files={"file": ("tampered.pdf", tampered, "text/plain")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "INVALID"
        assert body["original_hash"] != body["received_hash"]

    def test_verify_unknown_proof(self, client):
        """Olmayan proof_id → INVALID (HTTP 200, status=INVALID)."""
        resp = client.post(
            "/verify",
            data={"proof_id": "proof_nonexistent"},
            files={"file": ("x.txt", b"anything", "text/plain")},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "INVALID"

    # -----------------------------------------------------------------------
    # /proofs/{proof_id}
    # -----------------------------------------------------------------------

    def test_get_proof(self, client, vectors):
        """Kaydedilmiş proof GET ile alınabilmeli."""
        resp = client.get(f"/proofs/{TestEndpointsE2E._proof_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["proof_id"] == TestEndpointsE2E._proof_id
        assert body["document_hash"] == vectors["document_hash"]

    def test_get_proof_not_found(self, client):
        """Olmayan proof_id → 404."""
        resp = client.get("/proofs/proof_does_not_exist")
        assert resp.status_code == 404

    # -----------------------------------------------------------------------
    # Solana On-Chain & Tx Signature Doğrulama Testleri
    # -----------------------------------------------------------------------

    def test_solana_wallet_info(self, client):
        """Noter Solana cüzdan adresi sorgulanabilmeli."""
        resp = client.get("/solana/wallet")
        assert resp.status_code == 200
        body = resp.json()
        assert body["network"] == "devnet"
        assert "wallet_pubkey" in body
        assert "explorer_url" in body

    def test_verify_proof_on_chain(self, client, vectors):
        """Proof kaydı Solana zincir üstü doğrulamadan geçmeli."""
        resp = client.get(f"/proofs/{TestEndpointsE2E._proof_id}/verify-chain")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "VERIFIED"
        assert body["hash_match"] is True
        assert body["parsed_memo"]["document_hash"] == vectors["document_hash"]
        assert body["parsed_memo"]["version"] == "na1"

    def test_verify_tx_signature_valid(self, client, vectors):
        """Doğrudan tx_signature ile doğrulama başarılı olmalı."""
        # Notarize yanıtından aldığımız proof'u çek
        proof_resp = client.get(f"/proofs/{TestEndpointsE2E._proof_id}").json()
        tx_sig = proof_resp["tx_signature"]

        resp = client.post(
            "/verify/tx",
            data={
                "tx_signature": tx_sig,
                "document_hash": vectors["document_hash"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "VERIFIED"
        assert body["hash_match"] is True
        assert body["parsed_memo"]["document_hash"] == vectors["document_hash"]

    def test_verify_tx_signature_tampered_hash(self, client, vectors):
        """Doğru tx_signature ancak değiştirilmiş hash → INVALID dönmeli."""
        proof_resp = client.get(f"/proofs/{TestEndpointsE2E._proof_id}").json()
        tx_sig = proof_resp["tx_signature"]

        resp = client.post(
            "/verify/tx",
            data={
                "tx_signature": tx_sig,
                "document_hash": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "INVALID"
        assert body["hash_match"] is False


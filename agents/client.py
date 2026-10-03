# Backend API istemcisi (requests). CONTRACT.md'deki endpoint'leri sarmalar.
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

import crypto

API_URL = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
TIMEOUT = 30


class ApiError(Exception):
    """Backend 2xx dışı bir yanıt döndürdüğünde."""

    def __init__(self, status_code, detail):
        super().__init__(f"HTTP {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


def _json(resp):
    if not resp.ok:
        try:
            detail = resp.json().get("detail", resp.text)
        except ValueError:
            detail = resp.text
        raise ApiError(resp.status_code, detail)
    return resp.json()


def utc_timestamp():
    """ISO 8601 UTC, örn. 2026-10-03T18:30:00Z"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def health(api_url=None):
    return _json(requests.get(f"{api_url or API_URL}/health", timeout=TIMEOUT))


def register_agent(agent_id, public_key, api_url=None):
    """POST /agents/register"""
    body = {"agent_id": agent_id, "public_key": public_key}
    return _json(requests.post(f"{api_url or API_URL}/agents/register", json=body, timeout=TIMEOUT))


def ensure_agent(agent_id, keys_dir=crypto.KEYS_DIR, api_url=None):
    """Anahtar yoksa üretip kaydeder, sonra backend'e register eder. -> (private_key_b64, public_key_b64)"""
    try:
        priv, pub = crypto.load_keys(agent_id, keys_dir=keys_dir)
    except FileNotFoundError:
        priv, pub = crypto.generate_keypair()
        crypto.save_keys(agent_id, priv, pub, keys_dir=keys_dir)
    register_agent(agent_id, pub, api_url=api_url)
    return priv, pub


def notarize(file_path, sender, receiver, keys_dir=crypto.KEYS_DIR, timestamp=None, api_url=None):
    """POST /notarize — dosyayı hash'le, imzala, gönder. Yanıt: sözleşmedeki proof alanları."""
    file_path = Path(file_path)
    data = file_path.read_bytes()
    private_key, _ = crypto.load_keys(sender, keys_dir=keys_dir)

    timestamp = timestamp or utc_timestamp()
    document_hash = crypto.sha256_hex(data)
    message = crypto.build_message(document_hash, sender, receiver, timestamp)
    signature = crypto.sign(private_key, message)

    resp = requests.post(
        f"{api_url or API_URL}/notarize",
        files={"file": (file_path.name, data)},
        data={"sender": sender, "receiver": receiver, "timestamp": timestamp, "signature": signature},
        timeout=TIMEOUT,
    )
    return _json(resp)


def verify(file_path, proof_id, api_url=None):
    """POST /verify — yanıt: {status, original_hash, received_hash, proof}"""
    file_path = Path(file_path)
    resp = requests.post(
        f"{api_url or API_URL}/verify",
        files={"file": (file_path.name, file_path.read_bytes())},
        data={"proof_id": proof_id},
        timeout=TIMEOUT,
    )
    return _json(resp)


def get_proof(proof_id, api_url=None):
    """GET /proofs/{proof_id}"""
    return _json(requests.get(f"{api_url or API_URL}/proofs/{proof_id}", timeout=TIMEOUT))

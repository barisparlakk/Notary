# Hash + ed25519 imza yardımcıları (PyNaCl). CONTRACT.md'ye göre.
import base64
import hashlib
import json
from pathlib import Path

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

KEYS_DIR = Path(__file__).parent / "keys"


def generate_keypair():
    """-> (private_key_b64, public_key_b64). Private key = 32 byte seed."""
    sk = SigningKey.generate()
    return _keypair_from_signing_key(sk)


def keypair_from_seed(seed: bytes):
    return _keypair_from_signing_key(SigningKey(seed))


def _keypair_from_signing_key(sk: SigningKey):
    private_b64 = base64.b64encode(bytes(sk)).decode()
    public_b64 = base64.b64encode(bytes(sk.verify_key)).decode()
    return private_b64, public_b64


def sha256_hex(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def build_message(document_hash, sender, receiver, timestamp) -> str:
    return f"notary:v1|{document_hash}|{sender}|{receiver}|{timestamp}"


def sign(private_key_b64: str, message: str) -> str:
    sk = SigningKey(base64.b64decode(private_key_b64))
    return base64.b64encode(sk.sign(message.encode()).signature).decode()


def verify_signature(public_key_b64: str, message: str, signature_b64: str) -> bool:
    try:
        vk = VerifyKey(base64.b64decode(public_key_b64))
        vk.verify(message.encode(), base64.b64decode(signature_b64))
        return True
    except (BadSignatureError, ValueError):
        return False


def save_keys(agent_id, private_key_b64, public_key_b64, keys_dir=KEYS_DIR):
    keys_dir = Path(keys_dir)
    keys_dir.mkdir(parents=True, exist_ok=True)
    path = keys_dir / f"{agent_id}.json"
    path.write_text(json.dumps(
        {"agent_id": agent_id, "private_key": private_key_b64, "public_key": public_key_b64},
        indent=2,
    ))
    return path


def load_keys(agent_id, keys_dir=KEYS_DIR):
    """-> (private_key_b64, public_key_b64)"""
    data = json.loads((Path(keys_dir) / f"{agent_id}.json").read_text())
    return data["private_key"], data["public_key"]

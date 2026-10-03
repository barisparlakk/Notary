# docs/test_vectors.json üretir (backend ile ortak biçim: seed 32 x 0x42, "Notary Test Vector Document v1").
# Ed25519 deterministik olduğu için çıktı backend'in vektörüyle birebir aynı olmalı.
import json
from pathlib import Path

import crypto

SEED = bytes([0x42]) * 32
FILE_CONTENT = "Notary Test Vector Document v1"
SENDER, RECEIVER, TIMESTAMP = "agent_a", "agent_b", "2026-10-03T18:30:00Z"

priv, pub = crypto.keypair_from_seed(SEED)
doc_hash = crypto.sha256_hex(FILE_CONTENT.encode())
message = crypto.build_message(doc_hash, SENDER, RECEIVER, TIMESTAMP)
vector = {
    "private_key_b64": priv,
    "public_key_b64": pub,
    "file_content_ascii": FILE_CONTENT,
    "document_hash": doc_hash,
    "sender": SENDER,
    "receiver": RECEIVER,
    "timestamp": TIMESTAMP,
    "signed_message": message,
    "signature_b64": crypto.sign(priv, message),
}
out = Path(__file__).resolve().parent.parent / "docs" / "test_vectors.json"
out.write_text(json.dumps(vector, indent=2) + "\n")
print(out)

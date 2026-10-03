# docs/test_vectors.json üretir (sabit seed: 32 x 0x01). Backend ile çapraz doğrulama için.
import json
from pathlib import Path

import crypto

SEED = bytes([0x01]) * 32
SENDER, RECEIVER, TIMESTAMP = "agent_a", "agent_b", "2026-10-03T18:30:00Z"

priv, pub = crypto.keypair_from_seed(SEED)
doc_hash = crypto.sha256_hex(b"hello notara")
message = crypto.build_message(doc_hash, SENDER, RECEIVER, TIMESTAMP)
vector = {
    "public_key": pub,
    "document_hash": doc_hash,
    "sender": SENDER,
    "receiver": RECEIVER,
    "timestamp": TIMESTAMP,
    "message": message,
    "signature": crypto.sign(priv, message),
}
out = Path(__file__).resolve().parent.parent / "docs" / "test_vectors.json"
out.write_text(json.dumps(vector, indent=2) + "\n")
print(out)

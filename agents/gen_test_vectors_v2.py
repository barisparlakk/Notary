# docs/test_vectors_v2.json'a "golden" bayt vektörleri ekler (talimat verisi ve örnek Proof hesabı).
# Python, TypeScript (frontend) ve Rust (program) aynı baytları üretmeli/çözmeli.
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

from solders.keypair import Keypair

import onchain

path = Path(__file__).resolve().parent.parent / "docs" / "test_vectors_v2.json"
v = json.loads(path.read_text())

h = bytes.fromhex(v["document_hash"])
parent = bytes.fromhex(v["parent_document_hash"])
receiver = v["receiver"]
created = int(datetime(2026, 10, 3, 18, 30, 0, tzinfo=timezone.utc).timestamp())
signer = Keypair.from_seed(bytes.fromhex(v["signer_seed_hex"])).pubkey()

data_some = onchain.encode_notarize_data(h, receiver, [parent])
data_none = onchain.encode_notarize_data(h, None, [])


def account(receiver_pk, parents, bump):
    raw = onchain.PROOF_DISC + b"\x01" + bytes(signer) + h
    raw += (b"\x01" + bytes(onchain.Pubkey.from_string(receiver_pk))) if receiver_pk else b"\x00"
    raw += struct.pack("<q", created) + struct.pack("<I", len(parents)) + b"".join(parents) + bytes([bump])
    return (raw + b"\x00" * (247 - len(raw))).hex()


v["golden"] = {
    "created_at_unix": created,
    "created_at_iso": "2026-10-03T18:30:00Z",
    "notarize_data_receiver_one_parent_hex": data_some.hex(),
    "notarize_data_no_receiver_no_parents_hex": data_none.hex(),
    "proof_account_receiver_one_parent_hex": account(receiver, [parent], v["bump"]),
    "proof_account_no_receiver_no_parents_hex": account(None, [], v["bump"]),
}
path.write_text(json.dumps(v, indent=2) + "\n")
print("golden vektörler yazıldı")

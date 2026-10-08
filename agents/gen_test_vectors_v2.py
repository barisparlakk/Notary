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
# --- çok imzalı sözleşme (create_agreement / co_sign)
parties = [Keypair.from_seed(bytes([0x42]) * 32).pubkey(), Keypair.from_seed(bytes([0x43]) * 32).pubkey(),
           Keypair.from_seed(bytes([0x44]) * 32).pubkey()]
ag_pda, ag_bump = onchain.derive_agreement_pda(v["program_id"], parties[0], h)


def agreement_account(signed):
    n = len(parties)
    raw = onchain.AGREEMENT_DISC + b"\x01" + bytes(parties[0]) + h + struct.pack("<q", created)
    raw += struct.pack("<I", n) + b"".join(bytes(p) for p in parties) + struct.pack("<I", n)
    raw += struct.pack(f"<{n}q", *signed) + bytes([ag_bump])
    return (raw + b"\x00" * (onchain.AGREEMENT_SIZE - len(raw))).hex()


v["agreement"] = {
    "creator": str(parties[0]),
    "parties": [str(p) for p in parties],
    "agreement_pda": str(ag_pda),
    "bump": ag_bump,
    "create_agreement_discriminator_hex": onchain.CREATE_AGREEMENT_DISC.hex(),
    "co_sign_discriminator_hex": onchain.CO_SIGN_DISC.hex(),
    "account_discriminator_hex": onchain.AGREEMENT_DISC.hex(),
    "account_size": onchain.AGREEMENT_SIZE,
    "party_offset": onchain.AGREEMENT_PARTY_OFFSET,
    "create_agreement_data_hex": onchain.encode_create_agreement_data(h, parties).hex(),
    "account_creator_signed_hex": agreement_account([created, 0, 0]),
    "account_all_signed_hex": agreement_account([created, created + 60, created + 120]),
    "created_at_unix": created,
}
v["account_size_proof"] = onchain.PROOF_SIZE
path.write_text(json.dumps(v, indent=2) + "\n")
print("golden vektörler yazıldı")

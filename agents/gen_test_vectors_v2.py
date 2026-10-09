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
# --- kimlik beyanı ve iptal (attest_identity / revoke_attestation / revoke_proof)
issuer, subject = parties[0], parties[1]  # seed 0x42 (imzalayan) bir başkasını (seed 0x43) onaylar
evidence = "Notary Test Vector Identity v1"
label, expires = "Ahmet Yilmaz", created + 365 * 86400
revoked = created + 86400
att_pda, att_bump = onchain.derive_attestation_pda(v["program_id"], issuer, subject)
proof_pda = onchain.Pubkey.from_string(v["proof_pda"])
rev_pda, rev_bump = onchain.derive_revocation_pda(v["program_id"], proof_pda)


def attestation_account(revoked_at):
    raw = (onchain.ATTESTATION_DISC + b"\x01" + bytes(issuer) + bytes(subject) + struct.pack("<I", len(label)) + label.encode()
           + onchain.claim_hash(evidence) + struct.pack("<qqq", created, expires, revoked_at) + bytes([att_bump]))
    return (raw + b"\x00" * (onchain.ATTESTATION_SIZE - len(raw))).hex()


v["identity"] = {
    "issuer": str(issuer),
    "subject": str(subject),
    "label": label,
    "evidence_ascii": evidence,
    "claim_hash": onchain.claim_hash(evidence).hex(),
    "created_at_unix": created,
    "expires_at_unix": expires,
    "revoked_at_unix": revoked,
    "attestation_pda": str(att_pda),
    "bump": att_bump,
    "attest_identity_discriminator_hex": onchain.ATTEST_IDENTITY_DISC.hex(),
    "revoke_attestation_discriminator_hex": onchain.REVOKE_ATTESTATION_DISC.hex(),
    "account_discriminator_hex": onchain.ATTESTATION_DISC.hex(),
    "account_size": onchain.ATTESTATION_SIZE,
    "issuer_offset": onchain.ATTEST_ISSUER_OFFSET,
    "subject_offset": onchain.ATTEST_SUBJECT_OFFSET,
    "attest_identity_data_hex": onchain.encode_attest_identity_data(subject, label, onchain.claim_hash(evidence), expires).hex(),
    "account_valid_hex": attestation_account(0),
    "account_revoked_hex": attestation_account(revoked),
}
v["revocation"] = {
    "proof_pda": str(proof_pda),
    "revocation_pda": str(rev_pda),
    "bump": rev_bump,
    "revoke_proof_discriminator_hex": onchain.REVOKE_PROOF_DISC.hex(),
    "account_discriminator_hex": onchain.REVOCATION_DISC.hex(),
    "account_size": onchain.REVOCATION_SIZE,
    "revoked_at_unix": revoked,
    "account_hex": (onchain.REVOCATION_DISC + b"\x01" + bytes(proof_pda) + bytes(signer) + struct.pack("<q", revoked) + bytes([rev_bump])).hex(),
}
v["account_size_proof"] = onchain.PROOF_SIZE
path.write_text(json.dumps(v, indent=2) + "\n")
print("golden vektörler yazıldı")

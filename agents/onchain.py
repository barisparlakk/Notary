# v2: Solana PDA üzerinden noter kaydı (CONTRACT.md v2). Backend gerekmez: yalnızca bir Solana RPC.
# Talimat ve hesap biçimi elle (Borsh) kurulur; Anchor/IDL bağımlılığı yok.
import base64
import hashlib
import json
import os
import struct
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction

RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
PROGRAM_ID = os.environ.get("PROGRAM_ID", "")
KEYS_DIR = Path(__file__).parent / "keys"

MAX_PARENTS = 4
NOTARIZE_DISC = hashlib.sha256(b"global:notarize").digest()[:8]
PROOF_DISC = hashlib.sha256(b"account:Proof").digest()[:8]
SIGNER_OFFSET, HASH_OFFSET = 9, 41  # memcmp ofsetleri (CONTRACT.md v2, Bölüm 3)


class ChainError(Exception):
    pass


# ---------------------------------------------------------------- anahtarlar
def load_keypair(path):
    """Solana CLI biçimi: 64 sayılık JSON dizisi."""
    return Keypair.from_bytes(bytes(json.loads(Path(path).read_text())))


def save_keypair(kp, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(list(bytes(kp))))
    return path


def agent_keypair(agent_id, keys_dir=KEYS_DIR):
    """Agent'ın Solana anahtarı; yoksa üretip kaydeder. Kimlik = public key (base58)."""
    path = Path(keys_dir) / f"{agent_id}.keypair.json"
    if path.exists():
        return load_keypair(path)
    kp = Keypair()
    save_keypair(kp, path)
    return kp


# ------------------------------------------------------------------ PDA ve biçim
def sha256_bytes(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def derive_proof_pda(program_id, signer, document_hash: bytes):
    """-> (Pubkey, bump). seeds = [b"proof", signer, document_hash]"""
    return Pubkey.find_program_address(
        [b"proof", bytes(Pubkey.from_string(str(signer))), document_hash], Pubkey.from_string(str(program_id))
    )


def encode_notarize_data(document_hash: bytes, receiver=None, parents=()):
    if len(document_hash) != 32:
        raise ChainError("document_hash 32 bayt olmalı")
    if len(parents) > MAX_PARENTS:
        raise ChainError(f"en fazla {MAX_PARENTS} üst belge")
    data = NOTARIZE_DISC + document_hash
    data += b"\x00" if receiver is None else b"\x01" + bytes(Pubkey.from_string(str(receiver)))
    data += struct.pack("<I", len(parents)) + b"".join(parents)
    return data


def decode_proof(data: bytes) -> dict:
    """Proof hesabı (Borsh). Sondaki dolgu baytları yok sayılır."""
    if data[:8] != PROOF_DISC:
        raise ChainError("Proof discriminator uyuşmuyor")
    o = 8
    version = data[o]
    o += 1
    signer = Pubkey.from_bytes(data[o:o + 32])
    o += 32
    document_hash = data[o:o + 32]
    o += 32
    receiver = None
    if data[o] == 1:
        receiver = Pubkey.from_bytes(data[o + 1:o + 33])
    o += 33 if data[o] == 1 else 1
    (created_at,) = struct.unpack_from("<q", data, o)
    o += 8
    (n,) = struct.unpack_from("<I", data, o)
    o += 4
    parents = [data[o + 32 * i:o + 32 * (i + 1)] for i in range(n)]
    o += 32 * n
    return {
        "version": version,
        "signer": str(signer),
        "document_hash": document_hash.hex(),
        "receiver": str(receiver) if receiver else None,
        "created_at": created_at,
        "created_at_iso": datetime.fromtimestamp(created_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "parents": [p.hex() for p in parents],
        "bump": data[o],
    }


# ------------------------------------------------------------------------- RPC
class Rpc:
    """Düz JSON-RPC (requests). Herhangi bir Solana RPC'si ya da mock_rpc ile çalışır."""

    def __init__(self, url=None, timeout=30):
        self.url, self.timeout = url or RPC_URL, timeout

    def call(self, method, params=None):
        resp = requests.post(
            self.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}, timeout=self.timeout
        )
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            raise ChainError(f"{method}: {body['error'].get('message', body['error'])}")
        return body["result"]

    def get_account(self, pubkey):
        value = self.call("getAccountInfo", [str(pubkey), {"encoding": "base64"}])["value"]
        if value is None:
            return None
        return {"owner": value["owner"], "data": base64.b64decode(value["data"][0])}

    def get_program_accounts(self, program_id, offset, raw: bytes):
        """memcmp süzgeci; raw 32 bayt (base58'e Pubkey ile çevrilir)."""
        flt = [{"memcmp": {"offset": offset, "bytes": str(Pubkey.from_bytes(raw))}}]
        items = self.call("getProgramAccounts", [str(program_id), {"encoding": "base64", "filters": flt}])
        return [(it["pubkey"], base64.b64decode(it["account"]["data"][0])) for it in items]

    def latest_blockhash(self):
        return Hash.from_string(self.call("getLatestBlockhash")["value"]["blockhash"])

    def send(self, tx: Transaction):
        return self.call("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64"}])

    def confirm(self, signature, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            st = self.call("getSignatureStatuses", [[signature]])["value"][0]
            if st and st.get("err"):
                raise ChainError(f"işlem başarısız: {st['err']}")
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                return
            time.sleep(0.5)
        raise ChainError("işlem onaylanmadı (zaman aşımı)")

    def airdrop(self, pubkey, sol=1.0):
        sig = self.call("requestAirdrop", [str(pubkey), int(sol * 1_000_000_000)])
        self.confirm(sig)
        return sig

    def balance(self, pubkey):
        return self.call("getBalance", [str(pubkey)])["value"]


# --------------------------------------------------------------------- işlemler
def notarize(rpc, signer: Keypair, document_hash: bytes, receiver=None, parents=(), program_id=None, payer: Keypair = None):
    """Belge hash'ini signer adına PDA olarak kaydeder. payer verilmezse signer öder.
    -> {proof_pda, tx_signature, signer, document_hash}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or signer
    pda, _ = derive_proof_pda(program_id, signer.pubkey(), document_hash)
    ix = Instruction(
        Pubkey.from_string(str(program_id)),
        encode_notarize_data(document_hash, receiver, list(parents)),
        [
            AccountMeta(signer.pubkey(), True, False),
            AccountMeta(payer.pubkey(), True, True),
            AccountMeta(pda, False, True),
            AccountMeta(SYSTEM_PROGRAM_ID, False, False),
        ],
    )
    blockhash = rpc.latest_blockhash()
    msg = Message.new_with_blockhash([ix], payer.pubkey(), blockhash)
    keypairs = [payer] if signer.pubkey() == payer.pubkey() else [payer, signer]
    sig = rpc.send(Transaction(keypairs, msg, blockhash))
    rpc.confirm(sig)
    return {"proof_pda": str(pda), "tx_signature": sig, "signer": str(signer.pubkey()), "document_hash": document_hash.hex()}


def get_proof(rpc, pda):
    """PDA adresinden çözümlenmiş Proof ya da None."""
    acc = rpc.get_account(pda)
    return decode_proof(acc["data"]) if acc else None


def find_by_hash(rpc, document_hash: bytes, program_id=None):
    """İmzalayanı bilinmeyen belge: memcmp(ofset 41) ile tüm kayıtlar."""
    program_id = program_id or PROGRAM_ID
    return [{**decode_proof(d), "proof_pda": pk} for pk, d in rpc.get_program_accounts(program_id, HASH_OFFSET, document_hash)]


def list_by_signer(rpc, signer, program_id=None):
    program_id = program_id or PROGRAM_ID
    raw = bytes(Pubkey.from_string(str(signer)))
    return [{**decode_proof(d), "proof_pda": pk} for pk, d in rpc.get_program_accounts(program_id, SIGNER_OFFSET, raw)]


def verify(rpc, file_bytes: bytes, pda=None, signer=None, program_id=None):
    """API'siz doğrulama (CONTRACT.md v2, Bölüm 4).
    -> {status: VERIFIED|INVALID|NOT_FOUND, original_hash, received_hash, proof_pda, proof}"""
    program_id = program_id or PROGRAM_ID
    received = sha256_bytes(file_bytes)
    out = {"status": "NOT_FOUND", "original_hash": "", "received_hash": received.hex(), "proof_pda": None, "proof": None}

    if pda is None and signer is not None:
        pda = derive_proof_pda(program_id, signer, received)[0]
    if pda is not None:
        proof = get_proof(rpc, pda)
        if proof is None:
            return out
        out.update(proof_pda=str(pda), proof=proof, original_hash=proof["document_hash"])
        out["status"] = "VERIFIED" if proof["document_hash"] == received.hex() else "INVALID"
        return out

    found = find_by_hash(rpc, received, program_id)
    if found:
        out.update(status="VERIFIED", proof=found[0], proof_pda=found[0]["proof_pda"], original_hash=received.hex(),
                   matches=len(found))
    return out


def lineage(rpc, pda, program_id=None):
    """'Bu belge hangi belgelere dayandı?' parents hash'lerini zincirden özyinelemeli çözer.
    -> atalar listesi (kökler önce), her biri {proof_pda, signer, document_hash, created_at_iso, parents}"""
    program_id = program_id or PROGRAM_ID
    root = get_proof(rpc, pda)
    if root is None:
        raise ChainError(f"{pda} bulunamadı")
    order, seen = [], set()

    def visit(proof):
        for h in proof["parents"]:
            if h in seen:
                continue
            seen.add(h)
            found = find_by_hash(rpc, bytes.fromhex(h), program_id)
            if not found:
                order.append({"document_hash": h, "proof_pda": None, "missing": True, "parents": []})
                continue
            visit(found[0])
            order.append(found[0])

    visit(root)
    return order


def build_certificate(proof_pda, proof, tx_signature, program_id=None, cluster="devnet", verify_url=None):
    program_id = program_id or PROGRAM_ID
    return {
        "version": "notary.cert.v1",
        "cluster": cluster,
        "program_id": str(program_id),
        "proof_pda": str(proof_pda),
        "signer": proof["signer"],
        "document_hash": proof["document_hash"],
        "receiver": proof["receiver"],
        "created_at": proof["created_at_iso"],
        "tx_signature": tx_signature,
        "explorer_url": f"https://explorer.solana.com/address/{proof_pda}?cluster={cluster}",
        "verify_url": verify_url or f"?pda={proof_pda}",
    }

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
from solders.system_program import TransferParams, transfer as system_transfer
from solders.transaction import Transaction

RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
PROGRAM_ID = os.environ.get("PROGRAM_ID", "")
KEYS_DIR = Path(__file__).parent / "keys"

# Yeni işlem "confirmed" olur olmaz okunabilmeli; Solana'nın varsayılanı "finalized" (~13 sn gecikme).
COMMITMENT = "confirmed"

CERT_NOTICE = "Timestamped integrity proof recorded on Solana. Not a qualified electronic signature (eIDAS); does not by itself prove the identity of a signer."

MAX_PARENTS = 4
MAX_PARTIES = 4
NOTARIZE_DISC = hashlib.sha256(b"global:notarize").digest()[:8]
PROOF_DISC = hashlib.sha256(b"account:Proof").digest()[:8]
CREATE_AGREEMENT_DISC = hashlib.sha256(b"global:create_agreement").digest()[:8]
CO_SIGN_DISC = hashlib.sha256(b"global:co_sign").digest()[:8]
AGREEMENT_DISC = hashlib.sha256(b"account:Agreement").digest()[:8]
PROOF_SIZE, AGREEMENT_SIZE = 247, 250  # getProgramAccounts dataSize süzgeci: iki hesap türü hash ofsetini paylaşır
AGREEMENT_PARTY_OFFSET = 85  # signers vektörünün ilk eleman ofseti; i. taraf = 85 + 32 * i
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


def encode_create_agreement_data(document_hash: bytes, signers):
    if len(document_hash) != 32:
        raise ChainError("document_hash 32 bayt olmalı")
    if not 2 <= len(signers) <= MAX_PARTIES:
        raise ChainError(f"sözleşme 2 ile {MAX_PARTIES} taraf içermeli")
    keys = [bytes(Pubkey.from_string(str(k))) for k in signers]
    if len(set(keys)) != len(keys):
        raise ChainError("taraflar tekrar edemez")
    return CREATE_AGREEMENT_DISC + document_hash + struct.pack("<I", len(keys)) + b"".join(keys)


def decode_agreement(data: bytes) -> dict:
    """Agreement hesabı (Borsh). Sondaki dolgu baytları yok sayılır."""
    if data[:8] != AGREEMENT_DISC:
        raise ChainError("Agreement discriminator uyuşmuyor")
    o = 8
    version = data[o]
    o += 1
    creator = Pubkey.from_bytes(data[o:o + 32])
    o += 32
    document_hash = data[o:o + 32]
    o += 32
    (created_at,) = struct.unpack_from("<q", data, o)
    o += 8
    (n,) = struct.unpack_from("<I", data, o)
    o += 4
    signers = [str(Pubkey.from_bytes(data[o + 32 * i:o + 32 * (i + 1)])) for i in range(n)]
    o += 32 * n
    (m,) = struct.unpack_from("<I", data, o)
    o += 4
    signed = list(struct.unpack_from(f"<{m}q", data, o))
    o += 8 * m
    parties = [
        {"signer": signers[i], "signed_at": signed[i],
         "signed_at_iso": datetime.fromtimestamp(signed[i], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if signed[i] else None}
        for i in range(n)
    ]
    done = sum(1 for p in parties if p["signed_at"])
    return {
        "version": version,
        "creator": str(creator),
        "document_hash": document_hash.hex(),
        "created_at": created_at,
        "created_at_iso": datetime.fromtimestamp(created_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "parties": parties,
        "signed_count": done,
        "complete": done == n,
        "bump": data[o],
    }


def derive_agreement_pda(program_id, creator, document_hash: bytes):
    """seeds = [b"agreement", creator, document_hash] -> (Pubkey, bump)"""
    return Pubkey.find_program_address(
        [b"agreement", bytes(Pubkey.from_string(str(creator))), document_hash], Pubkey.from_string(str(program_id))
    )


# ------------------------------------------------------------------------- RPC
class Rpc:
    """Düz JSON-RPC (requests). Herhangi bir Solana RPC'si ya da mock_rpc ile çalışır."""

    def __init__(self, url=None, timeout=30):
        self.url, self.timeout = url or RPC_URL, timeout

    def call(self, method, params=None):
        # Genel RPC'ler (api.devnet.solana.com) hızlı sorguda 429 döner: üstel geri çekilmeyle yeniden dene.
        for attempt in range(7):
            resp = requests.post(
                self.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}, timeout=self.timeout
            )
            if resp.status_code in (429, 502, 503, 504) and attempt < 6:
                time.sleep(min(2 ** attempt, 20) * 0.5)
                continue
            break
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            raise ChainError(f"{method}: {body['error'].get('message', body['error'])}")
        return body["result"]

    def get_account(self, pubkey):
        value = self.call("getAccountInfo", [str(pubkey), {"encoding": "base64", "commitment": COMMITMENT}])["value"]
        if value is None:
            return None
        return {"owner": value["owner"], "data": base64.b64decode(value["data"][0])}

    def get_program_accounts(self, program_id, offset, raw: bytes, data_size=None):
        """memcmp süzgeci; raw 32 bayt (base58'e Pubkey ile çevrilir). data_size: hesap türünü ayırt eder."""
        flt = [{"memcmp": {"offset": offset, "bytes": str(Pubkey.from_bytes(raw))}}]
        if data_size:
            flt.append({"dataSize": data_size})
        items = self.call("getProgramAccounts", [str(program_id), {"encoding": "base64", "filters": flt, "commitment": COMMITMENT}])
        return [(it["pubkey"], base64.b64decode(it["account"]["data"][0])) for it in items]

    def latest_blockhash(self):
        return Hash.from_string(self.call("getLatestBlockhash", [{"commitment": COMMITMENT}])["value"]["blockhash"])

    def send(self, tx: Transaction):
        return self.call(
            "sendTransaction",
            [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64", "preflightCommitment": COMMITMENT}],
        )

    def confirm(self, signature, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            st = self.call("getSignatureStatuses", [[signature]])["value"][0]
            if st and st.get("err"):
                raise ChainError(f"işlem başarısız: {st['err']}")
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                return
            time.sleep(1.0)
        raise ChainError("işlem onaylanmadı (zaman aşımı)")

    def airdrop(self, pubkey, sol=1.0):
        sig = self.call("requestAirdrop", [str(pubkey), int(sol * 1_000_000_000)])
        self.confirm(sig)
        return sig

    def balance(self, pubkey):
        return self.call("getBalance", [str(pubkey), {"commitment": COMMITMENT}])["value"]


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


def fund_from(rpc, funder: Keypair, to, lamports: int):
    """Faucet yerine bir fon cüzdanından SOL aktarır (devnet airdrop hız sınırına takılınca)."""
    ix = system_transfer(TransferParams(from_pubkey=funder.pubkey(), to_pubkey=Pubkey.from_string(str(to)), lamports=lamports))
    blockhash = rpc.latest_blockhash()
    msg = Message.new_with_blockhash([ix], funder.pubkey(), blockhash)
    sig = rpc.send(Transaction([funder], msg, blockhash))
    rpc.confirm(sig)
    return sig


def ensure_funded(rpc, kp: Keypair, funder: Keypair = None, min_lamports=5_000_000, amount=20_000_000):
    """Bakiye düşükse fon cüzdanından transfer eder (yoksa airdrop dener). Devnet'te airdrop sık sınırlanır; funder tercih edin."""
    if rpc.balance(kp.pubkey()) >= min_lamports:
        return
    if funder is not None:
        fund_from(rpc, funder, kp.pubkey(), amount)
    else:
        rpc.airdrop(kp.pubkey(), 1)


def get_proof(rpc, pda):
    """PDA adresinden çözümlenmiş Proof ya da None."""
    acc = rpc.get_account(pda)
    return decode_proof(acc["data"]) if acc else None


def find_by_hash(rpc, document_hash: bytes, program_id=None):
    """İmzalayanı bilinmeyen belge: memcmp(ofset 41) ile tüm kayıtlar."""
    program_id = program_id or PROGRAM_ID
    return [{**decode_proof(d), "proof_pda": pk}
            for pk, d in rpc.get_program_accounts(program_id, HASH_OFFSET, document_hash, PROOF_SIZE)]


def list_by_signer(rpc, signer, program_id=None):
    program_id = program_id or PROGRAM_ID
    raw = bytes(Pubkey.from_string(str(signer)))
    return [{**decode_proof(d), "proof_pda": pk}
            for pk, d in rpc.get_program_accounts(program_id, SIGNER_OFFSET, raw, PROOF_SIZE)]


def find_agreements_by_hash(rpc, document_hash: bytes, program_id=None):
    program_id = program_id or PROGRAM_ID
    return [{**decode_agreement(d), "agreement_pda": pk}
            for pk, d in rpc.get_program_accounts(program_id, HASH_OFFSET, document_hash, AGREEMENT_SIZE)]


def list_agreements_for(rpc, party, program_id=None):
    """Bir cüzdanın taraf olduğu tüm sözleşmeler (4 olası taraf sırası için memcmp, birleşim)."""
    program_id = program_id or PROGRAM_ID
    raw, seen, out = bytes(Pubkey.from_string(str(party))), set(), []
    for i in range(MAX_PARTIES):
        for pk, d in rpc.get_program_accounts(program_id, AGREEMENT_PARTY_OFFSET + 32 * i, raw, AGREEMENT_SIZE):
            if pk not in seen:
                seen.add(pk)
                out.append({**decode_agreement(d), "agreement_pda": pk})
    return out


def _send_ix(rpc, ix, signers, payer):
    blockhash = rpc.latest_blockhash()
    msg = Message.new_with_blockhash([ix], payer.pubkey(), blockhash)
    uniq, seen = [], set()
    for k in [payer, *signers]:
        if str(k.pubkey()) not in seen:
            seen.add(str(k.pubkey()))
            uniq.append(k)
    sig = rpc.send(Transaction(uniq, msg, blockhash))
    rpc.confirm(sig)
    return sig


def create_agreement(rpc, creator: Keypair, document_hash: bytes, signers, program_id=None, payer: Keypair = None):
    """Çok imzalı sözleşme açar; creator `signers` içinde olmalı ve oluştururken imzalamış sayılır.
    -> {agreement_pda, tx_signature, creator, document_hash}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or creator
    pda, _ = derive_agreement_pda(program_id, creator.pubkey(), document_hash)
    ix = Instruction(
        Pubkey.from_string(str(program_id)),
        encode_create_agreement_data(document_hash, signers),
        [
            AccountMeta(creator.pubkey(), True, False),
            AccountMeta(payer.pubkey(), True, True),
            AccountMeta(pda, False, True),
            AccountMeta(SYSTEM_PROGRAM_ID, False, False),
        ],
    )
    sig = _send_ix(rpc, ix, [creator], payer)
    return {"agreement_pda": str(pda), "tx_signature": sig, "creator": str(creator.pubkey()), "document_hash": document_hash.hex()}


def co_sign(rpc, signer: Keypair, agreement_pda, program_id=None, payer: Keypair = None):
    """Sözleşmedeki kendi payını imzalar. -> {agreement_pda, tx_signature, signer}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or signer
    ix = Instruction(
        Pubkey.from_string(str(program_id)),
        CO_SIGN_DISC,
        [AccountMeta(signer.pubkey(), True, False), AccountMeta(Pubkey.from_string(str(agreement_pda)), False, True)],
    )
    sig = _send_ix(rpc, ix, [signer], payer)
    return {"agreement_pda": str(agreement_pda), "tx_signature": sig, "signer": str(signer.pubkey())}


def get_agreement(rpc, pda):
    acc = rpc.get_account(pda)
    return decode_agreement(acc["data"]) if acc and acc["data"][:8] == AGREEMENT_DISC else None


def _agreement_result(base, agreement, pda, received_hex):
    base.update(agreement=agreement, proof_pda=str(pda), original_hash=agreement["document_hash"])
    if agreement["document_hash"] != received_hex:
        base["status"] = "INVALID"
    else:
        base["status"] = "VERIFIED" if agreement["complete"] else "PENDING"
    return base


def verify(rpc, file_bytes: bytes, pda=None, signer=None, program_id=None):
    """API'siz doğrulama (CONTRACT.md v2, Bölüm 4).
    -> {status: VERIFIED|PENDING|INVALID|NOT_FOUND, original_hash, received_hash, proof_pda, proof}
    PENDING: hash tutuyor ama çok imzalı sözleşmenin tüm tarafları henüz imzalamadı (yanıtta `agreement`)."""
    program_id = program_id or PROGRAM_ID
    received = sha256_bytes(file_bytes)
    out = {"status": "NOT_FOUND", "original_hash": "", "received_hash": received.hex(), "proof_pda": None, "proof": None}

    if pda is None and signer is not None:
        pda = derive_proof_pda(program_id, signer, received)[0]
        if rpc.get_account(pda) is None:  # kayıt yoksa aynı imzalayanın sözleşmesine bak
            pda = derive_agreement_pda(program_id, signer, received)[0]
    if pda is not None:
        acc = rpc.get_account(pda)
        if acc is None:
            return out
        if acc["data"][:8] == AGREEMENT_DISC:
            return _agreement_result(out, decode_agreement(acc["data"]), pda, received.hex())
        if acc["data"][:8] != PROOF_DISC:
            return out
        proof = decode_proof(acc["data"])
        out.update(proof=proof, proof_pda=str(pda), original_hash=proof["document_hash"])
        out["status"] = "VERIFIED" if proof["document_hash"] == received.hex() else "INVALID"
        return out

    found = find_by_hash(rpc, received, program_id)
    if found:
        out.update(status="VERIFIED", proof=found[0], proof_pda=found[0]["proof_pda"], original_hash=received.hex(),
                   matches=len(found))
        return out
    agreements = find_agreements_by_hash(rpc, received, program_id)
    if agreements:
        done = [x for x in agreements if x["complete"]]
        best = (done or agreements)[0]
        _agreement_result(out, best, best["agreement_pda"], received.hex())
        out["matches"] = len(agreements)
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
        "notice": CERT_NOTICE,
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

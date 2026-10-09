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

CERT_NOTICE = "Timestamped integrity proof recorded on Solana. Not a qualified electronic signature (eIDAS); does not by itself prove the identity of a signer. Identity, when shown, comes from attestations by issuers you choose to trust."

MAX_PARENTS = 4
MAX_PARTIES = 4
NOTARIZE_DISC = hashlib.sha256(b"global:notarize").digest()[:8]
PROOF_DISC = hashlib.sha256(b"account:Proof").digest()[:8]
CREATE_AGREEMENT_DISC = hashlib.sha256(b"global:create_agreement").digest()[:8]
CO_SIGN_DISC = hashlib.sha256(b"global:co_sign").digest()[:8]
AGREEMENT_DISC = hashlib.sha256(b"account:Agreement").digest()[:8]
ATTEST_IDENTITY_DISC = hashlib.sha256(b"global:attest_identity").digest()[:8]
REVOKE_ATTESTATION_DISC = hashlib.sha256(b"global:revoke_attestation").digest()[:8]
REVOKE_PROOF_DISC = hashlib.sha256(b"global:revoke_proof").digest()[:8]
ATTESTATION_DISC = hashlib.sha256(b"account:Attestation").digest()[:8]
REVOCATION_DISC = hashlib.sha256(b"account:Revocation").digest()[:8]
MAX_LABEL = 32
ATTESTATION_SIZE, REVOCATION_SIZE = 166, 82
ATTEST_ISSUER_OFFSET, ATTEST_SUBJECT_OFFSET = 9, 41  # Attestation: disc 8 + version 1 -> issuer; + 32 -> subject
TRUST_LIST_PATH = Path(os.environ.get("NOTARY_TRUST_LIST") or Path(__file__).resolve().parent.parent / "docs" / "trusted_issuers.json")
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


def _iso(ts: int):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None


def derive_attestation_pda(program_id, issuer, subject):
    """seeds = [b"attest", issuer, subject] -> (Pubkey, bump)"""
    return Pubkey.find_program_address(
        [b"attest", bytes(Pubkey.from_string(str(issuer))), bytes(Pubkey.from_string(str(subject)))],
        Pubkey.from_string(str(program_id)),
    )


def derive_revocation_pda(program_id, proof_pda):
    """seeds = [b"revoke", proof_pda] -> (Pubkey, bump)"""
    return Pubkey.find_program_address([b"revoke", bytes(Pubkey.from_string(str(proof_pda)))], Pubkey.from_string(str(program_id)))


def claim_hash(evidence) -> bytes:
    """Zincir dışı kimlik kanıtının (metin ya da dosya baytları) SHA-256'sı. Kişisel veri zincire yazılmaz; yalnızca bu hash."""
    return sha256_bytes(evidence.encode("utf-8") if isinstance(evidence, str) else bytes(evidence))


def encode_attest_identity_data(subject, label: str, claim: bytes, expires_at: int = 0):
    raw = label.encode("utf-8")
    if not 1 <= len(raw) <= MAX_LABEL:
        raise ChainError(f"etiket 1 ile {MAX_LABEL} bayt arasında olmalı")
    if len(claim) != 32:
        raise ChainError("claim_hash 32 bayt olmalı")
    return (ATTEST_IDENTITY_DISC + bytes(Pubkey.from_string(str(subject))) + struct.pack("<I", len(raw)) + raw
            + claim + struct.pack("<q", expires_at))


def decode_attestation(data: bytes) -> dict:
    if data[:8] != ATTESTATION_DISC:
        raise ChainError("Attestation discriminator uyuşmuyor")
    o = 8
    version = data[o]
    o += 1
    issuer = Pubkey.from_bytes(data[o:o + 32])
    o += 32
    subject = Pubkey.from_bytes(data[o:o + 32])
    o += 32
    (n,) = struct.unpack_from("<I", data, o)
    o += 4
    label = data[o:o + n].decode("utf-8")
    o += n
    claim = data[o:o + 32]
    o += 32
    created_at, expires_at, revoked_at = struct.unpack_from("<qqq", data, o)
    o += 24
    return {
        "version": version, "issuer": str(issuer), "subject": str(subject), "label": label, "claim_hash": claim.hex(),
        "created_at": created_at, "created_at_iso": _iso(created_at),
        "expires_at": expires_at, "expires_at_iso": _iso(expires_at),
        "revoked_at": revoked_at, "revoked_at_iso": _iso(revoked_at),
        "bump": data[o],
    }


def decode_revocation(data: bytes) -> dict:
    if data[:8] != REVOCATION_DISC:
        raise ChainError("Revocation discriminator uyuşmuyor")
    (revoked_at,) = struct.unpack_from("<q", data, 8 + 1 + 32 + 32)
    return {
        "version": data[8], "proof": str(Pubkey.from_bytes(data[9:41])), "signer": str(Pubkey.from_bytes(data[41:73])),
        "revoked_at": revoked_at, "revoked_at_iso": _iso(revoked_at), "bump": data[8 + 1 + 32 + 32 + 8],
    }


def attestation_state(att: dict, now: int = None) -> str:
    """valid | expired | revoked (iptal, süre dolmasından önce gelir)."""
    now = int(time.time()) if now is None else now
    if att["revoked_at"]:
        return "revoked"
    if att["expires_at"] and att["expires_at"] <= now:
        return "expired"
    return "valid"


def load_trust_list(path=None) -> dict:
    """Güven listesi (eIDAS'taki Trusted List'in karşılığı): {issuer_pubkey: {label, ...}}. Dosya yoksa boş.
    Biçim: {"issuers": [{"pubkey": "...", "label": "..."}]}. Listede olmayan yayıncının beyanı 'tanınmayan yayıncı' sayılır."""
    path = Path(path) if path else TRUST_LIST_PATH
    try:
        return {i["pubkey"]: i for i in json.loads(path.read_text()).get("issuers", [])}
    except (OSError, ValueError):
        return {}


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
    """Belge hash'ini signer adına PDA olarak kaydeder. payer verilmezse signer öder; `payer=RelayPayer(url)` ile ücreti relayer öder.
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
    sig = _send_ix(rpc, ix, [signer], payer)  # payer bir RelayPayer olabilir
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


class RelayPayer:
    """Ücreti backend relayer'ı öder (kullanıcının SOL'ü gerekmez). `payer=RelayPayer(url)` olarak verilir; imzalayan yine kendisidir,
    relayer yalnızca ücret imzasını ekler ve gönderir (backend/app/relay.py)."""

    def __init__(self, url, timeout=30):
        self.url, self.timeout = url.rstrip("/"), timeout
        info = requests.get(f"{self.url}/relay/info", timeout=timeout).json()
        if not info.get("enabled"):
            raise ChainError("relayer kapalı ya da yapılandırılmamış")
        if info.get("low_balance"):
            raise ChainError("relayer bakiyesi yetersiz")
        self._pubkey = Pubkey.from_string(info["relayer_pubkey"])

    def pubkey(self):
        return self._pubkey

    def send(self, rpc, ix, signers):
        blockhash = rpc.latest_blockhash()
        tx = Transaction.new_unsigned(Message.new_with_blockhash([ix], self._pubkey, blockhash))
        tx.partial_sign(list(signers), blockhash)
        resp = requests.post(f"{self.url}/relay", json={"tx_base64": base64.b64encode(bytes(tx)).decode()}, timeout=self.timeout)
        if not resp.ok:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise ChainError(f"relay: {detail}")
        return resp.json()["tx_signature"]


def _send_ix(rpc, ix, signers, payer):
    if isinstance(payer, RelayPayer):
        return payer.send(rpc, ix, signers)
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


def list_attestations(rpc, subject, program_id=None):
    """Bir cüzdan hakkındaki tüm kimlik beyanları (memcmp: subject ofseti 41, dataSize 166)."""
    program_id = program_id or PROGRAM_ID
    raw = bytes(Pubkey.from_string(str(subject)))
    return [{**decode_attestation(d), "attestation_pda": pk}
            for pk, d in rpc.get_program_accounts(program_id, ATTEST_SUBJECT_OFFSET, raw, ATTESTATION_SIZE)]


def resolve_identity(rpc, subject, program_id=None, trusted=None, now=None) -> dict:
    """Bir cüzdanın kimliği: beyanlar ve güven düzeyi.
    level: trusted (güvenilen yayıncıdan geçerli beyan) | unrecognized_issuer (geçerli ama yayıncı listede yok) |
           self_declared (yalnızca kişinin kendi beyanı) | none. Süresi dolmuş ya da iptal edilmiş beyanlar sayılmaz."""
    trusted = load_trust_list() if trusted is None else trusted
    subject = str(subject)
    claims = []
    for a in list_attestations(rpc, subject, program_id):
        state = attestation_state(a, now)
        issuer_entry = trusted.get(a["issuer"])
        claims.append({**a, "state": state, "self": a["issuer"] == subject,
                       "trusted": bool(issuer_entry) and a["issuer"] != subject,
                       "issuer_label": issuer_entry.get("label") if issuer_entry else None})
    live = [c for c in claims if c["state"] == "valid"]
    best = next((c for c in live if c["trusted"]), None)
    level = "trusted" if best else None
    if not best:
        best = next((c for c in live if not c["self"]), None)
        level = "unrecognized_issuer" if best else None
    if not best:
        best = next((c for c in live if c["self"]), None)
        level = "self_declared" if best else "none"
    return {"subject": subject, "level": level, "label": best["label"] if best else None, "best": best, "claims": claims}


def attest_identity(rpc, issuer: Keypair, subject, label, evidence=b"", expires_at=0, program_id=None, payer: Keypair = None):
    """Kimlik beyanı. issuer == subject ise kişinin kendi kaydıdır; aksi halde bir yayıncının onayıdır.
    `evidence`: zincir dışı kanıt (yalnızca SHA-256'sı yazılır). Aynı (issuer, subject) için tekrar çağrı yeniler.
    -> {attestation_pda, tx_signature, issuer, subject}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or issuer
    pda, _ = derive_attestation_pda(program_id, issuer.pubkey(), subject)
    ix = Instruction(
        Pubkey.from_string(str(program_id)),
        encode_attest_identity_data(subject, label, claim_hash(evidence), expires_at),
        [
            AccountMeta(issuer.pubkey(), True, False),
            AccountMeta(payer.pubkey(), True, True),
            AccountMeta(pda, False, True),
            AccountMeta(SYSTEM_PROGRAM_ID, False, False),
        ],
    )
    sig = _send_ix(rpc, ix, [issuer], payer)
    return {"attestation_pda": str(pda), "tx_signature": sig, "issuer": str(issuer.pubkey()), "subject": str(subject)}


def revoke_attestation(rpc, issuer: Keypair, subject, program_id=None, payer: Keypair = None):
    """Yayıncı kendi beyanını geri çeker. -> {attestation_pda, tx_signature}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or issuer
    pda, _ = derive_attestation_pda(program_id, issuer.pubkey(), subject)
    ix = Instruction(
        Pubkey.from_string(str(program_id)), REVOKE_ATTESTATION_DISC,
        [AccountMeta(issuer.pubkey(), True, False), AccountMeta(pda, False, True)],
    )
    sig = _send_ix(rpc, ix, [issuer], payer)
    return {"attestation_pda": str(pda), "tx_signature": sig}


def revoke_proof(rpc, signer: Keypair, proof_pda, program_id=None, payer: Keypair = None):
    """İmzalayan kendi kaydını iptal eder (kayıt zincirde kalır, durum REVOKED olur). -> {revocation_pda, tx_signature}"""
    program_id = program_id or PROGRAM_ID
    if not program_id:
        raise ChainError("PROGRAM_ID tanımlı değil")
    payer = payer or signer
    rev, _ = derive_revocation_pda(program_id, proof_pda)
    ix = Instruction(
        Pubkey.from_string(str(program_id)), REVOKE_PROOF_DISC,
        [
            AccountMeta(signer.pubkey(), True, False),
            AccountMeta(payer.pubkey(), True, True),
            AccountMeta(Pubkey.from_string(str(proof_pda)), False, False),
            AccountMeta(rev, False, True),
            AccountMeta(SYSTEM_PROGRAM_ID, False, False),
        ],
    )
    sig = _send_ix(rpc, ix, [signer], payer)
    return {"revocation_pda": str(rev), "tx_signature": sig, "proof_pda": str(proof_pda)}


def get_revocation(rpc, proof_pda, program_id=None):
    program_id = program_id or PROGRAM_ID
    acc = rpc.get_account(derive_revocation_pda(program_id, proof_pda)[0])
    return decode_revocation(acc["data"]) if acc and acc["data"][:8] == REVOCATION_DISC else None


def _agreement_result(base, agreement, pda, received_hex):
    base.update(agreement=agreement, proof_pda=str(pda), original_hash=agreement["document_hash"])
    if agreement["document_hash"] != received_hex:
        base["status"] = "INVALID"
    else:
        base["status"] = "VERIFIED" if agreement["complete"] else "PENDING"
    return base


def _verify_core(rpc, file_bytes: bytes, pda=None, signer=None, program_id=None):
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


def verify(rpc, file_bytes: bytes, pda=None, signer=None, program_id=None, trust=None, identity=True):
    """API'siz doğrulama (CONTRACT.md v2, Bölüm 4 ve 4a).
    -> {status: VERIFIED|PENDING|REVOKED|INVALID|NOT_FOUND, original_hash, received_hash, proof_pda, proof, identity}
    REVOKED: hash tutuyor ama imzalayan kaydını iptal etmiş (yanıtta `revocation`).
    identity: imzalayanın kimlik düzeyi (`resolve_identity`); `identity=False` ile ek sorgu yapılmaz.
    `trust`: güvenilen yayıncılar sözlüğü (varsayılan: docs/trusted_issuers.json)."""
    program_id = program_id or PROGRAM_ID
    out = _verify_core(rpc, file_bytes, pda=pda, signer=signer, program_id=program_id)
    proof = out.get("proof")
    if proof and out["status"] == "VERIFIED":
        rev = get_revocation(rpc, out["proof_pda"], program_id)
        if rev:
            out["status"], out["revocation"] = "REVOKED", rev
    if identity:
        try:
            if proof:
                out["identity"] = resolve_identity(rpc, proof["signer"], program_id, trust)
            elif out.get("agreement"):
                for party in out["agreement"]["parties"]:
                    party["identity"] = resolve_identity(rpc, party["signer"], program_id, trust)
        except (ChainError, OSError, ValueError) as exc:  # kimlik tamamlayıcıdır; doğrulamayı düşürmesin
            out["identity_error"] = str(exc)
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
        # Sertifika tek başına bir şey kanıtlamaz; zincirdeki hesaba işaret eder. Herkes bu adımlarla bağımsız doğrulayabilir.
        "how_to_verify": {
            "spec": "CONTRACT.md section 4",
            "steps": [
                "hash = sha256(file)",
                "account = getAccountInfo(proof_pda); owner must be program_id and discriminator must match Proof",
                "status is VERIFIED if the recorded document_hash equals hash",
                "check getAccountInfo(find_program_address([b\"revoke\", proof_pda])) is empty, otherwise the record is REVOKED",
            ],
            "cli": f"python agents/verify_standalone.py <file> --pda {proof_pda} --program {program_id} --rpc <rpc>",
        },
    }

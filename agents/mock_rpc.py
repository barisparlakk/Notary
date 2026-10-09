# v2 testleri/demo için sahte Solana JSON-RPC sunucusu: notary programının davranışını bellekte taklit eder.
# Gerçek program derlenip deploy edilene kadar agent tarafını (ve frontend demosunu) sınamak içindir.
import base64
import json
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from solders.hash import Hash
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction

import onchain

SPACE = 247


class MockChain:
    def __init__(self, program_id):
        self.program_id = Pubkey.from_string(str(program_id))
        self.accounts = {}   # pubkey(str) -> bytes (SPACE uzunluğunda)
        self.balances = {}
        self.statuses = {}   # signature -> err | None
        self.lock = threading.Lock()

    # --- program davranışı (Anchor programının birebir taklidi)
    def _execute(self, tx: Transaction):
        msg = tx.message
        if len(msg.instructions) != 1:
            raise ValueError("tek talimat bekleniyor")
        ix = msg.instructions[0]
        if msg.account_keys[ix.program_id_index] == SYSTEM_PROGRAM_ID:  # sistem transferi (fon cüzdanı akışı)
            data = bytes(ix.data)
            if struct.unpack_from("<I", data)[0] != 2:
                raise ValueError("desteklenmeyen sistem talimatı")
            src, dst = (str(msg.account_keys[i]) for i in ix.accounts[:2])
            (lamports,) = struct.unpack_from("<Q", data, 4)
            if self.balances.get(src, 0) < lamports:
                raise ValueError("insufficient funds")
            self.balances[src] -= lamports
            self.balances[dst] = self.balances.get(dst, 0) + lamports
            return
        if msg.account_keys[ix.program_id_index] != self.program_id:
            raise ValueError("bilinmeyen program")
        data = bytes(ix.data)
        signed = {str(k) for k in msg.account_keys[: msg.header.num_required_signatures]}
        accts = [msg.account_keys[i] for i in ix.accounts]
        if data[:8] == onchain.CREATE_AGREEMENT_DISC:
            return self._create_agreement(data, accts, signed)
        if data[:8] == onchain.CO_SIGN_DISC:
            return self._co_sign(accts, signed)
        if data[:8] == onchain.ATTEST_IDENTITY_DISC:
            return self._attest_identity(data, accts, signed)
        if data[:8] == onchain.REVOKE_ATTESTATION_DISC:
            return self._revoke_attestation(accts, signed)
        if data[:8] == onchain.REVOKE_PROOF_DISC:
            return self._revoke_proof(accts, signed)
        if data[:8] != onchain.NOTARIZE_DISC:
            raise ValueError("bilinmeyen talimat")
        signer, payer, proof, sysprog = accts
        if str(signer) not in signed or str(payer) not in signed:
            raise ValueError("signer/payer imzası eksik")
        if sysprog != SYSTEM_PROGRAM_ID:
            raise ValueError("system program yanlış")

        o = 8
        document_hash = data[o:o + 32]
        o += 32
        receiver = None
        if data[o] == 1:
            receiver = data[o + 1:o + 33]
            o += 33
        else:
            o += 1
        (n,) = struct.unpack_from("<I", data, o)
        o += 4
        parents = [data[o + 32 * i:o + 32 * (i + 1)] for i in range(n)]

        if n > onchain.MAX_PARENTS:
            raise ValueError("TooManyParents")
        if len(set(parents)) != n:
            raise ValueError("DuplicateParent")
        expected, bump = onchain.derive_proof_pda(self.program_id, signer, document_hash)
        if proof != expected:
            raise ValueError("ConstraintSeeds")
        if str(proof) in self.accounts:
            raise ValueError("account already in use")

        raw = onchain.PROOF_DISC + b"\x01" + bytes(signer) + document_hash
        raw += (b"\x01" + receiver) if receiver else b"\x00"
        raw += struct.pack("<q", int(time.time())) + struct.pack("<I", n) + b"".join(parents) + bytes([bump])
        self.accounts[str(proof)] = raw + b"\x00" * (SPACE - len(raw))

    def _account_json(self, raw):
        """Gerçek Solana RPC'nin hesap nesnesindeki tüm alanlar (web3.js şema doğrulaması bunları ister)."""
        return {"lamports": 2_000_000, "owner": str(self.program_id), "executable": False, "rentEpoch": 0,
                "space": len(raw), "data": [base64.b64encode(raw).decode(), "base64"]}

    def _create_agreement(self, data, accts, signed):
        creator, payer, agreement, sysprog = accts
        if str(creator) not in signed or str(payer) not in signed:
            raise ValueError("creator/payer imzası eksik")
        if sysprog != SYSTEM_PROGRAM_ID:
            raise ValueError("system program yanlış")
        document_hash = data[8:40]
        (n,) = struct.unpack_from("<I", data, 40)
        keys = [data[44 + 32 * i:44 + 32 * (i + 1)] for i in range(n)]
        if not 2 <= n <= onchain.MAX_PARTIES:
            raise ValueError("BadPartyCount")
        if len(set(keys)) != n:
            raise ValueError("DuplicateSigner")
        if bytes(creator) not in keys:
            raise ValueError("CreatorNotParty")
        expected, bump = onchain.derive_agreement_pda(self.program_id, creator, document_hash)
        if agreement != expected:
            raise ValueError("ConstraintSeeds")
        if str(agreement) in self.accounts:
            raise ValueError("account already in use")
        now = int(time.time())
        signed_at = [now if k == bytes(creator) else 0 for k in keys]
        raw = onchain.AGREEMENT_DISC + b"\x01" + bytes(creator) + document_hash + struct.pack("<q", now)
        raw += struct.pack("<I", n) + b"".join(keys) + struct.pack("<I", n) + struct.pack(f"<{n}q", *signed_at) + bytes([bump])
        self.accounts[str(agreement)] = raw + b"\x00" * (onchain.AGREEMENT_SIZE - len(raw))

    def _co_sign(self, accts, signed):
        signer, agreement = accts
        if str(signer) not in signed:
            raise ValueError("signer imzası eksik")
        raw = self.accounts.get(str(agreement))
        if raw is None or raw[:8] != onchain.AGREEMENT_DISC:
            raise ValueError("AccountNotInitialized")
        a = onchain.decode_agreement(raw)
        idx = next((i for i, p in enumerate(a["parties"]) if p["signer"] == str(signer)), None)
        if idx is None:
            raise ValueError("NotAParty")
        if a["parties"][idx]["signed_at"]:
            raise ValueError("AlreadySigned")
        n = len(a["parties"])
        base = 8 + 1 + 32 + 32 + 8 + 4 + 32 * n + 4  # signed_at vektörünün ilk eleman ofseti
        patched = bytearray(raw)
        struct.pack_into("<q", patched, base + 8 * idx, int(time.time()))
        self.accounts[str(agreement)] = bytes(patched)

    def _attest_identity(self, data, accts, signed):
        issuer, payer, attestation, sysprog = accts
        if str(issuer) not in signed or str(payer) not in signed:
            raise ValueError("issuer/payer imzası eksik")
        if sysprog != SYSTEM_PROGRAM_ID:
            raise ValueError("system program yanlış")
        subject = Pubkey.from_bytes(data[8:40])
        (n,) = struct.unpack_from("<I", data, 40)
        label = data[44:44 + n]
        claim = data[44 + n:76 + n]
        (expires_at,) = struct.unpack_from("<q", data, 76 + n)
        if not 1 <= n <= onchain.MAX_LABEL:
            raise ValueError("BadLabel")
        now = int(time.time())
        if expires_at != 0 and expires_at <= now:
            raise ValueError("BadExpiry")
        expected, bump = onchain.derive_attestation_pda(self.program_id, issuer, subject)
        if attestation != expected:
            raise ValueError("ConstraintSeeds")
        # init_if_needed: son beyan geçerlidir (yenileme, geri çekilmiş beyanı da tazeler)
        raw = (onchain.ATTESTATION_DISC + b"\x01" + bytes(issuer) + bytes(subject) + struct.pack("<I", n) + label + claim
               + struct.pack("<qqq", now, expires_at, 0) + bytes([bump]))
        self.accounts[str(attestation)] = raw + b"\x00" * (onchain.ATTESTATION_SIZE - len(raw))

    def _revoke_attestation(self, accts, signed):
        issuer, attestation = accts
        if str(issuer) not in signed:
            raise ValueError("issuer imzası eksik")
        raw = self.accounts.get(str(attestation))
        if raw is None or raw[:8] != onchain.ATTESTATION_DISC:
            raise ValueError("AccountNotInitialized")
        a = onchain.decode_attestation(raw)
        if a["issuer"] != str(issuer):
            raise ValueError("NotTheIssuer")
        if a["revoked_at"]:
            raise ValueError("AlreadyRevoked")
        n = len(a["label"].encode("utf-8"))
        patched = bytearray(raw)
        struct.pack_into("<q", patched, 8 + 1 + 32 + 32 + 4 + n + 32 + 16, int(time.time()))  # revoked_at
        self.accounts[str(attestation)] = bytes(patched)

    def _revoke_proof(self, accts, signed):
        signer, payer, proof, revocation, sysprog = accts
        if str(signer) not in signed or str(payer) not in signed:
            raise ValueError("signer/payer imzası eksik")
        if sysprog != SYSTEM_PROGRAM_ID:
            raise ValueError("system program yanlış")
        raw = self.accounts.get(str(proof))
        if raw is None or raw[:8] != onchain.PROOF_DISC:
            raise ValueError("AccountNotInitialized")
        if onchain.decode_proof(raw)["signer"] != str(signer):
            raise ValueError("NotTheSigner")
        expected, bump = onchain.derive_revocation_pda(self.program_id, proof)
        if revocation != expected:
            raise ValueError("ConstraintSeeds")
        if str(revocation) in self.accounts:
            raise ValueError("account already in use")
        self.accounts[str(revocation)] = (onchain.REVOCATION_DISC + b"\x01" + bytes(proof) + bytes(signer)
                                          + struct.pack("<q", int(time.time())) + bytes([bump]))

    # --- JSON-RPC
    def handle(self, method, params):
        result = self._handle(method, params)
        # Gerçek RPC, "value" taşıyan yanıtlara context.slot ekler; web3.js bunu şema olarak zorunlu tutar.
        if isinstance(result, dict) and "value" in result and "context" not in result:
            result = {"context": {"slot": 1}, **result}
        return result

    def _handle(self, method, params):
        with self.lock:
            if method == "getLatestBlockhash":
                return {"value": {"blockhash": str(Hash.new_unique()), "lastValidBlockHeight": 1}}
            if method == "sendTransaction":
                tx = Transaction.from_bytes(base64.b64decode(params[0]))
                sig = str(tx.signatures[0])
                try:
                    self._execute(tx)
                    self.statuses[sig] = None
                except ValueError as exc:
                    raise RuntimeError(f"Transaction simulation failed: {exc}") from exc
                return sig
            if method == "getSignatureStatuses":
                return {"value": [
                    {"slot": 1, "confirmations": None, "err": self.statuses[s], "status": {"Ok": None}, "confirmationStatus": "confirmed"}
                    if s in self.statuses else None
                    for s in params[0]
                ]}
            if method == "getAccountInfo":
                raw = self.accounts.get(params[0])
                if raw is None:
                    return {"value": None}
                return {"value": self._account_json(raw)}
            if method == "getProgramAccounts":
                if params[0] != str(self.program_id):
                    return []
                out = []
                for pk, raw in self.accounts.items():
                    if all(self._filter(raw, f) for f in params[1].get("filters", [])):
                        out.append({"pubkey": pk, "account": self._account_json(raw)})
                return out
            if method == "requestAirdrop":
                self.balances[params[0]] = self.balances.get(params[0], 0) + params[1]
                sig = f"airdrop{len(self.statuses)}"
                self.statuses[sig] = None
                return sig
            if method == "getBalance":
                return {"value": self.balances.get(params[0], 0)}
            raise RuntimeError(f"mock_rpc: desteklenmeyen yöntem {method}")

    @staticmethod
    def _filter(raw, f):
        if "dataSize" in f:
            return len(raw) == f["dataSize"]
        return MockChain._memcmp(raw, f["memcmp"])

    @staticmethod
    def _memcmp(raw, m):
        want = bytes(Pubkey.from_string(m["bytes"]))
        return raw[m["offset"]:m["offset"] + len(want)] == want


def start(program_id, port=0):
    """Arka planda başlatır. -> (url, MockChain, server)"""
    chain = MockChain(program_id)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            try:
                body = {"jsonrpc": "2.0", "id": req["id"], "result": chain.handle(req["method"], req.get("params", []))}
            except Exception as exc:
                body = {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32002, "message": str(exc)}}
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):  # tarayıcıdan (frontend) çağrı için CORS
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()

    server = HTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}", chain, server


if __name__ == "__main__":
    import argparse
    import json as _json
    from pathlib import Path

    ap = argparse.ArgumentParser(description="Sahte Solana RPC (v2 geliştirme/demo)")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--program-id", default=_json.loads((Path(__file__).parent.parent / "docs" / "test_vectors_v2.json").read_text())["program_id"])
    a = ap.parse_args()
    url, _, _ = start(a.program_id, a.port)
    print(f"mock RPC: {url}  program: {a.program_id}")
    threading.Event().wait()

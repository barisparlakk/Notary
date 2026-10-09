#!/usr/bin/env python3
# Bağımsız doğrulayıcı: Notary API'sine GEREK DUYMAZ, yalnızca bir Solana RPC'si (CONTRACT.md v2, Bölüm 4).
#   python verify_standalone.py belge.pdf --pda <PDA>
#   python verify_standalone.py belge.pdf --signer <PUBKEY>
#   python verify_standalone.py belge.pdf                      (imzalayan bilinmiyorsa hash ile arar)
#   python verify_standalone.py belge.pdf --pda <PDA> --trust <YAYINCI_PUBKEY>   (yayıncıya güven: kimlik "trusted" olur)
# Çıkış kodu: 0 VERIFIED, 1 INVALID, 2 NOT_FOUND, 3 REVOKED (imzalayan iptal etmiş), 4 PENDING (sözleşmede imza eksik).
import argparse
import json
import sys
from pathlib import Path

import onchain

EXIT = {"VERIFIED": 0, "INVALID": 1, "NOT_FOUND": 2, "REVOKED": 3, "PENDING": 4}
LEVELS = {
    "trusted": "kimlik güvenilen yayıncı tarafından onaylı",
    "unrecognized_issuer": "kimlik beyanı var ama yayıncı güven listesinde değil",
    "self_declared": "yalnızca kişinin kendi beyanı (bağımsız onay yok)",
    "none": "kimlik beyanı yok (yalnızca cüzdan adresi)",
}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Notary: API'siz belge doğrulama")
    ap.add_argument("file")
    ap.add_argument("--pda", help="sertifikadaki proof_pda")
    ap.add_argument("--signer", help="imzalayan public key (base58)")
    ap.add_argument("--rpc", default=onchain.RPC_URL)
    ap.add_argument("--program", default=onchain.PROGRAM_ID, help="PROGRAM_ID (env: PROGRAM_ID)")
    ap.add_argument("--trust", action="append", default=[], metavar="PUBKEY", help="güvenilen yayıncı (tekrarlanabilir)")
    ap.add_argument("--trust-list", help="güven listesi JSON (varsayılan: docs/trusted_issuers.json)")
    ap.add_argument("--no-identity", action="store_true", help="kimlik sorgusunu atla")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.program:
        ap.error("--program ya da PROGRAM_ID env gerekli")

    trust = onchain.load_trust_list(a.trust_list)
    trust.update({k: {"pubkey": k, "label": "--trust"} for k in a.trust})
    res = onchain.verify(onchain.Rpc(a.rpc), Path(a.file).read_bytes(), pda=a.pda, signer=a.signer, program_id=a.program,
                         trust=trust, identity=not a.no_identity)
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        print(res["status"])
        print(f"  alınan hash : {res['received_hash']}")
        if res["original_hash"]:
            print(f"  kayıtlı hash: {res['original_hash']}")
        if res["proof"]:
            p = res["proof"]
            print(f"  imzalayan   : {p['signer']}\n  zaman       : {p['created_at_iso']}\n  PDA         : {res['proof_pda']}")
        if res.get("revocation"):
            print(f"  İPTAL       : imzalayan bu kaydı {res['revocation']['revoked_at_iso']} tarihinde iptal etti")
        ident = res.get("identity")
        if ident:
            who = f" ({ident['label']}" + (f", yayıncı: {ident['best']['issuer_label'] or ident['best']['issuer']}" if ident["best"] and not ident["best"]["self"] else "") + ")" if ident["label"] else ""
            print(f"  kimlik      : {ident['level']}{who}: {LEVELS[ident['level']]}")
    return EXIT[res["status"]]


if __name__ == "__main__":
    sys.exit(main())

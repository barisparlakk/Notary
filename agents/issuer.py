#!/usr/bin/env python3
# Kimlik yayıncısı (issuer) aracı: bir cüzdan için "bu cüzdan şu kişidir" beyanı verir ve geri çeker (CONTRACT.md 4a).
# eIDAS'taki güven sağlayıcının karşılığıdır: beyanın değeri, yayıncının güven listesinde olmasından gelir (docs/trusted_issuers.json).
# Kişisel veri zincire yazılmaz: yalnızca etiket (görünen ad) ve kanıtın SHA-256'sı.
#
#   python issuer.py attest --keypair ~/.config/notary/demo-issuer.json --subject <PUBKEY> --name "Ahmet Yilmaz" \
#          --evidence-file kimlik-kontrol-kaydi.pdf --days 365 [--relay https://notary-relay.vercel.app]
#   python issuer.py revoke --keypair ... --subject <PUBKEY>
#   python issuer.py show   --subject <PUBKEY>
# Ortam: SOLANA_RPC_URL, PROGRAM_ID (ya da --rpc / --program).
import argparse
import json
import sys
import time
from pathlib import Path

import onchain


def main(argv=None):
    ap = argparse.ArgumentParser(description="Notary kimlik yayıncısı")
    ap.add_argument("command", choices=["attest", "revoke", "show"])
    ap.add_argument("--keypair", help="yayıncının anahtarı (Solana CLI JSON); attest ve revoke için")
    ap.add_argument("--subject", required=True, help="beyanın konusu olan cüzdan (base58)")
    ap.add_argument("--name", help="görünen ad (1-32 bayt)")
    ap.add_argument("--evidence", help="zincir dışı kanıt metni (yalnızca SHA-256'sı yazılır)")
    ap.add_argument("--evidence-file", help="zincir dışı kanıt dosyası (yalnızca SHA-256'sı yazılır)")
    ap.add_argument("--days", type=int, default=0, help="geçerlilik süresi (gün); 0 = süresiz")
    ap.add_argument("--relay", help="relayer adresi: ücreti relayer öder, yayıncının SOL'ü gerekmez")
    ap.add_argument("--rpc", default=onchain.RPC_URL)
    ap.add_argument("--program", default=onchain.PROGRAM_ID)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not a.program:
        ap.error("--program ya da PROGRAM_ID env gerekli")
    rpc = onchain.Rpc(a.rpc)

    if a.command == "show":
        ident = onchain.resolve_identity(rpc, a.subject, a.program)
        if a.json:
            print(json.dumps(ident, indent=2))
        else:
            print(f"düzey: {ident['level']}  ad: {ident['label']}")
            for c in ident["claims"]:
                who = c["issuer_label"] or c["issuer"]
                print(f"  {c['state']:8} {c['label']!r} yayıncı={who}{' (kendi beyanı)' if c['self'] else ''} bitiş={c['expires_at_iso'] or 'süresiz'}")
        return 0

    if not a.keypair:
        ap.error("--keypair gerekli")
    issuer = onchain.load_keypair(Path(a.keypair).expanduser())
    payer = onchain.RelayPayer(a.relay) if a.relay else None

    if a.command == "attest":
        if not a.name:
            ap.error("--name gerekli")
        evidence = Path(a.evidence_file).read_bytes() if a.evidence_file else (a.evidence or "")
        if not evidence:
            print("uyarı: kanıt verilmedi; beyan boş bir kanıt hash'i taşır", file=sys.stderr)
        expires = int(time.time()) + a.days * 86400 if a.days else 0
        out = onchain.attest_identity(rpc, issuer, a.subject, a.name, evidence, expires, program_id=a.program, payer=payer)
    else:
        out = onchain.revoke_attestation(rpc, issuer, a.subject, program_id=a.program, payer=payer)
    print(json.dumps(out, indent=2) if a.json else f"{a.command} tamam: {out['attestation_pda']}\n  işlem: {out['tx_signature']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

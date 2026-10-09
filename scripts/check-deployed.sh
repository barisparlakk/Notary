#!/usr/bin/env bash
# Zincirdeki program ikilisinin SHA-256'sını docs/deployment.json'daki kayıtla karşılaştırır. Anahtar ya da yetki gerekmez.
# Bu, "devnet'te çalışan ikili, bizim kayıt altına aldığımız ikili" der; kaynak kodla eşleştirmek için scripts/verify-program.sh.
# Kullanım: scripts/check-deployed.sh [rpc]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/solana-toolchain/solana-release/bin:$PATH"
RPC="${1:-${SOLANA_RPC_URL:-https://api.devnet.solana.com}}"
read -r PROGRAM_ID WANT < <(python3 -c "import json;d=json.load(open('$ROOT/docs/deployment.json'));print(d['program_id'],d['so_sha256'])")
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
solana program dump "$PROGRAM_ID" "$TMP/live.so" --url "$RPC" >/dev/null
GOT="$(shasum -a 256 "$TMP/live.so" | awk '{print $1}')"
echo "program : $PROGRAM_ID"
echo "zincirde: $GOT"
echo "kayıtlı : $WANT"
[ "$GOT" = "$WANT" ] && echo "EŞLEŞİYOR" || { echo "UYUŞMUYOR: program yükseltilmiş ama docs/deployment.json güncellenmemiş olabilir"; exit 1; }

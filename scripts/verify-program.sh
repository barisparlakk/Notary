#!/usr/bin/env bash
# Zincirdeki programın bu repodaki KAYNAKTAN derlendiğini kanıtlar (solana-verify, tekrarlanabilir Docker derlemesi).
# Gereksinimler: Docker (çalışıyor olmalı) ve `cargo install solana-verify`.
#
# DURUM: bu script yazıldı ama bu depoda henüz ÇALIŞTIRILMADI (geliştirme makinesinde Docker kapalıydı).
# Önemli: yalnızca doğrulanabilir derlemeyle (solana-verify build) üretilmiş ve o ikiliyle deploy edilmiş programlar eşleşir.
# Şu an devnet'teki program `cargo build-sbf` ile derlendi; eşleşme için bir kez şöyle yeniden yayınlayın:
#   solana-verify build --library-name notary -- --arch v3   # (program/ içinde)
#   solana program deploy program/target/deploy/notary.so --program-id <anahtar> --keypair <deployer> --url devnet
# Sonra bu scripti çalıştırın.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/solana-toolchain/solana-release/bin:$PATH"
command -v solana-verify >/dev/null || { echo "solana-verify yok: cargo install solana-verify"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker çalışmıyor"; exit 1; }
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_ID="$(python3 -c "import json;print(json.load(open('$ROOT/docs/deployment.json'))['program_id'])")"
REPO="${NOTARY_REPO_URL:-https://github.com/barisparlakk/Notary}"
# Yerel kaynakla zincirdeki ikili aynı mı?
(cd "$ROOT/program" && solana-verify verify-from-repo --url "$RPC" --program-id "$PROGRAM_ID" \
  --library-name notary --mount-path program "$REPO")

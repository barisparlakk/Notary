#!/usr/bin/env bash
# Notary programını derler, devnet'e deploy eder, docs/deployment.json'u yazar ve uçtan uca sınar.
# Gereksinimler: Rust, Solana CLI (cargo build-sbf), node. Anahtarlar repo dışında: ~/.config/notary/
#   deployer.json (SOL'lü), program-keypair.json (program kimliği = declare_id!)
# Kullanım: scripts/deploy-devnet.sh            (varsayılan RPC: https://api.devnet.solana.com)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
KEYS="${NOTARY_KEYS_DIR:-$HOME/.config/notary}"
export PATH="$HOME/.cargo/bin:$HOME/solana-toolchain/solana-release/bin:$PATH"

command -v solana >/dev/null || { echo "solana CLI bulunamadı"; exit 1; }
PROGRAM_ID="$(solana-keygen pubkey "$KEYS/program-keypair.json")"
DEPLOYER="$(solana-keygen pubkey "$KEYS/deployer.json")"
DECLARED="$(grep -o 'declare_id!("[^"]*")' "$ROOT/program/programs/notary/src/lib.rs" | sed 's/.*("\(.*\)")/\1/')"
[ "$PROGRAM_ID" = "$DECLARED" ] || { echo "declare_id! ($DECLARED) program anahtarıyla ($PROGRAM_ID) uyuşmuyor"; exit 1; }

echo "== derleniyor"
# v3: yerel doğrulayıcı (Agave 4.3) v0-v2 dağıtımını reddeder; devnet'te SBPF v3 etkin (slot 461808000)
(cd "$ROOT/program/programs/notary" && cargo build-sbf --arch v3)
SO="$ROOT/program/target/deploy/notary.so"
[ -f "$SO" ] || SO="$ROOT/program/programs/notary/target/deploy/notary.so"

BAL="$(solana balance "$DEPLOYER" --url "$RPC" | awk '{print $1}')"
echo "== deployer $DEPLOYER bakiye: $BAL SOL (en az ~2.5 SOL gerekir)"
python3 - "$BAL" <<'PY'
import sys
if float(sys.argv[1]) < 2.5:
    sys.exit("Yetersiz bakiye: deployer adresine devnet SOL gönderin (https://faucet.solana.com)")
PY

echo "== deploy ediliyor: $PROGRAM_ID"
solana program deploy "$SO" --program-id "$KEYS/program-keypair.json" --keypair "$KEYS/deployer.json" --url "$RPC" --max-sign-attempts 60

SHA="$(shasum -a 256 "$SO" | awk '{print $1}')"
cat > "$ROOT/docs/deployment.json" <<JSON
{
  "cluster": "devnet",
  "program_id": "$PROGRAM_ID",
  "upgrade_authority": "$DEPLOYER",
  "rpc": "$RPC",
  "so_sha256": "$SHA",
  "toolchain": "agave $(solana --version | awk '{print $2}'), anchor-lang 1.2.0",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "explorer_url": "https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
}
JSON
echo "== docs/deployment.json yazıldı"
solana program show "$PROGRAM_ID" --url "$RPC" --keypair "$KEYS/deployer.json"

#!/usr/bin/env bash
# Relayer'ı (backend/app/relay.py) Vercel'e durumsuz bir fonksiyon olarak yayınlar.
# Gerekli: vercel CLI girişi, ~/.config/notary/relayer.json (devnet SOL'lü), docs/deployment.json ya da PROGRAM_ID env.
#   scripts/deploy-relay.sh            -> URL'yi basar; frontend'e VITE_API_URL olarak verin
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="${NOTARY_KEYS_DIR:-$HOME/.config/notary}"
export PATH="$HOME/.cargo/bin:$HOME/solana-toolchain/solana-release/bin:$PATH"
VERCEL="${VERCEL_BIN:-vercel}"
PROGRAM_ID="${PROGRAM_ID:-$(python3 -c "import json;print(json.load(open('$ROOT/docs/deployment.json'))['program_id'])" 2>/dev/null || solana-keygen pubkey "$KEYS/program-keypair.json")}"
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"

WORK="$(mktemp -d)"
mkdir -p "$WORK/app"
cp -R "$ROOT/backend/vercel-relay/." "$WORK/"
cp "$ROOT/backend/app/__init__.py" "$ROOT/backend/app/models.py" "$ROOT/backend/app/relay.py" "$ROOT/backend/app/solana_client.py" "$WORK/app/"
cd "$WORK"

$VERCEL link --yes --project notary-relay >/dev/null
setenv() { printf '%s' "$2" | $VERCEL env add "$1" production --force >/dev/null; }
setenv PROGRAM_ID "$PROGRAM_ID"
setenv SOLANA_RPC_URL "$RPC"
setenv SOLANA_PRIVATE_KEY "$(cat "$KEYS/relayer.json")"
setenv RELAY_RATE_LIMIT "20"
$VERCEL deploy --prod --yes

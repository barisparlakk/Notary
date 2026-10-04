# Notary

AI agent'ları ve insanlar için **doğrulanabilir belge kanıtı**. Her belgenin SHA-256 parmak izi, imzalayanın cüzdanıyla
Solana'da bir **PDA hesabına** (`["proof", signer, hash]`) yazılır. Doğrulama zincirden okunur: **API çökse bile çalışır.**

- Sözleşme: [CONTRACT.md](CONTRACT.md) (v2; v1 Ek A'da)
- Demo kılavuzu: [docs/DEMO_V2.md](docs/DEMO_V2.md)

| Klasör | İçerik |
|---|---|
| `program/` | Solana programı (Anchor, `cargo build-sbf --arch v3`) |
| `agents/` | Python agent'ları: `onchain.py` (zincir istemcisi), `verify_standalone.py` (API'siz doğrulayıcı), `demo_v2.py` |
| `frontend/` | React arayüzü: cüzdan imzası, zincirden doğrulama, DEMO modu |
| `backend/` | Opsiyonel yardımcılar: `/relay` (ücreti ödeyen), v1 REST (geçiş dönemi) |
| `scripts/` | `deploy-devnet.sh`, `deploy-relay.sh` |

## Hızlı başlangıç (yerel, gerçek Solana runtime'ı)
```bash
solana-test-validator --reset &
solana program deploy program/target/deploy/notary.so --program-id <program-keypair.json> --keypair <fonlu.json> --url http://127.0.0.1:8899
cd agents && pip install -r requirements.txt && python demo_v2.py --rpc http://127.0.0.1:8899 --program <PROGRAM_ID> --funder <fonlu.json>
```
Sahte RPC ile (Solana kurmadan): `python agents/demo_v2.py --mock`. Frontend: [frontend/README.md](frontend/README.md).

## Sınırlar
- Kanıt, "bu cüzdan bu içeriği bu zamanda kaydetti ve sonra değişmedi" der. Hukuken nitelikli e-imzaya (eIDAS) eşdeğer **değildir**.
- Zincire dosya değil yalnızca hash ve public key yazılır; kişisel veri yazmayın (kayıt silinemez).

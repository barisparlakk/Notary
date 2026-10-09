# Notary

AI agent'ları ve insanlar için **doğrulanabilir belge kanıtı**. Her belgenin SHA-256 parmak izi, imzalayanın cüzdanıyla
Solana'da bir **PDA hesabına** (`["proof", signer, hash]`) yazılır. Doğrulama zincirden okunur: **API çökse bile çalışır.**

- Sözleşme: [CONTRACT.md](CONTRACT.md) (v2; v1 Ek A'da)
- Demo kılavuzu: [docs/DEMO_V2.md](docs/DEMO_V2.md)

| Klasör | İçerik |
|---|---|
| `program/` | Solana programı (Anchor, `cargo build-sbf --arch v3`), IDL: `program/idl/notary.json` |
| `agents/` | Python agent'ları ve pip paketi `notary-verify`: `onchain.py` (zincir istemcisi), `verify_standalone.py` (API'siz doğrulayıcı), `issuer.py` (kimlik yayıncısı), `demo_v2.py`, `agent_service.py` (n8n için HTTP servisi) |
| `frontend/` | React arayüzü: cüzdan imzası, zincirden doğrulama, DEMO modu |
| `backend/` | Relayer: kullanıcının SOL'ü olmadan işlem ücretini öder (`/relay`) |
| `scripts/` | `deploy-devnet.sh`, `deploy-relay.sh`, `check-deployed.sh` (zincirdeki ikili = kayıtlı ikili), `verify-program.sh` (solana-verify), `build-idl.py` |
| `docs/` | `DEMO_V2.md`, `n8n/`, test vektörleri, `deployment.json` |

## Kendin doğrula (API'siz, açık kaynak)
Bir belgenin kaydı Solana'daki bir hesapta durur; bizim sunucumuza ihtiyaç yoktur. Sertifikadaki kayıt adresiyle (PDA) üç adımda:
```bash
pip install "git+https://github.com/barisparlakk/Notary.git@integration#subdirectory=agents"
notary-verify belge.pdf --pda <KAYIT_ADRESİ> --program 7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN
# çıkış kodu: 0 VERIFIED, 1 INVALID (dosya değişmiş), 2 NOT_FOUND, 3 REVOKED (imzalayan iptal etmiş), 4 PENDING
```
Kuralların tamamı [CONTRACT.md §4](CONTRACT.md) içindedir; istediğiniz dilde yeniden yazabilirsiniz. Python, TypeScript ve Rust uygulamaları
[test vektörleriyle](docs/test_vectors_v2.json) aynı baytları üretir. Zincirdeki program ikilisini kayıtla karşılaştırmak için `scripts/check-deployed.sh`.

## Kimlik ve iptal
Bir cüzdan adresi kimlik değildir. İmzalayanın kimliği, bir **yayıncının (issuer) zincirdeki beyanından** gelir ve geçerlilik süresi ve iptali vardır
(eIDAS'taki güven sağlayıcı ve güvenilir liste mantığı; [CONTRACT.md §4a](CONTRACT.md)). Hangi yayıncılara güvenileceğini doğrulayıcı seçer:
referans liste [docs/trusted_issuers.json](docs/trusted_issuers.json). Kişi kendi adını da kaydedebilir, ama bu **"self-declared"** görünür, asla "onaylı" değil.
İmzalayan kendi kaydını iptal edebilir (kayıt zincirde kalır, durum `REVOKED` olur).
```bash
python agents/issuer.py attest --keypair ~/.config/notary/demo-issuer.json --subject <CÜZDAN> --name "Ahmet Yilmaz" --evidence "kimlik kontrol kaydı" --days 365
```

## Hızlı başlangıç (yerel, gerçek Solana runtime'ı)
```bash
solana-test-validator --reset &
solana program deploy program/target/deploy/notary.so --program-id <program-keypair.json> --keypair <fonlu.json> --url http://127.0.0.1:8899
cd agents && pip install -r requirements.txt && python demo_v2.py --rpc http://127.0.0.1:8899 --program <PROGRAM_ID> --funder <fonlu.json>
```
Sahte RPC ile (Solana kurmadan): `python agents/demo_v2.py --mock --chain --agreement --identity`. Frontend: [frontend/README.md](frontend/README.md).

## Testler
```bash
cd program && cargo test                       # Rust: test vektörleri (PDA, bayt düzeni, discriminator)
cd agents && pytest                            # Python (gerçek zincir testleri için NOTARY_TEST_* env, bkz. tests/test_realchain.py)
cd backend && pytest                           # relayer
cd frontend && npm test                        # TypeScript
python3 scripts/build-idl.py --check           # IDL güncel mi
```

## Lisans
MIT, bkz. [LICENSE](LICENSE).

## Sınırlar
- Kanıt, "bu cüzdan bu içeriği bu zamanda kaydetti ve sonra değişmedi" der. Hukuken nitelikli e-imzaya (eIDAS) eşdeğer **değildir**.
- Zincire dosya değil yalnızca hash ve public key yazılır; kişisel veri yazmayın (kayıt silinemez). Kimlik beyanındaki ad herkese açıktır.
- Güven listesi istemci tarafındadır: zincir kimin güvenilir olduğuna karar vermez. Depodaki "Notary Demo Issuer" yalnızca demo içindir, gerçek bir kimlik doğrulamasına dayanmaz.

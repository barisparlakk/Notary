# Notary v2 — devir teslim ve kalan işler

## Şu an canlı olanlar (hepsi gerçek devnet'te doğrulandı)
| Ne | Nerede |
|---|---|
| Solana programı | `7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN` ([explorer](https://explorer.solana.com/address/7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN?cluster=devnet)), `docs/deployment.json` |
| Frontend (gerçek mod) | https://frontend-zeta-three-88.vercel.app (Vercel projesi `frontend`) |
| Relayer | https://notary-relay.vercel.app (`/relay/info`, `/relay`), Vercel projesi `notary-relay` |
| Kod | GitHub `barisparlakk/Notary`, dal `feat/v2-pda` (henüz `integration`/`main`'de DEĞİL) |

Devnet'te geçen sınamalar: `cd frontend && RPC_URL=https://api.devnet.solana.com PROGRAM_ID=<ID> RELAY_URL=https://notary-relay.vercel.app FUNDER=<fonlu.json> npm run e2e:local` (13/13) ve `python agents/demo_v2.py --rpc https://api.devnet.solana.com --program <ID> --funder <fonlu.json>`.

## Anahtarlar (repoda YOK)
`~/.config/notary/` (Barış'ın makinesi): `deployer.json` (programın **upgrade authority**'si, ~8 SOL), `program-keypair.json`, `relayer.json` (~1 SOL, Vercel `notary-relay` ortam değişkeni olarak da yüklü).
Devnet SOL: komut satırı airdrop hız sınırlı, web faucet captcha'lı; bakiye düşerse deployer'dan `solana transfer`.

## Kurulum notları
- **Çalışma klasörünü iCloud dışında tutun.** Desktop altındaki klonda `git`/`npm` takılıyor. Temiz klon: `~/dev/Notary`.
- Araç zinciri: Rust, Solana/Agave **4.3.0**, `cargo build-sbf --arch v3` (v0-v2 dağıtımı yeni sürümde reddediliyor).
- Genel devnet RPC'si hızlı sorguda 429 verir; istemciler geri çekilmeyle yeniden dener.

---

## Yapılacaklar (öncelik sırasıyla)

### P0 — demodan önce
1. **Gerçek cüzdanla elle sına.** Phantom ve Solflare (devnet), Notarize Studio'da hem "relayer öder" açıkken hem kapalıyken. Kısmi imza (partial sign) akışı, ağ uyuşmazlığı (cüzdan mainnet'te) uyarısı. *Kabul:* iki cüzdanla kayıt atılır, makbuzdaki PDA explorer'da görünür.
2. **Ayrı RPC anahtarı.** Genel devnet RPC'si tarayıcıda `getProgramAccounts` ve çok sorguda 429 veriyor. Helius/Alchemy/QuickNode ücretsiz anahtarı alıp Vercel `frontend` projesinde `VITE_RPC_URL` yap, yeniden yayınla. *Kabul:* Ledger araması ve doğrulama art arda 20 kez hatasız.
3. **PR'lar.** `feat/v2-pda` → `integration` PR'ı aç (backend'in son hâli zaten içinde), sonra `integration` → `main`. Mustafa ve İrem'e `CONTRACT.md` v2'yi ve `docs/DEMO_V2.md`'yi ilet; v1 REST'e bağımlı iş kalmadığını teyit et. *Kabul:* `main` v2'yi içerir, CI geçer.
4. **İki cihazda QR sınaması.** Bir cihazda kayıt at, QR'ı başka cihazda okut, dosyayı yükle, VERIFIED çıkmalı (DEMO'da çıkmazdı, gerçek modda çıkmalı).
5. **Anahtar güvenliği.** `~/.config/notary/` yedekle. Program upgrade authority'sini bir çoklu imzaya (Squads) ya da güvenli cüzdana devret ya da bilerek tut. Relayer anahtarını gerekirse döndür.
6. **Relayer sertleştirme.** Hız sınırı şu an bellek içi (Vercel'de örnek başına, zayıf). Upstash/Vercel KV ile kalıcı sayaç ya da Cloudflare Turnstile ekle. Relayer bakiyesi için uyarı (eşik altına inince). Acil durum: Vercel'de `PROGRAM_ID`'yi silmek relay'i kapatır (503).

### P1 — ürün
7. **Agent'ları v2'ye taşı.** `agents/sender_agent.py`, `receiver_agent.py`, `chain.py`, `demo.py` hâlâ **v1 REST** (`client.py`) kullanıyor. `onchain.py` ile yeniden yaz (LLM tool'ları `notarize`/`verify` zincire gitsin), `provenance.json` yerine zincirden `lineage`. LLM modunu gerçek modelle (Ollama ya da OpenAI uyumlu) dene.
8. **İki taraflı sözleşme (`co_sign`).** Program: `Agreement` PDA (`["agreement", hash]`), imzacı listesi + imza bitmap'i, her taraf kendi imzasıyla `co_sign`. Frontend: "bu sözleşmeyi başkası da imzalasın" akışı, bekleyen imzalar listesi. Agents: aynı. CONTRACT.md'ye bölüm ekle.
9. **PDF doğrulama sertifikası.** Şu an yalnızca JSON + QR. İstemci tarafında (jsPDF) ya da backend `POST /certificate`: hash, imzalayan, PDA, zaman, tx, QR, hukuki uyarı. Doğrulama sayfasından indirilebilsin.
10. **Program testleri ve CI.** Rust birim testi (LiteSVM ya da `solana-program-test`); GitHub Actions: `cargo build-sbf --arch v3`, `pytest agents`, `npm test`, `solana-test-validator` ile `e2e:local`. Şu an test yalnızca elle çalıştırılan uçtan uca betikler.
11. **v1'i kaldır.** Backend `/notarize`, `/verify`, `/agents/register`, SQLite, `agents/client.py`+`mock_server.py`+`demo.py`; `CONTRACT.md` Ek A; kök `.env.example` v1 değişkenleri. Önce #7 bitmeli.
12. **Kimlik ve hukuki çerçeve.** Hesap/e-posta/kimlik doğrulama istenirse ayrı katman (zincire kişisel veri YAZILMAZ). Arayüzde "cüzdana bağlı, zaman damgalı bütünlük kanıtı, eIDAS nitelikli e-imza değildir" metni (footer ve sertifika).
13. **n8n entegrasyonu.** `agents/onchain.py` üstüne ince bir HTTP servisi (`POST /agent/notarize`, `/agent/verify`); örnek workflow JSON'u. Private key n8n'e girmesin.

### P2 — kalite ve olgunluk
14. **Program.** `revoke`, `Identity` PDA, IDL üretimi (Anchor CLI) ve yayını, Solana Explorer'da doğrulanmış yapı (`solana-verify`), `Proof` şema sürümü (`version`) için göç planı.
15. **Frontend.** JS paketi 795 kB → kod bölme (cüzdan adaptörleri dinamik import). `getProgramAccounts` çok kayıtta pahalı: backend indeksleyici `GET /proofs?signer=` ya da Helius DAS. Hata bildirimleri (toast), erişilebilirlik, lint uyarıları (`set-state-in-effect`), çok dil.
16. **Doküman.** `CONTRACT.md` v2'ye dağıtım kimliklerini ve relayer sözleşmesini işle; `README`/`DEMO_V2.md`'yi güncel tut; ekip onboarding.
17. **Temizlik.** Vercel'de eski önizleme dağıtımı `frontend-4t2ofev5u-pf6.vercel.app`'i sil; projeleri GitHub'a bağla (otomatik dağıtım); özel alan adı; Desktop'taki eski klonu kaldır.
18. **Mainnet'e geçiş (şimdilik kapsam dışı).** Güvenlik denetimi, program yükseltme politikası, ücret modeli, hukuk görüşü.

## Bilinen sınırlar (sunumda bilinmeli)
- Kanıt "bu cüzdan bu içeriği bu zamanda kaydetti ve sonra değişmedi" der; hukuken nitelikli e-imza değildir.
- Zincire yalnızca hash ve public key yazılır; kayıt silinemez.
- Aynı (imzalayan, hash) ikinci kez kaydedilemez (program reddeder).
- Relayer herkese açık; kötüye kullanım riski var (P0 #6).

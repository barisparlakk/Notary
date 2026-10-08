# Notary demo kılavuzu

Anlatılacak ana şey: bizim sunucumuz kapalıyken bile bir belgenin doğrulanabilmesi. Kanıt Solana'daki hesapta duruyor, doğrulama oradan okunuyor.

## Hazırlık
1. Programın güncel hâli devnet'te olmalı (`docs/deployment.json`). Çok imzalı sözleşme için programın `create_agreement` ve
   `co_sign` içeren sürümü yüklenmiş olmalı; `scripts/deploy-devnet.sh` mevcut programı yükseltir.
2. Frontend (Vercel) gerçek modda: `VITE_PROGRAM_ID`, `VITE_RPC_URL`, `VITE_API_URL` tanımlı. `VITE_RPC_URL` için genel devnet RPC'si yerine ayrı bir anahtar kullanın, sık sorguda 429 veriyor.
3. Relayer fonlu ve güncel kodla yayında (`curl <relay>/relay/info` → `enabled: true`, `low_balance: false`).
4. Tarayıcıda Phantom ya da Solflare, ağ **Devnet**. SOL gerekmez (relayer öder).

## Akış
1. **Agent'lar** (terminal):
   `python agents/demo_v2.py --rpc <rpc> --program <id> --funder <fonlu.json> --chain --agreement`
   Kayıt ve doğrulama, tek byte değişince INVALID, provenance zincirden okunur, iki agent'lı sözleşme PENDING'den VERIFIED'a geçer.
2. **İnsan** (tarayıcı): Record, cüzdanı bağla, PDF seç, "Sign & Notarize". Makbuzda PDA, zincir saati, QR, JSON ve PDF sertifika.
3. **Başka cihaz**: QR'ı okut, Check sayfası kaydı gösterir, dosyayı yükle. Yeşil mühür ve "This is the file that was recorded."
4. **Sözleşme**: Record'da "Multi-party agreement", taraf ekle, oluştur (1/3 imzalı). Diğer taraf Records > Agreements'ta aynı dosyayı yükleyip imzalar; dosya eşleşmeden imza düğmesi açılmaz. Doğrulama sayfası tamamlanana kadar PENDING gösterir.
5. **Bir bayt değişirse**: Check sayfasında bir dosyayı bırakın, sonra bir bayt değiştirilmiş hâlini; kayıtlı mühür (yeşil) ile dosyanın mührü (kırmızı) yan yana çıkar ve çok farklı görünür. Sunucumuzu kapatmak (relayer sitesi) doğrulamayı etkilemez.
6. **Açık kaynak doğrulayıcı**: `python agents/verify_standalone.py belge.pdf --pda <PDA> --program <ID>`
7. **Provenance**: Check sonucunda "Based on" satırı, ya da Records > Inspect.

## Plan B
- Devnet yavaş ya da erişilemez: yerel `solana-test-validator` (kök README) ya da `demo_v2.py --mock`. `VITE_PROGRAM_ID` boşken arayüz
  DEMO modunda açılır; üstte "Demo: not recorded on Solana" yazar, mühürler kesikli halka ve DEMO damgası taşır. Bunu gerçek zincir kanıtıymış gibi sunmayın. Check sayfasındaki "Try a sample file" ve "Try a changed sample" düğmeleri tam bu mod için.
- Devnet SOL yok: `--funder` ile transfer; relayer adresi `/relay/info` içinde.

## Kontrol listesi
- [ ] `solana program show <ID> --url devnet` programı gösteriyor
- [ ] `curl <relay>/relay/info` → `enabled: true`
- [ ] `cd frontend && RPC_URL=<rpc> PROGRAM_ID=<id> RELAY_URL=<relay> FUNDER=<fonlu.json> npm run e2e:local` → hepsi geçti

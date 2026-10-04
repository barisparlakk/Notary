# Notary v2 demo kılavuzu

Ana mesaj: **"API'yi kapatın, belge yine doğrulanıyor."** Kanıt Solana'daki PDA hesabında; doğrulama bizden bağımsız.

## Hazırlık (bir kez)
1. Program devnet'te: `docs/deployment.json` (program kimliği, explorer bağlantısı).
2. Frontend (Vercel) `VITE_PROGRAM_ID`, `VITE_RPC_URL`, `VITE_API_URL` ile gerçek modda; relayer fonlu.
3. Phantom/Solflare tarayıcı eklentisi, **devnet** ağı seçili. SOL gerekmez (relayer öder).

## Akış (5 dk)
1. **Agent → agent** (terminal): `python agents/demo_v2.py --rpc https://api.devnet.solana.com --program <ID> --funder <fonlu.json>`
   VERIFIED, 1 byte değişince INVALID, provenance zincirden okunur. Backend kullanılmaz.
2. **İnsan** (tarayıcı): Notarize Studio → cüzdanı bağla → PDF seç → "Sign & Notarize". Makbuzda PDA, zaman, QR, sertifika.
3. **Başka cihaz/telefon**: QR'ı okut → Verification Terminal açılır, dosyayı yükle → VERIFIED.
4. **API çöktü**: Protocol Pipeline'da "Simulate API offline"i işaretle ya da relayer sitesini kapat; doğrulama sürer.
5. **Bağımsız doğrulayıcı** (açık kaynak): `python agents/verify_standalone.py belge.pdf --pda <PDA> --program <ID>`
6. **Provenance**: Ledger → Inspect → "Based on" (zincirden okunan üst belgeler).

## Plan B
- Devnet yavaş/erişilemez: yerel validator (`README.md` hızlı başlangıç) ya da `--mock`. Arayüz `VITE_PROGRAM_ID` boşken DEMO modunda açılır
  ve her yerde **"DEMO · not on-chain"** etiketi taşır. Bunu gerçek zincir kanıtı gibi sunmayın.
- Devnet SOL yok: `agents/` ve e2e için `--funder`/`FUNDER` ile transfer; relayer cüzdanı `docs/deployment.json`/`/relay/info` adresinde.

## Doğrulama kontrol listesi
- [ ] `solana program show <ID> --url devnet` programı gösteriyor
- [ ] `curl <relay>/relay/info` → `enabled: true`
- [ ] `cd frontend && RPC_URL=https://api.devnet.solana.com PROGRAM_ID=<ID> RELAY_URL=<relay> FUNDER=<fonlu.json> npm run e2e:local` → all checks passed

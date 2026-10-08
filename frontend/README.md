# frontend — Notary arayüzü (React + Vite)

Doğrulama ve kayıt doğrudan Solana'ya gider (`src/lib/chain.js`); backend opsiyoneldir.

```bash
cp .env.example .env     # VITE_PROGRAM_ID boşsa DEMO modu (zincire yazılmaz, arayüzde etiketli)
npm install
npm run dev
npm test                 # docs/test_vectors_v2.json ile PDA / talimat / hesap uyumu
npm run build
```

- **DEMO modu:** program ID yokken tarayıcı içi sahte zincir ve geçici bir demo anahtarı kullanılır.
- **Gerçek mod:** `VITE_PROGRAM_ID` + cüzdan (Phantom/Solflare). Aynı belge aynı imzalayanla ikinci kez kaydedilemez.
- Sekmeler: Check (ana sayfa), Record, Records. Eski bağlantılar (`?tab=verify`, `?tab=ledger` ...) çalışmaya devam eder.
- Doğrulama bağlantısı / QR biçimi: `/?tab=verify&pda=<proof_pda>`.

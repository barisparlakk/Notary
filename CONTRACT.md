# Notary Sözleşmesi v2

> Durum: geçerli sözleşme. Eski v1 (REST + backend veritabanı) kaldırıldı.
> Kurallar: her kişi kendi klasörüne dokunur (program / backend / frontend / agents). Sözleşmeden sapılmaz; değişiklik önce burada yapılır.

## 1. İlke
- Doğruluk kaynağı **zincirdeki hesaplardır**. Bizim API'miz çökse de bir belge doğrulanabilir.
- Backend zorunlu değildir; tek işi kullanıcının SOL'ü olmadan işlem yapabilmesi için ücreti ödemektir (relayer).
- İki kullanım, aynı talimatlar: **agent-to-agent** (agent anahtarı imzalar) ve **insan** (cüzdan imzalar).
- Zincire dosya, isim, e-posta **yazılmaz**. Yalnızca hash ve public key. Kayıt silinemez, bu yüzden kişisel veri yazılmaz.

## 2. Sabitler
- Stack: Solana + Anchor programı; frontend React (Vite) + `@solana/web3.js` + wallet adapter; agent'lar Python (`solders`); backend Python FastAPI (yalnızca relayer).
- Hash: SHA-256, ham dosya baytları, 32 bayt. Gösterim: küçük harf hex (64 karakter).
- Kimlik: Solana public key (ed25519, 32 bayt), **base58**. `agent_a`, `agent_b` yalnızca arayüz etiketidir, kimlik değildir.
- İmza: işlemin ed25519 imzası. Ayrı bir mesaj imzası yoktur.
- Zaman: zincirin saati (`Clock::unix_timestamp`, i64, UTC saniye). Gösterim: ISO 8601 UTC, örn. `2026-10-03T18:30:00Z`. İstemci zaman bildirmez, geriye dönük kayıt atılamaz.
- Okuma seviyesi: `confirmed`. Solana'nın varsayılanı `finalized` yeni yazılan hesabı yaklaşık 13 sn göremez; tüm istemciler `confirmed` kullanır.
- Agent anahtar dosyası: Solana CLI biçimi, 64 sayılık JSON dizisi.
- Derleme: `cargo build-sbf --arch v3`. Agave 4.x, SIMD-0500 ile v0-v2 programların dağıtımını reddeder (devnet'te SBPF v3 etkindir).
- Ortam değişkenleri: bkz. `.env.example` (`SOLANA_RPC_URL`, `PROGRAM_ID` / `VITE_PROGRAM_ID`, `SOLANA_PRIVATE_KEY`, `RELAY_*`).

## 3. Zincir programı (`program/`, Anchor)

### 3.1 Hesap: `Proof` (PDA)
- Seeds: `[b"proof", signer (32), document_hash (32)]`
- Alanlar (Borsh, bu sırayla):

| Alan | Tür | Ofset |
|---|---|---|
| (Anchor discriminator) | sha256("account:Proof")[..8] = `a3230d470f803f52` | 0 |
| version | u8 (= 1) | 8 |
| signer | Pubkey | 9 |
| document_hash | [u8; 32] | 41 |
| receiver | Option<Pubkey>: `None` = 1 bayt, `Some` = 1 + 32 bayt | 73 |
| created_at | i64 | 74 (None) / 106 (Some) |
| parents | Vec<[u8; 32]>: u32 uzunluk + 32·n bayt, **n ≤ 4** | created_at + 8 |
| bump | u8 | parents'ın hemen sonrası |

Borsh değişken uzunlukludur, hesap **sırayla çözümlenir**. Sabit ofsetler yalnızca `getProgramAccounts` süzgeçleri içindir.
Hesap **247** bayt ayrılır; kullanılmayan kuyruk baytları sıfırdır ve yok sayılır.

### 3.2 Talimat: `notarize(document_hash, receiver: Option<Pubkey>, parents: Vec<[u8;32]>)`
- Discriminator: sha256("global:notarize")[..8] = `e95e35ee426e4a32`
- Hesaplar: `signer` (Signer), `payer` (Signer, mut), `proof` (PDA, init), `system_program`. `signer` ile `payer` aynı olabilir; farklıysa payer relayer'dır.
- Hatalar: `TooManyParents` (n > 4), `DuplicateParent`. Aynı `(signer, hash)` ikinci kez kaydedilemez: `init` "account already in use" ile başarısız olur.
- Olay: `Notarized { proof, signer, document_hash, receiver, created_at }`.

### 3.3 Hesap: `Agreement` (PDA), çok imzalı sözleşme
- Seeds: `[b"agreement", creator (32), document_hash (32)]`
- Alanlar (Borsh):

| Alan | Tür | Ofset |
|---|---|---|
| (discriminator) | sha256("account:Agreement")[..8] = `53d4056ee1f9c554` | 0 |
| version | u8 (= 1) | 8 |
| creator | Pubkey | 9 |
| document_hash | [u8; 32] | 41 |
| created_at | i64 | 73 |
| signers | Vec<Pubkey>: u32 uzunluk + 32·n, **2 ≤ n ≤ 4** | 81 (elemanlar **85**'ten başlar; i. taraf = 85 + 32·i) |
| signed_at | Vec<i64>: u32 uzunluk + 8·n; **0 = henüz imzalamadı**, aksi halde zincir saati | signers'ın hemen sonrası |
| bump | u8 | signed_at'ın hemen sonrası |

Hesap **250** bayt ayrılır.

### 3.4 Talimatlar: `create_agreement` ve `co_sign`
- `create_agreement(document_hash, signers: Vec<Pubkey>)`, discriminator `dc9c41acfc444ae9`.
  Hesaplar: `creator` (Signer), `payer` (Signer, mut), `agreement` (PDA, init), `system_program`.
  Kurallar: 2-4 taraf, tekrar yok, **oluşturan `signers` içinde olmalı** ve oluştururken imzalamış sayılır. Hatalar: `BadPartyCount`, `DuplicateSigner`, `CreatorNotParty`.
- `co_sign()`, discriminator `b9e20c8538442013` (başka veri yok).
  Hesaplar: `signer` (Signer), `agreement` (mut). Kurallar: `signer` tarafların biri olmalı (`NotAParty`) ve daha önce imzalamamış olmalı (`AlreadySigned`).
- Olaylar: `AgreementCreated`, `AgreementSigned { agreement, signer, remaining }`.
- Sözleşme, **tüm `signed_at` değerleri sıfırdan farklı olunca tamamlanmıştır** (istemci hesaplar).

### 3.5 Hesap türlerini ayırma
`Proof` ve `Agreement` hash'i aynı ofsette (41) tutar. `getProgramAccounts` sorgularında **`dataSize` süzgeci zorunludur**: `Proof` = 247, `Agreement` = 250.
"Bir cüzdanın taraf olduğu sözleşmeler": 4 sorgu (ofsetler 85, 117, 149, 181), sonuçlar birleştirilir.

### 3.6 Henüz yok
`revoke`, `Identity` PDA.

## 4. Doğrulama algoritması (API'siz)
1. `hash = sha256(dosya)`.
2. Adres verildiyse onu oku. İmzalayan verildiyse sırayla `[proof, signer, hash]`, yoksa `[agreement, signer, hash]` PDA'sını türet. Hiçbiri verilmediyse `getProgramAccounts(PROGRAM_ID)` ile hash'e göre ara (`memcmp{offset:41}` + `dataSize`), önce `Proof`, yoksa `Agreement`.
3. `getAccountInfo`: sahibi `PROGRAM_ID` olmalı; discriminator hesap türünü belirler.
4. Sonuç:
   - `VERIFIED`: `Proof` var ve hash eşit, ya da `Agreement` var, hash eşit ve **tüm taraflar imzalamış**.
   - `PENDING`: `Agreement` var, hash eşit, ama tüm taraflar henüz imzalamamış (yanıtta `agreement`).
   - `INVALID`: adres verildi ama kayıtlı hash ≠ hesaplanan hash (dosya değişmiş).
   - `NOT_FOUND`: hesap yok.
5. Çıktı: `{status, original_hash, received_hash, proof_pda, proof | agreement}`.

## 5. Doğrulama sertifikası (JSON; QR ve PDF'in kaynağı)
```json
{
  "version": "notary.cert.v1",
  "notice": "Timestamped integrity proof recorded on Solana. Not a qualified electronic signature (eIDAS); does not by itself prove the identity of a signer.",
  "cluster": "devnet",
  "program_id": "<PROGRAM_ID>",
  "proof_pda": "<base58>",
  "signer": "<base58>",
  "document_hash": "<hex64>",
  "receiver": "<base58|null>",
  "created_at": "2026-10-03T18:30:00Z",
  "tx_signature": "<base58>",
  "explorer_url": "https://explorer.solana.com/address/<proof_pda>?cluster=devnet",
  "verify_url": "https://<frontend>/?tab=verify&pda=<proof_pda>"
}
```
Sözleşme sertifikası: `version: "notary.agreement.v1"`, `agreement_pda`, `creator`, `parties: [{signer, signed_at}]`, `signed_count`, `complete`; diğer alanlar aynı.
PDF sertifika aynı nesneden istemcide üretilir ve hukuki notu taşır.

## 6. Provenance
- `parents`: belgenin dayandığı belgelerin hash'leri (en fazla 4).
- "Bu karar hangi dosyalara dayandı?": `parents` hash'leri için §3.5'teki hash araması özyinelemeli yürütülür. Zincirde kaydı olmayan ata `NO_PROOF` olarak işaretlenir.

## 7. Backend: relayer (doğruluk kaynağı DEĞİL)
- `GET /health`
- `GET /relay/info` → `{enabled, program_id, relayer_pubkey, cluster, balance_lamports, low_balance}`.
  Bakiye `RELAY_MIN_LAMPORTS` (varsayılan 0.01 SOL) altına inerse `enabled: false`.
- `POST /relay`, gövde `{tx_base64}` → `{tx_signature, proof_pda, account, kind, explorer_url}` (`proof_pda` = `account`, geriye uyumluluk; `kind` = `notarize | create_agreement | co_sign`).
  - İstemci işlemi `fee payer = relayer_pubkey` ile kurar, `payer` hesabı da relayer'dır (`co_sign`'da payer hesabı yoktur), `signer` imzalar.
  - Relayer yalnızca tek talimatlı, hedefi `PROGRAM_ID` olan, `notarize | create_agreement | co_sign` işlemlerini imzalar; `signer` relayer olamaz; imza geçerli olmalıdır.
  - Hız sınırı IP başına dakikada `RELAY_RATE_LIMIT`; çok örnekli ortamda `UPSTASH_REDIS_REST_*` ile ortak sayaç. Hatalar: 400 (kural), 409 (zincirde başarısız), 429, 502 (RPC), 503 (kapalı ya da bakiye bitti).
- Planlanan, **henüz yok**: `GET /proofs?signer=` (indeksleyici), `POST /certificate` (sunucu tarafı PDF).

## 8. Test vektörleri
`docs/test_vectors_v2.json` Python, TypeScript ve program tarafından ortak kullanılır; üç tarafın testleri aynı baytları üretir/çözer.
- İmzalayan: seed `0x42 × 32` → `3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf`
- Test program ID (yalnızca vektör için; seed `0x07 × 32`): `GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB`
- Dosya `Notary Test Vector Document v1` → hash `055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27`
- Beklenen `proof_pda = BQmtqeNo2zJmpAKyj9b1ddGgMLPwMDaX62JHCH9e3fV2`, `bump = 252`
- `golden` ve `agreement` bölümleri: talimat verisi ve hesap baytları (hex), discriminator'lar, boyutlar, ofsetler.

## 9. Dağıtım
- Devnet program kimliği: `docs/deployment.json` (`7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN`).
- **Önemli:** devnet'te canlı sürüm yalnızca `notarize` içerir. `create_agreement` / `co_sign` (§3.3-3.4) kodda ve yerel doğrulayıcıda sınandı, devnet'e **yükseltme (upgrade) ile** alınmalıdır (`scripts/deploy-devnet.sh`, upgrade authority sahibi deployer anahtarı gerekir). O zamana kadar canlı sitede sözleşme akışı çalışmaz.
- Relayer: `scripts/deploy-relay.sh` ile Vercel'e durumsuz fonksiyon olarak.

## 10. Kararlar
1. Seed'ler imzalayanı/oluşturanı içerir: başkası bir belgenin hash'ini önceden kaydedip sahiplik iddia edemez.
2. Ücret ve kira: imzalayan öder; ya da isteğe bağlı relayer (§7).
3. Hukuki ifade: "cüzdana bağlı, zaman damgalı bütünlük kanıtı". eIDAS nitelikli e-imzaya eşdeğer değildir; imzalayanın kimliğini tek başına kanıtlamaz. Bu not arayüzde, JSON ve PDF sertifikalarda yer alır.
4. Sözleşmede oluşturan taraf `signers` içinde olmak zorundadır ve oluştururken imzalamış sayılır; böylece "kimse imzalamamış" sözleşme oluşmaz.

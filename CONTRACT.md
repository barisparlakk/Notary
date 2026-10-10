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
`Proof` ve `Agreement` hash'i aynı ofsette (41) tutar. `getProgramAccounts` sorgularında **`dataSize` süzgeci zorunludur**: `Proof` = 247, `Agreement` = 250, `Attestation` = 166, `Revocation` = 82.
"Bir cüzdanın taraf olduğu sözleşmeler": 4 sorgu (ofsetler 85, 117, 149, 181), sonuçlar birleştirilir.

### 3.6 Hesaplar: `Attestation` ve `Revocation` (kimlik ve iptal)
Mevcut hesapların düzeni değişmez; yeni hesap türleri eklenir (eski kayıtlar ve vektörler geçerli kalır).

**`Attestation`** (PDA): bir yayıncının (issuer) bir cüzdan (subject) için "bu cüzdan şu kişidir" beyanı. Seeds: `[b"attest", issuer, subject]`.

| Alan | Tür | Ofset |
|---|---|---|
| (Anchor discriminator) | 8 bayt = sha256("account:Attestation")[..8] = `987db75624927949` | 0 |
| version | u8 (= 1) | 8 |
| issuer | Pubkey | **9** |
| subject | Pubkey | **41** |
| label | String (u32 uzunluk + UTF-8, **1-32 bayt**) | 73 |
| claim_hash | [u8; 32], zincir dışı kanıtın SHA-256'sı | label'dan sonra |
| created_at | i64 | |
| expires_at | i64, 0 = süresiz | |
| revoked_at | i64, 0 = geçerli | |
| bump | u8 | |

Hesap 166 bayt ayrılır. `label` değişken uzunlukludur; sabit ofsetler yalnızca `issuer` (9) ve `subject` (41) içindir.

- `attest_identity(subject: Pubkey, label: String, claim_hash: [u8;32], expires_at: i64)`, discriminator `a8174380d1da5856`.
  Hesaplar: `issuer` (Signer), `payer` (Signer, mut), `attestation` (PDA, init_if_needed), `system_program`.
  `issuer == subject` ise kişinin **kendi beyanıdır** (kayıt); aksi halde üçüncü taraf onayıdır. Aynı `(issuer, subject)` için tekrar çağrı beyanı **yeniler** (son beyan geçerlidir; iptal edilmişse yeniden etkinleşir).
  Hatalar: `BadLabel` (boş ya da 32 bayttan uzun), `BadExpiry` (0 değil ve geçmişte).
- `revoke_attestation()`, discriminator `0c9c67a1c2f6d3b3`. Hesaplar: `issuer` (Signer), `attestation` (mut). Yalnızca beyanı veren yayıncı. Hatalar: `NotTheIssuer`, `AlreadyRevoked`.

**`Revocation`** (PDA): imzalayanın kendi kaydını geçersiz kılması. Seeds: `[b"revoke", proof_pda]`. Alanlar: discriminator (`807581e50b9f4fea`), version u8, proof Pubkey, signer Pubkey, revoked_at i64, bump u8; 82 bayt. `Proof` hesabına dokunulmaz, zincirde kalır.
- `revoke_proof()`, discriminator `3b75d2754b186475`. Hesaplar: `signer` (Signer), `payer` (Signer, mut), `proof`, `revocation` (PDA, init), `system_program`.
  Yalnızca kaydı oluşturan imzalayan (`NotTheSigner`). İkinci kez iptal edilemez (`init` "account already in use").
- Sözleşmeler (`Agreement`) için iptal **yoktur**.

Olaylar: `IdentityAttested`, `AttestationRevoked`, `ProofRevoked`.

### 3.7 Henüz yok
Sözleşme iptali, yayıncıyı zincirde yetkilendiren bir kayıt defteri (güven listesi şimdilik istemci tarafındadır, §4a), indeksleyici.

## 4. Doğrulama algoritması (API'siz)
1. `hash = sha256(dosya)`.
2. Adres verildiyse onu oku. İmzalayan verildiyse sırayla `[proof, signer, hash]`, yoksa `[agreement, signer, hash]` PDA'sını türet. Hiçbiri verilmediyse `getProgramAccounts(PROGRAM_ID)` ile hash'e göre ara (`memcmp{offset:41}` + `dataSize`), önce `Proof`, yoksa `Agreement`.
3. `getAccountInfo`: sahibi `PROGRAM_ID` olmalı; discriminator hesap türünü belirler.
4. Sonuç:
   - `VERIFIED`: `Proof` var ve hash eşit, ya da `Agreement` var, hash eşit ve **tüm taraflar imzalamış**.
   - `PENDING`: `Agreement` var, hash eşit, ama tüm taraflar henüz imzalamamış (yanıtta `agreement`).
   - `REVOKED`: `Proof` var ve hash eşit, ama `[revoke, proof_pda]` hesabı var (imzalayan iptal etmiş; yanıtta `revocation`). Hash eşit değilse `INVALID` önceliklidir.
   - `INVALID`: adres verildi ama kayıtlı hash ≠ hesaplanan hash (dosya değişmiş).
   - `NOT_FOUND`: hesap yok.
5. Çıktı: `{status, original_hash, received_hash, proof_pda, proof | agreement, revocation?, identity?}`.
6. Bağımsız doğrulayıcının (`agents/verify_standalone.py`; pip paketi `notary-verify`, komut `notary-verify`) çıkış kodu: 0 VERIFIED, 1 INVALID, 2 NOT_FOUND, 3 REVOKED, 4 PENDING.

## 4a. İmzalayanın kimliği (eIDAS'taki güven katmanının karşılığı)
Bir cüzdan adresi kimlik değildir. Kimlik, bir **yayıncının beyanıdır** (§3.6). Doğrulayıcı, imzalayan (`Proof.signer`; sözleşmede her taraf) için şunu yapar:
1. `getProgramAccounts(PROGRAM_ID, dataSize=166, memcmp{offset:41, bytes: subject})` ile `subject` hakkındaki tüm beyanları oku.
2. Her beyanın durumu: `revoked` (`revoked_at != 0`), `expired` (`expires_at != 0` ve `expires_at <= şimdi`), aksi halde `valid`. İptal, süre dolmasından önce gelir. Yalnızca `valid` beyanlar sayılır.
3. **Güven listesi:** doğrulayıcının güvendiği yayıncı public key'leri. Referans listesi `docs/trusted_issuers.json` (eIDAS'taki Trusted List'in karşılığı); herkes kendi listesini kullanabilir. Yayıncı beyanı, kendi cüzdanı hakkında verdiği beyan (`issuer == subject`) **asla** güvenilir sayılmaz.
4. Düzey (öncelik sırasıyla):
   - `trusted`: güven listesindeki bir yayıncıdan, `issuer != subject`, geçerli beyan.
   - `unrecognized_issuer`: geçerli beyan var, yayıncı listede yok.
   - `self_declared`: yalnızca kişinin kendi beyanı (`issuer == subject`).
   - `none`: geçerli beyan yok (yalnızca cüzdan adresi bilinir).
5. Arayüz ve araçlar yalnızca `trusted` için "kimlik onaylı" der. Kişisel veri zincire yazılmaz: `label` kişinin ya da yayıncının seçtiği görünen addır, kanıt yalnızca hash olarak (`claim_hash`) durur.
6. Kimlik sorgusu tamamlayıcıdır; başarısız olursa doğrulama sonucu (`status`) etkilenmez, yanıta `identity_error` eklenir.

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
  "verify_url": "https://<frontend>/?tab=verify&pda=<proof_pda>",
  "how_to_verify": { "spec": "CONTRACT.md section 4", "steps": ["..."], "cli": "python agents/verify_standalone.py <file> --pda <proof_pda> --program <PROGRAM_ID> --rpc <rpc>" }
}
```
Sertifika tek başına bir şey kanıtlamaz: zincirdeki hesaba işaret eder. `how_to_verify` herkesin bağımsız doğrulaması için adımları ve komutu taşır. İmzalayanın kimliği sertifikaya **yazılmaz** (zamanla değişebilir: iptal, süre dolumu); doğrulayıcı onu canlı olarak çözer (§4a).
Sözleşme sertifikası: `version: "notary.agreement.v1"`, `agreement_pda`, `creator`, `parties: [{signer, signed_at}]`, `signed_count`, `complete`; diğer alanlar aynı.
PDF sertifika aynı nesneden istemcide üretilir ve hukuki notu taşır.

## 6. Provenance
- `parents`: belgenin dayandığı belgelerin hash'leri (en fazla 4).
- "Bu karar hangi dosyalara dayandı?": `parents` hash'leri için §3.5'teki hash araması özyinelemeli yürütülür. Zincirde kaydı olmayan ata `NO_PROOF` olarak işaretlenir.

## 7. Backend: relayer (doğruluk kaynağı DEĞİL)
- `GET /health`
- `GET /relay/info` → `{enabled, program_id, relayer_pubkey, cluster, balance_lamports, low_balance}`.
  Bakiye `RELAY_MIN_LAMPORTS` (varsayılan 0.01 SOL) altına inerse `enabled: false`.
- `POST /relay`, gövde `{tx_base64}` → `{tx_signature, proof_pda, account, kind, explorer_url}` (`proof_pda` = `account`, geriye uyumluluk; `kind` = `notarize | create_agreement | co_sign | attest_identity | revoke_attestation | revoke_proof`).
  - İstemci işlemi `fee payer = relayer_pubkey` ile kurar, `payer` hesabı da relayer'dır (`co_sign` ve `revoke_attestation`'da payer hesabı yoktur), `signer` imzalar. Hesap sayıları: `notarize`, `create_agreement`, `attest_identity` 4; `revoke_proof` 5 (hedef = `revocation`); `co_sign`, `revoke_attestation` 2.
  - Relayer yalnızca tam olarak bir Notary talimatı taşıyan, hedefi `PROGRAM_ID` olan, `notarize | create_agreement | co_sign | attest_identity | revoke_attestation | revoke_proof` işlemlerini imzalar. İşlemde tam iki imzalayan olur: relayer (fee payer) ve `signer`; `signer` relayer olamaz; imza geçerli olmalıdır.
  - Cüzdanların (ör. Phantom) kendiliğinden eklediği öncelik ücreti talimatları kabul edilir: `ComputeBudget` programından en fazla bir `SetComputeUnitLimit` ve bir `SetComputeUnitPrice`, hesapsız. Relayer'ın ödeyeceği öncelik ücreti (`price × limit / 10⁶`, limit verilmezse 200 000) `RELAY_MAX_PRIORITY_LAMPORTS`'u (varsayılan 250 000 lamport) aşarsa 400. Başka ek talimata izin verilmez.
  - Hız sınırı IP başına dakikada `RELAY_RATE_LIMIT`; çok örnekli ortamda `UPSTASH_REDIS_REST_*` ile ortak sayaç. RPC'nin hız sınırı ve geçici hataları geri çekilmeli olarak yeniden denenir. Hatalar: 400 (kural), 409 (zincirde başarısız), 429, 502 (RPC, yeniden denemelerden sonra), 503 (kapalı ya da bakiye bitti).
- Planlanan, **henüz yok**: `GET /proofs?signer=` (indeksleyici), `POST /certificate` (sunucu tarafı PDF).

## 8. Test vektörleri
`docs/test_vectors_v2.json` Python, TypeScript ve program tarafından ortak kullanılır; üç tarafın testleri aynı baytları üretir/çözer.
- İmzalayan: seed `0x42 × 32` → `3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf`
- Test program ID (yalnızca vektör için; seed `0x07 × 32`): `GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB`
- Dosya `Notary Test Vector Document v1` → hash `055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27`
- Beklenen `proof_pda = BQmtqeNo2zJmpAKyj9b1ddGgMLPwMDaX62JHCH9e3fV2`, `bump = 252`
- `golden`, `agreement`, `identity` ve `revocation` bölümleri: talimat verisi ve hesap baytları (hex), discriminator'lar, PDA'lar, boyutlar, ofsetler. Üretici: `agents/gen_test_vectors_v2.py` (Python); Rust (`cd program && cargo test`) ve TypeScript (`cd frontend && npm test`) aynı baytları bağımsız olarak üretir/çözer.
- `docs/test_vectors_v2.json` yeniden üretilirse üç dilin testleri de geçmelidir; biri geçmezse düzen sözleşmeden sapmıştır.

## 9. Dağıtım
- Devnet program kimliği ve ikilinin SHA-256'sı: `docs/deployment.json`. `scripts/check-deployed.sh` zincirdeki ikiliyle bu kaydı karşılaştırır (anahtar gerekmez).
- Devnet'teki canlı sürüm (yükseltme 2026-10-10) bu sözleşmedeki altı talimatın hepsini içerir: `notarize`, `create_agreement`, `co_sign`, `attest_identity`, `revoke_attestation`, `revoke_proof`. Zincirdeki ikilinin SHA-256'sı `docs/deployment.json`'daki kayıtla eşleşir. Sonraki yükseltmeler `scripts/deploy-devnet.sh` ile yapılır (upgrade authority sahibi deployer anahtarı gerekir); her yükseltmeden sonra `docs/deployment.json` güncellenir.
- IDL: `program/idl/notary.json` (`python3 scripts/build-idl.py`; Anchor CLI gerekmez, CI güncel olup olmadığını denetler).
- Kaynak ile ikilinin eşleştirilmesi: `scripts/verify-program.sh` (`solana-verify`, Docker). Henüz çalıştırılmadı; yalnızca doğrulanabilir derlemeyle yayınlanan program eşleşir.
- Relayer: `scripts/deploy-relay.sh` ile Vercel'e durumsuz fonksiyon olarak.

## 10. Kararlar
1. Seed'ler imzalayanı/oluşturanı içerir: başkası bir belgenin hash'ini önceden kaydedip sahiplik iddia edemez.
2. Ücret ve kira: imzalayan öder; ya da isteğe bağlı relayer (§7).
3. Hukuki ifade: "cüzdana bağlı, zaman damgalı bütünlük kanıtı". eIDAS nitelikli e-imzaya eşdeğer değildir; imzalayanın kimliğini tek başına kanıtlamaz. Bu not arayüzde, JSON ve PDF sertifikalarda yer alır.
4. Sözleşmede oluşturan taraf `signers` içinde olmak zorundadır ve oluştururken imzalamış sayılır; böylece "kimse imzalamamış" sözleşme oluşmaz.
5. Kimlik, cüzdan adresinin kendisinden değil, yayıncı beyanından gelir (§4a). Kendi kendine verilen ad "self_declared" olarak gösterilir, asla "onaylı" değil. Güven listesi istemci tarafındadır: zincir kimin güvenilir olduğuna karar vermez, doğrulayıcı karar verir.
6. İptal, kaydı silmez: yanına bir `Revocation` hesabı açılır. Zincirde hiçbir şey geri alınamaz; iptal de herkese açıktır ve geri alınamaz.
7. Lisans: MIT (`LICENSE`).

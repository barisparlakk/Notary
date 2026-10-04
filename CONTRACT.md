# Notary Sözleşmesi v2

> Durum: v2 geçerli sözleşmedir. v1 (REST + backend DB) yalnızca geçiş dönemi için Ek A'da korunur.
> Kurallar: Her kişi sadece kendi klasörüne dokunur (program / backend / frontend / agents). Sözleşmeden sapma yok.

## 1. İlke
- Doğruluk kaynağı **zincirdeki PDA hesabıdır**. API çökse de bir belge doğrulanabilir.
- Backend zorunlu değil; yalnızca yardımcıdır (fee-payer/relayer, indeksleyici, sertifika PDF).
- İki kullanım, tek talimat: **agent-to-agent** (agent anahtarı imzalar) ve **tüketici** (insan cüzdanı imzalar).
- Zincire dosya, isim, e-posta **yazılmaz**. Yalnızca hash ve public key.

## 2. Sabitler
- Stack: Solana devnet + Anchor programı; Frontend React (Vite) + @solana/web3.js + wallet adapter;
  Agent'lar Python (solders / solana-py); Backend Python FastAPI (opsiyonel).
- Hash: SHA-256, ham dosya baytları. 32 bayt. Gösterim: küçük harf hex (64 karakter).
- Kimlik: Solana public key (ed25519, 32 bayt), **base58**. `agent_a`, `agent_b` yalnızca demo/arayüz etiketidir, kimlik değildir.
- İmza: işlemin ed25519 imzası (imzalayan hesap). Ayrı bir `notary:v1|...` mesaj imzası **yoktur**.
- Zaman: zincirin saati (`Clock::unix_timestamp`, i64, UTC saniye). Gösterim: ISO 8601 UTC, örn. 2026-10-03T18:30:00Z.
- Anahtar dosyası (agent): Solana CLI biçimi, 64 sayılık JSON dizisi.
- Ortam değişkenleri: `SOLANA_RPC_URL`, `PROGRAM_ID`, `SOLANA_KEYPAIR_PATH` (fee-payer/relayer), `API_URL` (opsiyonel).
- Klasör sahipliği: `program/` (Anchor) = Program sahibi, `backend/`, `frontend/`, `agents/` = kendi sahipleri.

## 3. Zincir programı (`notary`, Anchor)

### Hesap: `Proof` (PDA)
- Seeds: `[b"proof", signer_pubkey (32), document_hash (32)]`
- Alanlar (Borsh, bu sırayla):

| Alan | Tür | Ofset |
|---|---|---|
| (Anchor discriminator) | 8 bayt = sha256("account:Proof")[..8] = `a3230d470f803f52` | 0 |
| version | u8 (= 1) | 8 |
| signer | Pubkey | 9 |
| document_hash | [u8; 32] | 41 |
| receiver | Option<Pubkey>: `None` = 1 bayt (0x00), `Some` = 1 + 32 bayt | 73 |
| created_at | i64 | 74 (None) / 106 (Some) |
| parents | Vec<[u8; 32]>: u32 uzunluk + 32·n bayt, **n ≤ 4** | created_at + 8 |
| bump | u8 | parents'ın hemen sonrası |

Borsh değişken uzunlukludur: `receiver` ve `parents` yüzünden `created_at` ve sonraki alanların ofseti kayar,
bu yüzden hesap **sırayla çözümlenir**. Sabit ofsetler yalnızca `getProgramAccounts` memcmp süzgeçleri içindir:
`signer` için **9**, `document_hash` için **41**.
Hesap 247 bayt ayrılır (n = 4 ve receiver = Some için); kullanılmayan kuyruk baytları sıfırdır ve yok sayılır.

### Talimat: `notarize(document_hash: [u8;32], receiver: Option<Pubkey>, parents: Vec<[u8;32]>)`
- Discriminator: sha256("global:notarize")[..8] = `e95e35ee426e4a32`
- Hesaplar (sırayla): `signer` (Signer), `payer` (Signer, mut; kira + ücret), `proof` (PDA, init, mut), `system_program`.
- `signer` ve `payer` aynı olabilir. Farklıysa payer bir relayer'dır (kullanıcının SOL'ü olmasın diye).
- Hatalar: `AlreadyNotarized` (PDA zaten var), `TooManyParents` (n > 4), `DuplicateParent`.
- Olay: `Notarized { proof, signer, document_hash, receiver, created_at }`.

### MVP dışı (sonra)
- `co_sign` / çok imzalı sözleşme (iki tarafın da imzası), `revoke`, `Identity` PDA.

## 4. Doğrulama algoritması (API'siz)
1. `hash = sha256(dosya)`.
2. `proof_pda = findProgramAddress([b"proof", signer, hash], PROGRAM_ID)`.
   Imzalayan bilinmiyorsa: `getProgramAccounts(PROGRAM_ID, memcmp{offset:41, bytes:hash})`.
3. `getAccountInfo(proof_pda)`: sahibi `PROGRAM_ID` ve discriminator doğru olmalı.
4. Sonuç:
   - `VERIFIED`: hesap var, kayıtlı `document_hash == hash`.
   - `INVALID`: sertifikadaki PDA verildi ama kayıtlı hash ≠ hesaplanan hash (dosya değişmiş).
   - `NOT_FOUND`: hesap yok (hiç noterlenmemiş ya da dosya değişmiş ve PDA bilinmiyor).
5. Çıktı: `{status, signer, created_at, receiver, parents, document_hash, original_hash, received_hash, proof_pda, slot}`.

## 5. Doğrulama sertifikası (JSON, QR ve PDF'in kaynağı)
```json
{
  "version": "notary.cert.v1",
  "cluster": "devnet",
  "program_id": "<PROGRAM_ID>",
  "proof_pda": "<base58>",
  "signer": "<base58>",
  "document_hash": "<hex64>",
  "receiver": "<base58|null>",
  "created_at": "2026-10-03T18:30:00Z",
  "tx_signature": "<base58>",
  "slot": 0,
  "explorer_url": "https://explorer.solana.com/address/<proof_pda>?cluster=devnet",
  "verify_url": "https://<frontend>/verify?pda=<proof_pda>"
}
```

## 6. Provenance (zincir)
- `parents`: bu belgenin dayandığı belgelerin hash'leri (en fazla 4).
- "Bu karar hangi dosyalara dayandı?": `parents` hash'leri için Adım 4.2'deki memcmp araması özyinelemeli yürütülür.

## 7. Opsiyonel Backend API (doğruluk kaynağı DEĞİL)
- `GET /health`
- `POST /relay`: gövde `{tx_base64}` (signer ile kısmen imzalanmış). Backend yalnızca `notarize` talimatı içeren, hedefi `PROGRAM_ID` olan işlemleri kabul eder, payer imzasını ekler, gönderir.
  Yanıt `{tx_signature, proof_pda, explorer_url}`. Hız sınırı zorunlu.
- `GET /proofs/{proof_pda}`: çözümlenmiş hesap (kolaylık).
- `GET /proofs?signer=<pubkey>`: indeksli geçmiş.
- `POST /certificate`: gövde `{proof_pda}` → PDF.
- v1 uç noktaları (`/agents/register`, `/notarize`, `/verify`, `/proofs/{proof_id}`) göç bitene kadar çalışır, sonra kaldırılır.

## 8. Test vektörü v2 (üç dilde aynı çıkmalı: Python, TypeScript, Rust)
- Imzalayan: seed `0x42 × 32` → public key `3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf`
- Test program ID (yalnızca vektör için; seed `0x07 × 32`): `GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB`
- Dosya: ASCII `Notary Test Vector Document v1` → hash `055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27`
- Beklenen: `proof_pda = BQmtqeNo2zJmpAKyj9b1ddGgMLPwMDaX62JHCH9e3fV2`, `bump = 252`
- Gerçek deploy sonrası aynı hesap gerçek PROGRAM_ID ile yeniden üretilip `docs/test_vectors_v2.json`'a yazılır.

## 9. Kararlar (v2'de benimsenen)
1. Seed `[b"proof", signer, document_hash]`: başkası belgenin hash'ini önceden kaydedip sahiplik iddia edemez.
2. Ücret/kira: imzalayan kendi öder (agent anahtarı ya da cüzdan). Backend `/relay` opsiyonel yardımcıdır.
3. Program klasörü: `program/` (Anchor workspace).
4. Aynı `(signer, hash)` ikinci kez kaydedilemez: `init` "account already in use" hatasıyla başarısız olur (özel bir hata kodu yoktur).
5. Hukuki ifade: "cüzdana bağlı, zaman damgalı bütünlük kanıtı". eIDAS nitelikli imzaya eşdeğer değildir.

## 10. Sürüm uyumu
- v2 istemcileri (frontend, agents) yalnızca zincire ve opsiyonel `/relay`'e bağlanır.
- v1 REST uç noktaları (Ek A) geçiş boyunca backend'de çalışır, v2 kararlı olunca kaldırılır.

---

# Ek A — v1 (geçiş dönemi, kullanımdan kalkacak)

## Notary Sözleşmesi v1
- Stack: Backend Python FastAPI, Frontend React (Vite), Agent'lar Python (PyNaCl)
- Hash: SHA-256, küçük harf hex
- İmza: ed25519, base64
- İmzalanan mesaj: notary:v1|{document_hash}|{sender}|{receiver}|{timestamp}
- Timestamp: ISO 8601 UTC, örn. 2026-10-03T18:30:00Z
- Agent ID: agent_a, agent_b. Public key base64.
- Solana memo formatı: na1|{document_hash}|{sender}|{receiver}|{timestamp}

### Endpoint'ler
- POST /agents/register  body {agent_id, public_key}
- POST /notarize  multipart: file, sender, receiver, timestamp, signature
  yanıt: {proof_id, document_hash, sender, receiver, timestamp, signature, tx_signature, explorer_url}
- POST /verify  multipart: file, proof_id
  yanıt: {status: "VERIFIED"|"INVALID", original_hash, received_hash, proof}
- GET /proofs/{proof_id}
- GET /health

Kurallar: Her kişi sadece kendi klasörüne dokunur (backend / frontend / agents). Sözleşmeden sapma yok.

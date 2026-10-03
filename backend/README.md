# Notary Backend & Solana Notarization Engine 🛡️

AI ajanları (AI Agents) arasındaki dijital artifact (PDF, model ağırlıkları, analiz raporları) transferlerinin doğruluğunu, kaynağını ve değiştirilmediğini matematiksel ve blokzincir tabanlı kanıtlarla mühürleyen **Kişi 2 (Backend + Solana)** altyapı motoru.

---

## 🏛️ Mimari ve Kriptografik Standartlar

| Bileşen | Standart / Protokol | Açıklama |
|---|---|---|
| **Hash Motoru** | `SHA-256` | 64 karakter küçük harf hex formatında dijital parmak izi |
| **Ajan İmzası** | `Ed25519` (PyNaCl) | 32 bayt açık anahtar, Base64 imza |
| **İmzalanan Mesaj** | `notary:v1\|{hash}\|{sender}\|{receiver}\|{timestamp}` | Off-chain kanonik mesaj şablonu |
| **Solana Memo** | `na1\|{hash}\|{sender}\|{receiver}\|{timestamp}` | Solana Devnet SPL Memo v2 on-chain mühürü |
| **Veritabanı** | `aiosqlite` (Async SQLite) | Kalıcı ajan sicili ve noter kanıtları defteri |
| **Explorer** | Solana Devnet Explorer | `https://explorer.solana.com/tx/{sig}?cluster=devnet` |

---

## 🚀 Hızlı Başlangıç

### 1. Yerel Geliştirme (Local Virtualenv)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# API Servisini Başlat (Hot Reload)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

* Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
* ReDoc: [http://localhost:8000/redoc](http://localhost:8000/redoc)
* Sağlık Kontrolü: `curl http://localhost:8000/health`

### 2. Docker ile Dağıtım (Production Ready)

Tek bir komutla ayağa kaldırın:

```bash
docker compose up -d --build
```

Container loglarını izleyin:
```bash
docker compose logs -f backend
```

---

## 📡 REST API Spesifikasyonu

### 1. `POST /agents/register` — Ajan Kaydı
Bir AI ajanının Ed25519 açık anahtarını kaydeder (veya günceller).
* **Body:**
  ```json
  {
    "agent_id": "agent_a",
    "public_key": "IVL40Zt5HSRFMkLhXy6rbLfP+ntqXtMAl5YOBpiB2xI="
  }
  ```
* **Yanıt (201 Created):**
  ```json
  {
    "agent_id": "agent_a",
    "public_key": "IVL40Zt5HSRFMkLhXy6rbLfP+ntqXtMAl5YOBpiB2xI=",
    "registered_at": "2026-10-04T00:00:00Z"
  }
  ```

---

### 2. `POST /notarize` — Belgeyi Noterleme
Dosyanın hash'ini çıkarır, gönderici ajan imzasını doğrular ve Solana Devnet'e SPL Memo transaction'ı kaydeder.
* **Form Data (Multipart):**
  * `file`: Noterlenecek dosya
  * `sender`: `agent_a`
  * `receiver`: `agent_b`
  * `timestamp`: `2026-10-03T18:30:00Z`
  * `signature`: Ed25519 Base64 imza
* **Yanıt (201 Created):**
  ```json
  {
    "proof_id": "proof_3f8b012a9c",
    "document_hash": "055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27",
    "sender": "agent_a",
    "receiver": "agent_b",
    "timestamp": "2026-10-03T18:30:00Z",
    "signature": "fSXPYckNsOtvUT1...",
    "tx_signature": "4vJ9ju1bJJE96...",
    "explorer_url": "https://explorer.solana.com/tx/4vJ9ju1bJJE96...?cluster=devnet"
  }
  ```

---

### 3. `POST /verify` — Dosya Doğrulama (Tamper Detection)
Alıcı ajanın teslim aldığı dosyanın değiştirilip değiştirilmediğini noter siciliyle kıyaslar.
* **Form Data (Multipart):**
  * `file`: Doğrulanacak dosya
  * `proof_id`: `proof_3f8b012a9c`
* **Yanıt (200 OK — Orijinal Dosya):**
  ```json
  {
    "status": "VERIFIED",
    "original_hash": "055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27",
    "received_hash": "055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27",
    "proof": { ... },
    "detail": "Dosya Solana noter mührüyle tam eşleşiyor."
  }
  ```
* **Yanıt (200 OK — Manipüle Edilmiş Dosya):**
  ```json
  {
    "status": "INVALID",
    "original_hash": "055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27",
    "received_hash": "91ac72...",
    "proof": { ... },
    "detail": "Dosya içeriği değiştirilmiş ya da farklı bir dosya gönderilmiş. Hash uyuşmazlığı tespit edildi."
  }
  ```

---

### 4. `GET /proofs/{proof_id}/verify-chain` — Blokzincir Üstü Doğrulama
Proof kaydının Solana `tx_signature` değerini doğrudan Solana blokzincirinden sorgular, SPL Memo'yu ayrıştırır ve zincirdeki hash ile belgenin hash'ini bağımsız olarak doğrular.
* **Yanıt (200 OK):**
  ```json
  {
    "status": "VERIFIED",
    "tx_signature": "4vJ9ju1bJJE96...",
    "cluster": "devnet",
    "is_live_chain": true,
    "parsed_memo": {
      "version": "na1",
      "document_hash": "055e95ec4e2aa4543afa1569901d08fff259d0deb8e81cea80b434b4aa601d27",
      "sender": "agent_a",
      "receiver": "agent_b",
      "timestamp": "2026-10-03T18:30:00Z"
    },
    "hash_match": true,
    "explorer_url": "https://explorer.solana.com/tx/4vJ9ju1bJJE96...?cluster=devnet",
    "detail": "İşlem Solana Devnet blokzincirinde doğrulandı."
  }
  ```

---

### 5. `POST /verify/tx` — Tx Signature ile Bağımsız Doğrulama
Veritabanına ihtiyaç duymadan, yalnızca Solana işlem imzası (`tx_signature`) ve opsiyonel belge hash'i ile blokzincir üzerinden doğrulama gerçekleştirir.

---

### 6. `GET /solana/wallet` — Noter Cüzdan Bilgisi
Noterlik işlemlerini Devnet'e gönderen cüzdan adresini ve Devnet Explorer bağlantısını döner.

---

## 🧪 Test Paketi (24/24 Green ✅)

Testleri çalıştırmak için:

```bash
cd backend
./venv/bin/pytest tests/test_crypto_vector.py -v
```

**Kapsanan Test Senaryoları:**
1. ✅ **Kriptografik Doğruluk:** SHA-256 hex formatı, deterministik vektör kontrolü, Ed25519 geçerli/bozuk/yanlış anahtar reddi.
2. ✅ **Avalanche Effect (Çığ Etkisi):** 1 baytlık değişiklikte hash'in tamamen farklılaştığının ve `INVALID` üretildiğinin kanıtı.
3. ✅ **Solana Memo Ayrıştırma:** `na1|{hash}|{sender}|{receiver}|{timestamp}` oluşturma ve parse motoru.
4. ✅ **Uçtan Uca Sözleşme Akışı:** `/agents/register` → `/notarize` → `/verify` (VERIFIED & INVALID) → `/proofs/{id}`.
5. ✅ **Zincir Üstü Tx Doğrulama:** `tx_signature` üzerinden bağımsız blokzincir doğrulaması.

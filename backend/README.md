# backend: Notary relayer (opsiyonel yardımcı)

Notary v2'de **kayıt ve doğrulama bu servise bağlı değildir**; kanıt Solana'daki PDA hesaplarındadır
(bkz. `CONTRACT.md`). Backend yalnızca kullanıcının SOL'ü olmadan işlem yapabilmesi için ücreti ödeyen bir relayer'dır.

| Uç nokta | Açıklama |
|---|---|
| `GET /health` | yaşam kontrolü |
| `GET /relay/info` | relayer adresi, program, bakiye (`low_balance`) |
| `POST /relay` | `{tx_base64}`: kısmen imzalı `notarize`, `create_agreement` ya da `co_sign` işlemini imzalayıp gönderir |

Relayer yalnızca bu üç talimatı imzalar; `signer` relayer olamaz; imza geçerli olmalı. Hız sınırı ve bakiye eşiği için
`.env.example`. Vercel'e durumsuz fonksiyon olarak yayın: `scripts/deploy-relay.sh`.

```bash
pip install -r requirements.txt
PROGRAM_ID=<id> SOLANA_RPC_URL=<rpc> uvicorn app.main:app --port 8000
pytest
```

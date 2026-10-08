# n8n entegrasyonu

n8n, Notary'ye `agents/agent_service.py` üzerinden bağlanır. Agent anahtarları (Solana private key) servisin çalıştığı sunucuda kalır;
n8n yalnızca dosya gönderir ve sonucu alır. Private key n8n'e hiç girmez.

## Servisi çalıştırma
```bash
cd agents && pip install -r requirements.txt
AGENT_SERVICE_TOKEN=<uzun-rastgele-bir-değer> PROGRAM_ID=<program-id> SOLANA_RPC_URL=<rpc> \
  uvicorn agent_service:app --port 8800
```
Token tanımlı değilse servis 503 döner. Her istek `X-API-Key: <token>` başlığıyla gelir. Agent cüzdanı bakiyesi düşükse
fon cüzdanından aktarılır (`AGENT_FUNDER_KEYPAIR=<solana-cli.json>`); tanımlı değilse agent adresine devnet SOL gönderin.

## Uç noktalar
| Uç nokta | Gövde (multipart) | Sonuç |
|---|---|---|
| `POST /agent/notarize` | `file`, `agent` (varsayılan `agent_a`), `receiver`, `parents` (virgülle hash) | `proof_pda`, `tx_signature`, `certificate` |
| `POST /agent/verify` | `file`, `proof_pda` ya da `signer` (boşsa hash ile arar) | `VERIFIED / PENDING / INVALID / NOT_FOUND` |
| `POST /agent/agreement` | `file`, `agent`, `parties` (virgülle public key, `self` = agent) | `agreement_pda` |
| `POST /agent/agreement/sign` | `agreement_pda`, `agent` | `tx_signature` |
| `GET /agent/agreement/{pda}` | | taraflar ve imza durumu |

## Örnek workflow
`notary-notarize-and-verify.json` dosyasını n8n'de *Import from file* ile içe aktarın. Webhook'a bir dosya gönderilince önce notarize eder,
ardından aynı dosyayı kayıtla doğrular. n8n ortamına `NOTARY_AGENT_SERVICE_URL` ve `NOTARY_AGENT_SERVICE_TOKEN` tanımlayın.

> Durum: servis ve uç noktaları testle sınandı (`agents/tests/test_agent_service.py`, sahte zincir). Örnek workflow JSON'u n8n'de
> **çalıştırılmadı**; düğüm ayarları n8n'in HTTP Request v4.2 şemasına göre yazıldı, ilk içe aktarmada kontrol edin.

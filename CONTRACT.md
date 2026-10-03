# Notary Sözleşmesi v1
- Stack: Backend Python FastAPI, Frontend React (Vite), Agent'lar Python (PyNaCl)
- Hash: SHA-256, küçük harf hex
- İmza: ed25519, base64
- İmzalanan mesaj: notary:v1|{document_hash}|{sender}|{receiver}|{timestamp}
- Timestamp: ISO 8601 UTC, örn. 2026-10-03T18:30:00Z
- Agent ID: agent_a, agent_b. Public key base64.
- Solana memo formatı: na1|{document_hash}|{sender}|{receiver}|{timestamp}

## Endpoint'ler
- POST /agents/register  body {agent_id, public_key}
- POST /notarize  multipart: file, sender, receiver, timestamp, signature
  yanıt: {proof_id, document_hash, sender, receiver, timestamp, signature, tx_signature, explorer_url}
- POST /verify  multipart: file, proof_id
  yanıt: {status: "VERIFIED"|"INVALID", original_hash, received_hash, proof}
- GET /proofs/{proof_id}
- GET /health

Kurallar: Her kişi sadece kendi klasörüne dokunur (backend / frontend / agents). Sözleşmeden sapma yok.

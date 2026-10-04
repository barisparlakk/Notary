# program/ — Notary Solana programı (Anchor)

CONTRACT.md v2, Bölüm 3. Tek talimat: `notarize(document_hash, receiver, parents)`.
`Proof` PDA seeds: `["proof", signer, document_hash]`. Zaman zincirin saatinden gelir.

## Doğrulanmış araç zinciri
Rust 1.99, Solana/Agave CLI 4.3.0 (`cargo build-sbf`), `anchor-lang = 1.2.0`. Anchor CLI gerekmez.

## Derleme
```bash
cd program/programs/notary && cargo build-sbf --arch v3   # -> program/target/deploy/notary.so
```

> `--arch v3` gerekli: Agave 4.3, SIMD-0500 ile v0-v2 dağıtımını reddeder. Devnet'te SBPF v3 etkin (slot 461808000).

## Test
Birim testleri yerine gerçek runtime'a karşı uçtan uca sınama kullanılır:
```bash
solana-test-validator --reset &
solana program deploy program/target/deploy/notary.so --program-id ~/.config/notary/program-keypair.json --keypair <fonlu-anahtar.json> --url http://127.0.0.1:8899
cd agents   && python demo_v2.py --rpc http://127.0.0.1:8899 --program <PROGRAM_ID>
cd frontend && RPC_URL=http://127.0.0.1:8899 PROGRAM_ID=<PROGRAM_ID> npm run e2e:local
```
`e2e:local` şunları denetler: kayıt, zincir saati, alıcı + üst belge, 3 doğrulama modu, değişmiş dosya (INVALID),
bilinmeyen hash (NOT_FOUND), aynı (signer, hash) ikinci kez reddi, provenance, imzalayana göre listeleme ve
(RELAY_URL verilirse) SOL'ü olmayan imzalayanın relayer ile kaydı.

## Devnet
`scripts/deploy-devnet.sh` derler, deploy eder ve `docs/deployment.json`'u yazar. Program kimliğinin anahtar çifti
repoda DEĞİL, deploy edenin makinesinde (`~/.config/notary/program-keypair.json`) durur; yedekleyin.

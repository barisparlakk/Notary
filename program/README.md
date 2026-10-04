# program/ — Notary Anchor programı

CONTRACT.md v2, Bölüm 3. Tek talimat: `notarize(document_hash, receiver, parents)`.
`Proof` PDA seeds: `["proof", signer, document_hash]`.

## Gereksinimler
Rust, Solana CLI (`solana-test-validator`), Anchor 0.30.x, Node.

## Komutlar
```bash
cd program
npm install
anchor test                      # yerel validator'da testler
anchor keys sync && anchor build # gerçek program ID'sini yazar
anchor deploy --provider.cluster devnet
```
Deploy sonrası `PROGRAM_ID`'yi `.env`'e ve `docs/` altındaki vektörlere işleyin; `target/idl/notary.json` dosyasını paylaşın.

> Durum: kod yazıldı, bu makinede henüz derlenmedi (Rust/Anchor kurulu değil). İlk derleme ve `anchor test` sonucu doğrulanmalı.

# Devir notu

Kod `integration` dalında. Çalışma klasörünü iCloud dışında tutun (Desktop ve Documents'ta `git` ile `npm` takılıyor).
Anahtarlar (deployer, program, relayer) repoda yok; Barış'tan şifreli paket olarak alın.

## Şu an çalışan
- Program devnet'te: `7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN` (`docs/deployment.json`). Canlı sürüm yalnızca `notarize` içeriyor.
- Frontend gerçek modda: https://frontend-zeta-three-88.vercel.app. Relayer: https://notary-relay.vercel.app.
- Çok imzalı sözleşme (`create_agreement`, `co_sign`), PDF sertifika, n8n servisi, relayer bakiye koruması kodda ve test edilmiş durumda;
  yerel `solana-test-validator` üzerinde program, agents, frontend ve relay uçtan uca geçti.

## Önce şunlar (benim yapamadıklarım)
1. **Programı devnet'te yükselt.** Canlı program `create_agreement` ve `co_sign`'ı bilmiyor; yükseltilene kadar canlı sitede sözleşme ekranı hata verir.
   `scripts/deploy-devnet.sh` (deployer anahtarı ve yaklaşık 1 SOL gerekir). Ardından canlı sitede bir sözleşme açıp imzalayarak dene.
2. **Relayer ve frontend'i yeniden yayınla.** Vercel'deki relayer eski kodla çalışıyor (sözleşme talimatlarını ve bakiye korumasını bilmiyor):
   `scripts/deploy-relay.sh`. Frontend için Vercel'de `frontend` projesinde yeniden dağıtım.
3. **Gerçek cüzdanla elle dene.** Phantom ve Solflare, devnet, relayer açık ve kapalı, tek imza ve sözleşme. Kimse denemedi.
4. **RPC anahtarı.** Genel devnet RPC'si tarayıcıda 429 veriyor. Helius ya da Alchemy'den anahtar alıp Vercel'de `VITE_RPC_URL`'e koyun.
5. **QR testi.** Bir cihazdan kayıt, telefondan QR ile doğrulama.
6. **Relayer sayacı.** Kodda Upstash desteği var ama gerçek bir Upstash hesabıyla denenmedi. Hesap açıp `UPSTASH_REDIS_REST_URL` ve `_TOKEN`'ı Vercel'e girin (ya da Turnstile ekleyin).
7. **CI.** `.github/workflows/ci.yml` yazıldı, GitHub'da hiç çalışmadı. İlk PR'da ne çıktığına bakın.
8. **n8n.** `docs/n8n/` altındaki workflow'u n8n'e içe aktarıp çalıştırın; ayarlar şemaya göre yazıldı, orada denenmedi.
9. **Anahtarlar.** `~/.config/notary/` yedeği ve upgrade authority'nin kimde duracağı kararı.

## Yapılmadı
- Programın Rust birim testi (LiteSVM). Şimdilik gerçek doğrulayıcıdaki uçtan uca testler (`agents/tests/test_realchain.py`, `npm run e2e:local`) kapsıyor.
- `revoke`, kimlik hesabı (Identity PDA), IDL üretimi, `solana-verify` (Anchor CLI ve Docker kurulumu gerekir).
- Sunucu tarafı indeksleyici (`GET /proofs?signer=`); çok kayıt olunca tarayıcıdaki `getProgramAccounts` yavaşlayabilir.
- Hesap ve kimlik doğrulaması. Şu an kimlik bir cüzdan adresi; kişisel veri zincire yazılmıyor.
- Frontend: ana paket hâlâ 800 kB çünkü `@solana/web3.js` büyük; lint'te "effect içinde setState" uyarıları duruyor (işlevi etkilemiyor).

## Bilinen sınırlar
- Kanıt "bu cüzdan bu içeriği bu zamanda kaydetti ve sonra değişmedi" der. eIDAS nitelikli e-imza değildir; arayüz, JSON ve PDF sertifika bunu söyler.
- Zincire yalnızca hash ve public key yazılır, kayıt silinemez.
- Aynı (imzalayan, hash) ikinci kez kaydedilemez.
- Relayer herkese açık; sayaç kalıcı hâle gelene kadar kötüye kullanıma açık.

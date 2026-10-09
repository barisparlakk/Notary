# Devir notu

Kod `integration` dalında. Çalışma klasörünü iCloud dışında tutun (Desktop ve Documents'ta `git` ile `npm` takılıyor).
Anahtarlar (deployer, program, relayer) repoda yok; Barış'tan şifreli paket olarak alın.

## Şu an çalışan
- Program devnet'te: `7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN` (`docs/deployment.json`). 2026-10-09 yükseltmesi `notarize`, `create_agreement` ve `co_sign` içerir
  (`scripts/check-deployed.sh` zincirdeki ikiliyi kayıtla karşılaştırır). Kimlik ve iptal talimatları (`attest_identity`, `revoke_attestation`, `revoke_proof`) kodda ve yerel doğrulayıcıda sınandı, **devnet'e henüz yüklenmedi**.
- Frontend gerçek modda: https://frontend-zeta-three-88.vercel.app. Relayer: https://notary-relay.vercel.app.
- Çok imzalı sözleşme (`create_agreement`, `co_sign`), PDF sertifika, n8n servisi, relayer bakiye koruması kodda ve test edilmiş durumda;
  yerel `solana-test-validator` üzerinde program, agents, frontend ve relay uçtan uca geçti.

## Önce şunlar (benim yapamadıklarım)
1. **Programı devnet'te yeniden yükselt** (kimlik ve iptal talimatları için). Yükseltilene kadar canlı sitede "Register your name" ve "Revoke" hata verir; doğrulama etkilenmez (kimlik `none` görünür).
   `scripts/deploy-devnet.sh` (deployer anahtarı ve yaklaşık 1 SOL gerekir; ikili büyüdü, yükseltme sırasında programı genişletmesi gerekebilir). Ardından `scripts/check-deployed.sh`, sonra canlı sitede kayıt, kimlik, iptal ve sözleşme dene.
2. **Relayer ve frontend'i yeniden yayınla.** Vercel'deki relayer eski kodla çalışıyor (`/relay/info` bakiye alanlarını dönmüyor; sözleşme, kimlik ve iptal talimatlarını bilmiyor):
   `scripts/deploy-relay.sh`. Frontend için Vercel'de `frontend` projesinde yeniden dağıtım.
3. **Gerçek cüzdanla elle dene.** Phantom ve Solflare, devnet, relayer açık ve kapalı, tek imza ve sözleşme. Kimse denemedi.
4. **RPC anahtarı.** Genel devnet RPC'si tarayıcıda 429 veriyor. Helius ya da Alchemy'den anahtar alıp Vercel'de `VITE_RPC_URL`'e koyun.
5. **QR testi.** Bir cihazdan kayıt, telefondan QR ile doğrulama.
6. **Relayer sayacı.** Kodda Upstash desteği var ama gerçek bir Upstash hesabıyla denenmedi. Hesap açıp `UPSTASH_REDIS_REST_URL` ve `_TOKEN`'ı Vercel'e girin (ya da Turnstile ekleyin).
7. **CI.** `.github/workflows/ci.yml` yazıldı, GitHub'da hiç çalışmadı. İlk PR'da ne çıktığına bakın.
8. **n8n.** `docs/n8n/` altındaki workflow'u n8n'e içe aktarıp çalıştırın; ayarlar şemaya göre yazıldı, orada denenmedi.
9. **Anahtarlar.** `~/.config/notary/` yedeği ve upgrade authority'nin kimde duracağı kararı.

10. **Kimlik yayıncısı.** `docs/trusted_issuers.json` içindeki "Notary Demo Issuer" yalnızca demo içindir. Gizli anahtarı `~/.config/notary/demo-issuer.json` (repoda yok); demo için `agents/issuer.py attest` ile onay verilir. Gerçek kullanımda kendi yayıncınızı listeye ekleyin ve anahtarını yedekleyin.
11. **`solana-verify`.** `scripts/verify-program.sh` yazıldı ama çalıştırılmadı (Docker gerekir). Eşleşme için programı bir kez doğrulanabilir derlemeyle yeniden yayınlamak gerekir.
12. **GitHub varsayılan dalı** hâlâ `agents` (v1 dönemi). `integration` ya da `main` yapın ve `integration`'ı `main`'e alın.

## Yapılmadı
- Programın LiteSVM ile davranış testi. Rust tarafında bayt düzeni vektör testleri var (`cd program && cargo test`); davranışı gerçek doğrulayıcıdaki uçtan uca testler (`agents/tests/test_realchain.py`, `npm run e2e:local`) kapsıyor.
- Sözleşme (`Agreement`) iptali, güven listesinin zincirde tutulması (şimdilik istemci tarafında), cüzdansız kullanıcı için giriş (e-posta/sosyal giriş, gömülü cüzdan).
- IDL'de `pda` tohum bilgisi yok (`scripts/build-idl.py` Anchor CLI olmadan üretir); tohumlar CONTRACT.md'de.
- Sunucu tarafı indeksleyici (`GET /proofs?signer=`); çok kayıt olunca tarayıcıdaki `getProgramAccounts` yavaşlayabilir.
- Hesap ve kimlik doğrulaması. Şu an kimlik bir cüzdan adresi; kişisel veri zincire yazılmıyor.
- Frontend: ana paket hâlâ 800 kB çünkü `@solana/web3.js` büyük; lint'te "effect içinde setState" uyarıları duruyor (işlevi etkilemiyor).

## Bilinen sınırlar
- Kimlik beyanındaki ad herkese açıktır ve zincirden silinemez; iptal edilebilir ama kayıt kalır.
- Kanıt "bu cüzdan bu içeriği bu zamanda kaydetti ve sonra değişmedi" der. eIDAS nitelikli e-imza değildir; arayüz, JSON ve PDF sertifika bunu söyler.
- Zincire yalnızca hash ve public key yazılır, kayıt silinemez.
- Aynı (imzalayan, hash) ikinci kez kaydedilemez.
- Relayer herkese açık; sayaç kalıcı hâle gelene kadar kötüye kullanıma açık.

// DEMO modunda çok imzalı sözleşmeyi uçtan uca denemek için: tarayıcıda tutulan, zincirde hiçbir değeri olmayan sahte taraflar.
// (Gerçek modda kullanılmaz: orada her taraf kendi cüzdanıyla imzalar.)
import { Keypair } from '@solana/web3.js';

const KEY = 'notary_demo_parties_v2';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};

export function getDemoParties() {
  return read().map(({ label, secret }) => {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    return { label, publicKey: keypair.publicKey, keypair };
  });
}

export function addDemoParty() {
  const list = read();
  const keypair = Keypair.generate();
  const label = `Demo party ${list.length + 1}`;
  try { localStorage.setItem(KEY, JSON.stringify([...list, { label, secret: Array.from(keypair.secretKey) }])); } catch { /* yoksay */ }
  return { label, publicKey: keypair.publicKey, keypair };
}

// DEMO örnek sözleşmeleri: dosya yüklemeden denemek için metni hash'iyle saklar (yalnızca bu tarayıcıda).
const SAMPLES = 'notary_demo_samples_v2';

export function saveDemoSample(hash, text) {
  try {
    const all = JSON.parse(localStorage.getItem(SAMPLES) || '{}');
    all[hash] = text;
    localStorage.setItem(SAMPLES, JSON.stringify(all));
  } catch { /* yoksay */ }
}

export function getDemoSample(hash) {
  try { return JSON.parse(localStorage.getItem(SAMPLES) || '{}')[hash] ?? null; } catch { return null; }
}

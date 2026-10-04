// Opsiyonel yardımcı backend (CONTRACT.md v2, Bölüm 7). Doğrulama ve kayıt ona bağlı DEĞİLDİR:
// zincir işlemleri src/lib/chain.js üzerinden doğrudan Solana RPC'ye gider. Sahte/yerel yedek kayıt yoktur.
import { API_URL } from './lib/config';

export async function checkHealth() {
  if (!API_URL) return { online: false };
  try {
    const res = await fetch(`${API_URL}/health`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    return res.ok ? { online: true, data: await res.json() } : { online: false };
  } catch {
    return { online: false };
  }
}

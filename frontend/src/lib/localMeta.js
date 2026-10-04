// Zincirde yalnızca hash vardır; dosya adı gibi kullanıcıya özel bilgiler SADECE bu tarayıcıda tutulur.
const KEY = 'notary_local_meta_v2';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};

export const getMeta = (pda) => read()[pda] || null;

export function setMeta(pda, meta) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [pda]: { ...read()[pda], ...meta } })); } catch { /* yoksay */ }
}

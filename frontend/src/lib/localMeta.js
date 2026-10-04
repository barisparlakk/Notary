// Zincirde yalnızca hash vardır; dosya adı gibi kullanıcıya özel bilgiler SADECE bu tarayıcıda tutulur.
const KEY = 'notary_local_meta_v2';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};

export const getMeta = (pda) => read()[pda] || null;

export function setMeta(pda, meta) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [pda]: { ...read()[pda], ...meta } })); } catch { /* yoksay */ }
}

// Yerel adres defteri: etiket -> cüzdan adresi. Özel anahtar ASLA burada tutulmaz.
const BOOK_KEY = 'notary_address_book_v2';

export function getIdentities() {
  try { return JSON.parse(localStorage.getItem(BOOK_KEY) || '[]'); } catch { return []; }
}

export function addIdentity(label, address) {
  const list = getIdentities().filter((i) => i.address !== address);
  list.unshift({ label, address, added_at: new Date().toISOString() });
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(list)); } catch { /* yoksay */ }
  return list;
}

export function removeIdentity(address) {
  const list = getIdentities().filter((i) => i.address !== address);
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(list)); } catch { /* yoksay */ }
  return list;
}

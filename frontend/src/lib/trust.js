// Güven listesi: hangi kimlik yayıncılarına güvenildiği (CONTRACT.md 4a). Kaynak docs/trusted_issuers.json;
// ek yayıncılar VITE_TRUSTED_ISSUERS (virgülle ayrılmış public key) ile verilebilir.
import list from '../../../docs/trusted_issuers.json';

const extra = String(import.meta.env?.VITE_TRUSTED_ISSUERS || '').split(',').map((s) => s.trim()).filter(Boolean);

export const TRUSTED_ISSUERS = {
  ...Object.fromEntries((list.issuers || []).map((i) => [i.pubkey, i])),
  ...Object.fromEntries(extra.map((k) => [k, { pubkey: k, label: 'Trusted issuer' }])),
};

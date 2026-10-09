import React, { useEffect, useState } from 'react';
import { resolveIdentity } from '../lib/chain';
import { TRUSTED_ISSUERS } from '../lib/trust';
import { shortKey } from '../lib/notary';

// Kimlik düzeyinin dili (CONTRACT.md 4a). Dürüstlük: yalnızca güvenilen bir yayıncının beyanı "confirmed" denir;
// kişinin kendi yazdığı ad hiçbir zaman doğrulanmış gibi gösterilmez.
const LEVEL = {
  trusted: { tone: 'text-verified', title: 'Identity confirmed' },
  unrecognized_issuer: { tone: 'text-revoked', title: 'Identity claimed by an issuer you have not chosen to trust' },
  self_declared: { tone: 'text-gray-700', title: 'Name declared by the signer, not independently confirmed' },
  none: { tone: 'text-gray-600', title: 'No identity attached. Only the wallet address is known' },
};

/** Bir cüzdanın kimliğini zincirden çözer (yalnızca okuma). */
export function useIdentity(chain, address, tick = 0) {
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let off = false;
    setIdentity(null);
    setError('');
    if (!address) return undefined;
    resolveIdentity(chain, address, TRUSTED_ISSUERS).then((r) => { if (!off) setIdentity(r); }).catch((e) => { if (!off) setError(String(e.message || e)); });
    return () => { off = true; };
  }, [chain, address, tick]);
  return { identity, error };
}

const lapsed = (identity) => identity.claims.filter((c) => c.state !== 'valid' && !c.self);

/** Kimlik özeti: düzey, ad, yayıncı, geçerlilik. `compact` yalnızca tek satır. */
export default function IdentityNote({ identity, compact = false }) {
  if (!identity) return <span className="text-gray-500">Looking up identity…</span>;
  const { level, label, best } = identity;
  const meta = LEVEL[level] || LEVEL.none;
  const issuer = best && !best.self ? (best.issuer_label || shortKey(best.issuer, 6)) : null;
  const until = best?.expires_at ? `valid until ${best.expires_at_iso.slice(0, 10)}` : best ? 'no expiry' : '';
  const old = lapsed(identity);

  if (compact) {
    return (
      <span className={meta.tone}>
        {label ? <><strong className="font-semibold">{label}</strong>{level === 'trusted' ? ` (confirmed by ${issuer})` : level === 'self_declared' ? ' (self-declared)' : ' (unconfirmed)'}</> : 'No identity attached'}
      </span>
    );
  }
  return (
    <div className="text-sm">
      <p className={`font-medium ${meta.tone}`}>{meta.title}</p>
      {label && (
        <p className="mt-1 text-ink">
          <strong className="font-semibold">{label}</strong>
          {issuer && <span className="text-gray-600">, attested by {issuer}</span>}
          {until && <span className="text-gray-500">, {until}</span>}
        </p>
      )}
      {old.length > 0 && level !== 'trusted' && (
        <p className="mt-1 text-gray-600">An earlier attestation by {old[0].issuer_label || shortKey(old[0].issuer, 6)} {old[0].state === 'revoked' ? 'was revoked' : 'has expired'}.</p>
      )}
    </div>
  );
}

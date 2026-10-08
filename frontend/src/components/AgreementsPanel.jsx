import React, { useCallback, useEffect, useState } from 'react';
import Dialog from './Dialog';
import FileDrop from './FileDrop';
import Seal from './Seal';
import { useNotary, shortKey } from '../lib/notary';
import { buildAgreementCertificate, sha256Hex } from '../lib/chain';
import { downloadCertificatePdf } from '../lib/certificatePdf';
import { API_URL } from '../lib/config';
import { getMeta } from '../lib/localMeta';
import { getDemoParties, getDemoSample } from '../lib/demoParties';

// Sözleşmelerim: her sözleşme bir imza bloğu gibi (çizgi, taraf, tarih). Boş çizgi = henüz imzalamadı.
export default function AgreementsPanel({ refreshKey = 0 }) {
  const { chain, signer, isDemo, cluster, programId } = useNotary();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(null);

  const load = useCallback(async () => {
    if (!signer) { setList([]); return; }
    setLoading(true);
    try {
      const mine = await chain.listAgreementsFor(signer.publicKey);
      const extra = isDemo ? (await Promise.all(getDemoParties().map((d) => chain.listAgreementsFor(d.publicKey)))).flat() : [];
      const byPda = new Map([...mine, ...extra].map((a) => [a.agreement_pda, a]));
      setList([...byPda.values()].sort((a, b) => b.created_at - a.created_at));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [chain, signer, isDemo]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const me = signer ? String(signer.publicKey) : '';
  // İmzalayabilecek kimlikler: cüzdan + (DEMO'da) imzası eksik demo taraflar
  const signersFor = (agreement) => {
    const pending = new Set(agreement.parties.filter((p) => !p.signed_at).map((p) => p.signer));
    const out = [];
    if (signer && pending.has(me)) out.push({ label: signer.kind === 'demo' ? 'Demo wallet (you)' : `${signer.label} (you)`, signer });
    if (isDemo) {
      for (const d of getDemoParties()) if (pending.has(String(d.publicKey))) out.push({ label: d.label, signer: { publicKey: d.publicKey, keypair: d.keypair } });
    }
    return out;
  };

  const certificate = (a) => buildAgreementCertificate({ agreementPda: a.agreement_pda, agreement: a, txSignature: getMeta(a.agreement_pda)?.tx_signature, programId, cluster });

  if (!signer) return <p className="text-gray-600">Connect a wallet to see the agreements you are a party to.</p>;
  if (!loading && list.length === 0) return <p className="text-gray-600">{error || 'No agreements yet. Create one to get several people to sign the same file.'}</p>;

  return (
    <div>
      {error && <p className="text-sm text-altered mb-4" role="alert">{error}</p>}
      <ul>
        {list.map((a) => {
          const waiting = a.parties.length - a.signed_count;
          const mine = signersFor(a);
          return (
            <li key={a.agreement_pda} className="border-t border-rule py-7 grid gap-6 md:grid-cols-[88px_minmax(0,1fr)_auto] items-start">
              <Seal hash={a.document_hash} state={a.complete ? 'verified' : 'pending'} size={80} demo={isDemo} label="" />
              <div className="min-w-0">
                <h3 className="font-medium text-ink">{getMeta(a.agreement_pda)?.file_name || 'Unnamed agreement'}</h3>
                <p className="mt-0.5 text-sm text-gray-600">
                  {a.complete ? 'Everyone has signed.' : `Waiting for ${waiting} ${waiting === 1 ? 'signature' : 'signatures'}.`}
                  <span className="ml-2 font-mono text-xs text-gray-500" title={a.document_hash}>{shortKey(a.document_hash, 8)}</span>
                </p>
                <ul className="mt-4 space-y-3" aria-label="Signatures">
                  {a.parties.map((p) => (
                    <li key={p.signer} className="flex items-end gap-3">
                      <span className="flex-1 min-w-0 truncate border-b border-gray-400 pb-1 font-mono text-xs" title={p.signer}>
                        {shortKey(p.signer, 10)}{p.signer === me ? ' (you)' : ''}
                      </span>
                      <span className={`text-xs shrink-0 pb-1 ${p.signed_at ? 'text-verified' : 'text-gray-500'}`}>{p.signed_at ? `Signed ${p.signed_at_iso}` : 'Not signed'}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap md:flex-col gap-2 md:items-stretch">
                {mine.length > 0 && <button type="button" onClick={() => setSigning(a)} className="btn-primary px-4 py-2 rounded-lg text-sm">Sign</button>}
                <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?tab=verify&pda=${a.agreement_pda}`)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Copy link to check</button>
                <button type="button" onClick={() => downloadCertificatePdf(certificate(a), `notary-agreement-${a.agreement_pda.slice(0, 8)}.pdf`)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Certificate (PDF)</button>
              </div>
            </li>
          );
        })}
      </ul>
      {signing && <SignModal agreement={signing} options={signersFor(signing)} onClose={() => setSigning(null)} onSigned={() => { setSigning(null); load(); }} />}
    </div>
  );
}

function SignModal({ agreement, options, onClose, onSigned }) {
  const { chain, isDemo } = useNotary();
  const [hash, setHash] = useState('');
  const [fileName, setFileName] = useState('');
  const [who, setWho] = useState(0);
  const [useRelay, setUseRelay] = useState(!!API_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const matches = hash && hash === agreement.document_hash;
  const demoCopy = isDemo ? getDemoSample(agreement.document_hash) : null;

  const pick = async (f) => {
    if (!f) return;
    setFileName(f.name);
    setError('');
    setHash(await sha256Hex(f));
  };

  const sign = async () => {
    setBusy(true);
    setError('');
    try {
      await chain.coSign({ signer: options[who].signer, agreementPda: agreement.agreement_pda, relay: useRelay && API_URL ? API_URL : null });
      onSigned();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Sign this agreement" onClose={onClose}>
      <p className="text-sm text-gray-600 leading-relaxed">Load the file you received. You can only sign if it is exactly the file in the agreement, so you never sign something you have not seen.</p>
      <FileDrop compact id="sign-file-input" onFile={pick} title={fileName || 'Choose the file'} />
      {demoCopy && !hash && (
        <button type="button" onClick={async () => { setFileName('sample-agreement.txt'); setHash(await sha256Hex(demoCopy)); }} className="text-sm underline text-gray-600 hover:text-ink">Use the demo copy</button>
      )}
      {hash && (
        <p className={`text-sm ${matches ? 'text-verified' : 'text-altered'}`} role="status">
          {matches ? 'This is the file in the agreement. It is safe to sign.' : 'This file is not the one in the agreement. Do not sign it.'}
        </p>
      )}
      {options.length > 1 && (
        <div>
          <label htmlFor="sign-as" className="block text-sm text-gray-700 mb-1.5">Sign as</label>
          <select id="sign-as" value={who} onChange={(e) => setWho(Number(e.target.value))} className="field text-sm">
            {options.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </div>
      )}
      {API_URL && (
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="mt-1 accent-ink" />
          <span>Let the relayer pay the network fee.</span>
        </label>
      )}
      {error && <p className="text-sm text-altered" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 rounded-lg text-sm">Cancel</button>
        <button type="button" onClick={sign} disabled={!matches || busy} className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Waiting for your wallet…' : `Sign as ${options[who]?.label ?? ''}`}
        </button>
      </div>
    </Dialog>
  );
}

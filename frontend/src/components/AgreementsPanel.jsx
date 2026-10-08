import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FileText, ArrowUpRight, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import Dialog from './Dialog';
import FileDrop from './FileDrop';
import { useNotary, shortKey } from '../lib/notary';
import { sha256Hex } from '../lib/chain';
import { API_URL } from '../lib/config';
import { getMeta } from '../lib/localMeta';
import { getDemoParties, getDemoSample } from '../lib/demoParties';
import { buildAgreementCertificate } from '../lib/chain';
import { downloadCertificatePdf } from '../lib/certificatePdf';

// Ledger > Agreements: bir cüzdanın taraf olduğu sözleşmeler. İmzalamadan önce aynı dosya yüklenip hash'i doğrulanır.
export default function AgreementsPanel({ onLoaded }) {
  const { chain, signer, isDemo, cluster, programId } = useNotary();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [signing, setSigning] = useState(null); // imzalanacak sözleşme
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    if (!signer) { setList([]); onLoaded?.(0); return; }
    setLoading(true);
    try {
      const mine = await chain.listAgreementsFor(signer.publicKey);
      // DEMO'da demo tarafların sözleşmeleri de görünsün
      const extra = isDemo ? (await Promise.all(getDemoParties().map((d) => chain.listAgreementsFor(d.publicKey)))).flat() : [];
      const byPda = new Map([...mine, ...extra].map((a) => [a.agreement_pda, a]));
      const all = [...byPda.values()].sort((a, b) => b.created_at - a.created_at);
      setList(all);
      onLoaded?.(all.length);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [chain, signer, isDemo, onLoaded]);

  useEffect(() => { load(); }, [load]);

  const copy = (text, id) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 2000); };

  const myAddress = signer ? String(signer.publicKey) : '';
  // İmzalayabilecek kimlikler: cüzdan + (DEMO'da) imzası eksik demo taraflar
  const signersFor = (agreement) => {
    const pending = new Set(agreement.parties.filter((p) => !p.signed_at).map((p) => p.signer));
    const out = [];
    if (signer && pending.has(myAddress)) out.push({ label: signer.kind === 'demo' ? 'Demo wallet (you)' : `${signer.label} (you)`, signer });
    if (isDemo) {
      for (const d of getDemoParties()) {
        if (pending.has(String(d.publicKey))) out.push({ label: d.label, signer: { publicKey: d.publicKey, keypair: d.keypair } });
      }
    }
    return out;
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-[11px] text-red-700 font-mono break-all">{error}</div>}
      <div className="cal-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-200 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 font-bold text-gray-700">Agreement</th>
                <th className="py-3 px-4 font-bold text-gray-700">Document</th>
                <th className="py-3 px-4 font-bold text-gray-700">Signatures</th>
                <th className="py-3 px-4 font-bold text-gray-700">Status</th>
                <th className="py-3 px-4 font-bold text-gray-700 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400 text-xs">
                    {loading ? 'Reading agreements from the chain...' : signer
                      ? 'No agreements yet. Create one in Notarize Studio > Multi-party agreement.'
                      : 'Connect a wallet to see agreements you are a party to.'}
                  </td>
                </tr>
              ) : list.map((a) => {
                const mine = signersFor(a);
                return (
                  <tr key={a.agreement_pda} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-gray-900" title={a.agreement_pda}>{shortKey(a.agreement_pda, 6)}</td>
                    <td className="py-3.5 px-4">
                      <div className="text-gray-900 font-semibold flex items-center space-x-1.5 font-sans">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        <span>{getMeta(a.agreement_pda)?.file_name || 'unlabeled contract'}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5" title={a.document_hash}>{a.document_hash.substring(0, 14)}...{a.document_hash.substring(58)}</div>
                    </td>
                    <td className="py-3.5 px-4 tabular-nums">{a.signed_count} / {a.parties.length}</td>
                    <td className="py-3.5 px-4">
                      {a.complete
                        ? <span className="inline-flex items-center space-x-1 text-emerald-700"><CheckCircle2 className="w-3 h-3" /><span>Complete</span></span>
                        : <span className="inline-flex items-center space-x-1 text-blue-700"><Clock className="w-3 h-3" /><span>Pending</span></span>}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {mine.length > 0 && (
                        <button onClick={() => setSigning(a)} className="cal-btn-primary px-3 py-1 text-xs rounded-lg">Sign</button>
                      )}
                      <button onClick={() => setSelected(a)} className="cal-btn-secondary px-3 py-1 text-xs rounded-lg">Inspect</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <Dialog title={<>Agreement: {shortKey(selected.agreement_pda, 8)}</>} onClose={() => setSelected(null)}>
            <div className="space-y-2">
              {selected.parties.map((p) => (
                <div key={p.signer} className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[11px] font-mono">
                  <span className="break-all" title={p.signer}>{shortKey(p.signer, 8)}{p.signer === myAddress ? ' (you)' : ''}{p.signer === selected.creator ? ' · creator' : ''}</span>
                  <span className={p.signed_at ? 'text-emerald-700' : 'text-amber-700'}>{p.signed_at ? `signed ${p.signed_at_iso}` : 'not signed'}</span>
                </div>
              ))}
            </div>
            <div className="text-[11px] font-mono text-gray-500 break-all">SHA-256: {selected.document_hash}</div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button onClick={() => copy(`${window.location.origin}/?tab=verify&pda=${selected.agreement_pda}`, 'link')} className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg flex items-center space-x-1.5">
                {copied === 'link' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}<span>Copy verify link</span>
              </button>
              <button
                onClick={() => downloadCertificatePdf(
                  buildAgreementCertificate({ agreementPda: selected.agreement_pda, agreement: selected, txSignature: getMeta(selected.agreement_pda)?.tx_signature, programId, cluster }),
                  `notary-agreement-${selected.agreement_pda.slice(0, 8)}.pdf`)}
                className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg flex items-center space-x-1.5"
              >
                <span>Certificate PDF</span>
              </button>
              {!isDemo && (
                <a href={`https://explorer.solana.com/address/${selected.agreement_pda}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer"
                  className="cal-btn-primary py-2 px-3.5 text-xs rounded-lg flex items-center space-x-1.5">
                  <span>Solana Explorer</span><ArrowUpRight className="w-3 h-3" />
                </a>
              )}
              <button onClick={() => setSelected(null)} className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg">Close</button>
            </div>
        </Dialog>
      )}

      {signing && (
        <SignModal
          agreement={signing}
          options={signersFor(signing)}
          onClose={() => setSigning(null)}
          onSigned={() => { setSigning(null); load(); }}
        />
      )}
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
    <Dialog title={<>Sign agreement {shortKey(agreement.agreement_pda, 6)}</>} onClose={onClose}>

        <p className="text-xs text-gray-600 leading-relaxed">
          Load the contract file you received. Signing is only enabled when its SHA-256 matches the one stored in the agreement, so you never sign a document you have not seen.
        </p>

        <FileDrop compact id="sign-file-input" onFile={pick} title={fileName || 'Select the contract file'} />

        {demoCopy && !hash && (
          <button type="button" onClick={async () => { setFileName('demo_contract.txt'); setHash(await sha256Hex(demoCopy)); }}
            className="text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200">
            Use the demo copy of this contract
          </button>
        )}

        {hash && (
          <div className={`p-3 rounded-xl border text-[11px] font-mono break-all ${matches ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {matches ? 'This file matches the agreement. Safe to sign.' : 'This file does NOT match the agreement (different SHA-256). Do not sign.'}
            <div className="mt-1 text-gray-600">{hash}</div>
          </div>
        )}

        {options.length > 1 && (
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">Sign as</label>
            <select value={who} onChange={(e) => setWho(Number(e.target.value))} className="cal-input font-mono text-xs">
              {options.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
            </select>
          </div>
        )}
        {API_URL && (
          <label className="flex items-center space-x-2 text-xs text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="accent-black" />
            <span>Let the Notary relayer pay the network fee</span>
          </label>
        )}

        {error && (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-800 flex items-start space-x-2" role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span className="font-mono break-all">{error}</span>
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-2">
          <button onClick={onClose} className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg">Cancel</button>
          <button onClick={sign} disabled={!matches || busy} className="cal-btn-primary px-4 py-2 text-xs rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Waiting for wallet and network...' : `Sign as ${options[who]?.label ?? ''}`}
          </button>
        </div>
        </Dialog>
  );
}

import React, { useMemo, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { Plus, X } from 'lucide-react';
import FileDrop from './FileDrop';
import Seal from './Seal';
import { CopyButton, Row, Step } from './Facts';
import { useNotary } from '../lib/notary';
import { buildAgreementCertificate, deriveAgreementPda, hexToBytes, sha256Hex, MAX_PARTIES } from '../lib/chain';
import { downloadCertificatePdf } from '../lib/certificatePdf';
import { API_URL } from '../lib/config';
import { getIdentities, setMeta } from '../lib/localMeta';
import { addDemoParty, getDemoParties, saveDemoSample } from '../lib/demoParties';

// Çok taraflı sözleşme oluşturma. Oluşturan oluştururken imzalamış sayılır; diğer taraflar sonradan imzalar.
export default function AgreementStudio({ onCreated }) {
  const { chain, signer, isDemo, cluster, programId } = useNotary();

  const [file, setFile] = useState(null);
  const [docHash, setDocHash] = useState('');
  const [others, setOthers] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [useRelay, setUseRelay] = useState(!!API_URL);
  const [demoParties, setDemoParties] = useState(() => (isDemo ? getDemoParties() : []));
  const resultRef = useRef(null);

  const me = signer ? String(signer.publicKey) : '';
  const parties = me ? [me, ...others] : others;
  const known = useMemo(() => {
    const list = getIdentities().map((i) => ({ label: i.label, address: i.address }));
    for (const d of demoParties) list.push({ label: d.label, address: String(d.publicKey) });
    return list.filter((k) => k.address !== me && !others.includes(k.address));
  }, [demoParties, me, others]);

  const addressPreview = useMemo(() => {
    if (!signer || !docHash) return '';
    return deriveAgreementPda(programId, signer.publicKey, hexToBytes(docHash))[0].toBase58();
  }, [signer, docHash, programId]);

  const onFile = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');
    setDocHash(await sha256Hex(f));
  };

  const useSample = async () => {
    const text = `Notary sample agreement\nCreated: ${new Date().toISOString()}\nSubject: delivery of 100 units at a fixed price.`;
    const f = new File([text], 'sample-agreement.txt', { type: 'text/plain' });
    await onFile(f);
    saveDemoSample(await sha256Hex(f), text);
  };

  const addParty = (address) => {
    const value = (address || input).trim();
    try {
      const key = new PublicKey(value).toBase58();
      if (key === me || others.includes(key)) { setError('That address is already a party.'); return; }
      if (parties.length >= MAX_PARTIES) { setError(`An agreement can have at most ${MAX_PARTIES} parties.`); return; }
      setOthers([...others, key]);
      setInput('');
      setError('');
    } catch {
      setError('This is not a valid Solana address.');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file || !signer || parties.length < 2) return;
    setBusy(true);
    setError('');
    try {
      const out = await chain.createAgreement({ signer, hashHex: docHash, signers: parties, relay: useRelay && API_URL ? API_URL : null });
      const certificate = buildAgreementCertificate({ agreementPda: out.agreement_pda, agreement: out.agreement, txSignature: out.tx_signature, programId, cluster });
      setMeta(out.agreement_pda, { file_name: file.name || 'agreement', tx_signature: out.tx_signature });
      setResult({ ...out, certificate });
      onCreated?.();
      setTimeout(() => resultRef.current?.focus(), 50);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <form onSubmit={submit}>
        <Step n={1} title="Choose the agreement">
          <FileDrop id="agreement-file-input" onFile={onFile} title={file ? file.name : 'Drop the agreement here'} subtitle={file ? `${(file.size / 1024).toFixed(1)} KB, fingerprinted in your browser` : 'Every party will sign this exact file'} />
          {docHash && <p className="text-xs text-gray-500">Fingerprint <span className="font-mono text-gray-700 break-all">{docHash}</span> <CopyButton text={docHash} /></p>}
          {isDemo && <button type="button" onClick={useSample} className="text-sm underline text-gray-600 hover:text-ink">Use a sample agreement</button>}
        </Step>

        <Step n={2} title="Add the parties">
          <ul className="space-y-2" aria-label="Parties">
            <li className="flex items-end gap-3">
              <span className="flex-1 border-b border-gray-400 pb-1 font-mono text-xs break-all">{me || 'Connect a wallet to be the first party'}</span>
              <span className="text-xs text-gray-600 shrink-0">You, signing now</span>
            </li>
            {others.map((o) => (
              <li key={o} className="flex items-end gap-3">
                <span className="flex-1 border-b border-gray-400 pb-1 font-mono text-xs break-all">{o}</span>
                <button type="button" aria-label="Remove party" onClick={() => setOthers(others.filter((x) => x !== o))} className="text-gray-500 hover:text-altered shrink-0"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParty(); } }} className="field font-mono text-xs" placeholder="Wallet address of another party" aria-label="Wallet address of another party" />
            <button type="button" onClick={() => addParty()} className="btn-secondary px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4 mr-1" />Add</button>
          </div>
          {(known.length > 0 || isDemo) && parties.length < MAX_PARTIES && (
            <div className="flex flex-wrap gap-1.5">
              {known.slice(0, 6).map((k) => (
                <button key={k.address} type="button" onClick={() => addParty(k.address)} title={k.address} className="rounded-full border border-rule px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400">{k.label}</button>
              ))}
              {isDemo && <button type="button" onClick={() => setDemoParties([...demoParties, addDemoParty()])} className="rounded-full border border-dashed border-gray-400 px-2.5 py-1 text-xs text-gray-700">New demo party</button>}
            </div>
          )}
          <p className="text-sm text-gray-600">Up to {MAX_PARTIES} parties. The agreement counts as agreed only when every party has signed the same file.</p>
        </Step>

        <Step n={3} title="Sign and create" last>
          <p className="text-sm text-gray-700">You sign now. The other parties sign later from the Agreements page, after loading the same file.</p>
          {!isDemo && API_URL && (
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="mt-1 accent-ink" />
              <span>Let the relayer pay the network fee. You still sign, and you need no SOL.</span>
            </label>
          )}
          {addressPreview && <p className="text-xs text-gray-500">The agreement will live at <span className="font-mono break-all">{addressPreview}</span></p>}
          {error && <p className="text-sm text-altered" role="alert">{error}</p>}
          <button type="submit" disabled={!file || !signer || parties.length < 2 || busy} className="btn-primary px-5 py-2.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Waiting for your wallet and the network…' : isDemo ? 'Create agreement (demo)' : 'Create agreement'}
          </button>
          {parties.length < 2 && <p className="text-sm text-gray-600">Add at least one more party.</p>}
        </Step>
      </form>

      {result && (
        <section className="mt-12 border-t border-rule pt-8" aria-live="polite">
          <div className="flex flex-wrap items-start gap-10">
            <div className="min-w-0 flex-1 basis-80">
              <h2 ref={resultRef} tabIndex={-1} className="font-display text-3xl font-semibold leading-tight outline-none">
                Agreement created. {result.agreement.signed_count} of {result.agreement.parties.length} have signed.
              </h2>
              <p className="mt-3 text-gray-600 max-w-md leading-relaxed">Send the file and the link below to the other parties. The agreement is binding once all of them have signed.</p>
              <dl className="mt-6"><Row label="Agreement address"><span className="font-mono text-xs">{result.agreement_pda}</span> <CopyButton text={result.agreement_pda} /></Row></dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadCertificatePdf(result.certificate, `notary-agreement-${result.agreement_pda.slice(0, 8)}.pdf`)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Download certificate (PDF)</button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(result.certificate.verify_url); }} className="btn-secondary px-4 py-2 rounded-lg text-sm">Copy link to check</button>
              </div>
            </div>
            <Seal key={docHash} hash={docHash} state="pending" size={180} animate demo={isDemo} />
          </div>
        </section>
      )}
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { PublicKey } from '@solana/web3.js';
import { UploadCloud, Sparkles, Cpu, Check, Copy, Send, ArrowRight, ArrowUpRight, Download, Plus, X, Users, AlertTriangle, Clock } from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';
import { buildAgreementCertificate, MAX_PARTIES, sha256Hex, deriveAgreementPda, hexToBytes } from '../lib/chain';
import { API_URL } from '../lib/config';
import { getIdentities, setMeta } from '../lib/localMeta';
import { addDemoParty, getDemoParties, saveDemoSample } from '../lib/demoParties';

// Çok taraflı sözleşme oluşturma: oluşturan otomatik imzalı sayılır, diğer taraflar sonradan Ledger > Agreements'tan imzalar.
export default function AgreementStudio() {
  const { chain, signer, isDemo, cluster, programId } = useNotary();

  const [file, setFile] = useState(null);
  const [docHash, setDocHash] = useState('');
  const [others, setOthers] = useState([]);
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [useRelay, setUseRelay] = useState(!!API_URL);
  const [demoParties, setDemoParties] = useState(() => (isDemo ? getDemoParties() : []));

  const me = signer ? String(signer.publicKey) : '';
  const parties = me ? [me, ...others] : others;
  const known = useMemo(() => {
    const list = getIdentities().map((i) => ({ label: i.label, address: i.address }));
    for (const d of demoParties) list.push({ label: d.label, address: String(d.publicKey) });
    return list.filter((k) => k.address !== me && !others.includes(k.address));
  }, [demoParties, me, others]);

  const pdaPreview = useMemo(() => {
    if (!signer || !docHash) return '';
    return deriveAgreementPda(programId, signer.publicKey, hexToBytes(docHash))[0].toBase58();
  }, [signer, docHash, programId]);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');
    setDocHash(await sha256Hex(f));
  };

  const loadSample = async () => {
    const text = `Notary demo contract\nSigned between the parties below.\nCreated: ${new Date().toISOString()}\nSubject: delivery of 100 units at a fixed price`;
    const f = new File([text], 'demo_contract.txt', { type: 'text/plain' });
    await handleFile(f);
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
      setError('Not a valid Solana address (base58).');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file || !signer || parties.length < 2) return;
    setIsSubmitting(true);
    setError('');
    try {
      const out = await chain.createAgreement({ signer, hashHex: docHash, signers: parties, relay: useRelay && API_URL ? API_URL : null });
      const certificate = buildAgreementCertificate({
        agreementPda: out.agreement_pda, agreement: out.agreement, txSignature: out.tx_signature, programId, cluster,
      });
      setMeta(out.agreement_pda, { file_name: file.name || 'agreement', tx_signature: out.tx_signature });
      setResult({ ...out, certificate });
      setQr(await QRCode.toDataURL(certificate.verify_url, { margin: 1, width: 160 }));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const copy = (text, id) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 2000); };

  const download = () => {
    const blob = new Blob([JSON.stringify(result.certificate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-agreement-${result.agreement_pda.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-6">

        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 01</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Contract Document</h3>
            </div>
            {isDemo && (
              <button type="button" onClick={loadSample}
                className="text-xs font-medium text-gray-600 hover:text-black flex items-center space-x-1 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /><span>Load Sample Contract</span>
              </button>
            )}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            className="border-2 border-dashed border-gray-200 hover:border-gray-400 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-white"
            onClick={() => document.getElementById('agreement-file-input').click()}
          >
            <input id="agreement-file-input" type="file" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <div className="w-12 h-12 rounded-full bg-white shadow-sm border border-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-700">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold text-gray-900">{file ? file.name : 'Select or drag & drop the contract'}</div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB • Hashed locally, the file never leaves your browser` : 'Every party must later sign this exact file'}
            </div>
          </div>
          {docHash && (
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5 text-xs font-mono">
              <div className="flex items-center space-x-1.5 text-gray-500 text-[11px]">
                <Cpu className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-semibold text-gray-700">Client-Side Calculated SHA-256 Digest:</span>
              </div>
              <div className="cal-hash-block font-bold text-gray-900 bg-white">{docHash}</div>
            </div>
          )}
        </div>

        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 02</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Parties</h3>
            </div>
            <span className="text-[11px] font-mono text-gray-400">{parties.length}/{MAX_PARTIES} parties</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[11px] font-mono">
              <span className="break-all">{me || 'Connect a wallet to be the first party'}</span>
              <span className="cal-pill text-[10px] py-0.5 px-2 bg-white text-gray-600 shrink-0 ml-2">You · signs on creation</span>
            </div>
            {others.map((o) => (
              <div key={o} className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-gray-200 text-[11px] font-mono">
                <span className="break-all">{o}</span>
                <button type="button" aria-label="Remove party" onClick={() => setOthers(others.filter((x) => x !== o))} className="text-gray-400 hover:text-red-700 ml-2">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParty(); } }}
              className="cal-input font-mono text-xs"
              placeholder="Wallet address of another party (base58)"
            />
            <button type="button" onClick={() => addParty()} className="cal-btn-secondary py-2 px-3 text-xs rounded-lg flex items-center space-x-1">
              <Plus className="w-3.5 h-3.5" /><span>Add</span>
            </button>
          </div>

          {(known.length > 0 || isDemo) && parties.length < MAX_PARTIES && (
            <div className="flex flex-wrap gap-1.5">
              {known.slice(0, 6).map((k) => (
                <button key={k.address} type="button" onClick={() => addParty(k.address)} title={k.address}
                  className="text-[11px] font-mono px-2 py-1 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600">
                  + {k.label}
                </button>
              ))}
              {isDemo && (
                <button type="button" onClick={() => setDemoParties([...demoParties, addDemoParty()])}
                  className="text-[11px] font-mono px-2 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800">
                  + New demo party
                </button>
              )}
            </div>
          )}
          <div className="text-[11px] font-mono text-gray-500">
            The agreement counts as complete only when every party has signed the same file. Signing times come from the Solana clock.
          </div>
        </div>

        <div className="cal-card p-6 space-y-4">
          <div className="pb-3 border-b border-gray-100">
            <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 03</span>
            <h3 className="text-base font-bold text-gray-950 font-sans">Wallet Signature &amp; Agreement Account</h3>
          </div>
          {!isDemo && API_URL && (
            <label className="flex items-center space-x-2 text-xs text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="accent-black" />
              <span>Let the Notary relayer pay the network fee <span className="text-gray-400">(you still sign; no SOL needed)</span></span>
            </label>
          )}
          <div className="p-3.5 rounded-xl bg-gray-50 text-xs font-mono border border-gray-200 space-y-1">
            <span className="text-gray-500 font-bold block text-[11px]">Agreement account (PDA) that will track the signatures:</span>
            <div className="text-gray-800 break-all select-all">{pdaPreview || 'Select a document and connect a wallet to derive the address'}</div>
            <div className="text-[11px] text-gray-500 pt-1">seeds: [“agreement”, creator, document_hash]</div>
          </div>
        </div>

        {error && (
          <div className="cal-card p-4 border border-red-200 bg-red-50 text-xs text-red-800 flex items-start space-x-2" role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="font-mono break-all">{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!file || !signer || parties.length < 2 || isSubmitting}
          className="w-full cal-btn-primary py-3.5 text-sm rounded-xl font-bold flex items-center justify-center space-x-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          <span>{isSubmitting ? 'Waiting for wallet and network...' : isDemo ? 'Create DEMO agreement (not on-chain)' : 'Sign & Create Agreement'}</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
        {parties.length < 2 && <div className="text-[11px] font-mono text-gray-500 -mt-3">Add at least one more party.</div>}
      </form>

      {result && (
        <div className="cal-card p-6 border-2 border-blue-300 bg-blue-50/50 space-y-4 shadow-lg">
          <div className="flex items-center justify-between pb-3 border-b border-blue-200">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center"><Users className="w-5 h-5" /></div>
              <h3 className="text-base font-extrabold text-blue-950 font-sans">
                {isDemo ? 'DEMO agreement created (not on-chain)' : 'Agreement created on Solana'}
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 flex items-center space-x-1">
              <Clock className="w-3 h-3" /><span>{result.agreement.signed_count} of {result.agreement.parties.length} signed</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
            <div className="space-y-3 text-xs font-mono min-w-0">
              <div className="p-3.5 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Agreement account (PDA)</span>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-gray-900 font-bold text-sm break-all">{result.agreement_pda}</span>
                  <button type="button" onClick={() => copy(result.agreement_pda, 'pda')} className="text-gray-500 hover:text-black shrink-0" aria-label="Copy PDA">
                    {copied === 'pda' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-white border border-gray-200 space-y-1.5">
                <span className="text-gray-500 block text-[10px]">Parties</span>
                {result.agreement.parties.map((p) => (
                  <div key={p.signer} className="flex items-center justify-between text-[11px]">
                    <span title={p.signer}>{shortKey(p.signer, 6)}{p.signer === me ? ' (you)' : ''}</span>
                    <span className={p.signed_at ? 'text-emerald-700' : 'text-amber-700'}>{p.signed_at ? `signed ${p.signed_at_iso}` : 'waiting for signature'}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-gray-600 font-sans leading-relaxed">
                Send the contract file and the verify link to the other parties. Each one opens <b>Ledger &amp; Registry &gt; Agreements</b>, loads the same file and signs with their own wallet.
              </div>
            </div>
            {qr && (
              <div className="flex flex-col items-center space-y-1.5">
                <img src={qr} alt="QR code of the verification link" className="w-32 h-32 rounded-lg border border-gray-200 bg-white" />
                <span className="text-[10px] font-mono text-gray-500">Scan to check status</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {!isDemo ? (
              <a href={`https://explorer.solana.com/address/${result.agreement_pda}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer"
                className="cal-btn-primary py-2 px-4 text-xs rounded-lg flex items-center space-x-1.5">
                <span>View on Solana Explorer</span><ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            ) : <span />}
            <div className="flex items-center space-x-2">
              <button type="button" onClick={() => copy(result.certificate.verify_url, 'link')} className="cal-btn-secondary py-2 px-4 text-xs rounded-lg font-mono flex items-center space-x-1.5">
                {copied === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied === 'link' ? 'Copied' : 'Copy verify link'}</span>
              </button>
              <button type="button" onClick={download} className="cal-btn-secondary py-2 px-4 text-xs rounded-lg font-mono flex items-center space-x-1.5">
                <Download className="w-3.5 h-3.5" /><span>Download certificate</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

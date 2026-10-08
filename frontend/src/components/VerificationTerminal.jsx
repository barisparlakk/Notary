import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  UploadCloud,
  Cpu,
  Search,
  History,
  ArrowRight,
  ArrowUpRight,
  HelpCircle,
  FlaskConical,
  GitBranch,
  Clock,
} from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';
import { lineage, sha256Hex, verifyDocument } from '../lib/chain';
import { RPC_URL } from '../lib/config';
import { getMeta, setMeta } from '../lib/localMeta';

const SAMPLE_CANONICAL = `Notary Provenance Report v2.0
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": 150000.00,
  "risk_score": 0.04,
  "status": "APPROVED FOR EXECUTION"
}`;

const SAMPLE_TAMPERED = SAMPLE_CANONICAL.replace('150000.00', '1500000.00').replace('0.04', '0.99');

const THEME = {
  VERIFIED: {
    card: 'border-emerald-300 bg-emerald-50/40',
    icon: 'bg-emerald-100 border-emerald-300 text-emerald-700',
    title: 'text-emerald-950',
    label: 'VERIFIED: DOCUMENT IS AUTHENTIC',
    text: 'The file content matches the SHA-256 fingerprint stored in the on-chain proof account, bit for bit.',
  },
  INVALID: {
    card: 'border-red-300 bg-red-50/50',
    icon: 'bg-red-100 border-red-300 text-red-700',
    title: 'text-red-950',
    label: 'INTEGRITY VIOLATION DETECTED',
    text: 'Hash mismatch. The document was modified after it was notarized, or it does not belong to this proof account.',
  },
  PENDING: {
    card: 'border-blue-300 bg-blue-50/50',
    icon: 'bg-blue-100 border-blue-300 text-blue-700',
    title: 'text-blue-950',
    label: 'AUTHENTIC, WAITING FOR SIGNATURES',
    text: 'The file matches the agreement on-chain, but not every party has signed yet. It is binding only once all parties have signed.',
  },
  NOT_FOUND: {
    card: 'border-amber-300 bg-amber-50/50',
    icon: 'bg-amber-100 border-amber-300 text-amber-700',
    title: 'text-amber-950',
    label: 'NO PROOF FOUND ON-CHAIN',
    text: 'No proof account exists for this exact file. It was never notarized, or its content differs from the notarized version.',
  },
};

export default function VerificationTerminal({ initialPda = '' }) {
  const { chain, signer, isDemo, cluster } = useNotary();

  const [file, setFile] = useState(null);
  const [receivedHash, setReceivedHash] = useState('');
  const [reference, setReference] = useState(initialPda);
  const [recent, setRecent] = useState([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState(null);
  const [ancestors, setAncestors] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!signer) { setRecent([]); return undefined; }
    chain.listBySigner(signer.publicKey).then((l) => { if (!cancelled) setRecent(l); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chain, signer]);

  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setResult(null);
    setAncestors([]);
    setError('');
    try {
      setReceivedHash(await sha256Hex(selectedFile));
    } catch (err) {
      console.error('Failed to hash received file', err);
    }
  };

  // DEMO modunda hazır örnek: orijinal örneği (yoksa) DEMO zincirine kaydeder, PDA'sını seçer.
  const loadSampleFile = async (tampered = false) => {
    const content = tampered ? SAMPLE_TAMPERED : SAMPLE_CANONICAL;
    const f = new File([content], tampered ? 'report_tampered.pdf' : 'report_original.pdf', { type: 'application/pdf' });
    if (isDemo && signer) {
      try {
        const hash = await sha256Hex(SAMPLE_CANONICAL);
        const existing = (await chain.findByHash(hash))[0];
        const pda = existing?.proof_pda || (await chain.notarize({ signer, hashHex: hash })).proof_pda;
        setMeta(pda, { file_name: 'report_original.pdf' });
        setReference(pda);
      } catch (err) {
        setError(String(err.message || err));
      }
    }
    handleFileChange(f);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!file || !receivedHash) return;
    setIsVerifying(true);
    setError('');
    setAncestors([]);
    try {
      const ref = reference.trim();
      let opts = {};
      if (ref) {
        // Önce PDA (kayıt ya da sözleşme) olarak dene; hesap yoksa imzalayan adresi say.
        opts = (await chain.getRecord(ref).catch(() => null)) ? { pda: ref } : { signer: ref };
      }
      const res = await verifyDocument(chain, receivedHash, opts);
      setResult(res);
      if (res.proof_pda) {
        lineage(chain, res.proof_pda).then(setAncestors).catch(() => setAncestors([]));
      }
    } catch (err) {
      setError(`Verification failed: ${err.message || err}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const theme = result ? THEME[result.status] : null;
  const StatusIcon = { VERIFIED: CheckCircle2, INVALID: XCircle, PENDING: Clock }[result?.status] || HelpCircle;
  const source = isDemo ? 'in-browser DEMO store (not on-chain)' : new URL(RPC_URL).host;

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Header (Cal.com style) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <span className="cal-pill bg-gray-100 text-gray-800 font-mono text-xs">
            RECEIVER INTERFACE
          </span>
          <span className="text-xs font-mono text-gray-400">getAccountInfo(PDA)</span>
          <span className="cal-pill-emerald font-mono text-xs">NO API REQUIRED</span>
          {isDemo && (
            <span className="cal-pill bg-amber-50 text-amber-700 border border-amber-200 font-mono text-xs flex items-center space-x-1">
              <FlaskConical className="w-3 h-3" /><span>DEMO</span>
            </span>
          )}
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
          Verification Terminal
        </h2>
        <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
          Check any file against the proof account stored on Solana. The audit reads the chain directly, so it keeps working even if our servers are down.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">

        {/* Bento Card 1: File Ingestion */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 01</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Received Artifact</h3>
            </div>

            {isDemo && (
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => loadSampleFile(false)}
                  className="text-xs font-medium text-gray-700 hover:text-black bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors"
                >
                  Load Canonical Test
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleFile(true)}
                  className="text-xs font-medium text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition-colors"
                >
                  Load Tampered Test
                </button>
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-gray-200 hover:border-gray-400 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-white"
            onClick={() => document.getElementById('verify-file-input').click()}
          >
            <input
              id="verify-file-input"
              type="file"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <div className="w-12 h-12 rounded-full bg-white shadow-sm border border-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-700">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold text-gray-900">
              {file ? file.name : 'Select or drop the file to audit'}
            </div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB • Hashed locally, never uploaded` : 'The 256-bit hash is computed in your browser'}
            </div>
          </div>

          {receivedHash && (
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5 text-xs font-mono">
              <div className="flex items-center space-x-1.5 text-gray-500 text-[11px]">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                <span className="font-semibold text-gray-700">Calculated Incoming SHA-256 Digest:</span>
              </div>
              <div className="cal-hash-block font-bold text-gray-900 bg-white">
                {receivedHash}
              </div>
            </div>
          )}
        </div>

        {/* Bento Card 2: Proof reference */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 02</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Proof Reference</h3>
            </div>
            {recent.length > 0 && (
              <span className="text-xs font-mono text-gray-500 flex items-center space-x-1">
                <History className="w-3.5 h-3.5 text-gray-400" />
                <span>{recent.length} proof(s) signed by you</span>
              </span>
            )}
          </div>

          {recent.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Quick Select from Your Notarizations:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {recent.slice(0, 4).map((p) => (
                  <div
                    key={p.proof_pda}
                    onClick={() => setReference(p.proof_pda)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      reference === p.proof_pda
                        ? 'border-black bg-gray-50 shadow-xs ring-1 ring-black'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono font-bold">
                      <span className="text-gray-900">{shortKey(p.proof_pda, 6)}</span>
                      <span className="text-[10px] text-gray-400">{p.created_at_iso}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate mt-1">
                      {getMeta(p.proof_pda)?.file_name || shortKey(p.document_hash, 10)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Proof account (PDA) or signer address <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="cal-input font-mono text-xs"
              placeholder="Leave empty to search the chain by file hash"
            />
          </div>
        </div>

        {error && (
          <div className="cal-card p-4 border border-red-200 bg-red-50 text-xs text-red-800 font-mono break-all" role="alert">{error}</div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          disabled={!file || isVerifying}
          className="w-full cal-btn-primary py-3.5 text-sm rounded-xl font-bold flex items-center justify-center space-x-2 shadow-md disabled:opacity-40"
        >
          <Search className="w-4 h-4" />
          <span>{isVerifying ? 'Reading proof from Solana...' : 'Run Cryptographic Audit'}</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      </form>

      {/* Visual Audit Result Report (Cal.com Certificate Card) */}
      {result && theme && (
        <div className={`cal-card p-6 border-2 transition-all shadow-lg ${theme.card}`}>
          <div className="flex items-start space-x-3.5 mb-5">
            <div className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 ${theme.icon}`}>
              <StatusIcon className="w-7 h-7" />
            </div>
            <div>
              <h3 className={`text-lg font-extrabold font-sans tracking-tight ${theme.title}`}>{theme.label}</h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 leading-relaxed">{theme.text}</p>
            </div>
          </div>

          {/* Visual Bitmatch Progress Bar */}
          <div className="p-4 rounded-xl bg-white border border-gray-200 space-y-2 mb-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-gray-700 font-sans">Cryptographic Fingerprint Match:</span>
              <span className={`font-mono ${result.status === 'VERIFIED' ? 'text-emerald-600' : result.status === 'PENDING' ? 'text-blue-600' : result.status === 'INVALID' ? 'text-red-600' : 'text-amber-600'}`}>
                {result.status === 'VERIFIED' || result.status === 'PENDING' ? '100.0% Bit-level Match' : result.status === 'INVALID' ? '0.0% Match (Avalanche Effect)' : 'No record to compare'}
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  result.status === 'VERIFIED' ? 'w-full bg-emerald-500' : result.status === 'PENDING' ? 'w-full bg-blue-500' : result.status === 'INVALID' ? 'w-[5%] bg-red-500' : 'w-[2%] bg-amber-500'
                }`}
              />
            </div>
          </div>

          <div className="space-y-2.5 text-xs font-mono">
            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-[10px] text-gray-500 block mb-0.5">Anchored On-Chain Digest:</span>
              <span className={`break-all select-all font-bold text-xs ${result.original_hash ? 'text-emerald-700' : 'text-gray-500'}`}>
                {result.original_hash || '(no proof account found)'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-[10px] text-gray-500 block mb-0.5">Received File Digest:</span>
              <span className={`break-all select-all font-bold text-xs ${result.status === 'VERIFIED' ? 'text-emerald-700' : 'text-red-600'}`}>
                {result.received_hash}
              </span>
            </div>
          </div>

          {result.agreement && (
            <div className="mt-4 p-4 rounded-xl bg-white border border-gray-200 space-y-2">
              <div className="text-xs font-bold text-gray-700">
                Parties: {result.agreement.signed_count} of {result.agreement.parties.length} signed
              </div>
              {result.agreement.parties.map((p) => (
                <div key={p.signer} className="flex items-center justify-between text-[11px] font-mono">
                  <span title={p.signer}>{shortKey(p.signer, 8)}{p.signer === result.agreement.creator ? ' · creator' : ''}</span>
                  <span className={p.signed_at ? 'text-emerald-700' : 'text-amber-700'}>{p.signed_at ? `signed ${p.signed_at_iso}` : 'not signed yet'}</span>
                </div>
              ))}
            </div>
          )}

          {result.proof && (
            <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Signer</span>
                <span className="text-gray-900 font-bold" title={result.proof.signer}>{shortKey(result.proof.signer, 6)}</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Receiver</span>
                <span className="text-gray-900 font-bold" title={result.proof.receiver || ''}>{result.proof.receiver ? shortKey(result.proof.receiver, 6) : '—'}</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Chain time (UTC)</span>
                <span className="text-gray-900 font-bold truncate block">{result.proof.created_at_iso}</span>
              </div>
            </div>
          )}

          {ancestors.length > 0 && (
            <div className="mt-4 p-4 rounded-xl bg-white border border-gray-200 space-y-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-gray-700">
                <GitBranch className="w-3.5 h-3.5" />
                <span>This document is based on (read from the chain)</span>
              </div>
              {ancestors.map((a) => (
                <div key={a.document_hash} className="flex items-center justify-between text-[11px] font-mono text-gray-600">
                  <span title={a.document_hash}>{shortKey(a.document_hash, 10)}</span>
                  <span>
                    {a.missing ? <span className="text-amber-700">no proof on-chain</span> : `${shortKey(a.signer, 5)} · ${a.created_at_iso}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-gray-500">Source: {source}</span>
            {result.proof_pda && !isDemo && (
              <a
                href={`https://explorer.solana.com/address/${result.proof_pda}?cluster=${cluster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="cal-btn-primary py-2 px-4 text-xs rounded-lg flex items-center space-x-1.5"
              >
                <span>Inspect Proof Account on Solana</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

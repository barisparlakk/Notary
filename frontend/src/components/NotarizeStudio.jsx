import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { PublicKey } from '@solana/web3.js';
import {
  UploadCloud,
  ShieldCheck,
  Check,
  Copy,
  Cpu,
  Send,
  Key,
  Sparkles,
  ArrowRight,
  ArrowUpRight,
  Download,
  Plus,
  X,
  AlertTriangle,
  FlaskConical,
} from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';
import { buildCertificate, deriveProofPda, hexToBytes, sha256Hex, MAX_PARENTS } from '../lib/chain';
import { getMeta, setMeta } from '../lib/localMeta';
import { API_URL } from '../lib/config';

const HEX64 = /^[0-9a-f]{64}$/;

export default function NotarizeStudio({ onProofCreated }) {
  const { chain, signer, isDemo, cluster, programId, connection } = useNotary();

  const [file, setFile] = useState(null);
  const [docHash, setDocHash] = useState('');
  const [receiver, setReceiver] = useState('');
  const [parents, setParents] = useState([]);
  const [parentInput, setParentInput] = useState('');
  const [recent, setRecent] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [copiedField, setCopiedField] = useState('');
  const [balance, setBalance] = useState(null);
  const [useRelay, setUseRelay] = useState(!!API_URL);

  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setResult(null);
    setError('');
    try {
      setDocHash(await sha256Hex(selectedFile));
    } catch (err) {
      console.error('Hash calculation failed', err);
    }
  };

  const handleLoadSample = () => {
    const sampleContent = `Notary Provenance Report v2.0\nCreated: ${new Date().toISOString()}\nSigner: ${signer ? String(signer.publicKey) : 'unconnected'}\nStatus: APPROVED FOR NOTARIZATION`;
    handleFileChange(new File([sampleContent], 'notary_report.pdf', { type: 'application/pdf' }));
  };

  // Imzalayanın daha önce kaydettiği belgeler: üst belge (parents) seçimi için
  useEffect(() => {
    let cancelled = false;
    if (!signer) { setRecent([]); return undefined; }
    chain.listBySigner(signer.publicKey).then((list) => { if (!cancelled) setRecent(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chain, signer, result]);

  // Bakiye (yalnızca gerçek ağda)
  useEffect(() => {
    let cancelled = false;
    if (isDemo || !signer) { setBalance(null); return undefined; }
    connection.getBalance(signer.publicKey).then((b) => { if (!cancelled) setBalance(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isDemo, signer, connection, result]);

  const receiverError = useMemo(() => {
    if (!receiver) return '';
    try { new PublicKey(receiver); return ''; } catch { return 'Not a valid Solana address (base58)'; }
  }, [receiver]);

  const pdaPreview = useMemo(() => {
    if (!signer || !docHash) return '';
    return deriveProofPda(programId, signer.publicKey, hexToBytes(docHash))[0].toBase58();
  }, [signer, docHash, programId]);

  const addParent = (hash) => {
    const h = (hash || parentInput).trim().toLowerCase();
    if (!HEX64.test(h)) { setError('A parent must be a 64-character SHA-256 hex digest.'); return; }
    if (parents.includes(h) || parents.length >= MAX_PARENTS) return;
    setError('');
    setParents([...parents, h]);
    setParentInput('');
  };

  const handleAirdrop = async () => {
    try {
      const sig = await connection.requestAirdrop(signer.publicKey, 1_000_000_000);
      await new Promise((r) => setTimeout(r, 2000));
      setBalance(await connection.getBalance(signer.publicKey));
      return sig;
    } catch (err) {
      setError(`Airdrop failed (devnet rate limit?): ${err.message}`);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !docHash || !signer || receiverError) return;
    setIsSubmitting(true);
    setError('');
    try {
      const out = await chain.notarize({
        signer, hashHex: docHash, receiver: receiver || null, parents, relay: useRelay && API_URL ? API_URL : null,
      });
      const certificate = buildCertificate({
        proofPda: out.proof_pda, proof: out.proof, txSignature: out.tx_signature, programId, cluster,
      });
      setMeta(out.proof_pda, { file_name: file.name || 'document', file_size: file.size || 0, tx_signature: out.tx_signature });
      const res = { ...out, certificate, file_name: file.name || 'document' };
      setResult(res);
      setQr(await QRCode.toDataURL(certificate.verify_url, { margin: 1, width: 160 }));
      if (onProofCreated) onProofCreated(res);
    } catch (err) {
      const msg = String(err.message || err);
      // Cüzdan yanlış ağdaysa (örn. mainnet) simülasyon/blockhash hataları görülür; sebebi kullanıcıya söyle.
      const networkHint = signer?.kind === 'wallet' && /blockhash|simulat|network|cluster/i.test(msg)
        ? ` Check that your wallet is set to Solana ${cluster === 'devnet' ? 'Devnet' : cluster}.`
        : '';
      setError(msg + networkHint);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const downloadCertificate = () => {
    const blob = new Blob([JSON.stringify(result.certificate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-certificate-${result.proof_pda.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lowBalance = balance !== null && balance < 5_000_000;
  const explorerHref = result && !isDemo
    ? `https://explorer.solana.com/tx/${result.tx_signature}?cluster=${cluster}`
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Header section (Cal.com style) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <span className="cal-pill bg-gray-100 text-gray-800 font-mono text-xs">
            SIGNER INTERFACE
          </span>
          <span className="text-xs font-mono text-gray-400">program.notarize</span>
          {isDemo && (
            <span className="cal-pill bg-amber-50 text-amber-700 border border-amber-200 font-mono text-xs flex items-center space-x-1">
              <FlaskConical className="w-3 h-3" /><span>DEMO</span>
            </span>
          )}
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
          Notarize Studio
        </h2>
        <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
          Compute the SHA-256 fingerprint in your browser, sign with your wallet, and anchor a proof account (PDA) on Solana. Anyone can verify it later straight from the chain, without our API.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Bento Card 1: Artifact Ingestion */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 01</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Artifact Input</h3>
            </div>
            <button
              type="button"
              onClick={handleLoadSample}
              className="text-xs font-medium text-gray-600 hover:text-black flex items-center space-x-1 cursor-pointer bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>Load Sample Artifact</span>
            </button>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-gray-200 hover:border-gray-400 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-white"
            onClick={() => document.getElementById('file-upload-input').click()}
          >
            <input
              id="file-upload-input"
              type="file"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <div className="w-12 h-12 rounded-full bg-white shadow-sm border border-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-700">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold text-gray-900">
              {file ? file.name : 'Select or drag & drop a document to notarize'}
            </div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB • Hashed locally, the file never leaves your browser` : 'Contracts, PDFs, JSON, model weights, execution logs'}
            </div>
          </div>

          {docHash && (
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between text-gray-500 text-[11px]">
                <div className="flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-semibold text-gray-700">Client-Side Calculated SHA-256 Digest:</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(docHash, 'hash')}
                  className="text-gray-500 hover:text-black flex items-center space-x-1 cursor-pointer font-sans"
                >
                  {copiedField === 'hash' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'hash' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="cal-hash-block font-bold text-gray-900 bg-white">
                {docHash}
              </div>
            </div>
          )}
        </div>

        {/* Bento Card 2: Provenance context */}
        <div className="cal-card p-6 space-y-4">
          <div className="pb-3 border-b border-gray-100">
            <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 02</span>
            <h3 className="text-base font-bold text-gray-950 font-sans">Provenance Context</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">Signer</label>
              <div className="cal-input font-mono text-xs bg-gray-50 break-all" aria-live="polite">
                {signer ? `${signer.label} · ${String(signer.publicKey)}` : 'No wallet connected. Use “Connect wallet” in the top bar.'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">Receiver (optional)</label>
              <input
                type="text"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value.trim())}
                className="cal-input font-mono text-xs"
                placeholder="Receiver wallet address (base58)"
              />
              {receiverError && <div className="text-[11px] text-red-700 mt-1">{receiverError}</div>}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">Based on (parent documents, optional)</label>
              <span className="text-[11px] font-mono text-gray-400">{parents.length}/{MAX_PARENTS}</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={parentInput}
                onChange={(e) => setParentInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParent(); } }}
                className="cal-input font-mono text-xs"
                placeholder="Parent SHA-256 (64 hex)"
              />
              <button type="button" onClick={() => addParent()} className="cal-btn-secondary py-2 px-3 text-xs rounded-lg flex items-center space-x-1">
                <Plus className="w-3.5 h-3.5" /><span>Add</span>
              </button>
            </div>
            {recent.length > 0 && parents.length < MAX_PARENTS && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recent.slice(0, 4).map((p) => (
                  <button
                    key={p.proof_pda}
                    type="button"
                    onClick={() => addParent(p.document_hash)}
                    className="text-[11px] font-mono px-2 py-1 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600"
                    title={p.document_hash}
                  >
                    {getMeta(p.proof_pda)?.file_name || shortKey(p.document_hash, 6)}
                  </button>
                ))}
              </div>
            )}
            {parents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {parents.map((h) => (
                  <span key={h} className="inline-flex items-center space-x-1 text-[11px] font-mono px-2 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700">
                    <span>{shortKey(h, 8)}</span>
                    <button type="button" aria-label="Remove parent" onClick={() => setParents(parents.filter((x) => x !== h))}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="text-[11px] font-mono text-gray-500">
            Timestamp comes from the Solana clock when the transaction lands. You cannot back-date a proof.
          </div>
        </div>

        {/* Bento Card 3: On-chain signature */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 03</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Wallet Signature &amp; Proof Account</h3>
            </div>
            {!isDemo && lowBalance && cluster === 'devnet' && !useRelay && (
              <button
                type="button"
                onClick={handleAirdrop}
                className="cal-btn-secondary py-1.5 px-3 text-xs font-semibold rounded-lg flex items-center space-x-1.5"
              >
                <Key className="w-3.5 h-3.5 text-gray-600" />
                <span>Airdrop 1 devnet SOL</span>
              </button>
            )}
          </div>

          {!isDemo && signer?.kind === 'wallet' && (
            <div className="text-[11px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              Wallet extensions do not tell websites which network they are on. Make sure {signer.label} is set to Solana {cluster === 'devnet' ? 'Devnet' : cluster}
              {cluster === 'devnet' ? ' (Phantom: Settings, Developer Settings, Testnet Mode).' : '.'}
            </div>
          )}

          {!isDemo && API_URL && (
            <label className="flex items-center space-x-2 text-xs text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="accent-black" />
              <span>Let the Notary relayer pay the network fee <span className="text-gray-400">(you still sign; no SOL needed)</span></span>
            </label>
          )}

          <div className="p-3.5 rounded-xl bg-gray-50 text-xs font-mono border border-gray-200 space-y-1">
            <span className="text-gray-500 font-bold block text-[11px]">Proof account (PDA) that will hold this record:</span>
            <div className="text-gray-800 break-all select-all font-mono">
              {pdaPreview || 'Select a document and connect a wallet to derive the address'}
            </div>
            <div className="text-[11px] text-gray-500 pt-1">
              seeds: [“proof”, signer, document_hash] · your wallet signs the transaction, there is no separate signature to paste.
              {balance !== null && ` Balance: ${(balance / 1e9).toFixed(4)} SOL.`}
            </div>
          </div>
        </div>

        {error && (
          <div className="cal-card p-4 border border-red-200 bg-red-50 text-xs text-red-800 flex items-start space-x-2" role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="font-mono break-all">{error}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!file || !signer || !!receiverError || isSubmitting}
          className="w-full cal-btn-primary py-3.5 text-sm rounded-xl font-bold flex items-center justify-center space-x-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          <span>
            {isSubmitting
              ? 'Waiting for wallet and network...'
              : isDemo ? 'Create DEMO proof (not on-chain)' : 'Sign & Notarize on Solana'}
          </span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      </form>

      {/* Confirmation Panel (Cal.com Receipt card) */}
      {result && (
        <div className="cal-card p-6 border-2 border-emerald-300 bg-emerald-50/50 space-y-4 shadow-lg">
          <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-emerald-950 font-sans">
                {isDemo ? 'DEMO proof created (not on-chain)' : `Notarization Confirmed on Solana ${cluster === 'devnet' ? 'Devnet' : cluster}`}
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              {isDemo ? 'DEMO' : 'PROOF RECORDED'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
            <div className="space-y-3 text-xs font-mono min-w-0">
              <div className="p-3.5 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Proof account (PDA)</span>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-gray-900 font-bold text-sm break-all">{result.proof_pda}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(result.proof_pda, 'pda')}
                    className="text-gray-500 hover:text-black cursor-pointer font-sans shrink-0"
                    aria-label="Copy PDA"
                  >
                    {copiedField === 'pda' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-white border border-gray-200">
                  <span className="text-gray-500 block text-[10px]">Signer</span>
                  <span className="text-gray-900 font-bold text-sm mt-1 block">{shortKey(result.proof.signer, 6)}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-white border border-gray-200">
                  <span className="text-gray-500 block text-[10px]">Chain time (UTC)</span>
                  <span className="text-gray-900 font-bold text-sm mt-1 block">{result.proof.created_at_iso}</span>
                </div>
              </div>

              <div>
                <span className="text-gray-500 block text-[10px] mb-1">Transaction Signature:</span>
                <div className="p-3 rounded-xl bg-white text-xs text-gray-800 break-all select-all border border-gray-200 font-bold">
                  {result.tx_signature}
                </div>
              </div>
            </div>

            {qr && (
              <div className="flex flex-col items-center space-y-1.5">
                <img src={qr} alt="QR code of the verification link" className="w-32 h-32 rounded-lg border border-gray-200 bg-white" />
                <span className="text-[10px] font-mono text-gray-500">Scan to verify</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {explorerHref ? (
              <a
                href={explorerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="cal-btn-primary py-2 px-4 text-xs rounded-lg flex items-center space-x-1.5"
              >
                <span>View on Solana Explorer</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            ) : <span />}

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => copyToClipboard(result.certificate.verify_url, 'link')}
                className="cal-btn-secondary py-2 px-4 text-xs rounded-lg font-mono flex items-center space-x-1.5"
              >
                {copiedField === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'link' ? 'Copied' : 'Copy verify link'}</span>
              </button>
              <button
                type="button"
                onClick={downloadCertificate}
                className="cal-btn-secondary py-2 px-4 text-xs rounded-lg font-mono flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download certificate</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

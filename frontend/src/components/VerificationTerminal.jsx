import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  UploadCloud, 
  Cpu, 
  Search, 
  ExternalLink, 
  FileCheck, 
  History 
} from 'lucide-react';
import { calculateSha256Browser, verifyDocument, getStoredProofs } from '../api';

export default function VerificationTerminal() {
  const [file, setFile] = useState(null);
  const [receivedHash, setReceivedHash] = useState('');
  const [recentProofs] = useState(() => getStoredProofs());
  const [proofId, setProofId] = useState(() => {
    const list = getStoredProofs();
    return list.length > 0 ? list[0].proof_id : '';
  });
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setVerifyResult(null);
    try {
      const hash = await calculateSha256Browser(selectedFile);
      setReceivedHash(hash);
    } catch (err) {
      console.error('Failed to hash received file', err);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!file || !proofId) return;

    setIsVerifying(true);
    try {
      const res = await verifyDocument({
        file,
        proof_id: proofId
      });
      setVerifyResult(res.data);
    } catch (err) {
      console.error('Verification error:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-xs font-mono text-emerald-300 mb-2">
          <FileCheck className="w-3.5 h-3.5" />
          <span>Receiver Terminal</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Verification Terminal</h2>
        <p className="text-slate-400 text-sm">
          Validate received digital outputs against the Solana blockchain notarization proof to ensure zero tampering.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
          <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
            1. Select Received Artifact
          </label>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors bg-cyber-900/40"
            onClick={() => document.getElementById('verify-file-input').click()}
          >
            <input
              id="verify-file-input"
              type="file"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <UploadCloud className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-200">
              {file ? file.name : 'Select or drop received file for audit'}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB` : 'Auditing against immutable blockchain record'}
            </p>
          </div>

          {receivedHash && (
            <div className="p-3.5 rounded-xl bg-cyber-950/80 border border-emerald-500/30 space-y-1">
              <div className="flex items-center space-x-2">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] font-mono text-emerald-300">Received File SHA-256 Digest:</span>
              </div>
              <div className="text-xs font-mono text-slate-200 break-all select-all font-semibold">
                {receivedHash}
              </div>
            </div>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
              2. Blockchain Proof Reference ID
            </label>
            {recentProofs.length > 0 && (
              <span className="text-[11px] font-mono text-slate-400 flex items-center space-x-1">
                <History className="w-3 h-3 text-cyan-400" />
                <span>{recentProofs.length} proof(s) in registry</span>
              </span>
            )}
          </div>

          {recentProofs.length > 0 && (
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">Select from Recent Notarizations</label>
              <select
                value={proofId}
                onChange={(e) => setProofId(e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono mb-3"
              >
                {recentProofs.map((p) => (
                  <option key={p.proof_id} value={p.proof_id} className="bg-cyber-900 text-slate-200">
                    {p.proof_id} — {p.file_name || 'Document'} ({p.sender} ➔ {p.receiver})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Or Enter Custom Proof ID</label>
            <input
              type="text"
              value={proofId}
              onChange={(e) => setProofId(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="proof-8821a9c1"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!file || !proofId || isVerifying}
          className="w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm shadow-glow-emerald disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          <Search className="w-4 h-4" />
          <span>{isVerifying ? 'Verifying with Solana Proof...' : 'Verify File Integrity'}</span>
        </button>
      </form>

      {verifyResult && (
        <div className={`rounded-2xl p-6 border transition-all animate-fadeIn ${
          verifyResult.status === 'VERIFIED'
            ? 'glass-panel border-emerald-500/50 shadow-glow-emerald bg-emerald-950/20'
            : 'glass-panel border-rose-500/50 shadow-glow-rose bg-rose-950/20'
        }`}>
          <div className="flex items-center space-x-3 mb-6">
            {verifyResult.status === 'VERIFIED' ? (
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center">
                <XCircle className="w-7 h-7 text-rose-400" />
              </div>
            )}

            <div>
              <h3 className={`text-xl font-bold font-mono tracking-tight ${
                verifyResult.status === 'VERIFIED' ? 'text-emerald-300' : 'text-rose-300'
              }`}>
                {verifyResult.status === 'VERIFIED' ? 'STATUS: VERIFIED' : 'STATUS: INVALID / MODIFIED'}
              </h3>
              <p className="text-xs text-slate-400">
                {verifyResult.status === 'VERIFIED'
                  ? 'Cryptographic integrity confirmed. Document matches notarized original.'
                  : 'Hash mismatch! The received file has been altered or does not correspond to this proof.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3.5 rounded-xl bg-cyber-950/90 border border-white/5 space-y-1">
              <span className="text-slate-500 block text-[10px]">ORIGINAL HASH (Anchored on Solana):</span>
              <span className="text-emerald-400 break-all select-all font-semibold">
                {verifyResult.original_hash || '(Proof not found)'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-cyber-950/90 border border-white/5 space-y-1">
              <span className="text-slate-500 block text-[10px]">RECEIVED FILE HASH:</span>
              <span className={`break-all select-all font-semibold ${
                verifyResult.status === 'VERIFIED' ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {verifyResult.received_hash}
              </span>
            </div>
          </div>

          {verifyResult.proof && (
            <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-cyber-900/60">
                <span className="text-slate-500 block text-[10px]">Sender Agent</span>
                <span className="text-slate-200">{verifyResult.proof.sender}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-cyber-900/60">
                <span className="text-slate-500 block text-[10px]">Receiver Agent</span>
                <span className="text-slate-200">{verifyResult.proof.receiver}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-cyber-900/60">
                <span className="text-slate-500 block text-[10px]">Timestamp</span>
                <span className="text-slate-200">{verifyResult.proof.timestamp}</span>
              </div>
            </div>
          )}

          {verifyResult.proof?.explorer_url && (
            <div className="mt-4 flex justify-end">
              <a
                href={verifyResult.proof.explorer_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1.5 text-xs text-purple-400 hover:text-purple-300 font-mono"
              >
                <span>View Blockchain Proof on Solana Explorer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  UploadCloud, 
  Cpu, 
  Search, 
  ExternalLink, 
  History,
  FileCheck,
  ShieldAlert,
  ArrowRight,
  ArrowUpRight,
  Sparkles
} from 'lucide-react';
import { calculateSha256Browser, verifyDocument, getStoredProofs } from '../api';

const SAMPLE_CANONICAL = `ChainNotary Provenance Report v1.0
Timestamp: 2026-10-03T18:30:00Z
Sender: agent_a (Research & Strategy)
Receiver: agent_b (Execution & Treasury)
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": 150000.00,
  "risk_score": 0.04,
  "status": "APPROVED FOR EXECUTION"
}`;

const SAMPLE_TAMPERED = `ChainNotary Provenance Report v1.0
Timestamp: 2026-10-03T18:30:00Z
Sender: agent_a (Research & Strategy)
Receiver: agent_b (Execution & Treasury)
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": 1500000.00,
  "risk_score": 0.99,
  "status": "REVOKED & EXPLOITED"
}`;

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

  const loadSampleFile = (tampered = false) => {
    const content = tampered ? SAMPLE_TAMPERED : SAMPLE_CANONICAL;
    const name = tampered ? "report_tampered.pdf" : "report_original.pdf";
    const f = new File([content], name, { type: "application/pdf" });
    handleFileChange(f);
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
    <div className="max-w-4xl mx-auto space-y-8">
      
      {/* Header (Cal.com style) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <span className="cal-pill bg-gray-100 text-gray-800 font-mono text-xs">
            RECEIVER INTERFACE
          </span>
          <span className="text-xs font-mono text-gray-400">POST /verify</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
          Verification Terminal
        </h2>
        <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
          Audit received artifacts against immutable Solana transaction proofs to establish cryptographic integrity.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        
        {/* Bento Card 1: File Ingestion with Test Presets */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 01</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Received Artifact</h3>
            </div>
            
            {/* Quick Test Presets (Cal.com style pill buttons) */}
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
              {file ? file.name : 'Select or drop incoming file to audit'}
            </div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB • Computed locally` : 'Computes 256-bit hash locally before network dispatch'}
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

        {/* Bento Card 2: Proof Selector */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 02</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Proof Identifier</h3>
            </div>
            {recentProofs.length > 0 && (
              <span className="text-xs font-mono text-gray-500 flex items-center space-x-1">
                <History className="w-3.5 h-3.5 text-gray-400" />
                <span>{recentProofs.length} registered proof(s)</span>
              </span>
            )}
          </div>

          {recentProofs.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Quick Select from Recent Notarizations:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {recentProofs.slice(0, 4).map((p) => (
                  <div
                    key={p.proof_id}
                    onClick={() => setProofId(p.proof_id)}
                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                      proofId === p.proof_id
                        ? 'border-black bg-gray-50 shadow-xs ring-1 ring-black'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono font-bold">
                      <span className="text-gray-900">{p.proof_id}</span>
                      <span className="text-[10px] text-gray-400">{p.sender} ➔ {p.receiver}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate mt-1">
                      {p.file_name || 'report.pdf'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">Or Enter Exact Proof ID</label>
            <input
              type="text"
              value={proofId}
              onChange={(e) => setProofId(e.target.value)}
              className="cal-input font-mono text-xs"
              placeholder="e.g. proof-8821a9c1"
            />
          </div>
        </div>

        {/* Action Button */}
        <button
          type="submit"
          disabled={!file || !proofId || isVerifying}
          className="w-full cal-btn-primary py-3.5 text-sm rounded-xl font-bold flex items-center justify-center space-x-2 shadow-md disabled:opacity-40"
        >
          <Search className="w-4 h-4" />
          <span>{isVerifying ? 'Auditing with Solana Devnet...' : 'Run Cryptographic Audit'}</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
      </form>

      {/* Enlarged Visual Audit Result Report (Cal.com Certificate Card) */}
      {verifyResult && (
        <div className={`cal-card p-6 border-2 transition-all shadow-lg ${
          verifyResult.status === 'VERIFIED'
            ? 'border-emerald-300 bg-emerald-50/40'
            : 'border-red-300 bg-red-50/50'
        }`}>
          <div className="flex items-start space-x-3.5 mb-5">
            {verifyResult.status === 'VERIFIED' ? (
              <div className="w-12 h-12 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-red-100 border border-red-300 flex items-center justify-center text-red-700 shrink-0">
                <XCircle className="w-7 h-7" />
              </div>
            )}

            <div>
              <h3 className={`text-lg font-extrabold font-sans tracking-tight ${
                verifyResult.status === 'VERIFIED' ? 'text-emerald-950' : 'text-red-950'
              }`}>
                {verifyResult.status === 'VERIFIED' ? 'VERIFIED: DOCUMENT IS AUTHENTIC' : 'INTEGRITY VIOLATION DETECTED'}
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 leading-relaxed">
                {verifyResult.status === 'VERIFIED'
                  ? 'The incoming file content matches the on-chain notarized SHA-256 fingerprint bit-for-bit.'
                  : 'Hash mismatch detected. The document was modified in transit or does not match this proof reference.'}
              </p>
            </div>
          </div>

          {/* Visual Bitmatch Progress Bar */}
          <div className="p-4 rounded-xl bg-white border border-gray-200 space-y-2 mb-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-gray-700 font-sans">Cryptographic Fingerprint Match:</span>
              <span className={`font-mono ${verifyResult.status === 'VERIFIED' ? 'text-emerald-600' : 'text-red-600'}`}>
                {verifyResult.status === 'VERIFIED' ? '100.0% Bit-level Match' : '0.0% Match (Avalanche Effect)'}
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  verifyResult.status === 'VERIFIED' ? 'w-full bg-emerald-500' : 'w-[5%] bg-red-500'
                }`}
              />
            </div>
          </div>

          <div className="space-y-2.5 text-xs font-mono">
            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-[10px] text-gray-500 block mb-0.5">Anchored On-Chain Digest:</span>
              <span className="text-emerald-700 break-all select-all font-bold text-xs">
                {verifyResult.original_hash || '(Proof not found)'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-[10px] text-gray-500 block mb-0.5">Received File Digest:</span>
              <span className={`break-all select-all font-bold text-xs ${
                verifyResult.status === 'VERIFIED' ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {verifyResult.received_hash}
              </span>
            </div>
          </div>

          {verifyResult.proof && (
            <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Sender</span>
                <span className="text-gray-900 font-bold">{verifyResult.proof.sender}</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Receiver</span>
                <span className="text-gray-900 font-bold">{verifyResult.proof.receiver}</span>
              </div>
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <span className="text-gray-500 block text-[10px]">Timestamp</span>
                <span className="text-gray-900 font-bold truncate block">{verifyResult.proof.timestamp}</span>
              </div>
            </div>
          )}

          {verifyResult.proof?.explorer_url && (
            <div className="mt-4 flex justify-end">
              <a
                href={verifyResult.proof.explorer_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cal-btn-primary py-2 px-4 text-xs rounded-lg flex items-center space-x-1.5"
              >
                <span>Inspect Solana Devnet Proof</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
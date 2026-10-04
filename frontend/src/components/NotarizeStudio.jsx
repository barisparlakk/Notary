import React, { useState } from 'react';
import { 
  UploadCloud, 
  ShieldCheck, 
  Check, 
  Copy, 
  ExternalLink, 
  Cpu, 
  Send, 
  Key, 
  FileText,
  Clock,
  Sparkles,
  ArrowRight,
  ArrowUpRight
} from 'lucide-react';
import { 
  calculateSha256Browser, 
  formatSignedMessage, 
  signMessageBrowser, 
  notarizeDocument, 
  getStoredAgents 
} from '../api';
import { INITIAL_TEST_VECTOR } from '../mocks';

export default function NotarizeStudio({ onProofCreated }) {
  const [file, setFile] = useState(null);
  const [docHash, setDocHash] = useState('');
  const [sender, setSender] = useState('agent_a');
  const [receiver, setReceiver] = useState('agent_b');
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const [signature, setSignature] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copiedField, setCopiedField] = useState('');
  const [agents] = useState(() => getStoredAgents());

  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setResult(null);
    try {
      const hash = await calculateSha256Browser(selectedFile);
      setDocHash(hash);
    } catch (err) {
      console.error('Hash calculation failed', err);
    }
  };

  const handleLoadSample = () => {
    const sampleContent = `ChainNotary Provenance Report v1.0\nTimestamp: ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}\nSender: ${sender}\nReceiver: ${receiver}\nStatus: APPROVED FOR NOTARIZATION`;
    const sampleFile = new File([sampleContent], "notary_report.pdf", { type: "application/pdf" });
    handleFileChange(sampleFile);
  };

  const handleAutoSign = () => {
    if (!docHash) return;
    const currentTs = timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    setTimestamp(currentTs);
    const msg = formatSignedMessage(docHash, sender, receiver, currentTs);
    
    const seed = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
    const sig = signMessageBrowser(seed, msg) || INITIAL_TEST_VECTOR.signature;
    setSignature(sig);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !signature) return;

    setIsSubmitting(true);
    try {
      const res = await notarizeDocument({
        file,
        sender,
        receiver,
        timestamp,
        signature
      });
      setResult(res.data);
      if (onProofCreated) onProofCreated(res.data);
    } catch (err) {
      console.error('Notarization error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(''), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      
      {/* Header section (Cal.com style) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <span className="cal-pill bg-gray-100 text-gray-800 font-mono text-xs">
            SENDER INTERFACE
          </span>
          <span className="text-xs font-mono text-gray-400">POST /notarize</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
          Notarize Studio
        </h2>
        <p className="text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
          Compute client-side SHA-256 fingerprint, attach Ed25519 digital signature, and permanently anchor immutable proof to the Solana Devnet blockchain.
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
              {file ? file.name : 'Select or drag & drop an artifact to notarize'}
            </div>
            <div className="text-xs text-gray-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB • Ready for hashing` : 'Supports PDF, JSON, EVM Bytecode, Model Weights, Execution Logs'}
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

        {/* Bento Card 2: Transfer Metadata */}
        <div className="cal-card p-6 space-y-4">
          <div className="pb-3 border-b border-gray-100">
            <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 02</span>
            <h3 className="text-base font-bold text-gray-950 font-sans">Provenance Context</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">Sender Agent</label>
              <select
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                className="cal-input font-mono text-xs cursor-pointer"
              >
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.agent_id} ({a.role || 'Agent'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">Receiver Agent</label>
              <select
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="cal-input font-mono text-xs cursor-pointer"
              >
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.agent_id} ({a.role || 'Agent'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">Timestamp (ISO 8601 UTC)</label>
              <button
                type="button"
                onClick={() => setTimestamp(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))}
                className="text-[11px] text-blue-600 hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <Clock className="w-3 h-3" />
                <span>Now</span>
              </button>
            </div>
            <input
              type="text"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              className="cal-input font-mono text-xs"
              placeholder="2026-10-03T18:30:00Z"
            />
          </div>
        </div>

        {/* Bento Card 3: Cryptographic Signature */}
        <div className="cal-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <span className="text-xs font-mono font-bold text-gray-400 uppercase">Step 03</span>
              <h3 className="text-base font-bold text-gray-950 font-sans">Ed25519 Detached Signature</h3>
            </div>
            <button
              type="button"
              onClick={handleAutoSign}
              disabled={!docHash}
              className="cal-btn-secondary py-1.5 px-3 text-xs font-semibold rounded-lg flex items-center space-x-1.5 disabled:opacity-40"
            >
              <Key className="w-3.5 h-3.5 text-gray-600" />
              <span>Sign with {sender} Seed</span>
            </button>
          </div>

          <div>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="cal-input font-mono text-xs"
              placeholder="Base64 64-byte Ed25519 Detached Signature"
            />
          </div>

          {docHash && (
            <div className="p-3.5 rounded-xl bg-gray-50 text-xs font-mono border border-gray-200 space-y-1">
              <span className="text-gray-500 font-bold block text-[11px]">Canonical Signed Message:</span>
              <div className="text-gray-800 break-all select-all font-mono">
                {formatSignedMessage(docHash, sender, receiver, timestamp)}
              </div>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!file || !signature || isSubmitting}
          className="w-full cal-btn-primary py-3.5 text-sm rounded-xl font-bold flex items-center justify-center space-x-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          <span>{isSubmitting ? 'Writing to Solana Devnet...' : 'Submit Notarization to Solana Network'}</span>
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
                Notarization Confirmed on Solana Devnet
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              PROOF RECORDED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-gray-500 block text-[10px]">Proof ID</span>
              <div className="flex items-center justify-between mt-1">
                <span className="text-gray-900 font-bold text-sm">{result.proof_id}</span>
                <button
                  onClick={() => copyToClipboard(result.proof_id, 'proof_id')}
                  className="text-gray-500 hover:text-black cursor-pointer font-sans"
                >
                  {copiedField === 'proof_id' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-gray-200">
              <span className="text-gray-500 block text-[10px]">Route</span>
              <span className="text-gray-900 font-bold text-sm mt-1 block">{result.sender} ➔ {result.receiver}</span>
            </div>
          </div>

          <div className="text-xs font-mono">
            <span className="text-gray-500 block text-[10px] mb-1">Transaction Signature:</span>
            <div className="p-3 rounded-xl bg-white text-xs text-gray-800 break-all select-all border border-gray-200 font-bold">
              {result.tx_signature}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <a
              href={result.explorer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="cal-btn-primary py-2 px-4 text-xs rounded-lg flex items-center space-x-1.5"
            >
              <span>View on Solana Explorer</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => copyToClipboard(JSON.stringify(result, null, 2), 'json')}
              className="cal-btn-secondary py-2 px-4 text-xs rounded-lg font-mono flex items-center space-x-1.5"
            >
              {copiedField === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'json' ? 'Copied JSON' : 'Copy Proof JSON'}</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
import React, { useState } from 'react';
import { 
  UploadCloud, 
  ShieldCheck, 
  Check, 
  Copy, 
  ExternalLink, 
  Cpu, 
  Send, 
  Sparkles, 
  Layers 
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
    <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-xs font-mono text-cyan-300 mb-2">
          <Layers className="w-3.5 h-3.5" />
          <span>Sender Module</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Notarize Studio</h2>
        <p className="text-slate-400 text-sm">
          Compute instant browser-side SHA-256 fingerprint, digitally sign with Ed25519, and anchor immutable proof to Solana.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
          <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
            1. Select Artifact / Digital Output
          </label>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-cyan-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors bg-cyber-900/40"
            onClick={() => document.getElementById('file-upload-input').click()}
          >
            <input
              id="file-upload-input"
              type="file"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <UploadCloud className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-200">
              {file ? file.name : 'Click to select or drag and drop artifact'}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              {file ? `${(file.size / 1024).toFixed(2)} KB` : 'PDF, JSON, CSV, Images, Logs or Binaries'}
            </p>
          </div>

          {docHash && (
            <div className="p-3.5 rounded-xl bg-cyber-950/80 border border-cyan-500/30 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-mono text-cyan-300">Client-Side Web Crypto SHA-256 Digest:</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(docHash, 'hash')}
                  className="text-[10px] font-mono text-slate-400 hover:text-cyan-300 flex items-center space-x-1 cursor-pointer"
                >
                  {copiedField === 'hash' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedField === 'hash' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="text-xs font-mono text-slate-200 break-all select-all font-semibold">
                {docHash}
              </div>
            </div>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
          <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
            2. Provenance Metadata & Identities
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">Sender Agent ID</label>
              <select
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
              >
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id} className="bg-cyber-900 text-slate-200">
                    {a.agent_id} ({a.role || 'Agent'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">Receiver Agent ID</label>
              <select
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
              >
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id} className="bg-cyber-900 text-slate-200">
                    {a.agent_id} ({a.role || 'Agent'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 mb-1">Timestamp (ISO 8601 UTC)</label>
            <input
              type="text"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="2026-10-03T18:30:00Z"
            />
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
              3. Ed25519 Digital Signature
            </label>
            <button
              type="button"
              onClick={handleAutoSign}
              disabled={!docHash}
              className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-purple-950/80 hover:bg-purple-900/80 text-purple-300 border border-purple-500/40 text-xs font-mono font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Auto-Sign for {sender}</span>
            </button>
          </div>

          <div>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono"
              placeholder="Base64 Ed25519 Signature"
            />
          </div>

          {docHash && (
            <div className="p-3 rounded-lg bg-cyber-900/50 text-[11px] font-mono text-slate-400 space-y-1 border border-white/5">
              <span>Standard Message Payload:</span>
              <div className="text-slate-300 break-all">
                {formatSignedMessage(docHash, sender, receiver, timestamp)}
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!file || !signature || isSubmitting}
          className="w-full flex items-center justify-center space-x-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-sm shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>{isSubmitting ? 'Anchoring to Blockchain...' : 'Notarize & Anchor to Solana'}</span>
        </button>
      </form>

      {result && (
        <div className="glass-panel rounded-2xl p-6 border border-emerald-500/40 shadow-glow-emerald space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
              <h3 className="text-lg font-bold font-mono text-emerald-300">
                Notarization Confirmed
              </h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              PROOF CREATED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-lg bg-cyber-900/90 border border-white/5">
              <span className="text-slate-500 block text-[10px]">Proof ID</span>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-slate-200 font-bold">{result.proof_id}</span>
                <button
                  onClick={() => copyToClipboard(result.proof_id, 'proof_id')}
                  className="text-slate-400 hover:text-cyan-300 cursor-pointer"
                >
                  {copiedField === 'proof_id' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-cyber-900/90 border border-white/5">
              <span className="text-slate-500 block text-[10px]">Transfer Route</span>
              <span className="text-slate-200 font-semibold mt-0.5 block">{result.sender} ➔ {result.receiver}</span>
            </div>
          </div>

          <div>
            <span className="text-slate-500 block text-[10px] font-mono mb-1">Solana Tx Signature</span>
            <div className="p-3 rounded-lg bg-cyber-900/90 text-xs font-mono text-purple-200 break-all border border-white/5">
              {result.tx_signature}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <a
              href={result.explorer_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-mono"
            >
              <span>View on Solana Explorer</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => copyToClipboard(JSON.stringify(result, null, 2), 'json')}
              className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-slate-200 font-mono cursor-pointer"
            >
              {copiedField === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'json' ? 'Copied Full Proof JSON' : 'Copy Full JSON'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
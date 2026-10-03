import React, { useState } from 'react';
import { 
  Database, 
  Search, 
  ExternalLink, 
  Copy, 
  Check, 
  UserPlus, 
  Key, 
  Layers, 
  Sparkles, 
  ShieldCheck, 
  FileText 
} from 'lucide-react';
import { 
  getStoredProofs, 
  getStoredAgents, 
  registerAgent, 
  generateKeypairBrowser 
} from '../api';

export default function LedgerExplorer() {
  const [activeSection, setActiveSection] = useState('proofs');
  const [proofs] = useState(() => getStoredProofs());
  const [agents, setAgents] = useState(() => getStoredAgents());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProof, setSelectedProof] = useState(null);
  const [copiedKey, setCopiedKey] = useState('');

  const [newAgentId, setNewAgentId] = useState('');
  const [newPublicKey, setNewPublicKey] = useState('');
  const [newPrivateKey, setNewPrivateKey] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const handleGenerateKeypair = () => {
    const pair = generateKeypairBrowser();
    setNewPublicKey(pair.public_key);
    setNewPrivateKey(pair.private_key);
  };

  const handleRegisterAgent = async (e) => {
    e.preventDefault();
    if (!newAgentId || !newPublicKey) return;

    setIsRegistering(true);
    try {
      await registerAgent(newAgentId, newPublicKey);
      setAgents(getStoredAgents());
      setRegisterSuccess(true);
      setTimeout(() => setRegisterSuccess(false), 3000);
      setNewAgentId('');
      setNewPublicKey('');
      setNewPrivateKey('');
    } catch (err) {
      console.error('Registration failed', err);
    } finally {
      setIsRegistering(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const filteredProofs = proofs.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.proof_id?.toLowerCase().includes(q) ||
      p.document_hash?.toLowerCase().includes(q) ||
      p.sender?.toLowerCase().includes(q) ||
      p.receiver?.toLowerCase().includes(q) ||
      p.file_name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-950/80 border border-purple-500/30 text-xs font-mono text-purple-300 mb-2">
            <Database className="w-3.5 h-3.5" />
            <span>Immutable Registry</span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Ledger & Agent Registry</h2>
          <p className="text-slate-400 text-sm">
            Auditable log of all cryptographic notarizations anchored to Solana Devnet and registered AI identities.
          </p>
        </div>

        <div className="flex items-center p-1 rounded-xl bg-cyber-900 border border-white/10 self-start">
          <button
            onClick={() => setActiveSection('proofs')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeSection === 'proofs'
                ? 'bg-cyber-800 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Proof Ledger ({proofs.length})</span>
          </button>

          <button
            onClick={() => setActiveSection('agents')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
              activeSection === 'agents'
                ? 'bg-cyber-800 text-purple-400 border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Agent Directory ({agents.length})</span>
          </button>
        </div>
      </div>

      {activeSection === 'proofs' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Proof ID, SHA-256 Hash, Agent ID, or File Name..."
              className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono placeholder:text-slate-600"
            />
          </div>

          <div className="glass-panel rounded-2xl overflow-hidden border border-white/10">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-cyber-900/90 text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Proof ID</th>
                    <th className="p-3.5">Artifact / Route</th>
                    <th className="p-3.5">SHA-256 Digest</th>
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5">Solana Proof</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredProofs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No notarization records found matching your search.
                      </td>
                    </tr>
                  ) : (
                    filteredProofs.map((p) => (
                      <tr key={p.proof_id} className="hover:bg-cyber-900/50 transition-colors">
                        <td className="p-3.5">
                          <span className="font-bold text-cyan-400">{p.proof_id}</span>
                        </td>
                        <td className="p-3.5">
                          <div className="text-slate-200 font-medium flex items-center space-x-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            <span>{p.file_name || 'artifact.dat'}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {p.sender} ➔ {p.receiver}
                          </div>
                        </td>
                        <td className="p-3.5 max-w-[180px]">
                          <div className="truncate text-slate-300 select-all" title={p.document_hash}>
                            {p.document_hash}
                          </div>
                        </td>
                        <td className="p-3.5 text-slate-400 whitespace-nowrap">
                          {p.timestamp}
                        </td>
                        <td className="p-3.5">
                          {p.explorer_url ? (
                            <a
                              href={p.explorer_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-purple-400 hover:text-purple-300"
                            >
                              <span>Solana Tx</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-500">Local Proof</span>
                          )}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => setSelectedProof(p)}
                            className="px-2.5 py-1 rounded bg-cyber-800 hover:bg-cyber-700 text-slate-300 border border-white/10 text-[11px] cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'agents' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
            <div className="flex items-center space-x-2">
              <Key className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold font-mono text-slate-200">Register AI Agent</h3>
            </div>
            <p className="text-xs text-slate-400">
              Register an agent identity with its Base64 Ed25519 public key (<code>POST /agents/register</code>).
            </p>

            <form onSubmit={handleRegisterAgent} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Agent ID</label>
                <input
                  type="text"
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  placeholder="e.g. agent_c"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono text-slate-400">Public Key (Base64)</label>
                  <button
                    type="button"
                    onClick={handleGenerateKeypair}
                    className="text-[10px] font-mono text-purple-400 hover:text-purple-300 flex items-center space-x-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generate Keypair</span>
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={newPublicKey}
                  onChange={(e) => setNewPublicKey(e.target.value)}
                  placeholder="Base64 32-byte Ed25519 Public Key"
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono resize-none"
                  required
                />
              </div>

              {newPrivateKey && (
                <div className="p-3 rounded-lg bg-cyber-900 border border-purple-500/30 text-xs font-mono space-y-1">
                  <span className="text-purple-300 font-bold block text-[10px]">Private Key Seed (Keep Secure):</span>
                  <div className="text-[11px] text-slate-300 break-all select-all">
                    {newPrivateKey}
                  </div>
                </div>
              )}

              {registerSuccess && (
                <div className="p-2 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs font-mono text-center">
                  Agent registered successfully!
                </div>
              )}

              <button
                type="submit"
                disabled={isRegistering || !newAgentId || !newPublicKey}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-xs font-mono shadow-glow-purple disabled:opacity-50 transition-all cursor-pointer"
              >
                {isRegistering ? 'Registering...' : 'Register Agent Identity'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold font-mono text-slate-200">Registered AI Agents</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agents.map((agent) => (
                  <div
                    key={agent.agent_id}
                    className="p-4 rounded-xl bg-cyber-900/80 border border-white/5 space-y-2 hover:border-purple-500/30 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold font-mono text-cyan-400">{agent.agent_id}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyber-950 text-slate-400 border border-white/5">
                        Ed25519
                      </span>
                    </div>

                    <div className="text-xs text-slate-400">
                      {agent.role || 'Autonomous Network Agent'}
                    </div>

                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] text-slate-500 font-mono block">Public Key (Base64):</span>
                      <div className="flex items-center justify-between p-2 rounded bg-cyber-950 text-[11px] font-mono text-slate-300 break-all border border-white/5">
                        <span className="truncate pr-2">{agent.public_key}</span>
                        <button
                          onClick={() => copyToClipboard(agent.public_key, agent.agent_id)}
                          className="text-slate-400 hover:text-cyan-300 flex-shrink-0 cursor-pointer"
                        >
                          {copiedKey === agent.agent_id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel rounded-2xl max-w-2xl w-full p-6 border border-white/10 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold font-mono text-white">Proof Audit: {selectedProof.proof_id}</h3>
              </div>
              <button
                onClick={() => setSelectedProof(null)}
                className="text-slate-400 hover:text-white text-sm font-mono px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-cyber-950 text-xs font-mono text-slate-300 overflow-x-auto border border-white/5 leading-relaxed">
              {JSON.stringify(selectedProof, null, 2)}
            </pre>

            <div className="flex justify-end space-x-3 pt-2">
              {selectedProof.explorer_url && (
                <a
                  href={selectedProof.explorer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-purple-950 hover:bg-purple-900 border border-purple-500/40 text-purple-300 text-xs font-mono"
                >
                  <span>Open in Solana Explorer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => setSelectedProof(null)}
                className="px-4 py-2 rounded-lg bg-cyber-800 hover:bg-cyber-700 text-slate-300 text-xs font-mono cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
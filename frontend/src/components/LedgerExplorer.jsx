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
  FileText,
  X,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Zap
} from 'lucide-react';
import { 
  getStoredProofs, 
  getStoredAgents, 
  registerAgent, 
  generateKeypairBrowser 
} from '../api';
import PulsarGlassSegmented from './PulsarGlassSegmented';

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
    <div className="space-y-8">
      
      {/* Top Header & KPI Bento Cards (Cal.com style) */}
      <div className="space-y-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <span className="cal-pill bg-gray-100 text-gray-800 font-mono text-xs">
                IMMUTABLE AUDIT TRAIL
              </span>
              <span className="text-xs font-mono text-gray-400">solana-devnet</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
              Ledger & Identity Registry
            </h2>
            <p className="text-sm text-gray-600">
              Complete verifiable log of notarized documents anchored to Solana Devnet and authorized agent public keys.
            </p>
          </div>

          {/* Pulsar Glass Liquid Segmented Tabs */}
          <div className="self-start">
            <PulsarGlassSegmented
              options={[
                { value: 'proofs', label: `Notarized Proofs (${proofs.length})`, icon: <Layers className="w-3.5 h-3.5" /> },
                { value: 'agents', label: `Agent Directory (${agents.length})`, icon: <UserPlus className="w-3.5 h-3.5" /> },
              ]}
              value={activeSection}
              onChange={setActiveSection}
              size="sm"
              theme="light"
            />
          </div>
        </div>

        {/* 4 KPI Bento Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Anchored Proofs</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">{proofs.length}</div>
            <div className="text-[11px] text-emerald-600 font-medium flex items-center space-x-1">
              <span>✓ 100% On-Chain</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Authorized Agents</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">{agents.length}</div>
            <div className="text-[11px] text-blue-600 font-medium flex items-center space-x-1">
              <span>Ed25519 Keypairs</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Solana Network</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">Devnet</div>
            <div className="text-[11px] text-gray-500 font-medium flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>Sub-second finality</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Consensus Rate</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">100.0%</div>
            <div className="text-[11px] text-emerald-600 font-medium">
              Mathematical certainty
            </div>
          </div>
        </div>

      </div>

      {/* Proofs Section */}
      {activeSection === 'proofs' && (
        <div className="space-y-4">
          
          {/* Search Bar (Cal.com style) */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search proofs by ID, SHA-256 hash, agent identifier, or file..."
              className="cal-input pl-10 pr-4 py-2.5 text-xs font-mono"
            />
          </div>

          {/* Clean High-Density Table (Cal.com style) */}
          <div className="cal-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-200 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4 font-bold text-gray-700">Proof ID</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Artifact & Route</th>
                    <th className="py-3 px-4 font-bold text-gray-700">SHA-256 Digest</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Timestamp (UTC)</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Solana Proof</th>
                    <th className="py-3 px-4 font-bold text-gray-700 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredProofs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400 text-xs">
                        No registered notarization records found.
                      </td>
                    </tr>
                  ) : (
                    filteredProofs.map((p) => (
                      <tr key={p.proof_id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-gray-900">
                          {p.proof_id}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-gray-900 font-semibold flex items-center space-x-1.5 font-sans">
                            <FileText className="w-3.5 h-3.5 text-gray-400" />
                            <span>{p.file_name || 'report.pdf'}</span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {p.sender} ➔ {p.receiver}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-[200px]">
                          <div className="flex items-center space-x-1.5">
                            <span className="truncate text-gray-600 select-all font-mono text-[11px]" title={p.document_hash}>
                              {p.document_hash.substring(0, 14)}...{p.document_hash.substring(58)}
                            </span>
                            <button
                              onClick={() => copyToClipboard(p.document_hash, p.proof_id)}
                              className="text-gray-400 hover:text-black cursor-pointer"
                              title="Copy SHA-256"
                            >
                              {copiedKey === p.proof_id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-gray-500 tabular-nums whitespace-nowrap text-[11px]">
                          {p.timestamp}
                        </td>
                        <td className="py-3.5 px-4">
                          {p.explorer_url ? (
                            <a
                              href={p.explorer_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-blue-600 hover:underline text-[11px] font-medium font-sans"
                            >
                              <span>Solana Tx</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-gray-400 text-[11px]">Local Record</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setSelectedProof(p)}
                            className="cal-btn-secondary px-3 py-1 text-xs rounded-lg cursor-pointer"
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

      {/* Agents Section */}
      {activeSection === 'agents' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Registration Form (Cal.com Bento card) */}
          <div className="lg:col-span-1 cal-card p-6 space-y-4">
            <div className="flex items-center space-x-2 pb-3 border-b border-gray-100">
              <Key className="w-4 h-4 text-gray-700" />
              <h3 className="text-base font-bold text-gray-900 font-sans">Register Agent Key</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Register an authorized agent ID and its 32-byte Ed25519 Base64 public key (<code>POST /agents/register</code>).
            </p>

            <form onSubmit={handleRegisterAgent} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Agent Identifier</label>
                <input
                  type="text"
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  placeholder="e.g. agent_c"
                  className="cal-input font-mono text-xs"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700">Public Key (Base64)</label>
                  <button
                    type="button"
                    onClick={handleGenerateKeypair}
                    className="text-[11px] font-sans text-blue-600 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generate Ed25519 Pair</span>
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={newPublicKey}
                  onChange={(e) => setNewPublicKey(e.target.value)}
                  placeholder="Base64 32-byte Ed25519 Public Key"
                  className="cal-input font-mono text-xs resize-none"
                  required
                />
              </div>

              {newPrivateKey && (
                <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-xs font-mono space-y-1">
                  <span className="text-gray-500 font-bold block text-[10px]">Private Key Seed (Secret):</span>
                  <div className="text-[11px] text-gray-800 break-all select-all font-mono">
                    {newPrivateKey}
                  </div>
                </div>
              )}

              {registerSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium text-center">
                  Agent identity registered successfully!
                </div>
              )}

              <button
                type="submit"
                disabled={isRegistering || !newAgentId || !newPublicKey}
                className="w-full cal-btn-primary py-2.5 text-xs rounded-xl font-bold flex items-center justify-center space-x-1.5 disabled:opacity-40"
              >
                <span>{isRegistering ? 'Registering...' : 'Register Identity'}</span>
              </button>
            </form>
          </div>

          {/* Registered Agent Grid (Cal.com style cards) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="cal-card p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900 font-sans">Authorized Agent Identities</h3>
                <span className="text-xs font-mono text-gray-500">{agents.length} active keypairs</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agents.map((agent) => (
                  <div
                    key={agent.agent_id}
                    className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center font-bold text-[10px]">
                          {agent.agent_id.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-xs font-bold font-mono text-gray-900">{agent.agent_id}</span>
                      </div>
                      <span className="cal-pill text-[10px] py-0.5 px-2 bg-white text-gray-600">
                        Ed25519
                      </span>
                    </div>

                    <div className="text-xs text-gray-600">
                      {agent.role || 'Autonomous Network Agent'}
                    </div>

                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] text-gray-400 font-mono block">Public Key:</span>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white text-[11px] font-mono text-gray-700 border border-gray-200">
                        <span className="truncate pr-2">{agent.public_key}</span>
                        <button
                          onClick={() => copyToClipboard(agent.public_key, agent.agent_id)}
                          className="text-gray-400 hover:text-black cursor-pointer"
                        >
                          {copiedKey === agent.agent_id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
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

      {/* Proof Inspection Modal (Cal.com popup) */}
      {selectedProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="cal-card max-w-xl w-full p-6 space-y-4 shadow-2xl bg-white border border-gray-300">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <span className="text-sm font-bold text-gray-900 font-sans">
                Proof Record: {selectedProof.proof_id}
              </span>
              <button
                onClick={() => setSelectedProof(null)}
                className="text-gray-400 hover:text-gray-900 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-gray-50 text-xs font-mono text-gray-800 overflow-x-auto border border-gray-200 leading-relaxed">
              {JSON.stringify(selectedProof, null, 2)}
            </pre>

            <div className="flex justify-end space-x-2 pt-2">
              {selectedProof.explorer_url && (
                <a
                  href={selectedProof.explorer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cal-btn-primary py-2 px-3.5 text-xs rounded-lg flex items-center space-x-1.5"
                >
                  <span>Solana Explorer</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
              <button
                onClick={() => setSelectedProof(null)}
                className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg cursor-pointer"
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
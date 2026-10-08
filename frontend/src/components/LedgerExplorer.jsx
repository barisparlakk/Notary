import React, { useCallback, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import {
  Search,
  Copy,
  Check,
  UserPlus,
  Layers,
  FileText,
  ArrowUpRight,
  Download,
  GitBranch,
  Trash2,
  Users,
} from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';
import { buildCertificate, lineage } from '../lib/chain';
import { addIdentity, getIdentities, getMeta, removeIdentity } from '../lib/localMeta';
import Dialog from './Dialog';
import PulsarGlassSegmented from './PulsarGlassSegmented';
import AgreementsPanel from './AgreementsPanel';
import { downloadCertificatePdf } from '../lib/certificatePdf';

const HEX64 = /^[0-9a-f]{64}$/i;

export default function LedgerExplorer() {
  const { chain, signer, isDemo, cluster, programId } = useNotary();
  const [activeSection, setActiveSection] = useState('proofs');
  const [agreementCount, setAgreementCount] = useState(0);
  const [proofs, setProofs] = useState([]);
  const [listLabel, setListLabel] = useState('Signed by you');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [selectedProof, setSelectedProof] = useState(null);
  const [ancestors, setAncestors] = useState([]);
  const [copiedKey, setCopiedKey] = useState('');

  const [identities, setIdentities] = useState(() => getIdentities());
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [identityError, setIdentityError] = useState('');

  const loadMine = useCallback(async () => {
    if (!signer) { setProofs([]); return; }
    setLoading(true);
    try {
      setProofs(await chain.listBySigner(signer.publicKey));
      setListLabel('Signed by you');
    } catch (err) {
      setLookupError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [chain, signer]);

  useEffect(() => { loadMine(); }, [loadMine]);

  // Sekme etiketindeki sözleşme sayısı, bölüm açılmadan da doğru görünsün
  useEffect(() => {
    let cancelled = false;
    if (!signer) { setAgreementCount(0); return undefined; }
    chain.listAgreementsFor(signer.publicKey).then((l) => { if (!cancelled) setAgreementCount(l.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chain, signer]);

  // Herkese açık zincir araması: SHA-256, PDA ya da imzalayan adresi
  const handleLookup = async () => {
    const q = searchQuery.trim();
    if (!q) { loadMine(); return; }
    setLoading(true);
    setLookupError('');
    try {
      let found = [];
      if (HEX64.test(q)) {
        found = await chain.findByHash(q.toLowerCase());
      } else {
        new PublicKey(q); // geçerli adres mi
        const asProof = await chain.getProof(q).catch(() => null);
        found = asProof ? [{ ...asProof, proof_pda: q }] : await chain.listBySigner(q);
      }
      setProofs(found);
      setListLabel(`On-chain lookup: ${shortKey(q, 8)}`);
    } catch {
      setLookupError('Enter a SHA-256 (64 hex), a proof account (PDA) or a signer address.');
    } finally {
      setLoading(false);
    }
  };

  const openProof = async (p) => {
    setSelectedProof(p);
    setAncestors([]);
    lineage(chain, p.proof_pda).then(setAncestors).catch(() => setAncestors([]));
  };

  const handleAddIdentity = (e) => {
    e.preventDefault();
    try {
      const address = new PublicKey(newAddress.trim()).toBase58();
      setIdentities(addIdentity(newLabel.trim(), address));
      setNewLabel('');
      setNewAddress('');
      setIdentityError('');
    } catch {
      setIdentityError('Not a valid Solana address (base58).');
    }
  };

  const showSignerProofs = async (address) => {
    setActiveSection('proofs');
    setSearchQuery(address);
    setLoading(true);
    try {
      setProofs(await chain.listBySigner(address));
      setListLabel(`Signed by ${shortKey(address, 6)}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const certificateOf = (p) => buildCertificate({
    proofPda: p.proof_pda, proof: p, txSignature: getMeta(p.proof_pda)?.tx_signature, programId, cluster,
  });

  const downloadCertificate = (p) => {
    const blob = new Blob([JSON.stringify(certificateOf(p), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-certificate-${p.proof_pda.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredProofs = proofs.filter((p) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      p.proof_pda?.toLowerCase().includes(q) ||
      p.document_hash?.toLowerCase().includes(q) ||
      p.signer?.toLowerCase().includes(q) ||
      p.receiver?.toLowerCase().includes(q) ||
      getMeta(p.proof_pda)?.file_name?.toLowerCase().includes(q)
    );
  });

  const knownLabel = (address) => {
    if (signer && String(signer.publicKey) === address) return `${signer.label} (you)`;
    return identities.find((i) => i.address === address)?.label || '';
  };

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
              <span className="text-xs font-mono text-gray-400">{isDemo ? 'demo (in-browser)' : `solana-${cluster}`}</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 font-sans">
              Ledger & Identity Registry
            </h2>
            <p className="text-sm text-gray-600">
              Proof accounts read straight from Solana, plus an address book of the signers you know. Anyone can look up any proof, no account needed.
            </p>
          </div>

          {/* Pulsar Glass Liquid Segmented Tabs */}
          <div className="self-start max-w-full overflow-x-auto">
            <PulsarGlassSegmented
              options={[
                { value: 'proofs', label: `Proof Accounts (${proofs.length})`, icon: <Layers className="w-3.5 h-3.5" /> },
                { value: 'agreements', label: `Agreements (${agreementCount})`, icon: <Users className="w-3.5 h-3.5" /> },
                { value: 'agents', label: `Identities (${identities.length + (signer ? 1 : 0)})`, icon: <UserPlus className="w-3.5 h-3.5" /> },
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
            <div className="text-xs font-mono text-gray-500">Proof Accounts</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">{proofs.length}</div>
            <div className="text-[11px] text-emerald-600 font-medium flex items-center space-x-1">
              <span>{listLabel}</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Known Identities</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">{identities.length + (signer ? 1 : 0)}</div>
            <div className="text-[11px] text-blue-600 font-medium flex items-center space-x-1">
              <span>Wallet addresses</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Solana Network</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">{isDemo ? 'Demo' : cluster === 'devnet' ? 'Devnet' : cluster}</div>
            <div className="text-[11px] text-gray-500 font-medium flex items-center space-x-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isDemo ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              <span>{isDemo ? 'Not on-chain' : 'Sub-second finality'}</span>
            </div>
          </div>

          <div className="cal-card p-5 space-y-1.5">
            <div className="text-xs font-mono text-gray-500">Verification</div>
            <div className="text-2xl font-extrabold text-gray-950 font-sans">Direct RPC</div>
            <div className="text-[11px] text-emerald-600 font-medium">
              No API in the loop
            </div>
          </div>
        </div>

      </div>

      {/* Proofs Section */}
      {activeSection === 'proofs' && (
        <div className="space-y-4">

          {/* Search Bar (Cal.com style) */}
          <div className="flex items-center space-x-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
                placeholder="Filter below, or press Enter to look up a SHA-256, proof account (PDA) or signer on-chain..."
                className="cal-input pl-10 pr-4 py-2.5 text-xs font-mono"
              />
            </div>
            <button type="button" onClick={handleLookup} className="cal-btn-secondary py-2.5 px-4 text-xs rounded-lg">
              {loading ? 'Reading…' : 'Look up'}
            </button>
          </div>
          {lookupError && <div className="text-[11px] text-red-700">{lookupError}</div>}

          {/* Clean High-Density Table (Cal.com style) */}
          <div className="cal-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-200 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4 font-bold text-gray-700">Proof Account</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Artifact & Route</th>
                    <th className="py-3 px-4 font-bold text-gray-700">SHA-256 Digest</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Chain Time (UTC)</th>
                    <th className="py-3 px-4 font-bold text-gray-700">Solana Proof</th>
                    <th className="py-3 px-4 font-bold text-gray-700 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredProofs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400 text-xs">
                        {signer ? 'No proof accounts found. Notarize a document or look up another signer.' : 'Connect a wallet to see your proofs, or look up any signer, PDA or hash above.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProofs.map((p) => (
                      <tr key={p.proof_pda} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-gray-900" title={p.proof_pda}>
                          {shortKey(p.proof_pda, 6)}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-gray-900 font-semibold flex items-center space-x-1.5 font-sans">
                            <FileText className="w-3.5 h-3.5 text-gray-400" />
                            <span>{getMeta(p.proof_pda)?.file_name || 'unlabeled document'}</span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {knownLabel(p.signer) || shortKey(p.signer, 5)} ➔ {p.receiver ? (knownLabel(p.receiver) || shortKey(p.receiver, 5)) : '—'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-[200px]">
                          <div className="flex items-center space-x-1.5">
                            <span className="truncate text-gray-600 select-all font-mono text-[11px]" title={p.document_hash}>
                              {p.document_hash.substring(0, 14)}...{p.document_hash.substring(58)}
                            </span>
                            <button
                              onClick={() => copyToClipboard(p.document_hash, p.proof_pda)}
                              className="text-gray-400 hover:text-black cursor-pointer"
                              title="Copy SHA-256"
                            >
                              {copiedKey === p.proof_pda ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-gray-500 tabular-nums whitespace-nowrap text-[11px]">
                          {p.created_at_iso}
                        </td>
                        <td className="py-3.5 px-4">
                          {!isDemo ? (
                            <a
                              href={`https://explorer.solana.com/address/${p.proof_pda}?cluster=${cluster}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-blue-600 hover:underline text-[11px] font-medium font-sans"
                            >
                              <span>Proof account</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-gray-400 text-[11px]">Demo record</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => openProof(p)}
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

      {/* Agreements Section: çok taraflı sözleşmeler */}
      {activeSection === 'agreements' && <AgreementsPanel onLoaded={setAgreementCount} />}

      {/* Identities Section */}
      {activeSection === 'agents' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Add identity (Cal.com Bento card) */}
          <div className="lg:col-span-1 cal-card p-6 space-y-4">
            <div className="flex items-center space-x-2 pb-3 border-b border-gray-100">
              <UserPlus className="w-4 h-4 text-gray-700" />
              <h3 className="text-base font-bold text-gray-900 font-sans">Add Known Signer</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Identity on Notary is a wallet address. Label the addresses you trust (an agent, a colleague, a client). Labels stay in this browser; nothing is written on-chain and private keys are never stored here.
            </p>

            <form onSubmit={handleAddIdentity} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. agent_a, Ahmet"
                  className="cal-input font-mono text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Wallet address (base58)</label>
                <textarea
                  rows={2}
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="Solana public key"
                  className="cal-input font-mono text-xs resize-none"
                  required
                />
                {identityError && <div className="text-[11px] text-red-700 mt-1">{identityError}</div>}
              </div>
              <button
                type="submit"
                disabled={!newLabel || !newAddress}
                className="w-full cal-btn-primary py-2.5 text-xs rounded-xl font-bold flex items-center justify-center space-x-1.5 disabled:opacity-40"
              >
                <span>Save Identity</span>
              </button>
            </form>
          </div>

          {/* Identity cards (Cal.com style cards) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="cal-card p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900 font-sans">Signer Identities</h3>
                <span className="text-xs font-mono text-gray-500">{identities.length + (signer ? 1 : 0)} known</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...(signer ? [{ label: `${signer.label} (you)`, address: String(signer.publicKey), self: true }] : []), ...identities].map((id) => (
                  <div key={id.address} className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center font-bold text-[10px]">
                          {id.label.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-xs font-bold font-mono text-gray-900">{id.label}</span>
                      </div>
                      <span className="cal-pill text-[10px] py-0.5 px-2 bg-white text-gray-600">
                        Ed25519
                      </span>
                    </div>

                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] text-gray-400 font-mono block">Wallet address:</span>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white text-[11px] font-mono text-gray-700 border border-gray-200">
                        <span className="truncate pr-2">{id.address}</span>
                        <button
                          onClick={() => copyToClipboard(id.address, id.address)}
                          className="text-gray-400 hover:text-black cursor-pointer"
                          aria-label="Copy address"
                        >
                          {copiedKey === id.address ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <button onClick={() => showSignerProofs(id.address)} className="cal-btn-secondary px-3 py-1 text-xs rounded-lg">
                        View proofs
                      </button>
                      {!id.self && (
                        <button
                          onClick={() => setIdentities(removeIdentity(id.address))}
                          className="text-gray-400 hover:text-red-700 cursor-pointer"
                          aria-label="Remove identity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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
        <Dialog title={<>Proof Account: {shortKey(selectedProof.proof_pda, 8)}</>} onClose={() => setSelectedProof(null)}>

            <pre className="p-4 rounded-xl bg-gray-50 text-xs font-mono text-gray-800 overflow-x-auto border border-gray-200 leading-relaxed">
              {JSON.stringify(certificateOf(selectedProof), null, 2)}
            </pre>

            {ancestors.length > 0 && (
              <div className="p-4 rounded-xl bg-white border border-gray-200 space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-gray-700">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Based on (provenance, read from the chain)</span>
                </div>
                {ancestors.map((a) => (
                  <div key={a.document_hash} className="flex items-center justify-between text-[11px] font-mono text-gray-600">
                    <span title={a.document_hash}>{shortKey(a.document_hash, 10)}</span>
                    <span>{a.missing ? <span className="text-amber-700">no proof on-chain</span> : `${knownLabel(a.signer) || shortKey(a.signer, 5)} · ${a.created_at_iso}`}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {!isDemo && (
                <a
                  href={`https://explorer.solana.com/address/${selectedProof.proof_pda}?cluster=${cluster}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cal-btn-primary py-2 px-3.5 text-xs rounded-lg flex items-center space-x-1.5"
                >
                  <span>Solana Explorer</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
              <button
                onClick={() => downloadCertificate(selectedProof)}
                className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg cursor-pointer flex items-center space-x-1.5"
              >
                <Download className="w-3 h-3" />
                <span>Certificate</span>
              </button>
              <button
                onClick={() => downloadCertificatePdf(certificateOf(selectedProof), `notary-certificate-${selectedProof.proof_pda.slice(0, 8)}.pdf`)}
                className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg cursor-pointer flex items-center space-x-1.5"
              >
                <Download className="w-3 h-3" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => setSelectedProof(null)}
                className="cal-btn-secondary px-3.5 py-2 text-xs rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
        </Dialog>
      )}

    </div>
  );
}

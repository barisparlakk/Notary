import React, { useState, useEffect } from 'react';
import { ShieldCheck, ExternalLink, ArrowLeft } from 'lucide-react';
import { getProof } from '../api';

export default function ProofDetail({ proofId, onBack }) {
  const [proof, setProof] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!proofId) return;
      setLoading(true);
      const res = await getProof(proofId);
      if (res.success) setProof(res.data);
      setLoading(false);
    }
    load();
  }, [proofId]);

  if (loading) {
    return <div className="p-8 text-center text-slate-400 font-mono text-sm">Loading proof details...</div>;
  }

  if (!proof) {
    return <div className="p-8 text-center text-rose-400 font-mono text-sm">Proof record not found.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto glass-panel rounded-2xl p-6 border border-white/10 space-y-6">
      <div className="flex items-center justify-between">
        {onBack && (
          <button onClick={onBack} className="flex items-center space-x-1.5 text-xs font-mono text-slate-400 hover:text-white cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        )}
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-cyan-400" />
          <h3 className="font-bold font-mono text-white text-base">{proof.proof_id}</h3>
        </div>
      </div>

      <pre className="p-4 rounded-xl bg-cyber-950 text-xs font-mono text-slate-200 overflow-x-auto border border-white/5">
        {JSON.stringify(proof, null, 2)}
      </pre>

      {proof.explorer_url && (
        <a
          href={proof.explorer_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-1.5 text-xs font-mono text-purple-400 hover:text-purple-300"
        >
          <span>View Solana Devnet Transaction</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

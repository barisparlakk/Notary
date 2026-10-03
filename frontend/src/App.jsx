import React, { useState } from 'react';
import Navbar from './components/Navbar';
import PipelineSimulator from './components/PipelineSimulator';
import NotarizeStudio from './components/NotarizeStudio';
import VerificationTerminal from './components/VerificationTerminal';
import LedgerExplorer from './components/LedgerExplorer';

export default function App() {
  const [activeTab, setActiveTab] = useState('pipeline');

  return (
    <div className="min-h-screen bg-cyber-950 text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'pipeline' && <PipelineSimulator />}
        {activeTab === 'notarize' && <NotarizeStudio onProofCreated={() => setActiveTab('ledger')} />}
        {activeTab === 'verify' && <VerificationTerminal />}
        {activeTab === 'ledger' && <LedgerExplorer />}
      </main>

      <footer className="border-t border-white/10 bg-cyber-900/60 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-500">
            <div className="flex items-center space-x-3">
              <span className="text-slate-400 font-semibold">ChainNotary Protocol</span>
              <span>•</span>
              <span>SHA-256 (Hex)</span>
              <span>•</span>
              <span>Ed25519 (Base64)</span>
              <span>•</span>
              <span>ISO 8601 UTC</span>
            </div>

            <div className="flex items-center space-x-2 text-[11px] text-slate-500">
              <span>Stack: FastAPI + React + PyNaCl + Solana Devnet</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useState } from 'react';
import Navbar from './components/Navbar';
import PipelineSimulator from './components/PipelineSimulator';
import NotarizeStudio from './components/NotarizeStudio';
import VerificationTerminal from './components/VerificationTerminal';
import LedgerExplorer from './components/LedgerExplorer';

export default function App() {
  const [activeTab, setActiveTab] = useState('pipeline');

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900 flex flex-col antialiased font-sans selection:bg-black selection:text-white">
      {/* Cal.com style Top Navbar */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 w-full max-w-page mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'pipeline' && <PipelineSimulator />}
        {activeTab === 'notarize' && <NotarizeStudio />}
        {activeTab === 'verify' && <VerificationTerminal />}
        {activeTab === 'ledger' && <LedgerExplorer />}
      </main>

      {/* Cal.com style Clean Institutional Footer */}
      <footer className="border-t border-gray-200 bg-white py-8 mt-16" role="contentinfo">
        <div className="max-w-page mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600 font-mono">
              <span className="font-bold text-gray-950 font-sans">ChainNotary Protocol</span>
              <span className="text-gray-300">/</span>
              <span>SHA-256 Hex</span>
              <span className="text-gray-300">/</span>
              <span>Ed25519 Base64</span>
              <span className="text-gray-300">/</span>
              <span>Solana Devnet Memo</span>
              <span className="text-gray-300">/</span>
              <span>ISO 8601 UTC</span>
            </div>

            <div className="text-gray-500 font-mono text-[11px] flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              <span>Stack: FastAPI • React • PyNaCl • Solana Devnet</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

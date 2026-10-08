import React, { useState } from 'react';
import Navbar from './components/Navbar';
import PipelineSimulator from './components/PipelineSimulator';
import NotarizeStudio from './components/NotarizeStudio';
import VerificationTerminal from './components/VerificationTerminal';
import LedgerExplorer from './components/LedgerExplorer';

export default function App() {
  // Doğrulama bağlantıları (QR/sertifika): /?tab=verify&pda=<proof_pda>
  const params = new URLSearchParams(window.location.search);
  const initialPda = params.get('pda') || '';
  const [activeTab, setActiveTab] = useState(
    ['pipeline', 'notarize', 'verify', 'ledger'].includes(params.get('tab')) ? params.get('tab') : initialPda ? 'verify' : 'pipeline'
  );

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900 flex flex-col antialiased font-sans selection:bg-black selection:text-white">
      {/* Cal.com style Top Navbar */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 w-full max-w-page mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'pipeline' && <PipelineSimulator />}
        {activeTab === 'notarize' && <NotarizeStudio />}
        {activeTab === 'verify' && <VerificationTerminal initialPda={initialPda} />}
        {activeTab === 'ledger' && <LedgerExplorer />}
      </main>

      {/* Cal.com style Clean Institutional Footer */}
      <footer className="border-t border-gray-200 bg-white py-8 mt-16" role="contentinfo">
        <div className="max-w-page mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600 font-mono">
              <span className="font-bold text-gray-950 font-sans">Notary Protocol</span>
              <span className="text-gray-300">/</span>
              <span>SHA-256 Hex</span>
              <span className="text-gray-300">/</span>
              <span>Ed25519 Tx Signature</span>
              <span className="text-gray-300">/</span>
              <span>Solana PDA Proof</span>
              <span className="text-gray-300">/</span>
              <span>Chain Time (UTC)</span>
            </div>

            <div className="text-gray-500 font-mono text-[11px] flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              <span>Stack: Anchor • Solana • React • Python agents</span>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-gray-500 max-w-3xl">
            Notary records timestamped integrity proofs on Solana. A proof shows that a wallet recorded this exact file at a given time and that it has not
            changed since. It is not a qualified electronic signature under eIDAS and does not by itself prove who controls a wallet.
          </p>
        </div>
      </footer>
    </div>
  );
}

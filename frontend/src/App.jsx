import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Check from './components/Check';
import NotarizeStudio from './components/NotarizeStudio';
import LedgerExplorer from './components/LedgerExplorer';

// Eski bağlantılar (daha önce verilmiş QR ve sertifikalar) çalışmaya devam eder: ?tab=verify&pda=...
const LEGACY = { verify: 'check', pipeline: 'check', notarize: 'record', ledger: 'records' };
const TABS = ['check', 'record', 'records'];

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const initialPda = params.get('pda') || '';
  const requested = LEGACY[params.get('tab')] || params.get('tab');
  const [activeTab, setActiveTab] = useState(TABS.includes(requested) ? requested : 'check');

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col antialiased font-sans">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main id="main-content" className="flex-1 w-full max-w-page mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {activeTab === 'check' && <Check initialPda={initialPda} />}
        {activeTab === 'record' && <NotarizeStudio />}
        {activeTab === 'records' && <LedgerExplorer />}
      </main>

      <footer className="border-t border-rule py-8 mt-16" role="contentinfo">
        <div className="max-w-page mx-auto px-4 sm:px-6 lg:px-8 text-sm text-gray-600 leading-relaxed max-w-3xl">
          <p>
            Notary records timestamped integrity proofs on Solana. A record shows that a wallet stored this exact file at a given time and that it has not
            changed since. It is not a qualified electronic signature under eIDAS and does not by itself prove who controls a wallet.
          </p>
        </div>
      </footer>
    </div>
  );
}

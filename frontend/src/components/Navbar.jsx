import React, { useEffect, useState } from 'react';
import { checkHealth } from '../api';
import { API_URL } from '../lib/config';
import { useNotary } from '../lib/notary';
import Tabs from './Tabs';
import WalletButton from './WalletButton';

const NAV = [
  { value: 'check', label: 'Check' },
  { value: 'record', label: 'Record' },
  { value: 'agreements', label: 'Agreements' },
  { value: 'records', label: 'Records' },
];

export default function Navbar({ activeTab, setActiveTab }) {
  const { isDemo, cluster } = useNotary();
  const [relayerOnline, setRelayerOnline] = useState(false);

  // API opsiyoneldir (yalnızca relayer); doğrulama ona bağlı değildir.
  useEffect(() => {
    let off = false;
    if (!API_URL) return undefined;
    const tick = async () => { const r = await checkHealth().catch(() => ({ online: false })); if (!off) setRelayerOnline(r.online); };
    tick();
    const id = setInterval(tick, 8000);
    return () => { off = true; clearInterval(id); };
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-paper/90 backdrop-blur border-b border-rule">
      <div className="max-w-page mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          <div className="flex items-center gap-8 min-w-0">
            <button type="button" onClick={() => setActiveTab('check')} className="flex items-center gap-2.5 shrink-0" aria-label="Notary, go to Check">
              <img src="/logo.png" width="36" height="36" alt="" className="shrink-0" />
              <span className="font-display text-xl font-bold tracking-tight text-ink">Notary</span>
            </button>
            <nav aria-label="Main" className="hidden md:block">
              <Tabs options={NAV} value={activeTab} onChange={setActiveTab} label="Main sections" />
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isDemo ? (
              <span className="hidden sm:inline-flex items-center rounded-full border border-dashed border-gray-400 px-2.5 py-1 text-xs text-gray-700" title="Nothing is recorded on Solana in demo mode">
                Demo: not recorded on Solana
              </span>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-1 text-xs text-gray-700">
                <span className="w-1.5 h-1.5 rounded-full bg-verified" />Solana {cluster === 'devnet' ? 'devnet' : cluster}
              </span>
            )}
            {API_URL && (
              <span className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-1 text-xs text-gray-700" title="The relayer pays network fees. Checking a file does not need it.">
                <span className={`w-1.5 h-1.5 rounded-full ${relayerOnline ? 'bg-verified' : 'bg-gray-300'}`} />
                {relayerOnline ? 'Relayer online' : 'Relayer offline'}
              </span>
            )}
            <WalletButton />
          </div>
        </div>

        <nav aria-label="Main" className="md:hidden border-t border-rule -mx-4 px-4">
          <Tabs options={NAV} value={activeTab} onChange={setActiveTab} label="Main sections" />
        </nav>

        {isDemo && (
          <div className="sm:hidden -mx-4 px-4 py-1.5 border-t border-dashed border-gray-400 text-xs text-gray-700" role="status">
            Demo: nothing is recorded on Solana.
          </div>
        )}
      </div>
    </header>
  );
}

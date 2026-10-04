import React, { useEffect, useState } from 'react';
import { Shield, Activity, Database, CheckCircle2, Server, FlaskConical } from 'lucide-react';
import { checkHealth } from '../api';
import { API_URL } from '../lib/config';
import { useNotary } from '../lib/notary';
import PulsarGlassSegmented from './PulsarGlassSegmented';
import WalletButton from './WalletButton';

export default function Navbar({ activeTab, setActiveTab }) {
  const { isDemo, cluster } = useNotary();
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // API opsiyoneldir (yalnızca /relay ve indeksleyici); doğrulama ona bağlı değildir.
    const runCheck = async () => {
      if (!API_URL) return;
      try {
        const res = await checkHealth();
        if (!cancelled) setBackendOnline(res.online);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    };
    runCheck();
    const interval = setInterval(runCheck, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab]);

  const navOptions = [
    { value: 'pipeline', label: 'Protocol Pipeline', icon: <Activity className="w-3.5 h-3.5" /> },
    { value: 'notarize', label: 'Notarize Studio', icon: <Shield className="w-3.5 h-3.5" /> },
    { value: 'verify', label: 'Verification Terminal', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    { value: 'ledger', label: 'Ledger & Registry', icon: <Database className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-page mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo / Brand — Cal.com style bold logo */}
          <div 
            className="flex items-center space-x-2.5 cursor-pointer select-none"
            onClick={() => setActiveTab('pipeline')}
          >
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-white shadow-sm">
              <Shield className="w-4 h-4 fill-white" />
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-lg tracking-tight text-gray-950 font-sans">
                Notary
              </span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                v2.0
              </span>
            </div>
          </div>

          {/* Pulsar Glass — Liquid Segmented Slider Navigation (Compact sm size) */}
          <nav className="hidden md:flex items-center">
            <PulsarGlassSegmented
              options={navOptions}
              value={activeTab}
              onChange={setActiveTab}
              size="sm"
              theme="light"
            />
          </nav>

          {/* Right Status Badges & Quick Action */}
          <div className="flex items-center space-x-2.5">
            {/* Solana cluster / DEMO Pill */}
            {isDemo ? (
              <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-mono text-amber-700" title="Nothing is written on-chain in DEMO mode">
                <FlaskConical className="w-3 h-3" />
                <span className="font-medium">DEMO · not on-chain</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs font-mono text-gray-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-medium">Solana {cluster === 'devnet' ? 'Devnet' : cluster}</span>
              </div>
            )}

            {/* Optional helper API pill (verification does not depend on it) */}
            {API_URL && (
              <div className={`hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
                backendOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
              }`} title="Optional helper API (relay / index). On-chain verification works without it.">
                <Server className="w-3 h-3" />
                <span>{backendOnline ? 'API online' : 'API offline (optional)'}</span>
              </div>
            )}

            <WalletButton />
          </div>

        </div>

        {/* Mobile Navigation bar */}
        <div className="flex md:hidden overflow-x-auto py-2 space-x-2 border-t border-gray-100 no-scrollbar">
          {navOptions.map((opt) => {
            const isActive = activeTab === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setActiveTab(opt.value)}
                className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium cursor-pointer ${
                  isActive
                    ? 'bg-black text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
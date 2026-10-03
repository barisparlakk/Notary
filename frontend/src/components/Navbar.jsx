import React, { useEffect, useState } from 'react';
import { Shield, Activity, Database, CheckCircle2, Server, ArrowRight, Wifi } from 'lucide-react';
import { checkHealth, getStoredProofs } from '../api';
import PulsarGlassSegmented from './PulsarGlassSegmented';

export default function Navbar({ activeTab, setActiveTab }) {
  const [backendOnline, setBackendOnline] = useState(true);
  const [proofCount, setProofCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const runCheck = async () => {
      try {
        const res = await checkHealth();
        if (!cancelled) {
          setBackendOnline(res.online);
          setProofCount(getStoredProofs().length);
        }
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
                ChainNotary
              </span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                v1.0
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
            {/* Solana Devnet Pill */}
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs font-mono text-gray-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-medium">Solana Devnet</span>
            </div>

            {/* API Health Pill */}
            <div className={`hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
              backendOnline
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              <Server className="w-3 h-3" />
              <span>{backendOnline ? 'API Connected' : 'API Sandbox'}</span>
            </div>

            {/* Cal.com style Get Started / Action button */}
            <button
              onClick={() => setActiveTab('pipeline')}
              className="cal-btn-primary flex items-center space-x-1.5 text-xs py-1.5 px-3 rounded-full"
            >
              <span>Run Pipeline</span>
              <ArrowRight className="w-3 h-3" />
            </button>
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
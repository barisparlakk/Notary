import React, { useEffect, useState } from 'react';
import { ShieldCheck, Activity, Database, CheckCircle2, Server, Globe2 } from 'lucide-react';
import { checkHealth, getStoredProofs } from '../api';

export default function Navbar({ activeTab, setActiveTab }) {
  const [backendOnline, setBackendOnline] = useState(false);
  const [proofCount, setProofCount] = useState(0);

  useEffect(() => {
    const runCheck = async () => {
      const res = await checkHealth();
      setBackendOnline(res.online);
      setProofCount(getStoredProofs().length);
    };

    runCheck();
    const interval = setInterval(runCheck, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-cyber-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('pipeline')}>
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-600/20 border border-cyan-500/40 shadow-glow-cyan">
              <ShieldCheck className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  ChainNotary
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/50">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono tracking-wider">
                AI Agent Provenance Layer
              </p>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            {[
              { id: 'pipeline', label: 'Interactive Pipeline', icon: Activity, badge: 'Live Demo' },
              { id: 'notarize', label: 'Notarize Studio', icon: ShieldCheck },
              { id: 'verify', label: 'Verification Terminal', icon: CheckCircle2 },
              { id: 'ledger', label: 'Ledger & Agents', icon: Database },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyber-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-900/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-cyber-900/90 border border-purple-500/30 text-xs font-mono text-purple-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </span>
              <Globe2 className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Solana Devnet</span>
            </div>

            <div className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
              backendOnline
                ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
            }`}>
              <Server className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {backendOnline ? 'FastAPI: Online' : 'FastAPI: Sandbox'}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${backendOnline ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            </div>

            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-cyber-900/70 border border-white/10 text-xs font-mono text-slate-300">
              <span className="text-slate-500">Proofs:</span>
              <span className="text-cyan-400 font-bold">{proofCount}</span>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}
import React, { useEffect, useRef, useState } from 'react';
import { Wallet, LogOut, ExternalLink } from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';

// Mevcut tasarım diliyle (cal-btn-*, cal-card) cüzdan bağlama düğmesi. Hazır wallet-adapter arayüzü kullanılmaz.
export default function WalletButton() {
  const { wallet, signer, isDemo } = useNotary();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    // Escape menüyü kapatır ve odağı düğmeye geri verir
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, []);

  // select() sonrası seçili adaptör hazır olunca bağlan
  useEffect(() => {
    if (!pending || !wallet.wallet) return;
    setPending(false);
    wallet.connect().then(() => setOpen(false)).catch((e) => setError(e?.message || 'Bağlanılamadı'));
  }, [pending, wallet.wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (name) => { setError(''); wallet.select(name); setPending(true); };

  const connected = signer?.kind === 'wallet';
  const label = connected ? `${signer.label} · ${shortKey(signer.publicKey)}` : isDemo && signer ? `Demo · ${shortKey(signer.publicKey)}` : 'Connect wallet';

  return (
    <div className="relative" ref={ref}>
      <button ref={trigger} onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} className="cal-btn-primary flex items-center space-x-1.5 text-xs py-1.5 px-3 rounded-full">
        <Wallet className="w-3 h-3" />
        <span className="font-mono">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 cal-card p-3 space-y-2 z-50" role="group" aria-label="Wallet">
          {connected ? (
            <>
              <div className="text-xs font-mono text-gray-500 break-all">{String(signer.publicKey)}</div>
              <button onClick={() => { wallet.disconnect(); setOpen(false); }} className="cal-btn-secondary w-full py-1.5 text-xs rounded-lg flex items-center justify-center space-x-1.5">
                <LogOut className="w-3 h-3" /><span>Disconnect</span>
              </button>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-gray-700">Select a Solana wallet</div>
              {wallet.wallets.map((w) => {
                const installed = w.readyState === 'Installed' || w.readyState === 'Loadable';
                return installed ? (
                  <button key={w.adapter.name} onClick={() => pick(w.adapter.name)} className="cal-btn-secondary w-full py-1.5 px-2.5 text-xs rounded-lg flex items-center justify-between">
                    <span>{w.adapter.name}</span><span className="text-xs text-emerald-600">Detected</span>
                  </button>
                ) : (
                  <a key={w.adapter.name} href={w.adapter.url} target="_blank" rel="noopener noreferrer" className="cal-btn-secondary w-full py-1.5 px-2.5 text-xs rounded-lg flex items-center justify-between">
                    <span>{w.adapter.name}</span><span className="text-xs text-gray-500 flex items-center space-x-1"><span>Install</span><ExternalLink className="w-2.5 h-2.5" /></span>
                  </a>
                );
              })}
              {isDemo && <div className="text-xs font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">DEMO mode: a throwaway browser key signs. Nothing is written on-chain.</div>}
              {error && <div className="text-xs text-red-700">{error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

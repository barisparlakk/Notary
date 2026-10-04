// Uygulama genelinde zincir istemcisi + imzalayan (cüzdan ya da DEMO anahtarı).
import React, { createContext, useContext, useMemo } from 'react';
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { Keypair } from '@solana/web3.js';
import { EFFECTIVE_PROGRAM_ID, RPC_URL, CLUSTER, USE_MOCK } from './config';
import { MockChain, RpcChain } from './chain';

const NotaryContext = createContext(null);
const DEMO_KEY = 'notary_demo_signer_v2';

function loadDemoSigner() {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
    if (stored) return Keypair.fromSecretKey(Uint8Array.from(stored));
  } catch { /* yeni üret */ }
  const kp = Keypair.generate();
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(Array.from(kp.secretKey))); } catch { /* yoksay */ }
  return kp;
}

function NotaryState({ children }) {
  const wallet = useWallet();
  const { connection } = useConnection();

  const chain = useMemo(
    () => (USE_MOCK ? new MockChain(EFFECTIVE_PROGRAM_ID) : new RpcChain(connection, EFFECTIVE_PROGRAM_ID, { cluster: CLUSTER })),
    [connection]
  );
  const demoKeypair = useMemo(() => (USE_MOCK ? loadDemoSigner() : null), []);

  const signer = useMemo(() => {
    if (wallet.connected && wallet.publicKey && wallet.signTransaction) {
      return { kind: 'wallet', label: wallet.wallet?.adapter?.name || 'Wallet', publicKey: wallet.publicKey, signTransaction: wallet.signTransaction };
    }
    if (demoKeypair) return { kind: 'demo', label: 'Demo wallet', publicKey: demoKeypair.publicKey, keypair: demoKeypair };
    return null;
  }, [wallet.connected, wallet.publicKey, wallet.signTransaction, wallet.wallet, demoKeypair]);

  const value = useMemo(
    () => ({ chain, signer, isDemo: USE_MOCK, programId: EFFECTIVE_PROGRAM_ID, cluster: CLUSTER, connection, wallet }),
    [chain, signer, connection, wallet]
  );
  return <NotaryContext.Provider value={value}>{children}</NotaryContext.Provider>;
}

export function NotaryProvider({ children }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <NotaryState>{children}</NotaryState>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export const useNotary = () => {
  const ctx = useContext(NotaryContext);
  if (!ctx) throw new Error('useNotary yalnızca <NotaryProvider> içinde kullanılabilir');
  return ctx;
};

export const shortKey = (key, n = 4) => {
  const s = String(key || '');
  return s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
};

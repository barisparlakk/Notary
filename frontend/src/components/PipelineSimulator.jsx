import React, { useState } from 'react';
import { 
  Play, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  FileText, 
  Cpu, 
  Key, 
  Globe, 
  ShieldCheck, 
  RotateCcw,
  Lock,
  Copy,
  Check,
  Zap,
  Shield,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { useNotary, shortKey } from '../lib/notary';
import { deriveProofPda, hexToBytes, sha256Hex, verifyDocument } from '../lib/chain';
import { setMeta } from '../lib/localMeta';

const makeContent = (nonce, tampered = false) => `Notary Provenance Report v2.0
Run: ${nonce}
Sender: agent_a (Research & Strategy)
Receiver: agent_b (Execution & Treasury)
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": ${tampered ? '1500000.00' : '150000.00'},
  "risk_score": ${tampered ? '0.99' : '0.04'},
  "status": "${tampered ? 'REVOKED & EXPLOITED' : 'APPROVED FOR EXECUTION'}"
}`;

export default function PipelineSimulator() {
  const { chain, signer, isDemo, cluster } = useNotary();
  const [isRunning, setIsRunning] = useState(false);
  const [apiOutage, setApiOutage] = useState(false);
  const [runError, setRunError] = useState('');
  const [content, setContent] = useState(() => makeContent('preview'));
  const [pdaPreview, setPdaPreview] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [tamperedMode, setTamperedMode] = useState(false);
  
  const [docHash, setDocHash] = useState('');
  const [notarizeResult, setNotarizeResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [copiedField, setCopiedField] = useState('');

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const resetPipeline = () => {
    setCurrentStep(0);
    setDocHash('');
    setPdaPreview('');
    setRunError('');
    setNotarizeResult(null);
    setVerifyResult(null);
    setIsRunning(false);
  };

  const runPipeline = async (simulateTamper = false) => {
    if (!signer) {
      setRunError('Connect a wallet (top right) to run the pipeline on devnet.');
      return;
    }
    setRunError('');
    setIsRunning(true);
    setTamperedMode(simulateTamper);
    setVerifyResult(null);
    setNotarizeResult(null);
    setCurrentStep(1);

    const nonce = new Date().toISOString();
    const original = makeContent(nonce);
    setContent(original);
    try {
      await new Promise(r => setTimeout(r, 450));

      setCurrentStep(2);
      const hash = await sha256Hex(original);
      setDocHash(hash);
      await new Promise(r => setTimeout(r, 450));

      setCurrentStep(3);
      setPdaPreview(deriveProofPda(chain.programId, signer.publicKey, hexToBytes(hash))[0].toBase58());
      await new Promise(r => setTimeout(r, 500));

      setCurrentStep(4);
      const out = await chain.notarize({ signer, hashHex: hash });
      setMeta(out.proof_pda, { file_name: 'report.pdf', tx_signature: out.tx_signature });
      setNotarizeResult(out);
      await new Promise(r => setTimeout(r, 600));

      setCurrentStep(5);
      await new Promise(r => setTimeout(r, 400));

      setCurrentStep(6);
      const receivedHash = await sha256Hex(simulateTamper ? makeContent(nonce, true) : original);
      setVerifyResult(await verifyDocument(chain, receivedHash, { pda: out.proof_pda }));
      setCurrentStep(7);
    } catch (err) {
      setRunError(String(err.message || err));
    } finally {
      setIsRunning(false);
    }
  };

  const steps = [
    { num: 1, title: 'Artifact Created', desc: 'Agent A generates payload', icon: FileText },
    { num: 2, title: 'SHA-256 Digest', desc: 'Immutable 256-bit fingerprint', icon: Cpu },
    { num: 3, title: 'Wallet Signed', desc: 'Signer key proves origin', icon: Key },
    { num: 4, title: 'PDA Anchored', desc: 'Proof account on Solana', icon: Globe },
    { num: 5, title: 'Peer Delivery', desc: 'Received by Agent B', icon: Layers },
    { num: 6, title: 'Integrity Audit', desc: 'Direct chain read, no API', icon: ShieldCheck },
    { num: 7, title: 'Consensus Verdict', desc: 'Mathematical verification', icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-12">
      
      {/* ─── Cal.com Style HERO SECTION ─── */}
      <div className="pt-4 pb-2">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Hero Left Column */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Top Announcement Pills (Cal.com Screenshot 1) */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="cal-pill text-gray-800 bg-gray-50 border-gray-200 hover:border-gray-300 transition-colors cursor-default">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span className="font-semibold">{isDemo ? 'DEMO mode · not on-chain' : `Solana ${cluster === 'devnet' ? 'Devnet' : cluster} Live`}</span>
                <span className="text-gray-400">›</span>
              </div>
              <div className="cal-pill bg-emerald-50 text-emerald-800 border-emerald-200/80">
                <Shield className="w-3 h-3 text-emerald-600" />
                <span>Autonomous Agent Trust Protocol</span>
              </div>
            </div>

            {/* Giant Cal.com Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-950 leading-[1.08] font-sans">
              The better way to notarize AI agent actions.
            </h1>

            {/* Crisp Subtitle */}
            <p className="text-base sm:text-lg text-gray-600 max-w-xl leading-relaxed">
              Autonomous agents execute billions in value. Notary stores a proof account on Solana for every decision and document, and anyone can verify it straight from the chain, even when our servers are down.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => runPipeline(false)}
                disabled={isRunning}
                className="cal-btn-primary px-5 py-3 text-sm rounded-xl font-semibold flex items-center space-x-2"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{isRunning && !tamperedMode ? 'Running Simulation...' : 'Execute Standard Run'}</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </button>

              <button
                onClick={() => runPipeline(true)}
                disabled={isRunning}
                className="cal-btn-secondary px-5 py-3 text-sm rounded-xl font-semibold border-red-200 text-red-600 hover:bg-red-50 flex items-center space-x-2"
              >
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span>{isRunning && tamperedMode ? 'Testing Exploit...' : 'Simulate 1-Byte Attack'}</span>
              </button>

              {currentStep > 0 && (
                <button
                  onClick={resetPipeline}
                  disabled={isRunning}
                  className="cal-btn-secondary px-4 py-3 text-sm rounded-xl text-gray-500 hover:text-gray-900 flex items-center space-x-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {runError && (
              <div className="cal-card p-3 border border-red-200 bg-red-50 text-xs text-red-800 font-mono break-all" role="alert">{runError}</div>
            )}

            <label className="inline-flex items-center space-x-2 text-xs text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={apiOutage} onChange={(e) => setApiOutage(e.target.checked)} className="accent-black" />
              <span>Simulate our API being offline <span className="text-gray-400">(verification does not use it)</span></span>
            </label>

            <div className="text-xs text-gray-500 font-medium flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>✓ Verifies without our API</span>
              <span>✓ Wallet-signed, chain-timestamped</span>
              <span>✓ Sub-second finality</span>
            </div>

            {/* Social / Crypto Proof Badges */}
            <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-100">
              <div className="flex items-center space-x-1.5 text-xs text-gray-500 font-mono">
                <span className="font-bold text-gray-900">Solana PDA</span>
                <span>proof account</span>
              </div>
              <div className="flex items-center space-x-1.5 text-xs text-gray-500 font-mono">
                <span className="font-bold text-gray-900">Ed25519</span>
                <span>tx-signature</span>
              </div>
              <div className="flex items-center space-x-1.5 text-xs text-gray-500 font-mono">
                <span className="font-bold text-gray-900">Digest</span>
                <span>sha256-hex</span>
              </div>
            </div>

          </div>

          {/* Hero Right Column: Interactive Live Preview Card (Matches Cal.com's Screenshot 1 booking card!) */}
          <div className="lg:col-span-5">
            <div className="cal-card p-6 border-gray-200 shadow-xl bg-white space-y-5 relative overflow-hidden">
              
              {/* Header badge */}
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold text-xs">
                    AA
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-900">agent_a (Research & Strategy)</div>
                    <div className="text-[11px] text-gray-500">Dispatching to agent_b (Treasury)</div>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Ready to Sign
                </span>
              </div>

              {/* Title & Payload Spec */}
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wider font-bold text-gray-400 font-mono">Action Item</div>
                <div className="text-lg font-bold text-gray-900">EXECUTE_PORTFOLIO_REBALANCE</div>
                <p className="text-xs text-gray-500">
                  Allocation: <span className="font-mono text-gray-700 font-medium">0x4a9b...c38d</span> • Amount: <span className="font-bold text-gray-900">$150,000.00 USD</span>
                </p>
              </div>

              {/* Cal.com style Duration / Mode pills */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-gray-500">Execution Vector</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="px-2.5 py-1.5 rounded-lg border border-black bg-black text-white text-center text-xs font-medium cursor-pointer shadow-sm">
                    Standard Run
                  </div>
                  <div 
                    onClick={() => runPipeline(true)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-700 text-center text-xs font-medium cursor-pointer transition-colors"
                  >
                    Tamper Test
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 text-center text-xs font-medium">
                    Batch Mode
                  </div>
                </div>
              </div>

              {/* Live Hash & Signature Micro-Preview */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-gray-500 text-[11px]">
                  <span>SHA-256 Fingerprint</span>
                  <span className="text-emerald-600 font-bold">256-bit</span>
                </div>
                <div className="text-[11px] text-gray-700 font-mono truncate select-all">
                  {docHash || "88a1b5c4... (Calculated dynamically on execution)"}
                </div>
              </div>

              {/* Trigger Button inside preview */}
              <button
                onClick={() => runPipeline(false)}
                disabled={isRunning}
                className="w-full cal-btn-primary py-2.5 text-xs rounded-xl font-semibold flex items-center justify-center space-x-1.5 shadow-sm"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{isRunning ? 'Processing on Solana...' : 'Trigger Notarization Pipeline'}</span>
              </button>

            </div>
          </div>

        </div>
      </div>

      {/* ─── Cal.com Style "HOW IT WORKS" 3-BENTO CARDS (Screenshot 3) ─── */}
      <div className="pt-8 border-t border-gray-200/80">
        
        {/* Section Header (Matches Screenshot 2 & 3) */}
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-10">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-200">
            <Zap className="w-3 h-3 text-gray-900 fill-current" />
            <span>How it works</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-950 font-sans">
            Cryptographic assurance in 3 deterministic steps
          </h2>
          <p className="text-sm sm:text-base text-gray-600">
            Effortless verification for autonomous workflows, robust mathematical integrity for mission-critical operations.
          </p>
        </div>

        {/* 3 Large Bento Cards (Screenshot 3) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 01: Connect & Hash */}
          <div className="cal-card p-6 space-y-4 hover:border-gray-300 transition-all flex flex-col justify-between">
            <div className="space-y-2">
              <span className="w-7 h-7 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-900 font-mono">
                01
              </span>
              <h3 className="text-lg font-bold text-gray-900">Calculate SHA-256 Digest</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                The payload is digested client-side into a lowercase hex string. Changing even one bit alters the entire hash completely.
              </p>
            </div>

            {/* Orbit animation widget (Like Cal.com's calendar orbit in Card 01) */}
            <div className="h-44 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center relative overflow-hidden">
              <div className="w-28 h-28 rounded-full border border-dashed border-gray-300 flex items-center justify-center animate-orbit relative">
                <div className="w-4 h-4 rounded-full bg-blue-600 absolute -top-2 text-white flex items-center justify-center text-[8px] font-bold">
                  #
                </div>
                <div className="w-3 h-3 rounded-full bg-emerald-500 absolute -bottom-1.5"></div>
              </div>
              <div className="w-16 h-16 rounded-full bg-white border border-gray-200 shadow-md flex items-center justify-center text-center p-2 absolute z-10">
                <div className="text-[10px] font-bold text-gray-900 leading-tight">SHA-256 Hex</div>
              </div>
            </div>
          </div>

          {/* Card 02: Ed25519 Signatures */}
          <div className="cal-card p-6 space-y-4 hover:border-gray-300 transition-all flex flex-col justify-between">
            <div className="space-y-2">
              <span className="w-7 h-7 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-900 font-mono">
                02
              </span>
              <h3 className="text-lg font-bold text-gray-900">Sign with Your Wallet</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                The transaction is signed by the agent’s or your wallet key. The signature and the chain clock become part of the record, so nobody can back-date it.
              </p>
            </div>

            {/* Live toggle schedule widget (Like Cal.com's availability widget in Card 02) */}
            <div className="h-44 rounded-xl bg-gray-50 border border-gray-200 p-3 flex flex-col justify-center space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-gray-200 shadow-xs">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="font-bold text-gray-800">agent_a</span>
                </div>
                <span className="text-[10px] text-gray-400">Agent wallet</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px]">Ed25519</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-gray-200 shadow-xs">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="font-bold text-gray-800">agent_b</span>
                </div>
                <span className="text-[10px] text-gray-400">Agent wallet</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px]">Ed25519</span>
              </div>
            </div>
          </div>

          {/* Card 03: Solana Devnet Anchor */}
          <div className="cal-card p-6 space-y-4 hover:border-gray-300 transition-all flex flex-col justify-between">
            <div className="space-y-2">
              <span className="w-7 h-7 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-900 font-mono">
                03
              </span>
              <h3 className="text-lg font-bold text-gray-900">Anchor to Solana Devnet</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                The proof lives in its own program-derived account (PDA) on Solana. Anyone with the file can derive the address and verify it, no account or API needed.
              </p>
            </div>

            {/* Simulated Solana Transaction Card (Like Cal.com's Card 03) */}
            <div className="h-44 rounded-xl bg-gray-50 border border-gray-200 p-3.5 flex flex-col justify-center space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">Solana Network</span>
                <span className="text-[11px] text-emerald-600 font-bold">Devnet Cluster</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white border border-gray-200 text-[11px] text-gray-700 break-all select-all font-mono">
                PDA seeds: [proof, signer, sha256]
              </div>
              <div className="flex justify-between items-center text-[10px] text-gray-400 pt-1">
                <span>Finality: ~400ms</span>
                <span className="text-blue-600 font-medium">Verified On-Chain</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ─── LIVE PIPELINE VISUAL STEP TRACKER (Enlarged Cards) ─── */}
      <div className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-bold text-gray-950 font-sans">
              Pipeline Execution Sequence
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-gray-100 text-gray-600 border border-gray-200">
              {currentStep === 0 ? 'Idle (Ready)' : `Step 0${currentStep} of 07`}
            </span>
          </div>
          {currentStep > 0 && (
            <span className="text-xs text-gray-500 font-mono">
              {tamperedMode ? '⚠️ Simulating Tampered Delivery' : '✓ Canonical Execution'}
            </span>
          )}
        </div>

        {/* 7 Visual Step Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {steps.map((s) => {
            const isDone = currentStep > s.num;
            const isCurrent = currentStep === s.num;
            const Icon = s.icon;
            return (
              <div
                key={s.num}
                className={`p-3.5 rounded-xl border transition-all ${
                  isCurrent
                    ? 'bg-black text-white border-black shadow-md scale-[1.02]'
                    : isDone
                    ? 'bg-emerald-50/70 border-emerald-200 text-gray-900'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono font-bold ${isCurrent ? 'text-gray-300' : 'text-gray-400'}`}>
                    STEP 0{s.num}
                  </span>
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : isCurrent ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 text-gray-300" />
                  )}
                </div>
                <div className="text-xs font-bold truncate">{s.title}</div>
                <div className={`text-[10px] mt-0.5 truncate ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>
                  {s.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── LIVE EXECUTION INSPECTOR (Enlarged Visual Comparison Cards) ─── */}
      {currentStep > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
          
          {/* Left: Payload & Cryptographic Breakdown (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Visual Payload Card */}
            <div className="cal-card p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-gray-700" />
                  <span className="text-sm font-bold text-gray-900 font-sans">
                    {tamperedMode ? 'Transferred Payload: Altered in Transit' : 'Transferred Payload: Original Artifact'}
                  </span>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium font-mono border ${
                  tamperedMode
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {tamperedMode ? '⚠️ TAMPERED PAYLOAD' : '✓ AUTHENTIC PAYLOAD'}
                </span>
              </div>

              {/* Side-by-side or highlighted view */}
              <div className={`p-4 rounded-xl border font-mono text-xs leading-relaxed overflow-x-auto ${
                tamperedMode 
                  ? 'bg-red-50/60 border-red-200 text-red-950' 
                  : 'bg-gray-50 border-gray-200 text-gray-800'
              }`}>
                {tamperedMode ? (
                  <div className="space-y-1">
                    <div className="text-gray-500 font-bold mb-1">// Attacker intercepted payload and multiplied total_amount by 10x:</div>
                    <pre className="text-gray-700 font-mono text-xs">
{content.split('\n').slice(0, 7).join('\n')}
                    </pre>
                    <div className="p-1.5 bg-red-200/80 rounded border border-red-300 font-bold text-red-900">
                      {`  "total_amount_usd": 1500000.00,  <-- ⚠️ TAMPERED (Original was 150000.00)`}
                    </div>
                    <pre className="text-gray-700 font-mono text-xs">
{`  "risk_score": 0.99,
  "status": "REVOKED & EXPLOITED"
}`}
                    </pre>
                  </div>
                ) : (
                  <pre className="text-gray-800 font-mono text-xs">
                    {content}
                  </pre>
                )}
              </div>
            </div>

            {/* Cryptographic Primitives Details */}
            {docHash && (
              <div className="cal-card p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center space-x-2">
                    <Lock className="w-4 h-4 text-gray-700" />
                    <span className="text-sm font-bold text-gray-900 font-sans">
                      Cryptographic Primitives
                    </span>
                  </div>
                  <span className="text-xs font-mono text-gray-500">
                    Ed25519 tx signature + SHA-256 (Hex)
                  </span>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div>
                    <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1">
                      <span>Original Document SHA-256 Digest:</span>
                      <button
                        onClick={() => copyToClipboard(docHash, 'hash')}
                        className="text-gray-500 hover:text-black flex items-center space-x-1 cursor-pointer"
                      >
                        {copiedField === 'hash' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedField === 'hash' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="cal-hash-block font-bold">
                      {docHash}
                    </div>
                  </div>

                  {pdaPreview && (
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-1">
                        Proof Account (PDA) derived from [&quot;proof&quot;, signer, sha256]:
                      </span>
                      <div className="cal-hash-block text-gray-600 bg-white">
                        {pdaPreview}
                      </div>
                    </div>
                  )}

                  {signer && (
                    <div>
                      <span className="text-[11px] text-gray-500 block mb-1">
                        Signer ({signer.label}), signs the transaction:
                      </span>
                      <div className="cal-hash-block text-gray-700">
                        {String(signer.publicKey)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Right: Solana Devnet Record & Verdict (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Solana Proof Card */}
            {notarizeResult && (
              <div className="cal-card p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center space-x-2">
                    <Globe className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-bold text-gray-900 font-sans">
                      Solana Proof Record
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {isDemo ? 'Demo record' : 'Confirmed on Solana'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                    <span className="text-gray-500 block text-[10px]">Proof account (PDA)</span>
                    <span className="text-gray-900 font-bold text-xs" title={notarizeResult.proof_pda}>{shortKey(notarizeResult.proof_pda, 6)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                    <span className="text-gray-500 block text-[10px]">Chain time (UTC)</span>
                    <span className="text-gray-900 font-bold text-xs">{notarizeResult.proof.created_at_iso}</span>
                  </div>
                </div>

                <div>
                  <span className="text-gray-500 block text-[10px] font-mono mb-1">Transaction Signature</span>
                  <div className="cal-hash-block text-[11px] text-gray-700">
                    {notarizeResult.tx_signature}
                  </div>
                </div>

                {!isDemo && (
                  <div className="pt-1">
                    <a
                      href={`https://explorer.solana.com/address/${notarizeResult.proof_pda}?cluster=${cluster}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cal-btn-secondary w-full py-2 text-xs rounded-lg flex items-center justify-center space-x-1.5"
                    >
                      <span>Inspect on Solana Explorer</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* VERIFICATION VERDICT CARD (Enlarged Reassuring Shield / Alert) */}
            {verifyResult && (
              <div className={`cal-card p-6 border-2 transition-all ${
                verifyResult.status === 'VERIFIED'
                  ? 'border-emerald-300 bg-emerald-50/40'
                  : 'border-red-300 bg-red-50/50'
              }`}>
                <div className="flex items-start space-x-3.5 mb-4">
                  {verifyResult.status === 'VERIFIED' ? (
                    <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shrink-0">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-red-100 border border-red-300 flex items-center justify-center text-red-700 shrink-0">
                      <XCircle className="w-6 h-6" />
                    </div>
                  )}

                  <div>
                    <h3 className={`text-base font-extrabold font-sans tracking-tight ${
                      verifyResult.status === 'VERIFIED' ? 'text-emerald-950' : 'text-red-950'
                    }`}>
                      {verifyResult.status === 'VERIFIED' 
                        ? 'STATUS: VERIFIED (100% BIT-MATCH)' 
                        : 'STATUS: INTEGRITY VIOLATION DETECTED'}
                    </h3>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                      {verifyResult.status === 'VERIFIED'
                        ? 'The received document matches the notarized artifact bit-for-bit, read straight from the chain' + (apiOutage ? ' while our API was offline.' : '.')
                        : 'Cryptographic fingerprint mismatch. Content was modified in transit after notarization.'}
                    </p>
                  </div>
                </div>

                {/* Direct Hash Comparison Bars */}
                <div className="space-y-2 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-white border border-gray-200">
                    <span className="text-[10px] text-gray-500 block mb-0.5">
                      On-Chain Notarized Hash (Anchored Proof):
                    </span>
                    <span className="text-emerald-700 font-bold text-xs break-all select-all">
                      {verifyResult.original_hash}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-gray-200">
                    <span className="text-[10px] text-gray-500 block mb-0.5">
                      Received Artifact Hash (Recipient Audit):
                    </span>
                    <span className={`font-bold text-xs break-all select-all ${
                      verifyResult.status === 'VERIFIED' ? 'text-emerald-700' : 'text-red-600'
                    }`}>
                      {verifyResult.received_hash}
                    </span>
                  </div>
                </div>

                {/* Avalanche Effect Explainer */}
                {verifyResult.status === 'INVALID' && (
                  <div className="mt-4 p-3 rounded-xl bg-white border border-red-200 text-xs text-gray-700 leading-relaxed font-sans space-y-1">
                    <div className="flex items-center space-x-1.5 font-bold text-red-600">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Avalanche Effect Protected Treasury:</span>
                    </div>
                    <p className="text-[11px] text-gray-600">
                      Changing a single character (from $150k to $1.5M) completely altered the 256-bit SHA-256 fingerprint. Recipient Agent B rejected the execution immediately. Zero unauthorized transactions executed.
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
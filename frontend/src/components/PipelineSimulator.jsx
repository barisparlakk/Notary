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
  ExternalLink, 
  RefreshCw, 
  Zap, 
  Lock 
} from 'lucide-react';
import { 
  calculateSha256Browser, 
  formatSignedMessage, 
  signMessageBrowser, 
  notarizeDocument, 
  verifyDocument 
} from '../api';
import { INITIAL_TEST_VECTOR } from '../mocks';

const SAMPLE_ORIGINAL_CONTENT = `ChainNotary Provenance Report v1.0
Timestamp: 2026-10-03T18:30:00Z
Sender: agent_a (Research & Strategy)
Receiver: agent_b (Execution & Treasury)
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": 150000.00,
  "risk_score": 0.04,
  "status": "APPROVED FOR EXECUTION"
}`;

const SAMPLE_TAMPERED_CONTENT = `ChainNotary Provenance Report v1.0
Timestamp: 2026-10-03T18:30:00Z
Sender: agent_a (Research & Strategy)
Receiver: agent_b (Execution & Treasury)
Payload:
{
  "action": "EXECUTE_PORTFOLIO_REBALANCE",
  "allocation_source": "0x4a9b...c38d",
  "total_amount_usd": 1500000.00,
  "risk_score": 0.99,
  "status": "REVOKED & EXPLOITED"
}`;

export default function PipelineSimulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [tamperedMode, setTamperedMode] = useState(false);
  
  const [docHash, setDocHash] = useState('');
  const [signedMsg, setSignedMsg] = useState('');
  const [signature, setSignature] = useState('');
  const [notarizeResult, setNotarizeResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);

  const resetPipeline = () => {
    setCurrentStep(0);
    setDocHash('');
    setSignedMsg('');
    setSignature('');
    setNotarizeResult(null);
    setVerifyResult(null);
    setIsRunning(false);
  };

  const runPipeline = async (simulateTamper = false) => {
    setIsRunning(true);
    setTamperedMode(simulateTamper);
    setVerifyResult(null);
    setCurrentStep(1);

    const originalFile = new File([SAMPLE_ORIGINAL_CONTENT], "report.pdf", { type: "application/pdf" });
    const timestamp = "2026-10-03T18:30:00Z";
    const sender = "agent_a";
    const receiver = "agent_b";

    await new Promise(r => setTimeout(r, 600));

    setCurrentStep(2);
    const hash = await calculateSha256Browser(originalFile);
    setDocHash(hash);
    await new Promise(r => setTimeout(r, 600));

    setCurrentStep(3);
    const msg = formatSignedMessage(hash, sender, receiver, timestamp);
    setSignedMsg(msg);
    const seedA = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
    const sig = signMessageBrowser(seedA, msg) || INITIAL_TEST_VECTOR.signature;
    setSignature(sig);
    await new Promise(r => setTimeout(r, 700));

    setCurrentStep(4);
    const res = await notarizeDocument({
      file: originalFile,
      sender,
      receiver,
      timestamp,
      signature: sig
    });
    setNotarizeResult(res.data);
    await new Promise(r => setTimeout(r, 800));

    setCurrentStep(5);
    await new Promise(r => setTimeout(r, 600));

    setCurrentStep(6);
    const receivedFile = simulateTamper
      ? new File([SAMPLE_TAMPERED_CONTENT], "report_tampered.pdf", { type: "application/pdf" })
      : originalFile;

    const verifyRes = await verifyDocument({
      file: receivedFile,
      proof_id: res.data.proof_id
    });

    setVerifyResult(verifyRes.data);
    setCurrentStep(7);
    setIsRunning(false);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-cyber-900 via-cyber-950 to-cyber-950 p-6 md:p-8">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-xs font-mono text-cyan-300">
              <Zap className="w-3.5 h-3.5" />
              <span>MVP Showcase & Security Proof</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              End-to-End AI Agent Provenance Pipeline
            </h1>
            <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
              Demonstrating mathematical immutability and instant tamper detection between <span className="text-cyan-400 font-mono font-semibold">agent_a</span> and <span className="text-purple-400 font-mono font-semibold">agent_b</span> via SHA-256, Ed25519 signatures, and Solana Devnet proof anchoring.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => runPipeline(false)}
              disabled={isRunning}
              className="flex items-center space-x-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm shadow-glow-emerald disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Run Happy Path (VERIFIED)</span>
            </button>

            <button
              onClick={() => runPipeline(true)}
              disabled={isRunning}
              className="flex items-center space-x-2 px-5 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-semibold text-sm shadow-glow-rose disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>1-Byte Attack Test (INVALID)</span>
            </button>

            {currentStep > 0 && (
              <button
                onClick={resetPipeline}
                disabled={isRunning}
                className="flex items-center space-x-2 px-4 py-3 rounded-xl bg-cyber-800 hover:bg-cyber-700 border border-white/10 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { num: 1, title: '1. Create Artifact', icon: FileText, desc: 'agent_a generates report.pdf' },
          { num: 2, title: '2. SHA-256 Hash', icon: Cpu, desc: 'Calculate cryptographic digest' },
          { num: 3, title: '3. Ed25519 Sign', icon: Key, desc: 'Sign metadata with agent key' },
          { num: 4, title: '4. Solana Notarize', icon: Globe, desc: 'Anchor proof to Solana' },
          { num: 5, title: '5. Agent Transfer', icon: ArrowRight, desc: 'Artifact sent to agent_b' },
          { num: 6, title: '6. Verification', icon: ShieldCheck, desc: 'Compute & compare hashes' },
          { num: 7, title: '7. Final Verdict', icon: CheckCircle2, desc: 'Cryptographic result' },
        ].map((s) => {
          const Icon = s.icon;
          const isDone = currentStep > s.num;
          const isCurrent = currentStep === s.num;
          return (
            <div
              key={s.num}
              className={`p-3.5 rounded-xl border transition-all ${
                isCurrent
                  ? 'bg-cyan-950/40 border-cyan-500/60 shadow-glow-cyan'
                  : isDone
                  ? 'bg-cyber-900/80 border-emerald-500/40'
                  : 'bg-cyber-950/40 border-white/5 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono text-slate-400">Step {s.num}</span>
                <Icon className={`w-4 h-4 ${isCurrent ? 'text-cyan-400 animate-pulse' : isDone ? 'text-emerald-400' : 'text-slate-600'}`} />
              </div>
              <h4 className="text-xs font-semibold text-slate-200 truncate">{s.title}</h4>
              <p className="text-[10px] text-slate-500 mt-1 leading-snug truncate">{s.desc}</p>
            </div>
          );
        })}
      </div>

      {currentStep > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-slate-200">
                    {tamperedMode ? 'TAMPERED ARTIFACT (Attacker Modified)' : 'ORIGINAL ARTIFACT (agent_a)'}
                  </span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${tamperedMode ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
                  {tamperedMode ? 'PAYLOAD MANIPULATED' : 'INTEGRITY INTACT'}
                </span>
              </div>
              <pre className={`p-3 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed border ${
                tamperedMode 
                  ? 'bg-rose-950/20 text-rose-200 border-rose-500/30' 
                  : 'bg-cyber-900/90 text-slate-300 border-white/5'
              }`}>
                {tamperedMode ? SAMPLE_TAMPERED_CONTENT : SAMPLE_ORIGINAL_CONTENT}
              </pre>
            </div>

            {docHash && (
              <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-mono font-bold text-slate-200">Cryptographic Identity & Signature</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Ed25519 (Base64)</span>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-slate-400 font-mono">Original Document SHA-256:</label>
                    <div className="mt-1 p-2 rounded bg-cyber-900 text-xs font-mono text-cyan-300 break-all border border-white/5">
                      {docHash}
                    </div>
                  </div>

                  {signedMsg && (
                    <div>
                      <label className="text-[11px] text-slate-400 font-mono">Signed Payload String:</label>
                      <div className="mt-1 p-2 rounded bg-cyber-900 text-[11px] font-mono text-slate-300 break-all border border-white/5">
                        {signedMsg}
                      </div>
                    </div>
                  )}

                  {signature && (
                    <div>
                      <label className="text-[11px] text-slate-400 font-mono">Ed25519 Digital Signature:</label>
                      <div className="mt-1 p-2 rounded bg-cyber-900 text-[11px] font-mono text-purple-300 break-all border border-white/5">
                        {signature}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {notarizeResult && (
              <div className="glass-panel rounded-2xl p-5 border border-purple-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Globe className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-mono font-bold text-purple-300">Solana Devnet Notarization Proof</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                    CONFIRMED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 rounded bg-cyber-900/80 border border-white/5">
                    <span className="text-slate-500 block text-[10px]">Proof ID</span>
                    <span className="text-slate-200 font-bold">{notarizeResult.proof_id}</span>
                  </div>
                  <div className="p-2 rounded bg-cyber-900/80 border border-white/5">
                    <span className="text-slate-500 block text-[10px]">Agents</span>
                    <span className="text-slate-200">{notarizeResult.sender} ➔ {notarizeResult.receiver}</span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px] font-mono mb-1">Transaction Signature</span>
                  <div className="p-2 rounded bg-cyber-900/80 text-[11px] font-mono text-purple-200 break-all border border-white/5">
                    {notarizeResult.tx_signature}
                  </div>
                </div>

                <a
                  href={notarizeResult.explorer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 text-xs text-purple-400 hover:text-purple-300 font-mono transition-colors"
                >
                  <span>Inspect on Solana Explorer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {verifyResult && (
              <div className={`rounded-2xl p-6 border transition-all ${
                verifyResult.status === 'VERIFIED'
                  ? 'bg-emerald-950/40 border-emerald-500/50 shadow-glow-emerald'
                  : 'bg-rose-950/40 border-rose-500/50 shadow-glow-rose'
              }`}>
                <div className="flex items-center space-x-3 mb-4">
                  {verifyResult.status === 'VERIFIED' ? (
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center">
                      <XCircle className="w-7 h-7 text-rose-400" />
                    </div>
                  )}

                  <div>
                    <h3 className={`text-lg font-bold font-mono ${
                      verifyResult.status === 'VERIFIED' ? 'text-emerald-300' : 'text-rose-300'
                    }`}>
                      {verifyResult.status === 'VERIFIED' ? '✓ DOCUMENT VERIFIED' : '✗ INVALID / TAMPER DETECTED'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {verifyResult.status === 'VERIFIED'
                        ? "The received file is mathematically identical to the sender agent's notarized artifact."
                        : 'Cryptographic fingerprint mismatch! Document was manipulated during transit.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-cyber-900/90 border border-white/5 space-y-1">
                    <span className="text-slate-400 block text-[10px]">Original Notarized Hash (SHA-256):</span>
                    <span className="text-emerald-400 break-all select-all font-semibold">
                      {verifyResult.original_hash}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-cyber-900/90 border border-white/5 space-y-1">
                    <span className="text-slate-400 block text-[10px]">Received File Hash (SHA-256):</span>
                    <span className={`break-all select-all font-semibold ${
                      verifyResult.status === 'VERIFIED' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {verifyResult.received_hash}
                    </span>
                  </div>
                </div>

                {verifyResult.status === 'INVALID' && (
                  <div className="mt-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800/60 text-xs text-rose-200">
                    <strong>Avalanche Effect Detected:</strong> Altering even a single bit in the payload completely transformed the SHA-256 output, rendering tampering instantly identifiable.
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
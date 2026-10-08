import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { Download, Plus, X } from 'lucide-react';
import FileDrop from './FileDrop';
import Seal from './Seal';
import { CopyButton, Row, Step } from './Facts';
import { useNotary, shortKey } from '../lib/notary';
import { buildCertificate, deriveProofPda, hexToBytes, sha256Hex, MAX_PARENTS } from '../lib/chain';
import { downloadCertificatePdf } from '../lib/certificatePdf';
import { getMeta, setMeta } from '../lib/localMeta';
import { API_URL } from '../lib/config';

const HEX64 = /^[0-9a-f]{64}$/;
const SAMPLE = () => `Notary sample document\nCreated: ${new Date().toISOString()}\nA short text file to try recording.`;

export default function Record() {
  const { chain, signer, isDemo, cluster, programId, connection } = useNotary();

  const [file, setFile] = useState(null);
  const [docHash, setDocHash] = useState('');
  const [receiver, setReceiver] = useState('');
  const [parents, setParents] = useState([]);
  const [parentInput, setParentInput] = useState('');
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [balance, setBalance] = useState(null);
  const [useRelay, setUseRelay] = useState(!!API_URL);
  const resultRef = useRef(null);

  const onFile = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError('');
    setDocHash(await sha256Hex(f));
  };

  useEffect(() => {
    let off = false;
    if (!signer) { setRecent([]); return undefined; }
    chain.listBySigner(signer.publicKey).then((l) => { if (!off) setRecent(l); }).catch(() => {});
    return () => { off = true; };
  }, [chain, signer, result]);

  useEffect(() => {
    let off = false;
    if (isDemo || !signer || useRelay) { setBalance(null); return undefined; }
    connection.getBalance(signer.publicKey).then((b) => { if (!off) setBalance(b); }).catch(() => {});
    return () => { off = true; };
  }, [isDemo, signer, connection, result, useRelay]);

  const receiverError = useMemo(() => {
    if (!receiver) return '';
    try { new PublicKey(receiver); return ''; } catch { return 'This is not a valid Solana address.'; }
  }, [receiver]);

  const addressPreview = useMemo(() => {
    if (!signer || !docHash) return '';
    return deriveProofPda(programId, signer.publicKey, hexToBytes(docHash))[0].toBase58();
  }, [signer, docHash, programId]);

  const addParent = (hash) => {
    const h = (hash || parentInput).trim().toLowerCase();
    if (!HEX64.test(h)) { setError('A related file is identified by its 64-character SHA-256 fingerprint.'); return; }
    if (parents.includes(h) || parents.length >= MAX_PARENTS) return;
    setError('');
    setParents([...parents, h]);
    setParentInput('');
  };

  const useSample = async () => {
    const text = SAMPLE();
    await onFile(new File([text], 'sample-document.txt', { type: 'text/plain' }));
  };

  const airdrop = async () => {
    try {
      await connection.requestAirdrop(signer.publicKey, 1_000_000_000);
      await new Promise((r) => setTimeout(r, 2000));
      setBalance(await connection.getBalance(signer.publicKey));
    } catch (err) {
      setError(`The test-network faucet refused the request (it limits how often you can ask): ${err.message}`);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file || !docHash || !signer || receiverError) return;
    setBusy(true);
    setError('');
    try {
      const out = await chain.notarize({ signer, hashHex: docHash, receiver: receiver || null, parents, relay: useRelay && API_URL ? API_URL : null });
      const certificate = buildCertificate({ proofPda: out.proof_pda, proof: out.proof, txSignature: out.tx_signature, programId, cluster });
      setMeta(out.proof_pda, { file_name: file.name || 'document', file_size: file.size || 0, tx_signature: out.tx_signature });
      setResult({ ...out, certificate, file_name: file.name || 'document' });
      setQr(await (await import('qrcode')).default.toDataURL(certificate.verify_url, { margin: 1, width: 160 }));
      setTimeout(() => resultRef.current?.focus(), 50);
    } catch (err) {
      const msg = String(err.message || err);
      const hint = signer?.kind === 'wallet' && /blockhash|simulat|network|cluster/i.test(msg)
        ? ` Check that your wallet is set to Solana ${cluster === 'devnet' ? 'devnet' : cluster}.`
        : '';
      setError(msg + hint);
    } finally {
      setBusy(false);
    }
  };

  const downloadJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.certificate, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-certificate-${result.proof_pda.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lowBalance = balance !== null && balance < 5_000_000;

  return (
    <div className="max-w-3xl">
      <header>
        <h1 className="font-display text-4xl font-semibold leading-tight">Record a file</h1>
        <p className="mt-3 text-gray-600 leading-relaxed max-w-xl">
          Your wallet signs a record of the file's fingerprint on Solana. Anyone can check the file against it later, without an account.
          The file itself stays on your device.
        </p>
        {!signer && (
          <p className="mt-4 text-sm text-gray-700 border-l-2 border-ink pl-3">Connect a wallet to record a file. Checking a file never needs one.</p>
        )}
      </header>

      <form onSubmit={submit} className="mt-10">
        <Step n={1} title="Choose the file">
          <FileDrop id="record-file-input" onFile={onFile} title={file ? file.name : 'Drop a file here'} subtitle={file ? `${(file.size / 1024).toFixed(1)} KB, fingerprinted in your browser` : 'or choose one'} />
          {docHash && (
            <p className="text-xs text-gray-500">Fingerprint <span className="font-mono text-gray-700 break-all">{docHash}</span> <CopyButton text={docHash} /></p>
          )}
          {isDemo && <button type="button" onClick={useSample} className="text-sm underline text-gray-600 hover:text-ink">Use a sample file</button>}
        </Step>

        <Step n={2} title="Add details (optional)">
          <div>
            <label htmlFor="receiver" className="block text-sm text-gray-700 mb-1.5">Who is it for?</label>
            <input id="receiver" type="text" value={receiver} onChange={(e) => setReceiver(e.target.value.trim())} className="cal-input font-mono text-xs" placeholder="Wallet address of the receiver" />
            {receiverError && <p className="mt-1.5 text-sm text-altered">{receiverError}</p>}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-gray-600 hover:text-ink select-none">This file is based on other recorded files</summary>
            <div className="mt-3 space-y-3">
              <p className="text-gray-600">Add the fingerprints of up to {MAX_PARENTS} files it builds on. Anyone can then see what a decision rested on.</p>
              <div className="flex gap-2">
                <input type="text" value={parentInput} onChange={(e) => setParentInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParent(); } }} className="cal-input font-mono text-xs" placeholder="64-character fingerprint" aria-label="Fingerprint of a related file" />
                <button type="button" onClick={() => addParent()} className="cal-btn-secondary px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4 mr-1" />Add</button>
              </div>
              {recent.length > 0 && parents.length < MAX_PARENTS && (
                <div className="flex flex-wrap gap-1.5">
                  {recent.slice(0, 4).map((p) => (
                    <button key={p.proof_pda} type="button" onClick={() => addParent(p.document_hash)} title={p.document_hash} className="rounded-full border border-rule px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400">
                      {getMeta(p.proof_pda)?.file_name || shortKey(p.document_hash, 6)}
                    </button>
                  ))}
                </div>
              )}
              {parents.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {parents.map((h) => (
                    <li key={h} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-mono">
                      {shortKey(h, 8)}
                      <button type="button" aria-label="Remove related file" onClick={() => setParents(parents.filter((x) => x !== h))}><X className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </Step>

        <Step n={3} title="Sign and record" last>
          <p className="text-sm text-gray-700">
            {signer ? <>Signing as <span className="font-mono text-xs">{shortKey(signer.publicKey, 6)}</span> ({signer.label}).</> : 'No wallet connected.'}
            {' '}The time of the record comes from the Solana clock, so it cannot be backdated.
          </p>
          {!isDemo && signer?.kind === 'wallet' && (
            <p className="text-sm text-gray-600">Wallets do not tell websites which network they are on. Make sure {signer.label} is set to Solana {cluster === 'devnet' ? 'devnet' : cluster}.</p>
          )}
          {!isDemo && API_URL && (
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={useRelay} onChange={(e) => setUseRelay(e.target.checked)} className="mt-1 accent-ink" />
              <span>Let the relayer pay the network fee. You still sign, and you need no SOL.</span>
            </label>
          )}
          {!isDemo && lowBalance && cluster === 'devnet' && !useRelay && (
            <p className="text-sm text-gray-700">Your wallet has almost no SOL. <button type="button" onClick={airdrop} className="underline">Request test SOL</button></p>
          )}
          {addressPreview && <p className="text-xs text-gray-500">The record will live at <span className="font-mono break-all">{addressPreview}</span></p>}

          {error && <p className="text-sm text-altered" role="alert">{error}</p>}

          <button type="submit" disabled={!file || !signer || !!receiverError || busy} className="cal-btn-primary px-5 py-2.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Waiting for your wallet and the network…' : isDemo ? 'Record this file (demo)' : 'Record this file'}
          </button>
        </Step>
      </form>

      {result && (
        <section className="mt-14 border-t border-rule pt-8" aria-live="polite">
          <div className="flex flex-wrap items-start gap-10">
            <div className="min-w-0 flex-1 basis-80">
              <h2 ref={resultRef} tabIndex={-1} className="font-display text-3xl sm:text-4xl font-semibold leading-tight outline-none">
                {isDemo ? 'Recorded in the demo.' : 'Recorded.'}
              </h2>
              <p className="mt-3 text-gray-600 leading-relaxed max-w-md">
                {isDemo
                  ? 'This demo record lives in your browser only. Nothing was written to Solana.'
                  : 'Anyone with the file can now check it against this record. Share the link or the certificate with whoever needs it.'}
              </p>
              <dl className="mt-6">
                <Row label="Record address"><span className="font-mono text-xs">{result.proof_pda}</span> <CopyButton text={result.proof_pda} /></Row>
                <Row label="Recorded by"><span className="font-mono text-xs">{result.proof.signer}</span></Row>
                <Row label="Recorded on">{result.proof.created_at_iso} (chain time, UTC)</Row>
                {!isDemo && (
                  <Row label="Transaction">
                    <a className="underline text-gray-700 hover:text-ink font-mono text-xs break-all" href={`https://explorer.solana.com/tx/${result.tx_signature}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer">{shortKey(result.tx_signature, 10)}</a>
                  </Row>
                )}
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadCertificatePdf(result.certificate, `notary-certificate-${result.proof_pda.slice(0, 8)}.pdf`)} className="cal-btn-primary px-4 py-2 rounded-lg text-sm">
                  <Download className="w-4 h-4 mr-2" />Download certificate (PDF)
                </button>
                <button type="button" onClick={downloadJson} className="cal-btn-secondary px-4 py-2 rounded-lg text-sm">Download as JSON</button>
                <CopyLink text={result.certificate.verify_url} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Seal key={docHash} hash={docHash} state="verified" size={200} animate demo={isDemo} />
              {qr && (
                <figure className="text-center text-xs text-gray-500">
                  <img src={qr} alt="QR code that opens the check page for this record" className="w-28 h-28 mx-auto" />
                  <figcaption className="mt-1">Scan to check a file against this record</figcaption>
                </figure>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function CopyLink({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); }} className="cal-btn-secondary px-4 py-2 rounded-lg text-sm">
      {done ? 'Link copied' : 'Copy link to check'}
    </button>
  );
}

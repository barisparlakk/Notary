import React, { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { CopyButton as Copy2, Row } from './Facts';
import FileDrop from './FileDrop';
import Seal from './Seal';
import { useNotary, shortKey } from '../lib/notary';
import { buildAgreementCertificate, buildCertificate, lineage, sha256Hex, verifyDocument } from '../lib/chain';
import { downloadCertificatePdf } from '../lib/certificatePdf';
import { getMeta, setMeta } from '../lib/localMeta';

const SAMPLE = `Notary sample contract
Parties: A and B
Subject: delivery of 100 units at a fixed price
Date: 2026-10-03`;

const STATEMENT = {
  VERIFIED: { title: 'This is the file that was recorded.', seal: 'verified' },
  PENDING: { title: 'This is the agreed file. Not everyone has signed yet.', seal: 'pending' },
  INVALID: { title: 'This is not the file that was recorded.', seal: 'altered' },
  NOT_FOUND: { title: 'No record of this exact file.', seal: 'neutral' },
};

export default function Check({ initialPda = '' }) {
  const { chain, signer, isDemo, cluster, programId } = useNotary();

  const [file, setFile] = useState(null);
  const [hash, setHash] = useState('');
  const [reference, setReference] = useState(initialPda);
  const [refOpen, setRefOpen] = useState(!!initialPda);
  const [linked, setLinked] = useState(null); // bağlantıdaki kayıt (dosya yüklenmeden de gösterilir)
  const [result, setResult] = useState(null);
  const [ancestors, setAncestors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // QR/bağlantıyla gelinen kayıt: dosya beklenirken kaydın kendisini göster
  useEffect(() => {
    let off = false;
    if (!initialPda) return undefined;
    chain.getRecord(initialPda).then((rec) => { if (!off) setLinked(rec); }).catch(() => {});
    return () => { off = true; };
  }, [chain, initialPda]);

  const run = useCallback(async (fileHash, ref) => {
    setBusy(true);
    setError('');
    setAncestors([]);
    try {
      const r = (ref || '').trim();
      let opts = {};
      if (r) opts = (await chain.getRecord(r).catch(() => null)) ? { pda: r } : { signer: r };
      const res = await verifyDocument(chain, fileHash, opts);
      setResult(res);
      if (res.proof_pda && res.proof) lineage(chain, res.proof_pda).then(setAncestors).catch(() => setAncestors([]));
    } catch (err) {
      setError(`Could not read the chain: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }, [chain]);

  const onFile = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    const h = await sha256Hex(f);
    setHash(h);
    run(h, reference);
  };

  // Demo: örnek dosyayı (yoksa) kaydeder; "değişmiş örnek" aynı kayda karşı bir bayt farkla denenir
  const trySample = async (changed) => {
    if (!signer) return;
    setError('');
    try {
      const original = await sha256Hex(SAMPLE);
      const found = (await chain.findByHash(original))[0];
      const pda = found?.proof_pda || (await chain.notarize({ signer, hashHex: original })).proof_pda;
      setMeta(pda, { file_name: 'sample-contract.txt' });
      const text = changed ? SAMPLE.replace('100 units', '1000 units') : SAMPLE;
      setReference(changed ? pda : '');
      const f = new File([text], changed ? 'sample-contract-changed.txt' : 'sample-contract.txt', { type: 'text/plain' });
      setFile(f);
      setResult(null);
      const h = await sha256Hex(f);
      setHash(h);
      run(h, changed ? pda : '');
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const status = result?.status;
  const stmt = status ? STATEMENT[status] : null;
  const record = result?.proof || result?.agreement || null;
  const recordedBy = result?.proof?.signer || result?.agreement?.creator;
  const recordedAt = result?.proof?.created_at_iso || result?.agreement?.created_at_iso;

  const certificate = (() => {
    if (!result || !result.proof_pda || !(status === 'VERIFIED' || status === 'PENDING')) return null;
    const tx = getMeta(result.proof_pda)?.tx_signature;
    return result.agreement
      ? buildAgreementCertificate({ agreementPda: result.proof_pda, agreement: result.agreement, txSignature: tx, programId, cluster })
      : buildCertificate({ proofPda: result.proof_pda, proof: result.proof, txSignature: tx, programId, cluster });
  })();

  const downloadJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(certificate, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `notary-certificate-${result.proof_pda.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.1] text-ink">Is this the file that was recorded?</h1>
        <p className="mt-4 text-base text-gray-600 leading-relaxed">
          Drop a file to find out. Nothing is uploaded, and you do not need an account or a wallet.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px] items-start">
        <div className="space-y-4 min-w-0">
          <FileDrop id="check-file-input" onFile={onFile} title={file ? file.name : 'Drop a file here'} subtitle={file ? `${(file.size / 1024).toFixed(1)} KB, checked in your browser` : 'or choose one'} />

          {hash && (
            <p className="text-xs text-gray-500">
              File fingerprint <span className="font-mono text-gray-700 break-all">{hash}</span> <Copy2 text={hash} />
            </p>
          )}

          {isDemo && (
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" onClick={() => trySample(false)} className="cal-btn-secondary px-3 py-1.5 rounded-lg">Try a sample file</button>
              <button type="button" onClick={() => trySample(true)} className="cal-btn-secondary px-3 py-1.5 rounded-lg">Try a changed sample</button>
            </div>
          )}

          <details open={refOpen} onToggle={(e) => setRefOpen(e.currentTarget.open)} className="text-sm">
            <summary className="cursor-pointer text-gray-600 hover:text-ink select-none">Have a record address or link?</summary>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="cal-input font-mono text-xs"
                placeholder="Record address, or the signer's address"
                aria-label="Record address or signer address"
              />
              <button type="button" disabled={!hash || busy} onClick={() => run(hash, reference)} className="cal-btn-secondary px-3 py-1.5 rounded-lg disabled:opacity-40">Check again</button>
            </div>
          </details>
        </div>

        <div className="justify-self-center lg:justify-self-end">
          <Seal
            key={`${hash}-${status}`}
            hash={hash || undefined}
            state={status === 'INVALID' ? 'altered' : stmt?.seal || 'neutral'}
            animate={!!status}
            demo={isDemo}
            size={220}
          />
        </div>
      </div>

      {/* Bağlantıyla gelinen kayıt, henüz dosya yokken */}
      {linked && !result && (
        <section className="mt-10 max-w-2xl border-t border-rule pt-6" aria-live="polite">
          <h2 className="font-display text-2xl font-semibold">A record is waiting for its file.</h2>
          <p className="mt-2 text-gray-600">Drop the file you received to compare it with this record.</p>
          <dl className="mt-4">
            <Row label="Recorded by"><span className="font-mono text-xs">{linked.type === 'agreement' ? linked.agreement.creator : linked.proof.signer}</span></Row>
            <Row label="Recorded on">{(linked.agreement || linked.proof).created_at_iso}</Row>
          </dl>
        </section>
      )}

      <section className="mt-10" aria-live="polite" aria-busy={busy}>
        {busy && <p className="text-gray-600">Checking the chain…</p>}
        {error && <p className="text-altered" role="alert">{error}</p>}

        {stmt && !busy && (
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl sm:text-4xl font-semibold leading-tight">{stmt.title}</h2>
            <p className="mt-3 text-gray-600 max-w-xl leading-relaxed">
              {status === 'VERIFIED' && <>It matches the record below, byte for byte.</>}
              {status === 'PENDING' && <>{result.agreement.signed_count} of {result.agreement.parties.length} parties have signed. It is binding once all of them have.</>}
              {status === 'INVALID' && <>It differs from the record in at least one byte. A single changed byte gives a completely different seal.</>}
              {status === 'NOT_FOUND' && <>It was never recorded, or it was changed after it was. If you have the address of a record, add it above and check again.</>}
            </p>

            {status === 'INVALID' && (
              <div className="mt-8 flex flex-wrap gap-10">
                <figure className="text-sm text-gray-600">
                  <Seal hash={result.original_hash} state="verified" size={160} animate demo={isDemo} />
                  <figcaption className="mt-2">Recorded</figcaption>
                </figure>
                <figure className="text-sm text-gray-600">
                  <Seal hash={hash} state="altered" size={160} animate demo={isDemo} />
                  <figcaption className="mt-2">This file</figcaption>
                </figure>
              </div>
            )}

            {record && (
              <dl className="mt-8">
                {recordedBy && <Row label="Recorded by"><span className="font-mono text-xs">{recordedBy}</span> <Copy2 text={recordedBy} /></Row>}
                {recordedAt && <Row label="Recorded on">{recordedAt} (chain time, UTC)</Row>}
                {result.proof?.receiver && <Row label="Receiver"><span className="font-mono text-xs">{result.proof.receiver}</span></Row>}
                <Row label="Record address">
                  <span className="font-mono text-xs">{result.proof_pda}</span> <Copy2 text={result.proof_pda} />
                  {!isDemo && (
                    <> <a className="underline text-gray-600 hover:text-ink ml-2" href={`https://explorer.solana.com/address/${result.proof_pda}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer">View on Solana Explorer</a></>
                  )}
                </Row>
                {result.agreement && (
                  <Row label="Signatures">
                    <ul>
                      {result.agreement.parties.map((p) => (
                        <li key={p.signer} className="flex justify-between gap-4 border-b border-dashed border-rule py-2 last:border-b-0">
                          <span className="font-mono text-xs" title={p.signer}>{shortKey(p.signer, 8)}{p.signer === result.agreement.creator ? ' (created it)' : ''}</span>
                          <span className={p.signed_at ? 'text-verified' : 'text-gray-500'}>{p.signed_at ? `Signed ${p.signed_at_iso}` : 'Waiting for signature'}</span>
                        </li>
                      ))}
                    </ul>
                  </Row>
                )}
                {ancestors.length > 0 && (
                  <Row label="Based on">
                    <ul className="space-y-1">
                      {ancestors.map((a) => (
                        <li key={a.document_hash} className="text-xs">
                          <span className="font-mono" title={a.document_hash}>{shortKey(a.document_hash, 10)}</span>{' '}
                          <span className="text-gray-600">{a.missing ? 'has no record' : `recorded ${a.created_at_iso}`}</span>
                        </li>
                      ))}
                    </ul>
                  </Row>
                )}
              </dl>
            )}

            {certificate && (
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadCertificatePdf(certificate, `notary-certificate-${result.proof_pda.slice(0, 8)}.pdf`)} className="cal-btn-primary px-4 py-2 rounded-lg text-sm">
                  <Download className="w-4 h-4 mr-2" />Download certificate (PDF)
                </button>
                <button type="button" onClick={downloadJson} className="cal-btn-secondary px-4 py-2 rounded-lg text-sm">Download as JSON</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-20 max-w-2xl border-t border-rule pt-8">
        <h2 className="font-display text-2xl font-semibold">How the check works</h2>
        <div className="mt-4 space-y-3 text-gray-700 leading-relaxed">
          <p>Your browser computes the file's SHA-256 fingerprint. The file itself never leaves your device.</p>
          <p>That fingerprint is compared with the record a wallet stored on Solana. A record can only be created once for the same wallet and file, and its time comes from the chain, so it cannot be backdated.</p>
          <p>The check reads the chain directly. It keeps working if our servers are down, and anyone can repeat it with the open-source checker.</p>
        </div>
        <p className="mt-4 text-sm">
          <a className="underline text-gray-600 hover:text-ink" href="https://github.com/barisparlakk/Notary/blob/integration/agents/verify_standalone.py" target="_blank" rel="noopener noreferrer">Open-source checker</a>
          <span className="mx-2 text-gray-300">|</span>
          <a className="underline text-gray-600 hover:text-ink" href="https://github.com/barisparlakk/Notary/blob/integration/CONTRACT.md" target="_blank" rel="noopener noreferrer">How records are stored</a>
        </p>
      </section>
    </div>
  );
}

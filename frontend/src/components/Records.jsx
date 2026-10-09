import React, { useCallback, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import Dialog from './Dialog';
import Seal from './Seal';
import Tabs from './Tabs';
import { CopyButton, Row } from './Facts';
import { useNotary, shortKey } from '../lib/notary';
import { buildCertificate, lineage } from '../lib/chain';
import IdentityNote, { useIdentity } from './Identity';
import { API_URL } from '../lib/config';
import { downloadCertificatePdf } from '../lib/certificatePdf';
import { addIdentity, getIdentities, getMeta, removeIdentity } from '../lib/localMeta';

const HEX64 = /^[0-9a-f]{64}$/i;

// Records: cüzdanın kaydettiği dosyalar (defter gibi sıralı satırlar) ve tanıdığı cüzdanlar. Kimse için hesap gerekmez:
// herkes herhangi bir parmak izini, kayıt adresini ya da imzalayanı arayabilir.
export default function Records() {
  const { chain, signer, isDemo, cluster, programId } = useNotary();
  const [section, setSection] = useState('files');
  const [records, setRecords] = useState([]);
  const [heading, setHeading] = useState('Recorded by your wallet');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [ancestors, setAncestors] = useState([]);
  const [revocations, setRevocations] = useState({}); // proof_pda -> iptal kaydı | null
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [identityTick, setIdentityTick] = useState(0);
  const relay = !isDemo && API_URL ? API_URL : null;

  const [people, setPeople] = useState(() => getIdentities());
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [peopleError, setPeopleError] = useState('');

  const loadMine = useCallback(async () => {
    if (!signer) { setRecords([]); return; }
    setLoading(true);
    try {
      setRecords(await chain.listBySigner(signer.publicKey));
      setHeading('Recorded by your wallet');
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, [chain, signer]);

  useEffect(() => { loadMine(); }, [loadMine]);

  // İptal edilmiş kayıtlar listede işaretlenir
  useEffect(() => {
    let off = false;
    Promise.all(records.map(async (r) => [r.proof_pda, await chain.getRevocation(r.proof_pda).catch(() => null)]))
      .then((pairs) => { if (!off) setRevocations(Object.fromEntries(pairs)); });
    return () => { off = true; };
  }, [chain, records]);

  const lookup = async (raw = query) => {
    const q = raw.trim();
    setError('');
    if (!q) { loadMine(); return; }
    setLoading(true);
    try {
      let found = [];
      if (HEX64.test(q)) {
        found = await chain.findByHash(q.toLowerCase());
      } else {
        new PublicKey(q);
        const rec = await chain.getRecord(q).catch(() => null);
        found = rec?.type === 'proof' ? [{ ...rec.proof, proof_pda: q }] : rec ? [] : await chain.listBySigner(q);
      }
      setRecords(found);
      setHeading(`Results for ${shortKey(q, 8)}`);
    } catch {
      setError('Enter a file fingerprint (64 characters), a record address or a signer address.');
    } finally {
      setLoading(false);
    }
  };

  const open = (r) => {
    setSelected(r);
    setConfirmRevoke(false);
    setRevokeError('');
    setAncestors([]);
    lineage(chain, r.proof_pda).then(setAncestors).catch(() => setAncestors([]));
  };

  const revoke = async () => {
    setRevokeBusy(true);
    setRevokeError('');
    try {
      const out = await chain.revokeProof({ signer, proofPda: selected.proof_pda, relay });
      const rev = await chain.getRevocation(selected.proof_pda).catch(() => null);
      setRevocations((m) => ({ ...m, [selected.proof_pda]: rev || { revoked_at_iso: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), signer: String(signer.publicKey), tx: out.tx_signature } }));
      setConfirmRevoke(false);
    } catch (err) {
      setRevokeError(String(err.message || err));
    } finally {
      setRevokeBusy(false);
    }
  };

  const registerName = async (e) => {
    e.preventDefault();
    setNameBusy(true);
    setNameError('');
    try {
      await chain.attestIdentity({ signer, subject: signer.publicKey, label: nameInput.trim(), evidence: '', relay });
      setNameInput('');
      setIdentityTick((n) => n + 1);
    } catch (err) {
      setNameError(String(err.message || err));
    } finally {
      setNameBusy(false);
    }
  };

  const nameOf = (a) => {
    if (signer && String(signer.publicKey) === a) return `${signer.label} (you)`;
    return people.find((p) => p.address === a)?.label || shortKey(a, 5);
  };

  const certificateOf = (r) => buildCertificate({ proofPda: r.proof_pda, proof: r, txSignature: getMeta(r.proof_pda)?.tx_signature, programId, cluster });

  const addPerson = (e) => {
    e.preventDefault();
    try {
      setPeople(addIdentity(label.trim(), new PublicKey(address.trim()).toBase58()));
      setLabel('');
      setAddress('');
      setPeopleError('');
    } catch {
      setPeopleError('This is not a valid Solana address.');
    }
  };

  const showRecordsOf = (a) => { setSection('files'); setQuery(a); lookup(a); };

  const you = signer ? [{ label: `${signer.label} (you)`, address: String(signer.publicKey), self: true }] : [];

  return (
    <div className="max-w-4xl">
      <header className="max-w-xl">
        <h1 className="font-display text-4xl font-semibold leading-tight">Records</h1>
        <p className="mt-3 text-gray-600 leading-relaxed">
          The files your wallet has recorded, and the wallets you know. You can also look up anyone's record. It needs no account.
        </p>
      </header>

      <Tabs className="mt-8 border-b border-rule" label="Records sections" value={section} onChange={setSection}
        options={[{ value: 'files', label: `Recorded files (${records.length})` }, { value: 'people', label: `People (${people.length + you.length})` }]} />

      {section === 'files' && (
        <section className="mt-8" aria-label="Recorded files">
          <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex gap-2 max-w-2xl">
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="field text-sm" placeholder="Search by file fingerprint, record address or signer" aria-label="Search records" />
            <button type="submit" className="btn-secondary px-4 py-2 rounded-lg text-sm shrink-0">Look up</button>
          </form>
          {error && <p className="mt-2 text-sm text-altered" role="alert">{error}</p>}

          <h2 className="mt-8 text-base font-semibold">{heading}</h2>
          {records.length === 0 ? (
            <p className="mt-3 text-gray-600">
              {loading ? 'Reading the chain…' : signer ? 'Nothing recorded yet. Record a file, or look up someone else above.' : 'Connect a wallet to see your records, or look up anyone above.'}
            </p>
          ) : (
            <ul className="mt-3">
              {records.map((r) => (
                <li key={r.proof_pda} className="grid gap-4 md:grid-cols-[56px_minmax(0,1fr)_auto] items-center border-t border-rule py-5">
                  <Seal hash={r.document_hash} state={revocations[r.proof_pda] ? 'revoked' : 'verified'} size={52} demo={isDemo} label="" />
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">
                      {getMeta(r.proof_pda)?.file_name || 'Unnamed file'}
                      {revocations[r.proof_pda] && <span className="ml-2 text-xs font-semibold text-revoked">Revoked</span>}
                    </p>
                    <p className="text-sm text-gray-600">
                      {r.created_at_iso} <span className="mx-1 text-gray-300">/</span> by {nameOf(r.signer)}{r.receiver ? <>, for {nameOf(r.receiver)}</> : null}
                    </p>
                    <p className="font-mono text-xs text-gray-500 truncate" title={r.document_hash}>{r.document_hash}</p>
                  </div>
                  <button type="button" onClick={() => open(r)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Details</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'people' && (
        <section className="mt-8 max-w-2xl" aria-label="People">
          <p className="text-gray-600 leading-relaxed">
            A person on Notary is a wallet address. Label the ones you know. These labels stay in this browser and no private keys are stored. Only the name you register for your own wallet, further down, is written on Solana.
          </p>
          <ul className="mt-6">
            {[...you, ...people].map((p) => (
              <li key={p.address} className="border-t border-rule py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="font-medium">{p.label}</p>
                  <p className="font-mono text-xs text-gray-500 break-all">{p.address} <CopyButton text={p.address} label="Copy address" /></p>
                  <PersonIdentity chain={chain} address={p.address} tick={identityTick} />
                </div>
                <button type="button" onClick={() => showRecordsOf(p.address)} className="btn-secondary px-3 py-1.5 rounded-lg text-sm">See records</button>
                {!p.self && <button type="button" onClick={() => setPeople(removeIdentity(p.address))} className="text-sm text-gray-600 underline hover:text-altered">Remove</button>}
              </li>
            ))}
          </ul>

          {signer && (
            <form onSubmit={registerName} className="mt-8 border-t border-rule pt-6 space-y-3">
              <h2 className="text-base font-semibold">Register your name</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                Attach a name to your wallet so people who check your records see who signed. It is public and stays on Solana, so use a name you are happy to show.
                A name you give yourself is shown as self-declared. It becomes confirmed only when an issuer on the trust list attests to it.
              </p>
              <div className="flex gap-2 max-w-md">
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} required maxLength={32} className="field text-sm" placeholder="For example, Ahmet Yilmaz" aria-label="Your name" />
                <button type="submit" disabled={nameBusy} className="btn-primary px-4 py-2 rounded-lg text-sm shrink-0 disabled:opacity-40">{nameBusy ? 'Signing…' : 'Register'}</button>
              </div>
              {nameError && <p className="text-sm text-altered" role="alert">{nameError}</p>}
            </form>
          )}

          <form onSubmit={addPerson} className="mt-8 border-t border-rule pt-6 space-y-3">
            <h2 className="text-base font-semibold">Add a person</h2>
            <div>
              <label htmlFor="person-label" className="block text-sm text-gray-700 mb-1.5">Name</label>
              <input id="person-label" required value={label} onChange={(e) => setLabel(e.target.value)} className="field text-sm" placeholder="For example, Ahmet" />
            </div>
            <div>
              <label htmlFor="person-address" className="block text-sm text-gray-700 mb-1.5">Wallet address</label>
              <input id="person-address" required value={address} onChange={(e) => setAddress(e.target.value)} className="field font-mono text-xs" placeholder="Solana address" />
              {peopleError && <p className="mt-1.5 text-sm text-altered" role="alert">{peopleError}</p>}
            </div>
            <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Save person</button>
          </form>
        </section>
      )}

      {selected && (
        <Dialog title={<>Record {shortKey(selected.proof_pda, 8)}</>} onClose={() => setSelected(null)}>
          <dl>
            <Row label="File">{getMeta(selected.proof_pda)?.file_name || 'Unnamed file'}</Row>
            <Row label="Recorded by">{nameOf(selected.signer)} <span className="font-mono text-xs text-gray-500 break-all">{selected.signer}</span></Row>
            <Row label="Identity"><SignerIdentity chain={chain} address={selected.signer} tick={identityTick} /></Row>
            {revocations[selected.proof_pda] && <Row label="Status"><span className="font-medium text-revoked">Revoked on {revocations[selected.proof_pda].revoked_at_iso}. The signer has withdrawn this record.</span></Row>}
            {selected.receiver && <Row label="For">{nameOf(selected.receiver)}</Row>}
            <Row label="Recorded on">{selected.created_at_iso} (chain time, UTC)</Row>
            <Row label="Fingerprint"><span className="font-mono text-xs break-all">{selected.document_hash}</span> <CopyButton text={selected.document_hash} /></Row>
            {ancestors.length > 0 && (
              <Row label="Based on">
                <ul className="space-y-1">
                  {ancestors.map((a) => (
                    <li key={a.document_hash} className="text-xs">
                      <span className="font-mono">{shortKey(a.document_hash, 10)}</span>{' '}
                      <span className="text-gray-600">{a.missing ? 'has no record' : `recorded ${a.created_at_iso} by ${nameOf(a.signer)}`}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => downloadCertificatePdf(certificateOf(selected), `notary-certificate-${selected.proof_pda.slice(0, 8)}.pdf`)} className="btn-primary px-4 py-2 rounded-lg text-sm">Download certificate (PDF)</button>
            <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?tab=verify&pda=${selected.proof_pda}`)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Copy link to check</button>
            {!isDemo && (
              <a href={`https://explorer.solana.com/address/${selected.proof_pda}?cluster=${cluster}`} target="_blank" rel="noopener noreferrer" className="btn-secondary px-4 py-2 rounded-lg text-sm">View on Solana Explorer</a>
            )}
          </div>
          {signer && String(signer.publicKey) === selected.signer && !revocations[selected.proof_pda] && (
            <div className="border-t border-rule pt-4">
              {!confirmRevoke ? (
                <button type="button" onClick={() => setConfirmRevoke(true)} className="text-sm text-gray-600 underline hover:text-altered">Revoke this record</button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Revoking is public and cannot be undone. The record stays on Solana, but everyone who checks the file will see that you withdrew it.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={revoke} disabled={revokeBusy} className="px-4 py-2 rounded-lg text-sm bg-altered text-white disabled:opacity-40">{revokeBusy ? 'Signing…' : 'Yes, revoke it'}</button>
                    <button type="button" onClick={() => setConfirmRevoke(false)} className="btn-secondary px-4 py-2 rounded-lg text-sm">Keep it</button>
                  </div>
                </div>
              )}
              {revokeError && <p className="mt-2 text-sm text-altered" role="alert">{revokeError}</p>}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function PersonIdentity({ chain, address, tick }) {
  const { identity } = useIdentity(chain, `${address}`, tick);
  return <p className="mt-1 text-xs"><IdentityNote identity={identity} compact /></p>;
}

function SignerIdentity({ chain, address, tick }) {
  const { identity, error } = useIdentity(chain, address, tick);
  return error ? <span className="text-gray-500">Identity could not be looked up.</span> : <IdentityNote identity={identity} />;
}

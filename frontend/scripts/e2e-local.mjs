// Gerçek bir Solana doğrulayıcısına (solana-test-validator ya da devnet) karşı uçtan uca sınama.
//   RPC_URL=http://127.0.0.1:8899 PROGRAM_ID=<id> [RELAY_URL=http://127.0.0.1:8000] node scripts/e2e-local.mjs
import { Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import * as chain from '../src/lib/chain.js';

const { RPC_URL = 'http://127.0.0.1:8899', PROGRAM_ID, RELAY_URL, FUNDER } = process.env; // FUNDER: Solana CLI JSON anahtarı (airdrop yerine transfer)
if (!PROGRAM_ID) { console.error('PROGRAM_ID gerekli'); process.exit(2); }

const conn = new Connection(RPC_URL, 'confirmed');
const rpc = new chain.RpcChain(conn, PROGRAM_ID);
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${name} ${extra}`); if (!ok) failed++; };

const fund = async (kp) => {
  if (FUNDER) {
    const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(FUNDER, 'utf8'))));
    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports: 20_000_000 }));
    tx.sign(funder);
    const sig = await conn.sendRawTransaction(tx.serialize());
    for (let i = 0; i < 60; i++) {
      const { value } = await conn.getSignatureStatuses([sig]);
      if (value[0]?.confirmationStatus) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    return;
  }
  const sig = await conn.requestAirdrop(kp.publicKey, 1e9);
  for (let i = 0; i < 40; i++) {
    const { value } = await conn.getSignatureStatuses([sig]);
    if (value[0]?.confirmationStatus) break;
    await new Promise((r) => setTimeout(r, 300));
  }
};
const hashOf = (txt) => chain.sha256Hex(txt);

// 1) doğrudan kayıt (imzalayan öder)
const alice = Keypair.generate();
await fund(alice);
const signerA = { publicKey: alice.publicKey, keypair: alice };
const h1 = await hashOf(`e2e document ${Date.now()}`);
const parentHash = await hashOf(`e2e parent ${Date.now()}`);
await rpc.notarize({ signer: signerA, hashHex: parentHash });
const out = await rpc.notarize({ signer: signerA, hashHex: h1, receiver: Keypair.generate().publicKey, parents: [parentHash] });
check('notarize on real program', !!out.proof_pda && out.proof?.document_hash === h1);
check('chain time is recent', Math.abs(out.proof.created_at - Date.now() / 1000) < 600);
check('receiver + parents stored', out.proof.receiver && out.proof.parents[0] === parentHash);

// 2) doğrulama (3 mod), değişmiş dosya, tekrar kayıt
for (const [label, opts] of [['pda', { pda: out.proof_pda }], ['signer', { signer: alice.publicKey }], ['hash search', {}]]) {
  check(`verify by ${label}`, (await chain.verifyDocument(rpc, h1, opts)).status === 'VERIFIED');
}
const bad = await hashOf('tampered');
check('tampered with PDA -> INVALID', (await chain.verifyDocument(rpc, bad, { pda: out.proof_pda })).status === 'INVALID');
check('unknown hash -> NOT_FOUND', (await chain.verifyDocument(rpc, bad, { signer: alice.publicKey })).status === 'NOT_FOUND');
let dup = false;
try { await rpc.notarize({ signer: signerA, hashHex: h1 }); } catch { dup = true; }
check('duplicate (signer, hash) rejected by program', dup);
const nodes = await chain.lineage(rpc, out.proof_pda);
check('lineage read from chain', nodes.length === 1 && nodes[0].document_hash === parentHash);
check('list by signer', (await rpc.listBySigner(alice.publicKey)).length === 2);

// 3) relayer: imzalayanın hiç SOL'ü yok
if (RELAY_URL) {
  const bob = Keypair.generate(); // fonlanmadı
  const h2 = await hashOf(`relayed ${Date.now()}`);
  const r = await rpc.notarize({ signer: { publicKey: bob.publicKey, keypair: bob }, hashHex: h2, relay: RELAY_URL });
  check('relayed notarize (signer has 0 SOL)', r.relayed && r.proof?.signer === bob.publicKey.toBase58());
  check('relayed proof verifies', (await chain.verifyDocument(rpc, h2, { signer: bob.publicKey })).status === 'VERIFIED');
}

// 4) çok imzalı sözleşme: PENDING -> VERIFIED, kurallar, dataSize ile ayrışan aramalar
{
  const [p1, p2, p3] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  for (const k of [p2, p3]) await fund(k);
  const sg = (kp) => ({ publicKey: kp.publicKey, keypair: kp });
  const text = `e2e agreement ${Date.now()}`;
  const ah = await hashOf(text);
  await fund(p1);
  const created = await rpc.createAgreement({ signer: sg(p1), hashHex: ah, signers: [p1.publicKey, p2.publicKey, p3.publicKey] });
  check('create_agreement: creator counts as signed', created.agreement.signed_count === 1 && !created.agreement.complete);
  check('verify is PENDING', (await chain.verifyDocument(rpc, ah, { pda: created.agreement_pda })).status === 'PENDING');
  let outsider = false;
  try { await rpc.coSign({ signer: sg(Keypair.generate()), agreementPda: created.agreement_pda }); } catch { outsider = true; }
  check('non-party cannot co_sign (rejected by program)', outsider);
  await rpc.coSign({ signer: sg(p2), agreementPda: created.agreement_pda });
  let twice = false;
  try { await rpc.coSign({ signer: sg(p2), agreementPda: created.agreement_pda }); } catch { twice = true; }
  check('second signature by the same party rejected', twice);
  await rpc.coSign({ signer: sg(p3), agreementPda: created.agreement_pda });
  for (const [label, opts] of [['pda', { pda: created.agreement_pda }], ['creator', { signer: p1.publicKey }], ['hash search', {}]]) {
    check(`agreement VERIFIED by ${label}`, (await chain.verifyDocument(rpc, ah, opts)).status === 'VERIFIED');
  }
  check('agreement changed file -> INVALID', (await chain.verifyDocument(rpc, await hashOf('x'), { pda: created.agreement_pda })).status === 'INVALID');
  check('list agreements for a party', (await rpc.listAgreementsFor(p3.publicKey)).some((x) => x.agreement_pda === created.agreement_pda));
  check('proof lookups ignore agreement accounts', (await rpc.findByHash(ah)).length === 0);
  if (RELAY_URL) {
    const [q1, q2] = [Keypair.generate(), Keypair.generate()]; // SOL'ü yok
    const rh = await hashOf(`relayed agreement ${Date.now()}`);
    const rc = await rpc.createAgreement({ signer: sg(q1), hashHex: rh, signers: [q1.publicKey, q2.publicKey], relay: RELAY_URL });
    await rpc.coSign({ signer: sg(q2), agreementPda: rc.agreement_pda, relay: RELAY_URL });
    check('relayed agreement completes (parties have 0 SOL)', (await chain.verifyDocument(rpc, rh, { pda: rc.agreement_pda })).status === 'VERIFIED');
  }
}

// 4) kimlik beyanı ve iptal (CONTRACT.md 4a): doğrudan ve (RELAY_URL varsa) kullanıcının SOL'ü olmadan
{
  const sg = (kp) => ({ publicKey: kp.publicKey, keypair: kp });
  const [person, issuer, other] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await Promise.all([fund(person), fund(issuer), fund(other)]);
  const trust = { [issuer.publicKey.toBase58()]: { label: 'E2E Issuer' } };
  const p = person.publicKey.toBase58();
  const doc = await hashOf(`identity e2e ${Date.now()}`);
  const rec = await rpc.notarize({ signer: sg(person), hashHex: doc });

  check('identity starts as none', (await chain.resolveIdentity(rpc, p, trust)).level === 'none');
  await rpc.attestIdentity({ signer: sg(person), subject: person.publicKey, label: 'Ahmet', evidence: 'self' });
  check('self attestation is self_declared', (await chain.resolveIdentity(rpc, p, trust)).level === 'self_declared');
  await rpc.attestIdentity({ signer: sg(issuer), subject: person.publicKey, label: 'Ahmet Yilmaz', evidence: 'kyc', expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  const id = await chain.resolveIdentity(rpc, p, trust);
  check('issuer attestation is trusted', id.level === 'trusted' && id.label === 'Ahmet Yilmaz' && id.best.issuer_label === 'E2E Issuer');
  check('unlisted issuer is unrecognized', (await chain.resolveIdentity(rpc, p, {})).level === 'unrecognized_issuer');
  const v = await chain.verifyDocument(rpc, doc, { pda: rec.proof_pda, trust });
  check('verify carries the signer identity', v.status === 'VERIFIED' && v.identity.level === 'trusted');

  let badLabel = false;
  try { await rpc.attestIdentity({ signer: sg(person), subject: person.publicKey, label: 'x'.repeat(33) }); } catch { badLabel = true; }
  check('over-long label rejected', badLabel);
  let thief = false;
  try { await rpc.revokeProof({ signer: sg(other), proofPda: rec.proof_pda }); } catch { thief = true; }
  check('only the signer can revoke a proof (rejected by program)', thief);

  await rpc.revokeAttestation({ signer: sg(issuer), subject: person.publicKey });
  check('revoked attestation falls back to self_declared', (await chain.resolveIdentity(rpc, p, trust)).level === 'self_declared');
  await rpc.revokeProof({ signer: sg(person), proofPda: rec.proof_pda });
  const rv = await chain.verifyDocument(rpc, doc, { pda: rec.proof_pda, trust });
  check('revoked proof -> REVOKED', rv.status === 'REVOKED' && rv.revocation.signer === p);
  check('changed file still INVALID after revoke', (await chain.verifyDocument(rpc, await hashOf('zzz'), { pda: rec.proof_pda })).status === 'INVALID');
  let again = false;
  try { await rpc.revokeProof({ signer: sg(person), proofPda: rec.proof_pda }); } catch { again = true; }
  check('second revoke rejected', again);

  if (RELAY_URL) {
    const [a, b] = [Keypair.generate(), Keypair.generate()]; // SOL'ü yok
    const rd = await hashOf(`identity relayed ${Date.now()}`);
    await rpc.attestIdentity({ signer: sg(a), subject: a.publicKey, label: 'Relayed', evidence: 'x', relay: RELAY_URL });
    const rr = await rpc.notarize({ signer: sg(a), hashHex: rd, relay: RELAY_URL });
    await rpc.attestIdentity({ signer: sg(b), subject: a.publicKey, label: 'Relayed Person', evidence: 'y', relay: RELAY_URL });
    await rpc.revokeProof({ signer: sg(a), proofPda: rr.proof_pda, relay: RELAY_URL });
    await rpc.revokeAttestation({ signer: sg(b), subject: a.publicKey, relay: RELAY_URL });
    check('relayed identity + revoke work (users have 0 SOL)', (await chain.verifyDocument(rpc, rd, { pda: rr.proof_pda })).status === 'REVOKED'
      && (await conn.getBalance(a.publicKey)) === 0 && (await conn.getBalance(b.publicKey)) === 0);
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);

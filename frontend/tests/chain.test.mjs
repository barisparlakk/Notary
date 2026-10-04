// node --test: docs/test_vectors_v2.json (Python ile üretilen golden vektörler) ile uyum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as chain from '../src/lib/chain.js';

const V = JSON.parse(readFileSync(new URL('../../docs/test_vectors_v2.json', import.meta.url)));
const hex = (b) => Buffer.from(b).toString('hex');

test('sabitler vektörle aynı', () => {
  assert.equal(hex(chain.NOTARIZE_DISC), V.notarize_discriminator_hex);
  assert.equal(hex(chain.PROOF_DISC), V.proof_account_discriminator_hex);
  assert.equal(chain.SIGNER_OFFSET, V.memcmp_offsets.signer);
  assert.equal(chain.HASH_OFFSET, V.memcmp_offsets.document_hash);
  assert.equal(chain.ACCOUNT_SIZE, V.account_size_max_parents);
});

test('SHA-256 ve PDA vektörü', async () => {
  const h = await chain.sha256Hex(V.file_content_ascii);
  assert.equal(h, V.document_hash);
  const kp = Keypair.fromSeed(Buffer.from(V.signer_seed_hex, 'hex'));
  assert.equal(kp.publicKey.toBase58(), V.signer);
  const [pda, bump] = chain.deriveProofPda(V.program_id, kp.publicKey, chain.hexToBytes(h));
  assert.equal(pda.toBase58(), V.proof_pda);
  assert.equal(bump, V.bump);
});

test('talimat verisi golden ile bayt bayt aynı', () => {
  const h = chain.hexToBytes(V.document_hash);
  const parent = chain.hexToBytes(V.parent_document_hash);
  assert.equal(hex(chain.encodeNotarizeData(h, V.receiver, [parent])), V.golden.notarize_data_receiver_one_parent_hex);
  assert.equal(hex(chain.encodeNotarizeData(h, null, [])), V.golden.notarize_data_no_receiver_no_parents_hex);
  assert.throws(() => chain.encodeNotarizeData(h, null, Array(5).fill(parent)), /en fazla 4/);
});

test('hesap çözümleme golden (Some ve None receiver, dolgu yok sayılır)', () => {
  const full = chain.decodeProof(Buffer.from(V.golden.proof_account_receiver_one_parent_hex, 'hex'));
  assert.deepEqual(
    [full.receiver, full.parents, full.created_at, full.created_at_iso, full.bump],
    [V.receiver, [V.parent_document_hash], V.golden.created_at_unix, V.golden.created_at_iso, V.bump]
  );
  const bare = chain.decodeProof(Buffer.from(V.golden.proof_account_no_receiver_no_parents_hex, 'hex'));
  assert.deepEqual([bare.receiver, bare.parents, bare.created_at, bare.bump], [null, [], V.golden.created_at_unix, V.bump]);
  assert.throws(() => chain.decodeProof(Buffer.alloc(247)), /discriminator/);
});

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('MockChain: kaydet, doğrula (3 mod), değiştirilmiş dosya, tekrar, provenance', async () => {
  const mock = new chain.MockChain(V.program_id, memStorage());
  const a = chain.newDemoSigner();
  const doc = new TextEncoder().encode('contract v1');
  const h = await chain.sha256Hex(doc);
  const out = await mock.notarize({ signer: a, hashHex: h });

  for (const opts of [{ pda: out.proof_pda }, { signer: a.publicKey }, {}]) {
    assert.equal((await chain.verifyDocument(mock, h, opts)).status, 'VERIFIED');
  }
  const bad = await chain.sha256Hex(new TextEncoder().encode('contract v1!'));
  const withPda = await chain.verifyDocument(mock, bad, { pda: out.proof_pda });
  assert.equal(withPda.status, 'INVALID');
  assert.equal(withPda.original_hash, h);
  assert.equal((await chain.verifyDocument(mock, bad, { signer: a.publicKey })).status, 'NOT_FOUND');

  await assert.rejects(mock.notarize({ signer: a, hashHex: h }), /already in use/);

  const b = chain.newDemoSigner();
  const mid = await mock.notarize({ signer: b, hashHex: await chain.sha256Hex('analysis'), parents: [h] });
  const top = await mock.notarize({ signer: a, hashHex: await chain.sha256Hex('decision'), parents: [await chain.sha256Hex('analysis')] });
  const nodes = await chain.lineage(mock, top.proof_pda);
  assert.deepEqual(nodes.map((n) => n.document_hash), [h, await chain.sha256Hex('analysis')]);
  assert.ok(mid.proof_pda);
});

test('sertifika alanları', () => {
  const proof = chain.decodeProof(Buffer.from(V.golden.proof_account_no_receiver_no_parents_hex, 'hex'));
  const c = chain.buildCertificate({ proofPda: V.proof_pda, proof, txSignature: 'sig', programId: V.program_id, verifyUrl: 'x' });
  assert.equal(c.version, 'notary.cert.v1');
  assert.equal(c.explorer_url, `https://explorer.solana.com/address/${V.proof_pda}?cluster=devnet`);
  assert.equal(c.created_at, '2026-10-03T18:30:00Z');
});


test('relay yolu: ücret ödeyen relayer, signer imzalı, backend\'e doğru gövde gider', async () => {
  const { Transaction, Keypair: Kp } = await import('@solana/web3.js');
  const relayer = Kp.generate();
  const signer = Kp.generate();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/relay/info')) return { ok: true, json: async () => ({ enabled: true, relayer_pubkey: relayer.publicKey.toBase58() }) };
    return { ok: true, json: async () => ({ tx_signature: 'SIG', proof_pda: 'x' }) };
  };
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111' }),
    getAccountInfo: async () => null,
  };
  const rpc = new chain.RpcChain(connection, V.program_id);
  const h = await chain.sha256Hex('relay doc');
  const out = await rpc.notarize({ signer: { publicKey: signer.publicKey, keypair: signer }, hashHex: h, relay: 'https://api.test' });
  assert.equal(out.relayed, true);
  assert.equal(out.tx_signature, 'SIG');
  const body = JSON.parse(calls[1].init.body);
  const tx = Transaction.from(Buffer.from(body.tx_base64, 'base64'));
  assert.equal(tx.feePayer.toBase58(), relayer.publicKey.toBase58());
  assert.equal(tx.instructions.length, 1);
  const keys = tx.instructions[0].keys;
  assert.equal(keys[0].pubkey.toBase58(), signer.publicKey.toBase58());   // signer
  assert.equal(keys[1].pubkey.toBase58(), relayer.publicKey.toBase58());  // payer = relayer
  assert.ok(tx.signatures.find((s) => s.publicKey.equals(signer.publicKey)).signature, 'signer imzası var');
  assert.equal(tx.signatures.find((s) => s.publicKey.equals(relayer.publicKey)).signature, null, 'relayer imzası backend ekler');
  assert.ok(tx.instructions[0].data.subarray(0, 8).equals(chain.NOTARIZE_DISC));
});

test('relay kapalıysa anlaşılır hata', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ enabled: false }) });
  const rpc = new chain.RpcChain({}, V.program_id);
  await assert.rejects(rpc.notarize({ signer: chain.newDemoSigner(), hashHex: 'ab'.repeat(32), relay: 'https://api.test' }), /not configured/);
});

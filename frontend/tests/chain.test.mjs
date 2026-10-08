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

// ---------------------------------------------------------------- çok imzalı sözleşme
const AG = V.agreement;

test('sözleşme sabitleri ve PDA vektörle aynı', () => {
  assert.equal(hex(chain.CREATE_AGREEMENT_DISC), AG.create_agreement_discriminator_hex);
  assert.equal(hex(chain.CO_SIGN_DISC), AG.co_sign_discriminator_hex);
  assert.equal(hex(chain.AGREEMENT_DISC), AG.account_discriminator_hex);
  assert.equal(chain.AGREEMENT_SIZE, AG.account_size);
  assert.equal(chain.AGREEMENT_PARTY_OFFSET, AG.party_offset);
  const [pda, bump] = chain.deriveAgreementPda(V.program_id, AG.creator, chain.hexToBytes(V.document_hash));
  assert.equal(pda.toBase58(), AG.agreement_pda);
  assert.equal(bump, AG.bump);
});

test('create_agreement verisi golden ile bayt bayt aynı, sınırlar denetlenir', () => {
  const h = chain.hexToBytes(V.document_hash);
  assert.equal(hex(chain.encodeCreateAgreementData(h, AG.parties)), AG.create_agreement_data_hex);
  assert.throws(() => chain.encodeCreateAgreementData(h, [AG.parties[0]]), /2 ile 4/);
  assert.throws(() => chain.encodeCreateAgreementData(h, [AG.parties[0], AG.parties[0]]), /tekrar/);
});

test('Agreement hesabı golden: yalnızca oluşturan imzalı / hepsi imzalı', () => {
  const part = chain.decodeAgreement(Buffer.from(AG.account_creator_signed_hex, 'hex'));
  assert.deepEqual([part.signed_count, part.complete, part.creator], [1, false, AG.creator]);
  assert.equal(part.parties[1].signed_at, 0);
  const full = chain.decodeAgreement(Buffer.from(AG.account_all_signed_hex, 'hex'));
  assert.equal(full.complete, true);
  assert.deepEqual(full.parties.map((p) => p.signer), AG.parties);
  assert.equal(full.parties[2].signed_at, AG.created_at_unix + 120);
  assert.equal(full.bump, AG.bump);
  assert.throws(() => chain.decodeAgreement(Buffer.from(V.golden.proof_account_receiver_one_parent_hex, 'hex')), /discriminator/);
});

test('MockChain: sözleşme yaşam döngüsü PENDING -> VERIFIED, kurallar', async () => {
  const mock = new chain.MockChain(V.program_id, memStorage());
  const [a, b, c, outsider] = [1, 2, 3, 4].map(() => chain.newDemoSigner());
  const text = new TextEncoder().encode('contract with three parties');
  const h = await chain.sha256Hex(text);
  const parties = [a, b, c].map((x) => x.publicKey);

  await assert.rejects(mock.createAgreement({ signer: a, hashHex: h, signers: [b.publicKey, c.publicKey] }), /CreatorNotParty/);
  const out = await mock.createAgreement({ signer: a, hashHex: h, signers: parties });
  assert.equal(out.agreement.signed_count, 1);
  await assert.rejects(mock.createAgreement({ signer: a, hashHex: h, signers: parties }), /already in use/);

  assert.equal((await chain.verifyDocument(mock, h, { pda: out.agreement_pda })).status, 'PENDING');
  await assert.rejects(mock.coSign({ signer: outsider, agreementPda: out.agreement_pda }), /NotAParty/);
  await mock.coSign({ signer: b, agreementPda: out.agreement_pda });
  await assert.rejects(mock.coSign({ signer: b, agreementPda: out.agreement_pda }), /AlreadySigned/);
  assert.equal((await chain.verifyDocument(mock, h, { signer: a.publicKey })).status, 'PENDING');
  await mock.coSign({ signer: c, agreementPda: out.agreement_pda });

  const done = await chain.verifyDocument(mock, h, { pda: out.agreement_pda });
  assert.equal(done.status, 'VERIFIED');
  assert.equal(done.agreement.signed_count, 3);
  assert.equal((await chain.verifyDocument(mock, h, { signer: a.publicKey })).status, 'VERIFIED');
  assert.equal((await chain.verifyDocument(mock, h)).status, 'VERIFIED'); // hash araması
  assert.equal((await chain.verifyDocument(mock, await chain.sha256Hex('changed'), { pda: out.agreement_pda })).status, 'INVALID');
  assert.equal((await mock.listAgreementsFor(c.publicKey)).length, 1);
});

test('RpcChain.listAgreementsFor 4 taraf sırası için dataSize + memcmp sorgular ve birleştirir', async () => {
  const party = new PublicKey(AG.parties[1]);
  const full = Buffer.from(AG.account_all_signed_hex, 'hex');
  const calls = [];
  const connection = {
    getProgramAccounts: async (_prog, { filters }) => {
      calls.push(filters);
      // yalnızca 2. taraf ofsetinde (85 + 32) eşleşme döner
      return filters[1].memcmp.offset === 85 + 32 ? [{ pubkey: new PublicKey(AG.agreement_pda), account: { data: full } }] : [];
    },
  };
  const rpc = new chain.RpcChain(connection, V.program_id);
  const list = await rpc.listAgreementsFor(party);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((f) => f[1].memcmp.offset), [85, 117, 149, 181]);
  assert.ok(calls.every((f) => f[0].dataSize === 250));
  assert.equal(list.length, 1);
  assert.equal(list[0].agreement_pda, AG.agreement_pda);
});

test('relay yolu: create_agreement ve co_sign ücret ödeyen relayer ile kurulur', async () => {
  const { Transaction, Keypair: Kp } = await import('@solana/web3.js');
  const relayer = Kp.generate();
  const [alice, bob] = [Kp.generate(), Kp.generate()];
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/relay/info')) return { ok: true, json: async () => ({ enabled: true, relayer_pubkey: relayer.publicKey.toBase58() }) };
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ tx_signature: 'SIG' }) };
  };
  const connection = { getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111' }), getAccountInfo: async () => null };
  const rpc = new chain.RpcChain(connection, V.program_id);
  const h = await chain.sha256Hex('relayed agreement');
  await rpc.createAgreement({ signer: { publicKey: alice.publicKey, keypair: alice }, hashHex: h, signers: [alice.publicKey, bob.publicKey], relay: 'https://api.test' });
  const [pda] = chain.deriveAgreementPda(V.program_id, alice.publicKey, chain.hexToBytes(h));
  await rpc.coSign({ signer: { publicKey: bob.publicKey, keypair: bob }, agreementPda: pda, relay: 'https://api.test' });

  const create = Transaction.from(Buffer.from(bodies[0].tx_base64, 'base64'));
  assert.equal(create.feePayer.toBase58(), relayer.publicKey.toBase58());
  assert.ok(create.instructions[0].data.subarray(0, 8).equals(chain.CREATE_AGREEMENT_DISC));
  assert.equal(create.instructions[0].keys[1].pubkey.toBase58(), relayer.publicKey.toBase58()); // payer = relayer

  const sign = Transaction.from(Buffer.from(bodies[1].tx_base64, 'base64'));
  assert.equal(sign.feePayer.toBase58(), relayer.publicKey.toBase58());
  assert.deepEqual(sign.instructions[0].data, chain.CO_SIGN_DISC);
  assert.equal(sign.instructions[0].keys.length, 2);
  assert.ok(sign.signatures.find((x) => x.publicKey.equals(bob.publicKey)).signature);
});

test('relayer bakiyesi bitmişse anlaşılır hata', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ enabled: false, low_balance: true }) });
  const rpc = new chain.RpcChain({}, V.program_id);
  await assert.rejects(rpc.notarize({ signer: chain.newDemoSigner(), hashHex: 'ab'.repeat(32), relay: 'https://api.test' }), /out of funds/);
});

// ---------------------------------------------------------------- PDF sertifika ve hukuki not
test('sertifikalar hukuki notu taşır', () => {
  const proof = chain.decodeProof(Buffer.from(V.golden.proof_account_no_receiver_no_parents_hex, 'hex'));
  const c = chain.buildCertificate({ proofPda: V.proof_pda, proof, txSignature: 'sig', programId: V.program_id, verifyUrl: 'x' });
  assert.match(c.notice, /Not a qualified electronic signature/);
  const ag = chain.decodeAgreement(Buffer.from(V.agreement.account_all_signed_hex, 'hex'));
  const a = chain.buildAgreementCertificate({ agreementPda: V.agreement.agreement_pda, agreement: ag, txSignature: null, programId: V.program_id, verifyUrl: 'y' });
  assert.equal(a.version, 'notary.agreement.v1');
  assert.equal(a.complete, true);
  assert.equal(a.parties.length, 3);
  assert.match(a.notice, /eIDAS/);
});

test('PDF sertifika: geçerli bir PDF üretir (kayıt ve sözleşme)', async () => {
  const { buildCertificatePdf } = await import('../src/lib/certificatePdf.js');
  const proof = chain.decodeProof(Buffer.from(V.golden.proof_account_receiver_one_parent_hex, 'hex'));
  const cert = chain.buildCertificate({ proofPda: V.proof_pda, proof, txSignature: 'sig', programId: V.program_id, verifyUrl: 'https://example.test/?pda=1' });
  const ag = chain.decodeAgreement(Buffer.from(V.agreement.account_creator_signed_hex, 'hex'));
  const agCert = chain.buildAgreementCertificate({ agreementPda: V.agreement.agreement_pda, agreement: ag, txSignature: 'sig', programId: V.program_id, verifyUrl: 'https://example.test/?pda=2' });
  for (const c of [cert, agCert]) {
    const blob = await buildCertificatePdf(c);
    const bytes = Buffer.from(await blob.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 4000, 'QR görseli ve metin içerir');
  }
});

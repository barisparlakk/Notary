// Notary v2 zincir katmanı (CONTRACT.md v2): PDA türetme, talimat/hesap biçimi, API'siz doğrulama.
// RpcChain gerçek Solana RPC'sine, MockChain tarayıcı içi DEMO moduna bağlanır; ikisi aynı arayüzü sunar.
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const MAX_PARENTS = 4;
export const SIGNER_OFFSET = 9;
export const HASH_OFFSET = 41;
export const ACCOUNT_SIZE = 247;
export const MAX_PARTIES = 4;
export const AGREEMENT_SIZE = 250;
export const AGREEMENT_PARTY_OFFSET = 85; // i. taraf = 85 + 32 * i

// sha256("global:notarize")[..8] ve sha256("account:Proof")[..8] (docs/test_vectors_v2.json ile doğrulanır)
export const NOTARIZE_DISC = Buffer.from('e95e35ee426e4a32', 'hex');
export const PROOF_DISC = Buffer.from('a3230d470f803f52', 'hex');
// sha256("global:create_agreement"), sha256("global:co_sign"), sha256("account:Agreement") ilk 8 bayt (test vektörüyle doğrulanır)
export const CREATE_AGREEMENT_DISC = Buffer.from('dc9c41acfc444ae9', 'hex');
export const CO_SIGN_DISC = Buffer.from('b9e20c8538442013', 'hex');
export const AGREEMENT_DISC = Buffer.from('53d4056ee1f9c554', 'hex');

export class ChainError extends Error {}

// ------------------------------------------------------------------ yardımcılar
export const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
export const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

export async function sha256Bytes(input) {
  let buf;
  if (typeof input === 'string') buf = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) buf = input;
  else if (input instanceof ArrayBuffer) buf = new Uint8Array(input);
  else buf = new Uint8Array(await input.arrayBuffer()); // File / Blob
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));
}

export async function sha256Hex(input) {
  return bytesToHex(await sha256Bytes(input));
}

const pk = (v) => (v instanceof PublicKey ? v : new PublicKey(v));

// ------------------------------------------------------------------ PDA ve biçim
/** seeds = ["proof", signer, document_hash] -> [PublicKey, bump] */
export function deriveProofPda(programId, signer, documentHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), pk(signer).toBuffer(), Buffer.from(documentHash)],
    pk(programId)
  );
}

export function encodeNotarizeData(documentHash, receiver = null, parents = []) {
  if (documentHash.length !== 32) throw new ChainError('document_hash 32 bayt olmalı');
  if (parents.length > MAX_PARENTS) throw new ChainError(`en fazla ${MAX_PARENTS} üst belge`);
  const parts = [NOTARIZE_DISC, Buffer.from(documentHash)];
  parts.push(receiver ? Buffer.concat([Buffer.from([1]), pk(receiver).toBuffer()]) : Buffer.from([0]));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(parents.length);
  parts.push(len, ...parents.map((p) => Buffer.from(p)));
  return Buffer.concat(parts);
}

export function decodeProof(data) {
  const buf = Buffer.from(data);
  if (!buf.subarray(0, 8).equals(PROOF_DISC)) throw new ChainError('Proof discriminator uyuşmuyor');
  let o = 8;
  const version = buf[o]; o += 1;
  const signer = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const documentHash = buf.subarray(o, o + 32); o += 32;
  let receiver = null;
  if (buf[o] === 1) { receiver = new PublicKey(buf.subarray(o + 1, o + 33)); o += 33; } else { o += 1; }
  const createdAt = Number(buf.readBigInt64LE(o)); o += 8;
  const n = buf.readUInt32LE(o); o += 4;
  const parents = [];
  for (let i = 0; i < n; i++) parents.push(bytesToHex(buf.subarray(o + 32 * i, o + 32 * (i + 1))));
  o += 32 * n;
  return {
    version,
    signer: signer.toBase58(),
    document_hash: bytesToHex(documentHash),
    receiver: receiver ? receiver.toBase58() : null,
    created_at: createdAt,
    created_at_iso: new Date(createdAt * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    parents,
    bump: buf[o],
  };
}

export function buildNotarizeInstruction({ programId, signer, payer, documentHash, receiver = null, parents = [] }) {
  const [proof] = deriveProofPda(programId, signer, documentHash);
  return new TransactionInstruction({
    programId: pk(programId),
    keys: [
      { pubkey: pk(signer), isSigner: true, isWritable: false },
      { pubkey: pk(payer), isSigner: true, isWritable: true },
      { pubkey: proof, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeNotarizeData(documentHash, receiver, parents),
  });
}

export function deriveAgreementPda(programId, creator, documentHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agreement'), pk(creator).toBuffer(), Buffer.from(documentHash)],
    pk(programId)
  );
}

export function encodeCreateAgreementData(documentHash, signers) {
  if (documentHash.length !== 32) throw new ChainError('document_hash 32 bayt olmalı');
  if (signers.length < 2 || signers.length > MAX_PARTIES) throw new ChainError(`sözleşme 2 ile ${MAX_PARTIES} taraf içermeli`);
  const keys = signers.map((k) => pk(k).toBuffer());
  if (new Set(keys.map((k) => k.toString('hex'))).size !== keys.length) throw new ChainError('taraflar tekrar edemez');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(keys.length);
  return Buffer.concat([CREATE_AGREEMENT_DISC, Buffer.from(documentHash), len, ...keys]);
}

export function decodeAgreement(data) {
  const buf = Buffer.from(data);
  if (!buf.subarray(0, 8).equals(AGREEMENT_DISC)) throw new ChainError('Agreement discriminator uyuşmuyor');
  let o = 8;
  const version = buf[o]; o += 1;
  const creator = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const documentHash = buf.subarray(o, o + 32); o += 32;
  const createdAt = Number(buf.readBigInt64LE(o)); o += 8;
  const n = buf.readUInt32LE(o); o += 4;
  const signers = [];
  for (let i = 0; i < n; i++) signers.push(new PublicKey(buf.subarray(o + 32 * i, o + 32 * (i + 1))).toBase58());
  o += 32 * n;
  const m = buf.readUInt32LE(o); o += 4;
  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parties = signers.map((signer, i) => {
    const signedAt = i < m ? Number(buf.readBigInt64LE(o + 8 * i)) : 0;
    return { signer, signed_at: signedAt, signed_at_iso: signedAt ? iso(signedAt) : null };
  });
  o += 8 * m;
  const done = parties.filter((p) => p.signed_at).length;
  return {
    version,
    creator: creator.toBase58(),
    document_hash: bytesToHex(documentHash),
    created_at: createdAt,
    created_at_iso: iso(createdAt),
    parties,
    signed_count: done,
    complete: done === parties.length,
    bump: buf[o],
  };
}

export function buildCreateAgreementInstruction({ programId, creator, payer, documentHash, signers }) {
  const [agreement] = deriveAgreementPda(programId, creator, documentHash);
  return new TransactionInstruction({
    programId: pk(programId),
    keys: [
      { pubkey: pk(creator), isSigner: true, isWritable: false },
      { pubkey: pk(payer), isSigner: true, isWritable: true },
      { pubkey: agreement, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeCreateAgreementData(documentHash, signers),
  });
}

export function buildCoSignInstruction({ programId, signer, agreement }) {
  return new TransactionInstruction({
    programId: pk(programId),
    keys: [
      { pubkey: pk(signer), isSigner: true, isWritable: false },
      { pubkey: pk(agreement), isSigner: false, isWritable: true },
    ],
    data: CO_SIGN_DISC,
  });
}

export function buildCertificate({ proofPda, proof, txSignature, programId, cluster = 'devnet', verifyUrl }) {
  return {
    version: 'notary.cert.v1',
    cluster,
    program_id: pk(programId).toBase58(),
    proof_pda: String(proofPda),
    signer: proof.signer,
    document_hash: proof.document_hash,
    receiver: proof.receiver,
    created_at: proof.created_at_iso,
    tx_signature: txSignature || null,
    explorer_url: `https://explorer.solana.com/address/${proofPda}?cluster=${cluster}`,
    verify_url: verifyUrl || `${globalThis.location?.origin ?? ''}/?tab=verify&pda=${proofPda}`,
  };
}

export function buildAgreementCertificate({ agreementPda, agreement, txSignature, programId, cluster = 'devnet', verifyUrl }) {
  return {
    version: 'notary.agreement.v1',
    cluster,
    program_id: pk(programId).toBase58(),
    agreement_pda: String(agreementPda),
    creator: agreement.creator,
    document_hash: agreement.document_hash,
    created_at: agreement.created_at_iso,
    parties: agreement.parties.map((p) => ({ signer: p.signer, signed_at: p.signed_at_iso })),
    signed_count: agreement.signed_count,
    complete: agreement.complete,
    tx_signature: txSignature || null,
    explorer_url: `https://explorer.solana.com/address/${agreementPda}?cluster=${cluster}`,
    verify_url: verifyUrl || `${globalThis.location?.origin ?? ''}/?tab=verify&pda=${agreementPda}`,
  };
}

// ------------------------------------------------------------------ ortak doğrulama mantığı
/** Zincir arayüzü (getProof / findByHash) üstünde CONTRACT.md v2, Bölüm 4. */
function agreementResult(base, agreement, address, fileHash) {
  return {
    ...base,
    agreement,
    proof_pda: String(address),
    original_hash: agreement.document_hash,
    status: agreement.document_hash !== fileHash ? 'INVALID' : agreement.complete ? 'VERIFIED' : 'PENDING',
  };
}

/**
 * VERIFIED | PENDING (çok imzalı sözleşme, tüm taraflar henüz imzalamadı) | INVALID | NOT_FOUND.
 * Zincir arayüzü: getRecord(pda) -> {type:'proof'|'agreement', ...} | null, findByHash, findAgreementsByHash.
 */
export async function verifyDocument(chain, fileHash, { pda = null, signer = null } = {}) {
  const out = { status: 'NOT_FOUND', original_hash: '', received_hash: fileHash, proof_pda: null, proof: null };
  let address = pda;
  if (!address && signer) {
    address = deriveProofPda(chain.programId, signer, hexToBytes(fileHash))[0].toBase58();
    if (!(await chain.getRecord(address))) address = deriveAgreementPda(chain.programId, signer, hexToBytes(fileHash))[0].toBase58();
  }
  if (address) {
    const rec = await chain.getRecord(address);
    if (!rec) return out;
    if (rec.type === 'agreement') return agreementResult(out, rec.agreement, address, fileHash);
    return {
      ...out,
      proof: rec.proof,
      proof_pda: String(address),
      original_hash: rec.proof.document_hash,
      status: rec.proof.document_hash === fileHash ? 'VERIFIED' : 'INVALID',
    };
  }
  const found = await chain.findByHash(fileHash);
  if (found.length) {
    return { ...out, status: 'VERIFIED', proof: found[0], proof_pda: found[0].proof_pda, original_hash: fileHash, matches: found.length };
  }
  const agreements = await chain.findAgreementsByHash(fileHash);
  if (!agreements.length) return out;
  const best = agreements.find((x) => x.complete) || agreements[0];
  return { ...agreementResult(out, best, best.agreement_pda, fileHash), matches: agreements.length };
}

/** parents hash'lerini özyinelemeli çözer; kökler önce. */
export async function lineage(chain, pda) {
  const root = await chain.getProof(pda);
  if (!root) throw new ChainError(`${pda} bulunamadı`);
  const order = [];
  const seen = new Set();
  const visit = async (proof) => {
    for (const h of proof.parents) {
      if (seen.has(h)) continue;
      seen.add(h);
      const found = await chain.findByHash(h);
      if (!found.length) { order.push({ document_hash: h, proof_pda: null, missing: true, parents: [] }); continue; }
      await visit(found[0]);
      order.push(found[0]);
    }
  };
  await visit(root);
  return order;
}

// ------------------------------------------------------------------ gerçek RPC
export class RpcChain {
  /**
   * @param connection @solana/web3.js Connection (ya da aynı yöntemlere sahip nesne)
   * @param programId  PROGRAM_ID
   */
  constructor(connection, programId, { cluster = 'devnet' } = {}) {
    this.connection = connection;
    this.programId = pk(programId);
    this.cluster = cluster;
    this.isDemo = false;
  }

  async getRecord(pda) {
    const info = await this.connection.getAccountInfo(pk(pda));
    if (!info || !info.owner.equals(this.programId)) return null;
    const disc = Buffer.from(info.data).subarray(0, 8);
    if (disc.equals(PROOF_DISC)) return { type: 'proof', proof: decodeProof(info.data) };
    if (disc.equals(AGREEMENT_DISC)) return { type: 'agreement', agreement: decodeAgreement(info.data) };
    return null;
  }

  async getProof(pda) {
    const rec = await this.getRecord(pda);
    return rec?.type === 'proof' ? rec.proof : null;
  }

  async getAgreement(pda) {
    const rec = await this.getRecord(pda);
    return rec?.type === 'agreement' ? rec.agreement : null;
  }

  // Proof (247 bayt) ve Agreement (250 bayt) hash'i aynı ofsette tutar: hesap türünü dataSize ayırır.
  async _query(offset, bytes32, dataSize) {
    return this.connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize }, { memcmp: { offset, bytes: new PublicKey(Buffer.from(bytes32)).toBase58() } }],
    });
  }

  async _proofs(offset, bytes32) {
    const accounts = await this._query(offset, bytes32, ACCOUNT_SIZE);
    return accounts.map(({ pubkey, account }) => ({ ...decodeProof(account.data), proof_pda: pubkey.toBase58() }));
  }

  findByHash(hashHex) { return this._proofs(HASH_OFFSET, hexToBytes(hashHex)); }

  listBySigner(signer) { return this._proofs(SIGNER_OFFSET, pk(signer).toBytes()); }

  async findAgreementsByHash(hashHex) {
    const accounts = await this._query(HASH_OFFSET, hexToBytes(hashHex), AGREEMENT_SIZE);
    return accounts.map(({ pubkey, account }) => ({ ...decodeAgreement(account.data), agreement_pda: pubkey.toBase58() }));
  }

  /** Bir cüzdanın taraf olduğu sözleşmeler (4 olası taraf sırası için sorgu, birleşim). */
  async listAgreementsFor(party) {
    const seen = new Map();
    for (let i = 0; i < MAX_PARTIES; i++) {
      const accounts = await this._query(AGREEMENT_PARTY_OFFSET + 32 * i, pk(party).toBytes(), AGREEMENT_SIZE);
      for (const { pubkey, account } of accounts) {
        seen.set(pubkey.toBase58(), { ...decodeAgreement(account.data), agreement_pda: pubkey.toBase58() });
      }
    }
    return [...seen.values()];
  }

  async _confirm(signature, timeoutMs = 60000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const st = value[0];
      if (st?.err) throw new ChainError(`işlem başarısız: ${JSON.stringify(st.err)}`);
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new ChainError('işlem onaylanmadı (zaman aşımı)');
  }

  /**
   * Tek talimatlık işlemi imzalatıp gönderir. relay verilirse ücreti relayer öder (kullanıcının SOL'ü gerekmez).
   * @param signer  { publicKey, signTransaction?(tx), keypair? } cüzdan (wallet-adapter) ya da Keypair
   * @param buildIx (payerKey) => TransactionInstruction
   */
  async _submit({ signer, relay, buildIx }) {
    const signerKey = pk(signer.publicKey);
    let payerKey = signerKey;
    if (relay) {
      const info = await (await fetch(`${relay}/relay/info`)).json();
      if (info.low_balance) throw new ChainError('The relayer is out of funds. Try again later or pay the fee yourself.');
      if (!info.enabled) throw new ChainError('Relayer is not configured on this server');
      payerKey = new PublicKey(info.relayer_pubkey);
    }
    const { blockhash } = await this.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: payerKey, recentBlockhash: blockhash }).add(buildIx(payerKey));

    if (relay) {
      let partial;
      if (signer.keypair) { tx.partialSign(signer.keypair); partial = tx; } else { partial = await signer.signTransaction(tx); }
      const res = await fetch(`${relay}/relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_base64: partial.serialize({ requireAllSignatures: false }).toString('base64') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ChainError(body.detail || `relay failed (HTTP ${res.status})`);
      return { tx_signature: body.tx_signature, relayed: true };
    }
    let signature;
    if (signer.keypair) {
      tx.sign(signer.keypair);
      signature = await this.connection.sendRawTransaction(tx.serialize());
    } else {
      const signed = await signer.signTransaction(tx);
      signature = await this.connection.sendRawTransaction(signed.serialize());
    }
    await this._confirm(signature);
    return { tx_signature: signature };
  }

  async notarize({ signer, hashHex, receiver = null, parents = [], relay = null }) {
    const documentHash = hexToBytes(hashHex);
    const [proofPda] = deriveProofPda(this.programId, signer.publicKey, documentHash);
    const sent = await this._submit({
      signer, relay,
      buildIx: (payer) => buildNotarizeInstruction({
        programId: this.programId, signer: signer.publicKey, payer, documentHash, receiver, parents: parents.map(hexToBytes),
      }),
    });
    return { proof_pda: proofPda.toBase58(), ...sent, proof: await this.getProof(proofPda) };
  }

  /** Çok imzalı sözleşme açar; creator `signers` içinde olmalı ve oluştururken imzalamış sayılır. */
  async createAgreement({ signer, hashHex, signers, relay = null }) {
    const documentHash = hexToBytes(hashHex);
    const [agreementPda] = deriveAgreementPda(this.programId, signer.publicKey, documentHash);
    const sent = await this._submit({
      signer, relay,
      buildIx: (payer) => buildCreateAgreementInstruction({
        programId: this.programId, creator: signer.publicKey, payer, documentHash, signers,
      }),
    });
    return { agreement_pda: agreementPda.toBase58(), ...sent, agreement: await this.getAgreement(agreementPda) };
  }

  /** Sözleşmedeki kendi payını imzalar. */
  async coSign({ signer, agreementPda, relay = null }) {
    const sent = await this._submit({
      signer, relay,
      buildIx: () => buildCoSignInstruction({ programId: this.programId, signer: signer.publicKey, agreement: agreementPda }),
    });
    return { agreement_pda: String(agreementPda), ...sent, agreement: await this.getAgreement(agreementPda) };
  }
}

// ------------------------------------------------------------------ DEMO (tarayıcı içi, zincirde DEĞİL)
const MOCK_KEY = 'notary_demo_chain_v2';

/** Program/RPC yokken arayüzü denemek için. Her şey tarayıcıda; arayüzde "DEMO" etiketi zorunludur. */
export class MockChain {
  constructor(programId, storage = globalThis.localStorage) {
    this.programId = pk(programId);
    this.storage = storage;
    this.isDemo = true;
    this.cluster = 'demo';
  }

  _load() { try { return JSON.parse(this.storage?.getItem(MOCK_KEY) || '{}'); } catch { return {}; } }
  _save(db) { try { this.storage?.setItem(MOCK_KEY, JSON.stringify(db)); } catch { /* yoksay */ } }
  reset() { this._save({}); }

  async getRecord(pda) {
    const v = this._load()[String(pda)];
    if (!v) return null;
    return v.agreement ? { type: 'agreement', agreement: v.agreement } : { type: 'proof', proof: v.proof };
  }

  async getProof(pda) { return this._load()[String(pda)]?.proof ?? null; }

  async getAgreement(pda) { return this._load()[String(pda)]?.agreement ?? null; }

  async findByHash(hashHex) {
    return Object.entries(this._load()).filter(([, v]) => v.proof?.document_hash === hashHex)
      .map(([k, v]) => ({ ...v.proof, proof_pda: k }));
  }

  async findAgreementsByHash(hashHex) {
    return Object.entries(this._load()).filter(([, v]) => v.agreement?.document_hash === hashHex)
      .map(([k, v]) => ({ ...v.agreement, agreement_pda: k }));
  }

  async listBySigner(signer) {
    return Object.entries(this._load()).filter(([, v]) => v.proof?.signer === String(signer))
      .map(([k, v]) => ({ ...v.proof, proof_pda: k, tx_signature: v.tx_signature }));
  }

  async listAgreementsFor(party) {
    return Object.entries(this._load()).filter(([, v]) => v.agreement?.parties.some((p) => p.signer === String(party)))
      .map(([k, v]) => ({ ...v.agreement, agreement_pda: k, tx_signature: v.tx_signature }));
  }

  static _iso(t) { return new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  static _summarize(agreement) {
    const done = agreement.parties.filter((p) => p.signed_at).length;
    return { ...agreement, signed_count: done, complete: done === agreement.parties.length };
  }

  async notarize({ signer, hashHex, receiver = null, parents = [] /* relay yok sayılır */ }) {
    if (parents.length > MAX_PARENTS) throw new ChainError(`en fazla ${MAX_PARENTS} üst belge`);
    if (new Set(parents).size !== parents.length) throw new ChainError('DuplicateParent');
    const documentHash = hexToBytes(hashHex);
    const [pda, bump] = deriveProofPda(this.programId, signer.publicKey, documentHash);
    const db = this._load();
    if (db[pda.toBase58()]) throw new ChainError('account already in use (bu imzalayan bu belgeyi zaten kaydetti)');
    const now = Math.floor(Date.now() / 1000);
    const proof = {
      version: 1, signer: pk(signer.publicKey).toBase58(), document_hash: hashHex,
      receiver: receiver ? pk(receiver).toBase58() : null, created_at: now,
      created_at_iso: MockChain._iso(now), parents, bump,
    };
    const tx_signature = 'DEMO' + bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(30)));
    db[pda.toBase58()] = { proof, tx_signature };
    this._save(db);
    return { proof_pda: pda.toBase58(), tx_signature, proof };
  }

  async createAgreement({ signer, hashHex, signers }) {
    const keys = signers.map((k) => pk(k).toBase58());
    if (keys.length < 2 || keys.length > MAX_PARTIES) throw new ChainError(`sözleşme 2 ile ${MAX_PARTIES} taraf içermeli`);
    if (new Set(keys).size !== keys.length) throw new ChainError('DuplicateSigner');
    const creator = pk(signer.publicKey).toBase58();
    if (!keys.includes(creator)) throw new ChainError('CreatorNotParty: sözleşmeyi oluşturan taraflar arasında olmalı');
    const [pda, bump] = deriveAgreementPda(this.programId, creator, hexToBytes(hashHex));
    const db = this._load();
    if (db[pda.toBase58()]) throw new ChainError('account already in use (bu sözleşme zaten açılmış)');
    const now = Math.floor(Date.now() / 1000);
    const agreement = MockChain._summarize({
      version: 1, creator, document_hash: hashHex, created_at: now, created_at_iso: MockChain._iso(now), bump,
      parties: keys.map((k) => ({ signer: k, signed_at: k === creator ? now : 0, signed_at_iso: k === creator ? MockChain._iso(now) : null })),
    });
    const tx_signature = 'DEMO' + bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(30)));
    db[pda.toBase58()] = { agreement, tx_signature };
    this._save(db);
    return { agreement_pda: pda.toBase58(), tx_signature, agreement };
  }

  async coSign({ signer, agreementPda }) {
    const db = this._load();
    const entry = db[String(agreementPda)];
    if (!entry?.agreement) throw new ChainError('AccountNotInitialized: sözleşme bulunamadı');
    const me = pk(signer.publicKey).toBase58();
    const party = entry.agreement.parties.find((p) => p.signer === me);
    if (!party) throw new ChainError('NotAParty: bu hesap sözleşmenin tarafı değil');
    if (party.signed_at) throw new ChainError('AlreadySigned: bu taraf zaten imzaladı');
    const now = Math.floor(Date.now() / 1000);
    party.signed_at = now;
    party.signed_at_iso = MockChain._iso(now);
    entry.agreement = MockChain._summarize(entry.agreement);
    this._save(db);
    return { agreement_pda: String(agreementPda), tx_signature: 'DEMO' + bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(30))), agreement: entry.agreement };
  }
}

export function newDemoSigner() {
  const keypair = Keypair.generate();
  return { publicKey: keypair.publicKey, keypair };
}

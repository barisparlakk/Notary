// Notary v2 zincir katmanı (CONTRACT.md v2): PDA türetme, talimat/hesap biçimi, API'siz doğrulama.
// RpcChain gerçek Solana RPC'sine, MockChain tarayıcı içi DEMO moduna bağlanır; ikisi aynı arayüzü sunar.
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const MAX_PARENTS = 4;
export const SIGNER_OFFSET = 9;
export const HASH_OFFSET = 41;
export const ACCOUNT_SIZE = 247;

// sha256("global:notarize")[..8] ve sha256("account:Proof")[..8] (docs/test_vectors_v2.json ile doğrulanır)
export const NOTARIZE_DISC = Buffer.from('e95e35ee426e4a32', 'hex');
export const PROOF_DISC = Buffer.from('a3230d470f803f52', 'hex');

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

// ------------------------------------------------------------------ ortak doğrulama mantığı
/** Zincir arayüzü (getProof / findByHash) üstünde CONTRACT.md v2, Bölüm 4. */
export async function verifyDocument(chain, fileHash, { pda = null, signer = null } = {}) {
  const out = { status: 'NOT_FOUND', original_hash: '', received_hash: fileHash, proof_pda: null, proof: null };
  let address = pda;
  if (!address && signer) address = deriveProofPda(chain.programId, signer, hexToBytes(fileHash))[0].toBase58();
  if (address) {
    const proof = await chain.getProof(address);
    if (!proof) return out;
    return {
      ...out,
      proof,
      proof_pda: String(address),
      original_hash: proof.document_hash,
      status: proof.document_hash === fileHash ? 'VERIFIED' : 'INVALID',
    };
  }
  const found = await chain.findByHash(fileHash);
  if (!found.length) return out;
  return { ...out, status: 'VERIFIED', proof: found[0], proof_pda: found[0].proof_pda, original_hash: fileHash, matches: found.length };
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

  async getProof(pda) {
    const info = await this.connection.getAccountInfo(pk(pda));
    if (!info || !info.owner.equals(this.programId)) return null;
    return decodeProof(info.data);
  }

  async _byMemcmp(offset, bytes32) {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset, bytes: new PublicKey(Buffer.from(bytes32)).toBase58() } }],
    });
    return accounts.map(({ pubkey, account }) => ({ ...decodeProof(account.data), proof_pda: pubkey.toBase58() }));
  }

  findByHash(hashHex) { return this._byMemcmp(HASH_OFFSET, hexToBytes(hashHex)); }

  listBySigner(signer) { return this._byMemcmp(SIGNER_OFFSET, pk(signer).toBytes()); }

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
   * @param signer  { publicKey, signTransaction?(tx), keypair? } — cüzdan (wallet-adapter) ya da Keypair
   * @param relay   opsiyonel backend adresi: verilirse ücreti relayer öder (kullanıcının SOL'ü gerekmez)
   */
  async notarize({ signer, hashHex, receiver = null, parents = [], relay = null }) {
    const documentHash = hexToBytes(hashHex);
    const signerKey = pk(signer.publicKey);
    const parentBytes = parents.map(hexToBytes);
    const [proofPda] = deriveProofPda(this.programId, signerKey, documentHash);

    if (relay) {
      const info = await (await fetch(`${relay}/relay/info`)).json();
      if (!info.enabled) throw new ChainError('Relayer is not configured on this server');
      const relayerKey = new PublicKey(info.relayer_pubkey);
      const ix = buildNotarizeInstruction({
        programId: this.programId, signer: signerKey, payer: relayerKey, documentHash, receiver, parents: parentBytes,
      });
      const { blockhash } = await this.connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: relayerKey, recentBlockhash: blockhash }).add(ix);
      let partial;
      if (signer.keypair) { tx.partialSign(signer.keypair); partial = tx; } else { partial = await signer.signTransaction(tx); }
      const res = await fetch(`${relay}/relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_base64: partial.serialize({ requireAllSignatures: false }).toString('base64') }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ChainError(body.detail || `relay failed (HTTP ${res.status})`);
      return { proof_pda: proofPda.toBase58(), tx_signature: body.tx_signature, proof: await this.getProof(proofPda), relayed: true };
    }

    const ix = buildNotarizeInstruction({
      programId: this.programId, signer: signerKey, payer: signerKey, documentHash, receiver, parents: parentBytes,
    });
    const { blockhash } = await this.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signerKey, recentBlockhash: blockhash }).add(ix);
    let signature;
    if (signer.keypair) {
      tx.sign(signer.keypair);
      signature = await this.connection.sendRawTransaction(tx.serialize());
    } else {
      const signed = await signer.signTransaction(tx);
      signature = await this.connection.sendRawTransaction(signed.serialize());
    }
    await this._confirm(signature);
    return { proof_pda: proofPda.toBase58(), tx_signature: signature, proof: await this.getProof(proofPda) };
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

  async getProof(pda) { return this._load()[String(pda)]?.proof ?? null; }

  async findByHash(hashHex) {
    return Object.entries(this._load()).filter(([, v]) => v.proof.document_hash === hashHex)
      .map(([k, v]) => ({ ...v.proof, proof_pda: k }));
  }

  async listBySigner(signer) {
    return Object.entries(this._load()).filter(([, v]) => v.proof.signer === String(signer))
      .map(([k, v]) => ({ ...v.proof, proof_pda: k, tx_signature: v.tx_signature }));
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
      created_at_iso: new Date(now * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), parents, bump,
    };
    const tx_signature = 'DEMO' + bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(30)));
    db[pda.toBase58()] = { proof, tx_signature };
    this._save(db);
    return { proof_pda: pda.toBase58(), tx_signature, proof };
  }
}

export function newDemoSigner() {
  const keypair = Keypair.generate();
  return { publicKey: keypair.publicKey, keypair };
}

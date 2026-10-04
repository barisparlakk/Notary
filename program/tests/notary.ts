// Notary programı testleri (anchor test). docs/test_vectors_v2.json'daki PDA vektörü ayrıca doğrulanır.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { expect } from "chai";
import { Notary } from "../target/types/notary";

const sha = (s: string) => Array.from(createHash("sha256").update(s).digest());

describe("notary", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Notary as Program<Notary>;

  const pdaFor = (signer: PublicKey, hash: number[]) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), signer.toBuffer(), Buffer.from(hash)],
      program.programId
    )[0];

  async function notarize(signer: Keypair, hash: number[], receiver: PublicKey | null = null, parents: number[][] = []) {
    const proof = pdaFor(signer.publicKey, hash);
    await program.methods
      .notarize(hash, receiver, parents)
      .accounts({ signer: signer.publicKey, payer: provider.wallet.publicKey, proof, systemProgram: SystemProgram.programId })
      .signers([signer])
      .rpc();
    return proof;
  }

  it("kaydeder; zaman zincirden gelir", async () => {
    const signer = Keypair.generate();
    const hash = sha("doc-1");
    const proof = await notarize(signer, hash);
    const acc = await program.account.proof.fetch(proof);
    expect(acc.signer.toBase58()).to.eq(signer.publicKey.toBase58());
    expect(Buffer.from(acc.documentHash).toString("hex")).to.eq(Buffer.from(hash).toString("hex"));
    expect(Math.abs(acc.createdAt.toNumber() - Date.now() / 1000)).to.be.lessThan(120);
    expect(acc.version).to.eq(1);
  });

  it("aynı (signer, hash) ikinci kez kaydedilemez", async () => {
    const signer = Keypair.generate();
    const hash = sha("doc-2");
    await notarize(signer, hash);
    let failed = false;
    try { await notarize(signer, hash); } catch { failed = true; }
    expect(failed).to.eq(true);
  });

  it("aynı hash'i farklı imzalayanlar ayrı ayrı kaydedebilir", async () => {
    const hash = sha("doc-3");
    const a = await notarize(Keypair.generate(), hash);
    const b = await notarize(Keypair.generate(), hash);
    expect(a.toBase58()).to.not.eq(b.toBase58());
  });

  it("signer ve payer ayrı olabilir (relayer)", async () => {
    const signer = Keypair.generate();
    const proof = await notarize(signer, sha("doc-4"), Keypair.generate().publicKey);
    const acc = await program.account.proof.fetch(proof);
    expect(acc.receiver).to.not.eq(null);
  });

  it("parents: 4'e kadar, tekrarsız", async () => {
    const parents = [sha("p1"), sha("p2")];
    const proof = await notarize(Keypair.generate(), sha("doc-5"), null, parents);
    const acc = await program.account.proof.fetch(proof);
    expect(acc.parents.length).to.eq(2);

    let tooMany = false;
    try { await notarize(Keypair.generate(), sha("doc-6"), null, [1, 2, 3, 4, 5].map((i) => sha("p" + i))); } catch { tooMany = true; }
    expect(tooMany).to.eq(true);

    let dup = false;
    try { await notarize(Keypair.generate(), sha("doc-7"), null, [sha("x"), sha("x")]); } catch { dup = true; }
    expect(dup).to.eq(true);
  });

  it("docs/test_vectors_v2.json PDA vektörüyle aynı sonucu verir", () => {
    const v = require("../../docs/test_vectors_v2.json");
    const kp = Keypair.fromSeed(Buffer.from(v.signer_seed_hex, "hex"));
    expect(kp.publicKey.toBase58()).to.eq(v.signer);
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), kp.publicKey.toBuffer(), Buffer.from(v.document_hash, "hex")],
      new PublicKey(v.program_id)
    );
    expect(pda.toBase58()).to.eq(v.proof_pda);
    expect(bump).to.eq(v.bump);
  });
});

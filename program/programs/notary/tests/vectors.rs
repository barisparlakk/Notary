// CONTRACT.md Bölüm 8: Rust tarafı. docs/test_vectors_v2.json ile Python ve TypeScript'in ürettiğiyle aynı baytları üretmeli.
// Çalıştırma: cd program && cargo test
use anchor_lang::{AccountSerialize, Discriminator, InstructionData};
use notary::{instruction, Agreement, Proof};
use solana_pubkey::Pubkey;
use std::str::FromStr;

const VECTORS: &str = include_str!("../../../../docs/test_vectors_v2.json");

fn v() -> serde_json::Value {
    serde_json::from_str(VECTORS).unwrap()
}
fn s(val: &serde_json::Value, k: &str) -> String {
    val[k].as_str().unwrap_or_else(|| panic!("missing {k}")).to_string()
}
fn key(x: &str) -> Pubkey {
    Pubkey::from_str(x).unwrap()
}
fn hash32(x: &str) -> [u8; 32] {
    hex::decode(x).unwrap().try_into().unwrap()
}
fn padded(mut b: Vec<u8>, size: usize) -> Vec<u8> {
    b.resize(size, 0);
    b
}

#[test]
fn proof_pda_and_bump_match_vector() {
    let v = v();
    let (pda, bump) = Pubkey::find_program_address(
        &[b"proof", key(&s(&v, "signer")).as_ref(), &hash32(&s(&v, "document_hash"))],
        &key(&s(&v, "program_id")),
    );
    assert_eq!(pda.to_string(), s(&v, "proof_pda"));
    assert_eq!(bump as u64, v["bump"].as_u64().unwrap());
}

#[test]
fn discriminators_match_vector() {
    let v = v();
    assert_eq!(hex::encode(instruction::Notarize::DISCRIMINATOR), s(&v, "notarize_discriminator_hex"));
    assert_eq!(hex::encode(Proof::DISCRIMINATOR), s(&v, "proof_account_discriminator_hex"));
    let a = &v["agreement"];
    assert_eq!(hex::encode(instruction::CreateAgreement::DISCRIMINATOR), s(a, "create_agreement_discriminator_hex"));
    assert_eq!(hex::encode(instruction::CoSign::DISCRIMINATOR), s(a, "co_sign_discriminator_hex"));
    assert_eq!(hex::encode(Agreement::DISCRIMINATOR), s(a, "account_discriminator_hex"));
}

#[test]
fn notarize_instruction_data_matches_golden() {
    let v = v();
    let g = &v["golden"];
    let hash = hash32(&s(&v, "document_hash"));
    let with = instruction::Notarize {
        document_hash: hash,
        receiver: Some(key(&s(&v, "receiver"))),
        parents: vec![hash32(&s(&v, "parent_document_hash"))],
    };
    assert_eq!(hex::encode(with.data()), s(g, "notarize_data_receiver_one_parent_hex"));
    let without = instruction::Notarize { document_hash: hash, receiver: None, parents: vec![] };
    assert_eq!(hex::encode(without.data()), s(g, "notarize_data_no_receiver_no_parents_hex"));
}

#[test]
fn proof_account_bytes_match_golden() {
    let v = v();
    let g = &v["golden"];
    let (_, bump) = Pubkey::find_program_address(
        &[b"proof", key(&s(&v, "signer")).as_ref(), &hash32(&s(&v, "document_hash"))],
        &key(&s(&v, "program_id")),
    );
    let created_at = g["created_at_unix"].as_i64().unwrap();
    let full = Proof {
        version: 1,
        signer: key(&s(&v, "signer")),
        document_hash: hash32(&s(&v, "document_hash")),
        receiver: Some(key(&s(&v, "receiver"))),
        created_at,
        parents: vec![hash32(&s(&v, "parent_document_hash"))],
        bump,
    };
    let mut buf = Vec::new();
    full.try_serialize(&mut buf).unwrap();
    assert_eq!(hex::encode(padded(buf, Proof::SPACE)), s(g, "proof_account_receiver_one_parent_hex"));

    let bare = Proof { receiver: None, parents: vec![], ..full };
    let mut buf = Vec::new();
    bare.try_serialize(&mut buf).unwrap();
    assert_eq!(hex::encode(padded(buf, Proof::SPACE)), s(g, "proof_account_no_receiver_no_parents_hex"));
    assert_eq!(Proof::SPACE as u64, v["account_size_proof"].as_u64().unwrap());
}

#[test]
fn memcmp_offsets_match_layout() {
    let v = v();
    let g = &v["golden"];
    let raw = hex::decode(s(g, "proof_account_receiver_one_parent_hex")).unwrap();
    let off = &v["memcmp_offsets"];
    let so = off["signer"].as_u64().unwrap() as usize;
    let ho = off["document_hash"].as_u64().unwrap() as usize;
    assert_eq!(&raw[so..so + 32], key(&s(&v, "signer")).as_ref());
    assert_eq!(&raw[ho..ho + 32], &hash32(&s(&v, "document_hash")));
}

#[test]
fn agreement_pda_and_data_match_vector() {
    let v = v();
    let a = &v["agreement"];
    let hash = hash32(&s(&v, "document_hash"));
    let (pda, bump) = Pubkey::find_program_address(
        &[b"agreement", key(&s(a, "creator")).as_ref(), &hash],
        &key(&s(&v, "program_id")),
    );
    assert_eq!(pda.to_string(), s(a, "agreement_pda"));
    assert_eq!(bump as u64, a["bump"].as_u64().unwrap());

    let parties: Vec<Pubkey> = a["parties"].as_array().unwrap().iter().map(|p| key(p.as_str().unwrap())).collect();
    let data = instruction::CreateAgreement { document_hash: hash, signers: parties }.data();
    assert_eq!(hex::encode(data), s(a, "create_agreement_data_hex"));
    assert_eq!(Agreement::SPACE as u64, a["account_size"].as_u64().unwrap());
}

// ---------------------------------------------------------------- kimlik beyanı ve iptal (CONTRACT.md 4a)
use notary::{Attestation, Revocation};

fn attestation(v: &serde_json::Value, revoked_at: i64) -> Attestation {
    let i = &v["identity"];
    let (_, bump) = Pubkey::find_program_address(
        &[b"attest", key(&s(i, "issuer")).as_ref(), key(&s(i, "subject")).as_ref()],
        &key(&s(v, "program_id")),
    );
    Attestation {
        version: 1,
        issuer: key(&s(i, "issuer")),
        subject: key(&s(i, "subject")),
        label: s(i, "label"),
        claim_hash: hash32(&s(i, "claim_hash")),
        created_at: i["created_at_unix"].as_i64().unwrap(),
        expires_at: i["expires_at_unix"].as_i64().unwrap(),
        revoked_at,
        bump,
    }
}

#[test]
fn attestation_pda_discriminators_and_sizes_match_vector() {
    let v = v();
    let i = &v["identity"];
    let (pda, bump) = Pubkey::find_program_address(
        &[b"attest", key(&s(i, "issuer")).as_ref(), key(&s(i, "subject")).as_ref()],
        &key(&s(&v, "program_id")),
    );
    assert_eq!(pda.to_string(), s(i, "attestation_pda"));
    assert_eq!(bump as u64, i["bump"].as_u64().unwrap());
    assert_eq!(hex::encode(instruction::AttestIdentity::DISCRIMINATOR), s(i, "attest_identity_discriminator_hex"));
    assert_eq!(hex::encode(instruction::RevokeAttestation::DISCRIMINATOR), s(i, "revoke_attestation_discriminator_hex"));
    assert_eq!(hex::encode(Attestation::DISCRIMINATOR), s(i, "account_discriminator_hex"));
    assert_eq!(Attestation::SPACE as u64, i["account_size"].as_u64().unwrap());
}

#[test]
fn attest_identity_instruction_data_matches_golden() {
    let v = v();
    let i = &v["identity"];
    let data = instruction::AttestIdentity {
        subject: key(&s(i, "subject")),
        label: s(i, "label"),
        claim_hash: hash32(&s(i, "claim_hash")),
        expires_at: i["expires_at_unix"].as_i64().unwrap(),
    }
    .data();
    assert_eq!(hex::encode(data), s(i, "attest_identity_data_hex"));
}

#[test]
fn attestation_account_bytes_match_golden() {
    let v = v();
    let i = &v["identity"];
    let mut buf = Vec::new();
    attestation(&v, 0).try_serialize(&mut buf).unwrap();
    assert_eq!(hex::encode(padded(buf, Attestation::SPACE)), s(i, "account_valid_hex"));
    let mut buf = Vec::new();
    attestation(&v, i["revoked_at_unix"].as_i64().unwrap()).try_serialize(&mut buf).unwrap();
    assert_eq!(hex::encode(padded(buf, Attestation::SPACE)), s(i, "account_revoked_hex"));

    // memcmp ofsetleri: issuer 9, subject 41
    let raw = hex::decode(s(i, "account_valid_hex")).unwrap();
    let io = i["issuer_offset"].as_u64().unwrap() as usize;
    let so = i["subject_offset"].as_u64().unwrap() as usize;
    assert_eq!(&raw[io..io + 32], key(&s(i, "issuer")).as_ref());
    assert_eq!(&raw[so..so + 32], key(&s(i, "subject")).as_ref());
}

#[test]
fn revocation_pda_and_account_match_golden() {
    let v = v();
    let r = &v["revocation"];
    let proof_pda = key(&s(r, "proof_pda"));
    let (pda, bump) = Pubkey::find_program_address(&[b"revoke", proof_pda.as_ref()], &key(&s(&v, "program_id")));
    assert_eq!(pda.to_string(), s(r, "revocation_pda"));
    assert_eq!(bump as u64, r["bump"].as_u64().unwrap());
    assert_eq!(hex::encode(instruction::RevokeProof::DISCRIMINATOR), s(r, "revoke_proof_discriminator_hex"));
    assert_eq!(hex::encode(Revocation::DISCRIMINATOR), s(r, "account_discriminator_hex"));
    assert_eq!(Revocation::SPACE as u64, r["account_size"].as_u64().unwrap());

    let rev = Revocation { version: 1, proof: proof_pda, signer: key(&s(&v, "signer")), revoked_at: r["revoked_at_unix"].as_i64().unwrap(), bump };
    let mut buf = Vec::new();
    rev.try_serialize(&mut buf).unwrap();
    assert_eq!(hex::encode(buf), s(r, "account_hex"));
}

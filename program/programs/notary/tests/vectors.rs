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

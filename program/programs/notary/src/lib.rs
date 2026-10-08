// Notary programı (CONTRACT.md v2).
// Her (signer, document_hash) çifti için tek bir Proof PDA'sı. Zaman zincirin saatinden gelir.
use anchor_lang::prelude::*;

// Devnet program kimliği (docs/deployment.json). Anahtar çifti repoda DEĞİL, deploy eden kişide durur.
declare_id!("7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN");

pub const MAX_PARENTS: usize = 4;
pub const MAX_PARTIES: usize = 4;

#[program]
pub mod notary {
    use super::*;

    /// Belge hash'ini imzalayan adına kaydeder. Aynı (signer, hash) ikinci kez kaydedilemez:
    /// `init` "account already in use" ile başarısız olur.
    pub fn notarize(
        ctx: Context<Notarize>,
        document_hash: [u8; 32],
        receiver: Option<Pubkey>,
        parents: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(parents.len() <= MAX_PARENTS, NotaryError::TooManyParents);
        for i in 0..parents.len() {
            for j in (i + 1)..parents.len() {
                require!(parents[i] != parents[j], NotaryError::DuplicateParent);
            }
        }

        let created_at = Clock::get()?.unix_timestamp;
        let proof = &mut ctx.accounts.proof;
        proof.version = 1;
        proof.signer = ctx.accounts.signer.key();
        proof.document_hash = document_hash;
        proof.receiver = receiver;
        proof.created_at = created_at;
        proof.parents = parents;
        proof.bump = ctx.bumps.proof;

        emit!(Notarized {
            proof: proof.key(),
            signer: proof.signer,
            document_hash,
            receiver,
            created_at,
        });
        Ok(())
    }

    /// Birden fazla tarafın imzalaması gereken sözleşme. Oluşturan taraf `signers` içinde olmalı ve oluştururken
    /// otomatik imzalamış sayılır; diğerleri `co_sign` ile imzalar. Seeds: ["agreement", creator, document_hash].
    pub fn create_agreement(
        ctx: Context<CreateAgreement>,
        document_hash: [u8; 32],
        signers: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            signers.len() >= 2 && signers.len() <= MAX_PARTIES,
            NotaryError::BadPartyCount
        );
        for i in 0..signers.len() {
            for j in (i + 1)..signers.len() {
                require!(signers[i] != signers[j], NotaryError::DuplicateSigner);
            }
        }
        let creator = ctx.accounts.creator.key();
        let idx = signers
            .iter()
            .position(|s| *s == creator)
            .ok_or(NotaryError::CreatorNotParty)?;

        let now = Clock::get()?.unix_timestamp;
        let mut signed_at = vec![0i64; signers.len()];
        signed_at[idx] = now;

        let agreement = &mut ctx.accounts.agreement;
        agreement.version = 1;
        agreement.creator = creator;
        agreement.document_hash = document_hash;
        agreement.created_at = now;
        agreement.signers = signers;
        agreement.signed_at = signed_at;
        agreement.bump = ctx.bumps.agreement;

        emit!(AgreementCreated {
            agreement: agreement.key(),
            creator,
            document_hash,
            parties: agreement.signers.len() as u8,
        });
        Ok(())
    }

    /// Sözleşmedeki bir tarafın imzası. İmza, işlemin kendi imzasıdır; zaman zincirin saatidir.
    pub fn co_sign(ctx: Context<CoSign>) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let now = Clock::get()?.unix_timestamp;
        let agreement = &mut ctx.accounts.agreement;
        let idx = agreement
            .signers
            .iter()
            .position(|s| *s == signer)
            .ok_or(NotaryError::NotAParty)?;
        require!(agreement.signed_at[idx] == 0, NotaryError::AlreadySigned);
        agreement.signed_at[idx] = now;
        let remaining = agreement.signed_at.iter().filter(|t| **t == 0).count() as u8;

        emit!(AgreementSigned {
            agreement: agreement.key(),
            signer,
            remaining,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(document_hash: [u8; 32])]
pub struct Notarize<'info> {
    /// Belgeyi imzalayan (agent anahtarı ya da insan cüzdanı).
    pub signer: Signer<'info>,

    /// Kira ve ücreti ödeyen. `signer` ile aynı olabilir; farklıysa bir relayer'dır.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Proof::SPACE,
        seeds = [b"proof", signer.key().as_ref(), document_hash.as_ref()],
        bump
    )]
    pub proof: Account<'info, Proof>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(document_hash: [u8; 32])]
pub struct CreateAgreement<'info> {
    pub creator: Signer<'info>,

    /// Kira ve ücreti ödeyen; `creator` ile aynı olabilir (relayer olabilir).
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Agreement::SPACE,
        seeds = [b"agreement", creator.key().as_ref(), document_hash.as_ref()],
        bump
    )]
    pub agreement: Account<'info, Agreement>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CoSign<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agreement", agreement.creator.as_ref(), agreement.document_hash.as_ref()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, Agreement>,
}

#[account]
pub struct Agreement {
    pub version: u8,
    pub creator: Pubkey,
    pub document_hash: [u8; 32],
    pub created_at: i64,
    /// Sözleşmeyi imzalaması gereken taraflar (2..=MAX_PARTIES)
    pub signers: Vec<Pubkey>,
    /// `signers` ile aynı sırada; 0 = henüz imzalamadı, aksi halde zincir saati
    pub signed_at: Vec<i64>,
    pub bump: u8,
}

impl Agreement {
    /// 8 + 1 + 32 + 32 + 8 + (4 + 32 * 4) + (4 + 8 * 4) + 1 = 250
    pub const SPACE: usize =
        8 + 1 + 32 + 32 + 8 + (4 + 32 * MAX_PARTIES) + (4 + 8 * MAX_PARTIES) + 1;
}

#[account]
pub struct Proof {
    pub version: u8,
    pub signer: Pubkey,
    pub document_hash: [u8; 32],
    pub receiver: Option<Pubkey>,
    pub created_at: i64,
    pub parents: Vec<[u8; 32]>,
    pub bump: u8,
}

impl Proof {
    /// 8 (discriminator) + 1 + 32 + 32 + (1 + 32) + 8 + (4 + 32 * MAX_PARENTS) + 1 = 247
    pub const SPACE: usize = 8 + 1 + 32 + 32 + (1 + 32) + 8 + (4 + 32 * MAX_PARENTS) + 1;
}

#[event]
pub struct Notarized {
    pub proof: Pubkey,
    pub signer: Pubkey,
    pub document_hash: [u8; 32],
    pub receiver: Option<Pubkey>,
    pub created_at: i64,
}

#[event]
pub struct AgreementCreated {
    pub agreement: Pubkey,
    pub creator: Pubkey,
    pub document_hash: [u8; 32],
    pub parties: u8,
}

#[event]
pub struct AgreementSigned {
    pub agreement: Pubkey,
    pub signer: Pubkey,
    pub remaining: u8,
}

#[error_code]
pub enum NotaryError {
    #[msg("En fazla 4 üst belge verilebilir")]
    TooManyParents,
    #[msg("Üst belge hash'leri tekrar edemez")]
    DuplicateParent,
    #[msg("Sözleşme en az 2, en fazla 4 taraf içermeli")]
    BadPartyCount,
    #[msg("Taraflar tekrar edemez")]
    DuplicateSigner,
    #[msg("Sözleşmeyi oluşturan taraflar arasında olmalı")]
    CreatorNotParty,
    #[msg("Bu hesap sözleşmenin tarafı değil")]
    NotAParty,
    #[msg("Bu taraf zaten imzaladı")]
    AlreadySigned,
}

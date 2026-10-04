// Notary programı (CONTRACT.md v2).
// Her (signer, document_hash) çifti için tek bir Proof PDA'sı. Zaman zincirin saatinden gelir.
use anchor_lang::prelude::*;

// Placeholder: `anchor keys sync` gerçek program ID'sini yazar (docs/test_vectors_v2.json'daki test ID'si ile aynı).
declare_id!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");

pub const MAX_PARENTS: usize = 4;

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

#[error_code]
pub enum NotaryError {
    #[msg("En fazla 4 üst belge verilebilir")]
    TooManyParents,
    #[msg("Üst belge hash'leri tekrar edemez")]
    DuplicateParent,
}

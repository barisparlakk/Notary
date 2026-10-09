// Notary programı (CONTRACT.md v2).
// Her (signer, document_hash) çifti için tek bir Proof PDA'sı. Zaman zincirin saatinden gelir.
use anchor_lang::prelude::*;

// Devnet program kimliği (docs/deployment.json). Anahtar çifti repoda DEĞİL, deploy eden kişide durur.
declare_id!("7HCpWChK9pXXAsUzAvA8zq3pi6EwuaUJnkk8XqMn1swN");

pub const MAX_PARENTS: usize = 4;
pub const MAX_PARTIES: usize = 4;
pub const MAX_LABEL: usize = 32;

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

    /// Bir yayıncının (issuer) bir cüzdan için kimlik beyanı. `issuer == subject` ise kişinin kendi beyanıdır (kayıt);
    /// aksi halde üçüncü taraf onayıdır. Hangi yayıncılara güvenileceği istemcinin güven listesinde (docs/trusted_issuers.json) durur.
    /// Aynı (issuer, subject) için son beyan geçerlidir: yenileme bu talimatın tekrar çağrılmasıdır.
    /// `claim_hash`: zincir dışı kanıtın (kimlik kontrolü kaydı, sözleşme vb.) SHA-256'sı. Kişisel veri zincire yazılmaz.
    /// `expires_at`: 0 = süresiz, aksi halde unix saniyesi (şimdiden ileri olmalı).
    pub fn attest_identity(
        ctx: Context<AttestIdentity>,
        subject: Pubkey,
        label: String,
        claim_hash: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        require!(
            !label.is_empty() && label.len() <= MAX_LABEL,
            NotaryError::BadLabel
        );
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at == 0 || expires_at > now, NotaryError::BadExpiry);

        let a = &mut ctx.accounts.attestation;
        a.version = 1;
        a.issuer = ctx.accounts.issuer.key();
        a.subject = subject;
        a.label = label;
        a.claim_hash = claim_hash;
        a.created_at = now;
        a.expires_at = expires_at;
        a.revoked_at = 0;
        a.bump = ctx.bumps.attestation;

        emit!(IdentityAttested {
            attestation: a.key(),
            issuer: a.issuer,
            subject,
            expires_at,
        });
        Ok(())
    }

    /// Yayıncı kendi beyanını geri çeker. Zaman zincirin saatidir; geri alma yok (yenilemek için `attest_identity`).
    pub fn revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.attestation;
        require!(a.revoked_at == 0, NotaryError::AlreadyRevoked);
        a.revoked_at = now;
        emit!(AttestationRevoked {
            attestation: a.key(),
            issuer: a.issuer,
            subject: a.subject,
        });
        Ok(())
    }

    /// İmzalayan kendi kaydını geçersiz kılar. `Proof` hesabı değişmez (zincirde kalır); yanına bir `Revocation` PDA'sı
    /// açılır ve doğrulayıcılar durumu REVOKED gösterir. Yalnızca kaydı oluşturan imzalayan yapabilir.
    pub fn revoke_proof(ctx: Context<RevokeProof>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.revocation;
        r.version = 1;
        r.proof = ctx.accounts.proof.key();
        r.signer = ctx.accounts.signer.key();
        r.revoked_at = now;
        r.bump = ctx.bumps.revocation;
        emit!(ProofRevoked {
            proof: r.proof,
            signer: r.signer,
            revoked_at: now,
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

#[derive(Accounts)]
#[instruction(subject: Pubkey)]
pub struct AttestIdentity<'info> {
    /// Beyanı veren (kişinin kendisi ya da bir yayıncı).
    pub issuer: Signer<'info>,

    /// Kira ve ücreti ödeyen; `issuer` ile aynı olabilir (relayer olabilir).
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = Attestation::SPACE,
        seeds = [b"attest", issuer.key().as_ref(), subject.as_ref()],
        bump
    )]
    pub attestation: Account<'info, Attestation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub issuer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"attest", attestation.issuer.as_ref(), attestation.subject.as_ref()],
        bump = attestation.bump,
        has_one = issuer @ NotaryError::NotTheIssuer
    )]
    pub attestation: Account<'info, Attestation>,
}

#[derive(Accounts)]
pub struct RevokeProof<'info> {
    /// Kaydı oluşturan imzalayan.
    pub signer: Signer<'info>,

    /// Kira ve ücreti ödeyen; `signer` ile aynı olabilir (relayer olabilir).
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"proof", proof.signer.as_ref(), proof.document_hash.as_ref()],
        bump = proof.bump,
        has_one = signer @ NotaryError::NotTheSigner
    )]
    pub proof: Account<'info, Proof>,

    #[account(
        init,
        payer = payer,
        space = Revocation::SPACE,
        seeds = [b"revoke", proof.key().as_ref()],
        bump
    )]
    pub revocation: Account<'info, Revocation>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Attestation {
    pub version: u8,
    pub issuer: Pubkey,
    pub subject: Pubkey,
    pub label: String,
    pub claim_hash: [u8; 32],
    pub created_at: i64,
    /// 0 = süresiz
    pub expires_at: i64,
    /// 0 = geçerli
    pub revoked_at: i64,
    pub bump: u8,
}

impl Attestation {
    /// 8 + 1 + 32 + 32 + (4 + 32) + 32 + 8 + 8 + 8 + 1 = 166
    pub const SPACE: usize = 8 + 1 + 32 + 32 + (4 + MAX_LABEL) + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Revocation {
    pub version: u8,
    pub proof: Pubkey,
    pub signer: Pubkey,
    pub revoked_at: i64,
    pub bump: u8,
}

impl Revocation {
    /// 8 + 1 + 32 + 32 + 8 + 1 = 82
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 8 + 1;
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

#[event]
pub struct IdentityAttested {
    pub attestation: Pubkey,
    pub issuer: Pubkey,
    pub subject: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub attestation: Pubkey,
    pub issuer: Pubkey,
    pub subject: Pubkey,
}

#[event]
pub struct ProofRevoked {
    pub proof: Pubkey,
    pub signer: Pubkey,
    pub revoked_at: i64,
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
    #[msg("Etiket 1 ile 32 bayt arasında olmalı")]
    BadLabel,
    #[msg("Bitiş zamanı 0 (süresiz) ya da gelecekte olmalı")]
    BadExpiry,
    #[msg("Beyan zaten geri çekilmiş")]
    AlreadyRevoked,
    #[msg("Yalnızca beyanı veren yayıncı geri çekebilir")]
    NotTheIssuer,
    #[msg("Yalnızca kaydı oluşturan imzalayan iptal edebilir")]
    NotTheSigner,
}

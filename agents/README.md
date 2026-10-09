# notary-verify

Check a file against its Notary proof on Solana. It needs no account and no Notary server, only a Solana RPC.

```bash
pip install "git+https://github.com/barisparlakk/Notary.git@integration#subdirectory=agents"
notary-verify contract.pdf --pda <PROOF_ADDRESS> --program <PROGRAM_ID> --rpc https://api.devnet.solana.com
```

Exit code: 0 VERIFIED, 1 INVALID, 2 NOT_FOUND, 3 REVOKED, 4 PENDING.

The signer's identity is resolved from on-chain attestations. Only issuers on your trust list count as confirmed:

```bash
notary-verify contract.pdf --pda <PDA> --program <ID> --trust <ISSUER_PUBKEY>
notary-verify contract.pdf --pda <PDA> --program <ID> --trust-list my_issuers.json
```

`notary-issuer` is the tool an identity issuer uses to attest or revoke (see `CONTRACT.md` section 4a).
The rules the verifier implements are in `CONTRACT.md` section 4, so you can reimplement them in any language.

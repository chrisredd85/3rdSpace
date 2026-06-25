# Token Secret Hardening Release Note

This change removes fallback signing/encryption chains for venue invite tokens,
vendor invite tokens, and generic token encryption. Production now requires
dedicated secrets:

- `VENUE_INVITE_SECRET`
- `VENDOR_INVITE_SECRET`
- `TOKEN_CRYPTO_KEY`

Each value must be at least 32 characters. Generate values with:

```bash
openssl rand -hex 32
```

## Rollout Risk

Any in-flight venue or vendor invite links signed by the old fallback secret
chain can become invalid after these dedicated production secrets are set.
If an invited partner reports that a claim link no longer works, reissue the
invite so it is signed with the new dedicated secret.

`TOKEN_CRYPTO_KEY` also becomes the only key material for encrypted integration
tokens. If existing Eventbrite, Posh, Gmail, or webhook secrets were encrypted
with the old fallback chain, they may fail to decrypt after deployment. Those
connections should either be migrated intentionally before rollout or
reconnected by the affected organizer after rollout.

## Operator Checklist

1. Set `VENUE_INVITE_SECRET`, `VENDOR_INVITE_SECRET`, and `TOKEN_CRYPTO_KEY` in
   Vercel Production before promoting this change.
2. Confirm the broader production secret list is populated:
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_CONNECT_WEBHOOK_SECRET`, `CRON_SECRET`,
   `SETTLEMENT_ACK_TOKEN_SECRET`, `EMAIL_TOKEN_ENCRYPTION_KEY`,
   `OPENAI_API_KEY`, and `GOOGLE_PLACES_API_KEY`.
3. Reissue any stale partner invite links if claim verification fails after the
   deployment.

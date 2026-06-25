# Token Crypto Rotation Runbook

## When To Use This Runbook

Use this after `TOKEN_CRYPTO_KEY` is rotated or when an encrypted token, webhook
secret, or provider credential can no longer be decrypted by
`lib/server/token-crypto.ts`.

Stale ciphertext is a P1 issue for active connections because imports and
webhooks can stop syncing. It is P3 for already `setup_required` connections
with no active organizer impact.

## Cleanup Steps

1. Run the token decryption audit to identify undecryptable rows.
2. Confirm affected users and active organizer impact.
3. Update `AFFECTED_ROWS` in
   `scripts/admin/clear-stale-encrypted-tokens.ts` with the exact rows and
   encrypted columns to clear.
4. Notify affected active organizers:
   - Subject: `Action needed: reconnect your Eventbrite to 3rdPlace`
   - Body: `We recently upgraded our token encryption. As a result, we need you
     to reconnect your Eventbrite account so we can continue importing your
     ticketing data. Reconnect at /planner/tickets. No data has been lost; only
     the connection token needs to be refreshed.`
5. Run the cleanup script with explicit confirmation:

   ```bash
   npx tsx scripts/admin/clear-stale-encrypted-tokens.ts --confirm
   ```

6. Re-run the decryption audit and confirm there are zero undecryptable active
   rows.
7. Confirm cleaned rows have null ciphertext values and `status =
   'setup_required'` where applicable.
8. Confirm `admin_audit_log` contains `cleared_stale_ciphertext` entries.
9. Document the rotation in
   `qa-artifacts/token-crypto-key-rotation-YYYY-MM-DD.md`.

## Current 2026-06-25 Cleanup Scope

The first cleanup targeted four known stale rows:

- `builder_ticketing_connections:11cf69df-d660-4777-b8eb-1d6026276d59`
- `provider_connections:00ec6025-3e65-480e-b6df-0ff0e60623eb`
- `builder_ticketing_connections:1327a847-7754-46ba-823a-db37b160aa0c`
- `builder_ticketing_connections:c44d18c9-f3bb-4622-b360-3c300260dfc9`

Verification found no active organizers affected, so organizer email
notification was not required for the current cleanup. Future rotations should
send the organizer notice in Step 4 for any active connection.

## Rotation Process After Versioned Keys Land

1. Generate a new key:

   ```bash
   openssl rand -hex 32
   ```

2. Set production environment variables:
   - `TOKEN_CRYPTO_KEY=<new key>`
   - `TOKEN_CRYPTO_KEY_VERSION=v<N>`
   - `TOKEN_CRYPTO_KEY_LEGACY_<previous version>=<old key>`
3. Deploy the code that can decrypt both active and legacy key versions.
4. Re-encrypt rows opportunistically as users reconnect or as a controlled
   backfill with plaintext available.
5. Remove legacy key env vars only after no ciphertext references that key
   version.

## Expected Time

Plan for roughly 30 minutes including verification and audit logging.

# Stripe Connect KYC Failure Test Status

- Branch: `codex/stripe-kyc-failure-tests`
- Scope: test-only coverage for Connect account KYC failure, restoration, replay, capability, and deauthorization handling across vendor, venue, and builder account tables.
- Production code changes: none.
- Note: `account.updated` stores Stripe disabled details in `requirements_due.disabled_reason`; the current shared save helpers do not mirror that value into the top-level `disabled_reason` column except for explicit deauthorization.
- Focused validation: `npm test -- __tests__/integration/stripe-connect-kyc-failures.test.ts --runInBand` passed with 21 tests.
- Type-check: `npm run type-check -- --pretty false` passed.
- Lint: `npm run lint` passed with existing React hook warnings outside this diff.
- Tied-house: `npm run security:tied-house` passed.
- Full Jest: `npm test -- --runInBand` passed with 163 suites run, 1 skipped, 837 passing tests.
- Production build: `DOTENV_CONFIG_PATH=/Users/chrisredd/3rdSpace.webapp/.env.local node -r dotenv/config node_modules/next/dist/bin/next build` passed.

These fixtures are signed Stripe test webhook payloads used to exercise the
actual `constructEvent` verification path in route tests.

Test signing secret: `whsec_codex_fixture_secret`
Fixture timestamp: `1800000000`

The timestamp is fixed so the raw body and signature are stable in git. Tests
freeze system time near the fixture timestamp before calling the webhook route.
Never use production webhook signing secrets in fixtures.

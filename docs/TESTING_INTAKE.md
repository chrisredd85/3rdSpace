# Intake Phrase Regression Testing

3rdPlace treats organizer language as a product surface. A host can type "happy hour", "tennis event", "pilates class", or "founder dinner" and the planner should route that phrase into the correct event archetype before the agent proposes venues, vendors, economics, or outreach.

This suite has three layers. They intentionally share one fixture so alias drift is caught early.

## Shared Fixture

The single source of truth is `test/fixtures/pilot-phrases.ts`.

Add every new pilot phrase there with:

- `phrase`
- `expected_archetype`
- optional `expected_supply_intent`
- optional `expected_activity_type`
- optional `expected_clarification`
- optional `notes`

Do not put this fixture under `__tests__/fixtures`. Jest treats plain TypeScript files under `__tests__` as test suites, which creates false failures.

## Layer 1: Deterministic Resolver Tests

Files:

- `__tests__/integration/pilot-phrase-classification.test.ts`
- `__tests__/integration/pilot-phrase-supply-intent.test.ts`
- `__tests__/integration/pilot-phrase-snapshot.test.ts`

What it catches:

- Missing aliases in the archetype resolver
- Accidental remaps of pilot language
- Snapshot drift in phrase-to-archetype output

Run locally:

```bash
npm test -- __tests__/integration/pilot-phrase-classification.test.ts __tests__/integration/pilot-phrase-supply-intent.test.ts __tests__/integration/pilot-phrase-snapshot.test.ts --runInBand
```

Update snapshots only when the product decision is intentional:

```bash
npm test -- __tests__/integration/pilot-phrase-snapshot.test.ts --updateSnapshot
```

## Layer 2: Real OpenAI Intake Eval

Files:

- `evals/intake/pilot-phrase-eval.ts`
- `evals/intake/pilot-phrase-eval.test.ts`
- `evals/intake/history/`
- `.github/workflows/eval-intake-nightly.yml`

What it catches:

- Prompt drift
- Model behavior drift
- Extraction changes that the deterministic resolver cannot see

Run locally:

```bash
OPENAI_API_KEY=... npm run eval:intake
```

CI uses the separate `OPENAI_API_KEY_EVAL` GitHub secret. Do not use or commit a production key.

The eval writes JSON history files under `evals/intake/history/` when run normally. Each file contains:

- phrase-level expected and actual archetype
- latency
- token counts
- estimated GPT-4o cost in cents
- match-rate summary
- previous seven-day match-rate comparison when history exists

Nightly behavior:

- Runs at 3:00 UTC and on manual workflow dispatch
- Fails if match rate drops below 90%
- Uploads the JSON report as a GitHub Actions artifact
- Opens a GitHub issue when the eval fails

Expected cost is low, but nonzero. The exact cost depends on model output length; the script records an estimate per run.

The Jest wrapper is skipped by default. To run the eval through Jest:

```bash
RUN_INTAKE_LLM_EVAL=1 OPENAI_API_KEY=... npm test -- evals/intake/pilot-phrase-eval.test.ts --runInBand
```

## Layer 3: Browser Intake E2E

Files:

- `e2e/intake-chat-flow.spec.ts`
- `.github/workflows/e2e-intake-nightly.yml`

What it catches:

- Intake chat UI regressions
- Broken mock planner bootstrapping
- Planner title/rendering drift after phrase classification

The PR path runs a representative subset of pilot phrases through `/planner?mock=1`. This keeps PR CI cheap while proving that the browser flow still accepts the phrase, creates an active workspace, renders the expected event-plan title, and keeps the reply box available.

Run the PR subset locally:

```bash
npm run test:e2e -- e2e/intake-chat-flow.spec.ts --project=chromium
```

Run the full phrase browser sweep:

```bash
PILOT_PHRASE_E2E_FULL=1 npm run test:e2e -- e2e/intake-chat-flow.spec.ts --project=chromium
```

Nightly behavior:

- Runs the full phrase set at 3:30 UTC and on manual workflow dispatch
- Uploads the Playwright HTML report as an artifact

## Adding a New Phrase

1. Add the phrase and expected archetype to `test/fixtures/pilot-phrases.ts`.
2. Add or adjust aliases in `lib/planner/archetypes/data.ts` if the deterministic resolver does not match.
3. Run the Layer 1 tests.
4. Update snapshots only if the change is intentional.
5. Run the Playwright PR subset if the phrase represents a new user-visible family.
6. For risky prompt changes, run `OPENAI_API_KEY=... npm run eval:intake` before merging.

## How To Read Failures

Resolver failure:

- Usually means an alias or archetype mapping changed.
- Fix the resolver or update the fixture only after confirming the product decision.

LLM eval failure:

- Means the real intake agent returned the wrong archetype or failed to preserve the resolver context.
- Check the phrase-level JSON artifact first.
- If several unrelated phrases fail at once, inspect the intake prompt or model changes.

E2E failure:

- Means the user-facing chat path broke, even if resolver tests still pass.
- Check whether `/planner?mock=1` booted, whether the first message sent, and whether the expected plan title rendered.

The goal is agreement across all three layers. If the resolver says one archetype and either the LLM or browser path renders another, treat that as a product regression until proven intentional.

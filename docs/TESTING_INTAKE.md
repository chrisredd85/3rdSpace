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

CI uses the separate `OPENAI_API_KEY_EVAL` GitHub Actions secret. The workflow deliberately does not fall back to the application's production key.

Required CI configuration:

1. Create a dedicated OpenAI project for CI evals and a project-scoped service account or restricted API key. Keep access limited to the model endpoint used by this eval, and set project usage limits/budget alerts. See OpenAI's [project and service-account guidance](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) and [API-key permission guidance](https://help.openai.com/en/articles/8867743-assign-api-key-permissions).
2. Add that key as the repository Actions secret `OPENAI_API_KEY_EVAL` under **Settings → Secrets and variables → Actions**.
3. Never commit the value, echo it in a workflow, or reuse the production application key for this monitor.

The workflow validates this configuration before checkout or dependency installation. A missing key is reported as a configuration failure, and no phrase score is claimed.

The eval writes JSON history files under `evals/intake/history/` when run normally. Each file contains:

- phrase-level expected and actual archetype
- latency
- token counts
- estimated GPT-4o cost in cents
- match-rate summary
- previous seven-day match-rate comparison when history exists

Nightly behavior:

- Runs at 3:00 UTC and on manual workflow dispatch
- Restores prior default-branch JSON artifacts so the seven-day comparison uses real history
- Fails if match rate drops below 90%
- Uploads the cumulative, 30-day-pruned JSON history as a GitHub Actions artifact
- Uploads a separate per-run diagnostics artifact containing the eval log, run metadata, and the current report when one was produced
- Maintains one default-branch monitor issue across configuration, workflow, eval, and artifact failures
- Reopens that issue on recurrence and closes it only after configuration, history restoration, evaluation, and artifact upload all succeed

The workflow snapshots the history directory before each eval and records an explicit current-run result (`passed`, `threshold_failure`, `execution_error`, or `report_missing`). Restored reports can therefore never make an API/runtime crash look like a fresh below-threshold result.

The paid eval job has only `actions: read` and `contents: read`. A separate reconciliation job receives `issues: write`, so dependency installation and model execution never run with issue-write permission. Every REST call pins GitHub API version `2026-03-10`.

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

- **Configuration** means `OPENAI_API_KEY_EVAL` is missing. No model call or match rate exists.
- **Workflow setup** means checkout, Node setup, or dependency installation failed. It is not model drift.
- **History** means the current eval ran without a trustworthy rolling comparison because the prior artifact could not be restored.
- **Threshold** means the real intake agent completed and fell below 90%. Check the phrase-level JSON artifact first.
- **Evaluation runtime** means the model/API/schema path failed before producing a usable report. Check logs before changing prompts.
- **Artifact** means the eval completed but the report could not be persisted for operators and the next rolling comparison.

If several unrelated phrases fail in a completed report, inspect the intake prompt or model changes. Do not interpret missing credentials, setup failures, or missing reports as prompt drift.

E2E failure:

- Means the user-facing chat path broke, even if resolver tests still pass.
- Check whether `/planner?mock=1` booted, whether the first message sent, and whether the expected plan title rendered.

The goal is agreement across all three layers. If the resolver says one archetype and either the LLM or browser path renders another, treat that as a product regression until proven intentional.

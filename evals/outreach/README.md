# Outreach Evals

Phase 5 requires two hand-labeled corpora before autonomy can be treated as production-ready:

- `reply-classifier-corpus.jsonl`: 200 representative venue/vendor replies with expected intent labels.
- `outreach-agent-scenarios.jsonl`: 100 outreach scenarios with expectations for tone, approval gating, and venue-fact grounding.

The checked-in records are schema examples only and are marked with `"skip": true`. Replace them with manually reviewed fixtures before enforcing live model evals in CI.

Run:

```bash
npm run eval:outreach
```

The runner validates fixture shape now. When labeled records and a live eval adapter are added, PRs that touch agent code should fail if key intent accuracy drops by more than 3 percentage points from the committed baseline.

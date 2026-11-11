# Disposable proof for migration 162

Run from this checkout with Python 3, Docker Desktop, Supabase CLI 2.95.4, and the
already-cached `public.ecr.aws/supabase/postgres:17.6.1.167` image:

The runner is pinned to this Mac's local Docker Desktop socket,
`unix:///Users/chrisredd/.docker/run/docker.sock`; it does not accept a remote
Docker host or production database target.

```sh
python3 scripts/release/verify-legacy-venue-purge.py --prepare --stop
```

This recreates **only** project `d-historical-purge-fixture-20261111`, with its
generated config under `test-results/d-historical-purge/disposable/fixture-runtime`
and local DB port 62932. No hosted connection option exists. The subprocess
environment is allowlisted, Docker uses an empty generated config, and local
socket SQL uses `--no-password`. No application secrets, provider calls, job
execution, or dependency installation occur. The cached image check fails before
startup if the required image is unavailable. Runtime-only config adapts the SMTP
section to the tested local CLI; repository config remains unchanged.

`--prepare` runs the original migrations through 161, executes **unmodified 162**
on an empty, unpaused historical cohort, and checks ledger 162. It then resets
only this disposable cluster to 157, seeds the committed invented fixture, and
installs the real 158–161 migrations while locally paused. The seed never disables
guards. Baseline database `d162_before` is cloned for independent failure cases.
The ordinary command without `--prepare` reruns against that existing baseline.
`--stop` stops only this fixture project after success; proof logs remain on disk.

The invented fixture follows the reviewed UUID/path/type layout, with fake content
and `example.com`/`fixture.example` contacts. It includes the 93 source identities,
20 copies, all 59 contact-selection flag positions, 182 accepted emails across 58
rows, 868 accepted forms across 20 rows, 39 approvals, 20 signed snapshot hashes,
10 confirmed native bookings, financial rows, and the eight source FK classes.
An independently evidenced source and a host-authored message are outside the
selector. Monetary NULL and a number larger than JavaScript's safe integer range
appear inside the user prompt that the migration actually parses and reserializes.

Production fingerprints cannot match invented rows. The runner therefore changes
only the **339 `prehash`/`posthash`/`preserved_hash` literals inside the delimited
manifest** for populated fixture cases. It proves every other migration byte,
UUID, category, path operation, control check, and ACL behavior remains unchanged.
Python computes afterimages independently; PostgreSQL supplies canonical JSONB
serialization and hashing, not the migration's projection logic. This is a
synthetic-data proof, not execution against copied production values.

The matrix checks exact afterimages, row/identity retention, source canary removal,
contact preservation, all four agent-run columns, unchanged protected tables,
recommendation markers, full installed venue/vendor validators, helper exception
structure, all public/private function and ACL fingerprints, and timestamp-stable
idempotence. Failure cases cover unpaused apply, changed money/evidence/selection,
commercial references, derived caches, malformed serialized JSON, excessive depth,
partial cohorts, unexpected audit capture, late transactional rollback, bounded
lock timeout, an observed concurrent-writer lock wait, and pause-control locking.

The marker-reader integration suites and full DB/RLS workflow run separately;
their results must be reported independently. This SQL proof does not claim live
browser, hosted-purge, backup, replica, WAL, or provider validation.

Results: `test-results/d-historical-purge/disposable/proof-results.json`, numbered
SQL logs, `effective-helpers.json`, `original-fresh162-proof.json`, and the rendered
synthetic migration. These artifacts are ignored. No source survey or ignored
generator is required to reproduce the committed fixture proof.

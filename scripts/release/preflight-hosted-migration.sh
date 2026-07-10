#!/usr/bin/env bash
set -euo pipefail

EXPECTED_MISSING_VERSION="${1:-20260701090000}"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN before running this preflight}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF before running this preflight}"
: "${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD before running this preflight}"

for required_command in git npm supabase; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

if ! git diff --quiet -- supabase/migrations; then
  echo "Refusing preflight: supabase/migrations has uncommitted changes." >&2
  exit 1
fi

CURRENT_SHA="$(git rev-parse HEAD)"
if [[ -n "${DEPLOYED_SHA:-}" && "${CURRENT_SHA}" != "${DEPLOYED_SHA}" ]]; then
  echo "Refusing preflight: checkout ${CURRENT_SHA} does not match DEPLOYED_SHA ${DEPLOYED_SHA}." >&2
  exit 1
fi

supabase link \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --password "${SUPABASE_DB_PASSWORD}"

npm run release:migrations:parity -- \
  --linked \
  --expect-missing "${EXPECTED_MISSING_VERSION}"

supabase db push \
  --linked \
  --password "${SUPABASE_DB_PASSWORD}" \
  --dry-run

echo "Preflight passed for ${CURRENT_SHA}. No hosted migration was applied."

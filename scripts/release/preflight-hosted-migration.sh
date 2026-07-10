#!/usr/bin/env bash
set -euo pipefail

EXPECTED_MISSING_VERSION="${1:-20260701090000}"

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN before running this preflight}"
: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF before running this preflight}"
: "${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD before running this preflight}"
: "${DEPLOYED_SHA:?Set DEPLOYED_SHA to the exact production commit before running this preflight}"

for required_command in git npm supabase; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

if ! git diff --quiet HEAD -- supabase/migrations; then
  echo "Refusing preflight: tracked migration content differs from the deployed commit." >&2
  exit 1
fi

if [[ -n "$(git ls-files --others --exclude-standard -- supabase/migrations)" ]]; then
  echo "Refusing preflight: untracked migration files are present." >&2
  git ls-files --others --exclude-standard -- supabase/migrations >&2
  exit 1
fi

CURRENT_SHA="$(git rev-parse HEAD)"
if [[ "${CURRENT_SHA}" != "${DEPLOYED_SHA}" ]]; then
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

#!/usr/bin/env bash
set -euo pipefail

# Shared manifest and safety helpers for the Prompt 1-8 clone rehearsal.
# This file is both an executable setup check and a library sourced by
# rehearse-bundle.sh. It never creates the database guard: the clone provider or
# operator must install that marker while provisioning the disposable clone.

REHEARSAL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REHEARSAL_REPO_ROOT="$(cd "${REHEARSAL_SCRIPT_DIR}/../.." && pwd)"
REHEARSAL_MIGRATION_DIR="${REHEARSAL_REPO_ROOT}/supabase/migrations"
REHEARSAL_REPORT_TEMPLATE="${REHEARSAL_SCRIPT_DIR}/rehearsal-report-template.md"
REHEARSAL_REQUIRED_BASELINE_VERSION="20260709110000"
REHEARSAL_REQUIRED_PREREQUISITE_VERSIONS=(
  "20260701090000"
  "20260709090000"
  "20260709100000"
  "20260709110000"
)
REHEARSAL_CONFIRMATION_PHRASE="I_ACKNOWLEDGE_THIS_IS_A_DISPOSABLE_NON_PRODUCTION_CLONE"
REHEARSAL_REVIEWED_BASE_SHA=""

BUNDLE_MIGRATIONS=(
  "20260709114000_atomic_vendor_base_rate_repair.sql"
  "20260709115000_add_atomic_builder_event_materialization.sql"
  "20260709120000_lock_down_function_and_view_privileges.sql"
  "20260709130000_server_owned_execution_control_plane.sql"
  "20260709140000_add_approval_version_retry_contract.sql"
  "20260709150000_add_canonical_plan_event_identity.sql"
  "20260709160000_complete_concierge_execution.sql"
  "20260709162000_add_canonical_quote_booking_execution.sql"
  "20260709163000_complete_canonical_event_outcome_command.sql"
  "20260709164000_extend_approved_action_handoff_retry.sql"
  "20260709165000_cancel_external_checkout_handoff.sql"
  "20260709166000_harden_canonical_booking_provenance.sql"
  "20260709167000_confirm_external_checkout_handoff.sql"
  "20260709168000_confirm_canonical_venue_bookings_batch.sql"
  "20260709169000_allow_waiting_quote_reapproval.sql"
  "20260709170000_require_canonical_quote_booking_reapproval.sql"
  "20260709171000_decline_canonical_bookings.sql"
  "20260709174000_claim_canonical_quote_booking_resume.sql"
  "20260709175000_harden_prompt8_confirmation_side_effects.sql"
  "20260709176000_harden_canonical_vendor_claim_binding.sql"
  "20260709177000_harden_terminal_plan_execution_boundary.sql"
  "20260709178000_make_canonical_venue_confirmation_effects_replayable.sql"
)

rehearsal_die() {
  echo "Rehearsal refused: $*" >&2
  return 1
}

rehearsal_usage() {
  cat <<'USAGE'
Usage:
  REHEARSAL_DATABASE_URL='postgresql://...' \
  REHEARSAL_CLONE_ID='operator-clone-id' \
  REHEARSAL_EXPECTED_BASELINE_VERSION='20260709110000' \
  REHEARSAL_OLD_PRODUCTION_SHA='<full-reviewed-base-sha>' \
  REHEARSAL_TARGET_CLASS='clone' \
  PRODUCTION_PROJECT_REF='known-production-ref' \
  scripts/release/rehearse-bundle-setup.sh --confirm-non-production [options]

Options:
  --database-url URL             Operator-provided disposable clone connection.
  --production-database-url URL  Optional additional production identity used
                                 only for local comparison; it is never connected to.
  --production-project-ref REF   Required known production project ref to reject.
  --clone-id ID                  Must match the clone's read-only guard marker.
  --expected-baseline VERSION    Exact last migration already on the clone.
  --old-production-sha SHA       Frozen, full REVIEWED_BASE_SHA for the code
                                 running before this migration bundle.
  --target-class clone           Required. Other values are refused.
  --candidate-sha SHA            Exact candidate checkout expected locally.
  --artifacts-dir DIR            Local non-secret setup receipt directory.
  --confirm-non-production       Required operator acknowledgement.
  --dry-run                      Validate local inventory and print the plan;
                                 do not connect to any database.
  --help                         Show this help.

Provision two disposable databases from the same recent production backup or
PITR restore, after all four prerequisite migration versions across the three
prerequisite releases are present. Record the
provider snapshot identifier/timestamp and use a clone-only connection. For a
local realized clone, create a new database and restore the operator-provided
dump into that new target (for example, `createdb` followed by `pg_restore
--no-owner --no-privileges`); never point a restore or this harness at the
production connection.

Before a live rehearsal, each disposable clone must contain this marker,
created on the clone as part of provisioning (never by this script):

  CREATE SCHEMA rehearsal_meta;
  CREATE TABLE rehearsal_meta.environment_guard (
    key text PRIMARY KEY,
    value text NOT NULL
  );
  INSERT INTO rehearsal_meta.environment_guard(key, value) VALUES
    ('environment', 'clone'),
    ('allow_bundle_rehearsal', 'true'),
    ('clone_id', '<operator-clone-id>'),
    ('source_snapshot', '<provider-snapshot-id-or-timestamp>');

The clone ledger must contain exactly these separately released prerequisites
before the bundle starts: 20260701090000, 20260709090000, 20260709100000, and
20260709110000.
The connection URL is never written to the receipt.
USAGE
}

rehearsal_require_commands() {
  local command_name
  for command_name in "$@"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      rehearsal_die "missing required command: ${command_name}"
      return 1
    fi
  done
}

rehearsal_now_utc() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

rehearsal_now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

rehearsal_migration_version() {
  local filename="$1"
  echo "${filename%%_*}"
}

rehearsal_migration_name() {
  local filename="$1"
  local without_extension="${filename%.sql}"
  echo "${without_extension#*_}"
}

rehearsal_hash_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return
  fi
  shasum -a 256 "${file_path}" | awk '{print $1}'
}

rehearsal_hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
    return
  fi
  shasum -a 256 | awk '{print $1}'
}

rehearsal_connection_identity() {
  local database_url="$1"
  node - "${database_url}" <<'NODE'
const raw = process.argv[2]
let parsed
try {
  parsed = new URL(raw)
} catch {
  process.stderr.write('invalid PostgreSQL connection URL\n')
  process.exit(1)
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  process.stderr.write('connection URL must use postgres:// or postgresql://\n')
  process.exit(1)
}
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
if (!parsed.hostname || !database) {
  process.stderr.write('connection URL must include a host and database name\n')
  process.exit(1)
}
const port = parsed.port || '5432'
process.stdout.write(`${parsed.hostname.toLowerCase()}:${port}/${database}`)
NODE
}

rehearsal_connection_fingerprint() {
  local database_url="$1"
  rehearsal_connection_identity "${database_url}" | rehearsal_hash_text
}

rehearsal_assert_manifest() {
  local expected_count=22
  local first_expected="20260709114000_atomic_vendor_base_rate_repair.sql"
  local last_expected="20260709178000_make_canonical_venue_confirmation_effects_replayable.sql"
  local previous_version=""
  local filename version path
  local discovered=()

  if [[ "${#BUNDLE_MIGRATIONS[@]}" -ne "${expected_count}" ]]; then
    rehearsal_die "bundle manifest must contain exactly ${expected_count} migrations; found ${#BUNDLE_MIGRATIONS[@]}"
    return 1
  fi
  if [[ "${BUNDLE_MIGRATIONS[0]}" != "${first_expected}" ]]; then
    rehearsal_die "bundle manifest starts at the wrong migration: ${BUNDLE_MIGRATIONS[0]}"
    return 1
  fi
  if [[ "${BUNDLE_MIGRATIONS[21]}" != "${last_expected}" ]]; then
    rehearsal_die "bundle manifest ends at the wrong migration: ${BUNDLE_MIGRATIONS[21]}"
    return 1
  fi

  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    path="${REHEARSAL_MIGRATION_DIR}/${filename}"
    version="$(rehearsal_migration_version "${filename}")"
    if [[ ! "${filename}" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
      rehearsal_die "invalid reviewed migration filename: ${filename}"
      return 1
    fi
    if [[ ! -f "${path}" ]]; then
      rehearsal_die "reviewed migration is missing: ${path}"
      return 1
    fi
    if [[ -n "${previous_version}" && ( "${version}" == "${previous_version}" || "${version}" < "${previous_version}" ) ]]; then
      rehearsal_die "bundle manifest is not strictly ordered at ${filename}"
      return 1
    fi
    previous_version="${version}"
  done

  while IFS= read -r path; do
    filename="$(basename "${path}")"
    version="$(rehearsal_migration_version "${filename}")"
    if [[ "${version}" > "20260709113999" && "${version}" < "20260709178001" ]]; then
      discovered+=("${filename}")
    fi
  done < <(find "${REHEARSAL_MIGRATION_DIR}" -maxdepth 1 -type f -name '*.sql' | sort)

  if [[ "${discovered[*]}" != "${BUNDLE_MIGRATIONS[*]}" ]]; then
    rehearsal_die "files in the reviewed 20260709114000-20260709178000 range do not exactly match the 22-file manifest"
    return 1
  fi

  if ! git -C "${REHEARSAL_REPO_ROOT}" diff --quiet HEAD -- supabase/migrations; then
    rehearsal_die "tracked migration files differ from the candidate commit"
    return 1
  fi
  while IFS= read -r path; do
    [[ -z "${path}" ]] && continue
    filename="$(basename "${path}")"
    version="$(rehearsal_migration_version "${filename}")"
    if [[ "${version}" > "20260709113999" && "${version}" < "20260709178001" ]]; then
      rehearsal_die "untracked migration file is present inside the reviewed bundle range: ${path}"
      return 1
    fi
  done < <(git -C "${REHEARSAL_REPO_ROOT}" ls-files --others --exclude-standard -- supabase/migrations)
}

rehearsal_bundle_versions_sql() {
  local filename version
  local separator=""
  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    version="$(rehearsal_migration_version "${filename}")"
    printf "%s'%s'" "${separator}" "${version}"
    separator=","
  done
}

rehearsal_required_prerequisite_versions_sql() {
  local version separator=""
  for version in "${REHEARSAL_REQUIRED_PREREQUISITE_VERSIONS[@]}"; do
    printf "%s'%s'" "${separator}" "${version}"
    separator=","
  done
}

rehearsal_required_prerequisite_versions_csv() {
  local version separator=""
  for version in "${REHEARSAL_REQUIRED_PREREQUISITE_VERSIONS[@]}"; do
    printf '%s%s' "${separator}" "${version}"
    separator=","
  done
}

rehearsal_psql_readonly() {
  local database_url="$1"
  local sql="$2"
  local readonly_options="${PGOPTIONS:-}"
  if [[ -n "${PGOPTIONS:-}" ]]; then
    readonly_options="${readonly_options} "
  fi
  readonly_options="${readonly_options}-c default_transaction_read_only=on"
  PGOPTIONS="${readonly_options}" \
    psql "${database_url}" -X -v ON_ERROR_STOP=1 -A -t -q -c "${sql}"
}

rehearsal_validate_static_target() {
  local database_url="$1"
  local production_database_url="$2"
  local production_project_ref="$3"
  local target_class="$4"
  local clone_id="$5"
  local expected_baseline="$6"
  local confirmation="$7"
  local old_production_sha="$8"
  local clone_identity production_identity lowercase_url lowercase_ref

  rehearsal_require_commands node git

  if [[ -z "${database_url}" ]]; then
    rehearsal_die "REHEARSAL_DATABASE_URL or --database-url is required"
    return 1
  fi
  if [[ "${target_class}" != "clone" ]]; then
    rehearsal_die "target class must be exactly 'clone'; received '${target_class:-unset}'"
    return 1
  fi
  if [[ "${confirmation}" != "${REHEARSAL_CONFIRMATION_PHRASE}" ]]; then
    rehearsal_die "--confirm-non-production is required"
    return 1
  fi
  if [[ ! "${clone_id}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    rehearsal_die "clone id must contain only letters, numbers, dot, underscore, or hyphen"
    return 1
  fi
  if [[ "${expected_baseline}" != "${REHEARSAL_REQUIRED_BASELINE_VERSION}" ]]; then
    rehearsal_die "expected baseline must be ${REHEARSAL_REQUIRED_BASELINE_VERSION} after all prerequisite releases"
    return 1
  fi
  if [[ ! "${old_production_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    rehearsal_die "REHEARSAL_OLD_PRODUCTION_SHA must be the full 40-character REVIEWED_BASE_SHA"
    return 1
  fi
  if ! git -C "${REHEARSAL_REPO_ROOT}" cat-file -e "${old_production_sha}^{commit}" 2>/dev/null; then
    rehearsal_die "reviewed old-production SHA is not a local commit: ${old_production_sha}"
    return 1
  fi
  if [[ -z "${production_project_ref}" ]]; then
    rehearsal_die "PRODUCTION_PROJECT_REF is required so the production project can be rejected"
    return 1
  fi

  clone_identity="$(rehearsal_connection_identity "${database_url}")" || {
    rehearsal_die "invalid clone connection URL"
    return 1
  }
  if [[ -n "${production_database_url}" ]]; then
    production_identity="$(rehearsal_connection_identity "${production_database_url}")" || {
      rehearsal_die "invalid production identity URL"
      return 1
    }
    if [[ "${clone_identity}" == "${production_identity}" ]]; then
      rehearsal_die "clone connection resolves to the declared production database identity"
      return 1
    fi
  fi

  if [[ -n "${production_project_ref}" ]]; then
    lowercase_url="$(printf '%s' "${database_url}" | tr '[:upper:]' '[:lower:]')"
    lowercase_ref="$(printf '%s' "${production_project_ref}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${lowercase_url}" == *"${lowercase_ref}"* ]]; then
      rehearsal_die "clone connection contains the declared production project ref"
      return 1
    fi
  fi

  REHEARSAL_REVIEWED_BASE_SHA="$(git -C "${REHEARSAL_REPO_ROOT}" rev-parse "${old_production_sha}^{commit}")"
}

rehearsal_validate_reviewed_base_against_candidate() {
  local reviewed_base_sha="$1"
  local candidate_sha="$2"
  local filename

  if ! git -C "${REHEARSAL_REPO_ROOT}" merge-base --is-ancestor "${reviewed_base_sha}" "${candidate_sha}"; then
    rehearsal_die "REHEARSAL_OLD_PRODUCTION_SHA is not an ancestor of candidate ${candidate_sha}"
    return 1
  fi
  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    if git -C "${REHEARSAL_REPO_ROOT}" cat-file -e "${reviewed_base_sha}:supabase/migrations/${filename}" 2>/dev/null; then
      rehearsal_die "reviewed old-production SHA already contains bundle migration ${filename}"
      return 1
    fi
  done
}

REHEARSAL_OBSERVED_SOURCE_SNAPSHOT=""
REHEARSAL_OBSERVED_DATABASE_IDENTITY=""

rehearsal_validate_clone_guard_and_baseline() {
  local database_url="$1"
  local clone_id="$2"
  local expected_baseline="$3"
  local marker marker_environment marker_allowed marker_clone_id marker_snapshot
  local observed_baseline applied_bundle_versions versions_sql
  local prerequisite_versions_sql expected_prerequisites observed_prerequisites

  rehearsal_require_commands psql

  marker="$(rehearsal_psql_readonly "${database_url}" "
    SELECT concat_ws('|',
      COALESCE(max(value) FILTER (WHERE key = 'environment'), ''),
      COALESCE(max(value) FILTER (WHERE key = 'allow_bundle_rehearsal'), ''),
      COALESCE(max(value) FILTER (WHERE key = 'clone_id'), ''),
      COALESCE(max(value) FILTER (WHERE key = 'source_snapshot'), '')
    )
    FROM rehearsal_meta.environment_guard;
  ")" || {
    rehearsal_die "clone guard marker is missing or unreadable; no mutation was attempted"
    return 1
  }
  IFS='|' read -r marker_environment marker_allowed marker_clone_id marker_snapshot <<<"${marker}"
  if [[ "${marker_environment}" != "clone" || "${marker_allowed}" != "true" ]]; then
    rehearsal_die "database guard does not explicitly authorize a clone bundle rehearsal"
    return 1
  fi
  if [[ "${marker_clone_id}" != "${clone_id}" ]]; then
    rehearsal_die "database guard clone id '${marker_clone_id}' does not match '${clone_id}'"
    return 1
  fi
  if [[ -z "${marker_snapshot}" ]]; then
    rehearsal_die "database guard must record a non-empty source_snapshot"
    return 1
  fi

  observed_baseline="$(rehearsal_psql_readonly "${database_url}" \
    "SELECT COALESCE(max(version), '') FROM supabase_migrations.schema_migrations;")"
  if [[ "${observed_baseline}" != "${expected_baseline}" ]]; then
    rehearsal_die "clone migration baseline is ${observed_baseline:-empty}; expected ${expected_baseline}"
    return 1
  fi

  prerequisite_versions_sql="$(rehearsal_required_prerequisite_versions_sql)"
  expected_prerequisites="$(rehearsal_required_prerequisite_versions_csv)"
  observed_prerequisites="$(rehearsal_psql_readonly "${database_url}" \
    "SELECT COALESCE(string_agg(version, ',' ORDER BY version), '') FROM supabase_migrations.schema_migrations WHERE version IN (${prerequisite_versions_sql});")"
  if [[ "${observed_prerequisites}" != "${expected_prerequisites}" ]]; then
    rehearsal_die "clone prerequisite ledger mismatch: observed ${observed_prerequisites:-none}; required ${expected_prerequisites}"
    return 1
  fi

  versions_sql="$(rehearsal_bundle_versions_sql)"
  applied_bundle_versions="$(rehearsal_psql_readonly "${database_url}" \
    "SELECT COALESCE(string_agg(version, ',' ORDER BY version), '') FROM supabase_migrations.schema_migrations WHERE version IN (${versions_sql});")"
  if [[ -n "${applied_bundle_versions}" ]]; then
    rehearsal_die "clone is not fresh; reviewed bundle versions are already committed: ${applied_bundle_versions}"
    return 1
  fi

  REHEARSAL_OBSERVED_SOURCE_SNAPSHOT="${marker_snapshot}"
  REHEARSAL_OBSERVED_DATABASE_IDENTITY="$(rehearsal_psql_readonly "${database_url}" \
    "SELECT current_database() || '@' || COALESCE(inet_server_addr()::text, 'local') || ':' || inet_server_port()::text;")"
}

rehearsal_write_manifest() {
  local output_file="$1"
  local ordinal=0 filename version
  printf 'ordinal\tversion\tfilename\tsha256\n' >"${output_file}"
  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    ordinal=$((ordinal + 1))
    version="$(rehearsal_migration_version "${filename}")"
    printf '%s\t%s\t%s\t%s\n' \
      "${ordinal}" \
      "${version}" \
      "${filename}" \
      "$(rehearsal_hash_file "${REHEARSAL_MIGRATION_DIR}/${filename}")" \
      >>"${output_file}"
  done
}

rehearsal_setup_main() {
  local database_url="${REHEARSAL_DATABASE_URL:-}"
  local production_database_url="${PRODUCTION_DATABASE_URL:-}"
  local production_project_ref="${PRODUCTION_PROJECT_REF:-}"
  local clone_id="${REHEARSAL_CLONE_ID:-}"
  local expected_baseline="${REHEARSAL_EXPECTED_BASELINE_VERSION:-}"
  local old_production_sha="${REHEARSAL_OLD_PRODUCTION_SHA:-}"
  local target_class="${REHEARSAL_TARGET_CLASS:-}"
  local expected_candidate_sha="${REHEARSAL_CANDIDATE_SHA:-}"
  local confirmation="${REHEARSAL_CONFIRM_NON_PRODUCTION:-}"
  local artifacts_dir=""
  local dry_run="false"
  local current_sha fingerprint

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --database-url) database_url="${2:-}"; shift 2 ;;
      --production-database-url) production_database_url="${2:-}"; shift 2 ;;
      --production-project-ref) production_project_ref="${2:-}"; shift 2 ;;
      --clone-id) clone_id="${2:-}"; shift 2 ;;
      --expected-baseline) expected_baseline="${2:-}"; shift 2 ;;
      --old-production-sha) old_production_sha="${2:-}"; shift 2 ;;
      --target-class) target_class="${2:-}"; shift 2 ;;
      --candidate-sha) expected_candidate_sha="${2:-}"; shift 2 ;;
      --artifacts-dir) artifacts_dir="${2:-}"; shift 2 ;;
      --confirm-non-production)
        confirmation="${REHEARSAL_CONFIRMATION_PHRASE}"
        shift
        ;;
      --dry-run) dry_run="true"; shift ;;
      --help|-h) rehearsal_usage; return 0 ;;
      *) rehearsal_die "unknown argument: $1"; return 1 ;;
    esac
  done

  rehearsal_validate_static_target \
    "${database_url}" \
    "${production_database_url}" \
    "${production_project_ref}" \
    "${target_class}" \
    "${clone_id}" \
    "${expected_baseline}" \
    "${confirmation}" \
    "${old_production_sha}"
  rehearsal_assert_manifest

  current_sha="$(git -C "${REHEARSAL_REPO_ROOT}" rev-parse HEAD)"
  if [[ -n "${expected_candidate_sha}" && "${current_sha}" != "${expected_candidate_sha}" ]]; then
    rehearsal_die "checkout ${current_sha} does not match candidate SHA ${expected_candidate_sha}"
    return 1
  fi
  rehearsal_validate_reviewed_base_against_candidate "${REHEARSAL_REVIEWED_BASE_SHA}" "${current_sha}"

  fingerprint="$(rehearsal_connection_fingerprint "${database_url}")"
  if [[ "${dry_run}" != "true" ]]; then
    rehearsal_validate_clone_guard_and_baseline "${database_url}" "${clone_id}" "${expected_baseline}"
  fi

  if [[ -z "${artifacts_dir}" ]]; then
    artifacts_dir="${REHEARSAL_REPO_ROOT}/qa-artifacts/rehearsals/setup-$(date -u '+%Y%m%dT%H%M%SZ')"
  fi
  mkdir -p "${artifacts_dir}"
  rehearsal_write_manifest "${artifacts_dir}/migration-manifest.tsv"
  cp "${REHEARSAL_REPORT_TEMPLATE}" "${artifacts_dir}/rehearsal-report.md"

  {
    printf 'validation=%s\n' "$([[ "${dry_run}" == "true" ]] && echo plan-only || echo clone-guard-and-baseline-passed)"
    printf 'created_at=%s\n' "$(rehearsal_now_utc)"
    printf 'candidate_sha=%s\n' "${current_sha}"
    printf 'old_production_sha=%s\n' "${REHEARSAL_REVIEWED_BASE_SHA}"
    printf 'target_class=%s\n' "${target_class}"
    printf 'clone_id=%s\n' "${clone_id}"
    printf 'connection_fingerprint=%s\n' "${fingerprint}"
    printf 'expected_baseline=%s\n' "${expected_baseline}"
    printf 'required_prerequisites=%s\n' "$(rehearsal_required_prerequisite_versions_csv)"
    printf 'observed_database_identity=%s\n' "${REHEARSAL_OBSERVED_DATABASE_IDENTITY:-not-queried}"
    printf 'source_snapshot=%s\n' "${REHEARSAL_OBSERVED_SOURCE_SNAPSHOT:-not-queried}"
    printf 'bundle_count=%s\n' "${#BUNDLE_MIGRATIONS[@]}"
    printf 'bundle_first=%s\n' "$(rehearsal_migration_version "${BUNDLE_MIGRATIONS[0]}")"
    printf 'bundle_last=%s\n' "$(rehearsal_migration_version "${BUNDLE_MIGRATIONS[21]}")"
  } >"${artifacts_dir}/setup-receipt.txt"

  if [[ "${dry_run}" == "true" ]]; then
    echo "Dry run passed: no database connection or mutation was attempted."
  else
    echo "Clone guard and baseline passed. No migration was applied."
  fi
  echo "Reviewed bundle: 22 migrations, 20260709114000 through 20260709178000."
  echo "Non-secret setup receipt: ${artifacts_dir}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rehearsal_setup_main "$@"
fi

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release/rehearse-bundle-setup.sh
source "${SCRIPT_DIR}/rehearse-bundle-setup.sh"

rehearsal_bundle_usage() {
  cat <<'USAGE'
Usage:
  REHEARSAL_DATABASE_URL='postgresql://...' \
  REHEARSAL_CLONE_ID='operator-clone-id' \
  REHEARSAL_EXPECTED_BASELINE_VERSION='20260709100000' \
  REHEARSAL_OLD_PRODUCTION_SHA='<full-reviewed-base-sha>' \
  REHEARSAL_TARGET_CLASS='clone' \
  PRODUCTION_PROJECT_REF='known-production-ref' \
  scripts/release/rehearse-bundle.sh --confirm-non-production [options]

Options are the same as rehearse-bundle-setup.sh, plus:
  --run-id ID                    Non-secret receipt identifier.
  --fail-at N                    Run migration N inside its transaction, inject
                                 a guaranteed failure before the ledger insert,
                                 prove rollback to N-1, and exit 42.
  --lock-timeout DURATION        PostgreSQL lock_timeout (default 10s).
  --statement-timeout DURATION   PostgreSQL statement_timeout (default 15min).
  --dry-run                      Print the exact plan without connecting or
                                 mutating a database.

Use a fresh clone for a complete run and a separate fresh clone for each
deliberate-failure run.
USAGE
}

rehearsal_bundle_versions_csv() {
  local filename separator=""
  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    printf '%s%s' "${separator}" "$(rehearsal_migration_version "${filename}")"
    separator=","
  done
}

rehearsal_query_last_committed_version() {
  local database_url="$1"
  rehearsal_psql_readonly "${database_url}" \
    "SELECT COALESCE(max(version), '') FROM supabase_migrations.schema_migrations;"
}

rehearsal_run_readonly_file() {
  local database_url="$1"
  local sql_file="$2"
  local log_file="$3"
  local readonly_options="${PGOPTIONS:-}"
  if [[ -n "${PGOPTIONS:-}" ]]; then
    readonly_options="${readonly_options} "
  fi
  readonly_options="${readonly_options}-c default_transaction_read_only=on"
  PGOPTIONS="${readonly_options}" \
    psql "${database_url}" -X -v ON_ERROR_STOP=1 -f "${sql_file}" \
    >"${log_file}" 2>&1
}

rehearsal_apply_migration() {
  local database_url="$1"
  local filename="$2"
  local log_file="$3"
  local lock_timeout="$4"
  local statement_timeout="$5"
  local inject_failure="${6:-false}"
  local version name ledger_sql migration_options injected_failure_sql
  local -a psql_args

  version="$(rehearsal_migration_version "${filename}")"
  name="$(rehearsal_migration_name "${filename}")"
  if [[ ! "${version}" =~ ^[0-9]{14}$ || ! "${name}" =~ ^[a-z0-9_]+$ ]]; then
    rehearsal_die "unsafe migration identity: ${filename}"
    return 1
  fi

  ledger_sql="INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES ('${version}', NULL, '${name}');"
  injected_failure_sql="DO \$rehearsal_injected_failure\$ BEGIN RAISE EXCEPTION 'rehearsal_injected_failure_at_${version}'; END \$rehearsal_injected_failure\$;"
  migration_options="${PGOPTIONS:-}"
  if [[ -n "${PGOPTIONS:-}" ]]; then
    migration_options="${migration_options} "
  fi
  migration_options="${migration_options}-c lock_timeout=${lock_timeout} -c statement_timeout=${statement_timeout}"

  # --single-transaction makes the SQL file and its ledger row one commit
  # boundary. A failed file cannot advance the recorded migration version.
  psql_args=(
    -X
    -v ON_ERROR_STOP=1
    --single-transaction
    -f "${REHEARSAL_MIGRATION_DIR}/${filename}"
  )
  if [[ "${inject_failure}" == "true" ]]; then
    psql_args+=(-c "${injected_failure_sql}")
  fi
  psql_args+=(-c "${ledger_sql}")

  PGOPTIONS="${migration_options}" \
    psql "${database_url}" "${psql_args[@]}" >"${log_file}" 2>&1
}

rehearsal_write_old_production_probe_manifest() {
  local manifest_file="$1"
  local method route route_source evidence_source role_name object_kind object_name privilege_name impact

  printf 'method\troute\troute_source_path\tevidence_source_path\trole_name\tobject_kind\tobject_name\tprivilege_name\timpact\n' >"${manifest_file}"
  while IFS='|' read -r method route route_source evidence_source role_name object_kind object_name privilege_name impact; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${method}" "${route}" "${route_source}" "${evidence_source}" "${role_name}" \
      "${object_kind}" "${object_name}" "${privilege_name}" "${impact}" >>"${manifest_file}"
  done <<'ROWS'
POST|/api/planner/plans|app/api/planner/plans/route.ts|app/api/planner/plans/route.ts|authenticated|table|public.plan_messages|INSERT|Old intake cannot persist its conversation.
POST|/api/planner/plans|app/api/planner/plans/route.ts|app/api/planner/plans/route.ts|authenticated|table|public.planner_plan_updates|INSERT|Old intake cannot persist derived updates.
POST|/api/planner/plans|app/api/planner/plans/route.ts|app/api/planner/plans/route.ts|authenticated|table|public.audit_logs|INSERT|Old intake cannot append its audit receipt.
PATCH|/api/planner/plans/[planId]|app/api/planner/plans/[planId]/route.ts|app/api/planner/plans/[planId]/route.ts|authenticated|table|public.approvals|UPDATE|Old plan edits cannot mark stale approvals for reapproval.
PATCH|/api/planner/plans/[planId]|app/api/planner/plans/[planId]/route.ts|app/api/planner/plans/[planId]/route.ts|authenticated|table|public.plan_messages|INSERT|Old plan edits cannot persist the visible status message.
PATCH|/api/planner/plans/[planId]|app/api/planner/plans/[planId]/route.ts|app/api/planner/plans/[planId]/route.ts|authenticated|table|public.planner_plan_updates|INSERT|Old plan edits cannot persist derived updates.
POST|/api/planner/plans/[planId]/messages|app/api/planner/plans/[planId]/messages/route.ts|app/api/planner/plans/[planId]/messages/route.ts|authenticated|table|public.plan_messages|INSERT|Old conversation writes are revoked.
POST|/api/planner/plans/[planId]/messages|app/api/planner/plans/[planId]/messages/route.ts|app/api/planner/plans/[planId]/messages/route.ts|authenticated|table|public.agent_actions|INSERT|Old conversation flow cannot create trusted actions.
POST|/api/planner/plans/[planId]/messages|app/api/planner/plans/[planId]/messages/route.ts|app/api/planner/plans/[planId]/messages/route.ts|authenticated|table|public.approvals|INSERT|Old conversation flow cannot create approvals.
POST|/api/planner/plans/[planId]/messages|app/api/planner/plans/[planId]/messages/route.ts|app/api/planner/plans/[planId]/messages/route.ts|authenticated|table|public.planner_plan_updates|INSERT|Old conversation flow cannot persist derived updates.
POST|/api/planner/plans/[planId]/messages|app/api/planner/plans/[planId]/messages/route.ts|app/api/planner/plans/[planId]/messages/route.ts|authenticated|table|public.audit_logs|INSERT|Old conversation flow cannot append its audit receipt.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.agent_actions|INSERT|Old recommendation flow cannot create trusted actions.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.approvals|INSERT|Old recommendation flow cannot create approvals.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.plan_messages|INSERT|Old recommendation flow cannot persist approval cards.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.admin_tasks|INSERT|Old recommendation flow cannot enqueue catalog gap work.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.plan_versions|INSERT|Old recommendation flow cannot persist its plan version.
POST|/api/planner/plans/[planId]/recommend|app/api/planner/plans/[planId]/recommend/route.ts|app/api/planner/plans/[planId]/recommend/route.ts|authenticated|table|public.audit_logs|INSERT|Old recommendation flow cannot append its audit receipt.
POST|/api/planner/plans/[planId]/agent-actions|app/api/planner/plans/[planId]/agent-actions/route.ts|app/api/planner/plans/[planId]/agent-actions/route.ts|authenticated|table|public.agent_actions|INSERT|Old action route cannot create trusted state.
POST|/api/planner/plans/[planId]/agent-actions|app/api/planner/plans/[planId]/agent-actions/route.ts|app/api/planner/plans/[planId]/agent-actions/route.ts|authenticated|table|public.approvals|INSERT|Old action route cannot create approvals.
POST|/api/planner/plans/[planId]/agent-actions|app/api/planner/plans/[planId]/agent-actions/route.ts|app/api/planner/plans/[planId]/agent-actions/route.ts|authenticated|table|public.agent_actions|UPDATE|Old action route cannot link approvals.
POST|/api/planner/plans/[planId]/agent-actions|app/api/planner/plans/[planId]/agent-actions/route.ts|app/api/planner/plans/[planId]/agent-actions/route.ts|authenticated|table|public.plan_messages|INSERT|Old action route cannot write approval cards.
POST|/api/planner/plans/[planId]/agent-actions|app/api/planner/plans/[planId]/agent-actions/route.ts|app/api/planner/plans/[planId]/agent-actions/route.ts|authenticated|table|public.agent_action_audit_log|INSERT|Old action route cannot write audit state.
PATCH|/api/planner/plans/[planId]/approvals|app/api/planner/plans/[planId]/approvals/route.ts|app/api/planner/plans/[planId]/approvals/route.ts|authenticated|table|public.approvals|UPDATE|Old approval authorization cannot mutate approvals.
PATCH|/api/planner/plans/[planId]/approvals|app/api/planner/plans/[planId]/approvals/route.ts|app/api/planner/plans/[planId]/approvals/route.ts|authenticated|table|public.agent_actions|UPDATE|Old approval authorization cannot advance actions.
PATCH|/api/planner/plans/[planId]/approvals|app/api/planner/plans/[planId]/approvals/route.ts|app/api/planner/plans/[planId]/approvals/route.ts|authenticated|table|public.plan_messages|INSERT|Old approval route cannot write status cards.
PATCH|/api/planner/plans/[planId]/approvals|app/api/planner/plans/[planId]/approvals/route.ts|app/api/planner/plans/[planId]/approvals/route.ts|authenticated|table|public.agent_action_audit_log|INSERT|Old approval route cannot write audit state.
POST|/api/planner/outreach/gmail-approval|app/api/planner/outreach/gmail-approval/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.agent_actions|INSERT|Old Gmail approval preparation cannot create actions.
POST|/api/planner/outreach/gmail-approval|app/api/planner/outreach/gmail-approval/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.approvals|INSERT|Old Gmail approval preparation cannot create approvals.
POST|/api/planner/outreach/gmail-approval|app/api/planner/outreach/gmail-approval/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.plan_messages|INSERT|Old Gmail approval preparation cannot create cards.
POST|/api/planner/plans/[planId]/outreach/approve-batch|app/api/planner/plans/[planId]/outreach/approve-batch/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.agent_actions|INSERT|Old batch outreach preparation cannot create actions.
POST|/api/planner/plans/[planId]/outreach/approve-batch|app/api/planner/plans/[planId]/outreach/approve-batch/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.approvals|INSERT|Old batch outreach preparation cannot create approvals.
POST|/api/planner/plans/[planId]/outreach/approve-batch|app/api/planner/plans/[planId]/outreach/approve-batch/route.ts|lib/outreach/gmailApprovalFlow.ts|authenticated|table|public.plan_messages|INSERT|Old batch outreach preparation cannot create cards.
POST|/api/planner/templates/[id]/apply|app/api/planner/templates/[id]/apply/route.ts|app/api/planner/templates/[id]/apply/route.ts|authenticated|table|public.plan_messages|INSERT|Old template apply cannot persist the cloned plan message.
POST|/api/venue/bulk-approval/approve|app/api/venue/bulk-approval/approve/route.ts|app/api/venue/bulk-approval/approve/route.ts|authenticated|table|public.venue_booking_approval_audit|INSERT|Old venue bulk approval cannot append its audit receipt.
POST|/api/planner/plans/[planId]/revisions|app/api/planner/plans/[planId]/revisions/route.ts|lib/planner/planRevisions.ts|authenticated|function|public.apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)|EXECUTE|The reviewed revision RPC remains the authenticated compatibility control.
POST|/api/planner/plans/[planId]/payments/authorize|app/api/planner/plans/[planId]/payments/authorize/route.ts|lib/planner/depositPayments.ts|service_role|table|public.payment_intents|INSERT|Old payment authorization already writes with the service role.
POST|/api/planner/plans/[planId]/payments/authorize|app/api/planner/plans/[planId]/payments/authorize/route.ts|lib/planner/execution/executeApprovedAction.ts|service_role|table|public.agent_actions|UPDATE|Old payment authorization action transition remains server owned.
POST|/api/payments/capture|app/api/payments/capture/route.ts|lib/planner/depositPayments.ts|service_role|table|public.payment_intents|UPDATE|Old capture writes the payment ledger with the service role.
POST|/api/payments/capture|app/api/payments/capture/route.ts|lib/planner/depositPayments.ts|service_role|table|public.payouts|INSERT|Old capture writes the payout ledger with the service role.
POST|/api/payments/capture|app/api/payments/capture/route.ts|lib/planner/execution/executeApprovedAction.ts|service_role|table|public.agent_actions|UPDATE|Old capture action transition remains server owned.
ROWS
}

rehearsal_sql_literal() {
  local value="$1"
  if [[ "${value}" == *"'"* ]]; then
    rehearsal_die "old-code probe manifest contains an unsupported quote"
    return 1
  fi
  printf "'%s'" "${value}"
}

rehearsal_validate_old_production_probe_sources() {
  local manifest_file="$1"
  local source_inventory_file="$2"
  local source_path role_name route_source evidence_source object_kind object_name
  local source_blob object_basename source_pattern
  local blob_cache="${source_inventory_file}.blob-cache"

  : >"${blob_cache}"
  while IFS= read -r source_path; do
    [[ -z "${source_path}" ]] && continue
    if ! git -C "${REHEARSAL_REPO_ROOT}" cat-file -e "${REHEARSAL_REVIEWED_BASE_SHA}:${source_path}" 2>/dev/null; then
      rm -f "${blob_cache}"
      rehearsal_die "reviewed base is missing representative source: ${source_path}"
      return 1
    fi
    source_blob="$(git -C "${REHEARSAL_REPO_ROOT}" rev-parse "${REHEARSAL_REVIEWED_BASE_SHA}:${source_path}")"
    printf '%s\t%s\n' "${source_path}" "${source_blob}" >>"${blob_cache}"
  done < <(
    awk -F '\t' 'NR > 1 { print $3; print $4 }' "${manifest_file}" |
      LC_ALL=C sort -u
  )

  while IFS=$'\t' read -r role_name route_source; do
    if [[ "${role_name}" == "authenticated" ]]; then
      if ! git -C "${REHEARSAL_REPO_ROOT}" grep -F -q 'createClient' "${REHEARSAL_REVIEWED_BASE_SHA}" -- "${route_source}"; then
        rm -f "${blob_cache}"
        rehearsal_die "authenticated route probe is not tied to a browser-client source: ${route_source}"
        return 1
      fi
    elif [[ "${role_name}" == "service_role" ]]; then
      if ! git -C "${REHEARSAL_REPO_ROOT}" grep -F -q 'createServiceRoleClient' "${REHEARSAL_REVIEWED_BASE_SHA}" -- "${route_source}"; then
        rm -f "${blob_cache}"
        rehearsal_die "service-role route probe is not tied to a service-client source: ${route_source}"
        return 1
      fi
    else
      rm -f "${blob_cache}"
      rehearsal_die "unsupported old-code probe role: ${role_name}"
      return 1
    fi
  done < <(
    awk -F '\t' 'NR > 1 { print $5 "\t" $3 }' "${manifest_file}" |
      LC_ALL=C sort -u
  )

  while IFS=$'\t' read -r evidence_source object_kind object_name; do
    object_basename="${object_name#public.}"
    object_basename="${object_basename%%(*}"
    if [[ "${object_kind}" == "table" ]]; then
      source_pattern=".from('${object_basename}')"
    elif [[ "${object_kind}" == "function" ]]; then
      source_pattern=".rpc('${object_basename}'"
    else
      rm -f "${blob_cache}"
      rehearsal_die "unsupported old-code probe object kind: ${object_kind}"
      return 1
    fi
    if ! git -C "${REHEARSAL_REPO_ROOT}" grep -F -q "${source_pattern}" "${REHEARSAL_REVIEWED_BASE_SHA}" -- "${evidence_source}"; then
      rm -f "${blob_cache}"
      rehearsal_die "reviewed base source no longer contains ${object_kind} evidence for ${object_name}: ${evidence_source}"
      return 1
    fi
  done < <(
    awk -F '\t' 'NR > 1 { print $4 "\t" $6 "\t" $7 }' "${manifest_file}" |
      LC_ALL=C sort -u
  )

  awk -F '\t' -v OFS='\t' -v source_sha="${REHEARSAL_REVIEWED_BASE_SHA}" '
    NR == FNR { blob[$1] = $2; next }
    FNR == 1 {
      print "reviewed_base_sha", "method", "route", "route_source_path", "route_blob_sha", "evidence_source_path", "evidence_blob_sha", "role_name", "object_kind", "object_name", "privilege_name"
      next
    }
    {
      print source_sha, $1, $2, $3, blob[$3], $4, blob[$4], $5, $6, $7, $8
    }
  ' "${blob_cache}" "${manifest_file}" >"${source_inventory_file}"
  rm -f "${blob_cache}"
}

rehearsal_run_old_production_compatibility() {
  local database_url="$1"
  local probes_file="$2"
  local breakage_file="$3"
  local manifest_file="$4"
  local source_inventory_file="$5"
  local method route route_source evidence_source role_name object_kind object_name privilege_name impact
  local query readonly_options values_sql="" separator=""

  while IFS=$'\t' read -r method route route_source evidence_source role_name object_kind object_name privilege_name impact; do
    [[ "${method}" == "method" ]] && continue
    values_sql+="${separator}($(rehearsal_sql_literal "${method}"),$(rehearsal_sql_literal "${route}"),$(rehearsal_sql_literal "${route_source}"),$(rehearsal_sql_literal "${evidence_source}"),$(rehearsal_sql_literal "${role_name}"),$(rehearsal_sql_literal "${object_kind}"),$(rehearsal_sql_literal "${object_name}"),$(rehearsal_sql_literal "${privilege_name}"),$(rehearsal_sql_literal "${impact}"))"
    separator=","
  done <"${manifest_file}"

  query="$(cat <<SQL
WITH probes(method, route, route_source_path, evidence_source_path, role_name, object_kind, object_name, privilege_name, impact) AS (
  VALUES ${values_sql}
), evaluated AS (
  SELECT
    probes.*,
    CASE object_kind
      WHEN 'table' THEN has_table_privilege(role_name, object_name, privilege_name)
      WHEN 'function' THEN has_function_privilege(role_name, object_name, privilege_name)
      ELSE false
    END AS compatible
  FROM probes
)
SELECT
  method,
  route,
  role_name,
  object_kind,
  object_name,
  privilege_name,
  CASE WHEN compatible THEN 'compatible' ELSE 'breaks' END AS status,
  impact,
  route_source_path,
  evidence_source_path
FROM evaluated
ORDER BY route, method, object_kind, object_name, privilege_name;
SQL
)"

  readonly_options="${PGOPTIONS:-}"
  if [[ -n "${PGOPTIONS:-}" ]]; then
    readonly_options="${readonly_options} "
  fi
  readonly_options="${readonly_options}-c default_transaction_read_only=on"
  PGOPTIONS="${readonly_options}" \
    psql "${database_url}" \
      -X \
      -v ON_ERROR_STOP=1 \
      -A \
      -F $'\t' \
      -P footer=off \
      -c "${query}" \
      >"${probes_file}"

  awk -F '\t' -v source_sha="${REHEARSAL_REVIEWED_BASE_SHA}" -v source_inventory="$(basename "${source_inventory_file}")" '
    NR == 1 { next }
    {
      key = $1 SUBSEP $2
      if (!(key in seen)) {
        seen[key] = 1
        order[++count] = key
        method[key] = $1
        route[key] = $2
        compatible[key] = 1
      }
      if ($7 == "breaks") {
        compatible[key] = 0
        reason = $3 " lacks " $6 " on " $5
        if (reasons[key] != "") reasons[key] = reasons[key] "; "
        reasons[key] = reasons[key] reason
      }
    }
    END {
      print "# Old production route compatibility"
      print ""
      print "Source code: `" source_sha "`. Every route and helper blob is frozen in `" source_inventory "`. These are representative database-privilege probes against the migrated clone; no payment or outbound send was executed."
      print ""
      print "## Breakage list"
      print ""
      broken = 0
      for (i = 1; i <= count; i++) {
        key = order[i]
        if (!compatible[key]) {
          broken++
          print "- `" method[key] " " route[key] "` — BREAKS: " reasons[key] "."
        }
      }
      if (broken == 0) print "- None detected by the representative probe set."
      print ""
      print "## Compatible representative routes"
      print ""
      passing = 0
      for (i = 1; i <= count; i++) {
        key = order[i]
        if (compatible[key]) {
          passing++
          print "- `" method[key] " " route[key] "` — required database privilege remains available."
        }
      }
      if (passing == 0) print "- None."
    }
  ' "${probes_file}" >"${breakage_file}"
}

rehearsal_render_report() {
  local report_file="$1"
  local status="$2"
  local run_id="$3"
  local candidate_sha="$4"
  local clone_id="$5"
  local fingerprint="$6"
  local expected_baseline="$7"
  local started_at="$8"
  local finished_at="$9"
  local last_committed="${10}"
  local timings_file="${11}"
  local breakage_file="${12}"
  local deliberate_failure_file="${13}"
  local total_apply_duration_ms

  total_apply_duration_ms="$(awk -F '\t' '
    NR > 1 && $4 ~ /^[0-9]+$/ { total += $4; count++ }
    END { if (count == 0) print "not-started"; else print total }
  ' "${timings_file}")"

  {
    printf '\n### Generated run receipt\n\n'
    printf -- '- Status: `%s`\n' "${status}"
    printf -- '- Run ID: `%s`\n' "${run_id}"
    printf -- '- Candidate SHA: `%s`\n' "${candidate_sha}"
    printf -- '- Old production SHA: `%s`\n' "${REHEARSAL_REVIEWED_BASE_SHA}"
    printf -- '- Clone ID: `%s`\n' "${clone_id}"
    printf -- '- Connection fingerprint: `%s`\n' "${fingerprint}"
    printf -- '- Expected baseline: `%s`\n' "${expected_baseline}"
    printf -- '- Clone source snapshot: `%s`\n' "${REHEARSAL_OBSERVED_SOURCE_SNAPSHOT:-not-queried}"
    printf -- '- Started: `%s`\n' "${started_at}"
    printf -- '- Finished: `%s`\n' "${finished_at}"
    printf -- '- Last committed version: `%s`\n' "${last_committed:-unknown}"
    printf -- '- Total migration apply duration (ms): `%s`\n\n' "${total_apply_duration_ms}"
    printf '#### Migration timings\n\n'
    printf '| Ordinal | Version | Filename | Duration (ms) | Result | Last committed |\n'
    printf '| ---: | --- | --- | ---: | --- | --- |\n'
    if [[ -f "${timings_file}" ]]; then
      awk -F '\t' 'NR > 1 { printf "| %s | `%s` | `%s` | %s | %s | `%s` |\n", $1, $2, $3, $4, $5, $6 }' "${timings_file}"
    fi
    printf '\n#### Deliberate failure\n\n'
    if [[ -f "${deliberate_failure_file}" ]]; then
      printf '```text\n'
      sed -n '1,80p' "${deliberate_failure_file}"
      printf '```\n'
    else
      printf 'Not requested for this run.\n'
    fi
    printf '\n#### Compatibility evidence\n\n'
    if [[ -f "${breakage_file}" ]]; then
      sed -n '1,240p' "${breakage_file}"
    else
      printf 'Not reached in this run.\n'
    fi
  } >>"${report_file}"
}

rehearsal_bundle_main() {
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
  local run_id=""
  local fail_at=""
  local dry_run="false"
  local lock_timeout="${REHEARSAL_LOCK_TIMEOUT:-10s}"
  local statement_timeout="${REHEARSAL_STATEMENT_TIMEOUT:-15min}"
  local candidate_sha fingerprint started_at finished_at last_committed
  local timings_file report_file breakage_file probes_file deliberate_failure_file
  local probe_manifest_file source_inventory_file
  local ordinal filename version expected_previous observed_previous
  local start_ms end_ms duration_ms migration_log expected_versions observed_versions inject_current

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
      --run-id) run_id="${2:-}"; shift 2 ;;
      --fail-at) fail_at="${2:-}"; shift 2 ;;
      --lock-timeout) lock_timeout="${2:-}"; shift 2 ;;
      --statement-timeout) statement_timeout="${2:-}"; shift 2 ;;
      --confirm-non-production)
        confirmation="${REHEARSAL_CONFIRMATION_PHRASE}"
        shift
        ;;
      --dry-run) dry_run="true"; shift ;;
      --help|-h) rehearsal_bundle_usage; return 0 ;;
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
  rehearsal_require_commands psql node awk sed sort

  if [[ -n "${fail_at}" ]]; then
    if [[ ! "${fail_at}" =~ ^[0-9]+$ ]] || [[ "${fail_at}" -lt 1 ]] || [[ "${fail_at}" -gt 23 ]]; then
      rehearsal_die "--fail-at must be an integer from 1 through 23"
      return 1
    fi
  fi

  candidate_sha="$(git -C "${REHEARSAL_REPO_ROOT}" rev-parse HEAD)"
  if [[ -n "${expected_candidate_sha}" && "${candidate_sha}" != "${expected_candidate_sha}" ]]; then
    rehearsal_die "checkout ${candidate_sha} does not match candidate SHA ${expected_candidate_sha}"
    return 1
  fi
  rehearsal_validate_reviewed_base_against_candidate "${REHEARSAL_REVIEWED_BASE_SHA}" "${candidate_sha}"
  fingerprint="$(rehearsal_connection_fingerprint "${database_url}")"
  started_at="$(rehearsal_now_utc)"
  if [[ -z "${run_id}" ]]; then
    run_id="bundle-$(date -u '+%Y%m%dT%H%M%SZ')"
  fi
  if [[ ! "${run_id}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    rehearsal_die "run id must contain only letters, numbers, dot, underscore, or hyphen"
    return 1
  fi
  if [[ -z "${artifacts_dir}" ]]; then
    artifacts_dir="${REHEARSAL_REPO_ROOT}/qa-artifacts/rehearsals/${run_id}"
  fi
  mkdir -p "${artifacts_dir}/logs"
  timings_file="${artifacts_dir}/migration-timings.tsv"
  report_file="${artifacts_dir}/rehearsal-report.md"
  probes_file="${artifacts_dir}/old-production-compatibility-probes.tsv"
  breakage_file="${artifacts_dir}/old-production-route-breakage-list.md"
  probe_manifest_file="${artifacts_dir}/old-production-route-probe-manifest.tsv"
  source_inventory_file="${artifacts_dir}/old-production-source-inventory.tsv"
  deliberate_failure_file="${artifacts_dir}/deliberate-failure-proof.txt"
  printf 'ordinal\tversion\tfilename\tduration_ms\tresult\tlast_committed_version\n' >"${timings_file}"
  rehearsal_write_manifest "${artifacts_dir}/migration-manifest.tsv"
  cp "${REHEARSAL_REPORT_TEMPLATE}" "${report_file}"
  rehearsal_write_old_production_probe_manifest "${probe_manifest_file}"
  rehearsal_validate_old_production_probe_sources "${probe_manifest_file}" "${source_inventory_file}"

  if [[ "${dry_run}" == "true" ]]; then
    echo "DRY RUN: no database connection or mutation will be attempted."
    echo "Plan: preflight before, exactly 23 serial migrations, preflight after, three verifiers, old-production compatibility probes."
    ordinal=0
    for filename in "${BUNDLE_MIGRATIONS[@]}"; do
      ordinal=$((ordinal + 1))
      printf '%02d %s\n' "${ordinal}" "${filename}"
    done
    if [[ -n "${fail_at}" ]]; then
      if [[ "${fail_at}" -eq 1 ]]; then
        expected_previous="${expected_baseline}"
      else
        expected_previous="$(rehearsal_migration_version "${BUNDLE_MIGRATIONS[$((fail_at - 2))]}")"
      fi
      echo "Deliberate failure plan: run migration ${fail_at} inside one transaction, inject a failure before its ledger insert, and prove rollback to ${expected_previous}."
    fi
    echo "Verifier: scripts/release/verify-plan-supply-intents.sql"
    echo "Verifier: scripts/security/verify-hosted-acls.sql"
    echo "Verifier: scripts/security/verify-hosted-control-plane.sql"
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report \
      "${report_file}" \
      "dry_run_no_database_connection" \
      "${run_id}" \
      "${candidate_sha}" \
      "${clone_id}" \
      "${fingerprint}" \
      "${expected_baseline}" \
      "${started_at}" \
      "${finished_at}" \
      "not-queried" \
      "${timings_file}" \
      "${breakage_file}" \
      "${deliberate_failure_file}"
    echo "Dry-run receipt: ${artifacts_dir}"
    return 0
  fi

  rehearsal_validate_clone_guard_and_baseline "${database_url}" "${clone_id}" "${expected_baseline}"
  last_committed="$(rehearsal_query_last_committed_version "${database_url}")"
  printf '%s\n' "${last_committed}" >"${artifacts_dir}/last-committed-version.txt"

  if ! rehearsal_run_readonly_file \
    "${database_url}" \
    "${REHEARSAL_REPO_ROOT}/scripts/security/preflight-server-owned-execution.sql" \
    "${artifacts_dir}/logs/preflight-before.log"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "preflight_before_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "pre-migration control-plane preflight failed; see ${artifacts_dir}/logs/preflight-before.log"
    return 1
  fi

  ordinal=0
  for filename in "${BUNDLE_MIGRATIONS[@]}"; do
    ordinal=$((ordinal + 1))
    version="$(rehearsal_migration_version "${filename}")"
    migration_log="${artifacts_dir}/logs/migration-${ordinal}-${version}.log"

    inject_current="false"
    expected_previous=""
    if [[ -n "${fail_at}" && "${ordinal}" -eq "${fail_at}" ]]; then
      inject_current="true"
      if [[ "${ordinal}" -eq 1 ]]; then
        expected_previous="${expected_baseline}"
      else
        expected_previous="$(rehearsal_migration_version "${BUNDLE_MIGRATIONS[$((ordinal - 2))]}")"
      fi
    fi

    start_ms="$(rehearsal_now_ms)"
    if ! rehearsal_apply_migration \
      "${database_url}" \
      "${filename}" \
      "${migration_log}" \
      "${lock_timeout}" \
      "${statement_timeout}" \
      "${inject_current}"; then
      end_ms="$(rehearsal_now_ms)"
      duration_ms=$((end_ms - start_ms))
      last_committed="$(rehearsal_query_last_committed_version "${database_url}" || echo unknown)"

      if [[ "${inject_current}" == "true" ]]; then
        observed_previous="${last_committed}"
        if ! grep -Fq "rehearsal_injected_failure_at_${version}" "${migration_log}"; then
          printf '%s\t%s\t%s\t%s\tmigration_failed_before_deliberate_injection\t%s\n' \
            "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${observed_previous}" >>"${timings_file}"
          printf '%s\n' "${observed_previous}" >"${artifacts_dir}/last-committed-version.txt"
          {
            printf 'fail_at=%s\n' "${ordinal}"
            printf 'migration_expected_in_transaction=%s\n' "${version}"
            printf 'injected_failure_expected=rehearsal_injected_failure_at_%s\n' "${version}"
            printf 'injected_failure_observed=false\n'
            printf 'observed_previous=%s\n' "${observed_previous}"
            printf 'proof=FAILED\n'
          } >"${deliberate_failure_file}"
          finished_at="$(rehearsal_now_utc)"
          rehearsal_render_report "${report_file}" "migration_${ordinal}_failed_before_deliberate_injection" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${observed_previous}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
          rehearsal_die "migration ${ordinal} (${filename}) failed before the deliberate failure sentinel executed; see ${migration_log}"
          return 1
        fi
        printf '%s\t%s\t%s\t%s\tdeliberate_failure_rolled_back\t%s\n' \
          "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${observed_previous}" >>"${timings_file}"
        printf '%s\n' "${observed_previous}" >"${artifacts_dir}/last-committed-version.txt"
        if [[ "${observed_previous}" != "${expected_previous}" ]]; then
          {
            printf 'fail_at=%s\n' "${ordinal}"
            printf 'migration_executed_in_transaction=%s\n' "${version}"
            printf 'expected_previous=%s\n' "${expected_previous}"
            printf 'observed_previous=%s\n' "${observed_previous}"
            printf 'proof=FAILED\n'
          } >"${deliberate_failure_file}"
          finished_at="$(rehearsal_now_utc)"
          rehearsal_render_report "${report_file}" "deliberate_failure_proof_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${observed_previous}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
          rehearsal_die "deliberate migration failure did not roll the ledger back to N-1"
          return 1
        fi
        {
          printf 'fail_at=%s\n' "${ordinal}"
          printf 'migration_executed_in_transaction=%s\n' "${version}"
          printf 'injected_failure=rehearsal_injected_failure_at_%s\n' "${version}"
          printf 'expected_previous=%s\n' "${expected_previous}"
          printf 'observed_previous=%s\n' "${observed_previous}"
          printf 'transaction_rollback=PASS\n'
          printf 'proof=PASS\n'
          printf 'exit_code=42\n'
        } >"${deliberate_failure_file}"
        finished_at="$(rehearsal_now_utc)"
        rehearsal_render_report "${report_file}" "deliberate_failure_verified" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${observed_previous}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
        echo "Deliberate failure verified at migration ${ordinal}: transaction rolled back; ledger remains at ${observed_previous}." >&2
        exit 42
      fi

      printf '%s\t%s\t%s\t%s\tfailed\t%s\n' \
        "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${last_committed}" >>"${timings_file}"
      printf '%s\n' "${last_committed}" >"${artifacts_dir}/last-committed-version.txt"
      finished_at="$(rehearsal_now_utc)"
      rehearsal_render_report "${report_file}" "migration_${ordinal}_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
      rehearsal_die "migration ${ordinal} (${filename}) failed; see ${migration_log}"
      return 1
    fi

    if [[ "${inject_current}" == "true" ]]; then
      end_ms="$(rehearsal_now_ms)"
      duration_ms=$((end_ms - start_ms))
      last_committed="$(rehearsal_query_last_committed_version "${database_url}" || echo unknown)"
      printf '%s\t%s\t%s\t%s\tinjected_failure_unexpectedly_committed\t%s\n' \
        "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${last_committed}" >>"${timings_file}"
      printf 'fail_at=%s\nmigration=%s\nobserved_previous=%s\nproof=FAILED\n' \
        "${ordinal}" "${version}" "${last_committed}" >"${deliberate_failure_file}"
      finished_at="$(rehearsal_now_utc)"
      rehearsal_render_report "${report_file}" "deliberate_failure_injection_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
      rehearsal_die "deliberate migration failure unexpectedly committed"
      return 1
    fi
    end_ms="$(rehearsal_now_ms)"
    duration_ms=$((end_ms - start_ms))
    last_committed="$(rehearsal_query_last_committed_version "${database_url}")"
    if [[ "${last_committed}" != "${version}" ]]; then
      printf '%s\t%s\t%s\t%s\tledger_mismatch\t%s\n' \
        "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${last_committed}" >>"${timings_file}"
      printf '%s\n' "${last_committed}" >"${artifacts_dir}/last-committed-version.txt"
      finished_at="$(rehearsal_now_utc)"
      rehearsal_render_report "${report_file}" "migration_${ordinal}_ledger_mismatch" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
      rehearsal_die "migration ${ordinal} applied but ledger does not end at ${version}"
      return 1
    fi
    printf '%s\t%s\t%s\t%s\tpassed\t%s\n' \
      "${ordinal}" "${version}" "${filename}" "${duration_ms}" "${last_committed}" >>"${timings_file}"
    printf '%s\n' "${last_committed}" >"${artifacts_dir}/last-committed-version.txt"
  done

  expected_versions="$(rehearsal_bundle_versions_csv)"
  observed_versions="$(rehearsal_psql_readonly "${database_url}" \
    "SELECT COALESCE(string_agg(version, ',' ORDER BY version), '') FROM supabase_migrations.schema_migrations WHERE version IN ($(rehearsal_bundle_versions_sql));")"
  if [[ "${observed_versions}" != "${expected_versions}" || "${last_committed}" != "20260709178000" ]]; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "final_bundle_ledger_mismatch" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "final clone ledger does not contain exactly the reviewed 23-version bundle"
    return 1
  fi

  if ! rehearsal_run_readonly_file "${database_url}" "${REHEARSAL_REPO_ROOT}/scripts/security/preflight-server-owned-execution.sql" "${artifacts_dir}/logs/preflight-after.log"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "preflight_after_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "post-migration control-plane preflight failed"
    return 1
  fi

  if ! rehearsal_run_readonly_file "${database_url}" "${REHEARSAL_REPO_ROOT}/scripts/release/verify-plan-supply-intents.sql" "${artifacts_dir}/logs/verify-plan-supply-intents.log"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "verify_plan_supply_intents_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "plan supply-intents verifier failed"
    return 1
  fi
  if ! rehearsal_run_readonly_file "${database_url}" "${REHEARSAL_REPO_ROOT}/scripts/security/verify-hosted-acls.sql" "${artifacts_dir}/logs/verify-hosted-acls.log"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "verify_hosted_acls_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "hosted ACL verifier failed"
    return 1
  fi
  if ! rehearsal_run_readonly_file "${database_url}" "${REHEARSAL_REPO_ROOT}/scripts/security/verify-hosted-control-plane.sql" "${artifacts_dir}/logs/verify-hosted-control-plane.log"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "verify_hosted_control_plane_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "hosted control-plane verifier failed"
    return 1
  fi

  if ! rehearsal_run_old_production_compatibility \
    "${database_url}" \
    "${probes_file}" \
    "${breakage_file}" \
    "${probe_manifest_file}" \
    "${source_inventory_file}"; then
    finished_at="$(rehearsal_now_utc)"
    rehearsal_render_report "${report_file}" "old_production_compatibility_probe_failed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
    rehearsal_die "old-production compatibility probe failed"
    return 1
  fi

  finished_at="$(rehearsal_now_utc)"
  rehearsal_render_report "${report_file}" "passed" "${run_id}" "${candidate_sha}" "${clone_id}" "${fingerprint}" "${expected_baseline}" "${started_at}" "${finished_at}" "${last_committed}" "${timings_file}" "${breakage_file}" "${deliberate_failure_file}"
  echo "Rehearsal passed on disposable clone ${clone_id}."
  echo "Last committed version: ${last_committed}."
  echo "Report: ${report_file}"
}

rehearsal_bundle_main "$@"

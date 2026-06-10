#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep is required for tied-house compliance checks." >&2
  exit 1
fi

DEFAULT_TARGETS=(
  "lib/finance/community-host-incentive"
  "app/api/venue/community-host-incentive"
  "lib/server/venue-website-extractor.ts"
  "lib/ai/agents/contactDisambiguationAgent.ts"
  "app/api/internal/jobs/venue-website-extraction"
)

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=("${DEFAULT_TARGETS[@]}")
fi

EXISTING_TARGETS=()
for target in "${TARGETS[@]}"; do
  if [ -e "$ROOT_DIR/$target" ]; then
    EXISTING_TARGETS+=("$target")
  fi
done

if [ "${#EXISTING_TARGETS[@]}" -eq 0 ]; then
  echo "No tied-house compliance targets exist yet."
  exit 0
fi

PATTERN='kickback|rev_share|revenue_share|revenue[[:space:]-]+share|bar[[:space:]_-]+split|percentage[[:space:]_-]+of[[:space:]_-]+(pos|bar|alcohol|f[&[:space:]]*b|venue[[:space:]_-]+revenue|total[[:space:]_-]+revenue)'

cd "$ROOT_DIR"

if rg \
  --glob '!lib/finance/community-host-incentive/compliance.ts' \
  --glob '!lib/finance/community-host-incentive/__tests__/compliance.test.ts' \
  -n -i "$PATTERN" "${EXISTING_TARGETS[@]}" >/tmp/3rdplace-tied-house-findings.txt; then
  echo "Tied-house compliance check failed. Forbidden settlement framing found:" >&2
  cat /tmp/3rdplace-tied-house-findings.txt >&2
  exit 1
fi

rm -f /tmp/3rdplace-tied-house-findings.txt
echo "Tied-house compliance check passed for scoped CHI/outreach targets."

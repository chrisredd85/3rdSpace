#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="${TIED_HOUSE_STRICT_OUTPUT:-$ROOT_DIR/qa-artifacts/tied-house-violations.txt}"
MIGRATION_CUTOFF="20260601000000"

PATTERN='kickback|kick_back|kick-back|rev_share|revShare|RevShare|revenue_share|revenueShare|bar_split|barSplit|bar_kickback|headcount_kickback|per_head_kickback'
DEFAULT_TARGETS=(
  "app"
  "lib"
  "components"
  "supabase/migrations"
  "supabase/seeds"
)

mkdir -p "$(dirname "$OUTPUT_FILE")"
: > "$OUTPUT_FILE"

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=("${DEFAULT_TARGETS[@]}")
fi

FILES=()

should_skip_file() {
  local file="$1"
  local rel="${file#$ROOT_DIR/}"
  local base
  base="$(basename "$rel")"

  case "$rel" in
    node_modules/*|.next/*|dist/*|build/*|qa-artifacts/*) return 0 ;;
    */node_modules/*|*/.next/*|*/dist/*|*/build/*|*/qa-artifacts/*) return 0 ;;
    __tests__/*|*/__tests__/*) return 0 ;;
    *.test.ts|*.test.tsx) return 0 ;;
  esac

  case "$rel" in
    supabase/migrations/*)
      local version="${base%%_*}"
      if [[ "$version" =~ ^[0-9]+$ ]] && [[ "$version" < "$MIGRATION_CUTOFF" ]]; then
        return 0
      fi
      ;;
  esac

  return 1
}

add_file_if_scannable() {
  local file="$1"
  [ -f "$file" ] || return 0
  if should_skip_file "$file"; then
    return 0
  fi
  FILES+=("$file")
}

for target in "${TARGETS[@]}"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' file; do
      add_file_if_scannable "$file"
    done < <(find "$target" -type f -print0)
  elif [ -d "$ROOT_DIR/$target" ]; then
    while IFS= read -r -d '' file; do
      add_file_if_scannable "$file"
    done < <(find "$ROOT_DIR/$target" -type f -print0)
  elif [ -f "$target" ]; then
    add_file_if_scannable "$target"
  elif [ -f "$ROOT_DIR/$target" ]; then
    add_file_if_scannable "$ROOT_DIR/$target"
  fi
done

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Strict tied-house compliance check passed."
  exit 0
fi

cd "$ROOT_DIR"

if command -v rg >/dev/null 2>&1; then
  scan_command=(rg -n -i --no-heading "$PATTERN")
else
  scan_command=(grep -E -n -i -H -- "$PATTERN")
fi

if "${scan_command[@]}" "${FILES[@]}" > "$OUTPUT_FILE"; then
  echo "Strict tied-house compliance check failed. Forbidden nomenclature found:" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

: > "$OUTPUT_FILE"
echo "Strict tied-house compliance check passed."

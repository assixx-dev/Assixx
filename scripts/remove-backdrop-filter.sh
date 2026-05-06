#!/usr/bin/env bash
# Remove all `backdrop-filter:` and `-webkit-backdrop-filter:` declaration lines
# from frontend CSS/Svelte/HTML/SCSS files.
#
# Why: Glassmorphism backdrop-filter sweep — see chat decision 2026-05-05.
# Comments containing the word remain untouched (regex anchored to line-start
# after optional whitespace, which CSS comments never satisfy).

set -euo pipefail

ROOT="/home/scs/projects/Assixx/frontend"
PATTERN='^[[:space:]]*(-webkit-)?backdrop-filter[[:space:]]*:'

mapfile -t FILES < <(grep -rEl "$PATTERN" \
  --include="*.css" --include="*.svelte" --include="*.html" --include="*.scss" \
  "$ROOT")

BEFORE=0
for f in "${FILES[@]}"; do
  c=$(grep -cE "$PATTERN" "$f" || true)
  BEFORE=$((BEFORE + c))
done

echo "Files to edit: ${#FILES[@]}"
echo "Declaration lines to remove: $BEFORE"

for f in "${FILES[@]}"; do
  sed -i -E "/$PATTERN/d" "$f"
done

AFTER=0
for f in "${FILES[@]}"; do
  c=$(grep -cE "$PATTERN" "$f" 2>/dev/null || true)
  AFTER=$((AFTER + c))
done

echo "Remaining declaration lines: $AFTER"
echo "Done."

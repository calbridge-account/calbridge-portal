#!/bin/bash
# stamp-version.sh — updates ?v=<hash> in all HTML JS references
# Run after any JS change or before restarting the server.
# Usage: bash scripts/stamp-version.sh

set -e
cd "$(dirname "$0")/.."

HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
echo "Stamping JS references with version: $HASH"

for f in public/*.html; do
  sed -i "s|src=\"/js/\([^\"?]*\)\(\.js\)\(?v=[^\"]*\)\?\"|src=\"/js/\1\2?v=${HASH}\"|g" "$f"
done

echo "Done — $(grep -rh '?v=' public/*.html | wc -l) references updated across $(ls public/*.html | wc -l) HTML files"

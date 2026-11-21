#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC="$ROOT/artifacts/run-calculator/dist/public"
WEB="$ROOT/v2/web"
CORE="$ROOT/v2/core"

rm -rf "$PUBLIC"
mkdir -p "$PUBLIC/v2/web" "$PUBLIC/v2/core"
cp "$WEB/index.html" "$PUBLIC/index.html"
cp "$WEB/index.html" "$PUBLIC/v2/web/app-shell.html"
cp "$WEB/manifest.webmanifest" "$PUBLIC/manifest.webmanifest"
cp "$WEB/service-worker.js" "$PUBLIC/service-worker.js"

for file in "$WEB"/*.js "$WEB"/*.mjs "$WEB"/*.css "$WEB"/*.svg "$WEB"/*.webmanifest; do
  [[ -f "$file" ]] || continue
  [[ "$file" == *.test.* ]] && continue
  cp "$file" "$PUBLIC/v2/web/$(basename "$file")"
done

for file in \
  die-defaults.mjs \
  import-csv-templates.mjs \
  import-csv.mjs \
  mix-plan.mjs \
  schedule-planning.mjs \
  setup-catalog-csv.mjs \
  station-workflows.mjs
do
  cp "$CORE/$file" "$PUBLIC/v2/core/$file"
done

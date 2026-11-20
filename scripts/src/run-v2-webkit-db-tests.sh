#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
if [[ "$(node --version)" != "v${EXPECTED_NODE_VERSION}" ]]; then
  printf 'V2 WebKit tests require Node v%s from .nvmrc.\n' "$EXPECTED_NODE_VERSION" >&2
  exit 1
fi

cd "$ROOT"
nix_playwright_bin=""
IFS=: read -r -a path_entries <<< "$PATH"
for path_entry in "${path_entries[@]}"; do
  candidate="$path_entry/playwright"
  if [[ -x "$candidate" ]]; then
    resolved_candidate=$(readlink -f "$candidate")
    if [[ "$resolved_candidate" == /nix/store/*-playwright-test-*/bin/playwright ]]; then
      nix_playwright_bin="$resolved_candidate"
      break
    fi
  fi
done
if [[ -z "$nix_playwright_bin" ]]; then
  printf 'The Nix playwright-test system dependency is required for WebKit tests.\n' >&2
  exit 1
fi

nix_playwright_root=$(dirname "$(dirname "$nix_playwright_bin")")
nix_playwright_module="$nix_playwright_root/lib/node_modules/playwright"
nix_playwright_browsers=$(sed -n \
  "s/^export PLAYWRIGHT_BROWSERS_PATH=.*-'\\([^']*\\)'.*/\\1/p" \
  "$nix_playwright_bin")
if [[ ! -f "$nix_playwright_module/package.json" || -z "$nix_playwright_browsers" ]] \
  || ! compgen -G "$nix_playwright_browsers"/webkit-*/pw_run.sh >/dev/null; then
  printf 'The Nix playwright-test package does not include a usable WebKit browser.\n' >&2
  exit 1
fi

mesa_egl_vendor=$(find /nix/store -maxdepth 6 \
  -path '*/share/glvnd/egl_vendor.d/50_mesa.json' -type f -print -quit)
if [[ -z "$mesa_egl_vendor" ]]; then
  printf 'The Mesa EGL vendor manifest is required for headless WebKit on this NixOS host.\n' >&2
  exit 1
fi

chromium_executable=$(command -v chromium || true)
if [[ -z "$chromium_executable" ]]; then
  printf 'The configured Nix Chromium system dependency is required for the database browser tests.\n' >&2
  exit 1
fi

export V2_WEBKIT_PLAYWRIGHT_MODULE="$nix_playwright_module"
export V2_WEBKIT_REQUIRED=1
export V2_WEBKIT_SKIP_HOST_REQUIREMENTS=1
export V2_WEBKIT_EGL_VENDOR="$mesa_egl_vendor"
export PLAYWRIGHT_BROWSERS_PATH="$nix_playwright_browsers"
export CHROMIUM_PATH="$chromium_executable"
export V2_IGNORE_FONT_TLS_FAILURES=1

exec bash "$ROOT/v2/db/run-local-tests.sh"

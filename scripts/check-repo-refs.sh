#!/usr/bin/env bash
set -Eeuo pipefail

# Fails when any tracked file still references the former repository
# location, so the repository move can never regress silently.

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v git >/dev/null 2>&1 || fail "git is required"

# Exclude this script: its own grep pattern for the former name would
# otherwise match itself.
matches="$(git grep -n -I 'Rughalt' -- . ':(exclude)scripts/check-repo-refs.sh' || true)"
if [[ -n "$matches" ]]; then
  printf 'error: found references to the former repository location:\n\n%s\n\n' "$matches" >&2
  printf 'Replace them with the canonical https://github.com/Dragonshorn-Studios/lain URLs.\n' >&2
  exit 1
fi
printf 'OK: no references to the former repository location.\n'

#!/usr/bin/env bash
set -Eeuo pipefail

# Documentation link integrity: every https URL printed in the tracked
# markdown documentation must resolve, and every relative markdown link must
# exist in the repository. Plain http URLs are local examples (the dashboard,
# LAN hosts) and are skipped.

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
command -v git >/dev/null 2>&1 || fail "git is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

mapfile -t documents < <(git ls-files '*.md')
if [[ ${#documents[@]} -eq 0 ]]; then
  fail "no markdown documents are tracked"
fi

failures=0

url_ok() {
  local url="$1"
  curl --fail --silent --head --location --proto '=https' --tlsv1.2 \
    --retry 2 --retry-delay 1 --max-time 20 --output /dev/null "$url" && return 0
  # Some servers reject HEAD requests; fall back to a full GET before failing.
  curl --fail --silent --location --proto '=https' --tlsv1.2 \
    --retry 2 --retry-delay 1 --max-time 30 --output /dev/null "$url"
}

url_pattern="https://[^[:space:]\"\`'<>|)]+"
for document in "${documents[@]}"; do
  mapfile -t urls < <(grep -oE "$url_pattern" "$document" | sed 's/[.,;:!?]*$//' | sort -u)
  for url in "${urls[@]}"; do
    [[ -n "$url" ]] || continue
    if url_ok "$url"; then
      printf 'ok    %s: %s\n' "$document" "$url"
    else
      printf 'error %s: unreachable %s\n' "$document" "$url" >&2
      failures=$((failures + 1))
    fi
  done

  mapfile -t targets < <(grep -oE '\]\([^)#[:space:]][^)]*\)' "$document" |
    sed -e 's/^\](//' -e 's/)$//' | grep -vE '^(https?://|mailto:)' | sort -u)
  for target in "${targets[@]}"; do
    [[ -n "$target" ]] || continue
    if [[ ! -e "$repo_root/$(dirname -- "$document")/${target%%#*}" ]]; then
      printf 'error %s: broken relative link %s\n' "$document" "$target" >&2
      failures=$((failures + 1))
    fi
  done
done

if [[ "$failures" -gt 0 ]]; then
  fail "$failures documentation link check(s) failed"
fi
printf 'OK: documentation links verified across %s document(s).\n' "${#documents[@]}"

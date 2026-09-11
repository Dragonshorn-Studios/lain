#!/usr/bin/env bash
set -Eeuo pipefail

# Deployment fixture: proves the Proxmox launcher can resolve every sibling
# component from the canonical repository at the given ref. Requires no
# Proxmox host, performs no privileged operations, and creates no container.
#
# The remote half fetches from github.com over the network; set
# VERIFY_DEPLOY_OFFLINE=1 to run only the local manifest checks.

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_dir="$repo_root/deploy/proxmox"

required=(deploy/proxmox/install.sh deploy/proxmox/create-lxc.sh deploy/proxmox/install-lain.sh deploy/lib/install-core.sh deploy/proxmox/README.md)
printf 'Checking the deployment manifest...\n'
for entry in "${required[@]}"; do
  [[ -s "$repo_root/$entry" ]] || fail "required deployment file is missing or empty: $entry"
done
printf 'OK: %s\n' "${required[*]}"

[[ "${VERIFY_DEPLOY_OFFLINE:-0}" == 1 ]] && exit 0

ref="${REPO_REF:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-main}}}"
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT

# Copying only the launcher forces its remote-download path: the fixture then
# exercises the exact URL derivation and fetches the siblings the way a
# `bash -c "$(curl ...)"` installation does.
printf 'Running the launcher dry run against the canonical repository (ref %s)...\n' "$ref"
cp -- "$deploy_dir/install.sh" "$workdir/install.sh"
(cd -- "$workdir" && REPO_REF="$ref" bash install.sh --dry-run)

printf 'Deployment launcher fixture passed.\n'

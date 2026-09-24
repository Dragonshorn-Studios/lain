#!/usr/bin/env bash
set -Eeuo pipefail

# Executed inside the new container by create-lxc.sh. Sets the container-
# specific policy and delegates the actual installation to the shared core
# in install-core.sh.

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || fail "the container installer must run as root"
DNS_ADDRESS="${DNS_ADDRESS:?DNS_ADDRESS is required}"
REPO_REF="${REPO_REF:-main}"
INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-1}"

core_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -r "$core_dir/install-core.sh" ]] || fail "missing sibling core installer: $core_dir/install-core.sh"
# shellcheck disable=SC1091
source "$core_dir/install-core.sh"

setup_args=(setup ubuntu --install-laind --dns-address "$DNS_ADDRESS" --yes)
if [[ "$INSTALL_CLOUDFLARED" == "1" ]]; then setup_args+=(--install-cloudflared); fi

export LAIN_REQUIRE_OS=debian
export LAIN_SOURCE_DIR="/opt/lain"
export LAIN_REPO_REF="$REPO_REF"
export LAIN_SETUP_ARGS="${setup_args[*]}"
lain_install_guest

systemctl --no-pager --full status laind.service
printf 'Lain installation completed successfully.\n'

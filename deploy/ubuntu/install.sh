#!/usr/bin/env bash
set -Eeuo pipefail

# Single-command Ubuntu installer for Lain. Designed for
#   curl -fsSL https://raw.githubusercontent.com/Dragonshorn-Studios/lain/<release>/deploy/ubuntu/install.sh | sudo bash
# with download -> inspect -> execute documented as the safest path. It shares
# the guest-installation core with the Proxmox LXC installer and installs a
# versioned release under /opt/lain/releases with an /opt/lain/current symlink,
# keeping state in /var/lib/lain and configuration in /etc/lain.

readonly INSTALL_ROOT="/opt/lain"
readonly CURRENT_LINK="${INSTALL_ROOT}/current"

readonly SUPPORTED_UBUNTU="22.04 24.04"

DNS_ADDRESS="${DNS_ADDRESS:-}"
REPO_REF="${REPO_REF:-}"
ASSUME_YES=0
INSTALL_CLOUDFLARED=1

fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh [--yes --dns-address <ip>] [--ref <tag|sha>] [--no-cloudflared]

  --yes                non-interactive install with the reviewed settings
  --dns-address <ip>   LAN address managed DNS names resolve to (required with --yes)
  --ref <tag|sha>      release tag or commit to install (default: latest release)
  --no-cloudflared     skip installing the cloudflared package

Environment: REPO_REF is honored the same as --ref.
EOF
}

version_dir_from_ref() {
  local name="$1"
  if [[ "$name" == v* && "${name#v}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$ ]]; then
    name="${name#v}"
  fi
  printf '%s' "${name//\//_}"
}

latest_release_tag() {
  curl --fail --silent --location --proto '=https' --tlsv1.2 --max-time 15 \
    --header 'User-Agent: lain-installer' \
    https://api.github.com/repos/Dragonshorn-Studios/lain/releases/latest |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1
}

env_port() {
  local name="$1" default="$2" value=""
  if [[ -r /etc/lain/lain.env ]]; then
    value="$(sed -n "s/^${name}=//p" /etc/lain/lain.env | head -n1)"
  fi
  printf '%s' "${value:-$default}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) ASSUME_YES=1; shift ;;
    --no-cloudflared) INSTALL_CLOUDFLARED=0; shift ;;
    --dns-address|--ref)
      [[ $# -ge 2 ]] || fail "missing value for $1"
      if [[ "$1" == "--dns-address" ]]; then DNS_ADDRESS="$2"; else REPO_REF="$2"; fi
      shift 2 ;;
    --dns-address=*|--ref=*)
      value="${1#*=}"
      if [[ "$1" == --dns-address=* ]]; then DNS_ADDRESS="$value"; else REPO_REF="$value"; fi
      shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
done
: "${DNS_ADDRESS:=${LAIN_DNS_ADDRESS:-}}"
[[ -n "$DNS_ADDRESS" || "$ASSUME_YES" != 1 ]] || { usage; fail "--dns-address is required for a non-interactive install"; }

[[ ${EUID} -eq 0 ]] || fail "run this installer as root (curl ... | sudo bash)"
command -v curl >/dev/null 2>&1 || fail "curl is required"

id="" version_id=""
# shellcheck disable=SC1091
. /etc/os-release
id="${ID:-}"; version_id="${VERSION_ID:-}"
[[ "$id" == "ubuntu" ]] || fail "this installer only supports Ubuntu (found: ${id:-unknown})"
[[ " ${SUPPORTED_UBUNTU} " == *" ${version_id} "* ]] || fail "unsupported Ubuntu ${version_id:-unknown}; supported releases are ${SUPPORTED_UBUNTU}"
case "$(dpkg --print-architecture)" in
  amd64|arm64) : ;;
  *) fail "unsupported CPU architecture: $(dpkg --print-architecture) (supported: amd64, arm64)" ;;
esac

if [[ -e "$CURRENT_LINK" ]]; then
  installed_version=""
  [[ -r "$CURRENT_LINK/package.json" ]] && installed_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$CURRENT_LINK/package.json" | head -n1)"
  printf 'Lain %s is already installed at %s.\n' "${installed_version:-unknown}" "$CURRENT_LINK"
  printf 'To change versions run: lainctl update\n'
  exit 0
fi

if [[ -z "$REPO_REF" ]]; then
  printf 'Resolving the latest release...\n'
  REPO_REF="$(latest_release_tag || true)"
  if [[ -z "$REPO_REF" ]]; then
    REPO_REF=main
    printf '\033[33mwarning:\033[0m could not resolve the latest release; falling back to %s. For production, pin a release with --ref <tag>.\n' "$REPO_REF" >&2
  fi
fi
release_dir="${INSTALL_ROOT}/releases/$(version_dir_from_ref "$REPO_REF")"

if [[ "$ASSUME_YES" != 1 ]]; then
  [[ -t 0 ]] || fail "an interactive terminal is required (or pass --yes --dns-address <ip>)"
  if [[ -z "$DNS_ADDRESS" ]]; then
    while [[ -z "$DNS_ADDRESS" ]]; do
      read -r -p "LAN address managed DNS names resolve to (for example 192.168.1.20): " DNS_ADDRESS
      [[ "$DNS_ADDRESS" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Enter a plain IPv4 address.\n' >&2; DNS_ADDRESS=""; }
    done
  fi
  printf '\nThe installer will:\n  - install pinned Node.js 22 and pnpm 11.19.0 prerequisites\n  - place Lain %s in %s with %s pointing at it\n  - run lainctl setup: hardened laind.service on DNS 53, HTTP 80, HTTPS 443\n  - %s the cloudflared package (service stays disabled until a token is imported)\n  - keep state in /var/lib/lain and configuration in /etc/lain\n' \
    "$REPO_REF" "$release_dir" "$CURRENT_LINK" "$([[ "$INSTALL_CLOUDFLARED" == 1 ]] && printf 'install' || printf 'skip')"
  read -r -p "Continue? [y/N]: " answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] || { printf 'Cancelled.\n'; exit 0; }
fi
[[ "$DNS_ADDRESS" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "DNS_ADDRESS must be a plain IPv4 address, for example 192.168.1.20"

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT

core_url="https://raw.githubusercontent.com/Dragonshorn-Studios/lain/${REPO_REF}/deploy/lib/install-core.sh"
printf 'Fetching the installation core from %s...\n' "$REPO_REF"
if [[ -n "${LAIN_OFFLINE_SOURCE:-}" ]]; then
  # Test seam: take the core from the local checkout instead of the network.
  core_url="${LAIN_OFFLINE_SOURCE%/}/deploy/lib/install-core.sh"
  [[ -r "$core_url" ]] || fail "the offline source has no installation core at $core_url"
  cp -- "$core_url" "$temporary_directory/install-core.sh"
else
  curl --fail --show-error --location --proto '=https' --tlsv1.2 "$core_url" --output "$temporary_directory/install-core.sh"
fi
bash -n "$temporary_directory/install-core.sh" || fail "the fetched installation core failed the syntax check"
# shellcheck disable=SC1091
source "$temporary_directory/install-core.sh"

export LAIN_REQUIRE_OS=ubuntu
export LAIN_SOURCE_DIR="$release_dir"
export LAIN_REPO_REF="$REPO_REF"
export LAIN_SETUP_ARGS=""
lain_install_guest

printf 'Activating %s...\n' "$CURRENT_LINK"
link_tmp="${CURRENT_LINK}.tmp"
ln -sfn "$release_dir" "$link_tmp"
mv -T "$link_tmp" "$CURRENT_LINK"

printf 'Running the service setup...\n'
setup_args=(setup ubuntu --install-laind --dns-address "$DNS_ADDRESS" --yes)
if [[ "$INSTALL_CLOUDFLARED" == 1 ]]; then setup_args+=(--install-cloudflared); fi
cd "$CURRENT_LINK"
LAIN_INSTALL_ROOT="$CURRENT_LINK" node apps/cli/dist/main.js "${setup_args[@]}"

dns_port="$(env_port LAIN_DNS_PORT 53)"
proxy_port="$(env_port LAIN_PROXY_PORT 80)"
api_port="$(env_port LAIN_PORT 3100)"

printf 'Waiting for laind to become healthy...\n'
health=""
for attempt in $(seq 1 30); do
  if health="$(curl --fail --silent --max-time 2 "http://127.0.0.1:${api_port}/api/health")"; then break; fi
  if (( attempt == 30 )); then
    printf '\033[31merror:\033[0m laind did not become healthy. Inspect:\n' >&2
    printf '  systemctl status laind.service\n  journalctl -u laind -n 100 --no-pager\n' >&2
    printf 'Configuration and state are kept in /etc/lain and /var/lib/lain; after fixing the cause, re-run this installer or lainctl update.\n' >&2
    exit 1
  fi
  sleep 2
done

if command -v ss >/dev/null 2>&1; then
  [[ -n "$(ss -H -lun "sport = :${dns_port}")" ]] || printf '\033[33mwarning:\033[0m nothing is listening on UDP :%s yet\n' "$dns_port" >&2
  [[ -n "$(ss -H -ltn "sport = :${proxy_port}")" ]] || printf '\033[33mwarning:\033[0m nothing is listening on TCP :%s yet\n' "$proxy_port" >&2
fi

printf '\nLain installation completed successfully.\n'
printf '%s\n' "$health"
printf 'Open http://%s:%s and complete first-run setup immediately: whoever sets the admin password first owns the dashboard.\n' "$DNS_ADDRESS" "$api_port"
printf 'For machine access create an API key (lainctl keys create) and export it as LAIN_API_KEY.\n'

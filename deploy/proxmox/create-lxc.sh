#!/usr/bin/env bash
set -Eeuo pipefail

# Creates an unprivileged Debian LXC on a Proxmox VE host, then installs Lain.
# Run this checked-out script as root on the Proxmox host. Secrets are configured
# separately after the container exists; do not pass them to this script.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALLER="${SCRIPT_DIR}/install-lain.sh"

REPO_REF="${REPO_REF:-main}"
CT_ID="${CT_ID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-lain}"
IP_CIDR="${IP_CIDR:-}"
GATEWAY="${GATEWAY:-}"
BRIDGE="${BRIDGE:-vmbr0}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-local-lvm}"
DEBIAN_RELEASE="${DEBIAN_RELEASE:-12}"
CORES="${CORES:-2}"
MEMORY_MB="${MEMORY_MB:-1024}"
SWAP_MB="${SWAP_MB:-512}"
DISK_GB="${DISK_GB:-8}"
BOOTSTRAP_DNS="${BOOTSTRAP_DNS:-1.1.1.1}"
INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-1}"

created=0

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing required Proxmox command: $1"; }
valid_integer() { [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 > 0 )); }
valid_ct_id() { valid_integer "$1" && (( 10#$1 >= 100 && 10#$1 <= 999999999 )); }
valid_name() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; }
valid_ref() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]] && [[ "$1" != *..* ]]; }
valid_ipv4() {
  local address="$1" octet
  local -a octets
  IFS=. read -r -a octets <<< "$address"
  [[ ${#octets[@]} -eq 4 ]] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] && (( 10#$octet <= 255 )) || return 1
  done
}

on_error() {
  local exit_code=$?
  if (( created == 1 )); then
    printf '\nInstallation stopped. Container %s was preserved for inspection.\n' "$CT_ID" >&2
    printf 'Inspect: pct enter %s\n' "$CT_ID" >&2
    printf 'Remove after review: pct stop %s && pct destroy %s\n' "$CT_ID" "$CT_ID" >&2
  fi
  exit "$exit_code"
}
trap on_error ERR

[[ ${EUID} -eq 0 ]] || fail "run this script as root on the Proxmox VE host"
for command in pct pveam pvesh awk grep sort stat tail; do need "$command"; done
[[ -f "$INSTALLER" ]] || fail "missing sibling installer: $INSTALLER"
valid_ref "$REPO_REF" || fail "REPO_REF contains unsupported characters"
[[ "$IP_CIDR" =~ ^(.+)/([0-9]|[12][0-9]|3[0-2])$ ]] && valid_ipv4 "${BASH_REMATCH[1]}" || fail "IP_CIDR must look like 192.168.1.20/24"
valid_ipv4 "$GATEWAY" || fail "GATEWAY must be an IPv4 address"
valid_name "$CT_HOSTNAME" || fail "CT_HOSTNAME contains unsupported characters"
valid_name "$BRIDGE" || fail "BRIDGE contains unsupported characters"
valid_name "$TEMPLATE_STORAGE" || fail "TEMPLATE_STORAGE contains unsupported characters"
valid_name "$ROOTFS_STORAGE" || fail "ROOTFS_STORAGE contains unsupported characters"
[[ "$DEBIAN_RELEASE" == "12" || "$DEBIAN_RELEASE" == "13" ]] || fail "DEBIAN_RELEASE must be 12 or 13"
[[ "$INSTALL_CLOUDFLARED" == "0" || "$INSTALL_CLOUDFLARED" == "1" ]] || fail "INSTALL_CLOUDFLARED must be 0 or 1"
for value in "$CORES" "$MEMORY_MB" "$SWAP_MB" "$DISK_GB"; do valid_integer "$value" || fail "resource values must be positive integers"; done

if [[ -z "$CT_ID" ]]; then CT_ID="$(pvesh get /cluster/nextid)"; fi
valid_ct_id "$CT_ID" || fail "CT_ID must be an integer from 100 to 999999999"
pct status "$CT_ID" >/dev/null 2>&1 && fail "container $CT_ID already exists"

printf 'Refreshing the Proxmox template catalog...\n'
pveam update
template_name="$(pveam available --section system | awk -v release="$DEBIAN_RELEASE" '$2 ~ ("^debian-" release "-standard_") {print $2}' | sort -V | tail -n 1)"
[[ -n "$template_name" ]] || fail "no Debian $DEBIAN_RELEASE standard template is available"
template_volume="${TEMPLATE_STORAGE}:vztmpl/${template_name}"
if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -Fxq "$template_volume"; then
  printf 'Downloading %s...\n' "$template_name"
  pveam download "$TEMPLATE_STORAGE" "$template_name"
fi

printf 'Creating unprivileged container %s (%s)...\n' "$CT_ID" "$CT_HOSTNAME"
pct create "$CT_ID" "$template_volume" \
  --arch amd64 \
  --hostname "$CT_HOSTNAME" \
  --unprivileged 1 \
  --features nesting=0 \
  --cores "$CORES" \
  --memory "$MEMORY_MB" \
  --swap "$SWAP_MB" \
  --rootfs "${ROOTFS_STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IP_CIDR},gw=${GATEWAY},type=veth" \
  --nameserver "$BOOTSTRAP_DNS" \
  --onboot 1 \
  --ostype debian \
  --tags lain
created=1
pct start "$CT_ID"

printf 'Waiting for systemd and network readiness...\n'
for attempt in $(seq 1 60); do
  if pct exec "$CT_ID" -- /usr/bin/test -d /run/systemd/system >/dev/null 2>&1 && \
     pct exec "$CT_ID" -- /usr/bin/getent hosts nodejs.org >/dev/null 2>&1; then break; fi
  if (( attempt == 60 )); then fail "container did not become ready within 120 seconds"; fi
  sleep 2
done

pct push "$CT_ID" "$INSTALLER" /root/install-lain.sh --perms 0700
dns_address="${IP_CIDR%/*}"
pct exec "$CT_ID" -- /usr/bin/env \
  REPO_REF="$REPO_REF" \
  DNS_ADDRESS="$dns_address" \
  INSTALL_CLOUDFLARED="$INSTALL_CLOUDFLARED" \
  /root/install-lain.sh

created=0
printf '\nLain is installed in container %s.\n' "$CT_ID"
printf 'Dashboard: http://%s:3100\n' "$dns_address"
printf 'DNS:       %s:53 (UDP/TCP)\n' "$dns_address"
printf 'Proxy:     http://%s:80 and https://%s:443\n' "$dns_address" "$dns_address"
printf 'Next: read deploy/proxmox/README.md to import Cloudflare credentials securely.\n'

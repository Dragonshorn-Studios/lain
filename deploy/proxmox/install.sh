#!/usr/bin/env bash
set -Eeuo pipefail

# Community-Scripts-style interactive launcher for Lain. It may be run from a
# checkout or fetched into `bash -c`. It never accepts or handles application
# credentials; Cloudflare secrets are imported after installation.

readonly SOURCE_REPOSITORY="https://github.com/Dragonshorn-Studios/lain.git"
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
DISK_GB="${DISK_GB:-8}"
INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-1}"

temporary_directory=""

cleanup() {
  if [[ -n "$temporary_directory" && -d "$temporary_directory" ]]; then
    rm -rf -- "$temporary_directory"
  fi
}
trap cleanup EXIT
trap 'printf "\n\033[31mInstallation stopped on line %s.\033[0m\n" "$LINENO" >&2' ERR

fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

header() {
  if [[ -t 1 ]]; then printf '\033c'; fi
  cat <<'EOF'
  ██╗      █████╗ ██╗███╗   ██╗
  ██║     ██╔══██╗██║████╗  ██║
  ██║     ███████║██║██╔██╗ ██║
  ██║     ██╔══██║██║██║╚██╗██║
  ███████╗██║  ██║██║██║ ╚████║
  ╚══════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝

  Proxmox VE · unprivileged LXC installer
EOF
}

input() {
  local title="$1" prompt="$2" default_value="$3" result
  if command -v whiptail >/dev/null 2>&1 && [[ -t 0 && -t 1 ]]; then
    result="$(whiptail --title "$title" --inputbox "$prompt" 10 72 "$default_value" 3>&1 1>&2 2>&3)" || exit 0
  else
    read -r -p "$prompt${default_value:+ [$default_value]}: " result
    result="${result:-$default_value}"
  fi
  printf '%s' "$result"
}

choose_mode() {
  local result
  if command -v whiptail >/dev/null 2>&1 && [[ -t 0 && -t 1 ]]; then
    result="$(whiptail --title "Lain LXC" --menu "Choose the installation profile" 13 68 3 \
      default "2 cores · 1 GiB RAM · 8 GiB disk · Debian 12" \
      advanced "Configure container and storage settings" \
      cancel "Exit without making changes" 3>&1 1>&2 2>&3)" || exit 0
  else
    printf '\n1) Default settings\n2) Advanced settings\n3) Cancel\n' >&2
    read -r -p 'Select [1]: ' result
    case "${result:-1}" in 1) result=default ;; 2) result=advanced ;; *) result=cancel ;; esac
  fi
  printf '%s' "$result"
}

confirm() {
  local message="$1" answer
  if command -v whiptail >/dev/null 2>&1 && [[ -t 0 && -t 1 ]]; then
    whiptail --title "Review Lain container" --yesno "$message" 20 76
  else
    printf '\n%s\n\n' "$message"
    read -r -p 'Create this container? [y/N]: ' answer
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
  fi
}

collect_settings() {
  [[ ${EUID} -eq 0 ]] || fail "run this command in the Proxmox VE root shell"
  command -v pct >/dev/null 2>&1 || fail "pct was not found; this must run on a Proxmox VE host"
  [[ -t 0 ]] || fail "an interactive terminal is required"

  header
  local mode detected_gateway summary
  mode="$(choose_mode)"
  [[ "$mode" != cancel ]] || exit 0

  IP_CIDR="$(input "Container network" "Unused static address with prefix, for example 192.168.1.20/24" "$IP_CIDR")"
  detected_gateway="$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')"
  GATEWAY="$(input "Container network" "LAN gateway" "${GATEWAY:-$detected_gateway}")"

  if [[ "$mode" == advanced ]]; then
    CT_ID="$(input "Container" "CT ID (leave empty to allocate the next ID)" "$CT_ID")"
    CT_HOSTNAME="$(input "Container" "Hostname" "$CT_HOSTNAME")"
    BRIDGE="$(input "Network" "Proxmox bridge" "$BRIDGE")"
    TEMPLATE_STORAGE="$(input "Storage" "Template storage" "$TEMPLATE_STORAGE")"
    ROOTFS_STORAGE="$(input "Storage" "Container disk storage" "$ROOTFS_STORAGE")"
    DEBIAN_RELEASE="$(input "Operating system" "Debian release (12 or 13)" "$DEBIAN_RELEASE")"
    CORES="$(input "Resources" "CPU cores" "$CORES")"
    MEMORY_MB="$(input "Resources" "Memory in MiB" "$MEMORY_MB")"
    DISK_GB="$(input "Resources" "Disk size in GiB" "$DISK_GB")"
    INSTALL_CLOUDFLARED="$(input "Cloudflare" "Install cloudflared package now? (1 yes, 0 no)" "$INSTALL_CLOUDFLARED")"
  fi

  summary="Source:       ${SOURCE_REPOSITORY} (${REPO_REF})
Container ID: ${CT_ID:-next available}
Hostname:     ${CT_HOSTNAME}
Address:      ${IP_CIDR}
Gateway:      ${GATEWAY}
Bridge:       ${BRIDGE}
Storage:      ${ROOTFS_STORAGE} (${DISK_GB} GiB)
Resources:    ${CORES} cores, ${MEMORY_MB} MiB RAM
OS:           Debian ${DEBIAN_RELEASE}, unprivileged, nesting disabled
Cloudflared:  $([[ "$INSTALL_CLOUDFLARED" == 1 ]] && printf 'install only' || printf 'skip')

Cloudflare credentials are configured separately after installation."
  confirm "$summary" || { printf 'Cancelled. No container was created.\n'; exit 0; }
}

dry_run="${LAIN_INSTALL_DRY_RUN:-0}"
for argument in "$@"; do
  case "$argument" in
    --dry-run) dry_run=1 ;;
    *) fail "unknown option: $argument (supported: --dry-run)" ;;
  esac
done

if [[ "$dry_run" == 1 ]]; then
  printf 'Dry run: prompts are skipped; no privileged command runs and no container is created.\n'
else
  collect_settings
fi

launcher_dir=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  launcher_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi
creator="${launcher_dir:+${launcher_dir}/create-lxc.sh}"
guest_installer="${launcher_dir:+${launcher_dir}/install-lain.sh}"

if [[ ! -f "$creator" || ! -f "$guest_installer" ]]; then
  command -v curl >/dev/null 2>&1 || fail "curl is required when running the remote launcher"
  temporary_directory="$(mktemp -d)"
  repository_base="${SOURCE_REPOSITORY%.git}"
  case "$repository_base" in
    https://github.com/*)
      path="${repository_base#https://github.com/}"
      raw_base="https://raw.githubusercontent.com/${path}/${REPO_REF}/deploy/proxmox"
      ;;
    https://gitlab.com/*)
      raw_base="${repository_base}/-/raw/${REPO_REF}/deploy/proxmox"
      ;;
    *) fail "the remote launcher currently supports github.com and gitlab.com repositories" ;;
  esac
  printf 'Downloading the reviewed deployment components from %s...\n' "$REPO_REF"
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 "$raw_base/create-lxc.sh" --output "$temporary_directory/create-lxc.sh"
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 "$raw_base/install-lain.sh" --output "$temporary_directory/install-lain.sh"
  chmod 0700 "$temporary_directory/create-lxc.sh" "$temporary_directory/install-lain.sh"
  creator="$temporary_directory/create-lxc.sh"
  guest_installer="$temporary_directory/install-lain.sh"
fi

if [[ "$dry_run" == 1 ]]; then
  bash -n "$creator" || fail "syntax check failed for the launcher component: $creator"
  bash -n "$guest_installer" || fail "syntax check failed for the installer component: $guest_installer"
  printf 'Dry run passed. Every deployment component resolved from %s (ref %s):\n  %s\n  %s\n' \
    "$SOURCE_REPOSITORY" "$REPO_REF" "$creator" "$guest_installer"
  exit 0
fi

env \
  REPO_REF="$REPO_REF" CT_ID="$CT_ID" CT_HOSTNAME="$CT_HOSTNAME" \
  IP_CIDR="$IP_CIDR" GATEWAY="$GATEWAY" BRIDGE="$BRIDGE" \
  TEMPLATE_STORAGE="$TEMPLATE_STORAGE" ROOTFS_STORAGE="$ROOTFS_STORAGE" \
  DEBIAN_RELEASE="$DEBIAN_RELEASE" CORES="$CORES" MEMORY_MB="$MEMORY_MB" DISK_GB="$DISK_GB" \
  INSTALL_CLOUDFLARED="$INSTALL_CLOUDFLARED" \
  bash "$creator"

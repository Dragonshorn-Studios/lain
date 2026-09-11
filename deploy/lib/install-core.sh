#!/usr/bin/env bash
# Sourced guest-installation core shared by the Proxmox LXC installer
# (deploy/proxmox/install-lain.sh) and the Ubuntu installer
# (deploy/ubuntu/install.sh). Expects `set -Eeuo pipefail` from the caller.
#
# Configure a run through these variables, then call lain_install_guest:
#   LAIN_SOURCE_DIR     required  directory to install the source into
#   LAIN_REPO_REF       required  branch, tag, or 40-hex commit to install
#   LAIN_REQUIRE_OS     optional  "debian" or "ubuntu" (version-checked); unset skips the check
#   LAIN_OFFLINE_SOURCE optional  copy source from this directory instead of cloning (test seam)
#   LAIN_SETUP_ARGS     optional  when non-empty, arguments for lainctl setup after the build
#
# The repository URL is deliberately not overridable: guest installs always
# come from the canonical Dragonshorn-Studios/lain repository. LAIN_REPO_REF
# (branch, tag, or reviewed commit) remains the only pinning mechanism.

lain_repo_url="https://github.com/Dragonshorn-Studios/lain.git"
lain_pnpm_pin="11.19.0"

lain_fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

lain_require_os() {
  local required="$1" id version_id
  [[ -r /etc/os-release ]] || lain_fail "cannot identify the operating system"
  # shellcheck disable=SC1091
  . /etc/os-release
  id="${ID:-}"; version_id="${VERSION_ID:-}"
  case "$required" in
    debian)
      [[ "$id" == "debian" ]] || lain_fail "this image is not Debian"
      ;;
    ubuntu)
      [[ "$id" == "ubuntu" ]] || lain_fail "this installer only supports Ubuntu"
      [[ "$version_id" == "22.04" || "$version_id" == "24.04" ]] || lain_fail "unsupported Ubuntu ${version_id:-unknown}; supported releases are 22.04 and 24.04"
      ;;
  esac
}

lain_install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes --no-install-recommends ca-certificates curl git xz-utils
}

lain_install_node() {
  local node_arch archive tmp
  case "$(dpkg --print-architecture)" in
    amd64) node_arch="x64" ;;
    arm64) node_arch="arm64" ;;
    *) lain_fail "unsupported CPU architecture: $(dpkg --print-architecture)" ;;
  esac
  tmp="$(mktemp -d)"
  curl --fail --show-error --location --proto '=https' --tlsv1.2 \
    https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt \
    --output "$tmp/SHASUMS256.txt"
  archive="$(awk -v arch="$node_arch" '$2 ~ ("node-v[0-9.]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$tmp/SHASUMS256.txt")"
  [[ -n "$archive" ]] || lain_fail "could not identify the latest Node.js 22 archive"
  curl --fail --show-error --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/latest-v22.x/${archive}" \
    --output "$tmp/${archive}"
  (cd "$tmp" && grep "  ${archive}$" SHASUMS256.txt | sha256sum --check --strict)
  mkdir -p /usr/local/lib/nodejs
  tar --extract --xz --file "$tmp/${archive}" --directory /usr/local/lib/nodejs --strip-components=1
  ln -sfn /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  ln -sfn /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm
  ln -sfn /usr/local/lib/nodejs/bin/npx /usr/local/bin/npx
  ln -sfn /usr/local/lib/nodejs/bin/corepack /usr/local/bin/corepack
  rm -rf -- "$tmp"
}

lain_install_pnpm() {
  # Keep the pin in sync with packageManager in the root package.json.
  npm install --global --ignore-scripts "pnpm@${lain_pnpm_pin}"
  # npm's global bin directory is the Node install's own bin/, which is not on
  # PATH; expose pnpm next to the node/npm symlinks.
  ln -sfn /usr/local/lib/nodejs/bin/pnpm /usr/local/bin/pnpm
}

lain_fetch_source() {
  local source_dir="$1" repo_ref="$2"
  if [[ -n "${LAIN_OFFLINE_SOURCE:-}" ]]; then
    # A checkout's node_modules and .git are host-specific; a fresh tree keeps
    # the frozen install honest.
    mkdir -p "$source_dir"
    tar -C "${LAIN_OFFLINE_SOURCE%/}" --exclude='node_modules' --exclude='.git' --exclude='./data' -cf - . | tar -xf - -C "$source_dir"
    return
  fi
  if [[ "$repo_ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git init "$source_dir"
    git -C "$source_dir" remote add origin "$lain_repo_url"
    GIT_TERMINAL_PROMPT=0 git -C "$source_dir" fetch --depth 1 origin "$repo_ref"
    git -C "$source_dir" checkout --detach FETCH_HEAD
  else
    GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$repo_ref" --single-branch "$lain_repo_url" "$source_dir"
  fi
  git -C "$source_dir" config --local advice.detachedHead false
}

lain_install_guest() {
  local source_dir="${LAIN_SOURCE_DIR:?LAIN_SOURCE_DIR is required}"
  local repo_ref="${LAIN_REPO_REF:?LAIN_REPO_REF is required}"
  lain_require_os "${LAIN_REQUIRE_OS:-}"
  [[ ! -e "$source_dir" ]] || lain_fail "$source_dir already exists; refusing to overwrite it"
  # An installer is unattended: never let pnpm prompt for module purges.
  export CI=true
  lain_install_packages
  lain_install_node
  lain_install_pnpm
  lain_fetch_source "$source_dir" "$repo_ref"
  (cd "$source_dir" && pnpm install --frozen-lockfile && pnpm build)
  if [[ -n "${LAIN_SETUP_ARGS:-}" ]]; then
    local -a setup_args
    read -r -a setup_args <<< "$LAIN_SETUP_ARGS"
    (cd "$source_dir" && node apps/cli/dist/main.js "${setup_args[@]}")
  fi
}

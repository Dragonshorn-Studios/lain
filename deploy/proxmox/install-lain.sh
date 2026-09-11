#!/usr/bin/env bash
set -Eeuo pipefail

# Executed inside the new container by create-lxc.sh.

readonly INSTALL_ROOT="/opt/lain"
readonly NODE_ROOT="/usr/local/lib/nodejs"

readonly SOURCE_REPOSITORY="https://github.com/Dragonshorn-Studios/lain.git"
REPO_REF="${REPO_REF:-main}"
DNS_ADDRESS="${DNS_ADDRESS:?DNS_ADDRESS is required}"
INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-1}"

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || fail "the container installer must run as root"
[[ -r /etc/os-release ]] || fail "cannot identify the container OS"
grep -Eq '^ID=debian$' /etc/os-release || fail "this image is not Debian"
[[ ! -e "$INSTALL_ROOT" ]] || fail "$INSTALL_ROOT already exists; refusing to overwrite it"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes --no-install-recommends ca-certificates curl git xz-utils

case "$(dpkg --print-architecture)" in
  amd64) node_arch="x64" ;;
  arm64) node_arch="arm64" ;;
  *) fail "unsupported CPU architecture: $(dpkg --print-architecture)" ;;
esac

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt \
  --output "$temporary_directory/SHASUMS256.txt"
node_archive="$(awk -v arch="$node_arch" '$2 ~ ("node-v[0-9.]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$temporary_directory/SHASUMS256.txt")"
[[ -n "$node_archive" ]] || fail "could not identify the latest Node.js 22 archive"
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
  "https://nodejs.org/dist/latest-v22.x/${node_archive}" \
  --output "$temporary_directory/$node_archive"
(cd "$temporary_directory" && grep "  ${node_archive}$" SHASUMS256.txt | sha256sum --check --strict)
mkdir -p "$NODE_ROOT"
tar --extract --xz --file "$temporary_directory/$node_archive" --directory "$NODE_ROOT" --strip-components=1
ln -sfn "$NODE_ROOT/bin/node" /usr/local/bin/node
ln -sfn "$NODE_ROOT/bin/npm" /usr/local/bin/npm
ln -sfn "$NODE_ROOT/bin/npx" /usr/local/bin/npx
ln -sfn "$NODE_ROOT/bin/corepack" /usr/local/bin/corepack
npm install --global --ignore-scripts pnpm@11.19.0

if [[ "$REPO_REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
  git init "$INSTALL_ROOT"
  git -C "$INSTALL_ROOT" remote add origin "$SOURCE_REPOSITORY"
  GIT_TERMINAL_PROMPT=0 git -C "$INSTALL_ROOT" fetch --depth 1 origin "$REPO_REF"
  git -C "$INSTALL_ROOT" checkout --detach FETCH_HEAD
else
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$REPO_REF" --single-branch "$SOURCE_REPOSITORY" "$INSTALL_ROOT"
fi
git -C "$INSTALL_ROOT" config --local advice.detachedHead false
cd "$INSTALL_ROOT"
pnpm install --frozen-lockfile
pnpm build

setup_args=(setup ubuntu --install-laind --dns-address "$DNS_ADDRESS" --yes)
if [[ "$INSTALL_CLOUDFLARED" == "1" ]]; then setup_args+=(--install-cloudflared); fi
node apps/cli/dist/main.js "${setup_args[@]}"

systemctl --no-pager --full status laind.service
printf 'Lain installation completed successfully.\n'

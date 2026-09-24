#!/usr/bin/env bash
set -Eeuo pipefail

# Runs deploy/ubuntu/install.sh inside a disposable, systemd-enabled Ubuntu
# container and asserts the outcome: versioned layout, unit pinning, healthy
# service, idempotent re-run, and the update no-op path. Docker is test
# infrastructure only — Lain itself runs via systemd on a real host.
#
# The run still downloads apt packages, Node.js, and pnpm; only the Lain
# source is taken offline from the mounted checkout (LAIN_OFFLINE_SOURCE).

container="lain-install-smoke-$$"
image="${LAIN_SMOKE_IMAGE:-ubuntu:24.04}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${LAIN_SMOKE_SOURCE:-$repo_root}"

fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
pass() { printf '\033[32mok:\033[0m %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  if [[ "${REQUIRE_DOCKER:-0}" == "1" ]]; then fail "docker is required (REQUIRE_DOCKER=1)"; fi
  printf 'skipping: docker is not available on this machine\n' >&2
  exit 0
fi

cleanup() {
  if [[ "${KEEP_CONTAINER:-0}" == "1" ]]; then
    printf 'container %s left running (KEEP_CONTAINER=1)\n' "$container" >&2
    return
  fi
  docker rm -f -- "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

exec_in() { docker exec "$container" "$@"; }

dump_diagnostics() {
  exec_in systemctl status laind.service --no-pager 2>&1 | tail -15 || true
  exec_in journalctl -u laind -n 60 --no-pager 2>&1 | tail -40 || true
}

printf 'Booting %s in a %s container (this run downloads apt, Node.js, and pnpm packages)...\n' "$source_dir" "$image"
# The minimal Ubuntu image ships without systemd; install it and exec it as
# PID 1 so the installer's systemctl-driven flow runs for real.
docker run --privileged --detach --name "$container" \
  --volume "$source_dir:/opt/lain-src:ro" \
  "$image" bash -c 'apt-get update -qq && apt-get install -y -qq systemd >/dev/null && exec /lib/systemd/systemd --unit=multi-user.target' >/dev/null

for attempt in $(seq 1 60); do
  state="$(exec_in systemctl is-system-running 2>/dev/null || true)"
  [[ "$state" == "running" || "$state" == "degraded" ]] && break
  if (( attempt == 60 )); then fail "systemd did not start inside the container"; fi
  sleep 2
done

exec_in bash -c 'apt-get update -qq && apt-get install -y -qq curl >/dev/null'

printf 'Running the installer...\n'
if ! exec_in env LAIN_OFFLINE_SOURCE=/opt/lain-src REPO_REF=smoke \
  bash /opt/lain-src/deploy/ubuntu/install.sh --yes --dns-address 192.168.1.50; then
  printf '\nInstaller failed; laind diagnostics:\n' >&2
  dump_diagnostics
  fail "the installer did not complete"
fi

[[ "$(exec_in readlink /opt/lain/current)" == "/opt/lain/releases/smoke" ]] || fail "/opt/lain/current does not point at the new release"
exec_in systemctl is-active --quiet laind.service || fail "laind.service is not active"
exec_in grep -q "WorkingDirectory=/opt/lain/current/apps/server" /etc/systemd/system/laind.service || fail "the generated unit does not pin /opt/lain/current"
exec_in curl -fsS http://127.0.0.1:3100/api/health >/dev/null || fail "the API health endpoint is not reachable"
pass "install completed healthy with the versioned layout and unit pinning"

printf 'Re-running the installer (expected: already-installed hint, exit 0)...\n'
exec_in env LAIN_OFFLINE_SOURCE=/opt/lain-src REPO_REF=smoke \
  bash /opt/lain-src/deploy/ubuntu/install.sh --yes --dns-address 192.168.1.50
exec_in test -f /opt/lain/current/apps/cli/dist/main.js || fail "the installation broke after a re-run"
pass "re-run is idempotent"

printf 'Checking the update no-op path...\n'
exec_in /usr/local/bin/node /opt/lain/current/apps/cli/dist/main.js update --version v0.1.0 --yes | grep -q "Already on" || fail "an update to the installed version did not no-op"
pass "update no-op works"

pass "ubuntu installer smoke test passed"

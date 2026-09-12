# Security policy

## Supported versions

`main` and the latest release tag (see [docs/RELEASING.md](docs/RELEASING.md)) receive security fixes. Older tags are immutable snapshots — upgrade instead of waiting for patches.

## Threat model

Lain is a single-admin tool for a **trusted home LAN**. It is not a multi-tenant, internet-facing service, and it does not pretend to be one.

- **Never expose the dashboard or API (port 3100) to the public internet**, and do not put the dashboard behind a Cloudflare Tunnel or a port-forward "because it is convenient". For remote access use WireGuard, Tailscale, or an authenticated reverse proxy that you operate.
- **Humans** sign in with the admin password (server-side session cookie, HttpOnly/SameSite=Strict); **machines** (`lainctl`, scripts, CI) authenticate with `lain_…` API keys. Both are full-admin by design — there is no multi-user model.
- **Complete first-run setup immediately after installing.** The first person to set the admin password owns the dashboard, so do it before the host is reachable by anyone you do not trust.
- `GET /api/health` and `/dns-query` are **intentionally unauthenticated** — they are monitoring and DNS data planes, not control surfaces. Every mutating endpoint requires authentication.
- `lainctl update` verifies release tarballs against published SHA-256 checksums and rolls back automatically when the health gate fails.

## Keep private

- Cloudflare and Tunnel tokens exist only as root-owned files under `/etc/lain/credentials` (presented to services through systemd `LoadCredential`). They are never accepted as command arguments, environment values in logs, or dashboard input.
- Keep `.env`, `/etc/lain/`, and `/var/lib/lain/` (database, backups, ACME certificates) private to the host.

## Development break-glass

`LAIN_AUTH=off` disables dashboard/API authentication for mock-mode development. Live adapter mode refuses to start that way unless `LAIN_ALLOW_UNSAFE_LIVE=i-understand-the-dashboard-is-unauthenticated` is set explicitly. See the Security notes in [README.md](README.md).

## Reporting a vulnerability

Once the repository is public, open a GitHub Security Advisory (**Security → Advisories → Report a vulnerability**). Until then, contact the maintainers directly. No bounty is promised.

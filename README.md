# Lain

Lain is a small homelab service registry. A **Service** is its single source of truth; DNS, reverse proxy, TLS, Cloudflare DNS, and Cloudflare Tunnel configuration are reconciled derived state.

The MVP includes:

- Service CRUD with hostname, upstream target, site, exposure, and component switches
- React dashboard, service list, editor, detail, health, and desired-versus-actual status
- SQLite persistence through Drizzle ORM
- Authoritative local A records for managed internal/private services, UDP/TCP upstream forwarding, and DNS-over-HTTPS at `/dns-query`
- Dynamic hostname-based HTTP and WebSocket reverse proxy
- Let's Encrypt DNS-01 certificate issuance through Cloudflare, with SNI HTTPS proxying when certificates exist
- Cloudflare DNS records and managed Tunnel ingress configuration
- Periodic health checks and reconciliation
- Dashboard host setup checks for the OS, Node.js, cloudflared, and systemd services
- Safe mock adapters by default; no credentials are needed for local development
- `lainctl` and a deliberately small future-facing `lain-agent` stub

## Requirements

- Node.js 22 or newer
- pnpm 11.19.0 (Corepack installs the version pinned by `packageManager`; run `corepack enable` once)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:3100`, DNS at port `5353` over UDP and TCP, and the reverse proxy at port `8080`.

The default `LAIN_ADAPTER_MODE=mock` reports the Cloudflare and ACME operations it would perform without changing external systems. Local DNS, proxying, persistence, and health checks remain real.

### Proxmox LXC

Lain can run in a dedicated unprivileged Debian LXC instead of a full VM. A Community-Scripts-style guided launcher offers Default and Advanced profiles, while the non-interactive bootstrap supports automation. Both create the container without Docker or nesting, install Lain as a hardened systemd service, and use standard DNS `53`, HTTP `80`, and HTTPS `443` ports. See [`deploy/proxmox`](deploy/proxmox/README.md) for the one-command installer, Cloudflare credential import, updates, and recovery.

## Commands

```bash
pnpm dev                 # run laind and lain-web
pnpm dev:server          # run only laind
pnpm dev:web             # run only lain-web
pnpm build               # build every workspace package
pnpm typecheck           # check TypeScript
pnpm test                # run tests
pnpm lainctl status
pnpm lainctl services
pnpm lainctl reconcile
pnpm lainctl keys create home-ci
pnpm lainctl auth login
```

### Secure host setup

The dashboard's **Host setup** panel provides remediation commands, but never runs privileged operations itself. Run a displayed command locally on the Lain host. `lainctl` shows an allowlisted change plan and asks for confirmation before changing the machine.

Build Lain before installing its system service:

```bash
pnpm build
sudo node apps/cli/dist/main.js setup ubuntu --install-laind
```

Install `cloudflared` from Cloudflare's signed APT repository without configuring a Tunnel yet:

```bash
sudo node apps/cli/dist/main.js setup ubuntu --install-cloudflared
```

For a remotely managed Tunnel, save the Tunnel token and scoped API token into temporary local files readable only by root, then import them. Token values are deliberately not accepted in arguments, environment variables, or the web UI.

```bash
sudo node apps/cli/dist/main.js setup ubuntu \
  --tunnel-token-file /root/cloudflare-tunnel-token \
  --cloudflare-api-token-file /root/cloudflare-api-token \
  --zone-id YOUR_ZONE_ID \
  --account-id YOUR_ACCOUNT_ID \
  --tunnel-id YOUR_TUNNEL_ID \
  --live
```

The installer stores secrets as mode `0600` files under `/etc/lain/credentials`. systemd presents them to each service through `LoadCredential`; `cloudflared` consumes its credential through `--token-file`. Non-secret IDs are persisted in `/etc/lain/lain.env`. The generated units use dynamic users and systemd sandboxing. Remove the temporary source token files after verifying both services.

Development uses unprivileged DNS/proxy ports `5353`, `8080`, and `8443`. The systemd installer configures standard ingress on DNS `53`, HTTP `80`, and HTTPS `443`, granting `laind` only `CAP_NET_BIND_SERVICE`; the daemon still runs as an unprivileged dynamic user. Pass `--dns-address <lain-lan-ip>` so managed names resolve to the Lain host rather than each client's loopback interface.

The installer supports Ubuntu and Debian, refuses to overwrite unmanaged unit/repository files by default, and never evaluates shell input. Use `--replace` only after manually inspecting a reported conflict. Use `--yes` only for an already-reviewed non-interactive deployment.

### Connect clients to Lain DNS

Give the Lain host a stable LAN address, then install it with that address as the managed DNS record target:

```bash
sudo node apps/cli/dist/main.js setup ubuntu --install-laind --dns-address 192.168.1.10
```

The recommended client configuration is to set the Lain host address as the DNS server distributed by your router's DHCP service. Allow UDP and TCP port `53` from the trusted LAN, renew client DHCP leases, and verify with `dig @192.168.1.10 your-managed-hostname`. Detailed router, Ubuntu, macOS, Windows, mobile, firewall, and troubleshooting instructions are available at `/docs#client-dns` in the dashboard.

For a production-style local run, build the web app first and then start the server from its package directory. `laind` serves the built web assets when `apps/web/dist` exists.

```bash
pnpm build
pnpm --filter @lain/server start
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `LAIN_HOST` / `LAIN_PORT` | `0.0.0.0` / `3100` | API and web listener |
| `LAIN_PUBLIC_URL` | `http://localhost:3100` | Public laind URL |
| `LAIN_DATABASE_URL` | `./data/lain.db` | SQLite file |
| `LAIN_DNS_HOST` / `LAIN_DNS_PORT` | `0.0.0.0` / `5353` | DNS listeners |
| `LAIN_DNS_UPSTREAM` | `1.1.1.1` | Forwarder for unmanaged queries |
| `LAIN_DNS_RECORD_ADDRESS` | `127.0.0.1` | A record returned for proxied local services; set this to the Lain host LAN address |
| `LAIN_PROXY_HOST` / `LAIN_PROXY_PORT` | `0.0.0.0` / `8080` | HTTP and WebSocket proxy |
| `LAIN_PROXY_TLS_PORT` | `8443` | HTTPS proxy when ACME certificates exist |
| `LAIN_RECONCILE_INTERVAL_MS` | `30000` | Reconciliation interval |
| `LAIN_HEALTH_INTERVAL_MS` | `30000` | Health-check interval |
| `LAIN_ADAPTER_MODE` | `mock` | Set to `live` to enable external mutations |
| `LAIN_AUTH` | `session` | Set `off` to disable dashboard/API authentication (dev break-glass) |
| `LAIN_TRUSTED_ORIGINS` | empty | Comma-separated origins allowed to call the API cross-origin |
| `LAIN_ALLOW_UNSAFE_LIVE` | empty | Exact phrase required to run live mode with authentication disabled |
| `LAIN_API_KEY` | empty | API key for `lainctl` and scripts (used by the CLI, not laind) |
| `CLOUDFLARE_API_TOKEN` | empty | Scoped API token for DNS and Tunnel changes |
| `CLOUDFLARE_ZONE_ID` | empty | Zone containing managed hostnames |
| `CLOUDFLARE_ACCOUNT_ID` | empty | Account containing the Tunnel |
| `CLOUDFLARE_TUNNEL_ID` | empty | Existing Tunnel managed by Lain |
| `CLOUDFLARE_TUNNEL_CNAME` | `<tunnel-id>.cfargotunnel.com` | Optional explicit Tunnel DNS target |
| `ACME_EMAIL` | empty | Let's Encrypt account email |
| `LAIN_URL` | `http://localhost:3100` | API URL used by `lainctl` |

The Cloudflare token needs DNS edit permission for the selected zone and Cloudflare Tunnel edit permission for live Tunnel reconciliation.

## Architecture

```text
lain-web ───────┐
lainctl ────────┼──> laind API ──> Service registry (SQLite + Drizzle)
future agent ───┘                    │
                                    ├── local DNS + DoH
                                    ├── HTTP(S) / WebSocket proxy
                                    ├── health checker
                                    └── reconciler
                                         ├── Cloudflare DNS
                                         ├── Let's Encrypt DNS-01
                                         └── Cloudflare Tunnel config
```

The database contains declared services and observed component statuses. Adapters do not own independent configuration models: they receive a Service and make their system match it. This keeps reconciliation understandable and makes mocks interchangeable with live integrations.

`cloudflared` is never spawned by the API process. Lain only reconciles the configuration of an existing Tunnel, pointing its hostname ingress at the local HTTP proxy. `lainctl setup ubuntu` can install and supervise it as a separate hardened systemd service; static examples are in [`docs/systemd`](docs/systemd).

## Current MVP boundaries

- A single Lain node owns one Cloudflare zone and one existing Tunnel.
- Local DNS currently synthesizes IPv4 A records. Other record types are forwarded upstream.
- HTTPS starts when at least one issued certificate exists at startup. Restart `laind` after enabling TLS for the first service; SNI then reads current certificate files for every hostname.
- Health checks use `HEAD /`; per-service paths and expected status policies are future work.
- Deleting a service removes it locally. External record cleanup is intentionally deferred until adapters can track ownership safely.
- `lain-agent` establishes the package boundary only; remote-site transport is not part of this MVP.

## Repository layout

```text
apps/server   laind API, registry, DNS, proxy, reconciliation
apps/web      lain-web React and Tailwind UI
apps/cli      lainctl
apps/agent    lain-agent stub
packages/shared  shared domain and API types
docs/systemd  deployment examples
docs/RELEASING.md  release tags and checksums
deploy/proxmox  unprivileged Proxmox LXC bootstrap
scripts  CI guard scripts
```

## Security notes

Access control is single-admin: the dashboard uses an admin password with server-side session cookies, and machines (lainctl, scripts, CI) use API keys. Both are managed after installation.

- **First-run setup**: on first open, the dashboard asks you to create the admin password. Complete it immediately — whoever sets the password first owns the dashboard. Only a scrypt hash is stored; the password never leaves the browser.
- **API keys**: create and revoke keys on the dashboard's *API keys* page or with `lainctl keys`. Keys authenticate every endpoint the dashboard can reach, are shown once at creation, and are stored only as SHA-256 hashes. Roll a key by creating a replacement and revoking the old one.
- **Distribution**: export `LAIN_API_KEY` on headless servers and CI; on desktops, `lainctl auth login` prompts once and stores a dedicated key in the OS keychain. The admin password is never accepted through environment variables, arguments, or the keyring.
- **Sessions**: survive restarts, expire after seven days, and are invalidated when the password changes.
- **Recovery**: forgot the password? Stop laind, clear the stored hash, and restart — the dashboard returns to first-run setup and all existing sessions are invalidated:

  ```bash
  sudo systemctl stop laind
  sudo apt install sqlite3
  sudo sqlite3 /var/lib/lain/lain.db "DELETE FROM auth_credentials;"
  sudo systemctl start laind
  ```

- **Cross-origin**: the API is same-origin by default; arbitrary origins are rejected, and `LAIN_TRUSTED_ORIGINS` allows explicit exceptions. State-changing requests must originate from the dashboard's own origin.
- **Break-glass**: `LAIN_AUTH=off` disables authentication entirely. It is refused in live adapter mode unless `LAIN_ALLOW_UNSAFE_LIVE=i-understand-the-dashboard-is-unauthenticated` is set, and it logs a loud warning in mock mode.
- **Topology**: keep the dashboard and API on your trusted LAN — never port-forward or expose them directly to the internet. Cloudflare Tunnel ingress is for the services Lain proxies, not for laind itself.
- **Least privilege**: use a Cloudflare token scoped to DNS edit and Tunnel edit only; keep `.env`, credential source files, the database, and the certificate directory private.

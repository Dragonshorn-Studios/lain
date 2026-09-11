# Proxmox LXC deployment

This deployment creates a dedicated, **unprivileged** Debian LXC instead of a VM. It does not enable nesting or run Docker. Lain runs as a hardened dynamic systemd user inside the container and receives only the capability needed to bind DNS `53`, HTTP `80`, and HTTPS `443`.

## Before you begin

- Public repository: `https://github.com/Dragonshorn-Studios/lain`.
- Reserve a static LAN address for the container.
- Run the guided command or a checked-out script on a Proxmox VE host as `root`.
- Allow the container outbound HTTPS for package and source downloads.
- Allow trusted LAN clients to reach UDP/TCP `53`, TCP `80`, TCP `443`, and the dashboard on TCP `3100`.

## Guided one-command install

Like Proxmox Community Scripts, the interactive launcher offers **Default** and **Advanced** profiles, prompts for the static network settings, shows the complete container plan, and asks before creating anything. For a public repository, run this in the Proxmox VE shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Dragonshorn-Studios/lain/main/deploy/proxmox/install.sh)"
```

The launcher has no telemetry and never requests Cloudflare credentials. The canonical source is pinned to `https://github.com/Dragonshorn-Studios/lain.git`; use `REPO_REF` only when selecting a branch, tag, or reviewed commit.

Running downloaded code as Proxmox `root` necessarily trusts the referenced repository and branch. For the inspect-before-running version, download the launcher first or clone the repository:

```bash
curl -fsSLo /tmp/lain-lxc-install.sh \
  https://raw.githubusercontent.com/Dragonshorn-Studios/lain/main/deploy/proxmox/install.sh
less /tmp/lain-lxc-install.sh
bash /tmp/lain-lxc-install.sh
```

For the most reproducible install, replace `main` in both URLs with a release tag or a reviewed commit SHA and set `REPO_REF` to the same ref. Release tags and their checksums are documented in [`docs/RELEASING.md`](../../docs/RELEASING.md).

## Non-interactive install

Clone the repository, review the scripts, and provide all required network settings:

```bash
git clone https://github.com/Dragonshorn-Studios/lain.git
cd lain

IP_CIDR=192.168.1.20/24 \
GATEWAY=192.168.1.1 \
bash deploy/proxmox/create-lxc.sh
```

The defaults create a two-core, 1 GiB RAM, 8 GiB Debian 12 container on `vmbr0`, using `local` for templates and `local-lvm` for its root disk. Override them only when needed:

```bash
CT_ID=220 \
CT_HOSTNAME=lain \
BRIDGE=vmbr0 \
TEMPLATE_STORAGE=local \
ROOTFS_STORAGE=local-lvm \
CORES=2 MEMORY_MB=2048 DISK_GB=12 \
REPO_REF=main \
IP_CIDR=192.168.1.20/24 GATEWAY=192.168.1.1 \
bash deploy/proxmox/create-lxc.sh
```

Set `INSTALL_CLOUDFLARED=0` if this node will never use a Cloudflare Tunnel. By default the package is installed, but its service remains disabled until a token is imported.

## Import Cloudflare configuration

Keep secrets out of environment variables, command arguments, the dashboard, and Proxmox task logs. Create token files on your workstation, copy them directly into the container, then import them with Lain's installer. The example assumes container ID `220`:

```bash
# Run on the Proxmox host. Source files should already be mode 0600.
pct push 220 /root/cloudflare-tunnel-token /root/cloudflare-tunnel-token --perms 0600
pct push 220 /root/cloudflare-api-token /root/cloudflare-api-token --perms 0600

pct exec 220 -- node /opt/lain/apps/cli/dist/main.js setup ubuntu \
  --tunnel-token-file /root/cloudflare-tunnel-token \
  --cloudflare-api-token-file /root/cloudflare-api-token \
  --zone-id YOUR_ZONE_ID \
  --account-id YOUR_ACCOUNT_ID \
  --tunnel-id YOUR_TUNNEL_ID \
  --live \
  --yes

pct exec 220 -- rm -- /root/cloudflare-tunnel-token /root/cloudflare-api-token
```

Lain persists imported secrets as root-only files under `/etc/lain/credentials`; systemd exposes them to the relevant services with `LoadCredential`. Non-secret IDs and network settings are persisted in `/etc/lain/lain.env`. Both survive container and Proxmox host restarts.

## Verify

```bash
pct exec 220 -- systemctl --no-pager status laind cloudflared
pct exec 220 -- journalctl -u laind -n 100 --no-pager
dig @192.168.1.20 YOUR_REGISTERED_HOSTNAME
curl -I http://YOUR_REGISTERED_HOSTNAME
```

Then open `http://192.168.1.20:3100` and complete first-run setup immediately: whoever sets the admin password first owns the dashboard. Configure your router's DHCP service to distribute `192.168.1.20` as the DNS server. For machine access, create an API key on the dashboard's *API keys* page (or run `lainctl keys create`) and export it as `LAIN_API_KEY`.

## Update or recover

The creator never destroys a partially installed container. If setup fails, it prints commands to enter or remove that exact container. To update an existing installation:

```bash
pct exec 220 -- git -C /opt/lain pull --ff-only
pct exec 220 -- bash -lc 'cd /opt/lain && pnpm install --frozen-lockfile && pnpm build'
pct exec 220 -- systemctl restart laind
```

An installation pinned to a commit SHA is intentionally detached and should be updated by fetching and checking out another reviewed commit instead of using `git pull`.

Back up the container with normal Proxmox backup tooling. The important persistent state is `/var/lib/lain`, `/etc/lain`, and `/opt/lain`.

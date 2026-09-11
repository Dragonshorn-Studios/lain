# Ubuntu installation

Single-command install for a bare Ubuntu 22.04 or 24.04 LTS host (amd64 or arm64). It installs pinned prerequisites (Node.js 22 verified against its published SHASUMS, pnpm 11.19.0), places a release under `/opt/lain/releases/<version>` with `/opt/lain/current` pointing at it, and runs the same hardened `lainctl setup ubuntu` used by the Proxmox path: `laind.service` on DNS `53`, HTTP `80`, and HTTPS `443` as a dynamic systemd user with only `CAP_NET_BIND_SERVICE`.

## Guided one-command install

Like the Proxmox installer, this is a run-from-`curl` script. On a fresh host:

```bash
curl -fsSL https://raw.githubusercontent.com/Dragonshorn-Studios/lain/<release>/deploy/ubuntu/install.sh | sudo bash -s -- --dns-address 192.168.1.20
```

Replace `<release>` with an immutable release tag (recommended) or a reviewed commit SHA. Without `--dns-address` the installer prompts for it. Add `--no-cloudflared` to skip the cloudflared package.

## Inspect before running

```bash
curl -fsSLo /tmp/lain-install.sh \
  https://raw.githubusercontent.com/Dragonshorn-Studios/lain/<release>/deploy/ubuntu/install.sh
less /tmp/lain-install.sh
sudo bash /tmp/lain-install.sh --dns-address 192.168.1.20
```

The installer fetches its installation core (`deploy/lib/install-core.sh`) from the same ref. The Lain source itself is cloned (or, for updates, downloaded and verified) from the canonical repository at the ref you pinned — `main` is only used as a fallback when the latest release cannot be resolved, and it warns loudly when that happens. For the most reproducible install, always pin a release tag or reviewed commit.

## Non-interactive install

```bash
sudo bash install.sh --yes --dns-address 192.168.1.20 --ref v0.1.0
```

## After installation

Open `http://192.168.1.20:3100` and complete first-run setup immediately: whoever sets the admin password first owns the dashboard. For machine access (`lainctl`, scripts, CI), create an API key on the dashboard's *API keys* page or with `lainctl keys create`, and export it as `LAIN_API_KEY`. Set `--dns-address` correctly so managed names resolve to this host, and configure your router's DHCP to hand out that address as DNS.

## Updates and rollback

```bash
sudo lainctl update                  # latest release
sudo lainctl update --version v0.2.0 # explicit version
```

`lainctl update` downloads the release tarball and its `SHA256SUMS` from GitHub Releases, verifies the checksum, builds the new release beside the running one, backs up the database to `/var/lib/lain/backups`, switches `/opt/lain/current` atomically, restarts `laind`, and health-gates the result. A failed step or an unhealthy service rolls back to the previous release and database automatically. The installed version appears in `lainctl status` and `lainctl --version`.

Re-running the installer on an already-installed host is a no-op that prints the update command.

## Removal

Remove the application with `sudo systemctl disable --now laind` and `sudo rm -rf /opt/lain`. User data is retained by design: `/var/lib/lain` holds the database, backups, and certificates; `/etc/lain` holds configuration and imported credentials. Delete those directories only when you intend to lose the registry.

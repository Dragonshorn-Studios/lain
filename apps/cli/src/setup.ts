import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isIPv4 } from "node:net";

const MANAGED = "# Managed by lainctl setup; edit with care.";
const CREDENTIAL_DIRECTORY = "/etc/lain/credentials";
const ENVIRONMENT_FILE = "/etc/lain/lain.env";

interface SetupOptions {
  installCloudflared: boolean;
  installLaind: boolean;
  tunnelTokenFile?: string;
  apiTokenFile?: string;
  zoneId?: string;
  accountId?: string;
  tunnelId?: string;
  dnsAddress?: string;
  live: boolean;
  yes: boolean;
  replace: boolean;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseSetupOptions(args: string[]): SetupOptions {
  const known = new Set(["--install-cloudflared", "--install-laind", "--tunnel-token-file", "--cloudflare-api-token-file", "--zone-id", "--account-id", "--tunnel-id", "--dns-address", "--live", "--yes", "--replace"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!known.has(argument)) throw new Error(`Unknown setup option: ${argument}`);
    if (["--tunnel-token-file", "--cloudflare-api-token-file", "--zone-id", "--account-id", "--tunnel-id", "--dns-address"].includes(argument)) index += 1;
  }
  const tunnelTokenFile = valueAfter(args, "--tunnel-token-file");
  const apiTokenFile = valueAfter(args, "--cloudflare-api-token-file");
  const hasLaindConfig = Boolean(apiTokenFile || valueAfter(args, "--zone-id") || valueAfter(args, "--account-id") || valueAfter(args, "--tunnel-id") || valueAfter(args, "--dns-address") || args.includes("--live"));
  return {
    installCloudflared: args.includes("--install-cloudflared") || Boolean(tunnelTokenFile),
    installLaind: args.includes("--install-laind") || hasLaindConfig,
    tunnelTokenFile,
    apiTokenFile,
    zoneId: valueAfter(args, "--zone-id"),
    accountId: valueAfter(args, "--account-id"),
    tunnelId: valueAfter(args, "--tunnel-id"),
    dnsAddress: valueAfter(args, "--dns-address"),
    live: args.includes("--live"), yes: args.includes("--yes"), replace: args.includes("--replace")
  };
}

function run(executable: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${executable} exited with ${code ?? signal}`)));
  });
}

async function atomicWrite(path: string, contents: string | Uint8Array, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = `${path}.lainctl-${process.pid}`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function managedWrite(path: string, contents: string, mode: number, replace: boolean): Promise<void> {
  if (existsSync(path)) {
    const current = await readFile(path, "utf8");
    if (current === contents) return;
    if (!current.includes(MANAGED) && !replace) throw new Error(`Refusing to replace unmanaged ${path}; inspect it and rerun with --replace if intended`);
  }
  await atomicWrite(path, contents, mode);
}

async function readSecret(path: string, label: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} must be a regular file`);
  if (info.size > 64 * 1024) throw new Error(`${label} is unexpectedly large`);
  const value = (await readFile(path, "utf8")).trim();
  if (!value) throw new Error(`${label} is empty`);
  return `${value}\n`;
}

function upsertEnvironment(current: string, values: Record<string, string | undefined>): string {
  const lines = current ? current.trimEnd().split("\n") : [MANAGED];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z0-9._:/-]+$/.test(value)) throw new Error(`${key} contains unsupported characters`);
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index === -1) lines.push(`${key}=${value}`); else lines[index] = `${key}=${value}`;
  }
  return `${lines.join("\n")}\n`;
}

function repositoryRoot(): string {
  // Versioned installs run lainctl from /opt/lain/releases/<v> but the
  // generated unit must pin /opt/lain/current so updates only need a symlink
  // switch; LAIN_INSTALL_ROOT provides that canonical path and skips
  // realpathSync so the symlink is preserved in the unit.
  const override = process.env.LAIN_INSTALL_ROOT;
  if (override) return resolve(override);
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return realpathSync(candidate);
}

async function installCloudflaredPackage(replace: boolean): Promise<void> {
  const response = await fetch("https://pkg.cloudflare.com/cloudflare-main.gpg", { redirect: "error" });
  if (!response.ok) throw new Error(`Could not download Cloudflare signing key: HTTP ${response.status}`);
  const key = new Uint8Array(await response.arrayBuffer());
  if (key.length < 1_000) throw new Error("Downloaded Cloudflare signing key is unexpectedly small");
  await atomicWrite("/usr/share/keyrings/cloudflare-main.gpg", key, 0o644);
  await managedWrite("/etc/apt/sources.list.d/cloudflared.list", `${MANAGED}\ndeb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main\n`, 0o644, replace);
  await run("/usr/bin/apt-get", ["update"]);
  await run("/usr/bin/apt-get", ["install", "--yes", "cloudflared"]);
}

async function installCloudflaredService(replace: boolean): Promise<void> {
  const tokenPath = `${CREDENTIAL_DIRECTORY}/cloudflare-tunnel-token`;
  if (!existsSync(tokenPath)) {
    console.log("cloudflared was installed but not enabled: provide --tunnel-token-file to configure the service.");
    return;
  }
  const unit = `${MANAGED}
[Unit]
Description=Cloudflare Tunnel for Lain
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
DynamicUser=yes
LoadCredential=cloudflare-tunnel-token:${tokenPath}
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run --token-file \${CREDENTIALS_DIRECTORY}/cloudflare-tunnel-token
Restart=on-failure
RestartSec=5s
NoNewPrivileges=yes
PrivateDevices=yes
PrivateTmp=yes
ProtectControlGroups=yes
ProtectHome=yes
ProtectKernelModules=yes
ProtectKernelTunables=yes
ProtectSystem=strict
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK

[Install]
WantedBy=multi-user.target
`;
  await managedWrite("/etc/systemd/system/cloudflared.service", unit, 0o644, replace);
  await run("/usr/bin/systemctl", ["daemon-reload"]);
  await run("/usr/bin/systemctl", ["enable", "--now", "cloudflared.service"]);
}

async function installLaindService(options: SetupOptions): Promise<void> {
  const root = repositoryRoot();
  const serverRoot = resolve(root, "apps/server");
  const entrypoint = resolve(serverRoot, "dist/main.js");
  if (!existsSync(entrypoint)) throw new Error(`Missing ${entrypoint}; run pnpm build before installing laind`);

  const credentialLine = existsSync(`${CREDENTIAL_DIRECTORY}/cloudflare-api-token`)
    ? `LoadCredential=cloudflare-api-token:${CREDENTIAL_DIRECTORY}/cloudflare-api-token\n` : "";
  const unit = `${MANAGED}
[Unit]
Description=Lain homelab service registry
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=lain
WorkingDirectory=${serverRoot}
EnvironmentFile=-${ENVIRONMENT_FILE}
${credentialLine}ExecStart=${process.execPath} ${entrypoint}
Restart=on-failure
RestartSec=5s
NoNewPrivileges=yes
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
PrivateDevices=yes
PrivateTmp=yes
ProtectControlGroups=yes
ProtectHome=read-only
ProtectKernelModules=yes
ProtectKernelTunables=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/lain
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK

[Install]
WantedBy=multi-user.target
`;
  await managedWrite("/etc/systemd/system/laind.service", unit, 0o644, options.replace);
  await run("/usr/bin/systemctl", ["daemon-reload"]);
  await run("/usr/bin/systemctl", ["enable", "--now", "laind.service"]);
}

export async function setupUbuntu(args: string[]): Promise<void> {
  const options = parseSetupOptions(args);
  if (options.dnsAddress && !isIPv4(options.dnsAddress)) throw new Error("--dns-address must be an IPv4 address reachable by LAN clients");
  if (!options.installCloudflared && !options.installLaind) throw new Error("No setup action selected; use --install-cloudflared, --install-laind, or provide credential/configuration options");
  if (process.getuid?.() !== 0) throw new Error("Setup changes system services and must be run locally with sudo");
  const osRelease = readFileSync("/etc/os-release", "utf8");
  if (!/^(ID|ID_LIKE)=(.*\b)?(ubuntu|debian)\b/m.test(osRelease)) throw new Error("This installer only supports Ubuntu and Debian hosts");

  if (options.installLaind && !existsSync(resolve(repositoryRoot(), "apps/server/dist/main.js"))) throw new Error("Build Lain with `pnpm build` before installing the service");
  for (const [path, label] of [[options.tunnelTokenFile, "Tunnel token"], [options.apiTokenFile, "Cloudflare API token"]] as const) {
    if (path) await readSecret(path, label);
  }

  console.log("Lain will perform these allowlisted host changes:");
  if (options.installCloudflared) console.log("  - configure Cloudflare's signed APT repository and install cloudflared");
  if (options.tunnelTokenFile) console.log(`  - import the tunnel token from ${options.tunnelTokenFile} into a root-owned credential file`);
  if (options.installLaind) console.log("  - install and enable a hardened laind.service on DNS :53, HTTP :80, and HTTPS :443");
  if (options.apiTokenFile) console.log(`  - import the Cloudflare API token from ${options.apiTokenFile} into a root-owned credential file`);
  if (options.zoneId || options.accountId || options.tunnelId || options.dnsAddress || options.live) console.log("  - update /etc/lain/lain.env with the supplied non-secret network settings");
  if (!options.yes) {
    if (!stdin.isTTY) throw new Error("Interactive confirmation requires a terminal; rerun with --yes after reviewing the plan");
    const prompt = createInterface({ input: stdin, output: stdout });
    const answer = await prompt.question("Continue? [y/N] "); prompt.close();
    if (!/^y(es)?$/i.test(answer.trim())) { console.log("Cancelled."); return; }
  }

  await mkdir(CREDENTIAL_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(CREDENTIAL_DIRECTORY, 0o700);
  if (options.tunnelTokenFile) await atomicWrite(`${CREDENTIAL_DIRECTORY}/cloudflare-tunnel-token`, await readSecret(options.tunnelTokenFile, "Tunnel token"), 0o600);
  if (options.apiTokenFile) await atomicWrite(`${CREDENTIAL_DIRECTORY}/cloudflare-api-token`, await readSecret(options.apiTokenFile, "Cloudflare API token"), 0o600);

  const existingEnvironment = existsSync(ENVIRONMENT_FILE) ? await readFile(ENVIRONMENT_FILE, "utf8") : "";
  const environment = upsertEnvironment(existingEnvironment, {
    LAIN_DATABASE_URL: "/var/lib/lain/lain.db",
    LAIN_DNS_PORT: options.installLaind ? "53" : undefined,
    LAIN_DNS_RECORD_ADDRESS: options.dnsAddress,
    LAIN_PROXY_PORT: options.installLaind ? "80" : undefined,
    LAIN_PROXY_TLS_PORT: options.installLaind ? "443" : undefined,
    CLOUDFLARE_ZONE_ID: options.zoneId,
    CLOUDFLARE_ACCOUNT_ID: options.accountId,
    CLOUDFLARE_TUNNEL_ID: options.tunnelId,
    LAIN_ADAPTER_MODE: options.live ? "live" : undefined
  });
  await atomicWrite(ENVIRONMENT_FILE, environment, 0o600);

  if (options.installCloudflared) {
    await installCloudflaredPackage(options.replace);
    await installCloudflaredService(options.replace);
  }
  if (options.installLaind) await installLaindService(options);
  console.log("Setup complete. Refresh the dashboard to verify host status.");
  console.log("Then open the dashboard and complete first-run setup immediately: whoever sets the admin password first owns the dashboard.");
}

export const setupHelp = `lainctl setup ubuntu [options]

Options:
  --install-cloudflared               Install cloudflared from its signed APT repository
  --install-laind                     Install laind on DNS :53, HTTP :80, and HTTPS :443
  --tunnel-token-file PATH            Import a remotely-managed Tunnel token from a file
  --cloudflare-api-token-file PATH    Import Lain's scoped Cloudflare API token from a file
  --zone-id ID                        Persist the Cloudflare zone ID
  --account-id ID                     Persist the Cloudflare account ID
  --tunnel-id ID                      Persist the Cloudflare Tunnel ID
  --dns-address IP                    LAN address returned for managed DNS names
  --live                              Enable live external reconciliation
  --yes                               Apply without an interactive confirmation
  --replace                           Replace conflicting unmanaged systemd/repository files

Token values are intentionally not accepted as command arguments.`;

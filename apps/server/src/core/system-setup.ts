import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { arch, networkInterfaces, platform, release } from "node:os";
import { delimiter, join } from "node:path";
import type { SetupCheck, SetupCheckState, SystemSetup } from "@lain/shared";
import type { Config } from "../config.js";

type CommandResult = { stdout: string; exitCode: number };
type CommandRunner = (executable: string, args: string[]) => Promise<CommandResult>;

const runCommand: CommandRunner = (executable, args) => new Promise((resolve) => {
  execFile(executable, args, { timeout: 2_000 }, (error, stdout) => {
    const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
    resolve({ stdout: stdout.trim(), exitCode });
  });
});

async function findExecutable(name: string): Promise<string | undefined> {
  const candidates = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH; missing optional host tools are represented as checks.
    }
  }
  return undefined;
}

function check(id: SetupCheck["id"], label: string, state: SetupCheckState, required: boolean, detail: string, remediation?: SetupCheck["remediation"]): SetupCheck {
  return { id, label, state, required, detail, ...(remediation ? { remediation } : {}) };
}

function serviceDetail(service: string, active: string, enabled: string): { state: SetupCheckState; detail: string } {
  if (active === "active" && enabled === "enabled") return { state: "ready", detail: `${service}.service is active and enabled at boot` };
  if (active === "active") return { state: "warning", detail: `${service}.service is active but ${enabled || "not enabled at boot"}` };
  if (active === "inactive" || active === "failed" || active === "activating") return { state: "warning", detail: `${service}.service is ${active}` };
  return { state: "warning", detail: `${service}.service is not installed` };
}

function hostAddresses(): SystemSetup["addresses"] {
  const virtual = /^(br-|docker|podman|veth|virbr|lo|tailscale|tun|tap|wg)/i;
  let interfaces: ReturnType<typeof networkInterfaces>;
  try { interfaces = networkInterfaces(); }
  catch { return []; }
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => ({ interface: name, address: entry.address, network: networkCidr(entry.cidr ?? `${entry.address}/32`) })))
    .sort((left, right) => Number(virtual.test(left.interface)) - Number(virtual.test(right.interface)) || left.interface.localeCompare(right.interface));
}

function networkCidr(cidr: string): string {
  const [address, prefixText = "32"] = cidr.split("/");
  const prefix = Number.parseInt(prefixText, 10);
  const value = address!.split(".").reduce((result, octet) => ((result << 8) | Number.parseInt(octet, 10)) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  return `${[24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join(".")}/${prefix}`;
}

export class SystemSetupChecker {
  private cached?: { expiresAt: number; value: SystemSetup };

  constructor(private readonly config?: Config, private readonly runner: CommandRunner = runCommand, private readonly cacheMs = 15_000) {}

  async inspect(): Promise<SystemSetup> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.value;

    const osPlatform = platform();
    const osRelease = release();
    const architecture = arch();
    const addresses = hostAddresses();
    const suggestedAddress = addresses[0]?.address ?? "<lain-lan-ip>";
    const checks: SetupCheck[] = [
      check("operating-system", "Operating system", osPlatform === "linux" ? "ready" : "warning", false, `${osPlatform} ${osRelease} (${architecture})`)
    ];

    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    checks.push(check("node", "Node.js", nodeMajor >= 22 ? "ready" : "error", true, `v${process.versions.node}${nodeMajor >= 22 ? "" : " — v22 or newer is required"}`));

    const cloudflared = await findExecutable(process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    if (cloudflared) {
      const version = await this.runner(cloudflared, ["--version"]);
      checks.push(check("cloudflared", "cloudflared", version.exitCode === 0 ? "ready" : "warning", false, version.stdout || `Installed at ${cloudflared}`));
    } else {
      checks.push(check("cloudflared", "cloudflared", "warning", false, "Not found in PATH — required for Cloudflare Tunnel services", {
        command: "sudo node apps/cli/dist/main.js setup ubuntu --install-cloudflared",
        description: "Install cloudflared from Cloudflare's signed APT repository."
      }));
    }

    if (this.config) {
      const missing = [
        ["API token", this.config.cloudflare.apiToken], ["zone ID", this.config.cloudflare.zoneId],
        ["account ID", this.config.cloudflare.accountId], ["tunnel ID", this.config.cloudflare.tunnelId],
        ["live adapter mode", this.config.adapterMode === "live" ? "live" : undefined]
      ].filter(([, value]) => !value).map(([label]) => label);
      checks.push(check("cloudflare-config", "Cloudflare configuration", missing.length ? "warning" : "ready", false,
        missing.length ? `Missing ${missing.join(", ")}` : "API credential and resource IDs are configured",
        missing.length ? {
          command: "sudo node apps/cli/dist/main.js setup ubuntu --cloudflare-api-token-file /root/cloudflare-api-token --zone-id <zone-id> --account-id <account-id> --tunnel-id <tunnel-id> --live",
          description: "Import the API token from a local file and persist non-secret IDs."
        } : undefined));
      const standardNetworkPorts = this.config.dnsPort === 53 && this.config.proxyPort === 80 && this.config.proxyTlsPort === 443;
      checks.push(check("proxy-ports", "Network ports", standardNetworkPorts ? "ready" : "warning", false,
        standardNetworkPorts ? "DNS :53, HTTP :80, and HTTPS :443" : `DNS :${this.config.dnsPort}, HTTP :${this.config.proxyPort}, HTTPS :${this.config.proxyTlsPort} — development defaults`,
        standardNetworkPorts ? undefined : { command: "sudo node apps/cli/dist/main.js setup ubuntu --install-laind", description: "Install laind with standard DNS and HTTP/HTTPS ports using the minimal bind capability." }));
      const lanDnsAddress = this.config.dnsRecordAddress !== "127.0.0.1" && this.config.dnsRecordAddress !== "localhost";
      checks.push(check("dns-address", "DNS record address", lanDnsAddress ? "ready" : "warning", false,
        lanDnsAddress ? this.config.dnsRecordAddress : "127.0.0.1 — remote clients would resolve back to themselves",
        lanDnsAddress ? undefined : { command: `sudo node apps/cli/dist/main.js setup ubuntu --install-laind --dns-address ${suggestedAddress}`, description: "Set the LAN address that managed DNS names should resolve to." }));
    }

    const systemctl = await findExecutable(process.platform === "win32" ? "systemctl.exe" : "systemctl");
    if (osPlatform !== "linux" || !systemctl) {
      const detail = osPlatform === "linux" ? "systemctl is not installed" : "systemd checks are only available on Linux";
      checks.push(check("laind-service", "laind service", "warning", false, detail, { command: "sudo node apps/cli/dist/main.js setup ubuntu --install-laind", description: "Install and enable the hardened laind systemd service." }));
      checks.push(check("cloudflared-service", "cloudflared service", "warning", false, detail, { command: "sudo node apps/cli/dist/main.js setup ubuntu --tunnel-token-file /root/cloudflare-tunnel-token", description: "Import a tunnel token file and enable cloudflared." }));
    } else {
      const [laind, laindEnabled, tunnel, tunnelEnabled] = await Promise.all([
        this.runner(systemctl, ["is-active", "laind.service"]),
        this.runner(systemctl, ["is-enabled", "laind.service"]),
        this.runner(systemctl, ["is-active", "cloudflared.service"]),
        this.runner(systemctl, ["is-enabled", "cloudflared.service"])
      ]);
      const laindStatus = serviceDetail("laind", laind.stdout, laindEnabled.stdout);
      const tunnelStatus = serviceDetail("cloudflared", tunnel.stdout, tunnelEnabled.stdout);
      checks.push(check("laind-service", "laind service", laindStatus.state, false, laindStatus.detail, laindStatus.state === "ready" ? undefined : { command: "sudo node apps/cli/dist/main.js setup ubuntu --install-laind", description: "Install or re-enable the hardened laind service." }));
      checks.push(check("cloudflared-service", "cloudflared service", tunnelStatus.state, false, tunnelStatus.detail, tunnelStatus.state === "ready" ? undefined : { command: "sudo node apps/cli/dist/main.js setup ubuntu --tunnel-token-file /root/cloudflare-tunnel-token", description: "Import the tunnel token from a local file and enable cloudflared." }));
    }

    const value = { checkedAt: new Date().toISOString(), platform: osPlatform, release: osRelease, architecture, addresses, checks };
    this.cached = { expiresAt: Date.now() + this.cacheMs, value };
    return value;
  }
}

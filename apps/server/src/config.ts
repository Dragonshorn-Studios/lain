import { readFileSync } from "node:fs";
import { join } from "node:path";

export type AuthMode = "session" | "off";

export const UNSAFE_LIVE_ACKNOWLEDGEMENT = "i-understand-the-dashboard-is-unauthenticated";

export interface Config {
  host: string;
  port: number;
  publicUrl: string;
  databaseUrl: string;
  dnsHost: string;
  dnsPort: number;
  dnsUpstream: string;
  dnsRecordAddress: string;
  proxyHost: string;
  proxyPort: number;
  proxyTlsPort: number;
  reconcileIntervalMs: number;
  healthIntervalMs: number;
  adapterMode: "mock" | "live";
  authMode: AuthMode;
  allowUnsafeLive: boolean;
  trustedOrigins: string[];
  cloudflare: {
    apiToken?: string;
    zoneId?: string;
    accountId?: string;
    tunnelId?: string;
    tunnelCname?: string;
  };
  acmeEmail?: string;
}

const integer = (value: string | undefined, fallback: number) => value ? Number.parseInt(value, 10) : fallback;

function credential(env: NodeJS.ProcessEnv, name: string, fallback?: string): string | undefined {
  const directory = env.CREDENTIALS_DIRECTORY;
  if (!directory) return fallback;
  try { return readFileSync(join(directory, name), "utf8").trim() || fallback; }
  catch { return fallback; }
}

export function loadConfig(env = process.env): Config {
  const config: Config = {
    host: env.LAIN_HOST ?? "0.0.0.0",
    port: integer(env.LAIN_PORT, 3100),
    publicUrl: env.LAIN_PUBLIC_URL ?? "http://localhost:3100",
    databaseUrl: env.LAIN_DATABASE_URL ?? "./data/lain.db",
    dnsHost: env.LAIN_DNS_HOST ?? "0.0.0.0",
    dnsPort: integer(env.LAIN_DNS_PORT, 5353),
    dnsUpstream: env.LAIN_DNS_UPSTREAM ?? "1.1.1.1",
    dnsRecordAddress: env.LAIN_DNS_RECORD_ADDRESS ?? "127.0.0.1",
    proxyHost: env.LAIN_PROXY_HOST ?? "0.0.0.0",
    proxyPort: integer(env.LAIN_PROXY_PORT, 8080),
    proxyTlsPort: integer(env.LAIN_PROXY_TLS_PORT, 8443),
    reconcileIntervalMs: integer(env.LAIN_RECONCILE_INTERVAL_MS, 30_000),
    healthIntervalMs: integer(env.LAIN_HEALTH_INTERVAL_MS, 30_000),
    adapterMode: env.LAIN_ADAPTER_MODE === "live" ? "live" : "mock",
    authMode: env.LAIN_AUTH === "off" ? "off" : "session",
    allowUnsafeLive: env.LAIN_ALLOW_UNSAFE_LIVE === UNSAFE_LIVE_ACKNOWLEDGEMENT,
    trustedOrigins: (env.LAIN_TRUSTED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
    cloudflare: {
      apiToken: credential(env, "cloudflare-api-token", env.CLOUDFLARE_API_TOKEN),
      zoneId: env.CLOUDFLARE_ZONE_ID,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      tunnelId: env.CLOUDFLARE_TUNNEL_ID,
      tunnelCname: env.CLOUDFLARE_TUNNEL_CNAME
    },
    acmeEmail: env.ACME_EMAIL
  };
  assertSafeAuthCombination(config);
  return config;
}

function assertSafeAuthCombination(config: Config): void {
  if (config.authMode !== "off" || config.adapterMode !== "live" || config.allowUnsafeLive) return;
  throw new Error(
    "Refusing to start: live adapters with authentication disabled would let anyone who can reach laind " +
    "change the registry and trigger external Cloudflare and Let's Encrypt mutations. " +
    `Re-enable authentication (remove LAIN_AUTH=off) or set LAIN_ALLOW_UNSAFE_LIVE=${UNSAFE_LIVE_ACKNOWLEDGEMENT} to accept the risk explicitly.`
  );
}

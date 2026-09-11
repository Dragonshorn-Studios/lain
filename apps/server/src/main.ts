import { dirname, resolve } from "node:path";
import { AcmeAdapter } from "./adapters/acme.js";
import { CloudflareDnsAdapter, CloudflareTunnelAdapter } from "./adapters/cloudflare.js";
import { LocalStateAdapter } from "./adapters/local.js";
import { MockAdapter } from "./adapters/mock.js";
import { buildApi } from "./api.js";
import { AuthService } from "./auth/service.js";
import { redactSecrets } from "./auth/redact.js";
import { loadConfig } from "./config.js";
import { HealthChecker } from "./core/health.js";
import { Reconciler } from "./core/reconciler.js";
import { createDatabase } from "./db/client.js";
import { DnsServer } from "./network/dns-server.js";
import { ProxyServer } from "./network/proxy-server.js";
import { ServiceRepository } from "./services/repository.js";

const config = loadConfig();
const { db, sqlite, persist } = await createDatabase(config.databaseUrl);
const repository = new ServiceRepository(db, persist);
const auth = new AuthService(db, persist);
const redact = (message: string) => redactSecrets(message, [config.cloudflare.apiToken]);
const certificateDir = resolve(dirname(config.databaseUrl), "certificates");
const externalAdapters = config.adapterMode === "live"
  ? [new CloudflareDnsAdapter(config.cloudflare), new AcmeAdapter(config, certificateDir), new CloudflareTunnelAdapter(config.cloudflare, config.proxyPort)]
  : [
      new MockAdapter("cloudflare-dns", (service) => service.dnsEnabled && service.exposure !== "internal"),
      new MockAdapter("tls", (service) => service.tlsEnabled),
      new MockAdapter("cloudflare-tunnel", (service) => service.cloudflareTunnelEnabled)
    ];
const reconciler = new Reconciler(repository, [new LocalStateAdapter("dns"), new LocalStateAdapter("proxy"), ...externalAdapters], redact);
const health = new HealthChecker(repository, redact);
const dns = new DnsServer(repository, config.dnsHost, config.dnsPort, config.dnsUpstream, config.dnsRecordAddress);
const proxy = new ProxyServer(repository, config.proxyHost, config.proxyPort, config.proxyTlsPort, certificateDir);
const api = await buildApi(config, repository, reconciler, health, dns, auth);
if (config.authMode === "off") {
  console.error("WARNING: authentication is disabled (LAIN_AUTH=off). The dashboard and API are open to anyone who can reach them.");
}
if (config.adapterMode === "live" && !config.cloudflare.apiToken) {
  console.error("WARNING: live adapter mode has no Cloudflare API token; reconciliation will fail until one is imported.");
}
await reconciler.reconcileAll();
await Promise.all([api.listen({ host: config.host, port: config.port }), dns.start(), proxy.start()]);
void health.checkAll();
const reconcileTimer = setInterval(() => void reconciler.reconcileAll(), config.reconcileIntervalMs);
const healthTimer = setInterval(() => void health.checkAll(), config.healthIntervalMs);
api.log.info(`DNS listening on ${config.dnsHost}:${config.dnsPort} (UDP/TCP)`);
api.log.info(`Reverse proxy listening on ${config.proxyHost}:${config.proxyPort}`);
api.log.info(`TLS proxy uses ${config.proxyHost}:${config.proxyTlsPort} when certificates are available`);
const shutdown = async () => {
  clearInterval(reconcileTimer); clearInterval(healthTimer);
  await Promise.all([api.close(), dns.stop(), proxy.stop()]); persist(); sqlite.close(); process.exit(0);
};
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);

import type { Service } from "@lain/shared";
import type { Config } from "../config.js";
import type { DerivedStateAdapter, ReconcileResult } from "./types.js";
import { disabled } from "./types.js";

interface CloudflareResponse<T> { success: boolean; errors: Array<{ message: string }>; result: T; }
interface DnsRecord { id: string; type: string; name: string; content: string; proxied: boolean; }

class CloudflareClient {
  constructor(private readonly token: string) {}
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...init?.headers }
    });
    const body = await response.json() as CloudflareResponse<T>;
    if (!response.ok || !body.success) throw new Error(body.errors?.map((error) => error.message).join(", ") || `Cloudflare returned ${response.status}`);
    return body.result;
  }
}

export class CloudflareDnsAdapter implements DerivedStateAdapter {
  readonly component = "cloudflare-dns" as const;
  private readonly client: CloudflareClient;
  constructor(private readonly config: Config["cloudflare"]) { this.client = new CloudflareClient(config.apiToken!); }
  async reconcile(service: Service): Promise<ReconcileResult> {
    if (!service.dnsEnabled || service.exposure === "internal") return disabled(this.component);
    const zoneId = this.config.zoneId!;
    const existing = await this.client.request<DnsRecord[]>(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(service.hostname)}`);
    const tunnelTarget = this.config.tunnelCname || (this.config.tunnelId ? `${this.config.tunnelId}.cfargotunnel.com` : undefined);
    const type = service.cloudflareTunnelEnabled ? "CNAME" : /^[0-9.]+$/.test(service.targetHost) ? "A" : "CNAME";
    const content = service.cloudflareTunnelEnabled ? tunnelTarget : service.targetHost;
    if (!content) throw new Error("CLOUDFLARE_TUNNEL_CNAME or CLOUDFLARE_TUNNEL_ID is required");
    const payload = { type, name: service.hostname, content, proxied: service.exposure === "public", ttl: 1 };
    if (existing[0]) await this.client.request(`/zones/${zoneId}/dns_records/${existing[0].id}`, { method: "PUT", body: JSON.stringify(payload) });
    else await this.client.request(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify(payload) });
    return { component: this.component, desired: `${type} ${content}`, actual: `${type} ${content}`, state: "ready" };
  }
}

export class CloudflareTunnelAdapter implements DerivedStateAdapter {
  readonly component = "cloudflare-tunnel" as const;
  private readonly client: CloudflareClient;
  constructor(private readonly config: Config["cloudflare"], private readonly proxyPort: number) { this.client = new CloudflareClient(config.apiToken!); }
  async reconcile(service: Service): Promise<ReconcileResult> {
    if (!service.cloudflareTunnelEnabled) return disabled(this.component);
    const base = `/accounts/${this.config.accountId}/cfd_tunnel/${this.config.tunnelId}/configurations`;
    type TunnelConfig = { config?: { ingress?: Array<{ hostname?: string; service: string }> } };
    const current = await this.client.request<TunnelConfig>(base);
    const ingress = (current.config?.ingress ?? []).filter((rule) => rule.hostname !== service.hostname && rule.service !== "http_status:404");
    ingress.push({ hostname: service.hostname, service: `http://127.0.0.1:${this.proxyPort}` }, { service: "http_status:404" });
    await this.client.request(base, { method: "PUT", body: JSON.stringify({ config: { ingress } }) });
    return { component: this.component, desired: `tunnel -> 127.0.0.1:${this.proxyPort}`, actual: "ingress configured", state: "ready", message: "cloudflared is expected to be managed by systemd" };
  }
}

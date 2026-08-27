import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as acme from "acme-client";
import type { Service } from "@lain/shared";
import type { Config } from "../config.js";
import type { DerivedStateAdapter, ReconcileResult } from "./types.js";
import { disabled } from "./types.js";

interface CloudflareResult<T> { success: boolean; result: T; errors: Array<{ message: string }>; }

export class AcmeAdapter implements DerivedStateAdapter {
  readonly component = "tls" as const;
  constructor(private readonly config: Config, private readonly certificateDir: string) {}
  async reconcile(service: Service): Promise<ReconcileResult> {
    if (!service.tlsEnabled) return disabled(this.component);
    const certPath = join(this.certificateDir, `${service.hostname}.crt`);
    try {
      const certificate = await readFile(certPath, "utf8");
      const validTo = new Date(new (await import("node:crypto")).X509Certificate(certificate).validTo);
      if (validTo.getTime() - Date.now() > 30 * 86_400_000) {
        return { component: this.component, desired: "valid certificate", actual: `valid until ${validTo.toISOString()}`, state: "ready" };
      }
    } catch { /* A missing or invalid certificate is provisioned below. */ }
    await this.issue(service.hostname);
    return { component: this.component, desired: "valid certificate", actual: "certificate issued", state: "ready" };
  }
  private async issue(hostname: string): Promise<void> {
    const { apiToken, zoneId } = this.config.cloudflare;
    if (!apiToken || !zoneId || !this.config.acmeEmail) throw new Error("Cloudflare credentials and ACME_EMAIL are required for certificate issuance");
    await mkdir(this.certificateDir, { recursive: true });
    const accountKeyPath = join(this.certificateDir, "account.key");
    let accountKey: Buffer;
    try { accountKey = await readFile(accountKeyPath); }
    catch { accountKey = await acme.crypto.createPrivateKey(); await writeFile(accountKeyPath, accountKey); }
    const [key, csr] = await acme.crypto.createCsr({ commonName: hostname });
    const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.production, accountKey });
    let challengeRecordId: string | undefined;
    const cf = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" } });
      const body = await response.json() as CloudflareResult<T>;
      if (!response.ok || !body.success) throw new Error(body.errors?.map((error) => error.message).join(", ") || "Cloudflare ACME challenge failed");
      return body.result;
    };
    const certificate = await client.auto({
      csr, email: this.config.acmeEmail, termsOfServiceAgreed: true,
      challengePriority: ["dns-01"],
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        const value = createHash("sha256").update(keyAuthorization).digest("base64url");
        const result = await cf<{ id: string }>(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type: "TXT", name: `_acme-challenge.${hostname}`, content: value, ttl: 60 }) });
        challengeRecordId = result.id;
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      },
      challengeRemoveFn: async () => { if (challengeRecordId) await cf(`/zones/${zoneId}/dns_records/${challengeRecordId}`, { method: "DELETE" }); }
    });
    await Promise.all([writeFile(join(this.certificateDir, `${hostname}.key`), key), writeFile(join(this.certificateDir, `${hostname}.crt`), certificate)]);
  }
}

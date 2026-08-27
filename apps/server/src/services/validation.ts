import { z } from "zod";

export const serviceInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  hostname: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
  targetProtocol: z.enum(["http", "https"]),
  targetHost: z.string().trim().min(1).max(253),
  targetPort: z.coerce.number().int().min(1).max(65535),
  site: z.string().trim().min(1).max(64),
  exposure: z.enum(["internal", "private", "public"]),
  dnsEnabled: z.boolean(),
  proxyEnabled: z.boolean(),
  tlsEnabled: z.boolean(),
  tlsProvider: z.enum(["none", "letsencrypt-cloudflare"]),
  cloudflareTunnelEnabled: z.boolean()
}).superRefine((service, context) => {
  if (service.tlsEnabled && service.tlsProvider === "none") {
    context.addIssue({ code: "custom", path: ["tlsProvider"], message: "A TLS provider is required when TLS is enabled" });
  }
  if (service.cloudflareTunnelEnabled && service.exposure !== "public") {
    context.addIssue({ code: "custom", path: ["cloudflareTunnelEnabled"], message: "Cloudflare Tunnel requires public exposure" });
  }
});

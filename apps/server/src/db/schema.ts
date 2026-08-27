import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hostname: text("hostname").notNull(),
  targetProtocol: text("target_protocol", { enum: ["http", "https"] }).notNull(),
  targetHost: text("target_host").notNull(),
  targetPort: integer("target_port").notNull(),
  site: text("site").notNull(),
  exposure: text("exposure", { enum: ["internal", "private", "public"] }).notNull(),
  dnsEnabled: integer("dns_enabled", { mode: "boolean" }).notNull(),
  proxyEnabled: integer("proxy_enabled", { mode: "boolean" }).notNull(),
  tlsEnabled: integer("tls_enabled", { mode: "boolean" }).notNull(),
  tlsProvider: text("tls_provider", { enum: ["none", "letsencrypt-cloudflare"] }).notNull(),
  cloudflareTunnelEnabled: integer("cloudflare_tunnel_enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [uniqueIndex("services_hostname_unique").on(table.hostname)]);

export const componentStatuses = sqliteTable("component_statuses", {
  serviceId: text("service_id").notNull(),
  component: text("component").notNull(),
  desired: text("desired").notNull(),
  actual: text("actual").notNull(),
  state: text("state").notNull(),
  message: text("message"),
  reconciledAt: text("reconciled_at").notNull()
}, (table) => [uniqueIndex("component_status_unique").on(table.serviceId, table.component)]);

export const healthStatuses = sqliteTable("health_statuses", {
  serviceId: text("service_id").primaryKey(),
  healthy: integer("healthy", { mode: "boolean" }),
  message: text("message").notNull(),
  checkedAt: text("checked_at")
});

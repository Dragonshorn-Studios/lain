import { existsSync } from "node:fs";
import { isIPv4 } from "node:net";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { DashboardSummary, ServiceWithStatus, SystemSetup } from "@lain/shared";
import type { Config } from "./config.js";
import { HealthChecker } from "./core/health.js";
import { Reconciler } from "./core/reconciler.js";
import { SystemSetupChecker } from "./core/system-setup.js";
import { DnsServer } from "./network/dns-server.js";
import { ServiceRepository } from "./services/repository.js";
import { serviceInputSchema } from "./services/validation.js";

export async function buildApi(config: Config, repository: ServiceRepository, reconciler: Reconciler, health: HealthChecker, dns: DnsServer, systemSetup = new SystemSetupChecker(config)) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.addContentTypeParser("application/dns-message", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.get("/api/health", async () => ({ status: "ok", name: "laind", adapterMode: config.adapterMode }));
  app.get("/api/system/setup", async (request): Promise<SystemSetup> => {
    const setup = await systemSetup.inspect();
    const connectedAddress = request.socket.localAddress?.replace(/^::ffff:/, "");
    if (!connectedAddress || !isIPv4(connectedAddress) || connectedAddress === "127.0.0.1" || setup.addresses.some(({ address }) => address === connectedAddress)) return setup;
    return { ...setup, addresses: [{ interface: "connected", address: connectedAddress }, ...setup.addresses] };
  });
  app.get("/api/services", async (): Promise<ServiceWithStatus[]> => repository.list().map((service) => ({ ...service, status: repository.status(service.id) })));
  app.get<{ Params: { id: string } }>("/api/services/:id", async (request, reply) => {
    const service = repository.get(request.params.id);
    return service ? { ...service, status: repository.status(service.id) } : reply.code(404).send({ error: "Service not found" });
  });
  app.post("/api/services", async (request, reply) => {
    const parsed = serviceInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid service", details: parsed.error.flatten() });
    try {
      const service = repository.create(parsed.data);
      void reconciler.reconcileService(service); void health.check(service.id);
      return reply.code(201).send({ ...service, status: repository.status(service.id) });
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "Could not create service" }); }
  });
  app.put<{ Params: { id: string } }>("/api/services/:id", async (request, reply) => {
    const parsed = serviceInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid service", details: parsed.error.flatten() });
    try {
      const service = repository.update(request.params.id, parsed.data);
      if (!service) return reply.code(404).send({ error: "Service not found" });
      void reconciler.reconcileService(service); void health.check(service.id);
      return { ...service, status: repository.status(service.id) };
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "Could not update service" }); }
  });
  app.delete<{ Params: { id: string } }>("/api/services/:id", async (request, reply) => repository.delete(request.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "Service not found" }));
  app.post<{ Params: { id: string } }>("/api/services/:id/reconcile", async (request, reply) => {
    const service = repository.get(request.params.id);
    if (!service) return reply.code(404).send({ error: "Service not found" });
    await reconciler.reconcileService(service); await health.check(service.id);
    return { ...service, status: repository.status(service.id) };
  });
  app.post("/api/reconcile", async () => { await reconciler.reconcileAll(); await health.checkAll(); return { status: "reconciled" }; });
  app.get("/api/dashboard", async (): Promise<DashboardSummary> => {
    const statuses = repository.list().map((service) => ({ service, status: repository.status(service.id) }));
    return {
      total: statuses.length,
      healthy: statuses.filter(({ status }) => status.healthy === true).length,
      unhealthy: statuses.filter(({ status }) => status.healthy === false).length,
      pending: statuses.filter(({ status }) => status.healthy === null || status.components.some((component) => component.state === "pending")).length,
      publicServices: statuses.filter(({ service }) => service.exposure === "public").length,
      setup: await systemSetup.inspect()
    };
  });
  app.route({
    method: ["GET", "POST"], url: "/dns-query",
    handler: async (request, reply) => {
      let query: Buffer;
      if (request.method === "GET") {
        const encoded = (request.query as { dns?: string }).dns;
        if (!encoded) return reply.code(400).send({ error: "Missing dns query parameter" });
        query = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      } else if (Buffer.isBuffer(request.body)) query = request.body;
      else return reply.code(400).send({ error: "Expected application/dns-message body" });
      const response = await dns.resolve(query);
      return reply.header("Content-Type", "application/dns-message").send(response);
    }
  });
  const webRoot = resolve(process.cwd(), "../web/dist");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"));
  }
  return app;
}

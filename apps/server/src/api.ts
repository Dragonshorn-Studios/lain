import { existsSync } from "node:fs";
import { isIPv4 } from "node:net";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import session from "@fastify/session";
import type { ApiKeyCreated, ApiKeyInfo, AuthSessionInfo, DashboardSummary, ServiceWithStatus, SystemSetup } from "@lain/shared";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { AuthService } from "./auth/service.js";
import type { Config } from "./config.js";
import { HealthChecker } from "./core/health.js";
import { Reconciler } from "./core/reconciler.js";
import { SystemSetupChecker } from "./core/system-setup.js";
import { DnsServer } from "./network/dns-server.js";
import { ServiceRepository } from "./services/repository.js";
import { serviceInputSchema } from "./services/validation.js";
import { MIN_PASSWORD_LENGTH } from "./auth/service.js";
import "./auth/session-types.js";

const SESSION_COOKIE_NAME = "lain_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOCKOUT_LIMIT = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MAX_TRACKED_CLIENTS = 1000;

type Principal = "session" | "api-key";

export async function buildApi(config: Config, repository: ServiceRepository, reconciler: Reconciler, health: HealthChecker, dns: DnsServer, auth: AuthService, systemSetup = new SystemSetupChecker(config)) {
  const app = Fastify({
    logger: {
      level: process.env.LAIN_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info"),
      redact: { paths: ["req.headers.cookie", "req.headers.authorization"], censor: "[redacted]" }
    }
  });
  await app.register(cors, { origin: config.trustedOrigins.length ? config.trustedOrigins : false });
  await app.register(cookie);
  await app.register(session, {
    secret: auth.serverSecret(),
    cookieName: SESSION_COOKIE_NAME,
    store: auth.sessionStore(),
    saveUninitialized: false,
    rolling: false,
    cookie: { httpOnly: true, sameSite: "strict", secure: config.publicUrl.startsWith("https"), path: "/", maxAge: SESSION_MAX_AGE_MS }
  });
  app.addContentTypeParser("application/dns-message", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  // In-memory per-IP login lockout: 5 failures inside the window lock the address
  // for the window. Restarting laind clears it; every client behind one proxy
  // shares a single bucket, which is the safe direction for a LAN service.
  // /api/auth/setup checks `locked` but never records failures: recording would
  // let an attacker lock the real owner out of first-run setup.
  const failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
  const clientKey = (request: FastifyRequest) => request.socket.remoteAddress ?? "unknown";
  const locked = (request: FastifyRequest) => {
    const record = failures.get(clientKey(request));
    return record !== undefined && record.lockedUntil > Date.now();
  };
  const recordFailure = (request: FastifyRequest) => {
    const key = clientKey(request);
    const now = Date.now();
    const record = failures.get(key);
    if (!record || now - record.firstAt > LOCKOUT_WINDOW_MS) {
      failures.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    } else if ((record.count += 1) >= LOCKOUT_LIMIT) {
      record.lockedUntil = now + LOCKOUT_WINDOW_MS;
      app.log.warn(`login lockout engaged for ${key} until ${new Date(record.lockedUntil).toISOString()}`);
    }
    if (failures.size > LOCKOUT_MAX_TRACKED_CLIENTS) {
      for (const [trackedKey, tracked] of failures) {
        if (tracked.lockedUntil <= now && now - tracked.firstAt > LOCKOUT_WINDOW_MS) failures.delete(trackedKey);
      }
    }
  };
  const clearFailures = (request: FastifyRequest) => failures.delete(clientKey(request));

  const bearerKey = (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    const key = header.slice("Bearer ".length).trim();
    return key.startsWith("lain_") && key.length > 16 ? key : undefined; // a real key is 48 chars; this only weeds out obvious garbage before hashing
  };
  const resolvePrincipal = (request: FastifyRequest): Principal | undefined => {
    const key = bearerKey(request);
    // An Authorization header always decides the outcome: a bad or malformed key
    // never falls back to the session cookie.
    if (key !== undefined || request.headers.authorization !== undefined) return auth.verifyApiKey(key ?? "") ? "api-key" : undefined;
    return auth.isCurrentSession(request.session?.get("passwordVersion")) ? "session" : undefined;
  };
  const originAllowed = (request: FastifyRequest) => {
    const header = request.headers.origin ?? request.headers.referer;
    if (!header) return true;
    let origin: URL;
    try { origin = new URL(String(header)); }
    catch { return false; }
    try {
      if (origin.origin === new URL(`http://${request.headers.host ?? ""}`).origin) return true;
    } catch { /* fall through to configured origins */ }
    return origin.origin === config.publicUrl || config.trustedOrigins.includes(origin.origin);
  };
  const mutates = (method: string) => method !== "GET" && method !== "HEAD";

  app.addHook("preHandler", async (request, reply) => {
    if (config.authMode === "off") return;
    const url = request.routeOptions.url ?? "";
    if (!url.startsWith("/api/")) return;
    if (url === "/api/health" || url === "/api/auth/session") return;
    if (url === "/api/auth/setup" || url === "/api/auth/login") return;
    const principal = resolvePrincipal(request);
    if (!principal) return reply.code(401).send({ error: "Authentication required", setupRequired: !auth.isConfigured() });
    if (principal === "session" && mutates(request.method) && !originAllowed(request)) {
      return reply.code(403).send({ error: "Cross-origin request rejected" });
    }
  });

  app.get("/api/health", async () => ({ status: "ok", name: "laind", adapterMode: config.adapterMode }));
  app.get("/api/auth/session", async (request): Promise<AuthSessionInfo> => ({
    authenticated: config.authMode === "off" || resolvePrincipal(request) !== undefined,
    setupRequired: config.authMode !== "off" && !auth.isConfigured()
  }));
  app.post("/api/auth/setup", async (request, reply) => {
    if (config.authMode === "off") return reply.code(409).send({ error: "Authentication is disabled (LAIN_AUTH=off)" });
    if (auth.isConfigured()) return reply.code(409).send({ error: "An admin password is already configured; sign in instead" });
    if (locked(request)) return reply.code(429).send({ error: "Too many attempts; try again later" });
    const password = String((request.body as { password?: unknown } | null)?.password ?? "");
    if (password.length < MIN_PASSWORD_LENGTH) return reply.code(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    await request.session.regenerate();
    request.session.set("passwordVersion", auth.setPassword(password));
    await request.session.save();
    clearFailures(request);
    return { status: "configured" };
  });
  app.post("/api/auth/login", async (request, reply) => {
    if (config.authMode === "off") return reply.code(409).send({ error: "Authentication is disabled (LAIN_AUTH=off)" });
    if (!auth.isConfigured()) return reply.code(409).send({ error: "No admin password is configured yet; complete first-run setup" });
    if (locked(request)) return reply.code(429).send({ error: "Too many failed attempts; try again later" });
    const password = String((request.body as { password?: unknown } | null)?.password ?? "");
    if (!auth.verifyPassword(password)) {
      recordFailure(request);
      return reply.code(401).send({ error: "Incorrect password" });
    }
    clearFailures(request);
    await request.session.regenerate();
    request.session.set("passwordVersion", auth.version());
    await request.session.save();
    return { status: "authenticated" };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.session?.sessionId) await request.session.destroy();
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/keys", async (): Promise<ApiKeyInfo[]> => auth.listKeys());
  app.post("/api/keys", async (request, reply) => {
    const name = String((request.body as { name?: unknown } | null)?.name ?? "").trim();
    if (!name || name.length > 100) return reply.code(400).send({ error: "Provide a key name of 1-100 characters" });
    const { info, key } = auth.createKey(name);
    return reply.code(201).send({ ...info, key } satisfies ApiKeyCreated);
  });
  app.delete<{ Params: { id: string } }>("/api/keys/:id", async (request, reply) => auth.revokeKey(request.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "Key not found or already revoked" }));

  app.get("/api/system/setup", async (request): Promise<SystemSetup> => {
    const setup = await systemSetup.inspect();
    const connectedAddress = request.socket.localAddress?.replace(/^::ffff:/, "");
    const withConnection = !connectedAddress || !isIPv4(connectedAddress) || connectedAddress === "127.0.0.1" || setup.addresses.some(({ address }) => address === connectedAddress)
      ? setup
      : { ...setup, addresses: [{ interface: "connected", address: connectedAddress }, ...setup.addresses] };
    const passwordConfigured = config.authMode === "off" || auth.isConfigured();
    return {
      ...withConnection,
      checks: [...withConnection.checks, {
        id: "admin-password" as const,
        label: "Admin password",
        state: passwordConfigured ? "ready" : "error",
        required: true,
        detail: passwordConfigured ? "Dashboard authentication is configured" : "No admin password is set — the first person to open the dashboard can claim it",
        ...(passwordConfigured ? {} : { remediation: { command: `open ${config.publicUrl}/login`, description: "Complete first-run setup in the dashboard to set the admin password." } })
      }]
    };
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

import { defaultServiceInput } from "@lain/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApi } from "./api.js";
import { AuthService } from "./auth/service.js";
import { redactSecrets } from "./auth/redact.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { HealthChecker } from "./core/health.js";
import { Reconciler } from "./core/reconciler.js";
import { SystemSetupChecker } from "./core/system-setup.js";
import { DnsServer } from "./network/dns-server.js";
import { ServiceRepository } from "./services/repository.js";

const directories: string[] = [];
afterAll(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const testService = { ...defaultServiceInput, name: "Test", hostname: "test.internal" };
const strongPassword = "correct-horse-battery-staple";
const COOKIE_NAME = "lain_session";

async function buildApp(env: Record<string, string> = {}, directory = mkdtempSync(join(tmpdir(), "lain-auth-"))) {
  directories.push(directory);
  const config = loadConfig({ ...env, LAIN_DATABASE_URL: join(directory, "test.db") });
  const { db, persist } = await createDatabase(config.databaseUrl);
  const repository = new ServiceRepository(db, persist);
  const reconciler = new Reconciler(repository, []);
  const health = new HealthChecker(repository);
  const dns = new DnsServer(repository, config.dnsHost, config.dnsPort, config.dnsUpstream, config.dnsRecordAddress);
  const auth = new AuthService(db, persist);
  const app = await buildApi(config, repository, reconciler, health, dns, auth, new SystemSetupChecker(config, async () => ({ stdout: "", exitCode: 0 })));
  return { app, auth };
}

function sessionCookie(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((entry) => entry.name === COOKIE_NAME);
  if (!cookie) throw new Error("no session cookie was set");
  return `${COOKIE_NAME}=${cookie.value}`;
}

async function configureAdmin(app: Awaited<ReturnType<typeof buildApp>>["app"]): Promise<string> {
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } });
  expect(setup.statusCode).toBe(200);
  return sessionCookie(setup);
}

describe("api authentication", () => {
  it("keeps health, auth status, and the DNS data plane open while everything else requires authentication", async () => {
    const { app } = await buildApp();
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const session = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(session.json()).toEqual({ authenticated: false, setupRequired: true });

    const attempts: Array<{ method: "GET" | "POST" | "PUT" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
      { method: "GET", url: "/api/services" },
      { method: "GET", url: "/api/system/setup" },
      { method: "GET", url: "/api/keys" },
      { method: "POST", url: "/api/services", payload: testService },
      { method: "PUT", url: "/api/services/none", payload: testService },
      { method: "DELETE", url: "/api/services/none" },
      { method: "POST", url: "/api/reconcile" },
      { method: "POST", url: "/api/services/none/reconcile" },
      { method: "POST", url: "/api/keys", payload: { name: "ci" } }
    ];
    for (const attempt of attempts) {
      const headers: Record<string, string> = {};
      if (attempt.payload) headers["content-type"] = "application/json";
      const response = await app.inject({ ...attempt, headers });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
      expect(response.json().setupRequired).toBe(true);
    }
    expect((await app.inject({ method: "GET", url: "/dns-query" })).statusCode).toBe(400);
  });

  it("walks first-run setup, issues sessions, and rejects repeat setup or wrong passwords", async () => {
    const { app } = await buildApp();
    const tooShort = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: "short" } });
    expect(tooShort.statusCode).toBe(400);

    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } });
    expect(setup.statusCode).toBe(200);
    const cookie = sessionCookie(setup);
    const setCookieHeader = Array.isArray(setup.headers["set-cookie"]) ? setup.headers["set-cookie"].join("; ") : String(setup.headers["set-cookie"]);
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Strict");

    expect((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: "another password" } })).statusCode).toBe(409);

    const authed = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(authed.json()).toEqual({ authenticated: true, setupRequired: false });

    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope-not-it" } });
    expect(wrong.statusCode).toBe(401);

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: strongPassword } });
    expect(login.statusCode).toBe(200);
    expect(login.cookies.some((entry) => entry.name === COOKIE_NAME)).toBe(true);
  });

  it("exposes the admin-password setup check through the protected system setup surface", async () => {
    const { app } = await buildApp();
    const cookie = await configureAdmin(app);
    const setup = await app.inject({ method: "GET", url: "/api/system/setup", headers: { cookie } });
    expect(setup.statusCode).toBe(200);
    const check = setup.json().checks.find((entry: { id: string }) => entry.id === "admin-password");
    expect(check.state).toBe("ready");
  });

  it("enforces same-origin for state changes made with a session cookie", async () => {
    const { app } = await buildApp();
    const cookie = await configureAdmin(app);

    const allowed = await app.inject({ method: "POST", url: "/api/services", headers: { cookie, "content-type": "application/json", origin: "http://localhost:3100" }, payload: testService });
    expect(allowed.statusCode).toBe(201);
    const serviceId = allowed.json().id as string;

    const spoofed = await app.inject({ method: "DELETE", url: `/api/services/${serviceId}`, headers: { cookie, origin: "https://evil.example" } });
    expect(spoofed.statusCode).toBe(403);

    const read = await app.inject({ method: "GET", url: "/api/services", headers: { cookie, origin: "https://evil.example" } });
    expect(read.statusCode).toBe(200);
  });

  it("accepts same-host origins and referers even when publicUrl differs, and rejects malformed ones", async () => {
    const { app } = await buildApp({ LAIN_PUBLIC_URL: "http://dashboard.example" });
    const cookie = await configureAdmin(app);

    // The publicUrl branch cannot match, so this exercises the Host-header branch:
    // a browser on the LAN sends Origin equal to the host it is talking to.
    const viaHost = await app.inject({ method: "POST", url: "/api/services", headers: { host: "lain.lan:3100", cookie, "content-type": "application/json", origin: "http://lain.lan:3100" }, payload: testService });
    expect(viaHost.statusCode).toBe(201);

    const viaReferer = await app.inject({ method: "POST", url: "/api/services", headers: { host: "lain.lan:3100", cookie, "content-type": "application/json", referer: "http://lain.lan:3100/services" }, payload: { ...testService, hostname: "referer.internal" } });
    expect(viaReferer.statusCode).toBe(201);

    const malformed = await app.inject({ method: "POST", url: "/api/services", headers: { cookie, "content-type": "application/json", origin: "not a url" }, payload: testService });
    expect(malformed.statusCode).toBe(403);
  });

  it("keeps dashboard sessions valid across a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lain-auth-"));
    const env = { LAIN_DATABASE_URL: join(directory, "test.db") };
    const first = await buildApp(env, directory);
    const setup = await first.app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } });
    expect(setup.statusCode).toBe(200);
    const cookie = sessionCookie(setup);
    expect((await first.app.inject({ method: "GET", url: "/api/services", headers: { cookie } })).statusCode).toBe(200);

    const second = await buildApp(env, directory);
    expect((await second.app.inject({ method: "GET", url: "/api/services", headers: { cookie } })).statusCode).toBe(200);
  });

  it("authenticates API keys, never exposes their material, and supports revocation", async () => {
    const { app, auth } = await buildApp();
    const cookie = await configureAdmin(app);

    const created = await app.inject({ method: "POST", url: "/api/keys", headers: { cookie, "content-type": "application/json" }, payload: { name: "ci" } });
    expect(created.statusCode).toBe(201);
    const { id, key, prefix } = created.json() as { id: string; key: string; prefix: string };
    expect(key.startsWith("lain_")).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);

    const list = await app.inject({ method: "GET", url: "/api/keys", headers: { cookie } });
    const listText = list.body;
    expect(listText).not.toContain(key);
    expect(listText).not.toContain("keyHash");
    expect(listText).toContain(prefix);

    const withKey = await app.inject({ method: "POST", url: "/api/services", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, origin: "https://evil.example" }, payload: testService });
    expect(withKey.statusCode).toBe(201);

    expect((await app.inject({ method: "POST", url: "/api/services", headers: { "content-type": "application/json", authorization: "Bearer lain_too-short" }, payload: testService })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/services", headers: { "content-type": "application/json", authorization: "Basic dXNlcjpwYXNz" }, payload: testService })).statusCode).toBe(401);

    expect(auth.verifyApiKey(`${key}-tampered`)).toBe(false);
    expect((await app.inject({ method: "DELETE", url: `/api/keys/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/api/services", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, payload: testService })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `/api/keys/${id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it("invalidates sessions on logout and on password changes", async () => {
    const { app, auth } = await buildApp();
    const cookie = await configureAdmin(app);

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/services", headers: { cookie } })).statusCode).toBe(401);

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: strongPassword } });
    const liveCookie = sessionCookie(login);
    auth.setPassword("a brand new passphrase");
    expect((await app.inject({ method: "GET", url: "/api/services", headers: { cookie: liveCookie } })).statusCode).toBe(401);
  });

  it("clears the failure counter after a successful login", async () => {
    const { app } = await buildApp();
    await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong-password" } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: strongPassword } })).statusCode).toBe(200);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong-password" } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: strongPassword } })).statusCode).toBe(200);
  });

  it("locks the login endpoint after repeated failures", async () => {
    const { app } = await buildApp();
    await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong-password" } })).statusCode).toBe(401);
    }
    const locked = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: strongPassword } });
    expect(locked.statusCode).toBe(429);
  });

  it("runs wide open only when authentication is explicitly disabled in mock mode", async () => {
    const { app } = await buildApp({ LAIN_AUTH: "off" });
    const reconcile = await app.inject({ method: "POST", url: "/api/reconcile" });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toEqual({ status: "reconciled" });
    expect((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { password: strongPassword } })).statusCode).toBe(409);
    const session = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(session.json()).toEqual({ authenticated: true, setupRequired: false });
  });

  it("reflects CORS origins only when they are explicitly trusted", async () => {
    const { app } = await buildApp();
    const untrusted = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();

    const { app: trusting } = await buildApp({ LAIN_TRUSTED_ORIGINS: "https://trusted.example" });
    const trusted = await trusting.inject({ method: "GET", url: "/api/health", headers: { origin: "https://trusted.example" } });
    expect(trusted.headers["access-control-allow-origin"]).toBe("https://trusted.example");
    const other = await trusting.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("secret redaction wiring", () => {
  it("scrubs adapter error messages before they are persisted and served", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lain-auth-"));
    directories.push(directory);
    const config = loadConfig({ LAIN_DATABASE_URL: join(directory, "test.db") });
    const { db, persist } = await createDatabase(config.databaseUrl);
    const repository = new ServiceRepository(db, persist);
    const secret = "super-secret-token-value";
    const failingAdapter = {
      component: "cloudflare-dns" as const,
      reconcile: async () => { throw new Error(`Cloudflare request failed with Bearer ${secret}`); }
    };
    const reconciler = new Reconciler(repository, [failingAdapter], (message) => redactSecrets(message, [secret]));
    const service = repository.create(testService);
    await reconciler.reconcileService(service);

    const status = repository.status(service.id);
    const message = status.components.find((component) => component.component === "cloudflare-dns")?.message ?? "";
    expect(message).not.toContain(secret);
    expect(message).toContain("[redacted]");
    expect(message).toContain("Bearer [redacted]");
  });
});

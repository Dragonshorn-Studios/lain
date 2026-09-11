#!/usr/bin/env node
import type { ServiceWithStatus } from "@lain/shared";
import { interactiveLogin, keychainAccount, keychainStore, type SecretStore } from "./auth.js";
import { setupHelp, setupUbuntu } from "./setup.js";

const baseUrl = process.env.LAIN_URL ?? "http://localhost:3100";
const [command = "help", subject, ...rest] = process.argv.slice(2);

let apiKey = process.env.LAIN_API_KEY;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...init?.headers as Record<string, string> };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

/** Resolves an API key from the environment, the OS keychain, or an interactive sign-in. */
async function ensureApiKey(options: { interactive: boolean }): Promise<void> {
  if (apiKey) return;
  const store = await keychainStore(keychainAccount(baseUrl));
  const stored = store?.get();
  if (stored) { apiKey = stored; return; }
  if (!options.interactive) return;
  if (!process.stdin.isTTY) {
    throw new Error("no API key available. Set LAIN_API_KEY, run `lainctl auth login` from a terminal, or store a key with `lainctl keys create`.");
  }
  const key = await interactiveLogin(baseUrl);
  if (store) {
    store.set(key);
    console.log("API key stored in the OS keychain.");
  } else {
    console.log(`No OS keychain is available on this host. Use this key now and keep it for LAIN_API_KEY (it is not stored anywhere):\n${key}`);
  }
  apiKey = key;
}

async function authStatus(): Promise<void> {
  const store = await keychainStore(keychainAccount(baseUrl));
  const source = process.env.LAIN_API_KEY ? "environment" : store?.get() ? "OS keychain" : "none";
  console.log(`API key source: ${source}`);
  const session = await request<{ authenticated: boolean; setupRequired: boolean }>("/api/auth/session").catch(() => undefined);
  if (!session) { console.log(`laind is not reachable at ${baseUrl}`); process.exitCode = 1; return; }
  if (session.setupRequired) console.log("First-run setup pending: open the dashboard at /login to set the admin password.");
  else console.log(`Dashboard password: ${session.setupRequired ? "not configured" : "configured"}`);
  if (apiKey) {
    const keys = await request<Array<{ id: string; name: string; prefix: string; revokedAt: string | null }>>("/api/keys").catch(() => []);
    const match = keys.find((entry) => apiKey!.startsWith(entry.prefix));
    console.log(match ? `This host's key: ${match.name} (${match.prefix}…${match.revokedAt ? ", revoked" : ""})` : "This host's key is not registered with laind anymore.");
  }
}

async function authLogout(): Promise<void> {
  const store = await keychainStore(keychainAccount(baseUrl));
  const stored = store?.get();
  if (!stored && !process.env.LAIN_API_KEY) { console.log("No stored API key for this host."); return; }
  const previous = apiKey;
  apiKey = stored ?? process.env.LAIN_API_KEY;
  let revoked = false;
  if (apiKey) {
    try {
      const keys = await request<Array<{ id: string; prefix: string }>>("/api/keys");
      const match = keys.find((entry) => apiKey!.startsWith(entry.prefix));
      if (match) { await request(`/api/keys/${match.id}`, { method: "DELETE" }); revoked = true; }
    } catch { /* the key may already be revoked; still remove the local copy */ }
  }
  store?.remove();
  apiKey = previous;
  console.log(revoked ? "API key revoked and removed from this host." : "Local API key removed (it was already unknown to laind).");
}

try {
  if (command === "status") {
    const health = await request<{ status: string; adapterMode: string }>("/api/health");
    await ensureApiKey({ interactive: false });
    const services = apiKey ? await request<ServiceWithStatus[]>("/api/services") : undefined;
    console.log(`laind: ${health.status} (${health.adapterMode} adapters)`);
    if (services) console.log(`services: ${services.length}, healthy: ${services.filter((service) => service.status.healthy).length}`);
    else console.log("services: set LAIN_API_KEY or run `lainctl auth login` to inspect services");
  } else if (command === "services" || (command === "service" && subject === "list")) {
    await ensureApiKey({ interactive: true });
    const services = await request<ServiceWithStatus[]>("/api/services");
    if (!services.length) console.log("No services registered.");
    for (const service of services) console.log(`${service.id}\t${service.hostname}\t${service.targetHost}:${service.targetPort}\t${service.status.healthy === null ? "pending" : service.status.healthy ? "healthy" : "unhealthy"}`);
  } else if (command === "reconcile") {
    await ensureApiKey({ interactive: true });
    const id = subject;
    await request(id ? `/api/services/${id}/reconcile` : "/api/reconcile", { method: "POST" });
    console.log(id ? `Reconciled ${id}.` : "Reconciled all services.");
  } else if (command === "keys") {
    await ensureApiKey({ interactive: true });
    if (subject === "create") {
      const name = rest.join(" ").trim() || `lainctl-${new Date().toISOString().slice(0, 10)}`;
      const created = await request<{ id: string; key: string; prefix: string }>("/api/keys", { method: "POST", body: JSON.stringify({ name }) });
      console.log(`API key "${name}" created (${created.prefix}…). Copy it now — it is shown only once:\n${created.key}`);
    } else if (subject === "list") {
      const keys = await request<Array<{ id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null }>>("/api/keys");
      if (!keys.length) console.log("No API keys.");
      for (const key of keys) console.log(`${key.id}\t${key.name}\t${key.prefix}…\t${key.revokedAt ? "revoked" : key.lastUsedAt ? `last used ${key.lastUsedAt}` : "never used"}`);
    } else if (subject === "revoke") {
      if (!rest[0]) throw new Error("usage: lainctl keys revoke <key-id>");
      await request(`/api/keys/${rest[0]}`, { method: "DELETE" });
      console.log(`Revoked ${rest[0]}.`);
    } else throw new Error("usage: lainctl keys create <name> | list | revoke <key-id>");
  } else if (command === "auth") {
    if (subject === "status") await authStatus();
    else if (subject === "login") {
      const store: SecretStore | undefined = await keychainStore(keychainAccount(baseUrl));
      const key = await interactiveLogin(baseUrl);
      if (store) { store.set(key); console.log("Signed in. API key stored in the OS keychain."); }
      else console.log(`Signed in. No OS keychain is available here; store this key in LAIN_API_KEY (shown only once):\n${key}`);
    } else if (subject === "logout") await authLogout();
    else throw new Error("usage: lainctl auth status | login | logout");
  } else if (command === "setup") {
    if (subject !== "ubuntu") console.log(setupHelp);
    else await setupUbuntu(process.argv.slice(4));
  } else {
    console.log(`lainctl — control the Lain service registry

Usage:
  lainctl status
  lainctl services
  lainctl reconcile [service-id]
  lainctl keys create <name> | list | revoke <key-id>
  lainctl auth status | login | logout
  lainctl setup ubuntu [options]

Authentication:
  Commands that change anything need an API key. lainctl uses LAIN_API_KEY, or
  the OS keychain entry created by \`lainctl auth login\`. On a desktop,
  \`lainctl auth login\` prompts for the dashboard password once and stores a
  dedicated key in the keychain. On headless servers, create a key and export
  LAIN_API_KEY for scripts and CI.

Environment:
  LAIN_URL      API URL (default: http://localhost:3100)
  LAIN_API_KEY  API key (lain_...) used instead of the keychain`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }

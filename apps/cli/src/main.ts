#!/usr/bin/env node
import type { ServiceWithStatus } from "@lain/shared";
import { interactiveLogin, keychainAccount, keychainStore, type SecretStore } from "./auth.js";
import { setupHelp, setupUbuntu } from "./setup.js";
import { cliVersion, installedVersion, update } from "./update.js";

const baseUrl = process.env.LAIN_URL ?? "http://localhost:3100";
const [command = "help", subject, ...rest] = process.argv.slice(2);

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

let apiKey = process.env.LAIN_API_KEY;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...init?.headers as Record<string, string> };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, { ...init, headers }); }
  catch (error) { throw new Error(`could not reach laind at ${baseUrl}${path}: ${error instanceof Error ? error.message : error}`); }
  if (!response.ok) throw new ApiError(`${response.status} ${await response.text()}`, response.status);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

/**
 * Resolves an API key from the environment, the OS keychain, or an interactive
 * sign-in. The store is injectable so callers (and tests) can substitute it.
 */
async function ensureApiKey(options: { interactive: boolean; store?: SecretStore }): Promise<void> {
  if (apiKey) return;
  const store = options.store ?? await keychainStore(keychainAccount(baseUrl));
  const stored = store?.get();
  if (stored) { apiKey = stored; return; }
  if (!options.interactive) return;
  if (!process.stdin.isTTY) {
    throw new Error("no API key available. Set LAIN_API_KEY, run `lainctl auth login` from a terminal, or create one with `lainctl keys create`.");
  }
  const key = await interactiveLogin(baseUrl);
  // Show the key before attempting to persist it: it is displayed exactly once,
  // so a keychain failure must never swallow it.
  console.log(`Signed in. API key created for this host (${key.slice(0, 12)}…).`);
  console.log(`Copy it now — it is shown only once and laind stores only its hash:\n${key}`);
  apiKey = key;
  if (store) {
    try {
      store.set(key);
      console.log("API key stored in the OS keychain.");
    } catch (error) {
      console.error(`Could not store the key in the OS keychain (${error instanceof Error ? error.message : error}); export it as LAIN_API_KEY instead.`);
    }
  }
}

async function authStatus(): Promise<void> {
  const store = await keychainStore(keychainAccount(baseUrl));
  const source = process.env.LAIN_API_KEY ? "environment" : store?.get() ? "OS keychain" : "none";
  console.log(`API key source: ${source}`);
  let session: { authenticated: boolean; setupRequired: boolean };
  try { session = await request<{ authenticated: boolean; setupRequired: boolean }>("/api/auth/session"); }
  catch (error) { console.error(`Could not query laind: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; return; }
  if (session.setupRequired) console.log("First-run setup pending: open the dashboard at /login to set the admin password.");
  else console.log("Dashboard password: configured");
  if (!apiKey) return;
  try {
    const keys = await request<Array<{ id: string; name: string; prefix: string; revokedAt: string | null }>>("/api/keys");
    const match = keys.find((entry) => apiKey!.startsWith(entry.prefix));
    console.log(match ? `This host's key: ${match.name} (${match.prefix}…${match.revokedAt ? ", revoked" : ""})` : "This host's key is not registered with laind anymore.");
  } catch (error) {
    console.error(`Could not list API keys: ${error instanceof Error ? error.message : error}`);
  }
}

async function authLogout(): Promise<void> {
  const store = await keychainStore(keychainAccount(baseUrl));
  const stored = store?.get();
  if (!stored && !process.env.LAIN_API_KEY) { console.log("No stored API key for this host."); return; }
  apiKey = stored ?? process.env.LAIN_API_KEY;
  let revoked = false;
  let confirmedGone = false;
  try {
    const keys = await request<Array<{ id: string; prefix: string }>>("/api/keys");
    const match = keys.find((entry) => apiKey!.startsWith(entry.prefix));
    if (match) {
      await request(`/api/keys/${match.id}`, { method: "DELETE" });
      revoked = true;
    } else {
      confirmedGone = true;
    }
  } catch (error) {
    console.error(`Could not confirm revocation with laind (${error instanceof Error ? error.message : error}).`);
    console.error(`The key may still be live — revoke it from the dashboard's API keys page (prefix ${apiKey!.slice(0, 12)}…). The local copy was kept.`);
  }
  if (revoked || confirmedGone) {
    try {
      store?.remove();
      console.log(revoked ? "API key revoked and removed from this host." : "Local API key removed (laind no longer knows it).");
    } catch (error) {
      console.error(`The key was revoked, but the keychain entry could not be removed (${error instanceof Error ? error.message : error}); delete it manually.`);
    }
  } else {
    process.exitCode = 1;
  }
}

try {
  if (command === "--version" || command === "version") {
    console.log(cliVersion());
  } else if (command === "status") {
    const health = await request<{ status: string; adapterMode: string }>("/api/health");
    await ensureApiKey({ interactive: false });
    let services: ServiceWithStatus[] | undefined;
    if (apiKey) {
      try { services = await request<ServiceWithStatus[]>("/api/services"); }
      catch (error) { console.error(`Could not list services: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
    }
    console.log(`laind: ${health.status} (${health.adapterMode} adapters)`);
    const installed = installedVersion();
    if (installed) console.log(`installed release: ${installed} (${cliVersion()} running)`);
    if (services) console.log(`services: ${services.length}, healthy: ${services.filter((service) => service.status.healthy).length}`);
    else if (process.exitCode !== 1) console.log("services: set LAIN_API_KEY or run `lainctl auth login` to inspect services");
  } else if (command === "update") {
    await update([subject, ...rest].filter((entry): entry is string => Boolean(entry)));
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
      const store = await keychainStore(keychainAccount(baseUrl));
      const key = await interactiveLogin(baseUrl);
      console.log(`Signed in. API key created for this host (${key.slice(0, 12)}…).`);
      console.log(`Copy it now — it is shown only once and laind stores only its hash:\n${key}`);
      if (store) {
        try {
          store.set(key);
          console.log("API key stored in the OS keychain.");
        } catch (error) {
          console.error(`Could not store the key in the OS keychain (${error instanceof Error ? error.message : error}); export it as LAIN_API_KEY instead.`);
        }
      } else {
        console.log("No OS keychain is available here; export the key above as LAIN_API_KEY.");
      }
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
  lainctl update [--version vX.Y.Z] [--yes]
  lainctl keys create <name> | list | revoke <key-id>
  lainctl auth status | login | logout
  lainctl setup ubuntu [options]
  lainctl --version

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

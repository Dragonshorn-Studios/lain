import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "./schema.js";

export async function createDatabase(databaseUrl: string) {
  const filename = resolve(databaseUrl);
  mkdirSync(dirname(filename), { recursive: true });
  const SQL = await initSqlJs();
  const sqlite = existsSync(filename) ? new SQL.Database(readFileSync(filename)) : new SQL.Database();
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL UNIQUE,
      target_protocol TEXT NOT NULL, target_host TEXT NOT NULL, target_port INTEGER NOT NULL,
      site TEXT NOT NULL, exposure TEXT NOT NULL, dns_enabled INTEGER NOT NULL,
      proxy_enabled INTEGER NOT NULL, tls_enabled INTEGER NOT NULL, tls_provider TEXT NOT NULL,
      cloudflare_tunnel_enabled INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS component_statuses (
      service_id TEXT NOT NULL, component TEXT NOT NULL, desired TEXT NOT NULL,
      actual TEXT NOT NULL, state TEXT NOT NULL, message TEXT, reconciled_at TEXT NOT NULL,
      UNIQUE(service_id, component)
    );
    CREATE TABLE IF NOT EXISTS health_statuses (
      service_id TEXT PRIMARY KEY, healthy INTEGER, message TEXT NOT NULL, checked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_credentials (
      id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY, data TEXT NOT NULL, touched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  const persist = () => writeFileSync(filename, Buffer.from(sqlite.export()));
  persist();
  return { db: drizzle(sqlite, { schema }), sqlite, persist };
}

export type LainDatabase = Awaited<ReturnType<typeof createDatabase>>["db"];

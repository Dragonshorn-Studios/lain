import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiKeyInfo } from "@lain/shared";
import type { LainDatabase } from "../db/client.js";
import { apiKeys, authCredentials, serverSettings } from "../db/schema.js";
import { generateApiKey, hashApiKey } from "./api-keys.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createSessionStore } from "./session-store.js";
import type { SessionStore } from "@fastify/session";

const lastUsedThrottleMs = 60_000;

export const MIN_PASSWORD_LENGTH = 10;

/** Owns the admin password hash, API keys, and the session-cookie secret. */
export class AuthService {
  constructor(private readonly db: LainDatabase, private readonly persist: () => void) {}

  isConfigured(): boolean {
    return this.currentPassword() !== undefined;
  }

  /**
   * Bumped on every password change so stored sessions can detect staleness.
   * Starts at 1 for the first password; 0 therefore means "no password yet" and
   * must never authenticate — see isCurrentSession.
   */
  version(): number {
    return this.currentPassword()?.version ?? 0;
  }

  isCurrentSession(passwordVersion: number | undefined): boolean {
    return passwordVersion !== undefined && passwordVersion === this.version() && passwordVersion > 0;
  }

  setPassword(password: string): number {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const existing = this.currentPassword();
    const version = (existing?.version ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    if (existing) {
      this.db.update(authCredentials).set({ passwordHash: hashPassword(password), version, updatedAt }).where(eq(authCredentials.id, 1)).run();
    } else {
      this.db.insert(authCredentials).values({ id: 1, passwordHash: hashPassword(password), version, updatedAt }).run();
    }
    this.persist();
    return version;
  }

  verifyPassword(password: string): boolean {
    const existing = this.currentPassword();
    return existing ? verifyPassword(password, existing.passwordHash) : false;
  }

  /** Stable secret used to sign session cookies; generated once and persisted with the database. */
  serverSecret(): string {
    const rows = this.db.select().from(serverSettings).where(eq(serverSettings.key, "session-secret")).limit(1).all();
    if (rows[0]) return rows[0].value;
    this.db.insert(serverSettings).values({ key: "session-secret", value: Buffer.from(randomUUID() + randomUUID()).toString("base64url") }).run();
    this.persist();
    return this.db.select().from(serverSettings).where(eq(serverSettings.key, "session-secret")).limit(1).all()[0]!.value;
  }

  sessionStore(): SessionStore {
    return createSessionStore(this.db, this.persist);
  }

  createKey(name: string): { info: ApiKeyInfo; key: string } {
    const generated = generateApiKey();
    const createdAt = new Date().toISOString();
    const record = { id: randomUUID(), name, prefix: generated.prefix, keyHash: generated.hash, createdAt, lastUsedAt: null as string | null, revokedAt: null as string | null };
    this.db.insert(apiKeys).values(record).run();
    this.persist();
    return { info: { id: record.id, name, prefix: generated.prefix, createdAt, lastUsedAt: null, revokedAt: null }, key: generated.key };
  }

  listKeys(): ApiKeyInfo[] {
    return this.db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt }).from(apiKeys).all();
  }

  revokeKey(id: string): boolean {
    const rows = this.db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))).limit(1).all();
    if (!rows.length) return false;
    this.db.update(apiKeys).set({ revokedAt: new Date().toISOString() }).where(eq(apiKeys.id, id)).run();
    this.persist();
    return true;
  }

  verifyApiKey(key: string): boolean {
    if (!key.startsWith("lain_")) return false;
    const rows = this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(key))).limit(1).all();
    const record = rows[0];
    if (!record || record.revokedAt) return false;
    const now = Date.now();
    if (!record.lastUsedAt || now - Date.parse(record.lastUsedAt) > lastUsedThrottleMs) {
      this.db.update(apiKeys).set({ lastUsedAt: new Date(now).toISOString() }).where(eq(apiKeys.id, record.id)).run();
      this.persist();
    }
    return true;
  }

  private currentPassword() {
    return this.db.select().from(authCredentials).where(eq(authCredentials.id, 1)).limit(1).all()[0];
  }
}

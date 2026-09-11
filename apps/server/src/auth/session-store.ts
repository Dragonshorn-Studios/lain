import { eq, lt } from "drizzle-orm";
import type { SessionStore } from "@fastify/session";
import type { FastifySessionObject } from "@fastify/session";
import type { LainDatabase } from "../db/client.js";
import { authSessions } from "../db/schema.js";

const sweepAgeMs = 30 * 24 * 60 * 60 * 1000;

/** Persists fastify-session state in SQLite so dashboard sessions survive restarts. */
export function createSessionStore(db: LainDatabase, persist: () => void): SessionStore {
  const sweep = (now: number) => {
    db.delete(authSessions).where(lt(authSessions.touchedAt, new Date(now - sweepAgeMs).toISOString())).run();
  };
  return {
    set(sessionId: string, session: FastifySessionObject, callback: (error?: Error) => void): void {
      try {
        const touchedAt = new Date().toISOString();
        db.insert(authSessions).values({ sessionId, data: JSON.stringify(session), touchedAt })
          .onConflictDoUpdate({ target: authSessions.sessionId, set: { data: JSON.stringify(session), touchedAt } })
          .run();
        sweep(Date.now());
        persist();
        callback();
      } catch (error) { callback(error instanceof Error ? error : new Error("Failed to persist session")); }
    },
    get(sessionId: string, callback: (error: Error | null, session?: FastifySessionObject) => void): void {
      try {
        const row = db.select().from(authSessions).where(eq(authSessions.sessionId, sessionId)).limit(1).all()[0];
        callback(null, row ? (JSON.parse(row.data) as FastifySessionObject) : undefined);
      } catch (error) { callback(error instanceof Error ? error : new Error("Failed to load session")); }
    },
    destroy(sessionId: string, callback: (error?: Error) => void): void {
      try {
        db.delete(authSessions).where(eq(authSessions.sessionId, sessionId)).run();
        persist();
        callback();
      } catch (error) { callback(error instanceof Error ? error : new Error("Failed to destroy session")); }
    }
  };
}

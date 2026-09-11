import { eq, lt } from "drizzle-orm";
import type { SessionStore } from "@fastify/session";
import type { FastifySessionObject } from "@fastify/session";
import type { LainDatabase } from "../db/client.js";
import { authSessions } from "../db/schema.js";

const sweepAgeMs = 30 * 24 * 60 * 60 * 1000;

/**
 * Persists fastify-session state in SQLite so dashboard sessions survive restarts.
 * Rows older than 30 days (touchedAt) are swept on write; the 7-day session
 * expiry itself is enforced by fastify-session when it rehydrates a session,
 * not here.
 */
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
      } catch (error) { callback(wrap(error, `Failed to persist session ${sessionId}`)); }
    },
    get(sessionId: string, callback: (error: Error | null, session?: FastifySessionObject) => void): void {
      try {
        const row = db.select().from(authSessions).where(eq(authSessions.sessionId, sessionId)).limit(1).all()[0];
        if (!row) return callback(null, undefined);
        try {
          // fastify-session rehydrates the plain JSON into a live Session object
          // on its side, so this cast is the documented store contract.
          callback(null, JSON.parse(row.data) as FastifySessionObject);
        } catch {
          // A corrupted row must not wedge that cookie into endless 500s: drop it
          // and let the request proceed as signed out.
          db.delete(authSessions).where(eq(authSessions.sessionId, sessionId)).run();
          persist();
          callback(null, undefined);
        }
      } catch (error) { callback(wrap(error, `Failed to load session ${sessionId}`)); }
    },
    destroy(sessionId: string, callback: (error?: Error) => void): void {
      try {
        db.delete(authSessions).where(eq(authSessions.sessionId, sessionId)).run();
        persist();
        callback();
      } catch (error) { callback(wrap(error, `Failed to destroy session ${sessionId}`)); }
    }
  };
}

function wrap(error: unknown, message: string): Error {
  return error instanceof Error ? new Error(`${message}: ${error.message}`) : new Error(message);
}

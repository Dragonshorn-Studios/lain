// Augments the fastify Session type with the single piece of state Lain keeps
// per session. Paired invariant: AuthService.setPassword returns versions
// starting at 1, so a stored passwordVersion of 0 (or absent) must never
// authenticate — see AuthService.isCurrentSession.
import "@fastify/session";

declare module "fastify" {
  interface Session {
    passwordVersion?: number;
  }
}

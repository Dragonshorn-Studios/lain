import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ComponentName, ComponentStatus, Service, ServiceInput, ServiceStatus } from "@lain/shared";
import type { LainDatabase } from "../db/client.js";
import { componentStatuses, healthStatuses, services } from "../db/schema.js";

export class ServiceRepository {
  constructor(private readonly db: LainDatabase, private readonly persist: () => void = () => {}) {}

  list(): Service[] { return this.db.select().from(services).all() as Service[]; }
  get(id: string): Service | undefined { return this.db.select().from(services).where(eq(services.id, id)).get() as Service | undefined; }
  getByHostname(hostname: string): Service | undefined {
    return this.db.select().from(services).where(eq(services.hostname, hostname.toLowerCase())).get() as Service | undefined;
  }
  create(input: ServiceInput): Service {
    const now = new Date().toISOString();
    const service: Service = { id: randomUUID(), ...input, hostname: input.hostname.toLowerCase(), createdAt: now, updatedAt: now };
    this.db.insert(services).values(service).run();
    this.persist();
    return service;
  }
  update(id: string, input: ServiceInput): Service | undefined {
    if (!this.get(id)) return undefined;
    const updatedAt = new Date().toISOString();
    this.db.update(services).set({ ...input, hostname: input.hostname.toLowerCase(), updatedAt }).where(eq(services.id, id)).run();
    this.persist();
    return this.get(id);
  }
  delete(id: string): boolean {
    const existed = Boolean(this.get(id));
    this.db.delete(componentStatuses).where(eq(componentStatuses.serviceId, id)).run();
    this.db.delete(healthStatuses).where(eq(healthStatuses.serviceId, id)).run();
    this.db.delete(services).where(eq(services.id, id)).run();
    this.persist();
    return existed;
  }
  setComponentStatus(serviceId: string, status: Omit<ComponentStatus, "reconciledAt">): void {
    const row = { serviceId, ...status, reconciledAt: new Date().toISOString() };
    this.db.insert(componentStatuses).values(row).onConflictDoUpdate({
      target: [componentStatuses.serviceId, componentStatuses.component], set: row
    }).run();
    this.persist();
  }
  getComponentStatus(serviceId: string, component: ComponentName): ComponentStatus | undefined {
    return this.db.select().from(componentStatuses).where(and(eq(componentStatuses.serviceId, serviceId), eq(componentStatuses.component, component))).get() as ComponentStatus | undefined;
  }
  setHealth(serviceId: string, healthy: boolean, message: string): void {
    const row = { serviceId, healthy, message, checkedAt: new Date().toISOString() };
    this.db.insert(healthStatuses).values(row).onConflictDoUpdate({ target: healthStatuses.serviceId, set: row }).run();
    this.persist();
  }
  status(serviceId: string): ServiceStatus {
    const health = this.db.select().from(healthStatuses).where(eq(healthStatuses.serviceId, serviceId)).get();
    const components = this.db.select().from(componentStatuses).where(eq(componentStatuses.serviceId, serviceId)).all() as ComponentStatus[];
    return {
      serviceId,
      healthy: health?.healthy ?? null,
      healthMessage: health?.message ?? "Not checked yet",
      checkedAt: health?.checkedAt ?? null,
      components
    };
  }
}

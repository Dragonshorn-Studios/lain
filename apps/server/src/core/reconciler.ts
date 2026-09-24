import type { ComponentStatus, Service } from "@lain/shared";
import type { DerivedStateAdapter } from "../adapters/types.js";
import { ServiceRepository } from "../services/repository.js";

export class Reconciler {
  private running = false;
  constructor(private readonly repository: ServiceRepository, private readonly adapters: DerivedStateAdapter[], private readonly redact: (message: string) => string = (message) => message) {}
  async reconcileService(service: Service): Promise<ComponentStatus[]> {
    const statuses: ComponentStatus[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.reconcile(service);
        this.repository.setComponentStatus(service.id, result);
        statuses.push({ ...result, reconciledAt: new Date().toISOString() });
      } catch (error) {
        const result = { component: adapter.component, desired: "configured", actual: "error", state: "error" as const, message: this.redact(error instanceof Error ? error.message : "Unknown reconciliation error") };
        this.repository.setComponentStatus(service.id, result);
        statuses.push({ ...result, reconciledAt: new Date().toISOString() });
      }
    }
    return statuses;
  }
  async reconcileAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { for (const service of this.repository.list()) await this.reconcileService(service); }
    finally { this.running = false; }
  }
}

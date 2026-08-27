import { ServiceRepository } from "../services/repository.js";

export class HealthChecker {
  private running = false;
  constructor(private readonly repository: ServiceRepository) {}
  async checkAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await Promise.all(this.repository.list().map((service) => this.check(service.id))); }
    finally { this.running = false; }
  }
  async check(serviceId: string): Promise<void> {
    const service = this.repository.get(serviceId);
    if (!service) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${service.targetProtocol}://${service.targetHost}:${service.targetPort}/`, { method: "HEAD", redirect: "manual", signal: controller.signal });
      this.repository.setHealth(service.id, response.status < 500, `HTTP ${response.status}`);
    } catch (error) {
      this.repository.setHealth(service.id, false, error instanceof Error ? error.message : "Health check failed");
    } finally { clearTimeout(timeout); }
  }
}

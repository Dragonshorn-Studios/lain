import type { Service } from "@lain/shared";
import type { DerivedStateAdapter, ReconcileResult } from "./types.js";
import { disabled } from "./types.js";

export class LocalStateAdapter implements DerivedStateAdapter {
  constructor(public readonly component: "dns" | "proxy") {}
  async reconcile(service: Service): Promise<ReconcileResult> {
    const enabled = this.component === "dns" ? service.dnsEnabled : service.proxyEnabled;
    if (!enabled) return disabled(this.component);
    const actual = this.component === "dns" ? `${service.hostname} managed` : `${service.hostname} -> ${service.targetProtocol}://${service.targetHost}:${service.targetPort}`;
    return { component: this.component, desired: actual, actual, state: "ready" };
  }
}

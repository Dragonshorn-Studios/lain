import type { ComponentName, Service } from "@lain/shared";
import type { DerivedStateAdapter, ReconcileResult } from "./types.js";
import { disabled } from "./types.js";

export class MockAdapter implements DerivedStateAdapter {
  constructor(public readonly component: ComponentName, private readonly enabled: (service: Service) => boolean) {}
  async reconcile(service: Service): Promise<ReconcileResult> {
    if (!this.enabled(service)) return disabled(this.component);
    return {
      component: this.component,
      desired: "configured",
      actual: "mocked",
      state: "ready",
      message: "Mock adapter: no external changes were made"
    };
  }
}

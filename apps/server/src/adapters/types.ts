import type { ComponentName, ComponentStatus, Service } from "@lain/shared";

export type ReconcileResult = Omit<ComponentStatus, "reconciledAt">;

export interface DerivedStateAdapter {
  readonly component: ComponentName;
  reconcile(service: Service): Promise<ReconcileResult>;
  remove?(service: Service): Promise<void>;
}

export const disabled = (component: ComponentName): ReconcileResult => ({
  component, desired: "disabled", actual: "disabled", state: "disabled"
});

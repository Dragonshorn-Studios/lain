import type { ComponentState } from "@lain/shared";

const colors: Record<ComponentState | "healthy" | "unhealthy" | "unknown", string> = {
  ready: "bg-emerald-400", healthy: "bg-emerald-400", disabled: "bg-white/25", pending: "bg-amber-300", degraded: "bg-amber-300", error: "bg-rose-400", unhealthy: "bg-rose-400", unknown: "bg-white/25"
};

export function StatusDot({ state }: { state: ComponentState | "healthy" | "unhealthy" | "unknown" }) { return <span className={`inline-block h-2 w-2 rounded-full ${colors[state]}`} />; }

export function HealthBadge({ healthy }: { healthy: boolean | null }) {
  const label = healthy === null ? "Pending" : healthy ? "Healthy" : "Unhealthy";
  const state = healthy === null ? "unknown" : healthy ? "healthy" : "unhealthy";
  return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-xs text-white/60"><StatusDot state={state}/>{label}</span>;
}

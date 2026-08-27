import type { DashboardSummary, ServiceInput, ServiceWithStatus, SystemSetup } from "@lain/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? "Request failed");
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  services: () => request<ServiceWithStatus[]>("/api/services"),
  service: (id: string) => request<ServiceWithStatus>(`/api/services/${id}`),
  dashboard: () => request<DashboardSummary>("/api/dashboard"),
  systemSetup: () => request<SystemSetup>("/api/system/setup"),
  create: (input: ServiceInput) => request<ServiceWithStatus>("/api/services", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: ServiceInput) => request<ServiceWithStatus>(`/api/services/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/api/services/${id}`, { method: "DELETE" }),
  reconcile: (id?: string) => request(id ? `/api/services/${id}/reconcile` : "/api/reconcile", { method: "POST" })
};

import type { ApiKeyCreated, ApiKeyInfo, AuthSessionInfo, DashboardSummary, ServiceInput, ServiceWithStatus, SystemSetup } from "@lain/shared";

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly setupRequired?: boolean) {
    super(message);
  }
}

function redirectToLogin(): void {
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }) as { error?: string; setupRequired?: boolean });
    if (response.status === 401 && !path.startsWith("/api/auth/")) redirectToLogin();
    throw new ApiRequestError(body.error ?? "Request failed", response.status, body.setupRequired);
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
  reconcile: (id?: string) => request(id ? `/api/services/${id}/reconcile` : "/api/reconcile", { method: "POST" }),
  authSession: () => request<AuthSessionInfo>("/api/auth/session"),
  authSetup: (password: string) => request<{ status: string }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ password }) }),
  authLogin: (password: string) => request<{ status: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  authLogout: () => request<void>("/api/auth/logout", { method: "POST" }),
  apiKeys: () => request<ApiKeyInfo[]>("/api/keys"),
  createApiKey: (name: string) => request<ApiKeyCreated>("/api/keys", { method: "POST", body: JSON.stringify({ name }) }),
  revokeApiKey: (id: string) => request<void>(`/api/keys/${id}`, { method: "DELETE" })
};

export const exposureValues = ["internal", "private", "public"] as const;
export const protocolValues = ["http", "https"] as const;
export const tlsProviderValues = ["none", "letsencrypt-cloudflare"] as const;

export type Exposure = (typeof exposureValues)[number];
export type TargetProtocol = (typeof protocolValues)[number];
export type TlsProvider = (typeof tlsProviderValues)[number];

export interface Service {
  id: string;
  name: string;
  hostname: string;
  targetProtocol: TargetProtocol;
  targetHost: string;
  targetPort: number;
  site: string;
  exposure: Exposure;
  dnsEnabled: boolean;
  proxyEnabled: boolean;
  tlsEnabled: boolean;
  tlsProvider: TlsProvider;
  cloudflareTunnelEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ServiceInput = Omit<Service, "id" | "createdAt" | "updatedAt">;

export type ComponentName = "dns" | "proxy" | "tls" | "cloudflare-dns" | "cloudflare-tunnel";
export type ComponentState = "disabled" | "pending" | "ready" | "degraded" | "error";

export interface ComponentStatus {
  component: ComponentName;
  desired: string;
  actual: string;
  state: ComponentState;
  message?: string;
  reconciledAt?: string;
}

export interface ServiceStatus {
  serviceId: string;
  healthy: boolean | null;
  healthMessage: string;
  checkedAt: string | null;
  components: ComponentStatus[];
}

export interface ServiceWithStatus extends Service {
  status: ServiceStatus;
}

export interface DashboardSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  pending: number;
  publicServices: number;
  setup: SystemSetup;
}

export type SetupCheckState = "ready" | "warning" | "error";

export const setupCheckIds = ["operating-system", "node", "admin-password", "cloudflared", "cloudflare-config", "proxy-ports", "dns-address", "laind-service", "cloudflared-service"] as const;
export type SetupCheckId = (typeof setupCheckIds)[number];

export interface SetupCheck {
  id: SetupCheckId;
  label: string;
  state: SetupCheckState;
  required: boolean;
  detail: string;
  remediation?: {
    command: string;
    description: string;
  };
}

export interface SystemSetup {
  checkedAt: string;
  platform: string;
  release: string;
  architecture: string;
  addresses: Array<{ interface: string; address: string; network?: string }>;
  checks: SetupCheck[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface AuthSessionInfo {
  authenticated: boolean;
  setupRequired: boolean;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string;
}

export const defaultServiceInput: ServiceInput = {
  name: "",
  hostname: "",
  targetProtocol: "http",
  targetHost: "127.0.0.1",
  targetPort: 80,
  site: "home",
  exposure: "internal",
  dnsEnabled: true,
  proxyEnabled: true,
  tlsEnabled: false,
  tlsProvider: "none",
  cloudflareTunnelEnabled: false
};

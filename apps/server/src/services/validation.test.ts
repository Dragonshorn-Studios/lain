import { describe, expect, it } from "vitest";
import { defaultServiceInput } from "@lain/shared";
import { serviceInputSchema } from "./validation.js";

describe("service input", () => {
  it("accepts a valid internal service", () => {
    expect(serviceInputSchema.safeParse({ ...defaultServiceInput, name: "Grafana", hostname: "grafana.home.internal", targetPort: 3000 }).success).toBe(true);
  });
  it("requires public exposure for a tunnel", () => {
    const result = serviceInputSchema.safeParse({ ...defaultServiceInput, name: "Grafana", hostname: "grafana.example.com", cloudflareTunnelEnabled: true });
    expect(result.success).toBe(false);
  });
  it("requires a provider when TLS is enabled", () => {
    const result = serviceInputSchema.safeParse({ ...defaultServiceInput, name: "Grafana", hostname: "grafana.example.com", tlsEnabled: true });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("removes known secret values", () => {
    expect(redactSecrets("request failed with credential-token", ["credential-token"])).toBe("request failed with [redacted]");
  });

  it("ignores short values that could appear in ordinary messages", () => {
    expect(redactSecrets("token bad", ["bad"])).toBe("token bad");
  });

  it("scrubs bearer tokens", () => {
    expect(redactSecrets("401: Bearer eyJhbGciOi.abcdef-123_a", [])).toBe("401: Bearer [redacted]");
  });

  it("scrubs key=value assignments", () => {
    expect(redactSecrets("failed: token=abc123 refresh failed", [])).toBe("failed: token=[redacted] refresh failed");
    expect(redactSecrets("api_key=xyz password=hunter2", [])).toBe("api_key=[redacted] password=[redacted]");
  });
});

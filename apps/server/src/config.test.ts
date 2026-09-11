import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNSAFE_LIVE_ACKNOWLEDGEMENT, loadConfig } from "./config.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("systemd credentials", () => {
  it("prefers a credential file without exposing it through the environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "lain-credentials-"));
    directories.push(directory);
    writeFileSync(join(directory, "cloudflare-api-token"), "credential-token\n", { mode: 0o600 });
    const config = loadConfig({ CREDENTIALS_DIRECTORY: directory, CLOUDFLARE_API_TOKEN: "environment-token" });
    expect(config.cloudflare.apiToken).toBe("credential-token");
  });

  it("retains environment configuration outside systemd", () => {
    expect(loadConfig({ CLOUDFLARE_API_TOKEN: "development-token" }).cloudflare.apiToken).toBe("development-token");
  });
});

describe("authentication configuration", () => {
  it("defaults to session authentication with no trusted origins", () => {
    const config = loadConfig({});
    expect(config.authMode).toBe("session");
    expect(config.trustedOrigins).toEqual([]);
    expect(config.allowUnsafeLive).toBe(false);
  });

  it("parses trusted origins from a comma-separated list", () => {
    expect(loadConfig({ LAIN_TRUSTED_ORIGINS: " https://a.example , https://b.example ,," }).trustedOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("refuses to start live adapters with authentication disabled without an explicit acknowledgement", () => {
    expect(() => loadConfig({ LAIN_AUTH: "off", LAIN_ADAPTER_MODE: "live" })).toThrow(/LAIN_ALLOW_UNSAFE_LIVE/);
    const config = loadConfig({ LAIN_AUTH: "off", LAIN_ADAPTER_MODE: "live", LAIN_ALLOW_UNSAFE_LIVE: UNSAFE_LIVE_ACKNOWLEDGEMENT });
    expect(config.allowUnsafeLive).toBe(true);
  });

  it("allows authentication to be disabled in mock mode", () => {
    expect(loadConfig({ LAIN_AUTH: "off" }).authMode).toBe("off");
  });
});

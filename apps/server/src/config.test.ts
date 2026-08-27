import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

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

import { hostname } from "node:os";

const KEYCHAIN_SERVICE = "lain";

export interface SecretStore {
  get(): string | undefined;
  set(value: string): void;
  remove(): void;
}

/**
 * OS keychain access (macOS Keychain, Windows Credential Manager, Linux Secret
 * Service). Returns undefined on platforms where no keychain backend exists —
 * headless servers without a secret daemon — so callers can fall back to
 * prompting or environment variables instead of persisting anything to disk.
 */
export async function keychainStore(account: string): Promise<SecretStore | undefined> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry(KEYCHAIN_SERVICE, account);
    return {
      get: () => { try { return entry.getPassword() ?? undefined; } catch { return undefined; } },
      set: (value: string) => { entry.setPassword(value); },
      remove: () => { try { entry.deletePassword(); } catch { /* already removed */ } }
    };
  } catch { return undefined; }
}

export function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) { reject(new Error("an interactive terminal is required to enter the admin password")); return; }
    process.stderr.write(label);
    const characters: string[] = [];
    const wasRaw = input.isRaw;
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          cleanup(); process.stderr.write("\n"); resolve(characters.join("")); return;
        }
        if (character === "\u0003") { cleanup(); process.stderr.write("\n"); reject(new Error("cancelled")); return; }
        if (character === "\u007f" || character === "\b") { characters.pop(); continue; }
        characters.push(character);
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

export function keychainAccount(baseUrl: string): string {
  return `api-key ${baseUrl}`;
}

/** Signs in with the admin password, then mints a dedicated API key for this host and returns it. */
export async function interactiveLogin(baseUrl: string, keyName = `lainctl-${hostname()}`): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const password = await promptHidden("Lain admin password: ");
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (login.ok) {
      const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
      const keyResponse = await fetch(`${baseUrl}/api/keys`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: keyName }) });
      if (!keyResponse.ok) throw new Error(`could not create an API key: ${keyResponse.status} ${await keyResponse.text()}`);
      return (await keyResponse.json() as { key: string }).key;
    }
    if (login.status === 409) throw new Error("no admin password is configured yet; open the dashboard at /login and complete first-run setup");
    if (login.status === 429) throw new Error("too many failed attempts; wait a few minutes before trying again");
    if (attempt < 3) process.stderr.write("Incorrect password.\n");
  }
  throw new Error("login failed after 3 attempts");
}

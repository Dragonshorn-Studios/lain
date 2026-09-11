import { hostname } from "node:os";

const KEYCHAIN_SERVICE = "lain";

export interface SecretStore {
  /** Returns undefined when no credential is stored; logs and returns undefined on read failures (locked/unreachable store). */
  get(): string | undefined;
  /** Throws when the credential could not be stored — callers own the messaging. */
  set(value: string): void;
  /** Throws when a stored credential could not be deleted — callers own the messaging. */
  remove(): void;
}

/**
 * OS keychain access (macOS Keychain, Windows Credential Manager, Linux Secret
 * Service). Returns undefined only when no keyring backend is available on this
 * platform. A keychain that exists but is unreachable — a locked store, or a
 * headless Linux without a secret daemon — surfaces errors on use, so callers
 * must fall back to printing a key once for LAIN_API_KEY instead of assuming
 * the entry was persisted.
 */
export async function keychainStore(account: string): Promise<SecretStore | undefined> {
  let Entry: (new (service: string, account: string) => { getPassword(): string | null; setPassword(value: string): void; deletePassword(): boolean });
  try { ({ Entry } = await import("@napi-rs/keyring")); }
  catch (error) {
    console.error(`OS keychain unavailable (${error instanceof Error ? error.message : error}); using environment variables and prompts instead.`);
    return undefined;
  }
  const entry = new Entry(KEYCHAIN_SERVICE, account);
  return {
    get: () => {
      try { return entry.getPassword() ?? undefined; }
      catch (error) {
        console.error(`OS keychain is locked or unreadable (${error instanceof Error ? error.message : error}); continuing without a stored key.`);
        return undefined;
      }
    },
    set: (value: string) => { entry.setPassword(value); },
    remove: () => { entry.deletePassword(); }
  };
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
      input.removeListener("error", onError);
      input.removeListener("close", onClose);
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
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error("input closed before the password was entered")); };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.once("error", onError);
    input.once("close", onClose);
  });
}

export function keychainAccount(baseUrl: string): string {
  return `api-key ${baseUrl}`;
}

/**
 * Signs in with the admin password, then mints a dedicated API key for this
 * host and returns it. Keys from earlier logins under the same name are
 * revoked so repeated sign-ins do not accumulate orphans.
 */
export async function interactiveLogin(baseUrl: string, keyName = `lainctl-${hostname()}`): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const password = await promptHidden("Lain admin password: ");
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (login.ok) {
      const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
      const keyResponse = await fetch(`${baseUrl}/api/keys`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: keyName }) });
      if (!keyResponse.ok) throw new Error(`could not create an API key: ${keyResponse.status} ${await keyResponse.text().catch(() => "")}`);
      const created = await keyResponse.json() as { id: string; key: string };
      try {
        const keys = await fetch(`${baseUrl}/api/keys`, { headers: { cookie } }).then((response) => response.ok ? response.json() as Promise<Array<{ id: string; name: string }>> : []);
        for (const existing of keys) {
          if (existing.name === keyName && existing.id !== created.id) {
            await fetch(`${baseUrl}/api/keys/${existing.id}`, { method: "DELETE", headers: { cookie } });
          }
        }
      } catch { /* best-effort cleanup; the new key is already created and returned */ }
      return created.key;
    }
    if (login.status === 409) throw new Error("no admin password is configured yet; open the dashboard at /login and complete first-run setup");
    if (login.status === 429) throw new Error("too many failed attempts; wait a few minutes before trying again");
    if (login.status !== 401) throw new Error(`login failed: ${login.status} ${await login.text().catch(() => "")}`);
    if (attempt < 3) process.stderr.write("Incorrect password.\n");
  }
  throw new Error("login failed after 3 attempts");
}

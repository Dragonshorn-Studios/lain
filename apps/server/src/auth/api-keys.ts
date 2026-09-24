import { createHash, randomBytes } from "node:crypto";

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  // The 12-char prefix (lain_ + 7 random chars) exists for identification in
  // listings only; lookup is by SHA-256 of the full key. Unsalted hashing is
  // fine here because keys are 256-bit random, unlike human passwords.
  const key = `lain_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url");
}

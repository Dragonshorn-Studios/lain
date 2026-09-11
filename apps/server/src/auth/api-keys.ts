import { createHash, randomBytes } from "node:crypto";

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const key = `lain_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("base64url");
}

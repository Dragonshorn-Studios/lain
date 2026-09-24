const bearerPattern = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const assignmentPattern = /((?:token|api_?key|password|client_secret|secret)=)[^&\s]+/gi;

/** Removes anything secret-looking (or any known secret value) from a message before it is stored or served. */
export function redactSecrets(message: string, secrets: Array<string | undefined> = []): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted.replace(bearerPattern, "Bearer [redacted]").replace(assignmentPattern, "$1[redacted]");
}

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const GITHUB_REPO = "Dragonshorn-Studios/lain";
const INSTALL_ROOT = "/opt/lain";
const CURRENT_LINK = join(INSTALL_ROOT, "current");
const RELEASES_DIR = join(INSTALL_ROOT, "releases");
const STATE_DIR = "/var/lib/lain";
const HEALTH_ATTEMPTS = 15;
const HEALTH_POLL_MS = 2_000;

/** Throwing variant used inside the update transaction so cleanup runs. */
function abort(message: string): never {
  throw new Error(message);
}

/** Version of the checkout lainctl itself runs from. */
export function cliVersion(): string {
  try {
    return packageVersion(resolve(dirname(fileURLToPath(import.meta.url)), "../../../package.json"));
  } catch { return "unknown"; }
}

/** Version of the installed release lainctl manages, when present. */
export function installedVersion(): string | undefined {
  try {
    return packageVersion(join(CURRENT_LINK, "package.json"));
  } catch { return undefined; }
}

function packageVersion(path: string): string {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  if (!parsed.version) throw new Error(`no version in ${path}`);
  return parsed.version;
}

function readLainEnv(name: string, fallback: string): string {
  try {
    const line = readFileSync("/etc/lain/lain.env", "utf8").split("\n").find((entry) => entry.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || fallback;
  } catch { return fallback; }
}

function normalizeVersion(value: string): string {
  const out = value.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(out)) abort(`unsupported version format: ${value} (expected vX.Y.Z)`);
  return out;
}

function requireRoot(): void {
  if ((process.getuid?.() ?? -1) !== 0) abort("lainctl update must run with sudo");
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": "lainctl-update" }, redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!response.ok) abort(`could not download ${url}: HTTP ${response.status} (is the release published and the repository public?)`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function latestReleaseVersion(): Promise<string | undefined> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { "User-Agent": "lainctl-update" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return undefined;
  const body = await response.json() as { tag_name?: string };
  return body.tag_name ? normalizeVersion(body.tag_name) : undefined;
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: options.cwd });
  if (result.status !== 0 || result.error) {
    const detail = result.error ? ` (${result.error.message})` : result.signal ? ` (killed by ${result.signal})` : "";
    abort(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "signal"}${detail}`);
  }
}

function switchSymlink(releaseDirectory: string): void {
  const temporary = `${CURRENT_LINK}.tmp`;
  run("ln", ["-sfn", releaseDirectory, temporary]);
  run("mv", ["-T", temporary, CURRENT_LINK]);
}

function previousRelease(): string | undefined {
  try { return readlinkSync(CURRENT_LINK) || undefined; }
  catch { return undefined; }
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${readLainEnv("LAIN_PORT", "3100")}/api/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch { return false; }
}

async function waitForHealth(): Promise<boolean> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    if (await healthy()) return true;
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, HEALTH_POLL_MS));
  }
  return false;
}

function backupDatabase(from: string, to: string): string | undefined {
  const database = readLainEnv("LAIN_DATABASE_URL", join(STATE_DIR, "lain.db"));
  if (!existsSync(database)) return undefined;
  const backupsDirectory = join(STATE_DIR, "backups");
  mkdirSync(backupsDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(backupsDirectory, `pre-${from}-to-${to}-${stamp}.db`);
  copyFileSync(database, backup);
  const backups = readdirSync(backupsDirectory).sort().reverse();
  for (const stale of backups.slice(3)) rmSync(join(backupsDirectory, stale), { force: true });
  return backup;
}

function pruneReleases(keep: string[]): void {
  if (!existsSync(RELEASES_DIR)) return;
  for (const entry of readdirSync(RELEASES_DIR)) {
    if (!keep.includes(entry)) rmSync(join(RELEASES_DIR, entry), { recursive: true, force: true });
  }
}

function updateHelp(): void {
  console.log(`Usage: lainctl update [--version vX.Y.Z] [--yes]

Updates a versioned install (/opt/lain/releases + /opt/lain/current) to a
release from GitHub Releases. The tarball is verified against SHA256SUMS and
built beside the running release; laind is then stopped, the database backed
up, /opt/lain/current switched, and laind started again. Any failure or a
failed health gate rolls back to the previous release and database
automatically. Without --version, the latest published release is used.`);
}

/**
 * lainctl update: fetches a verified release tarball, builds it beside the
 * current release, backs up the database, switches /opt/lain/current
 * atomically, restarts laind, and rolls everything back if the health gate
 * fails.
 */
export async function update(args: string[]): Promise<void> {
  let targetArgument: string | undefined;
  let assumeYes = false;
  while (args.length) {
    const argument = args.shift()!;
    if (argument === "--yes") assumeYes = true;
    else if (argument === "--version") targetArgument = args.shift();
    else if (argument.startsWith("--version=")) targetArgument = argument.slice("--version=".length);
    else if (argument === "-h" || argument === "--help") { updateHelp(); return; }
    else abort(`unknown option: ${argument} (see lainctl update --help)`);
  }

  requireRoot();
  if (!existsSync(CURRENT_LINK)) {
    abort("no versioned install found at /opt/lain/current; this host uses a different layout (see deploy/proxmox/README.md for its update flow)");
  }
  const currentVersion = installedVersion() ?? abort("cannot determine the installed version");

  const target = targetArgument ? normalizeVersion(targetArgument) : await latestReleaseVersion() ?? abort("could not resolve the latest release from GitHub; pass --version vX.Y.Z");
  if (target === currentVersion) { console.log(`Already on ${currentVersion}; nothing to update.`); return; }

  const database = readLainEnv("LAIN_DATABASE_URL", join(STATE_DIR, "lain.db"));
  const healthUrl = `http://127.0.0.1:${readLainEnv("LAIN_PORT", "3100")}/api/health`;
  console.log(`Updating laind ${currentVersion} -> ${target}`);
  console.log(`  release:  ${join(RELEASES_DIR, target)}`);
  console.log(`  database: ${database} (backed up while laind is stopped, before the switch)`);
  console.log(`  health:   ${healthUrl} (availability gate)`);
  console.log("  service:  systemctl stop/start laind, with automatic rollback on any failure");

  if (!assumeYes) {
    if (!process.stdin.isTTY) abort("--yes is required for a non-interactive update");
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    const answer = (await readline.question("Continue? [y/N]: ")).trim();
    readline.close();
    if (!/^y(es)?$/i.test(answer)) { console.log("Cancelled."); return; }
  }

  const temporary = mkdtempSync(join(tmpdir(), "lain-update-"));
  const previousTarget = previousRelease();
  let backup: string | undefined;
  try {
    const tarball = join(temporary, `lain-${target}.tar.gz`);
    console.log(`Downloading lain ${target}...`);
    await download(`https://github.com/${GITHUB_REPO}/releases/download/v${target}/lain-${target}.tar.gz`, tarball);
    await download(`https://github.com/${GITHUB_REPO}/releases/download/v${target}/SHA256SUMS`, join(temporary, "SHA256SUMS"));
    run("sha256sum", ["--check", "--strict", "SHA256SUMS"], { cwd: temporary });

    const releaseDirectory = join(RELEASES_DIR, target);
    if (existsSync(releaseDirectory)) abort(`${releaseDirectory} already exists; remove it before updating to the same version`);
    run("tar", ["-xzf", tarball, "-C", temporary]);
    mkdirSync(RELEASES_DIR, { recursive: true });
    run("mv", [join(temporary, `lain-${target}`), releaseDirectory]);

    try {
      console.log("Installing dependencies and building...");
      run("pnpm", ["install", "--frozen-lockfile"], { cwd: releaseDirectory });
      run("pnpm", ["build"], { cwd: releaseDirectory });
    } catch (error) {
      // Nothing has been switched yet; a half-built tree would only block re-runs.
      rmSync(releaseDirectory, { recursive: true, force: true });
      throw error;
    }

    // Everything below mutates the running host: any failure rolls back.
    try {
      console.log("Stopping laind for the database backup and release switch...");
      run("systemctl", ["stop", "laind.service"]);
      backup = backupDatabase(currentVersion, target);
      if (backup) console.log(`Database backed up to ${backup}`);
      else if (existsSync(database)) console.error(`warning: lain.env names ${database} but no backup could be taken; continuing without a backup`);
      else console.log(`No database exists at ${database} yet; skipping the backup (fresh install).`);
      switchSymlink(releaseDirectory);
      run("systemctl", ["start", "laind.service"]);
      if (!(await waitForHealth())) abort(`laind did not become healthy at ${healthUrl} after the update`);
    } catch (failure) {
      await rollback(currentVersion, previousTarget, backup, database, healthUrl, failure);
    }

    pruneReleases([target, previousTarget ? basename(previousTarget) : ""]);
    console.log(`Updated laind ${currentVersion} -> ${target}.`);
  } finally {
    try { rmSync(temporary, { recursive: true, force: true }); }
    catch { /* the temp dir is disposable; never mask the primary error */ }
  }
}

/**
 * Best-effort recovery after any post-switch failure: stop laind so its
 * persist-on-shutdown cannot clobber the restore, put the previous release and
 * database back, then start laind again. Never returns — always aborts with
 * the original cause plus any rollback problems.
 */
async function rollback(currentVersion: string, previousTarget: string | undefined, backup: string | undefined, database: string, healthUrl: string, cause: unknown): Promise<never> {
  console.error(`Update failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  console.error("Rolling back to the previous release...");
  const problems: string[] = [];
  const attempt = (label: string, action: () => void) => {
    try { action(); }
    catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  attempt("stop laind", () => run("systemctl", ["stop", "laind.service"]));
  if (previousTarget) attempt("switch release", () => switchSymlink(resolve(INSTALL_ROOT, previousTarget)));
  else problems.push("the previous release target is unknown; /opt/lain/current still points at the new release");
  if (backup) attempt("restore database", () => copyFileSync(backup, database));
  attempt("start laind", () => run("systemctl", ["start", "laind.service"]));
  const recovered = await waitForHealth();
  const summary = previousTarget
    ? `rolled back to ${currentVersion}`
    : "could not switch back (the previous release target is unknown)";
  if (recovered) console.error(`${summary}; laind is healthy again.${backup ? ` The database was restored from ${backup}.` : ""}`);
  else console.error(`${summary}, but laind is still not answering at ${healthUrl}; inspect journalctl -u laind -n 100 --no-pager.`);
  if (problems.length) console.error(`Rollback problems: ${problems.join("; ")}`);
  abort("update rolled back");
}

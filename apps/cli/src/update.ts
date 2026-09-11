import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(out)) abort(`unsupported version format: ${value} (expected vX.Y.Z)`);
  return out;
}

function requireRoot(): void {
  if ((process.getuid?.() ?? -1) !== 0) abort("lainctl update must run with sudo");
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": "lainctl-update" }, redirect: "follow" });
  if (!response.ok) abort(`could not download ${url}: HTTP ${response.status} (is the release published and the repository public?)`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function latestReleaseVersion(): Promise<string | undefined> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { "User-Agent": "lainctl-update" } });
  if (!response.ok) return undefined;
  const body = await response.json() as { tag_name?: string };
  return body.tag_name ? normalizeVersion(body.tag_name) : undefined;
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: options.cwd });
  if (result.status !== 0) abort(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "signal"}`);
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
release from GitHub Releases. The tarball is verified against SHA256SUMS,
built beside the running release, the database is backed up, and the switch
is rolled back automatically when laind fails its health gate.
Without --version, the latest published release is used.`);
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
  console.log(`Updating laind ${currentVersion} -> ${target}`);
  console.log(`  release:  ${join(RELEASES_DIR, target)}`);
  console.log(`  database: ${database} (backed up before the switch)`);
  console.log("  service:  systemctl restart laind, then a health gate with automatic rollback");

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

    console.log("Installing dependencies and building...");
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: releaseDirectory });
    run("pnpm", ["build"], { cwd: releaseDirectory });

    backup = backupDatabase(currentVersion, target);
    if (backup) console.log(`Database backed up to ${backup}`);

    console.log("Switching the current release and restarting laind...");
    switchSymlink(releaseDirectory);
    run("systemctl", ["restart", "laind.service"]);
    if (await waitForHealth()) {
      pruneReleases([target, previousTarget ?? ""]);
      console.log(`Updated laind ${currentVersion} -> ${target}.`);
      return;
    }

    console.error("laind did not become healthy; rolling back...");
    if (previousTarget) switchSymlink(resolve(INSTALL_ROOT, previousTarget));
    if (backup) copyFileSync(backup, database);
    run("systemctl", ["restart", "laind.service"]);
    if (!(await waitForHealth())) {
      console.error("Rollback applied, but laind is still unhealthy; inspect journalctl -u laind -n 100 --no-pager");
    } else {
      console.error(`Rolled back to ${currentVersion}. The database was restored${backup ? ` from ${backup}` : " (no backup existed)"}.`);
    }
    abort(`update to ${target} failed the health gate`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

# Releasing Lain

Releases are immutable git tags of the form `vX.Y.Z` that match the root `package.json` version. The release workflow (`.github/workflows/release.yml`) republishes every tag as a reproducible source tarball with a SHA-256 checksum manifest, so an installation can always be tied back to exactly what was released.

## Release checklist

1. Update `version` in the root `package.json` (and `apps/web/src/components/Layout.tsx`, which displays it) and commit.
2. Tag the release commit and push the tag:

   ```bash
   version=$(node -p "require('./package.json').version")
   git tag -a "v$version" -m "Lain v$version"
   git push origin "v$version"
   ```

3. The workflow verifies the tag against `package.json`, runs the frozen install, typecheck, build, and tests, then publishes a GitHub release containing `lain-<version>.tar.gz` and `SHA256SUMS`. A red tree cannot publish.

Tags are immutable: never move or delete a published tag. Fix forward with a new version.

## Verifying a release artifact

```bash
sha256sum --check --strict SHA256SUMS
```

## Installing from a release

The deployment launcher accepts a `REPO_REF` naming any branch, tag, or reviewed commit. Production installs should pin a release tag instead of `main`:

```bash
REPO_REF=v0.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Dragonshorn-Studios/lain/v0.1.0/deploy/proxmox/install.sh)"
```

An installation pinned to a tag or commit SHA is intentionally detached; update it by fetching and checking out the next reviewed tag rather than `git pull`. See [`deploy/proxmox/README.md`](../deploy/proxmox/README.md) for the full deployment and update flow.

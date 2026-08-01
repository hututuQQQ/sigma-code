# Quick start

For Windows x64, download `Sigma-Code-<version>-x64.exe` and its SHA-256
sidecar from [Sigma Releases](https://github.com/hututuQQQ/sigma/releases).
Verify the checksum, then run the installer. It contains both the Sigma Code UI
and the matching verified Sigma Runtime, so no separate Node.js, `sigma`, or
upstream `t3` installation is required. The installer is currently an unsigned
preview and may trigger Windows security warnings.

For source development:

```bash
# Install the pinned workspace dependencies
vp install

# Web development with an isolated, authenticated local environment
vp run dev

# Desktop development
vp run dev:desktop

# Deterministically isolate ports for another checkout
SIGMACODE_DEV_INSTANCE=feature-xyz vp run dev:desktop

# Production web/server build
vp run build

# Unsigned Windows desktop installer with verified Runtime
SIGMACODE_DESKTOP_SIGMA_RUNTIME=/path/to/sigma/.artifacts/agent-cli-win32-x64 \
  vp run dist:desktop:win:x64
```

Development state in a linked worktree is stored under its gitignored
`.sigma-code` directory. Installed builds use `~/.sigma/code`. An explicit
`--home-dir <path>` overrides both.

After building `apps/server`, run the local CLI directly when it is not
installed on `PATH`:

```bash
node apps/server/dist/bin.mjs serve
```

The public executable name in packaged distributions is `sigma-code`.
Desktop artifact builds require the verified portable Runtime directory
produced by `pnpm verify:package:agent-cli:windows` in the Sigma repository.
Official builds also set `SIGMACODE_DESKTOP_UPDATE_REPOSITORY=hututuQQQ/sigma`
and require the UI and Runtime versions to match the release tag exactly.

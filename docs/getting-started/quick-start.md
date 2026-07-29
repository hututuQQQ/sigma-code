# Quick start

Sigma Code is maintained from source until a Sigma-owned release repository and
package registry are configured. Do not install or run the upstream `t3`
package for a Sigma Code environment.

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

# Unsigned Windows desktop installer
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

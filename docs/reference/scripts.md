# Scripts

- `vp run dev` starts contracts, server, and web in watch mode.
- `vp run dev --share` publishes the web origin through this machine's tailnet.
- `vp run dev:server` starts only the server.
- `vp run dev:web` starts only the Vite web client.
- `vp run dev:desktop` starts the desktop and web development clients.
- `vp run build` builds application and package workspaces.
- `vp run dist:desktop:win:x64` creates an unsigned Windows x64 installer and
  requires `SIGMACODE_DESKTOP_SIGMA_RUNTIME` to point at a verified portable
  Sigma Runtime bundle.
- `vp run icons:check` verifies generated Sigma icon assets.
- `node apps/server/scripts/t3-sqlite-state.ts ...` inspects an explicitly
  selected Sigma Code SQLite database and creates a private backup before
  writes. The filename is retained as an internal upstream-compatible script
  name.

Linked worktrees default to their gitignored `.sigma-code` directory, even when
an ambient `SIGMACODE_HOME` exists. The main checkout and installed builds
default to `~/.sigma/code`, with development using its isolated `dev` state.
`--home-dir <path>` always wins.

Web development is single-origin. Do not set `VITE_HTTP_URL` or `VITE_WS_URL`;
Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known` to the selected server.
Open the one-time pairing URL printed by the dev runner.

Use `SIGMACODE_DEV_INSTANCE` to derive a stable port offset or
`SIGMACODE_PORT_OFFSET` for an explicit numeric offset. Read the selected ports
from the `[dev-runner]` line because occupied or browser-blocked ports can move
the pair.

Desktop production windows load `sigmacode://app/index.html`. Unsigned builds
are the default. Signed builds require real Sigma-owned platform credentials;
the build does not inherit T3 signing settings.

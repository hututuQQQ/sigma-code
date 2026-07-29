# Sigma Code

Sigma Code is an independently maintained desktop, web, and mobile client for
coding agents. It is a downstream fork of
[T3 Code](https://github.com/pingdotgg/t3code) with a first-party Sigma provider
connected over the open Agent Client Protocol (ACP).

Sigma Code is not affiliated with, sponsored by, or endorsed by T3 Tools, Inc.
The original T3 Code copyright and MIT license are preserved in
[LICENSE](./LICENSE); downstream and third-party attribution is documented in
[NOTICE](./NOTICE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Current status

This repository supports local development and unsigned desktop artifacts. No
Sigma Code release repository, hosted Connect service, signing identity, or
automatic-update channel is configured. Cloud features and updates therefore
stay disabled by default.

The retained upstream marketing site is reference source only and is disabled
from development, preview, build, and deployment in this downstream.

The application uses its own identities and state:

- executable: `sigma-code`
- URL scheme: `sigmacode`
- application ID: `io.github.hututuqqq.sigmacode`
- state directory: `~/.sigma/code`

It never migrates, reads, or writes `~/.t3` or the official T3 Code application
data.

Sigma Code retains the other upstream providers. Install and authenticate any
provider you intend to use:

- Sigma: make the `sigma` CLI available on `PATH`, or set its binary path
- Codex: install Codex CLI and run `codex login`
- Claude: install Claude Code and run `claude auth login`
- Cursor: install Cursor CLI and run `cursor-agent login`
- Grok Build: install Grok Build CLI and run `grok login`
- OpenCode: install OpenCode and run `opencode auth login`

## Development

Install the repository toolchain and dependencies:

```bash
curl -fsSL https://vite.plus | bash
vp install
```

On Windows:

```powershell
irm https://vite.plus/ps1 | iex
vp install
```

Start the web and server development stack:

```bash
vp run dev
```

Start the desktop development build:

```bash
vp run dev:desktop
```

The Sigma provider automatically starts the long-lived local ACP server with
`sigma acp`.

## Documentation

- [Getting started](./docs/getting-started/quick-start.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers)
- [Operations](./docs/operations/ci.md)
- [Syncing stable T3 releases](./docs/upstream-sync.md)

See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting downstream changes.

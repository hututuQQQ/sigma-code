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

The default path is **Sigma Runtime + ChatGPT subscription (experimental)**.
In the Windows desktop app, choose a Sigma subscription model and click
**Login with ChatGPT** once. Sigma keeps running the task, tools, recovery,
reviewer, strategist, and persistence; model requests use the ChatGPT/Codex
subscription allowance and do not require `OPENAI_API_KEY`. Authentication,
allowance, and network failures are shown directly and never trigger a silent
fallback to another paid provider.

Sigma Runtime's model layer is backed by the pinned Pi directory. Settings
shows one searchable model connection per underlying provider, with API-key
and OAuth methods supplied by the trusted Runtime. The full 1,100+ model
catalog remains searchable without rendering every model in the default
picker. Models with unverified pricing require explicit confirmation for the
current task and are shown as “Price unknown”, never as `$0`.

Sigma Code also retains the upstream providers. Install and authenticate any
separate provider you intend to use:

- Sigma Runtime + Pi model connections: desktop artifacts include a verified
  Sigma Runtime; ChatGPT, API-key, and supported OAuth logins are managed from
  Sigma Code
- Codex CLI（独立 Agent）: install Codex CLI and run `codex login`
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

Desktop artifacts must be built with a verified portable Runtime produced by
the Sigma repository:

```powershell
$env:SIGMACODE_DESKTOP_SIGMA_RUNTIME = "C:\path\to\sigma\.artifacts\agent-cli-win32-x64"
vp run dist:desktop:win:x64
```

The build rejects missing or incomplete Runtime bundles so a distributable
installer cannot silently ship without the Sigma provider.

## Documentation

- [Getting started](./docs/getting-started/quick-start.md)
- [ChatGPT subscription login](./docs/getting-started/chatgpt-subscription.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers)
- [Operations](./docs/operations/ci.md)
- [Syncing stable T3 releases](./docs/upstream-sync.md)

See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting downstream changes.

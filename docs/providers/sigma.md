# Sigma Runtime over ACP

Sigma Code integrates Sigma Runtime through ACP v1. The UI uses the generic ACP
runtime and a thin Sigma driver; Sigma-specific behavior stays at that adapter
boundary.

Packaged desktop builds use their bundled, verified Sigma Runtime by default.
Development builds discover `sigma` on `PATH`. In both cases the provider
starts:

```sh
sigma acp
```

In provider settings, `binaryPath` can point at another trusted Sigma
executable. A custom path takes precedence over the bundled Runtime, which
takes precedence over `PATH` discovery. The child process uses JSON-RPC over
stdio: stdout is protocol-only and runtime diagnostics stay on stderr.

The portable Runtime remains an opaque resource built and verified in the Sigma
repository. Sigma Code does not copy Sigma source into this fork or add its
packages to the T3 workspace dependency graph.

The integration supports health and model discovery, session create/load/resume
and release, streaming text and reasoning, plans, tool progress, approval
allow/deny, active steering, follow-up prompts, and cancellation. It does not
modify Sigma's existing one-shot `stream-json` behavior.

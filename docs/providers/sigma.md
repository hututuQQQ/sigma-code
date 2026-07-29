# Sigma Runtime over ACP

Sigma Code integrates Sigma Runtime through ACP v1. The UI uses the generic ACP
runtime and a thin Sigma driver; Sigma-specific behavior stays at that adapter
boundary.

The provider discovers `sigma` on `PATH` by default and starts:

```sh
sigma acp
```

In provider settings, `binaryPath` can point at another trusted Sigma executable.
The child process uses JSON-RPC over stdio: stdout is protocol-only and runtime
diagnostics stay on stderr.

The integration supports health and model discovery, session create/load/resume
and release, streaming text and reasoning, plans, tool progress, approval
allow/deny, active steering, follow-up prompts, and cancellation. It does not
modify Sigma's existing one-shot `stream-json` behavior.

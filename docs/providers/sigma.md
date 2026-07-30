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

The default Runtime model route is
`openai-codex/gpt-5.6-terra`. On Windows, Sigma Code can authenticate this route
against a ChatGPT/Codex subscription without an API key. The subscription
adapter is experimental and isolated from Sigma's other providers; failures
never fall back to a metered provider. See
[ChatGPT subscription login](../getting-started/chatgpt-subscription.md).

Sigma also publishes its pinned Pi provider and model directories through
`sigma auth list --json` and `sigma models list --json`. Sigma Code turns each
underlying provider into a host-scoped model connection. Connection and method
IDs must match the Runtime directory before the server starts a fixed
`sigma auth ...` command, so renderer input cannot become an arbitrary process
invocation.

The model picker searches the complete directory only after the user types.
Without a query it shows recommended models, favorites, the current model, and
models belonging to configured connections. The list remains virtualized for
the full catalog.

Billing labels distinguish metered API usage, subscription allowance, and
unknown pricing. Selecting an unpriced model requires confirmation for the
current task. Sigma Code persists `allowUnpricedCosts=true` in that task's
model selection and starts its ACP process with `--allow-unpriced-costs`; other
budget limits remain active.

The integration supports health and model discovery, session create/load/resume
and release, streaming text and reasoning, plans, tool progress, approval
allow/deny, active steering, follow-up prompts, and cancellation. It does not
modify Sigma's existing one-shot `stream-json` behavior.

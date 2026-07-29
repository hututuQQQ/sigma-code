# ChatGPT subscription login

Sigma Code's default model path is **Sigma Runtime + ChatGPT subscription
(experimental)**:

1. Install and open the Windows desktop app.
2. Keep the default `Sigma / openai-codex/gpt-5.6-terra` model, or choose
   another `openai-codex/*` model.
3. Send a task. Sigma Code opens the system browser for ChatGPT login.
4. Complete OAuth once. The original task continues automatically.

This path does not read `OPENAI_API_KEY` and does not use API-key billing.
ChatGPT subscription authentication and API billing are separate systems; see
OpenAI's [authentication](https://learn.chatgpt.com/docs/auth) and
[pricing](https://learn.chatgpt.com/docs/pricing) documentation.

The task is still owned by Sigma Runtime. Sigma's tools, recovery, token/turn
budgets, reviewer, strategist, and durable conversation state remain active.
Subscription usage retains token counts, but API cost is shown as subscription
usage rather than `$0 API cost`.

## Authentication behavior

- Credentials are host-scoped and shared by Sigma provider instances in
  `~/.sigma/auth.json`.
- The settings page shows the connected account and provides login/logout.
- Browser callback failures fall back to a manual authorization-code prompt.
- Device-code login is available as an alternative.
- Web, mobile, and remote clients can use credentials already present on the
  connected host, but version 1 can only start login on the Windows desktop
  attached directly to that host.
- Logout does not abort an HTTP request already in flight, but every later
  model request requires login again.
- Authentication expiry, exhausted allowance, rate limits, and network/server
  failures are surfaced without falling back to DeepSeek, GLM, or another API.

## Experimental provider boundary

The adapter uses the community Pi implementation of ChatGPT OAuth and the
Codex subscription backend. That backend is not a public third-party API with
a stability commitment, so the provider is isolated, version-pinned, and
marked experimental. See OpenAI's
[Codex community projects](https://developers.openai.com/community/codex-for-oss).

## Codex CLI（独立 Agent）

The existing Codex CLI provider remains available and keeps all existing
sessions and provider IDs. It launches `codex app-server` as an independent
agent runtime. Use it when you specifically want Codex CLI behavior rather
than Sigma's runtime, tools, and persistence.

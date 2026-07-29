import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  isSafeProviderAuthExternalUrl,
  providerModelNeedsLogin,
  resolveProviderModelAuthRequirement,
} from "./providerAuth";

const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("sigma"),
  model: "openai-codex/gpt-5.6-terra",
};

function provider(status: "authenticated" | "unauthenticated" | "unknown"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("sigma"),
    driver: ProviderDriverKind.make("sigma"),
    displayName: "Sigma",
    enabled: true,
    status: "ready",
    installed: true,
    version: "test",
    checkedAt: "2026-07-29T00:00:00.000Z",
    auth: { status: "unknown" },
    authConnections: [
      {
        id: "openai-codex",
        label: "ChatGPT Subscription",
        status,
        loginMethods: ["browser", "device-code"],
        scope: "host",
        actions: status === "authenticated" ? ["logout"] : ["login"],
        experimental: true,
      },
    ],
    models: [
      {
        slug: selection.model,
        name: "GPT-5.6 Terra",
        isCustom: false,
        capabilities: null,
        authConnectionId: "openai-codex",
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

describe("provider subscription authentication", () => {
  it("requires login only for a model linked to an unauthenticated connection", () => {
    expect(
      providerModelNeedsLogin(
        resolveProviderModelAuthRequirement([provider("unauthenticated")], selection),
      ),
    ).toBe(true);
    expect(
      providerModelNeedsLogin(
        resolveProviderModelAuthRequirement([provider("authenticated")], selection),
      ),
    ).toBe(false);
  });

  it("does not apply a provider-wide login requirement to unrelated models", () => {
    const current = provider("unauthenticated");
    const unrelatedSelection = { ...selection, model: "deepseek/deepseek-chat" };
    expect(resolveProviderModelAuthRequirement([current], unrelatedSelection)).toBeNull();
  });

  it("opens only credential-free HTTPS authentication URLs", () => {
    expect(
      isSafeProviderAuthExternalUrl("https://auth.openai.com/oauth/authorize?state=one-time"),
    ).toBe(true);
    expect(isSafeProviderAuthExternalUrl("http://auth.openai.com/oauth/authorize")).toBe(false);
    expect(isSafeProviderAuthExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isSafeProviderAuthExternalUrl("https://user:secret@auth.openai.com/")).toBe(false);
    expect(isSafeProviderAuthExternalUrl("not a URL")).toBe(false);
  });
});

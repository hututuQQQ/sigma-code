import { assert, describe, it } from "@effect/vitest";

import { resolveProviderIconKind } from "./providerIconKind";

describe("resolveProviderIconKind", () => {
  it("uses Sigma artwork for the Sigma provider", () => {
    assert.equal(resolveProviderIconKind("sigma"), "sigma");
  });

  it("preserves the existing provider fallbacks", () => {
    assert.equal(resolveProviderIconKind("claudeAgent"), "claude");
    assert.equal(resolveProviderIconKind("codex"), "openai");
    assert.equal(resolveProviderIconKind(undefined), "openai");
  });
});

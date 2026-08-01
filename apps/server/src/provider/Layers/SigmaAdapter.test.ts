import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/schema";

import { sigmaPermissionRequiresExplicitDecision, sigmaPromptFailure } from "./SigmaAdapter.ts";

function response(outcome: string, message?: string): EffectAcpSchema.PromptResponse {
  return {
    stopReason: "refusal",
    _meta: {
      "sigma.outcome": outcome,
      ...(message === undefined ? {} : { "sigma.message": message }),
    },
  };
}

describe("SigmaAdapter prompt settlement", () => {
  it.each(["recoverable_failure", "fatal"])(
    "turns legacy Sigma %s prompt responses into ACP failures",
    (outcome) => {
      const failure = sigmaPromptFailure(response(outcome, "Provider request failed."));

      expect(failure).toMatchObject({
        _tag: "AcpRequestError",
        code: -32603,
        message: "Provider request failed.",
        data: { "sigma.outcome": outcome },
      });
    },
  );

  it("uses a safe fallback and ignores ordinary ACP refusals", () => {
    expect(sigmaPromptFailure(response("fatal", "   "))?.message).toBe(
      "Sigma Runtime failed before completing the turn.",
    );
    expect(sigmaPromptFailure(response("completed", "Done."))).toBeUndefined();
    expect(sigmaPromptFailure({ stopReason: "refusal" })).toBeUndefined();
  });
});

describe("SigmaAdapter permission policy", () => {
  const request = (meta?: Record<string, unknown>): EffectAcpSchema.RequestPermissionRequest => ({
    sessionId: "session-1",
    toolCall: { toolCallId: "checkpoint-1" },
    options: [{ optionId: "keep", name: "Keep", kind: "allow_once" }],
    ...(meta ? { _meta: meta } : {}),
  });

  it("requires an explicit decision only when the permission request declares it", () => {
    expect(
      sigmaPermissionRequiresExplicitDecision(
        request({
          "sigma.permission.requiresExplicitDecision": true,
        }),
      ),
    ).toBe(true);
    expect(
      sigmaPermissionRequiresExplicitDecision(
        request({
          "sigma.permission.requiresExplicitDecision": false,
        }),
      ),
    ).toBe(false);
    expect(sigmaPermissionRequiresExplicitDecision(request())).toBe(false);
  });
});

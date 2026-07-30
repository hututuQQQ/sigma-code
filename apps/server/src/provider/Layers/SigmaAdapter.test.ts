import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/schema";

import { sigmaPromptFailure } from "./SigmaAdapter.ts";

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

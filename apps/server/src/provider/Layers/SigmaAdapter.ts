import { ProviderDriverKind, ProviderInstanceId, type SigmaSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  type AcpAdapterProfile,
  type GrokAdapterLiveOptions,
  makeGrokAdapter,
} from "./GrokAdapter.ts";
import {
  applySigmaAcpModelSelection,
  currentSigmaModelIdFromSessionSetup,
  makeSigmaAcpRuntime,
  resolveSigmaAcpModelId,
} from "../acp/SigmaAcpSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import type { SigmaAdapterShape } from "../Services/SigmaAdapter.ts";

const SIGMA_PROVIDER = ProviderDriverKind.make("sigma");
const SIGMA_INSTANCE = ProviderInstanceId.make("sigma");

function sigmaModeId(interactionMode: "default" | "plan" | undefined): string {
  return interactionMode === "plan" ? "analyze" : "change";
}

function sigmaPrompt(input: {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly sessionId: string;
  readonly prompt: ReadonlyArray<EffectAcpSchema.ContentBlock>;
  readonly steering: boolean;
}): Effect.Effect<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError> {
  if (!input.steering) {
    return input.runtime.prompt({ prompt: input.prompt });
  }

  const text = input.prompt
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  if (!text || input.prompt.some((block) => block.type !== "text")) {
    return Effect.fail(
      EffectAcpErrors.AcpRequestError.invalidParams(
        "Sigma steering currently accepts text content only.",
      ),
    );
  }
  return input.runtime
    .request("_sigma/steer", { sessionId: input.sessionId, text })
    .pipe(Effect.as({ stopReason: "end_turn" as const }));
}

const SIGMA_ACP_PROFILE: AcpAdapterProfile = {
  provider: SIGMA_PROVIDER,
  label: "Sigma",
  defaultInstanceId: SIGMA_INSTANCE,
  clientName: "sigma-code",
  mcpServerName: "sigma-code",
  sessionModelSwitch: "unsupported",
  makeRuntime: makeSigmaAcpRuntime,
  modelSupport: {
    resolveModelId: resolveSigmaAcpModelId,
    currentModelId: currentSigmaModelIdFromSessionSetup,
    applySelection: applySigmaAcpModelSelection,
  },
  enableXAiExtensions: false,
  applyMode: ({ runtime, sessionId, interactionMode }) =>
    runtime
      .request("session/set_mode", {
        sessionId,
        modeId: sigmaModeId(interactionMode),
      } satisfies EffectAcpSchema.SetSessionModeRequest)
      .pipe(Effect.asVoid),
  sendPrompt: sigmaPrompt,
  closeSession: ({ runtime }) =>
    runtime.close.pipe(Effect.timeoutOption("5 seconds"), Effect.asVoid),
};

export type SigmaAdapterLiveOptions = Omit<GrokAdapterLiveOptions, "profile">;

export function makeSigmaAdapter(settings: SigmaSettings, options?: SigmaAdapterLiveOptions) {
  return makeGrokAdapter(settings, {
    ...options,
    profile: SIGMA_ACP_PROFILE,
  }).pipe(Effect.map((adapter): SigmaAdapterShape => adapter));
}

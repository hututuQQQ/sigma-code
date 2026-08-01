import { ProviderDriverKind, ProviderInstanceId, type SigmaSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
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
const SIGMA_FAILURE_MESSAGE = "Sigma Runtime failed before completing the turn.";
const SigmaFailureMeta = Schema.Struct({
  "sigma.outcome": Schema.Literals(["recoverable_failure", "fatal"]),
  "sigma.message": Schema.optional(Schema.String),
});
const decodeSigmaFailureMeta = Schema.decodeUnknownOption(SigmaFailureMeta);

function sigmaModeId(interactionMode: "default" | "plan" | undefined): string {
  return interactionMode === "plan" ? "analyze" : "change";
}

export function sigmaPromptFailure(
  response: EffectAcpSchema.PromptResponse,
): EffectAcpErrors.AcpRequestError | undefined {
  const decoded = decodeSigmaFailureMeta(response._meta);
  if (Option.isNone(decoded)) return undefined;
  const message = decoded.value["sigma.message"]?.trim() || SIGMA_FAILURE_MESSAGE;
  return EffectAcpErrors.AcpRequestError.internalError(message, {
    "sigma.outcome": decoded.value["sigma.outcome"],
  });
}

export function sigmaPermissionRequiresExplicitDecision(
  request: EffectAcpSchema.RequestPermissionRequest,
): boolean {
  const meta = request._meta;
  return Boolean(
    meta && typeof meta === "object" && meta["sigma.permission.requiresExplicitDecision"] === true,
  );
}

const sigmaPrompt = Effect.fn("SigmaAdapter.sigmaPrompt")(function* (input: {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly sessionId: string;
  readonly prompt: ReadonlyArray<EffectAcpSchema.ContentBlock>;
  readonly steering: boolean;
}): Effect.fn.Return<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError> {
  if (!input.steering) {
    const response = yield* input.runtime.prompt({ prompt: input.prompt });
    const failure = sigmaPromptFailure(response);
    if (failure) return yield* failure;
    return response;
  }

  const text = input.prompt
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  if (!text || input.prompt.some((block) => block.type !== "text")) {
    return yield* EffectAcpErrors.AcpRequestError.invalidParams(
      "Sigma steering currently accepts text content only.",
    );
  }
  yield* input.runtime.request("_sigma/steer", { sessionId: input.sessionId, text });
  return { stopReason: "end_turn" };
});

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
  requiresExplicitPermission: sigmaPermissionRequiresExplicitDecision,
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

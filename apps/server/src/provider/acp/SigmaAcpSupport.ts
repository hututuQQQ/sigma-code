import {
  DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
  type ModelSelection,
  type SigmaSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { getModelSelectionStringOptionValue, normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { resolveSigmaProcessEnvironment } from "../SigmaProxyEnvironment.ts";

const SIGMA_DRIVER_KIND = ProviderDriverKind.make("sigma");
const DEFAULT_SIGMA_MODEL = DEFAULT_SIGMA_SUBSCRIPTION_MODEL;
const SIGMA_MODEL_CONFIG_ID = "sigma.model";
export const SIGMA_REASONING_EFFORT_CONFIG_ID = "sigma.reasoning_effort";
export const SIGMA_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type SigmaReasoningEffort = (typeof SIGMA_REASONING_EFFORTS)[number];
const DEFAULT_SIGMA_BINARY = "sigma";

export const BUNDLED_SIGMA_BINARY_ENV = "SIGMACODE_BUNDLED_SIGMA_PATH";

type SigmaAcpRuntimeSettings = Pick<SigmaSettings, "binaryPath">;

export interface SigmaAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  /**
   * Named `grokSettings` for structural compatibility with the reusable ACP
   * adapter profile. Only the common binaryPath field is consumed.
   */
  readonly grokSettings: SigmaAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly modelSelection?: ModelSelection;
}

function allowsUnpricedCosts(selection: ModelSelection | undefined): boolean {
  return Boolean(
    selection?.options?.some(
      (option) => option.id === "allowUnpricedCosts" && option.value === true,
    ),
  );
}

export function resolveSigmaBinaryPath(
  settings: SigmaAcpRuntimeSettings | null | undefined,
  environment?: NodeJS.ProcessEnv,
): string {
  const configured = settings?.binaryPath?.trim();
  if (configured && configured !== DEFAULT_SIGMA_BINARY) {
    return configured;
  }

  const bundled = environment?.[BUNDLED_SIGMA_BINARY_ENV]?.trim();
  return bundled || configured || DEFAULT_SIGMA_BINARY;
}

export function buildSigmaAcpSpawnInput(
  settings: SigmaAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  modelSelection?: ModelSelection,
): AcpSessionRuntime.AcpSpawnInput {
  const spawnEnvironment =
    environment === undefined
      ? undefined
      : resolveSigmaProcessEnvironment(environment, {
          useDesktopSystemProxy: modelSelection?.model.startsWith("openai-codex/") === true,
        });
  return {
    command: resolveSigmaBinaryPath(settings, environment),
    args: ["acp", ...(allowsUnpricedCosts(modelSelection) ? ["--allow-unpriced-costs"] : [])],
    cwd,
    ...(spawnEnvironment === undefined ? {} : { env: spawnEnvironment }),
  };
}

export const makeSigmaAcpRuntime = (
  input: SigmaAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildSigmaAcpSpawnInput(
          input.grokSettings,
          input.cwd,
          input.environment,
          input.modelSelection,
        ),
        // Sigma authenticates its own model gateways. The runtime skips this
        // id because Sigma ACP intentionally advertises no auth methods.
        authMethodId: "sigma.local",
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function resolveSigmaAcpModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SIGMA_MODEL;
  return normalizeModelSlug(base, SIGMA_DRIVER_KIND) ?? DEFAULT_SIGMA_MODEL;
}

export function currentSigmaModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const modelOption = sessionSetupResult.configOptions?.find(
    (option) => option.id === SIGMA_MODEL_CONFIG_ID || option.category === "model",
  );
  return typeof modelOption?.currentValue === "string"
    ? modelOption.currentValue.trim() || undefined
    : undefined;
}

export function applySigmaAcpModelSelection<E>(input: {
  readonly runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "setConfigOption" | "setModel"
  >;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly modelSelection?: ModelSelection;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  const reasoningEffort = getModelSelectionStringOptionValue(
    input.modelSelection,
    "reasoningEffort",
  );
  return Effect.gen(function* () {
    const currentModelId = shouldSwitchModel
      ? yield* input.runtime
          .setModel(input.requestedModelId)
          .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId))
      : input.currentModelId;
    if (reasoningEffort) {
      yield* input.runtime
        .setConfigOption(SIGMA_REASONING_EFFORT_CONFIG_ID, reasoningEffort)
        .pipe(Effect.mapError(input.mapError));
    }
    return currentModelId;
  });
}

export function sigmaReasoningEffortFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): {
  readonly supportedReasoningEfforts: ReadonlyArray<SigmaReasoningEffort>;
  readonly currentReasoningEffort: SigmaReasoningEffort | undefined;
} {
  const reasoningOption = sessionSetupResult.configOptions?.find(
    (option) =>
      option.id === SIGMA_REASONING_EFFORT_CONFIG_ID || option.category === "thought_level",
  );
  if (reasoningOption?.type !== "select") {
    return { supportedReasoningEfforts: [], currentReasoningEffort: undefined };
  }
  const supportedReasoningEfforts = reasoningOption.options
    .flatMap((option) => ("options" in option ? option.options : [option]))
    .map((option) => option.value)
    .filter((value): value is SigmaReasoningEffort =>
      (SIGMA_REASONING_EFFORTS as readonly string[]).includes(value),
    )
    .filter((value, index, all) => all.indexOf(value) === index);
  const currentReasoningEffort =
    typeof reasoningOption.currentValue === "string" &&
    (SIGMA_REASONING_EFFORTS as readonly string[]).includes(reasoningOption.currentValue)
      ? (reasoningOption.currentValue as SigmaReasoningEffort)
      : undefined;
  return { supportedReasoningEfforts, currentReasoningEffort };
}

export function sigmaModelsFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  const modelOption = sessionSetupResult.configOptions?.find(
    (option) => option.id === SIGMA_MODEL_CONFIG_ID || option.category === "model",
  );
  if (modelOption?.type !== "select") {
    return [];
  }
  return modelOption.options
    .flatMap((option) => ("options" in option ? option.options : [option]))
    .map((option) => ({
      id: resolveSigmaAcpModelId(option.value),
      name: option.name.trim() || option.value,
    }))
    .filter(
      (option, index, all) => all.findIndex((candidate) => candidate.id === option.id) === index,
    );
}

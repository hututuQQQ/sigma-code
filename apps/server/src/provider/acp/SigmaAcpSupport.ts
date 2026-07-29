import { type SigmaSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const SIGMA_DRIVER_KIND = ProviderDriverKind.make("sigma");
const DEFAULT_SIGMA_MODEL = "deepseek/deepseek-v4-pro";
const SIGMA_MODEL_CONFIG_ID = "sigma.model";

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
}

export function buildSigmaAcpSpawnInput(
  settings: SigmaAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings?.binaryPath || "sigma",
    args: ["acp"],
    cwd,
    ...(environment === undefined ? {} : { env: environment }),
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
        spawn: buildSigmaAcpSpawnInput(input.grokSettings, input.cwd, input.environment),
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
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
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

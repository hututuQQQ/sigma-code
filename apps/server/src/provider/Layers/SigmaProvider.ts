import {
  type ModelCapabilities,
  type ServerProviderModel,
  type SigmaSettings,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  makeSigmaAcpRuntime,
  resolveSigmaBinaryPath,
  sigmaModelsFromSessionSetup,
} from "../acp/SigmaAcpSupport.ts";

const SIGMA_PRESENTATION = {
  displayName: "Sigma",
  showInteractionModeToggle: true,
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const ACP_PROBE_TIMEOUT_MS = 20_000;

function modelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  discovered: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(discovered, customModels ?? [], EMPTY_CAPABILITIES);
}

export const buildInitialSigmaProviderSnapshot = Effect.fn("buildInitialSigmaProviderSnapshot")(
  function* (settings: SigmaSettings) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = modelsFromSettings(settings.customModels);
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models,
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Sigma Runtime ACP availability...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Sigma is disabled in Sigma Code settings.",
          },
    });
  },
);

const runSigmaVersionCommand = (settings: SigmaSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = resolveSigmaBinaryPath(settings, environment);
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

const probeSigmaAcp = (settings: SigmaSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtime = yield* makeSigmaAcpRuntime({
      grokSettings: settings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      clientInfo: { name: "sigma-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* runtime.start();
    return yield* Effect.gen(function* () {
      yield* runtime.request("_sigma/health", {});
      const currentModel = started.sessionSetupResult.configOptions?.find(
        (option) => option.category === "model",
      )?.currentValue;
      return sigmaModelsFromSessionSetup(started.sessionSetupResult).map(
        (model): ServerProviderModel => ({
          slug: model.id,
          name: model.name,
          isCustom: false,
          ...(typeof currentModel === "string" && model.id === currentModel
            ? { isDefault: true }
            : {}),
          capabilities: EMPTY_CAPABILITIES,
        }),
      );
    }).pipe(Effect.ensuring(runtime.close.pipe(Effect.timeoutOption("5 seconds"), Effect.ignore)));
  }).pipe(Effect.scoped);

export const checkSigmaProviderStatus = Effect.fn("checkSigmaProviderStatus")(function* (
  settings: SigmaSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = modelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return yield* buildInitialSigmaProviderSnapshot(settings);
  }

  const versionResult = yield* runSigmaVersionCommand(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Sigma CLI (`sigma`) is not installed or not on PATH."
          : "Failed to execute the Sigma CLI health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Sigma CLI timed out while running `sigma --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Sigma CLI is installed but `sigma --version` failed.",
      },
    });
  }

  const acpExit = yield* probeSigmaAcp(settings, environment).pipe(
    Effect.timeoutOption(ACP_PROBE_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(acpExit)) {
    yield* Effect.logWarning("Sigma ACP health check failed.", {
      errorTag: causeErrorTag(acpExit.cause),
    });
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Sigma CLI is installed but `sigma acp` failed to start.",
      },
    });
  }
  if (Option.isNone(acpExit.value)) {
    return buildServerProvider({
      presentation: SIGMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Sigma ACP startup timed out after ${ACP_PROBE_TIMEOUT_MS}ms.`,
      },
    });
  }

  const discovered = acpExit.value.value;
  return buildServerProvider({
    presentation: SIGMA_PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(settings.customModels, discovered),
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

import {
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSkill,
  type SigmaSettings,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
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
  sigmaReasoningEffortFromSessionSetup,
} from "../acp/SigmaAcpSupport.ts";
import {
  makePendingSigmaAuthConnections,
  readSigmaAuthConnections,
  readSigmaModelCatalog,
  sigmaModelCapabilities,
  SIGMA_CODEX_AUTH_CONNECTION_ID,
} from "../SigmaPiCapability.ts";

const SIGMA_PRESENTATION = {
  displayName: "Sigma",
  showInteractionModeToggle: true,
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const FALLBACK_SIGMA_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "openai-codex/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    isCustom: false,
    isDefault: true,
    capabilities: sigmaModelCapabilities({
      supportedReasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
    }),
  },
];
const VERSION_PROBE_TIMEOUT_MS = 15_000;
const ACP_PROBE_TIMEOUT_MS = 20_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonempty(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function sigmaSkillsFromCapabilities(value: unknown): ReadonlyArray<ServerProviderSkill> {
  const rawSkills = record(value);
  const skills = Array.isArray(rawSkills?.skills) ? rawSkills.skills : [];
  const byName = new Map<string, ServerProviderSkill>();
  for (const candidate of skills) {
    const skill = record(candidate);
    const name = nonempty(skill?.name);
    const path = nonempty(skill?.path);
    if (!name || !path) continue;
    const description = nonempty(skill?.description);
    const scope =
      skill?.source === "home" || skill?.source === "workspace" ? skill.source : undefined;
    byName.set(name, {
      name,
      path,
      enabled: true,
      ...(description ? { description, shortDescription: description } : {}),
      ...(scope ? { scope } : {}),
    });
  }
  return [...byName.values()];
}

function modelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  discovered: ReadonlyArray<ServerProviderModel> = FALLBACK_SIGMA_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(discovered, customModels ?? [], EMPTY_CAPABILITIES).map(
    (model) =>
      model.slug.startsWith(`${SIGMA_CODEX_AUTH_CONNECTION_ID}/`)
        ? { ...model, authConnectionId: SIGMA_CODEX_AUTH_CONNECTION_ID }
        : model,
  );
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
      authConnections: makePendingSigmaAuthConnections(),
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
    const fileSystem = yield* FileSystem.FileSystem;
    // Packaged desktop processes run from the user's home directory, while
    // Sigma Runtime keeps its state below ~/.sigma. Sigma deliberately rejects
    // a workspace that contains its state root, so use an isolated temporary
    // workspace for the provider-level session probe. The probe also creates
    // an ACP session, so keep its state in a second scoped directory instead
    // of accumulating empty probe sessions in the user's real Sigma state.
    const probeCwd = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "sigma-code-provider-probe-",
    });
    const probeStateHome = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "sigma-code-provider-state-",
    });
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtime = yield* makeSigmaAcpRuntime({
      grokSettings: settings,
      environment: { ...environment, SIGMA_STATE_HOME: probeStateHome },
      childProcessSpawner,
      cwd: probeCwd,
      clientInfo: { name: "sigma-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* runtime.start();
    return yield* Effect.gen(function* () {
      yield* runtime.request("_sigma/health", {});
      const capabilities = yield* runtime.request("_sigma/capabilities", { cwd: probeCwd });
      const currentModel = started.sessionSetupResult.configOptions?.find(
        (option) => option.category === "model",
      )?.currentValue;
      const reasoning = sigmaReasoningEffortFromSessionSetup(started.sessionSetupResult);
      const models = sigmaModelsFromSessionSetup(started.sessionSetupResult).map(
        (model): ServerProviderModel => ({
          slug: model.id,
          name: model.name,
          isCustom: false,
          ...(typeof currentModel === "string" && model.id === currentModel
            ? { isDefault: true }
            : {}),
          capabilities:
            typeof currentModel === "string" && model.id === currentModel
              ? sigmaModelCapabilities({
                  supportedReasoningEfforts: reasoning.supportedReasoningEfforts,
                  ...(reasoning.currentReasoningEffort
                    ? { defaultReasoningEffort: reasoning.currentReasoningEffort }
                    : {}),
                })
              : EMPTY_CAPABILITIES,
        }),
      );
      return { models, skills: sigmaSkillsFromCapabilities(capabilities) };
    }).pipe(Effect.ensuring(runtime.close.pipe(Effect.timeoutOption("5 seconds"), Effect.ignore)));
  }).pipe(Effect.scoped);

export const checkSigmaProviderStatus = Effect.fn("checkSigmaProviderStatus")(function* (
  settings: SigmaSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | FileSystem.FileSystem
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
      authConnections: makePendingSigmaAuthConnections(),
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
      authConnections: makePendingSigmaAuthConnections(),
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
      authConnections: makePendingSigmaAuthConnections(),
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Sigma CLI is installed but `sigma --version` failed.",
      },
    });
  }

  const [authConnections, cliModels] = yield* Effect.all(
    [readSigmaAuthConnections(settings, environment), readSigmaModelCatalog(settings, environment)],
    { concurrency: "unbounded" },
  );
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
      authConnections,
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
      authConnections,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Sigma ACP startup timed out after ${ACP_PROBE_TIMEOUT_MS}ms.`,
      },
    });
  }

  const acpSnapshot = acpExit.value.value;
  const discovered = cliModels.length > 0 ? cliModels : acpSnapshot.models;
  return buildServerProvider({
    presentation: SIGMA_PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(settings.customModels, discovered),
    skills: acpSnapshot.skills,
    authConnections,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

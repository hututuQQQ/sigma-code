import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applySigmaAcpModelSelection,
  buildSigmaAcpSpawnInput,
  currentSigmaModelIdFromSessionSetup,
  resolveSigmaBinaryPath,
  resolveSigmaAcpModelId,
  sigmaModelsFromSessionSetup,
  sigmaReasoningEffortFromSessionSetup,
} from "./SigmaAcpSupport.ts";

describe("SigmaAcpSupport", () => {
  const sessionSetup = {
    sessionId: "sigma-session",
    configOptions: [
      {
        id: "sigma.model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "glm/glm-5.2",
        options: [
          {
            group: "DeepSeek",
            name: "DeepSeek",
            options: [{ value: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
          },
          {
            group: "GLM",
            name: "GLM",
            options: [{ value: "glm/glm-5.2", name: "GLM 5.2" }],
          },
        ],
      },
      {
        id: "sigma.reasoning_effort",
        name: "Reasoning",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "none", name: "None" },
          { value: "minimal", name: "Minimal" },
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra High" },
          { value: "max", name: "Max" },
        ],
      },
    ],
  } satisfies EffectAcpSchema.NewSessionResponse;

  const flatSessionSetup = {
    sessionId: "sigma-flat-session",
    configOptions: [
      {
        id: "sigma.model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "deepseek/deepseek-v4-pro",
        options: [
          { value: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
          { value: "glm/glm-5.2", name: "GLM 5.2" },
        ],
      },
    ],
  } satisfies EffectAcpSchema.NewSessionResponse;

  it("starts the configured binary with the long-lived ACP subcommand", () => {
    expect(buildSigmaAcpSpawnInput({ binaryPath: "/opt/sigma/bin/sigma" }, "/tmp/repo")).toEqual({
      command: "/opt/sigma/bin/sigma",
      args: ["acp"],
      cwd: "/tmp/repo",
    });
    expect(buildSigmaAcpSpawnInput(undefined, "/tmp/repo", { PATH: "/opt/bin" })).toEqual({
      command: "sigma",
      args: ["acp"],
      cwd: "/tmp/repo",
      env: {
        PATH: "/opt/bin",
        NODE_USE_ENV_PROXY: "1",
        NO_PROXY: "localhost,127.0.0.1,::1",
      },
    });
    expect(
      buildSigmaAcpSpawnInput(undefined, "/tmp/repo", undefined, {
        instanceId: ProviderInstanceId.make("sigma"),
        model: "example/unknown-price",
        options: [{ id: "allowUnpricedCosts", value: true }],
      }),
    ).toEqual({
      command: "sigma",
      args: ["acp", "--allow-unpriced-costs"],
      cwd: "/tmp/repo",
    });
  });

  it("scopes the desktop-resolved proxy to OpenAI Codex model sessions", () => {
    const environment = {
      SIGMACODE_SYSTEM_PROXY_URL: "http://127.0.0.1:7890",
    };
    const otherProvider = buildSigmaAcpSpawnInput(undefined, "/tmp/repo", environment, {
      instanceId: ProviderInstanceId.make("sigma"),
      model: "anthropic/claude-test",
    });
    const openAiCodex = buildSigmaAcpSpawnInput(undefined, "/tmp/repo", environment, {
      instanceId: ProviderInstanceId.make("sigma"),
      model: "openai-codex/gpt-test",
    });

    expect(otherProvider.env?.HTTP_PROXY).toBeUndefined();
    expect(otherProvider.env?.HTTPS_PROXY).toBeUndefined();
    expect(openAiCodex.env?.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(openAiCodex.env?.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
  });

  it("prefers an explicit path, then the bundled runtime, then PATH discovery", () => {
    const environment = {
      SIGMACODE_BUNDLED_SIGMA_PATH: "/opt/sigma-code/runtime/bin/sigma",
    };

    expect(resolveSigmaBinaryPath({ binaryPath: "/custom/sigma" }, environment)).toBe(
      "/custom/sigma",
    );
    expect(resolveSigmaBinaryPath({ binaryPath: "sigma" }, environment)).toBe(
      "/opt/sigma-code/runtime/bin/sigma",
    );
    expect(resolveSigmaBinaryPath(undefined, environment)).toBe(
      "/opt/sigma-code/runtime/bin/sigma",
    );
    expect(resolveSigmaBinaryPath({ binaryPath: "sigma" }, {})).toBe("sigma");
  });

  it("normalizes defaults and discovers flat or grouped ACP model options", () => {
    expect(resolveSigmaAcpModelId(undefined)).toBe("openai-codex/gpt-5.6-terra");
    expect(currentSigmaModelIdFromSessionSetup(sessionSetup)).toBe("glm/glm-5.2");
    expect(sigmaModelsFromSessionSetup(sessionSetup)).toEqual([
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "glm/glm-5.2", name: "GLM 5.2" },
    ]);
    expect(sigmaModelsFromSessionSetup(flatSessionSetup)).toEqual([
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "glm/glm-5.2", name: "GLM 5.2" },
    ]);
    expect(sigmaReasoningEffortFromSessionSetup(sessionSetup)).toEqual({
      supportedReasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
      currentReasoningEffort: "medium",
    });
    expect(sigmaReasoningEffortFromSessionSetup(flatSessionSetup)).toEqual({
      supportedReasoningEfforts: [],
      currentReasoningEffort: undefined,
    });
  });

  it.effect("sets the negotiated model and reasoning configs", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const runtime = {
        setModel: (model: string) =>
          Effect.sync(() => {
            calls.push(`model:${model}`);
          }),
        setConfigOption: (configId: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push(`${configId}:${String(value)}`);
            return { configOptions: [] };
          }),
      };

      const switched = yield* applySigmaAcpModelSelection({
        runtime,
        currentModelId: "deepseek/deepseek-v4-pro",
        requestedModelId: "glm/glm-5.2",
        modelSelection: {
          instanceId: ProviderInstanceId.make("sigma"),
          model: "glm/glm-5.2",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        mapError: (cause) => cause,
      });
      const unchanged = yield* applySigmaAcpModelSelection({
        runtime,
        currentModelId: "glm/glm-5.2",
        requestedModelId: "glm/glm-5.2",
        mapError: (cause) => cause,
      });

      expect(switched).toBe("glm/glm-5.2");
      expect(unchanged).toBe("glm/glm-5.2");
      expect(calls).toEqual(["model:glm/glm-5.2", "sigma.reasoning_effort:high"]);
    }),
  );
});

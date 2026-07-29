import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applySigmaAcpModelSelection,
  buildSigmaAcpSpawnInput,
  currentSigmaModelIdFromSessionSetup,
  resolveSigmaBinaryPath,
  resolveSigmaAcpModelId,
  sigmaModelsFromSessionSetup,
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
      env: { PATH: "/opt/bin" },
    });
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
  });

  it.effect("sets the negotiated model config only when it changes", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const runtime = {
        setModel: (model: string) =>
          Effect.sync(() => {
            calls.push(model);
          }),
      };

      const switched = yield* applySigmaAcpModelSelection({
        runtime,
        currentModelId: "deepseek/deepseek-v4-pro",
        requestedModelId: "glm/glm-5.2",
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
      expect(calls).toEqual(["glm/glm-5.2"]);
    }),
  );
});

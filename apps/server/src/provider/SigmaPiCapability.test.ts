import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderAuthCapabilityEvent } from "./ProviderDriver.ts";
import {
  makeSigmaPiAuthCapability,
  readSigmaAuthConnections,
  readSigmaModelCatalog,
} from "./SigmaPiCapability.ts";

type SpawnCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

const AUTH_LIST = JSON.stringify({
  schemaVersion: 1,
  connections: [
    {
      id: "openai-codex",
      name: "OpenAI Codex",
      dynamic: false,
      authMethods: [
        {
          id: "browser",
          label: "Login with ChatGPT",
          kind: "oauth",
          billingMode: "subscription",
        },
      ],
      status: "unauthenticated",
    },
    {
      id: "example-api",
      name: "Example API",
      dynamic: false,
      authMethods: [
        {
          id: "api-key",
          label: "API key",
          kind: "api_key",
          billingMode: "metered",
        },
      ],
      status: "authenticated",
      authType: "api_key",
      source: "Sigma credential store",
    },
  ],
});

const MODEL_LIST = JSON.stringify({
  schemaVersion: 1,
  piVersion: "0.82.1",
  providers: JSON.parse(AUTH_LIST).connections,
  models: [
    {
      provider: "openai-codex",
      id: "gpt-5.6-terra",
      slug: "openai-codex/gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      api: "openai-codex-responses",
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      reasoning: true,
      imageInput: false,
      billingModes: ["subscription"],
      activeBillingMode: null,
      isRecommended: true,
    },
    {
      provider: "example-api",
      id: "unknown-price",
      slug: "example-api/unknown-price",
      name: "Unknown Price",
      api: "openai-completions",
      contextWindowTokens: 32_000,
      maxOutputTokens: 8_000,
      reasoning: false,
      imageInput: false,
      billingModes: ["unpriced"],
      activeBillingMode: "unpriced",
      isRecommended: false,
    },
  ],
});

function makeHandle(stdout: string, stderr = "") {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.encodeText(Stream.make(stdout)),
    stderr: Stream.encodeText(Stream.make(stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function commandOutput(command: SpawnCommand): ReturnType<typeof makeHandle> {
  if (command.args[0] === "auth" && command.args[1] === "list") {
    return makeHandle(AUTH_LIST);
  }
  if (command.args[0] === "models" && command.args[1] === "list") {
    return makeHandle(MODEL_LIST);
  }
  if (command.args[0] === "auth" && command.args[1] === "status") {
    const provider = command.args[2];
    return makeHandle(
      JSON.stringify({
        provider,
        status: "authenticated",
        authType: provider === "openai-codex" ? "oauth" : "api_key",
        source: "Sigma credential store",
      }),
    );
  }
  if (command.args[0] === "auth" && command.args[1] === "login") {
    return makeHandle(
      [
        JSON.stringify({
          type: "input_required",
          promptId: "api-key",
          inputType: "secret",
          message: "Enter the provider API key.",
        }),
        JSON.stringify({ type: "completed", status: "authenticated" }),
      ].join("\n"),
      "diagnostic-that-must-not-surface",
    );
  }
  return makeHandle(JSON.stringify({ type: "completed", status: "unauthenticated" }));
}

describe("SigmaPiCapability", () => {
  it.effect("reads the offline auth and model directories from a trusted Sigma binary", () =>
    Effect.gen(function* () {
      const spawned: SpawnCommand[] = [];
      const spawner = ChildProcessSpawner.make((rawCommand) =>
        Effect.sync(() => {
          const command = rawCommand as unknown as SpawnCommand;
          const captured = { command: command.command, args: [...command.args] };
          spawned.push(captured);
          return commandOutput(captured);
        }),
      );
      const settings = { binaryPath: "sigma-trusted-test" };
      const environment = { ...process.env };
      const connections = yield* readSigmaAuthConnections(settings, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const models = yield* readSigmaModelCatalog(settings, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      expect(connections).toHaveLength(2);
      expect(connections[1]).toMatchObject({
        id: "example-api",
        status: "authenticated",
        authType: "api_key",
        source: "Sigma credential store",
        loginMethods: [
          {
            id: "api-key",
            kind: "api_key",
            billingMode: "metered",
          },
        ],
      });
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        slug: "openai-codex/gpt-5.6-terra",
        authConnectionId: "openai-codex",
        isRecommended: true,
      });
      expect(models[1]).toMatchObject({
        slug: "example-api/unknown-price",
        activeBillingMode: "unpriced",
        capabilities: {
          optionDescriptors: [
            expect.objectContaining({ id: "allowUnpricedCosts", type: "boolean" }),
          ],
        },
      });
      expect(spawned.map(({ command }) => command)).toEqual([
        "sigma-trusted-test",
        "sigma-trusted-test",
      ]);
      expect(spawned.map(({ args }) => args)).toEqual([
        ["auth", "list", "--json"],
        ["models", "list", "--json"],
      ]);
    }),
  );

  it.effect("validates connection and method ids before using fixed authentication arguments", () =>
    Effect.gen(function* () {
      const trustedBinary = "sigma-trusted-test";
      const spawned: SpawnCommand[] = [];
      const spawner = ChildProcessSpawner.make((rawCommand) =>
        Effect.sync(() => {
          const command = rawCommand as unknown as SpawnCommand;
          const captured = { command: command.command, args: [...command.args] };
          spawned.push(captured);
          return commandOutput(captured);
        }),
      );
      const events: ProviderAuthCapabilityEvent[] = [];
      const capability = makeSigmaPiAuthCapability({
        settings: { binaryPath: trustedBinary },
        environment: { ...process.env },
        spawner,
      });

      yield* Effect.scoped(
        capability.login({
          connectionId: "example-api",
          loginMethod: "api-key",
          responses: Stream.empty,
          emit: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        }),
      );
      yield* Effect.scoped(capability.logout("example-api"));

      expect(events).toEqual([
        {
          type: "input_required",
          promptId: "api-key",
          inputType: "secret",
          message: "Enter the provider API key.",
        },
        {
          type: "completed",
          status: "authenticated",
        },
      ]);
      expect(spawned.every(({ command }) => command === trustedBinary)).toBe(true);
      expect(spawned.map(({ args }) => args)).toEqual([
        ["auth", "list", "--json"],
        ["auth", "login", "example-api", "--method", "api-key", "--json"],
        ["auth", "list", "--json"],
        ["auth", "status", "example-api", "--json"],
        ["auth", "list", "--json"],
        ["auth", "logout", "example-api", "--json"],
      ]);
      expect(
        events.some((event) => Object.values(event).includes("diagnostic-that-must-not-surface")),
      ).toBe(false);
    }),
  );

  it.effect("rejects connection or method values that are absent from the runtime directory", () =>
    Effect.gen(function* () {
      const spawned: SpawnCommand[] = [];
      const spawner = ChildProcessSpawner.make((rawCommand) =>
        Effect.sync(() => {
          const command = rawCommand as unknown as SpawnCommand;
          const captured = { command: command.command, args: [...command.args] };
          spawned.push(captured);
          return commandOutput(captured);
        }),
      );
      const capability = makeSigmaPiAuthCapability({
        settings: { binaryPath: "sigma-trusted-test" },
        environment: { ...process.env },
        spawner,
      });
      const result = yield* Effect.scoped(
        capability.login({
          connectionId: "example-api",
          loginMethod: "--arbitrary-command",
          responses: Stream.empty,
          emit: () => Effect.void,
        }),
      ).pipe(Effect.exit);

      expect(result._tag).toBe("Failure");
      expect(spawned.map(({ args }) => args)).toEqual([["auth", "list", "--json"]]);
    }),
  );
});

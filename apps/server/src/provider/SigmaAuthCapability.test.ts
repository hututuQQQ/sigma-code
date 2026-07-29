import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderAuthCapabilityEvent } from "./ProviderDriver.ts";
import { makeSigmaAuthCapability, readSigmaCodexAuthConnection } from "./SigmaAuthCapability.ts";

type SpawnCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

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

describe("SigmaAuthCapability", () => {
  it.effect("uses only the trusted Sigma binary and fixed auth arguments", () =>
    Effect.gen(function* () {
      const trustedBinary = "sigma-trusted-test";
      const spawned: SpawnCommand[] = [];
      const spawner = ChildProcessSpawner.make((rawCommand) =>
        Effect.sync(() => {
          const command = rawCommand as unknown as SpawnCommand;
          spawned.push({ command: command.command, args: [...command.args] });
          if (command.args[0] === "auth" && command.args[1] === "status") {
            return makeHandle(
              '{"provider":"openai-codex","status":"authenticated","email":"person@example.test"}',
            );
          }
          if (command.args[0] === "auth" && command.args[1] === "login") {
            return makeHandle(
              [
                '{"type":"auth_url","url":"https://example.test/oauth?one-time=secret"}',
                '{"type":"input_required","promptId":"manual-code","inputType":"manual_code","message":"Paste the authorization code."}',
                '{"type":"completed","status":"authenticated","email":"person@example.test"}',
              ].join("\n"),
              "stderr-secret-that-must-not-surface",
            );
          }
          return makeHandle('{"provider":"openai-codex","status":"unauthenticated"}');
        }),
      );
      const settings = { binaryPath: trustedBinary };
      const environment = { ...process.env };

      const connection = yield* readSigmaCodexAuthConnection(settings, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      expect(connection.status).toBe("authenticated");
      expect(connection.email).toBe("person@example.test");

      const events: ProviderAuthCapabilityEvent[] = [];
      const capability = makeSigmaAuthCapability({ settings, environment, spawner });
      yield* Effect.scoped(
        capability.login({
          connectionId: "openai-codex",
          loginMethod: "browser",
          responses: Stream.empty,
          emit: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        }),
      );
      yield* Effect.scoped(capability.logout("openai-codex"));

      expect(spawned).toHaveLength(3);
      expect(spawned.map((command) => command.command)).toEqual([
        trustedBinary,
        trustedBinary,
        trustedBinary,
      ]);
      expect(spawned.map((command) => command.args)).toEqual([
        ["auth", "status", "openai-codex", "--json"],
        ["auth", "login", "openai-codex", "--method", "browser", "--json"],
        ["auth", "logout", "openai-codex", "--json"],
      ]);
      expect(events.map((event) => event.type)).toEqual([
        "auth_url",
        "input_required",
        "completed",
      ]);
      expect(events[1]).toMatchObject({
        type: "input_required",
        inputType: "manual_code",
        promptId: "manual-code",
      });
      expect(
        events.some((event) =>
          Object.values(event).includes("stderr-secret-that-must-not-surface"),
        ),
      ).toBe(false);
    }),
  );

  it.effect("rejects non-HTTPS authentication URLs before they reach the desktop", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          makeHandle('{"type":"auth_url","url":"file:///C:/Windows/System32/calc.exe"}'),
        ),
      );
      const events: ProviderAuthCapabilityEvent[] = [];
      const capability = makeSigmaAuthCapability({
        settings: { binaryPath: "sigma-trusted-test" },
        environment: { ...process.env },
        spawner,
      });

      const result = yield* Effect.scoped(
        capability.login({
          connectionId: "openai-codex",
          loginMethod: "browser",
          responses: Stream.empty,
          emit: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        }),
      ).pipe(Effect.exit);

      expect(result._tag).toBe("Failure");
      expect(events).toEqual([
        {
          type: "error",
          code: "protocol",
          message: "Sigma returned an invalid authentication protocol event.",
          retryable: false,
        },
      ]);
    }),
  );
});

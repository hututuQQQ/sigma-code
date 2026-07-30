import {
  ProviderAuthRpcError,
  type ServerProviderAuthConnection,
  type SigmaSettings,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderAuthCapability, ProviderAuthCapabilityEvent } from "./ProviderDriver.ts";
import { collectStreamAsString } from "./providerSnapshot.ts";
import { resolveSigmaBinaryPath } from "./acp/SigmaAcpSupport.ts";

export const SIGMA_CODEX_AUTH_CONNECTION_ID = "openai-codex";

const AuthStatusOutput = Schema.Struct({
  provider: Schema.Literal(SIGMA_CODEX_AUTH_CONNECTION_ID),
  status: Schema.Literals(["authenticated", "unauthenticated"]),
  email: Schema.optional(Schema.String),
});
const decodeAuthStatusOutput = Schema.decodeUnknownOption(Schema.fromJsonString(AuthStatusOutput));

const CliInputOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const CliAuthEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("auth_url"),
    url: Schema.String,
    instructions: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("device_code"),
    userCode: Schema.String,
    verificationUri: Schema.String,
    intervalSeconds: Schema.optional(Schema.Number),
    expiresInSeconds: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal("progress"),
    message: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("input_required"),
    promptId: Schema.String,
    inputType: Schema.Literals(["text", "secret", "select", "manual_code"]),
    message: Schema.String,
    placeholder: Schema.optional(Schema.String),
    options: Schema.optional(Schema.Array(CliInputOption)),
  }),
  Schema.Struct({
    type: Schema.Literal("completed"),
    status: Schema.Literal("authenticated"),
    email: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }),
]);
const decodeCliAuthEvent = Schema.decodeUnknownOption(Schema.fromJsonString(CliAuthEvent));
const encodeCliInput = Schema.encodeSync(Schema.UnknownFromJsonString);

function safeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 2_000) : undefined;
}

function safeExternalAuthUrl(value: string | undefined): string | undefined {
  const trimmed = safeText(value);
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCliEvent(
  event: typeof CliAuthEvent.Type,
): ProviderAuthCapabilityEvent | undefined {
  switch (event.type) {
    case "auth_url": {
      const url = safeExternalAuthUrl(event.url);
      const instructions = safeText(event.instructions);
      if (!url) return undefined;
      return {
        type: "auth_url",
        url,
        ...(instructions ? { instructions } : {}),
      };
    }
    case "device_code": {
      const userCode = safeText(event.userCode);
      const verificationUri = safeExternalAuthUrl(event.verificationUri);
      if (!userCode || !verificationUri) return undefined;
      return {
        type: "device_code",
        userCode,
        verificationUri,
        ...(event.intervalSeconds && event.intervalSeconds > 0
          ? { intervalSeconds: Math.floor(event.intervalSeconds) }
          : {}),
        ...(event.expiresInSeconds && event.expiresInSeconds > 0
          ? { expiresInSeconds: Math.floor(event.expiresInSeconds) }
          : {}),
      };
    }
    case "progress": {
      const message = safeText(event.message);
      return message ? { type: "progress", message } : undefined;
    }
    case "input_required": {
      const promptId = safeText(event.promptId);
      const message = safeText(event.message);
      const placeholder = safeText(event.placeholder);
      if (!promptId || !message) return undefined;
      return {
        type: "input_required",
        promptId,
        inputType: event.inputType,
        message,
        ...(placeholder ? { placeholder } : {}),
        ...(event.options
          ? {
              options: event.options.flatMap((option) => {
                const id = safeText(option.id);
                const label = safeText(option.label);
                return id && label ? [{ id, label }] : [];
              }),
            }
          : {}),
      };
    }
    case "completed": {
      const email = safeText(event.email);
      return {
        type: "completed",
        status: "authenticated",
        ...(email ? { email } : {}),
      };
    }
    case "error": {
      const code = safeText(event.code) ?? "protocol";
      return {
        type: "error",
        code,
        message:
          code === "auth_required"
            ? "ChatGPT returned to Sigma, but the login could not be finalized. Check the Runtime proxy or network settings and start a new login."
            : (safeText(event.message) ?? "Authentication failed."),
        retryable: event.retryable,
      };
    }
  }
}

function parseCliLine(line: string): ProviderAuthCapabilityEvent | undefined {
  const decoded = decodeCliAuthEvent(line);
  return Option.isSome(decoded) ? normalizeCliEvent(decoded.value) : undefined;
}

function connectionFromStatus(
  status: "authenticated" | "unauthenticated" | "unknown",
  email?: string,
): ServerProviderAuthConnection {
  return {
    id: SIGMA_CODEX_AUTH_CONNECTION_ID,
    label: "ChatGPT Subscription",
    status,
    ...(safeText(email) ? { email: safeText(email) } : {}),
    loginMethods: ["browser", "device-code"],
    scope: "host",
    actions: status === "authenticated" ? ["logout"] : ["login"],
    experimental: true,
  };
}

export function makePendingSigmaCodexAuthConnection(): ServerProviderAuthConnection {
  return connectionFromStatus("unknown");
}

const runCollected = Effect.fn("SigmaAuthCapability.runCollected")(function* (
  settings: Pick<SigmaSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const binaryPath = resolveSigmaBinaryPath(settings, environment);
  const spawnCommand = yield* resolveSpawnCommand(binaryPath, args, { env: environment });
  const child = yield* spawner.spawn(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
      stderr: "pipe",
      stdout: "pipe",
    }),
  );
  const [stdout, , exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      child.stderr.pipe(Stream.runDrain),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  return { stdout, exitCode };
});

export const readSigmaCodexAuthConnection = Effect.fn(
  "SigmaAuthCapability.readSigmaCodexAuthConnection",
)(function* (
  settings: Pick<SigmaSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderAuthConnection, never, ChildProcessSpawner.ChildProcessSpawner> {
  const result = yield* runCollected(settings, environment, [
    "auth",
    "status",
    SIGMA_CODEX_AUTH_CONNECTION_ID,
    "--json",
  ]).pipe(Effect.scoped, Effect.timeoutOption(4_000), Effect.result);
  if (
    result._tag === "Failure" ||
    Option.isNone(result.success) ||
    result.success.value.exitCode !== 0
  ) {
    return connectionFromStatus("unknown");
  }
  const decoded = decodeAuthStatusOutput(result.success.value.stdout);
  return Option.isSome(decoded)
    ? connectionFromStatus(decoded.value.status, decoded.value.email)
    : connectionFromStatus("unknown");
});

function unsupportedConnection(): ProviderAuthRpcError {
  return new ProviderAuthRpcError({
    code: "connection_not_found",
    message: "This provider does not expose the requested authentication connection.",
  });
}

export function makeSigmaAuthCapability(input: {
  readonly settings: Pick<SigmaSettings, "binaryPath">;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): ProviderAuthCapability {
  const runLogin: ProviderAuthCapability["login"] = (operation) =>
    Effect.gen(function* () {
      if (operation.connectionId !== SIGMA_CODEX_AUTH_CONNECTION_ID) {
        return yield* unsupportedConnection();
      }
      const binaryPath = resolveSigmaBinaryPath(input.settings, input.environment);
      const args = [
        "auth",
        "login",
        SIGMA_CODEX_AUTH_CONNECTION_ID,
        "--method",
        operation.loginMethod,
        "--json",
      ];
      const spawnCommand = yield* resolveSpawnCommand(binaryPath, args, {
        env: input.environment,
      });
      const child = yield* input.spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: input.environment,
          shell: spawnCommand.shell,
          stderr: "pipe",
          stdout: "pipe",
        }),
      );

      yield* operation.responses.pipe(
        Stream.map((message) => `${encodeCliInput(message)}\n`),
        Stream.encodeText,
        Stream.run(child.stdin),
        Effect.forkScoped,
      );

      let completedEvent:
        | Extract<ProviderAuthCapabilityEvent, { readonly type: "completed" }>
        | undefined;
      const consumeStdout = child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.map((line) => line.trim()),
        Stream.filter((line) => line.length > 0),
        Stream.runForEach((line) => {
          const event = parseCliLine(line);
          return event
            ? event.type === "completed"
              ? Effect.sync(() => {
                  completedEvent = event;
                })
              : operation.emit(event)
            : operation
                .emit({
                  type: "error",
                  code: "protocol",
                  message: "Sigma returned an invalid authentication protocol event.",
                  retryable: false,
                })
                .pipe(
                  Effect.andThen(
                    Effect.fail(
                      new ProviderAuthRpcError({
                        code: "process_failed",
                        message: "Invalid Sigma authentication protocol event.",
                      }),
                    ),
                  ),
                );
        }),
      );
      const [, , exitCode] = yield* Effect.all(
        [
          consumeStdout,
          child.stderr.pipe(Stream.runDrain),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      );
      if (exitCode !== 0) {
        return;
      }
      if (!completedEvent) {
        return;
      }
      const verifiedConnection = yield* readSigmaCodexAuthConnection(
        input.settings,
        input.environment,
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner));
      if (verifiedConnection.status !== "authenticated") {
        yield* operation.emit({
          type: "error",
          code: "credential_not_persisted",
          message:
            "ChatGPT returned to Sigma, but the credentials were not saved. Check the Runtime proxy or network settings and start a new login.",
          retryable: true,
        });
        return;
      }
      yield* operation.emit({
        ...completedEvent,
        ...(verifiedConnection.email ? { email: verifiedConnection.email } : {}),
      });
    }).pipe(
      Effect.mapError(
        () =>
          new ProviderAuthRpcError({
            code: "process_failed",
            message: "Sigma could not run the ChatGPT authentication command.",
          }),
      ),
    );

  const logout: ProviderAuthCapability["logout"] = (connectionId) =>
    Effect.gen(function* () {
      if (connectionId !== SIGMA_CODEX_AUTH_CONNECTION_ID) {
        return yield* unsupportedConnection();
      }
      const result = yield* runCollected(input.settings, input.environment, [
        "auth",
        "logout",
        SIGMA_CODEX_AUTH_CONNECTION_ID,
        "--json",
      ]).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
        Effect.scoped,
        Effect.mapError(
          () =>
            new ProviderAuthRpcError({
              code: "process_failed",
              message: "Sigma could not run the ChatGPT logout command.",
            }),
        ),
      );
      if (result.exitCode !== 0) {
        return yield* new ProviderAuthRpcError({
          code: "process_failed",
          message: "Sigma could not complete ChatGPT logout.",
        });
      }
    });

  return {
    scopeKey: (connectionId) =>
      connectionId === SIGMA_CODEX_AUTH_CONNECTION_ID
        ? `host:${SIGMA_CODEX_AUTH_CONNECTION_ID}`
        : undefined,
    login: runLogin,
    logout,
  };
}

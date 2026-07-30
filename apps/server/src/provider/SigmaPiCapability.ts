import {
  ProviderAuthRpcError,
  type ServerProviderAuthConnection,
  type ServerProviderModel,
  type SigmaSettings,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderAuthCapability, ProviderAuthCapabilityEvent } from "./ProviderDriver.ts";
import { collectStreamAsString } from "./providerSnapshot.ts";
import { resolveSigmaBinaryPath } from "./acp/SigmaAcpSupport.ts";
import { resolveSigmaProcessEnvironment } from "./SigmaProxyEnvironment.ts";

export const SIGMA_CODEX_AUTH_CONNECTION_ID = "openai-codex";

const BillingMode = Schema.Literals(["metered", "subscription", "unpriced"]);
const AuthKind = Schema.Literals(["api_key", "oauth"]);
const CliAuthMethod = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: AuthKind,
  billingMode: BillingMode,
});
const CliAuthConnection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  dynamic: Schema.Boolean,
  authMethods: Schema.Array(CliAuthMethod),
  status: Schema.Literals(["authenticated", "unauthenticated"]),
  authType: Schema.optional(AuthKind),
  source: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
});
const CliAuthListOutput = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  connections: Schema.Array(CliAuthConnection),
});
const decodeAuthListOutput = Schema.decodeUnknownOption(Schema.fromJsonString(CliAuthListOutput));

const CliAuthStatusOutput = Schema.Struct({
  provider: Schema.String,
  status: Schema.Literals(["authenticated", "unauthenticated"]),
  authType: Schema.optional(AuthKind),
  source: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
});
const decodeAuthStatusOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(CliAuthStatusOutput),
);

const CliModel = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  api: Schema.String,
  contextWindowTokens: Schema.Number,
  maxOutputTokens: Schema.Number,
  reasoning: Schema.Boolean,
  imageInput: Schema.Boolean,
  billingModes: Schema.Array(BillingMode),
  activeBillingMode: Schema.NullOr(BillingMode),
  isRecommended: Schema.Boolean,
});
const CliModelsListOutput = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  piVersion: Schema.String,
  providers: Schema.Array(CliAuthConnection),
  models: Schema.Array(CliModel),
});
const decodeModelsListOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(CliModelsListOutput),
);

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

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const UNPRICED_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "allowUnpricedCosts",
      label: "Allow unknown monetary cost for this task",
      description: "Required before Sigma can send this task to a model whose price is unknown.",
      type: "boolean",
    },
  ],
});

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
      return { type: "auth_url", url, ...(instructions ? { instructions } : {}) };
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
            ? "The provider returned to Sigma, but authentication could not be finalized. Start a new login."
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

function connectionFromCli(
  connection: typeof CliAuthConnection.Type,
): ServerProviderAuthConnection {
  const id = safeText(connection.id) ?? connection.id;
  const label = safeText(connection.name) ?? id;
  const email = safeText(connection.email);
  const source = safeText(connection.source);
  const loginMethods = connection.authMethods.flatMap((method) => {
    const methodId = safeText(method.id);
    const methodLabel = safeText(method.label);
    return methodId && methodLabel
      ? [
          {
            id: methodId,
            label: methodLabel,
            kind: method.kind,
            billingMode: method.billingMode,
          },
        ]
      : [];
  });
  return {
    id,
    label,
    status: connection.status,
    ...(email ? { email } : {}),
    ...(connection.authType ? { authType: connection.authType } : {}),
    ...(source ? { source } : {}),
    loginMethods,
    scope: "host",
    actions:
      connection.status === "authenticated"
        ? loginMethods.length > 0
          ? ["login", "logout"]
          : ["logout"]
        : loginMethods.length > 0
          ? ["login"]
          : [],
    ...(id === SIGMA_CODEX_AUTH_CONNECTION_ID ? { experimental: true } : {}),
  };
}

export function makePendingSigmaAuthConnections(): ReadonlyArray<ServerProviderAuthConnection> {
  return [
    {
      id: SIGMA_CODEX_AUTH_CONNECTION_ID,
      label: "OpenAI Codex",
      status: "unknown",
      loginMethods: [
        {
          id: "browser",
          label: "Login with ChatGPT",
          kind: "oauth",
          billingMode: "subscription",
        },
        {
          id: "device-code",
          label: "Use device code",
          kind: "oauth",
          billingMode: "subscription",
        },
      ],
      scope: "host",
      actions: ["login"],
      experimental: true,
    },
  ];
}

const runCollected = Effect.fn("SigmaPiCapability.runCollected")(function* (
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

export const readSigmaAuthConnections = Effect.fn("SigmaPiCapability.readSigmaAuthConnections")(
  function* (
    settings: Pick<SigmaSettings, "binaryPath">,
    environment: NodeJS.ProcessEnv,
  ): Effect.fn.Return<
    ReadonlyArray<ServerProviderAuthConnection>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    const result = yield* runCollected(settings, environment, ["auth", "list", "--json"]).pipe(
      Effect.scoped,
      Effect.timeoutOption(4_000),
      Effect.result,
    );
    if (
      result._tag === "Failure" ||
      Option.isNone(result.success) ||
      result.success.value.exitCode !== 0
    ) {
      return makePendingSigmaAuthConnections();
    }
    const decoded = decodeAuthListOutput(result.success.value.stdout);
    return Option.isSome(decoded)
      ? decoded.value.connections.map(connectionFromCli)
      : makePendingSigmaAuthConnections();
  },
);

export const readSigmaProviderAuthConnection = Effect.fn(
  "SigmaPiCapability.readSigmaProviderAuthConnection",
)(function* (
  settings: Pick<SigmaSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
  providerId: string,
): Effect.fn.Return<
  ServerProviderAuthConnection | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const directory = yield* readSigmaAuthConnections(settings, environment);
  const descriptor = directory.find((connection) => connection.id === providerId);
  if (!descriptor) return undefined;
  const result = yield* runCollected(settings, environment, [
    "auth",
    "status",
    providerId,
    "--json",
  ]).pipe(Effect.scoped, Effect.timeoutOption(4_000), Effect.result);
  if (
    result._tag === "Failure" ||
    Option.isNone(result.success) ||
    result.success.value.exitCode !== 0
  ) {
    return undefined;
  }
  const decoded = decodeAuthStatusOutput(result.success.value.stdout);
  if (Option.isNone(decoded) || decoded.value.provider !== providerId) return undefined;
  return {
    ...descriptor,
    status: decoded.value.status,
    ...(safeText(decoded.value.email) ? { email: safeText(decoded.value.email) } : {}),
    ...(decoded.value.authType ? { authType: decoded.value.authType } : {}),
    ...(safeText(decoded.value.source) ? { source: safeText(decoded.value.source) } : {}),
  };
});

export const readSigmaModelCatalog = Effect.fn("SigmaPiCapability.readSigmaModelCatalog")(
  function* (
    settings: Pick<SigmaSettings, "binaryPath">,
    environment: NodeJS.ProcessEnv,
  ): Effect.fn.Return<
    ReadonlyArray<ServerProviderModel>,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > {
    const result = yield* runCollected(settings, environment, ["models", "list", "--json"]).pipe(
      Effect.scoped,
      Effect.timeoutOption(8_000),
      Effect.result,
    );
    if (
      result._tag === "Failure" ||
      Option.isNone(result.success) ||
      result.success.value.exitCode !== 0
    ) {
      return [];
    }
    const decoded = decodeModelsListOutput(result.success.value.stdout);
    if (Option.isNone(decoded)) return [];
    return decoded.value.models.map((model): ServerProviderModel => {
      const requiresUnpricedConfirmation =
        model.activeBillingMode === "unpriced" ||
        (model.activeBillingMode === null &&
          model.billingModes.length === 1 &&
          model.billingModes[0] === "unpriced");
      return {
        slug: model.slug,
        name: model.name,
        subProvider: model.provider,
        isCustom: false,
        ...(model.slug === "openai-codex/gpt-5.6-terra" ? { isDefault: true } : {}),
        authConnectionId: model.provider,
        billingModes: model.billingModes,
        ...(model.activeBillingMode ? { activeBillingMode: model.activeBillingMode } : {}),
        ...(model.isRecommended ? { isRecommended: true } : {}),
        capabilities: requiresUnpricedConfirmation ? UNPRICED_CAPABILITIES : EMPTY_CAPABILITIES,
      };
    });
  },
);

function unsupportedConnection(): ProviderAuthRpcError {
  return new ProviderAuthRpcError({
    code: "connection_not_found",
    message: "This provider does not expose the requested authentication connection.",
  });
}

function safeConnectionId(connectionId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(connectionId);
}

function findLoginMethod(
  connections: ReadonlyArray<ServerProviderAuthConnection>,
  connectionId: string,
  methodId: string,
) {
  return connections
    .find((connection) => connection.id === connectionId)
    ?.loginMethods.find((method) => method.id === methodId);
}

export function makeSigmaPiAuthCapability(input: {
  readonly settings: Pick<SigmaSettings, "binaryPath">;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): ProviderAuthCapability {
  const directoryEnvironment = resolveSigmaProcessEnvironment(input.environment);
  const environmentForConnection = (connectionId: string) =>
    resolveSigmaProcessEnvironment(input.environment, {
      useDesktopSystemProxy: connectionId === SIGMA_CODEX_AUTH_CONNECTION_ID,
    });
  const directory = readSigmaAuthConnections(input.settings, directoryEnvironment).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
  );

  const runLogin: ProviderAuthCapability["login"] = (operation) =>
    Effect.gen(function* () {
      const connections = yield* directory;
      if (!findLoginMethod(connections, operation.connectionId, operation.loginMethod)) {
        return yield* unsupportedConnection();
      }
      const commandEnvironment = environmentForConnection(operation.connectionId);
      const binaryPath = resolveSigmaBinaryPath(input.settings, commandEnvironment);
      const args = [
        "auth",
        "login",
        operation.connectionId,
        "--method",
        operation.loginMethod,
        "--json",
      ];
      const spawnCommand = yield* resolveSpawnCommand(binaryPath, args, {
        env: commandEnvironment,
      });
      const child = yield* input.spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: commandEnvironment,
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
      if (exitCode !== 0 || !completedEvent) return;
      const verifiedConnection = yield* readSigmaProviderAuthConnection(
        input.settings,
        directoryEnvironment,
        operation.connectionId,
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner));
      if (verifiedConnection?.status !== "authenticated") {
        yield* operation.emit({
          type: "error",
          code: "credential_not_persisted",
          message:
            "The provider login completed, but Sigma could not verify the saved credential. Start a new login.",
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
            message: "Sigma could not run the provider authentication command.",
          }),
      ),
    );

  const logout: ProviderAuthCapability["logout"] = (connectionId) =>
    Effect.gen(function* () {
      const connections = yield* directory;
      if (!connections.some((connection) => connection.id === connectionId)) {
        return yield* unsupportedConnection();
      }
      const result = yield* runCollected(input.settings, environmentForConnection(connectionId), [
        "auth",
        "logout",
        connectionId,
        "--json",
      ]).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
        Effect.scoped,
        Effect.mapError(
          () =>
            new ProviderAuthRpcError({
              code: "process_failed",
              message: "Sigma could not run the provider logout command.",
            }),
        ),
      );
      if (result.exitCode !== 0) {
        return yield* new ProviderAuthRpcError({
          code: "process_failed",
          message: "Sigma could not complete provider logout.",
        });
      }
    });

  return {
    scopeKey: (connectionId) =>
      safeConnectionId(connectionId) ? `host:${connectionId}` : undefined,
    login: runLogin,
    logout,
  };
}

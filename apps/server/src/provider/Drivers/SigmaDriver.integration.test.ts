// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  SigmaSettings,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { BUNDLED_SIGMA_BINARY_ENV } from "../acp/SigmaAcpSupport.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { SigmaDriver } from "./SigmaDriver.ts";

const decodeSigmaSettings = Schema.decodeSync(SigmaSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockSigmaBinary(
  requestLogPath: string,
  platform: NodeJS.Platform,
): Promise<{
  readonly directory: string;
  readonly binaryPath: string;
}> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sigma-driver-mock-"));
  if (platform === "win32") {
    const binaryPath = NodePath.join(directory, "sigma.cmd");
    const script = [
      "@echo off",
      'if "%~1"=="--version" (',
      "  echo Sigma Code 0.1.0-test",
      "  exit /b 0",
      ")",
      `set "T3_ACP_REQUEST_LOG_PATH=${requestLogPath}"`,
      'set "T3_ACP_EMIT_TOOL_CALLS=1"',
      'set "SIGMACODE_ACP_EMIT_THOUGHT=1"',
      'set "SIGMACODE_ACP_EMIT_PLAN=1"',
      'set "SIGMACODE_ACP_HANG_PROMPT_TEXT=cancel me"',
      `"${process.execPath}" "${mockAgentPath}" %*`,
      "",
    ].join("\r\n");
    await NodeFSP.writeFile(binaryPath, script, "utf8");
    return { directory, binaryPath };
  }

  const binaryPath = NodePath.join(directory, "sigma");
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    '  echo "Sigma Code 0.1.0-test"',
    "  exit 0",
    "fi",
    `export T3_ACP_REQUEST_LOG_PATH=${JSON.stringify(requestLogPath)}`,
    "export T3_ACP_EMIT_TOOL_CALLS=1",
    "export SIGMACODE_ACP_EMIT_THOUGHT=1",
    "export SIGMACODE_ACP_EMIT_PLAN=1",
    'export SIGMACODE_ACP_HANG_PROMPT_TEXT="cancel me"',
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"`,
    "",
  ].join("\n");
  await NodeFSP.writeFile(binaryPath, script, "utf8");
  await NodeFSP.chmod(binaryPath, 0o755);
  return { directory, binaryPath };
}

function waitForEvent(
  events: ReadonlyArray<ProviderRuntimeEvent>,
  predicate: (event: ProviderRuntimeEvent) => boolean,
  description: string,
  afterIndex = 0,
): Effect.Effect<ProviderRuntimeEvent> {
  const poll = (attempts: number): Effect.Effect<ProviderRuntimeEvent> =>
    Effect.gen(function* () {
      const event = events.slice(afterIndex).find(predicate);
      if (event) return event;
      if (attempts <= 0) {
        return yield* Effect.die(new Error(`Timed out waiting for ${description}.`));
      }
      yield* Effect.promise(() => NodeTimersPromises.setTimeout(20));
      return yield* poll(attempts - 1);
    });
  return poll(250);
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "sigma-driver-integration-",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
);

describe("SigmaDriver integration", () => {
  it.layer(testLayer)("runs Sigma ACP through the reusable provider orchestration", (it) => {
    it.effect(
      "streams reasoning, plans and tools with approval, steering, cancellation and resume",
      () =>
        Effect.gen(function* () {
          const requestLogPath = NodePath.join(
            yield* Effect.promise(() =>
              NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sigma-driver-request-log-")),
            ),
            "requests.ndjson",
          );
          const platform = yield* HostProcessPlatform;
          const mock = yield* Effect.promise(() => makeMockSigmaBinary(requestLogPath, platform));
          yield* Effect.addFinalizer(() =>
            Effect.promise(() =>
              Promise.all([
                NodeFSP.rm(mock.directory, { recursive: true, force: true }),
                NodeFSP.rm(NodePath.dirname(requestLogPath), { recursive: true, force: true }),
              ]).then(() => undefined),
            ),
          );

          const instanceId = ProviderInstanceId.make("sigma");
          const instance = yield* SigmaDriver.create({
            instanceId,
            displayName: "Sigma",
            accentColor: "#3157c8",
            environment: [],
            enabled: true,
            config: decodeSigmaSettings({
              binaryPath: mock.binaryPath,
              customModels: ["composer-2"],
            }),
          });
          assert.strictEqual(instance.driverKind, ProviderDriverKind.make("sigma"));
          assert.strictEqual(instance.adapter.provider, ProviderDriverKind.make("sigma"));
          assert.strictEqual(instance.adapter.capabilities.sessionModelSwitch, "unsupported");

          const providerSnapshot = yield* instance.snapshot.refresh;
          assert.strictEqual(providerSnapshot.status, "ready");
          assert.strictEqual(providerSnapshot.installed, true);
          assert.strictEqual(providerSnapshot.version, "0.1.0");
          assert.isAbove(providerSnapshot.models.length, 0);

          const threadId = ThreadId.make("sigma-driver-contract-thread");
          const events: ProviderRuntimeEvent[] = [];
          const eventsFiber = yield* Stream.runForEach(instance.adapter.streamEvents, (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ).pipe(Effect.forkChild);

          const session = yield* instance.adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make("sigma"),
            providerInstanceId: instanceId,
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            modelSelection: { instanceId, model: "composer-2" },
          });
          assert.strictEqual(session.provider, ProviderDriverKind.make("sigma"));
          assert.strictEqual(session.model, "composer-2");
          assert.deepEqual(session.resumeCursor, {
            schemaVersion: 1,
            sessionId: "mock-session-1",
          });

          const firstTurn = yield* instance.adapter
            .sendTurn({
              threadId,
              input: "exercise Sigma ACP",
              attachments: [],
              interactionMode: "plan",
            })
            .pipe(Effect.forkChild);
          const firstRequest = yield* waitForEvent(
            events,
            (event) => event.type === "request.opened",
            "Sigma tool approval",
          );
          assert.strictEqual(firstRequest.provider, ProviderDriverKind.make("sigma"));
          yield* instance.adapter.respondToRequest(
            threadId,
            ApprovalRequestId.make(String(firstRequest.requestId)),
            "accept",
          );
          yield* Fiber.join(firstTurn);
          yield* waitForEvent(events, (event) => event.type === "turn.completed", "first turn");

          assert.isTrue(
            events.some(
              (event) =>
                event.type === "content.delta" &&
                event.payload.streamKind === "assistant_text" &&
                event.payload.delta.includes("hello from mock"),
            ),
          );
          assert.isTrue(
            events.some(
              (event) =>
                event.type === "content.delta" &&
                event.payload.streamKind === "reasoning_text" &&
                event.payload.delta.includes("inspecting from Sigma mock"),
            ),
          );
          assert.isTrue(events.some((event) => event.type === "turn.plan.updated"));
          assert.isTrue(events.some((event) => event.type === "item.updated"));
          assert.isTrue(events.some((event) => event.type === "item.completed"));

          const beforeDeniedTurn = events.length;
          const deniedTurn = yield* instance.adapter
            .sendTurn({ threadId, input: "deny this tool", attachments: [] })
            .pipe(Effect.forkChild);
          const deniedRequest = yield* waitForEvent(
            events,
            (event) => event.type === "request.opened",
            "second Sigma tool approval",
            beforeDeniedTurn,
          );
          yield* instance.adapter.respondToRequest(
            threadId,
            ApprovalRequestId.make(String(deniedRequest.requestId)),
            "decline",
          );
          yield* Fiber.join(deniedTurn);
          assert.isTrue(
            events
              .slice(beforeDeniedTurn)
              .some(
                (event) =>
                  event.type === "request.resolved" && event.payload.decision === "decline",
              ),
          );

          const beforeCancelledTurn = events.length;
          const cancelledTurnFiber = yield* instance.adapter
            .sendTurn({ threadId, input: "cancel me", attachments: [] })
            .pipe(Effect.forkChild);
          const cancelledTurnStarted = yield* waitForEvent(
            events,
            (event) => event.type === "turn.started",
            "cancellable Sigma turn",
            beforeCancelledTurn,
          );
          const steering = yield* instance.adapter.sendTurn({
            threadId,
            input: "steer while running",
            attachments: [],
          });
          assert.strictEqual(steering.turnId, cancelledTurnStarted.turnId);
          yield* instance.adapter.interruptTurn(threadId, cancelledTurnStarted.turnId);
          yield* Fiber.join(cancelledTurnFiber);
          assert.isTrue(
            events
              .slice(beforeCancelledTurn)
              .some(
                (event) =>
                  event.type === "turn.completed" &&
                  (event.payload.state === "interrupted" || event.payload.state === "cancelled"),
              ),
          );

          const resumeCursor = session.resumeCursor;
          yield* instance.adapter.stopSession(threadId);
          const resumed = yield* instance.adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make("sigma"),
            providerInstanceId: instanceId,
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            modelSelection: { instanceId, model: "composer-2" },
            resumeCursor,
          });
          assert.deepEqual(resumed.resumeCursor, resumeCursor);

          const requestLog = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
          assert.include(requestLog, '"method":"session/set_mode"');
          assert.include(requestLog, '"method":"session/set_config_option"');
          assert.include(requestLog, '"value":"composer-2"');
          assert.include(requestLog, '"method":"_sigma/steer"');
          assert.include(requestLog, '"method":"session/load"');
          assert.include(requestLog, '"method":"_sigma/health"');
          assert.include(requestLog, '"method":"session/close"');

          yield* instance.adapter.stopSession(threadId);
          yield* Fiber.interrupt(eventsFiber);
        }),
    );

    it.effect("uses the bundled Runtime when the provider has its default binary setting", () =>
      Effect.gen(function* () {
        const requestLogDir = yield* Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sigma-driver-bundled-request-log-")),
        );
        const requestLogPath = NodePath.join(requestLogDir, "requests.ndjson");
        const platform = yield* HostProcessPlatform;
        const mock = yield* Effect.promise(() => makeMockSigmaBinary(requestLogPath, platform));
        yield* Effect.addFinalizer(() =>
          Effect.promise(() =>
            Promise.all([
              NodeFSP.rm(mock.directory, { recursive: true, force: true }),
              NodeFSP.rm(requestLogDir, { recursive: true, force: true }),
            ]).then(() => undefined),
          ),
        );

        const instance = yield* SigmaDriver.create({
          instanceId: ProviderInstanceId.make("sigma-bundled"),
          displayName: "Sigma",
          accentColor: "#3157c8",
          environment: [
            {
              name: BUNDLED_SIGMA_BINARY_ENV,
              value: mock.binaryPath,
              sensitive: false,
            },
          ],
          enabled: true,
          config: decodeSigmaSettings({}),
        });
        const providerSnapshot = yield* instance.snapshot.refresh;

        assert.strictEqual(providerSnapshot.status, "ready");
        assert.strictEqual(providerSnapshot.installed, true);
        assert.strictEqual(providerSnapshot.version, "0.1.0");
        const requestLog = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
        assert.include(requestLog, '"method":"_sigma/health"');
        const createSessionRequest = requestLog
          .split(/\r?\n/u)
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                readonly method?: unknown;
                readonly params?: { readonly cwd?: unknown };
              },
          )
          .find((request) => request.method === "session/new");
        const probeCwd =
          typeof createSessionRequest?.params?.cwd === "string"
            ? createSessionRequest.params.cwd
            : "";
        assert.match(NodePath.basename(probeCwd), /^sigma-code-provider-probe-/u);
        const relativeToTemp = NodePath.relative(NodeOS.tmpdir(), probeCwd);
        assert.isFalse(relativeToTemp.startsWith("..") || NodePath.isAbsolute(relativeToTemp));
      }),
    );
  });
});

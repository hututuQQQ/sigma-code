import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthOperationEvent,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ProviderAuthCapability, ProviderInstance } from "../ProviderDriver.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "./ProviderInstanceRegistry.ts";
import { ProviderAuthOperations, layer } from "./ProviderAuthOperations.ts";

function fakeInstance(auth: ProviderAuthCapability): ProviderInstance {
  return {
    instanceId: ProviderInstanceId.make("sigma"),
    driverKind: ProviderDriverKind.make("sigma"),
    continuationIdentity: {
      driverKind: ProviderDriverKind.make("sigma"),
      continuationKey: "sigma:test",
    },
    displayName: "Sigma",
    enabled: true,
    auth,
    snapshot: {
      refresh: Effect.succeed({}),
    },
  } as unknown as ProviderInstance;
}

function operationLayer(instance: ProviderInstance) {
  const registry: ProviderInstanceRegistryShape = {
    getInstance: (instanceId) =>
      Effect.succeed(instanceId === instance.instanceId ? instance : undefined),
    listInstances: Effect.succeed([instance]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("not used"),
  };
  return layer.pipe(
    Layer.provide(Layer.succeed(ProviderInstanceRegistry, registry)),
    Layer.provide(NodeServices.layer),
  );
}

describe("ProviderAuthOperations", () => {
  it.layer(
    Layer.unwrap(
      Effect.sync(() => {
        const auth: ProviderAuthCapability = {
          scopeKey: (connectionId) =>
            connectionId === "openai-codex" ? "host:openai-codex" : undefined,
          login: (input) =>
            Effect.gen(function* () {
              yield* input.emit({
                type: "auth_url",
                url: "https://example.test/oauth?one-time=secret",
              });
              yield* input.emit({
                type: "input_required",
                promptId: "manual-code",
                inputType: "manual_code",
                message: "Paste the authorization code.",
              });
              const response = Option.getOrUndefined(yield* input.responses.pipe(Stream.runHead));
              if (response?.type !== "input_response" || response.value !== "1234") {
                return yield* Effect.die("missing auth response");
              }
              yield* input.emit({
                type: "completed",
                status: "authenticated",
                email: "person@example.test",
              });
            }),
          logout: () => Effect.void,
        };
        return operationLayer(fakeInstance(auth));
      }),
    ),
  )("replays initial events, accepts prompt input, and completes", (it) => {
    it.effect("runs an operation without persisting prompt responses", () =>
      Effect.gen(function* () {
        const operations = yield* ProviderAuthOperations;
        const result = yield* operations.start({
          instanceId: ProviderInstanceId.make("sigma"),
          connectionId: "openai-codex",
          loginMethod: "browser",
        });
        const initial = yield* operations
          .subscribe(result.operationId)
          .pipe(Stream.take(2), Stream.runCollect);

        yield* operations.respond({
          operationId: result.operationId,
          promptId: "manual-code",
          value: "1234",
        });
        const remainder = yield* operations.subscribe(result.operationId).pipe(Stream.runCollect);
        const initialEvents = Array.from(initial);
        const lastInitialSequence = initialEvents.at(-1)?.sequence ?? -1;
        const events: ProviderAuthOperationEvent[] = [
          ...initialEvents,
          ...Array.from(remainder).filter((event) => event.sequence > lastInitialSequence),
        ];

        assert.deepEqual(
          events.map((event) => event.type),
          ["auth_url", "input_required", "completed"],
        );
        assert.strictEqual(
          events[2]?.type === "completed" ? events[2].email : undefined,
          "person@example.test",
        );
        assert.isFalse(events.some((event) => Object.values(event).includes("1234")));
      }),
    );
  });

  it.effect("serializes a shared account scope and cancels without fallback work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const operations = yield* ProviderAuthOperations;
        const first = yield* operations.start({
          instanceId: ProviderInstanceId.make("sigma"),
          connectionId: "openai-codex",
          loginMethod: "browser",
        });
        const second = yield* operations
          .start({
            instanceId: ProviderInstanceId.make("sigma"),
            connectionId: "openai-codex",
            loginMethod: "device-code",
          })
          .pipe(Effect.flip);
        assert.strictEqual(second.code, "already_running");

        yield* operations.cancel({ operationId: first.operationId });
        const terminal = Option.getOrUndefined(
          yield* operations.subscribe(first.operationId).pipe(Stream.runLast),
        );
        assert.strictEqual(terminal?.type === "error" ? terminal.code : undefined, "cancelled");
      }),
    ).pipe(
      Effect.provide(
        operationLayer(
          fakeInstance({
            scopeKey: () => "host:openai-codex",
            login: (input) => input.responses.pipe(Stream.runDrain),
            logout: () => Effect.void,
          }),
        ),
      ),
    ),
  );

  it.effect("keeps event sequence monotonic after the one-time auth URL is consumed", () =>
    Effect.gen(function* () {
      const urlPublished = yield* Deferred.make<void>();
      const continueLogin = yield* Deferred.make<void>();
      const auth: ProviderAuthCapability = {
        scopeKey: () => "host:openai-codex",
        login: (input) =>
          Effect.gen(function* () {
            yield* input.emit({
              type: "auth_url",
              url: "https://example.test/oauth?one-time=secret",
            });
            yield* Deferred.succeed(urlPublished, undefined);
            yield* Deferred.await(continueLogin);
            yield* input.emit({
              type: "input_required",
              promptId: "manual-code",
              inputType: "manual_code",
              message: "Paste the authorization code.",
            });
            yield* input.emit({ type: "completed", status: "authenticated" });
          }),
        logout: () => Effect.void,
      };
      const program = Effect.gen(function* () {
        const operations = yield* ProviderAuthOperations;
        const result = yield* operations.start({
          instanceId: ProviderInstanceId.make("sigma"),
          connectionId: "openai-codex",
          loginMethod: "browser",
        });
        yield* Deferred.await(urlPublished);
        const first = yield* operations
          .subscribe(result.operationId)
          .pipe(Stream.take(1), Stream.runCollect);
        yield* Deferred.succeed(continueLogin, undefined);
        const rest = yield* operations.subscribe(result.operationId).pipe(Stream.runCollect);

        assert.deepEqual(
          [...first, ...rest].map((event) => [event.sequence, event.type]),
          [
            [0, "auth_url"],
            [1, "input_required"],
            [2, "completed"],
          ],
        );
      });
      return yield* program.pipe(Effect.provide(operationLayer(fakeInstance(auth))));
    }),
  );
});

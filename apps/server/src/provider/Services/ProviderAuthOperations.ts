import {
  type ProviderAuthOperationId,
  ProviderAuthRpcError,
  type ProviderAuthCancelInput,
  type ProviderAuthLogoutInput,
  type ProviderAuthOperationEvent,
  type ProviderAuthRespondInput,
  type ProviderAuthStartInput,
  type ProviderAuthStartResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type {
  ProviderAuthCapabilityEvent,
  ProviderAuthCapabilityInput,
  ProviderInstance,
} from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./ProviderInstanceRegistry.ts";

interface AuthOperation {
  readonly operationId: ProviderAuthOperationId;
  readonly instance: ProviderInstance;
  readonly connectionId: string;
  readonly scopeKey: string;
  readonly responses: Queue.Queue<ProviderAuthCapabilityInput>;
  readonly events: Ref.Ref<ReadonlyArray<ProviderAuthOperationEvent>>;
  readonly nextSequence: Ref.Ref<number>;
  readonly changes: PubSub.PubSub<ProviderAuthOperationEvent>;
  readonly terminal: Ref.Ref<boolean>;
  readonly respondedPrompts: Ref.Ref<ReadonlySet<string>>;
  readonly fiber: Ref.Ref<Fiber.Fiber<void, never> | null>;
  readonly lock: Semaphore.Semaphore;
}

export interface ProviderAuthOperationsShape {
  readonly start: (
    input: ProviderAuthStartInput,
  ) => Effect.Effect<ProviderAuthStartResult, ProviderAuthRpcError>;
  readonly respond: (input: ProviderAuthRespondInput) => Effect.Effect<void, ProviderAuthRpcError>;
  readonly cancel: (input: ProviderAuthCancelInput) => Effect.Effect<void, ProviderAuthRpcError>;
  readonly logout: (input: ProviderAuthLogoutInput) => Effect.Effect<void, ProviderAuthRpcError>;
  readonly subscribe: (
    operationId: ProviderAuthOperationId,
  ) => Stream.Stream<ProviderAuthOperationEvent, ProviderAuthRpcError>;
}

export class ProviderAuthOperations extends Context.Service<
  ProviderAuthOperations,
  ProviderAuthOperationsShape
>()("t3/provider/Services/ProviderAuthOperations") {}

function rpcError(code: ProviderAuthRpcError["code"], message: string): ProviderAuthRpcError {
  return new ProviderAuthRpcError({ code, message });
}

function isTerminalEvent(event: ProviderAuthCapabilityEvent | ProviderAuthOperationEvent): boolean {
  return event.type === "completed" || event.type === "error";
}

function isEphemeralUrlEvent(event: ProviderAuthOperationEvent): boolean {
  return event.type === "auth_url" || event.type === "device_code";
}

const makeOperation = Effect.fn("ProviderAuthOperations.makeOperation")(function* (input: {
  readonly operationId: ProviderAuthOperationId;
  readonly instance: ProviderInstance;
  readonly connectionId: string;
  readonly scopeKey: string;
}) {
  return {
    ...input,
    responses: yield* Queue.unbounded<ProviderAuthCapabilityInput>(),
    events: yield* Ref.make<ReadonlyArray<ProviderAuthOperationEvent>>([]),
    nextSequence: yield* Ref.make(0),
    changes: yield* PubSub.unbounded<ProviderAuthOperationEvent>(),
    terminal: yield* Ref.make(false),
    respondedPrompts: yield* Ref.make<ReadonlySet<string>>(new Set()),
    fiber: yield* Ref.make<Fiber.Fiber<void, never> | null>(null),
    lock: yield* Semaphore.make(1),
  } satisfies AuthOperation;
});

const publishOperationEvent = Effect.fn("ProviderAuthOperations.publishEvent")(function* (
  operation: AuthOperation,
  payload: ProviderAuthCapabilityEvent,
) {
  yield* operation.lock.withPermits(1)(
    Effect.gen(function* () {
      if (yield* Ref.get(operation.terminal)) return;
      const existing = yield* Ref.get(operation.events);
      const sequence = yield* Ref.getAndUpdate(operation.nextSequence, (value) => value + 1);
      const event = {
        ...payload,
        operationId: operation.operationId,
        sequence,
      } as ProviderAuthOperationEvent;
      yield* Ref.set(operation.events, [...existing.slice(-127), event]);
      if (isTerminalEvent(event)) {
        yield* Ref.set(operation.terminal, true);
      }
      yield* PubSub.publish(operation.changes, event);
    }),
  );
});

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;
  const crypto = yield* Crypto.Crypto;
  const lifetimeScope = yield* Scope.Scope;
  const operations = yield* Ref.make<ReadonlyMap<ProviderAuthOperationId, AuthOperation>>(
    new Map(),
  );
  const activeScopes = yield* Ref.make<ReadonlyMap<string, ProviderAuthOperationId>>(new Map());
  const mutationLock = yield* Semaphore.make(1);

  const getOperation = (operationId: ProviderAuthOperationId) =>
    Ref.get(operations).pipe(
      Effect.flatMap((current) => {
        const operation = current.get(operationId);
        return operation
          ? Effect.succeed(operation)
          : Effect.fail(
              rpcError("operation_not_found", "The authentication operation is no longer active."),
            );
      }),
    );

  const resolveCapability = (instanceId: ProviderAuthStartInput["instanceId"]) =>
    registry.getInstance(instanceId).pipe(
      Effect.flatMap((instance) => {
        if (!instance) {
          return Effect.fail(
            rpcError("instance_not_found", "The selected provider instance is not available."),
          );
        }
        if (!instance.auth) {
          return Effect.fail(
            rpcError("unsupported", "The selected provider does not support interactive login."),
          );
        }
        return Effect.succeed({ instance, capability: instance.auth });
      }),
    );

  const releaseScope = (scopeKey: string, operationId: ProviderAuthOperationId) =>
    mutationLock.withPermits(1)(
      Ref.update(activeScopes, (current) => {
        if (current.get(scopeKey) !== operationId) return current;
        const next = new Map(current);
        next.delete(scopeKey);
        return next;
      }),
    );

  const scheduleRemoval = (operationId: ProviderAuthOperationId) =>
    Effect.forkIn(
      Effect.sleep("5 minutes").pipe(
        Effect.andThen(
          Ref.update(operations, (current) => {
            const next = new Map(current);
            next.delete(operationId);
            return next;
          }),
        ),
      ),
      lifetimeScope,
    ).pipe(Effect.asVoid);

  const start: ProviderAuthOperationsShape["start"] = (input) =>
    mutationLock.withPermits(1)(
      Effect.gen(function* () {
        const { instance, capability } = yield* resolveCapability(input.instanceId);
        const scopeKey = capability.scopeKey(input.connectionId);
        if (!scopeKey) {
          return yield* rpcError(
            "connection_not_found",
            "The selected authentication connection is not available.",
          );
        }
        const active = yield* Ref.get(activeScopes);
        if (active.has(scopeKey)) {
          return yield* rpcError(
            "already_running",
            "A login for this shared ChatGPT account is already in progress.",
          );
        }

        const operationId: ProviderAuthOperationId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
        const operation = yield* makeOperation({
          operationId,
          instance,
          connectionId: input.connectionId,
          scopeKey,
        });
        yield* Ref.update(operations, (current) => {
          const next = new Map(current);
          next.set(operationId, operation);
          return next;
        });
        yield* Ref.update(activeScopes, (current) => {
          const next = new Map(current);
          next.set(scopeKey, operationId);
          return next;
        });

        const loginProgram = Effect.scoped(
          capability.login({
            connectionId: input.connectionId,
            loginMethod: input.loginMethod,
            responses: Stream.fromQueue(operation.responses),
            emit: (event) => publishOperationEvent(operation, event),
          }),
        ).pipe(
          Effect.catch((error) =>
            publishOperationEvent(operation, {
              type: "error",
              code: error.code,
              message: error.message,
              retryable: false,
            }),
          ),
          Effect.andThen(
            Effect.gen(function* () {
              if (!(yield* Ref.get(operation.terminal))) {
                yield* publishOperationEvent(operation, {
                  type: "error",
                  code: "process_failed",
                  message: "The authentication process ended without a result.",
                  retryable: false,
                });
              }
              const events = yield* Ref.get(operation.events);
              if (events.some((event) => event.type === "completed")) {
                yield* operation.instance.snapshot.refresh.pipe(Effect.ignore);
              }
            }),
          ),
          Effect.ensuring(
            Effect.all(
              [
                releaseScope(operation.scopeKey, operation.operationId),
                Queue.shutdown(operation.responses),
                scheduleRemoval(operation.operationId),
              ],
              { discard: true },
            ),
          ),
          Effect.ignore,
        );
        const fiber = yield* Effect.forkIn(loginProgram, lifetimeScope);
        yield* Ref.set(operation.fiber, fiber);
        return { operationId };
      }),
    );

  const respond: ProviderAuthOperationsShape["respond"] = (input) =>
    Effect.gen(function* () {
      const operation = yield* getOperation(input.operationId);
      yield* operation.lock.withPermits(1)(
        Effect.gen(function* () {
          if (yield* Ref.get(operation.terminal)) {
            return yield* rpcError(
              "operation_not_found",
              "The authentication operation has already finished.",
            );
          }
          const events = yield* Ref.get(operation.events);
          const requested = events.some(
            (event) => event.type === "input_required" && event.promptId === input.promptId,
          );
          const responded = yield* Ref.get(operation.respondedPrompts);
          if (!requested || responded.has(input.promptId)) {
            return yield* rpcError(
              "invalid_input",
              "The authentication prompt is no longer awaiting a response.",
            );
          }
          yield* Ref.set(operation.respondedPrompts, new Set([...responded, input.promptId]));
          yield* Queue.offer(operation.responses, {
            type: "input_response",
            promptId: input.promptId,
            value: input.value,
          });
        }),
      );
    });

  const cancel: ProviderAuthOperationsShape["cancel"] = (input) =>
    Effect.gen(function* () {
      const operation = yield* getOperation(input.operationId);
      if (yield* Ref.get(operation.terminal)) return;
      yield* Queue.offer(operation.responses, { type: "cancel" });
      yield* publishOperationEvent(operation, {
        type: "error",
        code: "cancelled",
        message: "Authentication was cancelled.",
        retryable: false,
      });
      const fiber = yield* Ref.get(operation.fiber);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
    });

  const logout: ProviderAuthOperationsShape["logout"] = (input) =>
    mutationLock.withPermits(1)(
      Effect.gen(function* () {
        const { capability } = yield* resolveCapability(input.instanceId);
        const scopeKey = capability.scopeKey(input.connectionId);
        if (!scopeKey) {
          return yield* rpcError(
            "connection_not_found",
            "The selected authentication connection is not available.",
          );
        }
        if ((yield* Ref.get(activeScopes)).has(scopeKey)) {
          return yield* rpcError(
            "already_running",
            "Cancel the active ChatGPT login before signing out.",
          );
        }
        yield* capability.logout(input.connectionId).pipe(Effect.scoped);
      }),
    );

  const subscribe: ProviderAuthOperationsShape["subscribe"] = (operationId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const operation = yield* getOperation(operationId);
        const subscription = yield* PubSub.subscribe(operation.changes);
        const snapshot = yield* Ref.get(operation.events);
        if (snapshot.some(isEphemeralUrlEvent)) {
          yield* Ref.update(operation.events, (events) =>
            events.filter((event) => !isEphemeralUrlEvent(event)),
          );
        }
        if (snapshot.some(isTerminalEvent)) {
          return Stream.fromIterable(snapshot);
        }
        const lastSequence = snapshot[snapshot.length - 1]?.sequence ?? -1;
        return Stream.concat(
          Stream.fromIterable(snapshot),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.sequence > lastSequence),
            Stream.tap((event) =>
              isEphemeralUrlEvent(event)
                ? Ref.update(operation.events, (events) =>
                    events.filter((candidate) => candidate.sequence !== event.sequence),
                  )
                : Effect.void,
            ),
            Stream.takeUntil(isTerminalEvent),
          ),
        );
      }),
    );

  return { start, respond, cancel, logout, subscribe } satisfies ProviderAuthOperationsShape;
});

export const layer = Layer.effect(ProviderAuthOperations, make);

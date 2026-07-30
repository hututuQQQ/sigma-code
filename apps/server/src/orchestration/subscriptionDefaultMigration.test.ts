import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
  EventId,
  type OrchestrationCommand,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./Services/OrchestrationEngine.ts";
import {
  isSubscriptionDefaultMigrationTargetAvailable,
  migrateSubscriptionDefaults,
  planSubscriptionDefaultMigration,
} from "./subscriptionDefaultMigration.ts";

const occurredAt = "2026-07-29T00:00:00.000Z";

function event(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: string;
  readonly commandId?: string;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.make(input.aggregateId)
        : ThreadId.make(input.aggregateId),
    occurredAt,
    commandId: input.commandId ? CommandId.make(input.commandId) : null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

function legacyProject(sequence = 1): OrchestrationEvent {
  return event({
    sequence,
    type: "project.created",
    aggregateKind: "project",
    aggregateId: "project-1",
    payload: {
      projectId: ProjectId.make("project-1"),
      title: "workspace",
      workspaceRoot: "C:\\code\\workspace",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      },
      scripts: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  });
}

function blankWelcomeThread(sequence = 2): OrchestrationEvent {
  return event({
    sequence,
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: "thread-1",
    payload: {
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "New thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  });
}

function sigmaProvider(status: ServerProvider["status"] = "ready"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("sigma"),
    driver: ProviderDriverKind.make("sigma"),
    enabled: true,
    installed: status !== "error",
    version: "1.0.0",
    status,
    auth: { status: "unknown" },
    checkedAt: occurredAt,
    models: [
      {
        slug: DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
        name: "GPT Terra",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
    authConnections: [],
  };
}

describe("subscription default migration", () => {
  it("migrates only an untouched auto-shaped project and blank welcome thread", () => {
    expect(planSubscriptionDefaultMigration([legacyProject(), blankWelcomeThread()])).toEqual({
      projectIds: [ProjectId.make("project-1")],
      threadIds: [ThreadId.make("thread-1")],
    });
  });

  it("preserves a started task and an explicitly changed model", () => {
    const started = event({
      sequence: 3,
      type: "thread.message-sent",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      payload: {
        threadId: ThreadId.make("thread-1"),
        messageId: "message-1",
        role: "user",
        text: "start",
        turnId: null,
        streaming: false,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    });
    expect(
      planSubscriptionDefaultMigration([legacyProject(), blankWelcomeThread(), started]),
    ).toEqual({ projectIds: [], threadIds: [] });

    const changed = event({
      sequence: 3,
      type: "thread.meta-updated",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      commandId: "user-model-change",
      payload: {
        threadId: ThreadId.make("thread-1"),
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        updatedAt: occurredAt,
      },
    });
    expect(
      planSubscriptionDefaultMigration([legacyProject(), blankWelcomeThread(), changed]),
    ).toEqual({ projectIds: [], threadIds: [] });
  });

  it("resumes safely when only the project half was migrated before a restart", () => {
    const migratedProject = event({
      sequence: 3,
      type: "project.meta-updated",
      aggregateKind: "project",
      aggregateId: "project-1",
      commandId: "sigma-subscription-default-v1:project:project-1",
      payload: {
        projectId: ProjectId.make("project-1"),
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("sigma"),
          model: DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
        },
        updatedAt: occurredAt,
      },
    });
    expect(
      planSubscriptionDefaultMigration([legacyProject(), blankWelcomeThread(), migratedProject]),
    ).toEqual({
      projectIds: [],
      threadIds: [ThreadId.make("thread-1")],
    });
  });

  it("requires a ready Sigma instance that exposes the subscription model", () => {
    expect(isSubscriptionDefaultMigrationTargetAvailable([sigmaProvider()])).toBe(true);
    expect(isSubscriptionDefaultMigrationTargetAvailable([sigmaProvider("error")])).toBe(false);
    expect(
      isSubscriptionDefaultMigrationTargetAvailable([
        {
          ...sigmaProvider(),
          models: [],
        },
      ]),
    ).toBe(false);
  });

  it.effect("waits for the target and records completion before a second scan", () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const engine: OrchestrationEngineShape = {
        readEvents: () => Stream.fromIterable([legacyProject(), blankWelcomeThread()]),
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(2),
      };
      const testLayer = Layer.mergeAll(
        SqlitePersistenceMemory,
        Layer.succeed(OrchestrationEngineService, engine),
      );

      yield* Effect.gen(function* () {
        const unavailable = yield* migrateSubscriptionDefaults([sigmaProvider("error")]);
        expect(unavailable.status).toBe("target-unavailable");
        expect(dispatched).toHaveLength(0);

        const migrated = yield* migrateSubscriptionDefaults([sigmaProvider()]);
        expect(migrated).toMatchObject({
          status: "completed",
          migratedProjects: 1,
          migratedThreads: 1,
        });
        expect(dispatched).toHaveLength(2);

        const repeated = yield* migrateSubscriptionDefaults([sigmaProvider()]);
        expect(repeated.status).toBe("already-completed");
        expect(dispatched).toHaveLength(2);
      }).pipe(Effect.provide(testLayer));
    }),
  );
});

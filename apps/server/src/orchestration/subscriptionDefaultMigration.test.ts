import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planSubscriptionDefaultMigration } from "./subscriptionDefaultMigration.ts";

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
});

import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
  type OrchestrationEvent,
  type ProjectId,
  ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

const LEGACY_AUTO_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
} as const;
const SUBSCRIPTION_SELECTION = {
  instanceId: ProviderInstanceId.make("sigma"),
  model: DEFAULT_SIGMA_SUBSCRIPTION_MODEL,
} as const;
const MIGRATION_COMMAND_PREFIX = "sigma-subscription-default-v1";

export interface SubscriptionDefaultMigrationPlan {
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly threadIds: ReadonlyArray<ThreadId>;
}

interface ProjectCandidate {
  readonly projectId: ProjectId;
  readonly automaticallyNamed: boolean;
  readonly initiallyUsedLegacyDefault: boolean;
  migrated: boolean;
  disqualified: boolean;
}

interface ThreadCandidate {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly initiallyUsedLegacyDefault: boolean;
  readonly initiallyBlankWelcome: boolean;
  migrated: boolean;
  disqualified: boolean;
}

function projectMigrationCommandId(projectId: ProjectId): CommandId {
  return CommandId.make(`${MIGRATION_COMMAND_PREFIX}:project:${projectId}`);
}

function threadMigrationCommandId(threadId: ThreadId): CommandId {
  return CommandId.make(`${MIGRATION_COMMAND_PREFIX}:thread:${threadId}`);
}

function sameSelection(
  selection:
    | {
        readonly instanceId: string;
        readonly model: string;
      }
    | null
    | undefined,
  expected: {
    readonly instanceId: string;
    readonly model: string;
  },
): boolean {
  return selection?.instanceId === expected.instanceId && selection.model === expected.model;
}

function workspaceBasename(workspaceRoot: string): string {
  const segments = workspaceRoot.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? workspaceRoot;
}

function isProjectMigrationEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "project.meta-updated" &&
    event.commandId === projectMigrationCommandId(event.payload.projectId) &&
    sameSelection(event.payload.defaultModelSelection, SUBSCRIPTION_SELECTION)
  );
}

function isThreadMigrationEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "thread.meta-updated" &&
    event.commandId === threadMigrationCommandId(event.payload.threadId) &&
    sameSelection(event.payload.modelSelection, SUBSCRIPTION_SELECTION)
  );
}

/**
 * Produces a deliberately conservative migration plan from durable history.
 *
 * There was no explicit provenance bit on legacy auto-written defaults, so
 * the only records safe to migrate are auto-shaped project/welcome-thread
 * pairs whose model has never been changed and whose thread has never begun.
 */
export function planSubscriptionDefaultMigration(
  events: ReadonlyArray<OrchestrationEvent>,
): SubscriptionDefaultMigrationPlan {
  const projects = new Map<ProjectId, ProjectCandidate>();
  const threads = new Map<ThreadId, ThreadCandidate>();

  for (const event of events) {
    switch (event.type) {
      case "project.created": {
        projects.set(event.payload.projectId, {
          projectId: event.payload.projectId,
          automaticallyNamed:
            event.payload.title === workspaceBasename(event.payload.workspaceRoot),
          initiallyUsedLegacyDefault: sameSelection(
            event.payload.defaultModelSelection,
            LEGACY_AUTO_SELECTION,
          ),
          migrated: false,
          disqualified: false,
        });
        break;
      }
      case "project.meta-updated": {
        const candidate = projects.get(event.payload.projectId);
        if (!candidate || event.payload.defaultModelSelection === undefined) break;
        if (isProjectMigrationEvent(event)) {
          candidate.migrated = true;
        } else {
          candidate.disqualified = true;
        }
        break;
      }
      case "project.deleted": {
        const candidate = projects.get(event.payload.projectId);
        if (candidate) candidate.disqualified = true;
        break;
      }
      case "thread.created": {
        threads.set(event.payload.threadId, {
          threadId: event.payload.threadId,
          projectId: event.payload.projectId,
          initiallyUsedLegacyDefault: sameSelection(
            event.payload.modelSelection,
            LEGACY_AUTO_SELECTION,
          ),
          initiallyBlankWelcome: event.payload.title === "New thread",
          migrated: false,
          disqualified: false,
        });
        break;
      }
      default: {
        if (event.aggregateKind !== "thread") break;
        const candidate = threads.get(event.aggregateId as ThreadId);
        if (!candidate) break;
        if (isThreadMigrationEvent(event)) {
          candidate.migrated = true;
        } else {
          // Any other durable event means the welcome task was changed,
          // started, archived, or otherwise acted on.
          candidate.disqualified = true;
        }
      }
    }
  }

  const projectIds: ProjectId[] = [];
  const threadIds: ThreadId[] = [];
  for (const project of projects.values()) {
    if (
      project.disqualified ||
      !project.automaticallyNamed ||
      !project.initiallyUsedLegacyDefault
    ) {
      continue;
    }
    const blankWelcomeThreads = [...threads.values()].filter(
      (thread) =>
        thread.projectId === project.projectId &&
        thread.initiallyUsedLegacyDefault &&
        thread.initiallyBlankWelcome &&
        !thread.disqualified,
    );
    if (blankWelcomeThreads.length === 0) continue;
    if (!project.migrated) projectIds.push(project.projectId);
    for (const thread of blankWelcomeThreads) {
      if (!thread.migrated) threadIds.push(thread.threadId);
    }
  }

  return { projectIds, threadIds };
}

export const migrateSubscriptionDefaults = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const events = yield* engine.readEvents(0, Number.MAX_SAFE_INTEGER).pipe(Stream.runCollect);
  const plan = planSubscriptionDefaultMigration(Array.from(events));

  for (const projectId of plan.projectIds) {
    yield* engine.dispatch({
      type: "project.meta.update",
      commandId: projectMigrationCommandId(projectId),
      projectId,
      defaultModelSelection: SUBSCRIPTION_SELECTION,
    });
  }
  for (const threadId of plan.threadIds) {
    yield* engine.dispatch({
      type: "thread.meta.update",
      commandId: threadMigrationCommandId(threadId),
      threadId,
      modelSelection: SUBSCRIPTION_SELECTION,
    });
  }

  return {
    migratedProjects: plan.projectIds.length,
    migratedThreads: plan.threadIds.length,
  };
});

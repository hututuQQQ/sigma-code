import {
  type RuntimeEventRawSource,
  RuntimeItemId,
  type CanonicalRequestType,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeTaskId,
  type RuntimeRequestId,
  type ThreadId,
  type ToolLifecycleItemType,
  type TurnId,
} from "@t3tools/contracts";

import type {
  AcpPermissionRequest,
  AcpPlanUpdate,
  AcpSigmaRuntimeEvent,
  AcpToolCallState,
} from "./AcpRuntimeModel.ts";
import type { AcpUsageUpdate } from "./AcpRuntimeModel.ts";

type AcpAdapterRawSource = Extract<
  RuntimeEventRawSource,
  "acp.jsonrpc" | `acp.${string}.extension`
>;

interface AcpEventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

type AcpCanonicalRequestType = Extract<
  CanonicalRequestType,
  "exec_command_approval" | "file_read_approval" | "file_change_approval" | "unknown"
>;

function canonicalRequestTypeFromAcpKind(kind: string | "unknown"): AcpCanonicalRequestType {
  switch (kind) {
    case "execute":
      return "exec_command_approval";
    case "read":
      return "file_read_approval";
    case "edit":
    case "delete":
    case "move":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function canonicalItemTypeFromAcpToolKind(kind: string | undefined): ToolLifecycleItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    case "search":
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function runtimeItemStatusFromAcpToolStatus(
  status: AcpToolCallState["status"],
): "inProgress" | "completed" | "failed" | undefined {
  switch (status) {
    case "pending":
    case "inProgress":
      return "inProgress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

export function makeAcpRequestOpenedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly requestId: RuntimeRequestId;
  readonly permissionRequest: AcpPermissionRequest;
  readonly detail: string;
  readonly args: unknown;
  readonly source: AcpAdapterRawSource;
  readonly method: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "request.opened",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    requestId: input.requestId,
    payload: {
      requestType: canonicalRequestTypeFromAcpKind(input.permissionRequest.kind),
      detail: input.detail,
      args: input.args,
    },
    raw: {
      source: input.source,
      method: input.method,
      payload: input.rawPayload,
    },
  };
}

export function makeAcpRequestResolvedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly requestId: RuntimeRequestId;
  readonly permissionRequest: AcpPermissionRequest;
  readonly decision: ProviderApprovalDecision;
}): ProviderRuntimeEvent {
  return {
    type: "request.resolved",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    requestId: input.requestId,
    payload: {
      requestType: canonicalRequestTypeFromAcpKind(input.permissionRequest.kind),
      decision: input.decision,
    },
  };
}

export function makeAcpPlanUpdatedEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly payload: AcpPlanUpdate;
  readonly source: AcpAdapterRawSource;
  readonly method: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "turn.plan.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: input.payload,
    raw: {
      source: input.source,
      method: input.method,
      payload: input.rawPayload,
    },
  };
}

export function makeAcpToolCallEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly toolCall: AcpToolCallState;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  const runtimeStatus = runtimeItemStatusFromAcpToolStatus(input.toolCall.status);
  return {
    type:
      input.toolCall.status === "completed" || input.toolCall.status === "failed"
        ? "item.completed"
        : "item.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.toolCall.toolCallId),
    payload: {
      itemType: canonicalItemTypeFromAcpToolKind(input.toolCall.kind),
      ...(runtimeStatus ? { status: runtimeStatus } : {}),
      ...(input.toolCall.title ? { title: input.toolCall.title } : {}),
      ...(input.toolCall.detail ? { detail: input.toolCall.detail } : {}),
      ...(Object.keys(input.toolCall.data).length > 0 ? { data: input.toolCall.data } : {}),
    },
    raw: {
      source: "acp.jsonrpc",
      method: "session/update",
      payload: input.rawPayload,
    },
  };
}

export function makeAcpAssistantItemEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId: string;
  readonly lifecycle: "item.started" | "item.completed";
}): ProviderRuntimeEvent {
  return {
    type: input.lifecycle,
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    itemId: RuntimeItemId.make(input.itemId),
    payload: {
      itemType: "assistant_message",
      status: input.lifecycle === "item.completed" ? "completed" : "inProgress",
    },
  };
}

export function makeAcpContentDeltaEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly itemId?: string;
  readonly streamKind: "assistant_text" | "reasoning_text";
  readonly text: string;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "content.delta",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
    payload: {
      streamKind: input.streamKind,
      delta: input.text,
    },
    raw: {
      source: "acp.jsonrpc",
      method: "session/update",
      payload: input.rawPayload,
    },
  };
}

export function makeAcpTokenUsageEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly usage: AcpUsageUpdate;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent {
  return {
    type: "thread.token-usage.updated",
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    payload: { usage: input.usage },
    raw: {
      source: "acp.jsonrpc",
      method: "session/update",
      payload: input.rawPayload,
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function nestedText(value: unknown, key: string): string | undefined {
  return text(record(value)[key]);
}

export function makeAcpSigmaRuntimeEvent(input: {
  readonly stamp: AcpEventStamp;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | undefined;
  readonly event: AcpSigmaRuntimeEvent;
  readonly rawPayload: unknown;
}): ProviderRuntimeEvent | undefined {
  const raw = {
    source: "acp.sigma.extension" as const,
    method: "session/update",
    payload: input.rawPayload,
  };
  const base = {
    ...input.stamp,
    provider: input.provider,
    threadId: input.threadId,
    turnId: input.turnId,
    raw,
  };
  const payload = input.event.payload;
  if (input.event.eventType.startsWith("child.")) {
    const childId = text(payload.childId);
    if (!childId) return undefined;
    const detail = record(payload.payload);
    const taskId = RuntimeTaskId.make(childId);
    if (input.event.eventType === "child.spawned") {
      return {
        type: "task.started",
        ...base,
        payload: {
          taskId,
          ...(text(detail.instruction) ? { description: text(detail.instruction) } : {}),
          ...(text(detail.intent) ? { taskType: text(detail.intent) } : {}),
        },
      };
    }
    if (input.event.eventType === "child.message") {
      const description =
        text(detail.message) ?? text(detail.summary) ?? text(detail.kind) ?? "Agent progress";
      return {
        type: "task.progress",
        ...base,
        payload: {
          taskId,
          description,
          ...(text(detail.summary) ? { summary: text(detail.summary) } : {}),
          ...(text(detail.lastToolName) ? { lastToolName: text(detail.lastToolName) } : {}),
          ...(detail.usage !== undefined ? { usage: detail.usage } : {}),
        },
      };
    }
    const status =
      detail.status === "completed"
        ? ("completed" as const)
        : detail.status === "cancelled"
          ? ("stopped" as const)
          : ("failed" as const);
    const summary =
      text(detail.error) ??
      nestedText(detail.outcome, "message") ??
      nestedText(detail.report, "summary");
    return {
      type: "task.completed",
      ...base,
      payload: {
        taskId,
        status,
        ...(summary ? { summary } : {}),
        ...(detail.report !== undefined ? { usage: record(detail.report).budgetConsumed } : {}),
      },
    };
  }
  if (input.event.eventType.startsWith("hook.")) {
    const hookId = text(payload.hookId);
    const hookEvent = text(payload.event);
    if (!hookId || !hookEvent) return undefined;
    if (input.event.eventType === "hook.started") {
      return {
        type: "hook.started",
        ...base,
        payload: {
          hookId,
          hookName: text(payload.kind) ?? hookId,
          hookEvent,
        },
      };
    }
    const outcome = record(payload.outcome);
    const status = text(outcome.status);
    const reason = text(outcome.reason);
    const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
    const output =
      reason ??
      (status
        ? `${status}${durationMs === undefined ? "" : ` (${Math.round(durationMs)}ms)`}`
        : undefined);
    return {
      type: "hook.completed",
      ...base,
      payload: {
        hookId,
        outcome:
          input.event.eventType === "hook.failed" || status === "failed" || status === "denied"
            ? "error"
            : "success",
        ...(output ? { output } : {}),
      },
    };
  }
  if (input.event.eventType === "mcp.status.updated") {
    return {
      type: "mcp.status.updated",
      ...base,
      payload: { status: payload.status ?? payload },
    };
  }
  return undefined;
}

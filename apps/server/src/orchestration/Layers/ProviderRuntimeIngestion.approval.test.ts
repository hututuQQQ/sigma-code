import {
  EventId,
  ProviderDriverKind,
  RuntimeRequestId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

describe("runtimeEventToActivities approval details", () => {
  it("preserves complete multiline command details", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-request-opened"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-18T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-1"),
      payload: {
        requestType: "command_execution_approval",
        detail,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity?.kind).toBe("approval.requested");
    expect((activity?.payload as Record<string, unknown> | undefined)?.detail).toBe(detail);
  });

  it("preserves provider permission options for client-specific actions", () => {
    const args = {
      rawInput: { command: "must-not-be-projected" },
      options: [
        { optionId: "keep", name: "Keep current changes", kind: "allow_once" },
        { optionId: "restore", name: "Restore state", kind: "reject_once" },
      ],
    };
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-recovery-opened"),
      provider: ProviderDriverKind.make("sigma"),
      createdAt: "2026-07-18T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-recovery"),
      payload: {
        requestType: "file_change_approval",
        detail: "Recover interrupted workspace changes",
        args,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    const payload = activity?.payload as Record<string, unknown> | undefined;
    expect(payload?.permissionOptions).toEqual(args.options);
    expect(payload?.args).toBeUndefined();
  });
});

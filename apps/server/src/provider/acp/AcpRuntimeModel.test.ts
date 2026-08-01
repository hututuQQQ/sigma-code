import { describe, expect, it } from "vite-plus/test";

import type * as EffectAcpSchema from "effect-acp/schema";

import {
  extractModelConfigId,
  mergeToolCallState,
  parsePermissionRequest,
  parseSessionModeState,
  parseSessionUpdateEvent,
  sessionUpdateIsReplay,
  syntheticLoadSessionResponseFromInitialize,
} from "./AcpRuntimeModel.ts";

describe("AcpRuntimeModel", () => {
  it("parses session mode state from typed ACP session setup responses", () => {
    const modeState = parseSessionModeState({
      sessionId: "session-1",
      modes: {
        currentModeId: " code ",
        availableModes: [
          { id: " ask ", name: " Ask ", description: " Request approval " },
          { id: " code ", name: " Code " },
        ],
      },
      configOptions: [],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modeState).toEqual({
      currentModeId: "code",
      availableModes: [
        { id: "ask", name: "Ask", description: "Request approval" },
        { id: "code", name: "Code" },
      ],
    });
  });

  it("extracts the model config id from typed ACP config options", () => {
    const modelConfigId = extractModelConfigId({
      sessionId: "session-1",
      configOptions: [
        {
          id: "approval",
          name: "Approval Mode",
          category: "permission",
          type: "select",
          currentValue: "ask",
          options: [{ value: "ask", name: "Ask" }],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Auto" }],
        },
      ],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modelConfigId).toBe("model");
  });

  it("detects Grok session replay updates from _meta.isReplay", () => {
    expect(
      sessionUpdateIsReplay({
        _meta: { isReplay: true },
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "replayed" },
        },
      } satisfies EffectAcpSchema.SessionNotification),
    ).toBe(true);
    expect(
      sessionUpdateIsReplay({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "live" },
        },
      } satisfies EffectAcpSchema.SessionNotification),
    ).toBe(false);
  });

  it("builds a synthetic load response from initialize model state", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [{ modelId: "grok-build", name: "Grok Build" }],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.models?.currentModelId).toBe("grok-build");
    expect(response._meta).toMatchObject({ t3SessionLoadReady: "replay_idle" });
  });

  it("accepts initialize model descriptions with null", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [{ modelId: "grok-build", name: "Grok Build", description: null }],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.models?.availableModels[0]?.description).toBeNull();
  });

  it("ignores malformed initialize model state in synthetic load responses", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: "grok-build",
          availableModels: [null],
        },
        modeState: {
          currentModeId: "code",
          availableModes: [{ id: "code", name: 12 }],
        },
      },
    } as EffectAcpSchema.InitializeResponse);

    expect(response.models).toBeUndefined();
    expect(response.modes).toBeUndefined();
    expect(response._meta).toMatchObject({ t3SessionLoadReady: "replay_idle" });
  });

  it("builds a synthetic load response with initialize mode state", () => {
    const response = syntheticLoadSessionResponseFromInitialize({
      protocolVersion: 1,
      _meta: {
        modeState: {
          currentModeId: "code",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
      },
    } satisfies EffectAcpSchema.InitializeResponse);

    expect(response.modes?.currentModeId).toBe("code");
    expect(response.modes?.availableModes).toHaveLength(2);
  });

  it("projects typed ACP tool call updates into runtime events", () => {
    const created = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          executable: "bun",
          args: ["run", "typecheck"],
        },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Running checks",
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(created.events).toEqual([
      {
        _tag: "ToolCallUpdated",
        toolCall: {
          toolCallId: "tool-1",
          kind: "execute",
          title: "Ran command",
          status: "pending",
          command: "bun run typecheck",
          detail: "bun run typecheck",
          data: {
            toolCallId: "tool-1",
            kind: "execute",
            command: "bun run typecheck",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Terminal",
            kind: "execute",
            status: "pending",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
      },
    ]);

    const updated = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: { exitCode: 0 },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]?._tag).toBe("ToolCallUpdated");
    const createdEvent = created.events[0];
    const updatedEvent = updated.events[0];
    if (createdEvent?._tag === "ToolCallUpdated" && updatedEvent?._tag === "ToolCallUpdated") {
      expect(mergeToolCallState(createdEvent.toolCall, updatedEvent.toolCall)).toMatchObject({
        toolCallId: "tool-1",
        status: "completed",
        title: "Ran command",
        detail: "bun run typecheck",
        command: "bun run typecheck",
      });
    }
  });

  it("trims padded current mode updates before emitting a mode change", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: " code ",
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.modeId).toBe("code");
    expect(result.events).toEqual([
      {
        _tag: "ModeChanged",
        modeId: "code",
      },
    ]);
  });

  it("projects typed ACP plan and content updates", () => {
    const planResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: " Inspect state ", priority: "high", status: "completed" },
          { content: "", priority: "medium", status: "in_progress" },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(planResult.events).toEqual([
      {
        _tag: "PlanUpdated",
        payload: {
          plan: [
            { step: "Inspect state", status: "completed" },
            { step: "Step 2", status: "inProgress" },
          ],
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: " Inspect state ", priority: "high", status: "completed" },
              { content: "", priority: "medium", status: "in_progress" },
            ],
          },
        },
      },
    ]);

    const contentResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "hello from acp",
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(contentResult.events).toEqual([
      {
        _tag: "ContentDelta",
        streamKind: "assistant_text",
        text: "hello from acp",
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "hello from acp",
            },
          },
        },
      },
    ]);
  });

  it("projects ACP usage updates into canonical token usage", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "usage_update",
        size: 200_000,
        used: 31_251,
        _meta: {
          "sigma.inputTokens": 30_000,
          "sigma.cachedInputTokens": 20_000,
          "sigma.outputTokens": 1_251,
          "sigma.reasoningOutputTokens": 800,
          "sigma.durationMs": 43_567,
          "sigma.compactsAutomatically": true,
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.events).toEqual([
      {
        _tag: "UsageUpdated",
        usage: {
          usedTokens: 31_251,
          maxTokens: 200_000,
          inputTokens: 30_000,
          cachedInputTokens: 20_000,
          outputTokens: 1_251,
          reasoningOutputTokens: 800,
          lastUsedTokens: 31_251,
          lastInputTokens: 30_000,
          lastCachedInputTokens: 20_000,
          lastOutputTokens: 1_251,
          lastReasoningOutputTokens: 800,
          durationMs: 43_567,
          compactsAutomatically: true,
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "usage_update",
            size: 200_000,
            used: 31_251,
            _meta: {
              "sigma.inputTokens": 30_000,
              "sigma.cachedInputTokens": 20_000,
              "sigma.outputTokens": 1_251,
              "sigma.reasoningOutputTokens": 800,
              "sigma.durationMs": 43_567,
              "sigma.compactsAutomatically": true,
            },
          },
        },
      },
    ]);
  });

  it("preserves Sigma lifecycle metadata as typed ACP runtime events", () => {
    const notification = {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "child:child-1",
        title: "Agent child-1",
        status: "in_progress",
        _meta: {
          "sigma.event": "child.message",
          "sigma.payload": {
            childId: "child-1",
            payload: { kind: "started", sessionId: "child-session-1" },
          },
        },
      },
    } satisfies EffectAcpSchema.SessionNotification;

    expect(parseSessionUpdateEvent(notification).events).toEqual([
      {
        _tag: "SigmaRuntimeEvent",
        event: {
          eventType: "child.message",
          payload: {
            childId: "child-1",
            payload: { kind: "started", sessionId: "child-session-1" },
          },
        },
        rawPayload: notification,
      },
    ]);
  });

  it("keeps permission request parsing compatible with loose extension payloads", () => {
    const request = parsePermissionRequest({
      sessionId: "session-1",
      options: [
        {
          optionId: "allow-once",
          name: "Allow once",
          kind: "allow_once",
        },
      ],
      toolCall: {
        toolCallId: "tool-1",
        title: "`cat package.json`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Not in allowlist",
            },
          },
        ],
      },
    });

    expect(request).toMatchObject({
      kind: "execute",
      detail: "cat package.json",
      toolCall: {
        toolCallId: "tool-1",
        kind: "execute",
        status: "pending",
        command: "cat package.json",
      },
    });
  });
});

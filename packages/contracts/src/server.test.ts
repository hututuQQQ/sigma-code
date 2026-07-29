import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ServerProvider } from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.authConnections ?? []).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("decodes model-scoped subscription authentication metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "sigma",
      driver: "sigma",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "unknown" },
      checkedAt: "2026-07-29T00:00:00.000Z",
      authConnections: [
        {
          id: "openai-codex",
          label: "ChatGPT subscription",
          status: "unauthenticated",
          loginMethods: ["browser", "device-code"],
          scope: "host",
          actions: ["login"],
          experimental: true,
        },
      ],
      models: [
        {
          slug: "openai-codex/gpt-5.6-terra",
          name: "GPT-5.6 Terra",
          isCustom: false,
          authConnectionId: "openai-codex",
          capabilities: null,
        },
      ],
    });

    expect((parsed.authConnections ?? [])[0]?.scope).toBe("host");
    expect(parsed.models[0]?.authConnectionId).toBe("openai-codex");
    expect(parsed.auth.status).toBe("unknown");
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });
});

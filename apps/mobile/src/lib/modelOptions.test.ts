import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ServerConfig } from "@t3tools/contracts";

import { buildModelOptions, resolveMobileModelSelection } from "./modelOptions";

describe("mobile model options", () => {
  it("normalizes a legacy fallback selection against current capabilities", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-test",
              name: "GPT Test",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [
                      { id: "default", label: "Standard", isDefault: true },
                      { id: "priority", label: "Fast" },
                    ],
                    currentValue: "default",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [option] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
      options: [{ id: "fastMode", value: true }],
    });

    expect(option?.capabilities?.optionDescriptors?.[0]?.id).toBe("serviceTier");
    expect(option?.selection.options).toEqual([{ id: "serviceTier", value: "default" }]);
  });

  it("hides locked and unpriced models that mobile cannot unlock or confirm", () => {
    const config = {
      providers: [
        {
          instanceId: "sigma",
          driver: "sigma",
          enabled: true,
          installed: true,
          auth: { status: "unknown" },
          authConnections: [
            { id: "openai-codex", status: "authenticated" },
            { id: "anthropic", status: "unauthenticated" },
          ],
          models: [
            {
              slug: "openai-codex/gpt-test",
              name: "GPT Test",
              authConnectionId: "openai-codex",
              isCustom: false,
              capabilities: { optionDescriptors: [] },
            },
            {
              slug: "anthropic/claude-test",
              name: "Claude Test",
              authConnectionId: "anthropic",
              isCustom: false,
              capabilities: { optionDescriptors: [] },
            },
            {
              slug: "openai-codex/unpriced-test",
              name: "Unpriced Test",
              authConnectionId: "openai-codex",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "allowUnpricedCosts",
                    label: "Allow unknown cost",
                    type: "boolean",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    expect(buildModelOptions(config, null).map((option) => option.selection.model)).toEqual([
      "openai-codex/gpt-test",
    ]);
  });

  it("keeps an already-consented unpriced fallback but never invents a missing model", () => {
    const config = {
      providers: [
        {
          instanceId: "sigma",
          driver: "sigma",
          enabled: true,
          installed: true,
          auth: { status: "unknown" },
          authConnections: [{ id: "provider", status: "authenticated" }],
          models: [
            {
              slug: "provider/unpriced-test",
              name: "Unpriced Test",
              authConnectionId: "provider",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "allowUnpricedCosts",
                    label: "Allow unknown cost",
                    type: "boolean",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [consented] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("sigma"),
      model: "provider/unpriced-test",
      options: [{ id: "allowUnpricedCosts", value: true }],
    });
    expect(consented?.selection.options).toEqual([{ id: "allowUnpricedCosts", value: true }]);

    expect(
      buildModelOptions(config, {
        instanceId: ProviderInstanceId.make("missing"),
        model: "missing/model",
      }),
    ).toEqual([]);
  });

  it("falls back instead of selecting a stale project model", () => {
    const options = [
      {
        key: "codex:gpt-test",
        label: "GPT Test",
        subtitle: "Codex",
        providerKey: "codex",
        providerLabel: "Codex",
        providerDriver: "codex",
        isDefault: true,
        capabilities: null,
        selection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-test",
        },
      },
    ];

    expect(
      resolveMobileModelSelection(options, {
        instanceId: ProviderInstanceId.make("missing"),
        model: "missing/model",
      }),
    ).toEqual({
      instanceId: "codex",
      model: "gpt-test",
    });
  });
});

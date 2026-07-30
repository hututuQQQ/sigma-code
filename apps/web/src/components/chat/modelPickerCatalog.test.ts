import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";

import { isDefaultModelPickerItemVisible } from "./modelPickerCatalog";

describe("model picker catalog visibility", () => {
  it("keeps a large Pi catalog searchable while showing only useful models by default", () => {
    const instanceId = ProviderInstanceId.make("sigma");
    const favorites = new Set(["sigma:provider-777/model-777"]);
    const authenticated = new Set(["provider-200"]);
    const visible = Array.from({ length: 1_109 }, (_, index) => {
      const model = {
        instanceId,
        slug: `provider-${index}/model-${index}`,
        authConnectionId: `provider-${index}`,
        ...(index === 0 ? { isRecommended: true } : {}),
      };
      return isDefaultModelPickerItemVisible({
        model,
        activeInstanceId: instanceId,
        activeModel: "provider-500/model-500",
        favoriteModelKeys: favorites,
        authenticatedConnectionIds: authenticated,
        modelKey: `sigma:${model.slug}`,
      });
    }).filter(Boolean);

    expect(visible).toHaveLength(4);
  });

  it("shows every model whose provider connection is authenticated", () => {
    const instanceId = ProviderInstanceId.make("sigma");
    expect(
      isDefaultModelPickerItemVisible({
        model: {
          instanceId,
          slug: "example/model",
          authConnectionId: "example",
        },
        activeInstanceId: instanceId,
        activeModel: "different/model",
        favoriteModelKeys: new Set(),
        authenticatedConnectionIds: new Set(["example"]),
        modelKey: "sigma:example/model",
      }),
    ).toBe(true);
  });
});

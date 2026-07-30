import type { ProviderInstanceId } from "@t3tools/contracts";

export interface ModelPickerCatalogItem {
  readonly instanceId: ProviderInstanceId;
  readonly slug: string;
  readonly authConnectionId?: string;
  readonly isRecommended?: boolean;
}

export function isDefaultModelPickerItemVisible(input: {
  readonly model: ModelPickerCatalogItem;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
  readonly favoriteModelKeys: ReadonlySet<string>;
  readonly authenticatedConnectionIds: ReadonlySet<string>;
  readonly modelKey: string;
}): boolean {
  if (
    input.model.isRecommended ||
    input.favoriteModelKeys.has(input.modelKey) ||
    (input.model.instanceId === input.activeInstanceId && input.model.slug === input.activeModel)
  ) {
    return true;
  }
  return (
    !input.model.authConnectionId ||
    input.authenticatedConnectionIds.has(input.model.authConnectionId)
  );
}

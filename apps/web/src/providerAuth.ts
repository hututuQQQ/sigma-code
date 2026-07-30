import type {
  ModelSelection,
  ServerProvider,
  ServerProviderAuthConnection,
  ServerProviderModel,
} from "@t3tools/contracts";

export interface ProviderModelAuthRequirement {
  readonly provider: ServerProvider;
  readonly model: ServerProviderModel;
  readonly connectionId: string;
  readonly connection: ServerProviderAuthConnection | undefined;
}

export interface ProviderModelUnpricedCostRequirement {
  readonly provider: ServerProvider;
  readonly model: ServerProviderModel;
}

export const ALLOW_UNPRICED_COSTS_OPTION_ID = "allowUnpricedCosts";

export function resolveProviderModelAuthRequirement(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ProviderModelAuthRequirement | null {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!provider) return null;
  const model = provider.models.find((candidate) => candidate.slug === selection.model);
  const connectionId = model?.authConnectionId?.trim();
  if (!model || !connectionId) return null;
  return {
    provider,
    model,
    connectionId,
    connection: (provider.authConnections ?? []).find((candidate) => candidate.id === connectionId),
  };
}

export function providerModelNeedsLogin(
  requirement: ProviderModelAuthRequirement | null,
): requirement is ProviderModelAuthRequirement {
  return requirement !== null && requirement.connection?.status !== "authenticated";
}

export function providerAuthRequirementKey(requirement: ProviderModelAuthRequirement): string {
  return `${requirement.provider.instanceId}:${requirement.connectionId}`;
}

export function resolveProviderModelUnpricedCostRequirement(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ProviderModelUnpricedCostRequirement | null {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  if (!provider || !model) return null;
  const requiresConfirmation =
    model.activeBillingMode === "unpriced" ||
    (model.activeBillingMode === undefined &&
      model.billingModes?.length === 1 &&
      model.billingModes[0] === "unpriced");
  return requiresConfirmation ? { provider, model } : null;
}

export function modelSelectionAllowsUnpricedCosts(selection: ModelSelection): boolean {
  return Boolean(
    selection.options?.some(
      (option) => option.id === ALLOW_UNPRICED_COSTS_OPTION_ID && option.value === true,
    ),
  );
}

export function allowUnpricedCostsForModelSelection(selection: ModelSelection): ModelSelection {
  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter((option) => option.id !== ALLOW_UNPRICED_COSTS_OPTION_ID),
      { id: ALLOW_UNPRICED_COSTS_OPTION_ID, value: true },
    ],
  };
}

export function isSafeProviderAuthExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

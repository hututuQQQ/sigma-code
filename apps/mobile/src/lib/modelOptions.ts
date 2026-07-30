import type {
  ModelCapabilities,
  ModelSelection,
  ServerConfig as T3ServerConfig,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

export type ModelOption = {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly providerDriver: string;
  readonly isDefault: boolean;
  readonly capabilities: ModelCapabilities | null;
  readonly selection: ModelSelection;
};

export type ProviderGroup = {
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly models: ReadonlyArray<ModelOption>;
};

const ALLOW_UNPRICED_COSTS_OPTION_ID = "allowUnpricedCosts";

function providerDisplayLabel(provider: {
  readonly displayName?: string | undefined;
  readonly driver: string;
  readonly instanceId: string;
}): string {
  if (provider.displayName) return provider.displayName;
  if (provider.driver === "codex") return "Codex";
  if (provider.driver === "claudeAgent") return "Claude";
  return provider.instanceId;
}

function selectionAllowsUnpricedCosts(selection: ModelSelection | null): boolean {
  return (
    selection?.options?.some(
      (option) => option.id === ALLOW_UNPRICED_COSTS_OPTION_ID && option.value === true,
    ) === true
  );
}

function modelRequiresUnpricedConsent(model: ServerProviderModel): boolean {
  return (
    model.capabilities?.optionDescriptors?.some(
      (descriptor) => descriptor.id === ALLOW_UNPRICED_COSTS_OPTION_ID,
    ) === true
  );
}

function isMobileModelAvailable(input: {
  readonly provider: ServerProvider;
  readonly model: ServerProviderModel;
  readonly fallbackModelSelection: ModelSelection | null;
}): boolean {
  if (input.model.authConnectionId) {
    const connection = input.provider.authConnections?.find(
      (candidate) => candidate.id === input.model.authConnectionId,
    );
    if (connection?.status !== "authenticated") {
      return false;
    }
  }

  if (!modelRequiresUnpricedConsent(input.model)) {
    return true;
  }
  const fallback = input.fallbackModelSelection;
  return (
    fallback?.instanceId === input.provider.instanceId &&
    fallback.model === input.model.slug &&
    selectionAllowsUnpricedCosts(fallback)
  );
}

function normalizeSelectionOptions(
  selection: ModelSelection,
  capabilities: ModelCapabilities | null,
): ModelSelection {
  if (!capabilities) {
    return selection;
  }
  const options = buildProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({
      caps: capabilities,
      selections: selection.options,
    }),
  );
  return options
    ? { ...selection, options }
    : {
        instanceId: selection.instanceId,
        model: selection.model,
      };
}

export function buildModelOptions(
  config: T3ServerConfig | null | undefined,
  fallbackModelSelection: ModelSelection | null,
): ReadonlyArray<ModelOption> {
  const options = new Map<string, ModelOption>();

  for (const provider of config?.providers ?? []) {
    if (!provider.enabled || !provider.installed || provider.auth.status === "unauthenticated") {
      continue;
    }

    const providerLabel = providerDisplayLabel(provider);
    for (const model of provider.models) {
      if (
        !isMobileModelAvailable({
          provider,
          model,
          fallbackModelSelection,
        })
      ) {
        continue;
      }
      const key = `${provider.instanceId}:${model.slug}`;
      options.set(key, {
        key,
        label: model.name,
        subtitle: providerLabel,
        providerKey: provider.instanceId,
        providerLabel,
        providerDriver: provider.driver,
        isDefault: model.isDefault === true,
        capabilities: model.capabilities,
        selection: normalizeSelectionOptions(
          {
            instanceId: provider.instanceId,
            model: model.slug,
          },
          model.capabilities,
        ),
      });
    }
  }

  if (fallbackModelSelection) {
    const key = `${fallbackModelSelection.instanceId}:${fallbackModelSelection.model}`;
    const existing = options.get(key);
    if (existing) {
      options.set(key, {
        ...existing,
        selection: normalizeSelectionOptions(fallbackModelSelection, existing.capabilities),
      });
    }
  }

  return [...options.values()];
}

export function resolveMobileModelSelection(
  options: ReadonlyArray<ModelOption>,
  preferred: ModelSelection | null | undefined,
): ModelSelection | null {
  if (preferred) {
    const preferredOption = options.find(
      (option) =>
        option.selection.instanceId === preferred.instanceId &&
        option.selection.model === preferred.model,
    );
    if (preferredOption) {
      return preferredOption.selection;
    }
  }
  return options.find((option) => option.isDefault)?.selection ?? options[0]?.selection ?? null;
}

export function groupByProvider(options: ReadonlyArray<ModelOption>): ReadonlyArray<ProviderGroup> {
  const groups = new Map<string, { providerLabel: string; models: ModelOption[] }>();
  for (const option of options) {
    const existing = groups.get(option.providerKey);
    if (existing) {
      existing.models.push(option);
    } else {
      groups.set(option.providerKey, {
        providerLabel: option.providerLabel,
        models: [option],
      });
    }
  }

  return [...groups.entries()].map(([providerKey, group]) => ({
    providerKey,
    providerLabel: group.providerLabel,
    models: group.models,
  }));
}

export type ProviderIconKind = "sigma" | "claude" | "openai";

export function resolveProviderIconKind(provider: string | null | undefined): ProviderIconKind {
  if (provider === "sigma") return "sigma";
  if (provider === "claudeAgent") return "claude";
  return "openai";
}

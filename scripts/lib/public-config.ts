// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

export interface SigmaCodePublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
  readonly mobileOtlpTracesUrl: string | undefined;
  readonly mobileOtlpTracesDataset: string | undefined;
  readonly mobileOtlpTracesToken: string | undefined;
  readonly relayClientOtlpTracesUrl: string | undefined;
  readonly relayClientOtlpTracesDataset: string | undefined;
  readonly relayClientOtlpTracesToken: string | undefined;
  readonly clerkGoogleWebClientId: string | undefined;
  readonly clerkGoogleIosClientId: string | undefined;
  readonly clerkGoogleAndroidClientId: string | undefined;
  readonly clerkGoogleIosUrlScheme: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

export const UNTRUSTED_PUBLIC_CONFIG_ALIAS_NAMES = [
  "VITE_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_JWT_TEMPLATE",
  "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
  "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
  "VITE_SIGMACODE_RELAY_URL",
  "EXPO_PUBLIC_OTLP_TRACES_URL",
  "EXPO_PUBLIC_OTLP_TRACES_DATASET",
  "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
  "VITE_RELAY_OTLP_TRACES_URL",
  "VITE_RELAY_OTLP_TRACES_DATASET",
  "VITE_RELAY_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME",
] as const;

export function clearUntrustedPublicConfigAliases(
  environment: Record<string, string | undefined>,
): void {
  for (const name of Object.keys(environment)) {
    if (
      name.startsWith("T3CODE_") ||
      (UNTRUSTED_PUBLIC_CONFIG_ALIAS_NAMES as readonly string[]).includes(name)
    ) {
      delete environment[name];
    }
  }
}

const REPO_ROOT = NodePath.dirname(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  const config = resolvePublicConfig(baseEnv, localEnv, rootEnv);
  const mergedEnv: Record<string, string | undefined> = {
    ...rootEnv,
    ...localEnv,
    ...baseEnv,
  };
  clearUntrustedPublicConfigAliases(mergedEnv);

  return {
    ...mergedEnv,
    ...(config.clerkPublishableKey
      ? {
          SIGMACODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          SIGMACODE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          SIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          SIGMACODE_RELAY_URL: config.relayUrl,
          VITE_SIGMACODE_RELAY_URL: config.relayUrl,
        }
      : {}),
    ...(config.mobileOtlpTracesUrl
      ? {
          SIGMACODE_MOBILE_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
          EXPO_PUBLIC_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
        }
      : {}),
    ...(config.mobileOtlpTracesDataset
      ? {
          SIGMACODE_MOBILE_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
          EXPO_PUBLIC_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
        }
      : {}),
    ...(config.mobileOtlpTracesToken
      ? {
          SIGMACODE_MOBILE_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
          EXPO_PUBLIC_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
        }
      : {}),
    ...(config.relayClientOtlpTracesUrl
      ? {
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
          VITE_RELAY_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
        }
      : {}),
    ...(config.relayClientOtlpTracesDataset
      ? {
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
          VITE_RELAY_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
        }
      : {}),
    ...(config.relayClientOtlpTracesToken
      ? {
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
          VITE_RELAY_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
        }
      : {}),
    ...(config.clerkGoogleWebClientId
      ? {
          EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: config.clerkGoogleWebClientId,
        }
      : {}),
    ...(config.clerkGoogleIosClientId
      ? {
          EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: config.clerkGoogleIosClientId,
        }
      : {}),
    ...(config.clerkGoogleAndroidClientId
      ? {
          EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: config.clerkGoogleAndroidClientId,
        }
      : {}),
    ...(config.clerkGoogleIosUrlScheme
      ? {
          EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: config.clerkGoogleIosUrlScheme,
        }
      : {}),
  };
}

export function resolvePublicConfig(...sources: readonly Environment[]): SigmaCodePublicConfig {
  return {
    clerkPublishableKey: firstNonEmpty(sources, "SIGMACODE_CLERK_PUBLISHABLE_KEY"),
    clerkJwtTemplate: firstNonEmpty(sources, "SIGMACODE_CLERK_JWT_TEMPLATE"),
    clerkCliOAuthClientId: firstNonEmpty(sources, "SIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID"),
    relayUrl: firstNonEmpty(sources, "SIGMACODE_RELAY_URL"),
    mobileOtlpTracesUrl: firstNonEmpty(sources, "SIGMACODE_MOBILE_OTLP_TRACES_URL"),
    mobileOtlpTracesDataset: firstNonEmpty(sources, "SIGMACODE_MOBILE_OTLP_TRACES_DATASET"),
    mobileOtlpTracesToken: firstNonEmpty(sources, "SIGMACODE_MOBILE_OTLP_TRACES_TOKEN"),
    relayClientOtlpTracesUrl: firstNonEmpty(sources, "SIGMACODE_RELAY_CLIENT_OTLP_TRACES_URL"),
    relayClientOtlpTracesDataset: firstNonEmpty(
      sources,
      "SIGMACODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
    ),
    relayClientOtlpTracesToken: firstNonEmpty(sources, "SIGMACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN"),
    clerkGoogleWebClientId: firstNonEmpty(sources, "SIGMACODE_CLERK_GOOGLE_WEB_CLIENT_ID"),
    clerkGoogleIosClientId: firstNonEmpty(sources, "SIGMACODE_CLERK_GOOGLE_IOS_CLIENT_ID"),
    clerkGoogleAndroidClientId: firstNonEmpty(sources, "SIGMACODE_CLERK_GOOGLE_ANDROID_CLIENT_ID"),
    clerkGoogleIosUrlScheme: firstNonEmpty(sources, "SIGMACODE_CLERK_GOOGLE_IOS_URL_SCHEME"),
  };
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}

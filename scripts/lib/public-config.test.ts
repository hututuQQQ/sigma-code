// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clearUntrustedPublicConfigAliases,
  loadRepoEnv,
  resolvePublicConfig,
} from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("does not project cloud or telemetry configuration for an unconfigured clone", () => {
    const env = loadRepoEnv({ baseEnv: {}, repoRoot: makeTemporaryDirectory() });

    expect(env.SIGMACODE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.SIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.SIGMACODE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.VITE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.SIGMACODE_RELAY_URL).toBeUndefined();
    expect(env.VITE_SIGMACODE_RELAY_URL).toBeUndefined();
    expect(env.SIGMACODE_MOBILE_OTLP_TRACES_URL).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_URL).toBeUndefined();
    expect(env.SIGMACODE_RELAY_CLIENT_OTLP_TRACES_URL).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
  });

  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "SIGMACODE_CLERK_PUBLISHABLE_KEY=pk_root\nSIGMACODE_CLERK_JWT_TEMPLATE=template_root\nSIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nSIGMACODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "SIGMACODE_CLERK_PUBLISHABLE_KEY=pk_local\nSIGMACODE_CLERK_JWT_TEMPLATE=template_local\nSIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nSIGMACODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).SIGMACODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          SIGMACODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
          SIGMACODE_CLERK_JWT_TEMPLATE: "template_ci",
          SIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          SIGMACODE_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      SIGMACODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      SIGMACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      SIGMACODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      SIGMACODE_RELAY_URL: "https://ci.example.test",
      VITE_SIGMACODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("ignores upstream T3 names and ambient framework aliases", () => {
    const env = loadRepoEnv({
      baseEnv: {
        T3CODE_CLERK_PUBLISHABLE_KEY: "pk_upstream",
        T3CODE_RELAY_URL: "https://relay.t3.example",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_ambient",
        EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "ambient-template",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "ambient-token",
        UNRELATED_VALUE: "preserved",
      },
      repoRoot: makeTemporaryDirectory(),
    });

    expect(env.T3CODE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.T3CODE_RELAY_URL).toBeUndefined();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.UNRELATED_VALUE).toBe("preserved");
    expect(resolvePublicConfig(env)).toEqual(emptyPublicConfig);
  });

  it("clears unsafe aliases before Expo or Vite inspect process.env", () => {
    const environment: Record<string, string | undefined> = {
      T3CODE_RELAY_URL: "https://relay.t3.example",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ambient",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ambient",
      SIGMACODE_RELAY_URL: "https://relay.sigma.example",
      PATH: "/bin",
    };

    clearUntrustedPublicConfigAliases(environment);

    expect(environment).toEqual({
      SIGMACODE_RELAY_URL: "https://relay.sigma.example",
      PATH: "/bin",
    });
  });

  it("projects canonical relay-client tracing values to web build aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
          SIGMACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      SIGMACODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
      SIGMACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
      SIGMACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
      VITE_RELAY_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
      VITE_RELAY_OTLP_TRACES_DATASET: "relay-client-traces",
      VITE_RELAY_OTLP_TRACES_TOKEN: "relay-client-token",
    });
  });

  it("projects only canonical mobile tracing and Clerk values to Expo aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          SIGMACODE_RELAY_URL: "https://relay.example.test",
          SIGMACODE_MOBILE_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
          SIGMACODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
          SIGMACODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
          SIGMACODE_CLERK_GOOGLE_IOS_CLIENT_ID: "sigma-ios-client",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      SIGMACODE_RELAY_URL: "https://relay.example.test",
      VITE_SIGMACODE_RELAY_URL: "https://relay.example.test",
      SIGMACODE_MOBILE_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
      SIGMACODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
      SIGMACODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
      EXPO_PUBLIC_OTLP_TRACES_URL: "https://telemetry.example/v1/traces",
      EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
      EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
      SIGMACODE_CLERK_GOOGLE_IOS_CLIENT_ID: "sigma-ios-client",
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: "sigma-ios-client",
    });
  });
});

const emptyPublicConfig = {
  clerkPublishableKey: undefined,
  clerkJwtTemplate: undefined,
  clerkCliOAuthClientId: undefined,
  relayUrl: undefined,
  mobileOtlpTracesUrl: undefined,
  mobileOtlpTracesDataset: undefined,
  mobileOtlpTracesToken: undefined,
  relayClientOtlpTracesUrl: undefined,
  relayClientOtlpTracesDataset: undefined,
  relayClientOtlpTracesToken: undefined,
  clerkGoogleWebClientId: undefined,
  clerkGoogleIosClientId: undefined,
  clerkGoogleAndroidClientId: undefined,
  clerkGoogleIosUrlScheme: undefined,
};

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sigmacode-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

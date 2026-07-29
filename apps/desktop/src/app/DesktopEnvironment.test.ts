import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Sigma Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Sigma Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

const normalizePath = (value: string) => value.replaceAll("\\", "/");
const assertPath = (actual: string, expected: string) => {
  assert.isTrue(
    normalizePath(actual).endsWith(expected),
    `expected ${normalizePath(actual)} to end with ${expected}`,
  );
};

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          SIGMACODE_HOME: " /tmp/sigma-code ",
          SIGMACODE_COMMIT_HASH: " 0123456789abcdef ",
          SIGMACODE_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          SIGMACODE_DEV_REMOTE_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          SIGMACODE_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          SIGMACODE_OTLP_EXPORT_INTERVAL_MS: "2500",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assertPath(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assertPath(environment.baseDir, "/tmp/sigma-code");
      assertPath(environment.stateDir, "/tmp/sigma-code");
      assertPath(environment.desktopSettingsPath, "/tmp/sigma-code/desktop-settings.json");
      assertPath(environment.clientSettingsPath, "/tmp/sigma-code/client-settings.json");
      assertPath(
        environment.savedEnvironmentRegistryPath,
        "/tmp/sigma-code/saved-environments.json",
      );
      assertPath(environment.serverSettingsPath, "/tmp/sigma-code/settings.json");
      assertPath(environment.logDir, "/tmp/sigma-code/logs");
      assertPath(environment.browserArtifactsDir, "/tmp/sigma-code/browser-artifacts");
      assertPath(environment.rootDir, "/repo");
      assertPath(environment.appRoot, "/repo");
      assertPath(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assertPath(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "io.github.hututuqqq.sigmacode.dev");
      assert.equal(environment.linuxWmClass, "sigma-code-dev");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(environment.devRemoteT3ServerEntryPath, Option.some("/remote/server.mjs"));
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
    }),
  );

  it.effect("stores production state directly in an explicit Sigma home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          SIGMACODE_HOME: "/tmp/sigma-code",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assertPath(environment.stateDir, "/tmp/sigma-code");
      assertPath(environment.logDir, "/tmp/sigma-code/logs");
      assertPath(environment.browserArtifactsDir, "/tmp/sigma-code/browser-artifacts");
      assertPath(environment.serverSettingsPath, "/tmp/sigma-code/settings.json");
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assertPath(development.stateDir, "/Users/alice/.sigma/code/dev");
      assertPath(production.stateDir, "/Users/alice/.sigma/code");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          SIGMACODE_DESKTOP_APP_USER_MODEL_ID: " io.github.hututuqqq.sigmacode.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "io.github.hututuqqq.sigmacode.dev.local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        Option.map(
          environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
          normalizePath,
        ),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});

#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off

import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const APP_ID = "io.github.hututuqqq.sigmacode";
const MACOS_MINIMUM_SYSTEM_VERSION = "13.5";

type Platform = "darwin" | "win32";
type Arch = "arm64" | "x64";
type SigningMode = "signed" | "unsigned";
type Verification = "pass" | "not-signed" | "not-applicable";

export interface DesktopReleaseEvidenceOptions {
  readonly artifactPath: string;
  readonly runtimeProvenancePath: string;
  readonly platform: Platform;
  readonly arch: Arch;
  readonly version: string;
  readonly signingMode: SigningMode;
  readonly codesign: Verification;
  readonly gatekeeper: Verification;
  readonly stapler: Verification;
}

async function sha256(filePath: string): Promise<string> {
  return NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(filePath))
    .digest("hex");
}

function validateOptions(options: DesktopReleaseEvidenceOptions): void {
  if (!(["darwin", "win32"] as const).includes(options.platform)) {
    throw new Error(`Unsupported desktop evidence platform: ${options.platform}`);
  }
  if (!(["arm64", "x64"] as const).includes(options.arch)) {
    throw new Error(`Unsupported desktop evidence architecture: ${options.arch}`);
  }
  if (!(["signed", "unsigned"] as const).includes(options.signingMode)) {
    throw new Error(`Unsupported desktop signing mode: ${options.signingMode}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.version)) {
    throw new Error(`Invalid desktop release version: ${options.version}`);
  }
  const extension = options.platform === "darwin" ? "dmg" : "exe";
  const expectedName = `Sigma-Code-${options.version}-${options.arch}.${extension}`;
  if (NodePath.basename(options.artifactPath) !== expectedName) {
    throw new Error(`Desktop artifact must be named ${expectedName}.`);
  }
  if (options.platform === "darwin" && options.arch !== "arm64") {
    throw new Error("This release supports only macOS ARM64.");
  }
  const expected =
    options.signingMode === "signed"
      ? { codesign: "pass", gatekeeper: "pass", stapler: "pass" }
      : { codesign: "not-signed", gatekeeper: "not-applicable", stapler: "not-applicable" };
  for (const key of ["codesign", "gatekeeper", "stapler"] as const) {
    if (options[key] !== expected[key]) {
      throw new Error(`${options.signingMode} evidence requires ${key}=${expected[key]}.`);
    }
  }
}

export async function writeDesktopReleaseEvidence(options: DesktopReleaseEvidenceOptions): Promise<{
  readonly checksumPath: string;
  readonly provenancePath: string;
  readonly signingPath: string;
}> {
  validateOptions(options);
  const runtimeProvenanceRaw = await NodeFSP.readFile(options.runtimeProvenancePath, "utf8");
  const runtimeProvenance = JSON.parse(runtimeProvenanceRaw) as Record<string, unknown>;
  const runtimeParameters = (
    runtimeProvenance.predicate as
      | { readonly buildDefinition?: { readonly externalParameters?: unknown } }
      | undefined
  )?.buildDefinition?.externalParameters as
    | {
        readonly version?: unknown;
        readonly targetPlatform?: unknown;
        readonly targetArch?: unknown;
      }
    | undefined;
  if (
    runtimeParameters?.version !== options.version ||
    runtimeParameters.targetPlatform !== options.platform ||
    runtimeParameters.targetArch !== options.arch
  ) {
    throw new Error(
      `Runtime provenance does not match ${options.version}/${options.platform}/${options.arch}.`,
    );
  }
  const artifactSha256 = await sha256(options.artifactPath);
  const artifactName = NodePath.basename(options.artifactPath);
  const checksumPath = `${options.artifactPath}.sha256`;
  const provenancePath = `${options.artifactPath}.desktop-provenance.json`;
  const signingPath = `${options.artifactPath}.signing.json`;
  await NodeFSP.writeFile(checksumPath, `${artifactSha256}  ${artifactName}\n`, "utf8");

  const buildSource = {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    runtimeCommit: process.env.GITHUB_SHA ?? null,
    sigmaCodeCommit: process.env.SIGMACODE_SOURCE_COMMIT ?? null,
    ref: process.env.GITHUB_REF ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  const provenance = {
    schemaVersion: 1,
    kind: "sigma-code.desktop-provenance",
    artifact: { name: artifactName, sha256: artifactSha256 },
    product: {
      appId: APP_ID,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      minimumSystemVersion: options.platform === "darwin" ? MACOS_MINIMUM_SYSTEM_VERSION : null,
    },
    runtime: {
      provenanceFile: NodePath.basename(options.runtimeProvenancePath),
      provenanceSha256: await sha256(options.runtimeProvenancePath),
      target: `${options.platform}-${options.arch}`,
    },
    buildSource,
  };
  const signing = {
    schemaVersion: 1,
    kind: "sigma-code.desktop-signing-status",
    artifact: { name: artifactName, sha256: artifactSha256 },
    mode: options.signingMode,
    hardenedRuntime: options.platform === "darwin" && options.signingMode === "signed",
    notarized: options.platform === "darwin" && options.signingMode === "signed",
    verification: {
      codesign: options.codesign,
      gatekeeper: options.gatekeeper,
      stapler: options.stapler,
    },
  };
  await Promise.all([
    NodeFSP.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8"),
    NodeFSP.writeFile(signingPath, `${JSON.stringify(signing, null, 2)}\n`, "utf8"),
  ]);
  return { checksumPath, provenancePath, signingPath };
}

function parseArgs(argv: readonly string[]): DesktopReleaseEvidenceOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value)
      throw new Error(`Invalid argument: ${name ?? "<missing>"}`);
    values.set(name.slice(2), value);
  }
  const required = [
    "artifact",
    "runtime-provenance",
    "platform",
    "arch",
    "version",
    "signing-mode",
    "codesign",
    "gatekeeper",
    "stapler",
  ];
  const missing = required.filter((name) => !values.has(name));
  if (missing.length > 0) throw new Error(`Missing arguments: ${missing.join(", ")}`);
  return {
    artifactPath: NodePath.resolve(values.get("artifact")!),
    runtimeProvenancePath: NodePath.resolve(values.get("runtime-provenance")!),
    platform: values.get("platform") as Platform,
    arch: values.get("arch") as Arch,
    version: values.get("version")!,
    signingMode: values.get("signing-mode") as SigningMode,
    codesign: values.get("codesign") as Verification,
    gatekeeper: values.get("gatekeeper") as Verification,
    stapler: values.get("stapler") as Verification,
  };
}

if (import.meta.main) {
  writeDesktopReleaseEvidence(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

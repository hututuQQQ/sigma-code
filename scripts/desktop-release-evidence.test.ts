// @effect-diagnostics nodeBuiltinImport:off
import { assert, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { writeDesktopReleaseEvidence } from "./desktop-release-evidence.ts";

function runtimeProvenance(version = "0.1.9", platform = "darwin", arch = "arm64"): string {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://sigma-code.dev/build-types/portable-cli",
        externalParameters: { version, targetPlatform: platform, targetArch: arch },
      },
    },
  };
  return `${JSON.stringify({
    payloadType: "application/vnd.in-toto+json",
    payload: Buffer.from(`${JSON.stringify(statement, null, 2)}\n`, "utf8").toString("base64"),
    signatures: [],
  })}\n`;
}

it("writes checksum, runtime provenance, and unsigned preview status", async () => {
  const root = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "sigma-desktop-evidence-test-"),
  );
  const artifactPath = NodePath.join(root, "Sigma-Code-0.1.9-arm64.dmg");
  const runtimeProvenancePath = NodePath.join(root, "agent-cli-darwin-arm64.provenance.json");
  await NodeFSP.writeFile(artifactPath, "dmg fixture", "utf8");
  await NodeFSP.writeFile(runtimeProvenancePath, runtimeProvenance(), "utf8");

  const result = await writeDesktopReleaseEvidence({
    artifactPath,
    runtimeProvenancePath,
    platform: "darwin",
    arch: "arm64",
    version: "0.1.9",
    signingMode: "unsigned",
    codesign: "not-signed",
    gatekeeper: "not-applicable",
    stapler: "not-applicable",
  });
  const provenance = JSON.parse(await NodeFSP.readFile(result.provenancePath, "utf8"));
  const signing = JSON.parse(await NodeFSP.readFile(result.signingPath, "utf8"));
  assert.equal(provenance.product.minimumSystemVersion, "13.5");
  assert.equal(provenance.runtime.target, "darwin-arm64");
  assert.equal(signing.mode, "unsigned");
  assert.isFalse(signing.hardenedRuntime);
});

it("rejects signed evidence unless every notarization gate passed", async () => {
  const root = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "sigma-desktop-evidence-signed-test-"),
  );
  const artifactPath = NodePath.join(root, "Sigma-Code-0.1.9-arm64.dmg");
  const runtimeProvenancePath = NodePath.join(root, "runtime.json");
  await NodeFSP.writeFile(artifactPath, "dmg fixture", "utf8");
  await NodeFSP.writeFile(runtimeProvenancePath, runtimeProvenance(), "utf8");
  let failure: unknown;
  try {
    await writeDesktopReleaseEvidence({
      artifactPath,
      runtimeProvenancePath,
      platform: "darwin",
      arch: "arm64",
      version: "0.1.9",
      signingMode: "signed",
      codesign: "pass",
      gatekeeper: "pass",
      stapler: "not-applicable",
    });
  } catch (error) {
    failure = error;
  }
  assert.instanceOf(failure, Error);
  assert.match((failure as Error).message, /stapler=pass/u);
});

it("rejects a raw provenance statement instead of treating it as a DSSE envelope", async () => {
  const root = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "sigma-desktop-evidence-envelope-test-"),
  );
  const artifactPath = NodePath.join(root, "Sigma-Code-0.1.9-arm64.dmg");
  const runtimeProvenancePath = NodePath.join(root, "runtime.json");
  await NodeFSP.writeFile(artifactPath, "dmg fixture", "utf8");
  await NodeFSP.writeFile(
    runtimeProvenancePath,
    '{"predicate":{"buildDefinition":{"externalParameters":{"version":"0.1.9","targetPlatform":"darwin","targetArch":"arm64"}}}}\n',
    "utf8",
  );
  let failure: unknown;
  try {
    await writeDesktopReleaseEvidence({
      artifactPath,
      runtimeProvenancePath,
      platform: "darwin",
      arch: "arm64",
      version: "0.1.9",
      signingMode: "unsigned",
      codesign: "not-signed",
      gatekeeper: "not-applicable",
      stapler: "not-applicable",
    });
  } catch (error) {
    failure = error;
  }
  assert.instanceOf(failure, Error);
  assert.match((failure as Error).message, /DSSE envelope/u);
});

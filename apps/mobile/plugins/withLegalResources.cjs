"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const RESOURCE_DIRECTORY = "SigmaCodeLegal";

function resolveResources(projectRoot, resources) {
  return resources.map((resource) => ({
    source: path.resolve(projectRoot, "../..", resource.sourceRelativePath),
    targetFileName: resource.targetFileName,
  }));
}

function assertResourcesExist(resources) {
  for (const resource of resources) {
    if (!fs.existsSync(resource.source)) {
      throw new Error(`Sigma Code legal resource is missing: ${resource.source}`);
    }
  }
}

function withAndroidLegalResources(config, resources) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const resolved = resolveResources(cfg.modRequest.projectRoot, resources);
      assertResourcesExist(resolved);
      const targetDirectory = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        RESOURCE_DIRECTORY,
      );
      fs.mkdirSync(targetDirectory, { recursive: true });
      for (const resource of resolved) {
        fs.copyFileSync(resource.source, path.join(targetDirectory, resource.targetFileName));
      }
      return cfg;
    },
  ]);
}

function withIosLegalResourceFiles(config, resources) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const resolved = resolveResources(cfg.modRequest.projectRoot, resources);
      assertResourcesExist(resolved);
      const targetDirectory = path.join(cfg.modRequest.platformProjectRoot, RESOURCE_DIRECTORY);
      fs.mkdirSync(targetDirectory, { recursive: true });
      for (const resource of resolved) {
        fs.copyFileSync(resource.source, path.join(targetDirectory, resource.targetFileName));
      }
      return cfg;
    },
  ]);
}

function withIosLegalResourceWiring(config, resources) {
  return withXcodeProject(config, (cfg) => {
    IOSConfig.XcodeUtils.ensureGroupRecursively(cfg.modResults, RESOURCE_DIRECTORY);
    for (const resource of resources) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: `${RESOURCE_DIRECTORY}/${resource.targetFileName}`,
        groupName: RESOURCE_DIRECTORY,
        project: cfg.modResults,
        isBuildFile: true,
        verbose: false,
      });
    }
    return cfg;
  });
}

module.exports = function withLegalResources(config, options = {}) {
  const resources = Array.isArray(options.resources) ? options.resources : [];
  if (resources.length === 0) {
    throw new Error("withLegalResources requires a non-empty resources list.");
  }

  return withIosLegalResourceWiring(
    withIosLegalResourceFiles(withAndroidLegalResources(config, resources), resources),
    resources,
  );
};

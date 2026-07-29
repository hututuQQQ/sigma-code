import type { SigmaSettings } from "@t3tools/contracts";

import {
  applySigmaAcpModelSelection,
  currentSigmaModelIdFromSessionSetup,
  makeSigmaAcpRuntime,
  resolveSigmaAcpModelId,
} from "../provider/acp/SigmaAcpSupport.ts";
import { makeGrokTextGeneration, type AcpTextGenerationProfile } from "./GrokTextGeneration.ts";

const SIGMA_TEXT_GENERATION_PROFILE: AcpTextGenerationProfile = {
  label: "Sigma",
  clientName: "sigma-code-text-generation",
  makeRuntime: makeSigmaAcpRuntime,
  modelSupport: {
    resolveModelId: resolveSigmaAcpModelId,
    currentModelId: currentSigmaModelIdFromSessionSetup,
    applySelection: applySigmaAcpModelSelection,
  },
};

export const makeSigmaTextGeneration = (
  settings: SigmaSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => makeGrokTextGeneration(settings, environment, SIGMA_TEXT_GENERATION_PROFILE);

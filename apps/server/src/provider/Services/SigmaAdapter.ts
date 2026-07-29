import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance Sigma adapter contract. */
export interface SigmaAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

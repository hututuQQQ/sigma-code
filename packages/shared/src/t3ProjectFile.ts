import * as Schema from "effect/Schema";

import { T3ProjectFile, T3_PROJECT_FILE_SCHEMA_URL } from "@t3tools/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `sigma.json` file contents (lenient JSONC string) and the
 * decoded {@link T3ProjectFile}.
 */
export const T3ProjectFileFromJson = fromLenientJson(T3ProjectFile);

/**
 * Build the publishable JSON Schema document for `sigma.json` (draft 2020-12).
 *
 * A downstream-hosted `$id` is included only after Sigma configures one.
 */
export function buildT3ProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(T3ProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...(T3_PROJECT_FILE_SCHEMA_URL ? { $id: T3_PROJECT_FILE_SCHEMA_URL } : {}),
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}

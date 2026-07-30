import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS runtime_data_migrations (
      migration_id TEXT PRIMARY KEY NOT NULL,
      completed_at TEXT NOT NULL
    ) STRICT
  `;
});

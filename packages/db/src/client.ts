import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required; Cargo Manager does not use a local database",
  );
}

const globalDatabase = globalThis as unknown as {
  cargoSql?: ReturnType<typeof postgres>;
  cargoDb?: ReturnType<typeof drizzle<typeof schema>>;
};

export const sqlClient =
  globalDatabase.cargoSql ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 10 : 4,
    prepare: false,
  });

export const db = globalDatabase.cargoDb ?? drizzle(sqlClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.cargoSql = sqlClient;
  globalDatabase.cargoDb = db;
}

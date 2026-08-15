import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "postgresql://cargo:cargo@localhost:5432/cargo_manager", { prepare: false });
export const db = drizzle(client, { schema });

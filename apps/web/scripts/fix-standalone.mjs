import { cpSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Next 16's file tracer currently copies only the CommonJS half of @swc/helpers
// under pnpm. The standalone server imports an ESM helper during startup.
const sourceStore = resolve(import.meta.dirname, "../../../node_modules/.pnpm");
const standaloneStore = resolve(
  import.meta.dirname,
  "../.next/standalone/node_modules/.pnpm",
);
if (existsSync(sourceStore) && existsSync(standaloneStore)) {
  const packageDirectory = readdirSync(sourceStore).find((entry) =>
    entry.startsWith("@swc+helpers@"),
  );
  if (packageDirectory) {
    const source = resolve(
      sourceStore,
      packageDirectory,
      "node_modules/@swc/helpers/esm",
    );
    const destination = resolve(
      standaloneStore,
      packageDirectory,
      "node_modules/@swc/helpers/esm",
    );
    if (existsSync(source)) cpSync(source, destination, { recursive: true });
  }
}

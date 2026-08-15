import { createWorkerRuntime } from "./bootstrap.js";

const { repository, runtime } = await createWorkerRuntime();

const mode = process.argv[2] ?? "once";
if (mode === "once") {
  console.log(JSON.stringify(await runtime.runOnce(), null, 2));
  await repository.close();
} else if (mode === "run") {
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  while (!stopping) {
    const summary = await runtime.runOnce();
    if (Object.values(summary).some((count) => count > 0))
      console.log(JSON.stringify(summary));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  await repository.close();
} else {
  await repository.close();
  throw new Error(`Unknown worker mode: ${mode}`);
}

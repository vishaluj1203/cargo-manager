import { createServer } from "node:http";

import { createWorkerRuntime } from "./bootstrap.js";
import type { WorkerRunSummary } from "./runtime.js";

const { repository, runtime } = await createWorkerRuntime();
const port = Number(process.env.PORT ?? 8080);
let activeRun: Promise<WorkerRunSummary> | null = null;

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.method === "GET" && request.url === "/health") {
    response.statusCode = 200;
    response.end(JSON.stringify({ ok: true, service: "cargo-worker" }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/tasks/run") {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (activeRun) {
    response.statusCode = 409;
    response.end(JSON.stringify({ error: "Worker run already in progress" }));
    return;
  }

  try {
    activeRun = runtime.runOnce(Number(process.env.WORKER_MAX_JOBS ?? 50));
    const summary = await activeRun;
    console.log(JSON.stringify({ event: "worker.run.completed", ...summary }));
    response.statusCode = 200;
    response.end(JSON.stringify(summary));
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    console.error(
      JSON.stringify({ event: "worker.run.failed", error: error.message }),
    );
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "Worker run failed" }));
  } finally {
    activeRun = null;
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "worker.started", port }));
});

async function shutdown() {
  server.close();
  await repository.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

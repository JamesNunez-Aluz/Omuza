import { createServer } from "node:http";
import type { Server } from "node:http";

export interface HealthState {
  live(): boolean;
  ready(): Promise<boolean>;
}

/**
 * Minimal HTTP health surface for the worker: /health/live answers as long as
 * the event loop runs; /health/ready verifies database and queue state.
 */
export function startHealthServer(port: number, state: HealthState): Server {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === "/health/live") {
        const ok = state.live();
        res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
        return;
      }
      if (req.url === "/health/ready") {
        const ok = await state.ready().catch(() => false);
        res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not_found" }));
    })();
  });
  server.listen(port);
  return server;
}

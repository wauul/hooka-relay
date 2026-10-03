// TypeScript emits CommonJS. Sequential require ensures initialization completes
// before Prisma, RabbitMQ, HTTP, WebSocket or job modules are evaluated.
import "./instrument";
import { flush } from "@sentry/core";
import { reportUnexpected } from "../lib/sentry-reporting";
try { require("./index"); }
catch (error) {
  reportUnexpected(error, "worker.fatal", { service: "worker" });
  const deadline = setTimeout(() => process.exit(1), 2500);
  void flush(2000).catch(() => false).finally(() => { clearTimeout(deadline); process.exit(1); });
}

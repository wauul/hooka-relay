import { reportUnexpected } from "./sentry-reporting";
import { channel } from "./queue/client";

export const WORKER_WAKE_EXCHANGE = "webhook-relay-worker-wake";

// Only a hint, published after the DB commit. The durable outbox and periodic
// sweep recover work if the API crashes, the broker is down, or no worker listens.
export async function wakeWorker() {
  try {
    const ch = await channel();
    await ch.assertExchange(WORKER_WAKE_EXCHANGE, "fanout", { durable: true });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker wakeup timed out")), 5_000);
      try {
        ch.publish(WORKER_WAKE_EXCHANGE, "", Buffer.from("wake"), { persistent: false }, error => {
          clearTimeout(timeout);
          if (error) reject(error); else resolve();
        });
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
  } catch (error) { reportUnexpected(error, "broker.publish", {}, true); /* Durable recovery remains available. */ }
}

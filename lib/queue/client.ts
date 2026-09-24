import amqp, { type ConfirmChannel, type ChannelModel } from "amqplib";
import { declareTopology, EXCHANGE, LIVE_EXCHANGE } from "./topology";
let connection: ChannelModel | undefined;
let pending: Promise<ConfirmChannel> | undefined;
export function channel() {
  if (!pending)
    pending = (async () => {
      const conn = await amqp.connect(process.env.RABBITMQ_URL!, {
        timeout: 5000,
      });
      connection = conn;
      conn.on("error", () => {
        pending = undefined;
      });
      conn.on("close", () => {
        pending = undefined;
      });
      const ch = await conn.createConfirmChannel();
      ch.on("error", () => {
        pending = undefined;
      });
      await declareTopology(ch);
      return ch;
    })().catch((e) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
export async function publish(
  job: { id: string; attemptNumber: number },
  delayQueue?: string | null,
) {
  const ch = await channel();
  await new Promise<void>((resolve, reject) =>
    ch.publish(
      delayQueue ? "" : EXCHANGE,
      delayQueue || "deliver",
      Buffer.from(JSON.stringify(job)),
      { persistent: true, contentType: "application/json" },
      (error) => (error ? reject(error) : resolve()),
    ),
  );
}
export async function closeQueue() {
  await connection?.close();
  pending = undefined;
}
// Transient fanout: only queues bound by currently connected worker sessions
// receive a copy. A broker outage must never change durable event admission.
export async function publishInboundLive(sourceId: string, receiptId: string, replayId?: string) {
  const ch = await channel();
  await new Promise<void>((resolve, reject) => ch.publish(
    LIVE_EXCHANGE, `inbound.live.${sourceId}`,
    Buffer.from(JSON.stringify({ receiptId, replayId })),
    { persistent: false, contentType: "application/json" },
    error => error ? reject(error) : resolve(),
  ));
}

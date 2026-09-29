import { expect, it, vi } from "vitest";
import { GenericContainer } from "testcontainers";
import amqp from "amqplib";
import { channel, closeQueue } from "../../lib/queue/client";
import { wakeWorker, WORKER_WAKE_EXCHANGE } from "../../lib/worker-wakeup";

it("wakes every worker replica through RabbitMQ even when there are no delivery messages", async () => {
  const rabbit = await new GenericContainer("rabbitmq:3.13-alpine").withExposedPorts(5672).start();
  const previous = process.env.RABBITMQ_URL;
  process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
  let connection: Awaited<ReturnType<typeof amqp.connect>> | undefined;
  try {
    await vi.waitFor(async () => { await channel(); }, { timeout: 30_000, interval: 1000 });
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    const received = [0, 0];
    for (let index = 0; index < 2; index++) {
      const ch = await connection.createChannel();
      await ch.assertExchange(WORKER_WAKE_EXCHANGE, "fanout", { durable: true });
      const queue = (await ch.assertQueue("", { exclusive: true, autoDelete: true, durable: false })).queue;
      await ch.bindQueue(queue, WORKER_WAKE_EXCHANGE, "");
      await ch.consume(queue, msg => { if (msg) { received[index]++; ch.ack(msg); } });
    }
    await wakeWorker();
    await vi.waitFor(() => expect(received).toEqual([1, 1]));
  } finally {
    await connection?.close();
    await closeQueue();
    if (previous === undefined) delete process.env.RABBITMQ_URL; else process.env.RABBITMQ_URL = previous;
    await rabbit.stop();
  }
}, 120_000);

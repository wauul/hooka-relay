import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { GenericContainer } from "testcontainers";
import { expect, it, vi } from "vitest";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";
import { db } from "../../lib/db";
import { encryptSecret } from "../../lib/secrets";
import { encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { POST as inbound } from "../../app/api/inbound/[ingestionToken]/route";
import { channel, closeQueue } from "../../lib/queue/client";
import { QUEUE } from "../../lib/queue/topology";
import { processJob } from "../../worker/process-job";

vi.mock("../../lib/deliver", async () => {
  const { POST } = await import("../../app/api/fake-receiver/[mode]/route");
  return { deliver: async (url: string, body: string | Buffer, headers: Record<string, string>) => {
    const mode = new URL(url).pathname.endsWith("/fail") ? "fail" : "succeed";
    const response = await POST(new Request(url, { method: "POST", headers, body: Buffer.isBuffer(body) ? new Uint8Array(body) : body }), { params: Promise.resolve({ mode }) });
    return { code: response.status, body: await response.text(), headers: {}, error: null, duration: 1 };
  } };
});

it("processes a failed primary and successful fallback through RabbitMQ and the real worker handler", async () => {
  const rabbit = await new GenericContainer("rabbitmq:3.13-alpine").withExposedPorts(5672).withStartupTimeout(90_000).start();
  process.env.RABBITMQ_URL = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
  const userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com`, hashedPassword: "test" } })).id;
  const app = await createApplication({ data: { workspaceId: await defaultWorkspace(userId), name: "Routing queue fixture", currentApiKey: randomUUID() } });
  const primary = await db.endpoint.create({ data: { applicationId: app.id, url: "https://receiver.example/api/fake-receiver/fail", secret: "primary-secret", eventTypes: ["*"], kind: "INBOUND" } });
  const backup = await db.endpoint.create({ data: { applicationId: app.id, url: "https://receiver.example/api/fake-receiver/succeed", secret: "backup-secret", eventTypes: ["*"], kind: "INBOUND" } });
  await db.endpoint.update({ where: { id: primary.id }, data: { secret: encryptEndpointSecret("primary-secret", primary) } });
  await db.endpoint.update({ where: { id: backup.id }, data: { secret: encryptEndpointSecret("backup-secret", backup) } });
  const token = randomBytes(32).toString("hex");
  const secret = "routing-test-secret";
  const source = await db.webhookSource.create({ data: { applicationId: app.id, endpointId: primary.id, destinationUrl: primary.url, name: "Queue fixture", provider: "GITHUB", ingestionToken: token, encryptedProviderSecret: encryptSecret(secret, app.id), status: "ACTIVE" } });
  await db.destinationGroup.create({ data: { webhookSourceId: source.id, order: 0, destinations: { create: { endpointId: primary.id } } } });
  await db.destinationGroup.create({ data: { webhookSourceId: source.id, order: 1, triggerCondition: "ON_PREVIOUS_FAILURE", destinations: { create: { endpointId: backup.id } } } });
  let consumerTag: string | undefined;
  try {
    const body = JSON.stringify({ action: "opened", id: 42 });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const accepted = await inbound(new Request(`https://hooka.example/api/inbound/${token}`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body }), { params: Promise.resolve({ ingestionToken: token }) });
    expect(accepted.status).toBe(202);
    const eventId = (await accepted.json()).id as string;
    const delivery = await db.delivery.findFirstOrThrow({ where: { eventId, endpointId: primary.id } });
    // Jump to the terminal attempt so this test covers the full state transition
    // without waiting through the production retry backoff schedule.
    await db.delivery.update({ where: { id: delivery.id }, data: { attemptNumber: 5, publishedAt: null } });
    const ch = await channel();
    const errors: Error[] = [];
    consumerTag = (await ch.consume(QUEUE, async message => {
      if (!message) return;
      try { await processJob(JSON.parse(message.content.toString())); ch.ack(message); }
      catch (error) { errors.push(error as Error); ch.nack(message, false, false); }
    })).consumerTag;
    const { publish } = await import("../../lib/queue/client");
    await publish({ id: delivery.id, attemptNumber: 5 });
    await vi.waitFor(async () => {
      if (errors.length) throw errors[0];
      const execution = await db.routingExecution.findUniqueOrThrow({ where: { eventId_generation: { eventId, generation: 0 } }, include: { groups: { orderBy: { order: "asc" } } } });
      expect(execution.status).toBe("SUCCESS");
      expect(execution.groups.map(group => group.status)).toEqual(["FAILED", "SUCCESS"]);
    }, { timeout: 20_000, interval: 200 });
    expect((await db.delivery.findFirstOrThrow({ where: { eventId, endpointId: backup.id } })).status).toBe("DELIVERED");
    expect((await db.deliveryAttempt.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } })).map(attempt => attempt.httpStatusCode)).toEqual([500, 200]);
  } finally {
    if (consumerTag) await (await channel()).cancel(consumerTag);
    await closeQueue();
    await db.webhookSource.delete({ where: { id: source.id } });
    await db.application.delete({ where: { id: app.id } });
    await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
    await db.user.delete({ where: { id: userId } });
    await rabbit.stop();
  }
}, 120_000);

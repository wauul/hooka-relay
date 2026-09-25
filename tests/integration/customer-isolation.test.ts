import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../lib/security", async importOriginal => {
  const real = await importOriginal<typeof import("../../lib/security")>();
  return { ...real, resolveEndpoint: vi.fn(async (url: string) => ({ url: new URL(url) })) };
});
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn().mockResolvedValue(undefined) }));

import { db } from "../../lib/db";
import { defaultWorkspace } from "../../lib/workspaces";
import { createApplication } from "../fixtures";
import { ingest } from "../../lib/events";
import { portalRequest } from "../../lib/portal";
import { encryptSecret, hashApiKey } from "../../lib/secrets";
import { drainRecovery } from "../../lib/recovery";
import { operatorUsage } from "../../lib/usage";

let userId: string, workspaceId: string, appId: string;
let customers: { id: string; token: string }[];
const request = (token: string, method = "GET", body?: unknown) => new Request(`https://example.com/api/portal/${token}`, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(async () => {
  vi.stubEnv("PORTAL_IP_LIMIT_PER_MINUTE", "1000");
  userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com` } })).id;
  workspaceId = await defaultWorkspace(userId);
  appId = (await createApplication({ data: { workspaceId, name: "Isolated", customerMode: "ISOLATED", currentApiKey: randomUUID() } })).id;
  customers = await Promise.all(["alpha", "beta"].map(async name => {
    const token = randomUUID().replaceAll("-", "").repeat(2);
    const customer = await db.customer.create({ data: { applicationId: appId, name, externalId: name, portalTokenHash: hashApiKey(token) } });
    return { id: customer.id, token };
  }));
});
afterEach(async () => {
  await db.workspace.delete({ where: { id: workspaceId } });
  await db.user.delete({ where: { id: userId } });
  await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "portal:" } } });
  vi.unstubAllEnvs();
});
afterAll(() => db.$disconnect());

it("routes wildcard events to their own customer and rejects guessed IDs and idempotency reuse", async () => {
  const [a, b] = customers;
  const endpoints = await Promise.all([a, b].map(customer => db.endpoint.create({ data: {
    applicationId: appId, customerId: customer.id, url: `https://example.com/${customer.id}`,
    secret: encryptSecret("private", appId), eventTypes: ["*"],
  } })));
  const event = await ingest(appId, { customerId: a.id, type: "order.paid", payload: { secret: "alpha" }, idempotencyKey: "same" });
  expect(event.customerId).toBe(a.id);
  expect((await db.delivery.findMany({ where: { eventId: event.id } })).map(row => row.endpointId)).toEqual([endpoints[0].id]);
  await expect(ingest(appId, { customerId: b.id, type: "order.paid", payload: {}, idempotencyKey: "same" })).rejects.toMatchObject({ status: 409 });
  await expect(ingest(appId, { customerId: "guessed", type: "order.paid", payload: {} })).rejects.toMatchObject({ status: 404 });
  await expect(ingest(appId, { type: "order.paid", payload: {} })).rejects.toMatchObject({ status: 404 });
  const other = await createApplication({ data: { workspaceId, name: "Other", customerMode: "ISOLATED", currentApiKey: randomUUID() } });
  await expect(ingest(other.id, { customerId: a.id, type: "order.paid", payload: {} })).rejects.toMatchObject({ status: 404 });
});

it("binds inbound sources and their routing destinations to one customer", async () => {
  const [a, b] = customers;
  const [own, foreign] = await Promise.all([a, b].map(customer => db.endpoint.create({ data: {
    applicationId: appId, customerId: customer.id, url: `https://example.com/inbound/${customer.id}`,
    secret: "test-secret", eventTypes: ["*"], kind: "INBOUND",
  } })));
  const source = await db.webhookSource.create({ data: {
    applicationId: appId, customerId: a.id, endpointId: own.id,
    name: "Test source", provider: "STRIPE", ingestionToken: randomUUID().replaceAll("-", "").repeat(2),
  } });
  const accepted = await ingest(appId, { type: "payment.succeeded", payload: {}, idempotencyKey: randomUUID() }, { endpointId: own.id, webhookSourceId: source.id });
  expect(accepted.customerId).toBe(a.id);
  expect((await db.delivery.findMany({ where: { eventId: accepted.id } })).map(row => row.endpointId)).toEqual([own.id]);
  await expect(ingest(appId, { type: "payment.succeeded", payload: {}, idempotencyKey: randomUUID() }, { endpointId: foreign.id, webhookSourceId: source.id })).rejects.toMatchObject({ status: 404 });
  await db.destinationGroup.create({ data: { webhookSourceId: source.id, order: 0, destinations: { create: { endpointId: foreign.id } } } });
  await expect(ingest(appId, { type: "payment.succeeded", payload: {}, idempotencyKey: randomUUID() }, { webhookSourceId: source.id })).rejects.toThrow("Source destination customer mismatch");
});

it("scopes portal logs, secrets, mutations, replay, backlog and recovery", async () => {
  const [a, b] = customers;
  const endpointIds = await Promise.all([a, b].map(async customer => {
    const response = await portalRequest(request(customer.token, "POST", { url: `https://example.com/${customer.id}`, eventTypes: ["*"] }), customer.token);
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }));
  const events = await Promise.all([a, b].map((customer, i) => ingest(appId, { customerId: customer.id, type: "test", payload: { private: i }, idempotencyKey: randomUUID() })));
  const first = await portalRequest(request(a.token), a.token);
  const visible = await first.json();
  expect(visible.endpoints.map((row: { id: string }) => row.id)).toEqual([endpointIds[0]]);
  expect(visible.events.map((row: { id: string }) => row.id)).toEqual([events[0].id]);
  expect(JSON.stringify(visible)).not.toContain(events[1].id);
  expect(JSON.stringify(visible)).not.toContain(endpointIds[1]);
  expect(visible.endpoints[0].secret).toBeTruthy();
  for (const method of ["PATCH", "DELETE"])
    expect((await portalRequest(request(a.token, method, { endpointId: endpointIds[1], action: "pause" }), a.token)).status).toBe(404);
  expect((await portalRequest(request(a.token, "POST", { action: "replay", eventId: events[1].id, endpointId: endpointIds[0] }), a.token)).status).toBe(404);
  expect((await portalRequest(request(a.token, "POST", { action: "replay", eventId: events[0].id, endpointId: endpointIds[1] }), a.token)).status).toBe(404);
  expect((await portalRequest(request(a.token, "POST", { action: "replay", eventId: events[0].id, endpointId: endpointIds[0] }), a.token)).status).toBe(202);
  const foreignDelivery = await db.delivery.findFirstOrThrow({ where: { eventId: events[1].id } });
  await db.delivery.update({ where: { id: foreignDelivery.id }, data: { status: "DEAD_LETTERED" } });
  expect((await portalRequest(request(a.token, "POST", { action: "recover", since: new Date(0).toISOString(), endpointId: endpointIds[1] }), a.token)).status).toBe(404);
  expect((await portalRequest(request(a.token, "POST", { action: "recover", since: new Date(0).toISOString() }), a.token)).status).toBe(202);
  await drainRecovery();
  expect(await db.delivery.count({ where: { eventId: events[1].id } })).toBe(1);
  expect((await db.recoveryJob.findFirstOrThrow({ where: { applicationId: appId } })).customerId).toBe(a.id);
  await db.customer.update({ where: { id: a.id }, data: { portalTokenHash: null } });
  expect((await portalRequest(request(a.token), a.token)).status).toBe(404);
});

it("keeps billable usage after event history is removed and denies non-operators", async () => {
  const a = customers[0];
  const endpoint = await db.endpoint.create({ data: { applicationId: appId, customerId: a.id, url: "https://example.com/a", secret: "secret", eventTypes: ["*"] } });
  const event = await ingest(appId, { customerId: a.id, type: "test", payload: {}, idempotencyKey: randomUUID() });
  const delivery = await db.delivery.findFirstOrThrow({ where: { eventId: event.id } });
  await db.deliveryAttempt.create({ data: { deliveryId: delivery.id, eventId: event.id, endpointId: endpoint.id, attemptNumber: 1, status: "FAILED" } });
  await db.deliveryAttempt.create({ data: { deliveryId: delivery.id, eventId: event.id, endpointId: endpoint.id, attemptNumber: 2, status: "SUCCESS" } });
  await expect(operatorUsage("outsider@example.com", new URL("https://example.com?from=2026-09&to=2026-09"))).rejects.toMatchObject({ status: 404 });
  vi.stubEnv("OPERATOR_EMAILS", "operator@example.com");
  const date = event.createdAt.toISOString().slice(0, 7);
  const url = new URL(`https://example.com?from=${date}&to=${date}&workspaceId=${workspaceId}`);
  const usage = await operatorUsage("operator@example.com", url);
  expect(usage.rows[0]).toMatchObject({ acceptedEvents: "1", destinationDeliveries: "1", retryAttempts: "1" });
  await db.event.delete({ where: { id: event.id } });
  expect((await operatorUsage("operator@example.com", url)).rows[0]).toMatchObject({ acceptedEvents: "1", destinationDeliveries: "1", retryAttempts: "1" });
});

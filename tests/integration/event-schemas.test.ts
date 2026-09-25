import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const session = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: session }));
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn() }));
import { db } from "../../lib/db";
import { createWorkspace } from "../../lib/workspaces";
import { hashApiKey } from "../../lib/secrets";
import { PUT, DELETE, GET } from "../../app/api/applications/[id]/schemas/route";
import { POST } from "../../app/api/v1/events/route";
let uid: string, wid: string, aid: string, key: string, customerId: string;
const context = () => ({ params: Promise.resolve({ id: aid }) });
const schema = { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] };
const mutation = (method: string, body: unknown) => new Request("https://example.com/api", { method, body: JSON.stringify(body) });
const send = (type: string, payload: unknown, idempotencyKey: string = randomUUID()) => POST(new Request("https://example.com/api/v1/events", { method: "POST", headers: { authorization: "Bearer " + key }, body: JSON.stringify({ customerId, type, payload, idempotencyKey }) }));
beforeEach(async () => {
  uid = (await db.user.create({ data: { email: randomUUID() + "@example.com", hashedPassword: "unused" } })).id;
  wid = (await createWorkspace(uid, "Schemas")).id; key = randomUUID();
  aid = (await db.application.create({ data: { workspaceId: wid, name: "Schemas", currentApiKey: hashApiKey(key) } })).id;
  customerId = (await db.customer.create({ data: { applicationId: aid, externalId: "test", name: "Test customer" } })).id;
  session.mockResolvedValue({ user: { id: uid } });
});
afterEach(async () => { await db.workspace.delete({ where: { id: wid } }); await db.user.delete({ where: { id: uid } }); });
it("validates registered types, preserves pass-through and duplicate semantics, and removes validation", async () => {
  expect((await PUT(mutation("PUT", { eventType: "order", schema }), context())).status).toBe(200);
  const invalid = await send("order", { orderId: 42 }); expect(invalid.status).toBe(400); expect((await invalid.json()).failures[0].path).toBe("/orderId");
  expect(await db.event.count({ where: { applicationId: aid } })).toBe(0); expect(await db.delivery.count({ where: { event: { applicationId: aid } } })).toBe(0);
  const accepted = await send("order", { orderId: "42" }, "duplicate"); expect(accepted.status).toBe(202);
  const repeated = await send("order", { orderId: 42 }, "duplicate"); expect(repeated.status).toBe(202); expect((await repeated.json()).id).toBe((await accepted.json()).id);
  expect((await send("unregistered", null)).status).toBe(202);
  expect((await DELETE(mutation("DELETE", { eventType: "order" }), context())).status).toBe(200);
  expect((await send("order", { orderId: 42 })).status).toBe(202);
});
it("allows members to view but denies schema mutation and other workspace access", async () => {
  const member = await db.user.create({ data: { email: randomUUID() + "@example.com", hashedPassword: "unused" } });
  try {
    await db.workspaceMember.create({ data: { workspaceId: wid, userId: member.id, role: "MEMBER" } }); session.mockResolvedValue({ user: { id: member.id } });
    expect((await GET(mutation("GET", undefined), context())).status).toBe(200);
    expect((await PUT(mutation("PUT", { eventType: "order", schema }), context())).status).toBe(403);
    expect((await DELETE(mutation("DELETE", { eventType: "order" }), context())).status).toBe(403);
    session.mockResolvedValue({ user: { id: "unrelated-user" } }); expect((await GET(mutation("GET", undefined), context())).status).toBe(404);
  } finally { await db.workspaceMember.deleteMany({ where: { userId: member.id } }); await db.user.delete({ where: { id: member.id } }); }
});
it("isolates application schemas and rejects unsafe definitions", async () => {
  expect((await PUT(mutation("PUT", { eventType: "order", schema: { pattern: "(a+)+$" } }), context())).status).toBe(400);
  const other = await db.application.create({ data: { workspaceId: wid, name: "Other", currentApiKey: hashApiKey(randomUUID()) } });
  await db.eventSchema.create({ data: { applicationId: other.id, eventType: "order", schema } });
  expect((await send("order", { orderId: 42 })).status).toBe(202);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  event: { create: vi.fn(), findUniqueOrThrow: vi.fn() },
  endpoint: { findMany: vi.fn() },
  delivery: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(), publish: vi.fn(),
}));
vi.mock("../../lib/db", () => ({ db: { event: mocks.event, endpoint: mocks.endpoint, delivery: mocks.delivery, $transaction: mocks.transaction } }));
vi.mock("../../lib/queue/client", () => ({ publish: mocks.publish }));
import { eventInput, flushDelivery, ingest } from "../../lib/events";
const input = { type: "order.shipped", idempotencyKey: "order-42", payload: { order: 42 } };
const event = { id: "event-1", applicationId: "app-1", ...input };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async callback => callback({ event: mocks.event, endpoint: mocks.endpoint, delivery: mocks.delivery }));
  mocks.event.create.mockResolvedValue(event);
  mocks.endpoint.findMany.mockResolvedValue([]);
  mocks.delivery.findMany.mockResolvedValue([]);
  mocks.publish.mockResolvedValue(undefined);
});
describe("producer idempotency", () => {
  it("creates a new event for a new application-scoped key", async () => {
    expect(await ingest("app-1", input)).toEqual(event);
    expect(mocks.event.create).toHaveBeenCalledExactlyOnceWith({ data: { applicationId: "app-1", ...input } });
    expect(mocks.event.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("returns the existing event on the database uniqueness conflict", async () => {
    mocks.event.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6.19.0" }));
    mocks.event.findUniqueOrThrow.mockResolvedValue(event);
    expect(await ingest("app-1", { ...input, payload: { order: 999 } })).toEqual(event);
    expect(mocks.event.findUniqueOrThrow).toHaveBeenCalledWith({ where: { applicationId_idempotencyKey: { applicationId: "app-1", idempotencyKey: "order-42" } } });
    expect(mocks.delivery.createMany).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("scopes a reused key to a different application", async () => {
    await ingest("app-2", input);
    expect(mocks.event.create).toHaveBeenCalledWith({ data: { ...input, applicationId: "app-2" } });
  });
  it("generates a UUID when the caller omits the key", async () => {
    await ingest("app-1", { type: input.type, payload: input.payload });
    expect(mocks.event.create.mock.calls[0][0].data.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("stores JSON null using Prisma's JSON null sentinel", async () => { await ingest("app-1", { ...input, payload: null }); expect(mocks.event.create.mock.calls[0][0].data.payload).toBe(Prisma.JsonNull); });
  it("propagates unrelated database errors", async () => { mocks.event.create.mockRejectedValue(new Error("database unavailable")); await expect(ingest("app-1", input)).rejects.toThrow("database unavailable"); });
  it("creates one durable intent per matched endpoint and publishes its identity", async () => {
    mocks.endpoint.findMany.mockResolvedValue([{id:"ep-1"},{id:"ep-2"}]);
    mocks.delivery.findMany.mockResolvedValue([{id:"d-1"},{id:"d-2"}]);
    mocks.delivery.findUnique.mockImplementation(async ({where}) => ({id:where.id,attemptNumber:1,status:"PENDING",publishedAt:null,delayQueue:null}));
    await ingest("app-1", input);
    expect(mocks.delivery.createMany).toHaveBeenCalledWith({data:[{eventId:event.id,endpointId:"ep-1"},{eventId:event.id,endpointId:"ep-2"}]});
    expect(mocks.endpoint.findMany).toHaveBeenCalledWith({where:{applicationId:"app-1",OR:[{eventTypes:{has:"*"}},{eventTypes:{has:input.type}}]},select:{id:true}});
    expect(mocks.publish).toHaveBeenCalledWith({id:"d-1",attemptNumber:1},null);
    expect(mocks.publish).toHaveBeenCalledWith({id:"d-2",attemptNumber:1},null);
  });
  it("still accepts a persisted event during a broker outage", async () => {
    mocks.delivery.findMany.mockResolvedValue([{id:"d-1"}]);
    mocks.delivery.findUnique.mockResolvedValue({id:"d-1",attemptNumber:1,status:"PENDING",publishedAt:null,delayQueue:null});
    mocks.publish.mockRejectedValue(new Error("broker unavailable"));
    expect(await ingest("app-1", input)).toEqual(event);
    expect(mocks.delivery.updateMany).not.toHaveBeenCalled();
  });
});
describe("outbox publishing", () => {
  it.each([null, {status:"DELIVERED"}, {status:"PENDING",publishedAt:new Date()}])("ignores non-publishable delivery %#", async delivery => { mocks.delivery.findUnique.mockResolvedValue(delivery); await flushDelivery("d"); expect(mocks.publish).not.toHaveBeenCalled(); });
  it("sends retries to their delay queue and marks confirmed publication", async () => {
    mocks.delivery.findUnique.mockResolvedValue({id:"d",status:"PENDING",publishedAt:null,attemptNumber:2,delayQueue:"retry-delay-30s"});
    await flushDelivery("d");
    expect(mocks.publish).toHaveBeenCalledWith({id:"d",attemptNumber:2},"retry-delay-30s");
    expect(mocks.delivery.updateMany).toHaveBeenCalledWith({where:{id:"d",attemptNumber:2,status:"PENDING"},data:{publishedAt:expect.any(Date)}});
  });
});
describe("event validation", () => {
  it.each([{...input,type:"bad\nheader"},{...input,idempotencyKey:"bad\rkey"},{...input,payload:undefined}])("rejects malformed request %#", body => expect(eventInput.safeParse(body).success).toBe(false));
});

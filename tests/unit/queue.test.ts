import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("amqplib", () => ({ default: { connect: transport.connect } }));
import { declareTopology, DELAYS, EXCHANGE, RETRY_EXCHANGE, QUEUE } from "../../lib/queue/topology";
function fakeChannel() {
  return Object.assign(new EventEmitter(), {
    assertExchange: vi.fn().mockResolvedValue({}), assertQueue: vi.fn().mockResolvedValue({}), bindQueue: vi.fn().mockResolvedValue({}),
    publish: vi.fn((_exchange, _routing, _body, _options, confirm) => { confirm(null); return true; }),
  });
}
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
describe("TTL + DLX topology", () => {
  it("declares durable direct exchanges and both routes into the real queue", async () => {
    const ch = fakeChannel(); await declareTopology(ch as never);
    expect(ch.assertExchange.mock.calls).toEqual([[EXCHANGE,"direct",{durable:true}],[RETRY_EXCHANGE,"direct",{durable:true}]]);
    expect(ch.bindQueue.mock.calls).toEqual([[QUEUE,EXCHANGE,"deliver"],[QUEUE,RETRY_EXCHANGE,"deliver"]]);
    expect(ch.assertQueue).toHaveBeenCalledTimes(6);
    for (const delay of DELAYS) expect(ch.assertQueue).toHaveBeenCalledWith(delay.name,{durable:true,arguments:{"x-message-ttl":delay.ms,"x-dead-letter-exchange":RETRY_EXCHANGE,"x-dead-letter-routing-key":"deliver"}});
    expect(DELAYS.map(d=>d.ms)).toEqual([30000,120000,300000,900000,1800000]);
  });
});
describe("publisher wire contract", () => {
  async function setup() {
    const ch = fakeChannel(); const conn = Object.assign(new EventEmitter(), {createConfirmChannel:vi.fn().mockResolvedValue(ch),close:vi.fn().mockResolvedValue(undefined)});
    transport.connect.mockResolvedValue(conn);
    return { ch, conn, client: await import("../../lib/queue/client") };
  }
  it("publishes a persistent JSON job to the real exchange and routing key", async () => {
    const {ch,client}=await setup(); await client.publish({id:"d",attemptNumber:1});
    const [exchange,key,body,options]=ch.publish.mock.calls[0];
    expect([exchange,key]).toEqual([EXCHANGE,"deliver"]); expect(JSON.parse(body.toString())).toEqual({id:"d",attemptNumber:1}); expect(options).toEqual({persistent:true,contentType:"application/json"});
  });
  it("publishes retries to a named delay queue via the default exchange", async () => {
    const {ch,client}=await setup(); await client.publish({id:"d",attemptNumber:2},"retry-delay-30s");
    expect(ch.publish.mock.calls[0].slice(0,2)).toEqual(["","retry-delay-30s"]);
  });
  it("rejects a broker negative confirmation", async () => {
    const {ch,client}=await setup(); ch.publish.mockImplementation((_e,_k,_b,_o,confirm)=>{confirm(new Error("nack"));return true;});
    await expect(client.publish({id:"d",attemptNumber:1})).rejects.toThrow("nack");
  });
  it("shares a connection across simultaneous calls", async () => { const {client}=await setup(); await Promise.all([client.channel(),client.channel()]); expect(transport.connect).toHaveBeenCalledTimes(1); });
  it("reconnects after a connection failure", async () => { const {client}=await setup(); transport.connect.mockRejectedValueOnce(new Error("offline")); await expect(client.channel()).rejects.toThrow("offline"); await client.channel(); expect(transport.connect).toHaveBeenCalledTimes(2); });
  it.each(["error","close"])("invalidates a connection on %s", async event => { const {conn,client}=await setup(); await client.channel(); conn.emit(event,new Error("disconnected")); await client.channel(); expect(transport.connect).toHaveBeenCalledTimes(2); });
  it("invalidates a failed channel", async () => { const {ch,client}=await setup(); await client.channel(); ch.emit("error",new Error("closed")); await client.channel(); expect(transport.connect).toHaveBeenCalledTimes(2); });
  it("closes the connection and resets the cached channel", async () => { const {conn,client}=await setup(); await client.channel(); await client.closeQueue(); expect(conn.close).toHaveBeenCalledOnce(); await client.channel(); expect(transport.connect).toHaveBeenCalledTimes(2); });
  it("can close before connecting", async () => { const {client}=await setup(); await expect(client.closeQueue()).resolves.toBeUndefined(); });
});

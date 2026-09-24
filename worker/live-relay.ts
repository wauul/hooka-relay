import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import WebSocket, { WebSocketServer } from "ws";
import { db } from "../lib/db";
import { authorizeLiveSource, LiveAuthError } from "../lib/live-auth";
import { forwardableProviderHeaders } from "../lib/inbound-headers";
import { LIVE_EXCHANGE } from "../lib/queue/topology";

type Session = { id: string; sourceId: string; alive: boolean };
type Transport = { channel: ConfirmChannel; queue: string };
type WireMessage = { type?: string; apiKey?: string; source?: string; attemptId?: string; status?: number; durationMs?: number; responseBody?: string; error?: string };

function send(socket: WebSocket, value: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

export function createLiveRelay(server: Server) {
  const wss = new WebSocketServer({ server, path: "/live", maxPayload: 8192, perMessageDeflate: false });
  const sessions = new Map<WebSocket, Session>();
  let transport: Transport | null = null;
  async function receive(message: ConsumeMessage, channel: ConfirmChannel) {
    try {
      const { receiptId, replayId } = JSON.parse(message.content.toString("utf8")) as { receiptId?: string; replayId?: string };
      if (!receiptId || receiptId.length > 100) return;
      const receipt = await db.inboundReceipt.findUnique({ where: { id: receiptId } });
      if (!receipt?.verified) return;
      for (const [socket, session] of sessions) {
        if (socket.readyState !== WebSocket.OPEN || session.sourceId !== receipt.sourceId) continue;
        const attempt = await db.inboundLiveAttempt.create({ data: { receiptId, sessionId: session.id, replayId: replayId || null, status: "SENT" } });
        send(socket, { type: "event", attemptId: attempt.id, receiptId, replayId: replayId || null,
          eventType: receipt.eventType || "inbound.event", receivedAt: receipt.receivedAt.toISOString(),
          headers: forwardableProviderHeaders(receipt.rawHeaders as Record<string, string>), bodyBase64: receipt.rawBody });
      }
    } catch (error) {
      console.error("Live inbound message failed", { name: error instanceof Error ? error.name : "Unknown" });
    } finally {
      try { channel.ack(message); } catch { /* The ephemeral queue vanished with the broker channel. */ }
    }
  }
  async function subscribe(socket: WebSocket, input: WireMessage) {
    if (input.type !== "subscribe" || typeof input.apiKey !== "string" || typeof input.source !== "string") throw new LiveAuthError("Subscription required");
    const authorized = await authorizeLiveSource(input.apiKey, input.source);
    if (!transport) throw new LiveAuthError("Live relay is reconnecting", 1012);
    const session: Session = { id: randomUUID(), sourceId: authorized.sourceId, alive: true };
    await transport.channel.bindQueue(transport.queue, LIVE_EXCHANGE, `inbound.live.${session.sourceId}`);
    await db.inboundLiveSession.create({ data: { id: session.id, sourceId: session.sourceId } });
    sessions.set(socket, session);
    send(socket, { type: "subscribed", sourceId: session.sourceId, sourceName: authorized.sourceName });
  }
  wss.on("connection", socket => {
    const timeout = setTimeout(() => { if (!sessions.has(socket)) socket.close(4401, "Subscription timed out"); }, 10000);
    socket.on("pong", () => {
      const session = sessions.get(socket);
      if (session) {
        session.alive = true;
        void db.inboundLiveSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      }
    });
    socket.on("message", data => { void (async () => {
      let input: WireMessage;
      try { input = JSON.parse(data.toString("utf8")) as WireMessage; } catch { socket.close(4400, "Invalid message"); return; }
      const session = sessions.get(socket);
      if (!session) {
        try { await subscribe(socket, input); clearTimeout(timeout); }
        catch (error) { socket.close(error instanceof LiveAuthError ? error.code : 1011, error instanceof LiveAuthError ? error.message : "Subscription failed"); }
        return;
      }
      if (input.type !== "ack" || typeof input.attemptId !== "string" || input.attemptId.length > 100) return;
      const code = typeof input.status === "number" && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : null;
      const duration = Number.isFinite(input.durationMs) && input.durationMs! >= 0 ? Math.min(300000, Math.round(input.durationMs!)) : null;
      await db.inboundLiveAttempt.updateMany({ where: { id: input.attemptId, sessionId: session.id, status: "SENT" }, data: {
        status: code !== null && code >= 200 && code < 300 ? "SUCCESS" : "FAILED",
        httpStatusCode: code, durationMs: duration, responseBody: typeof input.responseBody === "string" ? input.responseBody.slice(0, 1024) : null,
        error: typeof input.error === "string" ? input.error.slice(0, 256) : null, completedAt: new Date(),
      } });
    })().catch(() => socket.close(1011, "Relay error")); });
    socket.on("close", () => { clearTimeout(timeout); const session = sessions.get(socket); if (!session) return;
      sessions.delete(socket);
      void db.inboundLiveSession.deleteMany({ where: { id: session.id } }).catch(() => {});
      if (transport && ![...sessions.values()].some(value => value.sourceId === session.sourceId))
        void transport.channel.unbindQueue(transport.queue, LIVE_EXCHANGE, `inbound.live.${session.sourceId}`).catch(() => {});
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, session] of sessions) {
      if (!session.alive) { socket.terminate(); continue; }
      session.alive = false; socket.ping();
    }
  }, 20000);
  return {
    async attach(channel: ConfirmChannel) {
      const queue = (await channel.assertQueue("", { durable: false, exclusive: true, autoDelete: true })).queue;
      transport = { channel, queue };
      await channel.consume(queue, message => { if (message) void receive(message, channel); });
      for (const session of sessions.values()) await channel.bindQueue(queue, LIVE_EXCHANGE, `inbound.live.${session.sourceId}`);
    },
    detach() { transport = null; for (const socket of sessions.keys()) socket.close(1012, "Broker reconnecting"); },
    close() { clearInterval(heartbeat); this.detach(); wss.close(); },
  };
}

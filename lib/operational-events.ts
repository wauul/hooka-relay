import { randomUUID } from "node:crypto";
import type { Prisma, Endpoint } from "@prisma/client";
import { db } from "./db";
export async function operationalEvent(tx: Prisma.TransactionClient, endpoint: Pick<Endpoint, "id" | "applicationId" | "kind">, type: "endpoint.disabled" | "endpoint.re-enabled" | "message.failed", detail: Record<string, string>) {
  // Operational receivers never produce more operational events on failure:
  // this prevents self-referential subscriptions from amplifying indefinitely.
  if (endpoint.kind === "OPERATIONAL") return;
  const event = await tx.event.create({ data: { applicationId: endpoint.applicationId, idempotencyKey: "operational-" + randomUUID(), operational: true, type, payload: { endpointId: endpoint.id, ...detail } } });
  const targets = await tx.endpoint.findMany({ where: { applicationId: endpoint.applicationId, kind: "OPERATIONAL", status: "ACTIVE", OR: [{ eventTypes: { has: "*" } }, { eventTypes: { has: type } }] }, select: { id: true } });
  await tx.delivery.createMany({ data: targets.map(target => ({ eventId: event.id, endpointId: target.id })) });
  if (type === "endpoint.disabled") {
    const oldest = await tx.event.findFirst({ where: { applicationId: endpoint.applicationId, deliveries: { some: { endpointId: endpoint.id, status: { in: ["PENDING", "DEAD_LETTERED"] } } } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    await tx.operationalNotice.create({ data: { id: event.id, applicationId: endpoint.applicationId, endpointId: endpoint.id, since: new Date((oldest?.createdAt || event.createdAt).getTime() - 1) } });
  }
}
export async function sendOperationalNotice(notice: { id: string; applicationId: string; endpointId: string; since: Date }, email: string) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM || !process.env.NEXTAUTH_URL) throw new Error("Email configuration missing");
  const link = new URL(`/applications/${notice.applicationId}/backlog`, process.env.NEXTAUTH_URL);
  link.searchParams.set("endpoint_id", notice.endpointId); link.searchParams.set("since", notice.since.toISOString());
  const result = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `endpoint-disabled-${notice.id}` }, body: JSON.stringify({ from: process.env.RESEND_FROM, to: [email], subject: "Hooka Relay: endpoint delivery temporarily disabled", text: `Endpoint ${notice.endpointId} reached the circuit-breaker threshold. Automatic recovery probes remain enabled. View the missed-event range and recovery tools:\n${link}` }), signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error("Notification email failed");
}
export async function drainNotices() {
  const notices = await db.operationalNotice.findMany({ where: { sentAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 5 } }, take: 5 });
  for (const notice of notices) {
    // Atomic claim prevents multiple worker replicas spending duplicate email calls.
    const claim = await db.operationalNotice.updateMany({ where: { id: notice.id, sentAt: null, nextAttemptAt: notice.nextAttemptAt }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 300000) } });
    if (!claim.count) continue;
    const owner = await db.workspaceMember.findFirst({ where: { role: "OWNER", workspace: { applications: { some: { id: notice.applicationId } } } }, include: { user: { select: { email: true } } } });
    if (!owner) continue;
    try { await sendOperationalNotice(notice, owner.user.email); await db.operationalNotice.update({ where: { id: notice.id }, data: { sentAt: new Date() } }); }
    catch { console.warn("Endpoint notification pending; dashboard circuit banner remains available"); }
  }
}

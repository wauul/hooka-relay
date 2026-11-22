import { db } from "./db";

const DAY_MS = 86_400_000;
const BATCH_SIZE = 100;
const LIVE_ACK_TIMEOUT_MS = 5 * 60_000;

export function eventRetentionDays() {
  const days = Number(process.env.EVENT_RETENTION_DAYS ?? 30);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
    throw new Error("EVENT_RETENTION_DAYS must be an integer from 1 to 3650");
  return days;
}

// Keep the application row locked while selecting events. Recovery creation
// takes the same lock, so an in-progress recovery cannot lose its event set.
export async function pruneEventHistory(now = new Date(), batchSize = BATCH_SIZE) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Invalid retention batch size");
  const cutoff = new Date(now.getTime() - eventRetentionDays() * DAY_MS);
  // A crashed listener can leave SENT attempts behind. Only recent attempts
  // protect a receipt while the listener still has time to acknowledge it.
  const liveAckCutoff = new Date(now.getTime() - LIVE_ACK_TIMEOUT_MS);
  return db.$transaction(async tx => {
    const events = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM "Event" e
      JOIN "Application" a ON a.id = e."applicationId"
      WHERE e."createdAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "Delivery" d WHERE d."eventId" = e.id AND d.status = 'PENDING'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "RoutingExecution" x WHERE x."eventId" = e.id AND x.status IN ('PENDING', 'RUNNING')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "RecoveryJob" j WHERE j."applicationId" = e."applicationId" AND j.status = 'PENDING'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "InboundReceipt" r JOIN "InboundLiveAttempt" l ON l."receiptId" = r.id
          WHERE r."eventId" = e.id AND l.status = 'SENT' AND l."createdAt" > ${liveAckCutoff}
        )
      ORDER BY e."createdAt", e.id
      LIMIT ${batchSize}
      FOR UPDATE OF e, a SKIP LOCKED`;
    const ids = events.map(event => event.id);
    if (ids.length) {
      await tx.inboundReceipt.deleteMany({ where: { eventId: { in: ids } } });
      await tx.event.deleteMany({ where: { id: { in: ids } } });
    }

    // Rejected receipts have no Event and expire directly.
    const receipts = await tx.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM "InboundReceipt" r
      WHERE r."eventId" IS NULL AND r."receivedAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "InboundLiveAttempt" l WHERE l."receiptId" = r.id
            AND l.status = 'SENT' AND l."createdAt" > ${liveAckCutoff}
        )
      ORDER BY r."receivedAt", r.id
      LIMIT ${batchSize}
      FOR UPDATE OF r SKIP LOCKED`;
    const receiptIds = receipts.map(receipt => receipt.id);
    if (receiptIds.length) await tx.inboundReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    return { events: ids.length, receipts: receiptIds.length, cutoff };
  });
}

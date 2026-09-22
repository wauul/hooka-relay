-- Nullable context preserves all existing events and survives durable-outbox recovery.
ALTER TABLE "Event" ADD COLUMN "traceparent" TEXT;

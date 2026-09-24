CREATE TABLE "InboundReceipt" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "eventId" TEXT,
  "provider" "WebhookProvider" NOT NULL,
  "eventType" TEXT,
  "rawBody" TEXT NOT NULL,
  "searchText" TEXT,
  "rawHeaders" JSONB NOT NULL,
  "verified" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboundReceipt_eventId_key" ON "InboundReceipt"("eventId");
CREATE INDEX "InboundReceipt_sourceId_receivedAt_id_idx" ON "InboundReceipt"("sourceId", "receivedAt", "id");
CREATE INDEX "InboundReceipt_sourceId_verified_receivedAt_idx" ON "InboundReceipt"("sourceId", "verified", "receivedAt");
ALTER TABLE "InboundReceipt" ADD CONSTRAINT "InboundReceipt_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WebhookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundReceipt" ADD CONSTRAINT "InboundReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InboundReplay" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generation" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundReplay_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundReplay_receiptId_createdAt_idx" ON "InboundReplay"("receiptId", "createdAt");
ALTER TABLE "InboundReplay" ADD CONSTRAINT "InboundReplay_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InboundReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboundLiveSession" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundLiveSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundLiveSession_sourceId_lastSeenAt_idx" ON "InboundLiveSession"("sourceId", "lastSeenAt");
ALTER TABLE "InboundLiveSession" ADD CONSTRAINT "InboundLiveSession_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WebhookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboundLiveAttempt" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "replayId" TEXT,
  "status" TEXT NOT NULL,
  "httpStatusCode" INTEGER,
  "responseBody" TEXT,
  "error" TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "InboundLiveAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundLiveAttempt_receiptId_createdAt_idx" ON "InboundLiveAttempt"("receiptId", "createdAt");
CREATE INDEX "InboundLiveAttempt_sessionId_createdAt_idx" ON "InboundLiveAttempt"("sessionId", "createdAt");
ALTER TABLE "InboundLiveAttempt" ADD CONSTRAINT "InboundLiveAttempt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InboundReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hooka_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "InboundReceipt", "InboundReplay", "InboundLiveSession", "InboundLiveAttempt" TO hooka_runtime;
  END IF;
END
$$;

CREATE TYPE "RoutingTriggerCondition" AS ENUM ('ALWAYS', 'ON_PREVIOUS_SUCCESS', 'ON_PREVIOUS_FAILURE');
CREATE TYPE "RoutingSuccessPolicy" AS ENUM ('ALL_MUST_SUCCEED', 'ANY_MUST_SUCCEED');
CREATE TYPE "RoutingRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "DestinationGroup" (
  "id" TEXT NOT NULL, "webhookSourceId" TEXT NOT NULL, "order" INTEGER NOT NULL,
  "triggerCondition" "RoutingTriggerCondition" NOT NULL DEFAULT 'ALWAYS',
  "successPolicy" "RoutingSuccessPolicy" NOT NULL DEFAULT 'ALL_MUST_SUCCEED',
  CONSTRAINT "DestinationGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DestinationGroup_webhookSourceId_order_key" ON "DestinationGroup"("webhookSourceId", "order");
ALTER TABLE "DestinationGroup" ADD CONSTRAINT "DestinationGroup_webhookSourceId_fkey" FOREIGN KEY ("webhookSourceId") REFERENCES "WebhookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoutingDestination" (
  "id" TEXT NOT NULL, "destinationGroupId" TEXT NOT NULL, "endpointId" TEXT NOT NULL,
  CONSTRAINT "RoutingDestination_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoutingDestination_endpointId_key" ON "RoutingDestination"("endpointId");
CREATE INDEX "RoutingDestination_destinationGroupId_idx" ON "RoutingDestination"("destinationGroupId");
ALTER TABLE "RoutingDestination" ADD CONSTRAINT "RoutingDestination_destinationGroupId_fkey" FOREIGN KEY ("destinationGroupId") REFERENCES "DestinationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutingDestination" ADD CONSTRAINT "RoutingDestination_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoutingExecution" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "webhookSourceId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 0, "status" "RoutingRunStatus" NOT NULL DEFAULT 'RUNNING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "RoutingExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoutingExecution_eventId_generation_key" ON "RoutingExecution"("eventId", "generation");
CREATE INDEX "RoutingExecution_status_createdAt_idx" ON "RoutingExecution"("status", "createdAt");
ALTER TABLE "RoutingExecution" ADD CONSTRAINT "RoutingExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutingExecution" ADD CONSTRAINT "RoutingExecution_webhookSourceId_fkey" FOREIGN KEY ("webhookSourceId") REFERENCES "WebhookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoutingGroupRun" (
  "id" TEXT NOT NULL, "executionId" TEXT NOT NULL, "order" INTEGER NOT NULL,
  "triggerCondition" "RoutingTriggerCondition" NOT NULL, "successPolicy" "RoutingSuccessPolicy" NOT NULL,
  "status" "RoutingRunStatus" NOT NULL DEFAULT 'PENDING', "reason" TEXT,
  CONSTRAINT "RoutingGroupRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoutingGroupRun_executionId_order_key" ON "RoutingGroupRun"("executionId", "order");
ALTER TABLE "RoutingGroupRun" ADD CONSTRAINT "RoutingGroupRun_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "RoutingExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoutingDestinationRun" (
  "id" TEXT NOT NULL, "groupRunId" TEXT NOT NULL, "endpointId" TEXT,
  "url" TEXT NOT NULL, "deliveryId" TEXT,
  CONSTRAINT "RoutingDestinationRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoutingDestinationRun_deliveryId_key" ON "RoutingDestinationRun"("deliveryId");
CREATE INDEX "RoutingDestinationRun_groupRunId_idx" ON "RoutingDestinationRun"("groupRunId");
ALTER TABLE "RoutingDestinationRun" ADD CONSTRAINT "RoutingDestinationRun_groupRunId_fkey" FOREIGN KEY ("groupRunId") REFERENCES "RoutingGroupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutingDestinationRun" ADD CONSTRAINT "RoutingDestinationRun_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoutingDestinationRun" ADD CONSTRAINT "RoutingDestinationRun_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each existing public destination becomes the first group's sole endpoint.
-- Keep WebhookSource.endpointId/destinationUrl as a compatibility mirror so
-- older clients and single-destination screens retain their current meaning.
INSERT INTO "DestinationGroup" ("id", "webhookSourceId", "order", "triggerCondition", "successPolicy")
SELECT 'legacy-group-' || "id", "id", 0, 'ALWAYS', 'ALL_MUST_SUCCEED'
FROM "WebhookSource" WHERE "endpointId" IS NOT NULL;
INSERT INTO "RoutingDestination" ("id", "destinationGroupId", "endpointId")
SELECT 'legacy-destination-' || "id", 'legacy-group-' || "id", "endpointId"
FROM "WebhookSource" WHERE "endpointId" IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hooka_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "DestinationGroup", "RoutingDestination", "RoutingExecution", "RoutingGroupRun", "RoutingDestinationRun" TO hooka_runtime;
  END IF;
END $$;

ALTER TYPE "EndpointKind" ADD VALUE 'INBOUND';

CREATE TYPE "WebhookProvider" AS ENUM ('STRIPE', 'GITHUB', 'SLACK', 'SHOPIFY', 'TWILIO', 'WOOCOMMERCE', 'CUSTOM');
CREATE TYPE "WebhookSourceStatus" AS ENUM ('SETUP_IN_PROGRESS', 'ACTIVE', 'PAUSED');

CREATE TABLE "WebhookSource" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "endpointId" TEXT,
  "name" TEXT NOT NULL,
  "provider" "WebhookProvider" NOT NULL,
  "ingestionToken" TEXT NOT NULL,
  "encryptedProviderSecret" TEXT,
  "manualConfig" JSONB,
  "destinationUrl" TEXT,
  "status" "WebhookSourceStatus" NOT NULL DEFAULT 'SETUP_IN_PROGRESS',
  "lastEventReceivedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "lastVerificationFailure" TEXT,
  "lastVerificationFailureAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookSource_endpointId_key" ON "WebhookSource"("endpointId");
CREATE UNIQUE INDEX "WebhookSource_ingestionToken_key" ON "WebhookSource"("ingestionToken");
CREATE INDEX "WebhookSource_applicationId_createdAt_idx" ON "WebhookSource"("applicationId", "createdAt");
ALTER TABLE "WebhookSource" ADD CONSTRAINT "WebhookSource_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookSource" ADD CONSTRAINT "WebhookSource_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Event" ADD COLUMN "webhookSourceId" TEXT;
CREATE INDEX "Event_webhookSourceId_createdAt_idx" ON "Event"("webhookSourceId", "createdAt");
ALTER TABLE "Event" ADD CONSTRAINT "Event_webhookSourceId_fkey" FOREIGN KEY ("webhookSourceId") REFERENCES "WebhookSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
